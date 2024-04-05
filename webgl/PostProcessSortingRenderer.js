"use strict";

import { main } from "../main.js";
import { ShaderProgram } from "./Shaderprogram.js";

const fullscreenQuadVertex = `#version 300 es
precision mediump float;

out vec2 uv;

void main(){
    vec4 pos = vec4(float((gl_VertexID<<1) & 2) - 1., float(gl_VertexID&2) - 1.,-0.5,1);
    gl_Position = pos;
    uv = pos.xy*.5 + .5;
}
`;

const maskGenFragShader = `#version 300 es
precision mediump float;

in vec2 uv;
out lowp uint outputColor;
uniform mediump sampler2D uSampler;

void main(){
    vec3 sampleColor = texture(uSampler,uv).xyz;
    float luminance = sampleColor.x * 0.25 + sampleColor.y * 0.4 + sampleColor.z * 0.35;
    lowp uint mask = (luminance>.1)?1u:0u;
    outputColor = mask;
}`

/**
 * scanning the texture first then sorting it
 * creates a worst case scenario of O(n log n)
 * as scanning the texture results in O(n) time
 * complexity, which can be ignored due to the
 * O(n log n) of the sorting algorithm
 */

const maskScanFragShader = `#version 300 es
precision mediump float;

in vec2 uv;
out mediump uint outputColor;
uniform lowp usampler2D uSampler;

void main(){
    //avoid typing the same thing over and over again because that's pain
    ivec2 fragCoord = ivec2(gl_FragCoord);

    //original sample color
    lowp uint sampleColor = texelFetch(uSampler,fragCoord,0).x;

    lowp uint count = 0u;
    lowp uint prev = sampleColor;

    //debug
    int iters = 0;

    int y = fragCoord.y;
    while(y>0){
        y--;
        iters++;
        lowp uint curr = texelFetch(uSampler,fragCoord-ivec2(0,y),0).x;
        if((prev^curr)==1u && curr == 1u){
            count++;
        }
        prev = curr;
    }

    outputColor = count * sampleColor;
}`

const genKeysFragShader = `#version 300 es
precision mediump float;

in vec2 uv;
out mediump uvec2 outputColor;
uniform mediump sampler2D uSampler;

void main(){
    vec3 sampleColor = texture(uSampler,uv).xyz;
    float luminance = sampleColor.x * 0.25 + sampleColor.y * 0.4 + sampleColor.z * 0.35;
    mediump uint fragY = uint(gl_FragCoord.y);
    outputColor = uvec2(uint(luminance*8192.),fragY);
}
`

const sortIndiciesFragShader = `#version 300 es
precision mediump float;

out mediump vec4 outputColor;
uniform mediump usampler2D uSampler;
uniform lowp usampler2D mask;

uvec2 getPixelVal(uvec2 texel1, uvec2 texel2, uint col, bool min){
    lowp uint texelMask1 = texelFetch(mask, ivec2(col,texel1.y),0).x;
    lowp uint texelMask2 = texelFetch(mask, ivec2(col,texel2.y),0).x;
    bool b = ((texelMask1^texelMask2) == 0u) && ((texelMask1&texelMask2) != 0u);

    mediump uint sortBy1 = texel1.x;
    mediump uint sortBy2 = texel2.x;

    return (min ^^ (b && (sortBy1>sortBy2)))?texel1:texel2;
}

void main(){
    ivec2 fragCoord = ivec2(gl_FragCoord);

    uvec2 sortTexel1 = texelFetch(uSampler,fragCoord / ivec2(1,2) * ivec2(1,2),0).xy;
    uvec2 sortTexel2 = texelFetch(uSampler,fragCoord / ivec2(1,2) * ivec2(1,2) + ivec2(0,1),0).xy;

    uvec2 tmp = getPixelVal(sortTexel1,sortTexel2,uint(fragCoord.x),fragCoord.y%2 == 0);

    outputColor = vec4(vec2(tmp)/8192.,0,1);
}
`

