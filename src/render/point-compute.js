/** Optional WebGL2 transform-feedback execution. CPU consumers retain exact ownership of outputs. */
import { emitRecipeShader } from "../recipes/recipe-shaders.js";
import { factorCount } from "../recipes/factor-catalog.js";

const fragment = `#version 300 es
precision highp float;
out vec4 color;
void main(){color=vec4(0);}`;

export class PointCompute {
  constructor() {
    this.canvas =
      typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(1, 1)
        : document.createElement("canvas");
    this.gl = this.canvas.getContext("webgl2", { antialias: false });
    if (!this.gl) throw new Error("WebGL2 compute unavailable");
    this.programs = new Map();
    this.textures = [];
    this.uploadedProviders = [];
    this.buffers = [];
    this.uploadBytes = 0;
    this.readbackBytes = 0;
    this.recipeDispatches = this.projectionDispatches = 0;
    this.scratch = {};
  }
  program(key, vertex, outputs) {
    if (this.programs.has(key)) return this.programs.get(key);
    const gl = this.gl;
    const shaders = [];
    const program = gl.createProgram();
    try {
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vertex],
        [gl.FRAGMENT_SHADER, fragment],
      ]) {
        const shader = gl.createShader(type);
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader);
      }
      gl.transformFeedbackVaryings(program, outputs, gl.INTERLEAVED_ATTRIBS);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program));
      this.programs.set(key, program);
      if (this.programs.size > 8) {
        const oldest = this.programs.keys().next().value;
        gl.deleteProgram(this.programs.get(oldest));
        this.programs.delete(oldest);
      }
      return program;
    } catch (error) {
      gl.deleteProgram(program);
      throw error;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }
  buffer(slot, data, integer = false, components = 4, stride = 0, offset = 0) {
    const gl = this.gl;
    const buffer = (this.buffers[slot] ||= gl.createBuffer());
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    this.uploadBytes += data.byteLength;
    gl.enableVertexAttribArray(slot);
    if (integer)
      gl.vertexAttribIPointer(slot, components, gl.INT, stride, offset);
    else
      gl.vertexAttribPointer(slot, components, gl.FLOAT, false, stride, offset);
  }
  run(program, count, components) {
    const gl = this.gl;
    this.output ||= gl.createBuffer();
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, this.output);
    if ((this.outputBytes || 0) < count * components * 4) {
      this.outputBytes = count * components * 4;
      gl.bufferData(
        gl.TRANSFORM_FEEDBACK_BUFFER,
        this.outputBytes,
        gl.STREAM_READ,
      );
    }
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.output);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    if (!this.scratch.output || this.scratch.output.length < count * components)
      this.scratch.output = new Float32Array(count * components);
    const result = this.scratch.output.subarray(0, count * components);
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, result);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR)
      throw new Error("GPU compute failed");
    this.readbackBytes += result.byteLength;
    return result;
  }
  project(prepared, job, options) {
    const gl = this.gl;
    const program = this.program(
      "projection",
      `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
uniform vec4 camera;
uniform vec2 raster;
uniform vec3 footprint;
out vec4 projected;
void main(){
 float rx=position.x*camera.x+position.z*camera.y;
 float rz=position.z*camera.x-position.x*camera.y;
 float ry=position.y*camera.z-rz*camera.w;
 float depth=position.y*camera.w+rz*camera.z;
 float divisor=3.5-depth;
 float focal=max(0.0,min(raster.x-1.0,raster.y-1.0))*0.8;
 float radius=(footprint.x>0.5?max((1.5*3.5)/divisor*footprint.y,2.0*focal/divisor*footprint.z):(1.5*3.5)/divisor*footprint.y)*0.5;
 projected=depth>=3.5?vec4(0,0,depth,0):vec4((raster.x-1.0)*0.5+rx*focal/divisor,(raster.y-1.0)*0.5-ry*focal/divisor,depth,radius);
 gl_Position=vec4(0);
}`,
      ["projected"],
    );
    gl.useProgram(program);
    for (let slot = 1; slot < 5; slot++) gl.disableVertexAttribArray(slot);
    this.positionBuffer ||= gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    if (this.uploadedGeometry !== prepared.geometry) {
      const positions = prepared.positions.subarray(0, prepared.size * 3);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
      this.uploadBytes += positions.byteLength;
      this.uploadedGeometry = prepared.geometry;
    }
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const { yaw, pitch } = job.rotation || { yaw: -0.6, pitch: 0.45 };
    gl.uniform4f(
      gl.getUniformLocation(program, "camera"),
      Math.cos(yaw),
      Math.sin(yaw),
      Math.cos(pitch),
      Math.sin(pitch),
    );
    gl.uniform2f(
      gl.getUniformLocation(program, "raster"),
      job.columns,
      job.rows,
    );
    gl.uniform3f(
      gl.getUniformLocation(program, "footprint"),
      options.grid ? 1 : 0,
      job.pointScale || 1,
      options.cellSpan,
    );
    this.projectionDispatches++;
    return this.run(program, prepared.size, 4);
  }
  evaluate(program, visit, job) {
    const gl = this.gl;
    const emitted = emitRecipeShader(program);
    const names = Object.keys(program.outputs);
    if (names.length > 8 || job.length > 0x7fffffff || visit.count > 0x7fffffff)
      return null;
    if (
      program.nodes.some(
        (node) =>
          node.type === "index" &&
          ["add", "subtract", "multiply"].includes(node.op),
      )
    )
      return null;
    const providers = [];
    for (const binding of emitted.bindings) {
      let values;
      if (binding.kind === "byte") values = visit.provenance.bytes;
      else if (binding.kind === "entropy")
        values = visit.entropies?.get(binding.window);
      else if (binding.kind === "spectrum") {
        const name = {
          phase: "phases",
          amplitude: "amplitudes",
          real: "real",
          imaginary: "imaginary",
        }[binding.component];
        values = visit.provenance.spectrum?.[name];
      }
      if (!values) return null;
      providers.push({ ...binding, values });
    }
    if (providers.length > gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS))
      return null;
    const maximum = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const inputBytes = visit.count * (factorCount * 4 + 8 + 32);
    const providerBytes = providers.reduce(
      (sum, provider) => sum + provider.values.length * 4,
      0,
    );
    if (
      inputBytes + providerBytes >
      Math.min(job.configuration.providerBudget ?? Infinity, 64 * 1048576)
    )
      return null;
    if (
      providers.some((provider) => provider.values.length > maximum * maximum)
    )
      return null;
    const declarations = providers
      .map(
        (provider, index) => `uniform highp sampler2D provider${index};
uniform int width${index};
float ${provider.name}(int index){if(index<0||index>=${provider.values.length})return 0.0;return texelFetch(provider${index},ivec2(index%width${index},index/width${index}),0).r;}`,
      )
      .join("\n");
    const vertex = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec4 factors0;
