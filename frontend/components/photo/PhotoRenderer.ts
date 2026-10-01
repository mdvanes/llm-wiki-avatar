import type { FacePose } from '@/lib/cartoon/face';
import type { MouthPose } from '@/lib/cartoon/mouth';
import { type PhotoMesh, deform, headMotion, mouthStrip, photoControls } from '@/lib/photo/mesh';

const FACE_VS = `
attribute vec2 aPos;
attribute vec2 aUv;
uniform vec4 uView;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos * uView.xy + uView.zw, 0.0, 1.0);
}`;

const FACE_FS = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTex, vUv);
}`;

const MOUTH_VS = `
attribute vec2 aPos;
attribute float aSide;
uniform vec4 uView;
varying float vSide;
void main() {
  vSide = aSide;
  gl_Position = vec4(aPos * uView.xy + uView.zw, 0.0, 1.0);
}`;

// Inside the mouth: upper teeth under the upper lip, the tongue at the bottom, and a dark throat in between.
const MOUTH_FS = `
precision mediump float;
uniform float uTeeth;
uniform float uTongue;
varying float vSide;
void main() {
  vec3 throat = mix(vec3(0.20, 0.06, 0.07), vec3(0.30, 0.10, 0.11), smoothstep(0.2, 1.0, vSide));
  vec3 tongue = vec3(0.70, 0.36, 0.37);
  vec3 teeth = mix(vec3(0.62, 0.56, 0.52), vec3(0.88, 0.84, 0.78), smoothstep(0.0, 0.35 * uTeeth, vSide));
  teeth = mix(teeth, vec3(0.70, 0.64, 0.60), smoothstep(0.5 * uTeeth, uTeeth, vSide));
  vec3 c = mix(throat, tongue, smoothstep(1.0 - uTongue - 0.05, 1.0 - uTongue + 0.05, vSide) * step(0.01, uTongue));
  c = mix(teeth, c, smoothstep(uTeeth - 0.04, uTeeth + 0.04, vSide));
  // The lips shade the edges of the opening.
  c *= 0.55 + 0.45 * smoothstep(0.0, 0.08, vSide) * smoothstep(1.0, 0.85, vSide);
  gl_FragColor = vec4(c, 1.0);
}`;

type GL = WebGLRenderingContext | WebGL2RenderingContext;

function program(gl: GL, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram();
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type);
    if (!s) throw new Error('WebGL shader unavailable');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
  return p;
}

/** Draws a PhotoMesh on a canvas with WebGL; the constructor throws if WebGL is not available. */
export class PhotoRenderer {
  readonly #gl: GL;
  readonly #canvas: HTMLCanvasElement;
  readonly #mesh: PhotoMesh;
  readonly #positions: Float32Array<ArrayBuffer>;
  readonly #face: WebGLProgram;
  readonly #mouth: WebGLProgram;
  readonly #posBuffer: WebGLBuffer;
  readonly #uvBuffer: WebGLBuffer;
  readonly #sideBuffer: WebGLBuffer;
  readonly #faceIdx: WebGLBuffer;
  readonly #mouthIdx: WebGLBuffer;
  readonly #faceCount: number;
  readonly #mouthCount: number;
  readonly #upperMid: number;
  readonly #lowerMid: number;
  readonly #bgPos: WebGLBuffer;
  readonly #bgUv: WebGLBuffer;
  readonly #hasBackground: boolean;
  #texture: WebGLTexture | null = null;
  #bgTexture: WebGLTexture | null = null;
  #disposed = false;

  /**
   * `imageUrl` is the subject, drawn on the mesh. The optional `backgroundUrl` is a still backdrop of the same size;
   * with it the photo covers the whole canvas, otherwise it is fitted inside.
   */
  constructor(canvas: HTMLCanvasElement, mesh: PhotoMesh, imageUrl: string, backgroundUrl?: string) {
    const opts: WebGLContextAttributes = {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    };
    const gl = (canvas.getContext('webgl2', opts) ?? canvas.getContext('webgl', opts)) as GL | null;
    if (!gl) throw new Error('WebGL unavailable');
    this.#gl = gl;
    this.#canvas = canvas;
    this.#mesh = mesh;
    this.#positions = new Float32Array(mesh.vertices.length);
    this.#face = program(gl, FACE_VS, FACE_FS);
    this.#mouth = program(gl, MOUTH_VS, MOUTH_FS);

    const [w, h] = mesh.size;
    const uv = new Float32Array(mesh.vertices.length);
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] = mesh.vertices[i] / w;
      uv[i + 1] = mesh.vertices[i + 1] / h;
    }
    const strip = mouthStrip(mesh);
    const side = new Float32Array(mesh.vertices.length / 2);
    for (const [i, s] of strip.side) side[i] = s;
    const buffer = (target: number, data: BufferSource, usage: number) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, usage);
      return b;
    };
    this.#posBuffer = buffer(gl.ARRAY_BUFFER, this.#positions, gl.DYNAMIC_DRAW);
    this.#uvBuffer = buffer(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    this.#sideBuffer = buffer(gl.ARRAY_BUFFER, side, gl.STATIC_DRAW);
    this.#faceIdx = buffer(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.triangles), gl.STATIC_DRAW);
    this.#mouthIdx = buffer(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(strip.indices), gl.STATIC_DRAW);
    this.#bgPos = buffer(gl.ARRAY_BUFFER, new Float32Array([0, 0, w, 0, 0, h, w, h]), gl.STATIC_DRAW);
    this.#bgUv = buffer(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.#hasBackground = Boolean(backgroundUrl);
    this.#faceCount = mesh.triangles.length;
    this.#mouthCount = strip.indices.length;
    const mid = Math.floor(mesh.mouth.upper.length / 2);
    this.#upperMid = mesh.mouth.upper[mid];
    this.#lowerMid = mesh.mouth.lower[mid];

    this.#load(imageUrl, (tex) => (this.#texture = tex));
    if (backgroundUrl) this.#load(backgroundUrl, (tex) => (this.#bgTexture = tex));
  }

  #load(url: string, done: (tex: WebGLTexture) => void): void {
    const gl = this.#gl;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (this.#disposed || gl.isContextLost()) return;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // WebGL 1 cannot mipmap a texture whose size is not a power of two.
      if ('texStorage2D' in gl) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      done(tex);
    };
    img.src = url;
  }

  /** Draws one frame; nothing shows until the photo has loaded. */
  draw(pose: FacePose, mouth: MouthPose): void {
    const gl = this.#gl;
    const canvas = this.#canvas;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.#texture || (this.#hasBackground && !this.#bgTexture) || this.#disposed) return;

    const mesh = this.#mesh;
    const pos = deform(
      mesh,
      photoControls(pose, mouth, mesh.mouthWidth),
      headMotion(pose, mesh.mouthWidth),
      this.#positions,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#posBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);

    const [w, h] = mesh.size;
    let scale: number;
    let offX: number;
    let offY: number;
    if (this.#hasBackground) {
      // Cover the canvas, keeping the face centred as far as the photo allows.
      scale = Math.max(cw / w, ch / h);
      offX = Math.min(0, Math.max(cw - w * scale, cw / 2 - mesh.focus[0] * scale));
      offY = Math.min(0, Math.max(ch - h * scale, 0.45 * ch - mesh.focus[1] * scale));
    } else {
      // Fit the photo inside the canvas, standing on its bottom edge.
      scale = Math.min(cw / w, ch / h);
      offX = (cw - w * scale) / 2;
      offY = ch - h * scale;
    }
    const view = [(2 * scale) / cw, (-2 * scale) / ch, (2 * offX) / cw - 1, 1 - (2 * offY) / ch] as const;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);

    if (this.#bgTexture) {
      gl.useProgram(this.#face);
      gl.uniform4f(gl.getUniformLocation(this.#face, 'uView'), ...view);
      gl.bindTexture(gl.TEXTURE_2D, this.#bgTexture);
      gl.uniform1i(gl.getUniformLocation(this.#face, 'uTex'), 0);
      this.#attrib(this.#face, 'aPos', this.#bgPos, 2);
      const loc = this.#attrib(this.#face, 'aUv', this.#bgUv, 2);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(loc);
    }

    // The inside of the mouth first; the face mesh has a hole there.
    const gap = Math.hypot(
      pos[2 * this.#lowerMid] - pos[2 * this.#upperMid],
      pos[2 * this.#lowerMid + 1] - pos[2 * this.#upperMid + 1],
    );
    if (gap > 0.5) {
      const teethPx = mesh.mouthWidth * 0.1 * (0.3 + 0.7 * mouth.teeth);
      gl.useProgram(this.#mouth);
      gl.uniform4f(gl.getUniformLocation(this.#mouth, 'uView'), ...view);
      // Lips that are only just apart show a dark line, not teeth.
      const showTeeth = Math.min(1, Math.max(0, (gap - 2) / 6));
      gl.uniform1f(gl.getUniformLocation(this.#mouth, 'uTeeth'), showTeeth * Math.min(0.6, teethPx / gap));
      gl.uniform1f(gl.getUniformLocation(this.#mouth, 'uTongue'), 0.35 * Math.min(1, mouth.tongue + 0.4 * mouth.open));
      this.#attrib(this.#mouth, 'aPos', this.#posBuffer, 2);
      const sideLoc = this.#attrib(this.#mouth, 'aSide', this.#sideBuffer, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#mouthIdx);
      gl.drawElements(gl.TRIANGLES, this.#mouthCount, gl.UNSIGNED_SHORT, 0);
      gl.disableVertexAttribArray(sideLoc);
    }

    gl.useProgram(this.#face);
    gl.uniform4f(gl.getUniformLocation(this.#face, 'uView'), ...view);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.uniform1i(gl.getUniformLocation(this.#face, 'uTex'), 0);
    this.#attrib(this.#face, 'aPos', this.#posBuffer, 2);
    const uvLoc = this.#attrib(this.#face, 'aUv', this.#uvBuffer, 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#faceIdx);
    gl.drawElements(gl.TRIANGLES, this.#faceCount, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(uvLoc);
  }

  #attrib(p: WebGLProgram, name: string, buffer: WebGLBuffer, size: number): number {
    const gl = this.#gl;
    const loc = gl.getAttribLocation(p, name);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    return loc;
  }

  /** Frees the GPU resources; the canvas can get a new renderer afterwards. */
  dispose(): void {
    const gl = this.#gl;
    this.#disposed = true;
    for (const b of [
      this.#posBuffer,
      this.#uvBuffer,
      this.#sideBuffer,
      this.#faceIdx,
      this.#mouthIdx,
      this.#bgPos,
      this.#bgUv,
    ])
      gl.deleteBuffer(b);
    gl.deleteProgram(this.#face);
    gl.deleteProgram(this.#mouth);
    gl.deleteTexture(this.#texture);
    gl.deleteTexture(this.#bgTexture);
    this.#texture = null;
    this.#bgTexture = null;
  }
}
