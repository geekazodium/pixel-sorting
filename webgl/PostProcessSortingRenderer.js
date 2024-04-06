"use strict";

import { main } from "../main.js";
import { ShaderProgram } from "./Shaderprogram.js";

const fullscreenQuadVertexWithUv = `#version 300 es
precision mediump float;

out vec2 uv;

void main(){
    vec4 pos = vec4(float((gl_VertexID<<1) & 2) - 1., float(gl_VertexID&2) - 1.,-0.5,1);
    gl_Position = pos;
    uv = pos.xy*.5 + .5;
}
`;

const fullscreenQuadVertex = `#version 300 es
precision mediump float;

void main(){
    vec4 pos = vec4(float((gl_VertexID<<1) & 2) - 1., float(gl_VertexID&2) - 1.,-0.5,1);
    gl_Position = pos;
}
`;

const maskGenFragShader = `#version 300 es
precision mediump float;

out lowp uint outputColor;
uniform mediump sampler2D uSampler;

void main(){
    vec3 sampleColor = texelFetch(uSampler,ivec2(gl_FragCoord),0).xyz;
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

out mediump uint outputColor;
uniform lowp usampler2D uSampler;

void main(){
    //avoid typing the same thing over and over again because that's pain
    ivec2 fragCoord = ivec2(gl_FragCoord);

    //original sample color
    lowp uint sampleColor = texelFetch(uSampler,fragCoord,0).x;

    lowp uint count = 0u;
    lowp uint prev = 0u;

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

out mediump uvec2 outputColor;
uniform mediump sampler2D uSampler;

void main(){
    vec3 sampleColor = texelFetch(uSampler,ivec2(gl_FragCoord),0).xyz;
    float luminance = sampleColor.x * 0.25 + sampleColor.y * 0.4 + sampleColor.z * 0.35;
    mediump uint fragY = uint(gl_FragCoord.y);
    outputColor = uvec2(uint(luminance*8192.),fragY);
}
`

const sortIndiciesFragShader = `#version 300 es
precision mediump float;

out mediump uvec2 outputColor;
uniform lowp int step;
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
    bool inv = step < 0;
    lowp uint p = uint(abs(step));

    ivec2 fragCoord = ivec2(gl_FragCoord);
    uint y = uint(fragCoord.y);

    bool s = ((y>>p) & 1u) == 1u;

    uint d = 1u<<p;
    uint invRes = y ^ ((d<<1u) - 1u);

    uint y1 = !s?y:(inv?invRes:y-d);
    uint y2 = s?y:(inv?invRes:y+d);

    uvec2 sortTexel1 = texelFetch(uSampler,ivec2(fragCoord.x,y1),0).xy;
    uvec2 sortTexel2 = texelFetch(uSampler,ivec2(fragCoord.x,y2),0).xy;

    uvec2 tmp = getPixelVal(sortTexel1,sortTexel2,uint(fragCoord.x),!s);

    outputColor = tmp;
}
`

const debugSort = `#version 300 es
precision mediump float;

out mediump vec4 outputColor;
uniform mediump usampler2D uSampler;
uniform lowp usampler2D mask;
uniform mediump sampler2D colorSrc;

void main(){
    ivec2 texelCoord = ivec2(gl_FragCoord.x,texelFetch(uSampler,ivec2(gl_FragCoord),0).y);
    outputColor = texelFetch(colorSrc,texelCoord,0);
}
`

