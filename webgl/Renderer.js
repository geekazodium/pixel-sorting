export class Renderer{
    constructor(gl){

    }
    /**
     * 
     * @param {WebGL2RenderingContext} gl 
     * @param {Number} deltaTime 
     */
    render(gl, camera, deltaTime){
        throw new Error("method not implemented!");
    }
    writeTexture(gl, src){
        throw new Error("method not implemented!");
    }
}