export class ShaderProgram{
    /**
     * 
     * @param {WebGL2RenderingContext} gl 
     * @param {String} vertexSrc 
     * @param {String} fragmentSrc 
     */
    constructor(gl,vertexSrc,fragmentSrc){
        if(!(gl instanceof WebGL2RenderingContext))throw new Error("invald argument 0 gl should be type: WebGl2RenderingContext");
        this.gl = gl;
        this.vertexShader = this.compile(vertexSrc,gl.VERTEX_SHADER);
        this.fragmentShader = this.compile(fragmentSrc,gl.FRAGMENT_SHADER);
        this.program = this.linkProgram(this.vertexShader,this.fragmentShader);
    }
    compile(src,type){
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader,src);
        this.gl.compileShader(shader);
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('ERROR compiling shader!'+ this.gl.getShaderInfoLog(shader));
            return;
        }
        return shader;
    }
    /**
     * 
     * @param {WebGL2RenderingContext} this.gl 
     * @param {WebGLShader} vertex 
     * @param {WebGLShader} fragment 
     * @returns 
     */
    linkProgram(vertex,fragment){
        var program = this.gl.createProgram();
        this.gl.attachShader(program, vertex);
        this.gl.attachShader(program, fragment);
        this.gl.linkProgram(program);
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error('ERROR linking program!' + this.gl.getProgramInfoLog(program));
            return;
        }
        this.gl.validateProgram(program);
        if (!this.gl.getProgramParameter(program, this.gl.VALIDATE_STATUS)) {
            console.error('ERROR validating program!' + this.gl.getProgramInfoLog(program));
            return;
        }
        return program;
    }
    /**
     * 
     * @param {WebGL2RenderingContext} this.gl 
     * @param {WebGLProgram} program 
     * @param {String} name 
     */
    getAttributeLocation(name){
        let attributeLocation = this.gl.getAttribLocation(this.program,name);
        if(attributeLocation===null){
            console.error("Failed to get attribute location for "+name);
        }
        return attributeLocation;
    }
    /**
     * 
     * @param {WebGL2RenderingContext} this.gl 
     * @param {WebGLProgram} program 
     * @param {String} name 
     */
    getUniformLocation(name){
        let uniformLocation = this.gl.getUniformLocation(this.program,name);
        if(uniformLocation===null){
            console.error("Failed to get uniform location for "+name);
        }
        return uniformLocation;
    }
    use(){
        this.gl.useProgram(this.program);
    }
}