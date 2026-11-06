/** Optional WebGL2 point rasterizer. CPU providers/recipes remain the reference. */
const vertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec4 mark;
layout(location=1) in vec4 color;
uniform vec2 raster;
flat out vec4 bounds;
flat out vec4 tint;
void main(){
 const vec2 corners[6]=vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));
 vec2 low=floor(mark.xy-mark.zw), high=ceil(mark.xy+mark.zw)+1.0;
 vec2 pixel=mix(low,high,corners[gl_VertexID]);
 gl_Position=vec4(pixel.x/raster.x*2.0-1.0,1.0-pixel.y/raster.y*2.0,0,1);
 bounds=mark;tint=color;
}`;
const fragmentSource = `#version 300 es
precision highp float;
uniform vec2 raster;
uniform bool circle;
flat in vec4 bounds;
flat in vec4 tint;
out vec4 outputColor;
void main(){
 if(any(lessThanEqual(bounds.zw,vec2(0))))discard;
 vec2 pixel=floor(vec2(gl_FragCoord.x,raster.y-gl_FragCoord.y));
 float coverage=0.0;
 for(int probe=0;probe<4;probe++){
  vec2 sampleAt=vec2((probe&1)==0?0.25:0.75,(probe&2)==0?0.25:0.75);
  vec2 d=(pixel+sampleAt-bounds.xy)/bounds.zw;
  if(circle?dot(d,d)<=1.0:all(lessThanEqual(abs(d),vec2(1))))coverage+=1.0;
 }
 outputColor=vec4(tint.rgb,tint.a*coverage*0.25);
}`;

export class PointWebGL {
  constructor() {
    this.canvas =
      typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(1, 1)
        : document.createElement("canvas");
    const gl = (this.gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    }));
    if (!gl) throw Error("WebGL2 unavailable");
    const shaders = [];
    try {
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw Error(gl.getShaderInfoLog(shader));
        return shader;
      };
      this.program = gl.createProgram();
      gl.attachShader(this.program, compile(gl.VERTEX_SHADER, vertexSource));
      gl.attachShader(
        this.program,
        compile(gl.FRAGMENT_SHADER, fragmentSource),
      );
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
        throw Error(gl.getProgramInfoLog(this.program));
      this.buffer = gl.createBuffer();
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      for (let slot = 0; slot < 2; slot++) {
        gl.enableVertexAttribArray(slot);
        gl.vertexAttribPointer(slot, 4, gl.FLOAT, false, 32, slot * 16);
        gl.vertexAttribDivisor(slot, 1);
      }
      this.raster = gl.getUniformLocation(this.program, "raster");
      this.circle = gl.getUniformLocation(this.program, "circle");
      this.maximum = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      this.canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        this.lost = true;
      });
    } catch (error) {
      this.dispose();
      throw error;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }

  draw(
    context,
    prepared,
    projected,
    order,
    { width, height, spatial, cellWidth, cellHeight, state },
  ) {
    const gl = this.gl;
    if (
      this.lost ||
      gl.isContextLost() ||
      width > this.maximum[0] ||
      height > this.maximum[1]
    )
      return false;
    const required = prepared.size * 8;
    if (!this.instances || this.instances.length < required)
      this.instances = new Float32Array(
        Math.max(256, 2 ** Math.ceil(Math.log2(Math.max(1, required)))),
      );
    const instances = this.instances;
    const upload =
      !state ||
      this.uploadedPrepared !== prepared ||
      this.uploadedProjection !== state;
    if (upload)
      for (let n = 0; n < prepared.size; n++) {
        const i = order ? order[n] : n,
          q = i * 4,
          p = n * 8;
        instances[p] = projected[q];
        instances[p + 1] = projected[q + 1];
        instances[p + 2] =
          (spatial ? projected[q + 3] : cellWidth / 2) * prepared.sizes[i];
        instances[p + 3] =
          (spatial ? projected[q + 3] : cellHeight / 2) * prepared.sizes[i];
        for (let c = 0; c < 4; c++)
          instances[p + 4 + c] = prepared.colors[q + c] / 255;
      }
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DITHER);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if (upload) {
      gl.bufferData(
        gl.ARRAY_BUFFER,
        instances.subarray(0, required),
        gl.DYNAMIC_DRAW,
      );
      this.uploadedPrepared = prepared;
      this.uploadedProjection = state;
      this.uploads = (this.uploads || 0) + 1;
      this.uploadBytes = (this.uploadBytes || 0) + required * 4;
    }
    gl.uniform2f(this.raster, width, height);
    gl.uniform1i(this.circle, prepared.shape === "circle" ? 1 : 0);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, prepared.size);
    if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) return false;
    context.clearRect(0, 0, width, height);
    context.drawImage(this.canvas, 0, 0);
    return true;
  }

  dispose() {
    const gl = this.gl;
    if (!gl) return;
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.program) gl.deleteProgram(this.program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.lost = true;
  }
}

export function paintWebGL(
  cache,
  context,
  prepared,
  projected,
  order,
  options,
) {
  if (cache.pointGPU === false) return false;
  try {
    const gpu = cache.pointGPU || (cache.pointGPU = new PointWebGL());
    if (gpu.draw(context, prepared, projected, order, options)) return true;
    gpu.dispose();
  } catch {
    cache.pointGPU?.dispose?.();
  }
  cache.pointGPU = false;
  return false;
}