const rescaleFragShader = `#version 300 es
precision mediump float;

in vec2 uv;
out vec4 outputColor;
uniform mediump sampler2D uSampler;
uniform float offset;

void main(){
    outputColor = texture(uSampler,uv*vec2(1,-1) + offset*.2);
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
        this.preResamplePass = new ShaderProgram(gl,fullscreenQuadVertexWithUv,rescaleFragShader);

        this.maskGenPass = new ShaderProgram(gl,fullscreenQuadVertex,maskGenFragShader);
        this.maskScanPass = new ShaderProgram(gl,fullscreenQuadVertex,maskScanFragShader);
        this.genKeysPass = new ShaderProgram(gl,fullscreenQuadVertex,genKeysFragShader);
        this.sortIndexPass = new ShaderProgram(gl,fullscreenQuadVertex,sortIndiciesFragShader);

        this.debugSortingDisplay = new ShaderProgram(gl,fullscreenQuadVertex,debugSort)

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
        
        //remove if original texture is the same size is viewport
        this.preResampleTexture = undefined;
        this.preResampleFrameBuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.preResampleFrameBuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.preResampleTexture,0);

        this.offset = 0;
    }
    
    /**
     *
     * @param {WebGL2RenderingContext} gl
     */
    async render(gl){
        if(main.viewportScaleUpdated){
            this.onUpdateViewportScale(gl);
        }
        this.offset += 0.01;
        this.prepass(gl);
        this.sortingMaskPass(gl);
        this.scanMaskPass(gl);
        this.genSortingKeysPass(gl);

        const totalPasses = Math.ceil(Math.log2(gl.canvas.clientHeight));
        let swapped = false;

        for(let pass = 0;pass<totalPasses;pass++){
            for(let step = pass;step>=0;step--){
                //console.log(step)
                gl.bindFramebuffer(gl.FRAMEBUFFER,this.sortFrameBuffer);
                gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,swapped?this.sortTexture0:this.sortTexture1,0);        
                this.sortPass(
                    gl,
                    swapped?this.sortTexture1:this.sortTexture0,
                    this.sortFrameBuffer,
                    step,
                    pass === step
                );
                swapped = !swapped;
                //await new Promise(res=>{setTimeout(t=>res(),16)});
            }
        }
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D,swapped?this.sortTexture1:this.sortTexture0);
        this.transferResult(gl);
        //await new Promise(res=>{setTimeout(t=>res(),1000)});
        this.logged = true;
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.dstFrameBuffer);
    }
    /**
     * 
     * @param {WebGL2RenderingContext} gl 
     */
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

        //remove if original texture is the same size as viewport
        if (this.preResampleTexture !== undefined) gl.deleteTexture(this.preResampleTexture);
        this.preResampleTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.preResampleTexture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, gl.canvas.clientWidth, gl.canvas.clientHeight);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        
    }

    /**
     * 
     * @param {WebGL2RenderingContext} gl 
     */
    prepass(gl){
        this.preResamplePass.use();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D,this.srcTexture);

        gl.bindFramebuffer(gl.FRAMEBUFFER,this.preResampleFrameBuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.preResampleTexture,0);

        gl.uniform1i(this.preResamplePass.getUniformLocation("uSampler"),0);
        gl.uniform1f(this.preResamplePass.getUniformLocation("offset"),this.offset);

        gl.disable(gl.DEPTH_TEST);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }

    /**
     * 
     * @param {WebGL2RenderingContext} gl 
     */
    sortingMaskPass(gl){
        this.maskGenPass.use();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D,this.preResampleTexture);

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
    sortPass(gl,srcTex,dstBuffer,step,reversed){
        this.sortIndexPass.use();
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D,srcTex);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D,this.maskSpansTexture);

        gl.bindFramebuffer(gl.FRAMEBUFFER,dstBuffer);

        gl.uniform1i(this.sortIndexPass.getUniformLocation("uSampler"),2);
        gl.uniform1i(this.sortIndexPass.getUniformLocation("mask"),3);
        gl.uniform1i(this.sortIndexPass.getUniformLocation("step"),step * (reversed?-1:1));

        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
    transferResult(gl){
        this.debugSortingDisplay.use();
        
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.dstFrameBuffer);
        gl.uniform1i(this.debugSortingDisplay.getUniformLocation("uSampler"),2);

        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D,this.preResampleTexture);

        gl.uniform1i(this.debugSortingDisplay.getUniformLocation("colorSrc"),4);

        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
}