export class PostProcessSortingRenderer{
    /**
     *
     * @param {WebGL2RenderingContext} gl
     * @param {WebGLTexture} srcTexture
     * @param {WebGLFramebuffer} dstFrameBuffer
     */
    constructor(gl,srcTexture,dstFrameBuffer){
        this.srcTexture = srcTexture;
        this.dstFrameBuffer = dstFrameBuffer;
        this.maskGenPass = new ShaderProgram(gl,fullscreenQuadVertex,maskGenFragShader);
        this.maskScanPass = new ShaderProgram(gl,fullscreenQuadVertex,maskScanFragShader);
        this.genKeysPass = new ShaderProgram(gl,fullscreenQuadVertex,genKeysFragShader);
        this.sortIndexPass = new ShaderProgram(gl,fullscreenQuadVertex,sortIndiciesFragShader)

        this.maskTexture = undefined;
        this.maskFrameBuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.maskFrameBuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.maskTexture,0);

        this.maskSpansTexture = undefined;
        this.spansFrameBuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.spansFrameBuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.maskSpansTexture,0);

        this.sortTexture0 = undefined;
        this.sortTexture1 = undefined;
        this.sortFrameBuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.sortFrameBuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.sortTexture0,0);

    }
    
    /**
     *
     * @param {WebGL2RenderingContext} gl
     */
    render(gl){
        if(main.viewportScaleUpdated){
            this.onUpdateViewportScale(gl);
        }
        this.sortingMaskPass(gl);
        this.scanMaskPass(gl);
        this.genSortingKeysPass(gl);
        this.sortPass(gl,this.sortTexture0,this.dstFrameBuffer,null);
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.dstFrameBuffer);
    }
    onUpdateViewportScale(gl) {
        if (this.maskTexture !== undefined) gl.deleteTexture(this.maskTexture);
        if (this.maskSpansTexture !== undefined) gl.deleteTexture(this.maskSpansTexture);
        if (this.sortTexture0 !== undefined) gl.deleteTexture(this.sortTexture0);
        if (this.sortTexture1 !== undefined) gl.deleteTexture(this.sortTexture1);

        this.maskTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, gl.canvas.clientWidth, gl.canvas.clientHeight);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

        this.maskSpansTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.maskSpansTexture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16UI, gl.canvas.clientWidth, gl.canvas.clientHeight);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

        this.sortTexture0 = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.sortTexture0);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG16UI, gl.canvas.clientWidth, gl.canvas.clientHeight);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

        this.sortTexture1 = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.sortTexture1);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG16UI, gl.canvas.clientWidth, gl.canvas.clientHeight);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    }

    /**
     * 
     * @param {WebGL2RenderingContext} gl 
     */
    sortingMaskPass(gl){
        this.maskGenPass.use();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D,this.srcTexture);

        gl.bindFramebuffer(gl.FRAMEBUFFER,this.maskFrameBuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.maskTexture,0);

        gl.uniform1i(this.maskGenPass.getUniformLocation("uSampler"),0);

        gl.disable(gl.DEPTH_TEST);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
    /**
     * 
     * @param {WebGL2RenderingContext} gl 
     */
    scanMaskPass(gl){
        this.maskScanPass.use();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D,this.maskTexture);

        gl.bindFramebuffer(gl.FRAMEBUFFER,this.spansFrameBuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.maskSpansTexture,0);

        gl.uniform1i(this.maskScanPass.getUniformLocation("uSampler"),1);

        gl.disable(gl.DEPTH_TEST);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
    /**
     * 
     * @param {WebGL2RenderingContext} gl 
     */
    genSortingKeysPass(gl){
        this.genKeysPass.use();
        // gl.activeTexture(gl.TEXTURE0);
        // gl.bindTexture(gl.TEXTURE_2D,this.srcTexture);

        gl.bindFramebuffer(gl.FRAMEBUFFER,this.sortFrameBuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.sortTexture0,0);

        gl.uniform1i(this.genKeysPass.getUniformLocation("uSampler"),0);

        gl.disable(gl.DEPTH_TEST);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
    /**
     * 
     * @param {WebGL2RenderingContext} gl 
     */
    sortPass(gl,srcTex,dstBuffer,dstTexture){
        this.sortIndexPass.use();
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D,srcTex);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D,this.maskSpansTexture);

        gl.bindFramebuffer(gl.FRAMEBUFFER,dstBuffer);
        //gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,dstTexture,0);

        gl.uniform1i(this.sortIndexPass.getUniformLocation("uSampler"),2);
        gl.uniform1i(this.sortIndexPass.getUniformLocation("mask"),3);

        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
}