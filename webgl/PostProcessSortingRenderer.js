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
 * Due to limitations of not having access to compute shaders
 * We will instead be scanning the entire screen to get all
 * spans of pixels which have a length > 1 (single spans
 * can not be unsorted) meaning the maximum size of the resulting
 * texture from vertically scanning the pixels
 * is 1/3 the height of the original image.
 */

const maskScanFragShader = `#version 300 es
precision mediump float;

in vec2 uv;
out mediump vec4 outputColor;
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

    //lowp uint sampleColor_ = ;
    outputColor = vec4(count * sampleColor,float(count * sampleColor) * 0.25,0,1);
}`

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

        this.maskTexture = undefined;

        this.maskFrameBuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.maskFrameBuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.maskTexture,0);

        this.maskSpansTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D,this.maskSpansTexture);
        gl.texStorage2D(gl.TEXTURE_2D,1,gl.R16UI,gl.canvas.clientWidth,gl.canvas.clientHeight);
    }
    
    /**
     *
     * @param {WebGL2RenderingContext} gl
     */
    render(gl){
        if(main.viewportScaleUpdated){
            gl.deleteTexture(this.maskTexture);
            this.maskTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D,this.maskTexture);
            gl.texStorage2D(gl.TEXTURE_2D,1,gl.R8UI,gl.canvas.clientWidth,gl.canvas.clientHeight);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
        }
        this.sortingMaskPass(gl);
        this.scanMaskPass(gl);
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.dstFrameBuffer);
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

        gl.bindFramebuffer(gl.FRAMEBUFFER,this.dstFrameBuffer);

        gl.uniform1i(this.maskScanPass.getUniformLocation("uSampler"),1);

        gl.disable(gl.DEPTH_TEST);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
}