layout(location=1) in vec4 factors1;
layout(location=2) in vec4 factors2;
layout(location=3) in vec4 factors3;
layout(location=4) in ivec2 indices;
uniform int selectionLength;
uniform int pointCount;
uniform vec2 grid;
out vec4 result0;
out vec4 result1;
${declarations}
${emitted.source}
void main(){
 float sourceFactors[16];
 ${Array.from({ length: 16 }, (_, i) => `sourceFactors[${i}]=factors${i >> 2}[${i & 3}];`).join("\n")}
 RecipeResult result=evaluateRecipes(sourceFactors,indices.x,selectionLength,grid,indices.y,pointCount);
 result0=vec4(${Array.from({ length: 4 }, (_, i) => (names[i] ? `result.${names[i]}` : "0.0")).join(",")});
 result1=vec4(${Array.from({ length: 4 }, (_, i) => (names[i + 4] ? `result.${names[i + 4]}` : "0.0")).join(",")});
 gl_Position=vec4(0);
}`;
    const shader = this.program(vertex, vertex, ["result0", "result1"]);
    if (!this.scratch.factors || this.scratch.factors.length < visit.count * 16)
      this.scratch.factors = new Float32Array(visit.count * 16);
    if (!this.scratch.indices || this.scratch.indices.length < visit.count * 2)
      this.scratch.indices = new Int32Array(visit.count * 2);
    const factors = this.scratch.factors.subarray(0, visit.count * 16);
    const indices = this.scratch.indices.subarray(0, visit.count * 2);
    const labels = job.shaders.some(
      (shader) => shader === "hex" || shader === "character",
    )
      ? []
      : null;
    let ordinal = 0,
      pointCount = 0;
    let valid = true;
    visit((values, label, context) => {
      if (
        context.offset > 0x7fffffff ||
        context.pointIndex > 0x7fffffff ||
        context.pointCount > 0x7fffffff
      )
        valid = false;
      factors.set(values.subarray(0, 16), ordinal * 16);
      indices[ordinal * 2] = context.offset;
      indices[ordinal * 2 + 1] = context.pointIndex;
      pointCount = context.pointCount;
      labels?.push(label);
      ordinal++;
    });
    if (!valid || ordinal !== visit.count) return null;
    gl.useProgram(shader);
    this.buffer(0, factors, false, 4, 64, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[0]);
    for (let slot = 1; slot < 4; slot++) {
      gl.enableVertexAttribArray(slot);
      gl.vertexAttribPointer(slot, 4, gl.FLOAT, false, 64, slot * 16);
    }
    this.buffer(4, indices, true, 2);
    providers.forEach((provider, index) => {
      const width = Math.min(maximum, Math.max(1, provider.values.length));
      const height = Math.max(1, Math.ceil(provider.values.length / width));
      const texture = (this.textures[index] ||= gl.createTexture());
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (this.uploadedProviders[index] !== provider.values) {
        const data = new Float32Array(width * height);
        data.set(provider.values);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.R32F,
          width,
          height,
          0,
          gl.RED,
          gl.FLOAT,
          data,
        );
        this.uploadBytes += data.byteLength;
        this.uploadedProviders[index] = provider.values;
      }
      gl.uniform1i(gl.getUniformLocation(shader, `provider${index}`), index);
      gl.uniform1i(gl.getUniformLocation(shader, `width${index}`), width);
    });
    gl.uniform1i(gl.getUniformLocation(shader, "selectionLength"), job.length);
    gl.uniform1i(gl.getUniformLocation(shader, "pointCount"), pointCount);
    gl.uniform2f(
      gl.getUniformLocation(shader, "grid"),
      visit.grid.columns,
      visit.grid.rows,
    );
    this.recipeDispatches++;
    const values = this.run(shader, visit.count, 8);

    return { values, names, labels };
  }
  releaseProviders() {
    for (const texture of this.textures)
      if (texture) this.gl.deleteTexture(texture);
    this.textures = [];
    this.uploadedProviders = [];
  }
  dispose() {
    const gl = this.gl;
    for (const program of this.programs.values()) gl.deleteProgram(program);
    for (const buffer of this.buffers) if (buffer) gl.deleteBuffer(buffer);
    for (const texture of this.textures) if (texture) gl.deleteTexture(texture);
    if (this.output) gl.deleteBuffer(this.output);
    if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
    this.uploadedGeometry = null;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.disposed = true;
    this.scratch = {};
    this.uploadedProviders = [];
    this.textures = [];
    this.buffers = [];
    this.programs.clear();
  }
}

export function pointCompute(cache, source) {
  if (cache.pointCompute === false) return null;
  if (
    cache.pointCompute?.disposed ||
    cache.pointCompute?.gl.isContextLost() ||
    cache.pointCompute?.failed
  ) {
    cache.pointCompute.dispose();
    cache.pointCompute = false;
    return null;
  }
  try {
    const compute = (cache.pointCompute ||= new PointCompute());
    if (source !== undefined && compute.source !== source) {
      compute.releaseProviders();
      compute.scratch = {};
      compute.uploadedGeometry = null;
      compute.source = source;
    }
    return compute;
  } catch {
    cache.pointCompute = false;
    return null;
  }
}
