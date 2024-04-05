"use strict";

import { PostProcessSortingRenderer } from "./webgl/PostProcessSortingRenderer.js";

class Main{
    constructor(){
        this.lastTimeStamp = 0;
        this.resizeUpdateTimeout = undefined;
        document.addEventListener("DOMContentLoaded",()=>{this.init()});
        window.addEventListener("resize",()=>{
            if(this.resizeUpdateTimeout !== undefined){
                clearTimeout(this.resizeUpdateTimeout);
            }
            this.resizeUpdateTimeout = setTimeout(() => {
                this.updateViewportSize(this.gl);
                this.resizeUpdateTimeout = undefined;
            }, 100);
        });
    }
    async init(){
        this.lastTimeStamp = performance.now();
        //TODO: add typecheck to ensure webgl2 is available
        /**@type {WebGL2RenderingContext} */
        this.gl = document.getElementById("main-canvas").getContext("webgl2");
        await this.initRenderer();
        this.requestNextFrame();
    }
    async initRenderer(){
        const gl = this.gl;
        //init framebuffer
        this.srcFrameBufferTexture = gl.createTexture();
        this.updateViewportSize(gl);

        const texture = await new Promise((res,err)=>{
            const img = document.createElement("img");
            img.src = "./image.png";
            img.addEventListener("load",e=>{res(img)});
            img.addEventListener("error",e=>err(e));
        });
        gl.bindTexture(gl.TEXTURE_2D, this.srcFrameBufferTexture);
        console.log(texture.width);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,texture.width,texture.height,0,gl.RGBA,gl.UNSIGNED_BYTE,texture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);

        //init post
        this.postProcessSortingRenderer = new PostProcessSortingRenderer(gl,this.srcFrameBufferTexture,null);
    }
    /**
     *
     * @param {WebGL2RenderingContext} gl
     */
    updateViewportSize(gl) {
        const canvas = gl.canvas;
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;

        //set draw area
        gl.viewport(0,0,canvas.width,canvas.height);

        gl.bindTexture(gl.TEXTURE_2D, this.srcFrameBufferTexture);
        
        this.viewportScaleUpdated = true;
        //gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, gl.canvas.clientWidth, gl.canvas.clientHeight);
    }
    async update(){
        await this.render();
        if(this.viewportScaleUpdated === true){
            this.viewportScaleUpdated = false;
        }
        this.requestNextFrame();
    }
    async render(){
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        gl.clearColor(0,0,0,0);
        gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);

        await this.postProcessSortingRenderer.render(gl);
    }
    requestNextFrame(){
        requestAnimationFrame(t=>{this.update(t - this.lastTimeStamp);this.lastTimeStamp = t;});
    }
}

export const main = new Main();