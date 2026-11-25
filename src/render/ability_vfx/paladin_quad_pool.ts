import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { CrestPrewarm } from './crest_prewarm';

const CORNERS = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];
const ATTRIBUTES = ['position', 'aColor', 'aAlpha', 'aUv', 'aShape', 'aTime'] as const;

export interface PaladinQuadShader {
  /** GLSL helpers placed before main(). */
  helpers?: string;
  /**
   * GLSL body of main(). In scope: `p` (x -1..1 along the quad, y -1..1 across),
   * `r`, `a` (polar of p), `t` (the quad's time), `vColor`, `vShape`, `vUv`, the
   * constants HOT, PI and the helpers `sq` and `band`. It must set `mask` and
   * may change `color` (starts as vColor).
   */
  body: string;
  /** GLSL float expression in `aShape`: view-space distance (metres) the quad
   * is pulled toward the camera, so a body or the ground cannot swallow it. */
  pull?: string;
  /** Extra uniforms the fragment reads (e.g. the spec icon atlas). */
  uniforms?: Record<string, THREE.IUniform>;
}

/**
 * One pooled, prewarmed mesh of additive quads for a Paladin effect: the
 * buffers, upload and camera bookkeeping every authored Paladin pool repeats
 * (grace_hammer.ts, hushbrand.ts). An effect fills it each frame between
 * begin() and end() with quads, billboards, ground decals and beams, each
 * carrying a shape id and a time its fragment body branches on.
 */
export class PaladinQuadPool<K extends string> {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly preparation: CrestPrewarm<K>;
  /** Camera right (0..2), up (3..5) and forward (6..8), refreshed by begin(). */
  readonly cam = [1, 0, 0, 0, 1, 0, 0, 0, -1];
  /** Written into each vertex's aTime until changed. */
  time = 0;
  private readonly vertices: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly alphas: Float32Array;
  private readonly uvs: Float32Array;
  private readonly shapes: Float32Array;
  private readonly times: Float32Array;
  private vertex = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly kind: K,
    quads: number,
    shader: PaladinQuadShader,
    name: string = kind,
  ) {
    this.vertices = quads * 6;
    this.positions = new Float32Array(this.vertices * 3);
    this.colors = new Float32Array(this.vertices * 3);
    this.alphas = new Float32Array(this.vertices);
    this.uvs = new Float32Array(this.vertices * 2);
    this.shapes = new Float32Array(this.vertices);
    this.times = new Float32Array(this.vertices);
    const geometry = new THREE.BufferGeometry();
    for (const [attribute, array, size] of [
      ['position', this.positions, 3],
      ['aColor', this.colors, 3],
      ['aAlpha', this.alphas, 1],
      ['aUv', this.uvs, 2],
      ['aShape', this.shapes, 1],
      ['aTime', this.times, 1],
    ] as const)
      geometry.setAttribute(
        attribute,
        new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage),
      );
    const material = new THREE.ShaderMaterial({
      uniforms: shader.uniforms ?? {},
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: `
        attribute vec3 aColor; attribute float aAlpha, aShape, aTime; attribute vec2 aUv;
        varying vec3 vColor; varying float vAlpha, vShape, vTime; varying vec2 vUv;
        void main(){vColor=aColor;vAlpha=aAlpha;vShape=aShape;vTime=aTime;vUv=aUv;
          vec4 view=modelViewMatrix*vec4(position,1.0);
          float pull=${shader.pull ?? '0.0'};
          view.xyz*=max(0.05,1.0-pull/max(length(view.xyz),0.001));
          gl_Position=projectionMatrix*view;}
      `,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha, vShape, vTime; varying vec2 vUv;
        const vec3 HOT=vec3(1.0,0.93,0.76);
        const float PI=3.14159265;
        float sq(float x){return x*x;}
        float band(float r,float at,float w){return exp(-sq((r-at)/w));}
        ${shader.helpers ?? ''}
        void main(){
          float t=vTime;
          vec2 p=vec2(vUv.x*2.0-1.0,vUv.y);
          float r=length(p);
          float a=atan(p.y,p.x);
          float mask=0.0;
          vec3 color=vColor;
          ${shader.body}
          float opacity=vAlpha*mask;
          if(!(opacity>=0.003)) discard;
          gl_FragColor=vec4(color,opacity);
          #include <colorspace_fragment>
        }
      `,
    });
    material.name = `paladin_quad_pool:${kind}`;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = name;
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = floorVfxRenderOrder('player', 1);
    scene.add(this.mesh);
    this.preparation = new CrestPrewarm(scene, new Map([[kind, geometry]]), material);
  }

  ready(): boolean {
    return !this.disposed && this.preparation.ready(this.kind);
  }

  /** Start a frame: forget last frame's quads and read the camera's axes. */
  begin(camera?: THREE.Camera): void {
    this.vertex = 0;
    const e = camera?.matrixWorld.elements;
    if (!e) return;
    const c = this.cam;
    c[0] = e[0];
    c[1] = e[1];
    c[2] = e[2];
    c[3] = e[4];
    c[4] = e[5];
    c[5] = e[6];
    c[6] = -e[8];
    c[7] = -e[9];
    c[8] = -e[10];
  }

  /** A quad about a centre: uv.x runs along `a` (0 at -a, 1 at +a), uv.y along `b`. */
  quad(
    x: number,
    y: number,
    z: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    color: THREE.Color,
    alpha: number,
    shape: number,
  ): void {
    if (!(alpha > 0.002) || this.vertex + 6 > this.vertices) return;
    for (let k = 0; k < 6; k++) {
      const u = CORNERS[k * 2],
        side = CORNERS[k * 2 + 1],
        along = u * 2 - 1;
      const i = this.vertex++;
      this.positions[i * 3] = x + ax * along + bx * side;
      this.positions[i * 3 + 1] = y + ay * along + by * side;
      this.positions[i * 3 + 2] = z + az * along + bz * side;
      this.colors[i * 3] = color.r;
      this.colors[i * 3 + 1] = color.g;
      this.colors[i * 3 + 2] = color.b;
      this.alphas[i] = Math.max(0, alpha);
      this.uvs[i * 2] = u;
      this.uvs[i * 2 + 1] = side;
      this.shapes[i] = shape;
      this.times[i] = this.time;
    }
  }

  /**
   * A strip from `a` to `b` whose edges lie `±across` from each end, set
   * separately so strips laid end to end share their edges and bend or twist
   * as one ribbon: uv.x runs 0 at `a` to 1 at `b`, uv.y -1 to 1 across.
   */
  strip(
    a: THREE.Vector3,
    acrossA: THREE.Vector3,
    b: THREE.Vector3,
    acrossB: THREE.Vector3,
    color: THREE.Color,
    alphaA: number,
    alphaB: number,
    shape: number,
  ): void {
    if (!(Math.max(alphaA, alphaB) > 0.002) || this.vertex + 6 > this.vertices) return;
    for (let k = 0; k < 6; k++) {
      const u = CORNERS[k * 2],
        side = CORNERS[k * 2 + 1];
      const end = u ? b : a,
        across = u ? acrossB : acrossA;
      const i = this.vertex++;
      this.positions[i * 3] = end.x + across.x * side;
      this.positions[i * 3 + 1] = end.y + across.y * side;
      this.positions[i * 3 + 2] = end.z + across.z * side;
      this.colors[i * 3] = color.r;
      this.colors[i * 3 + 1] = color.g;
      this.colors[i * 3 + 2] = color.b;
      this.alphas[i] = Math.max(0, u ? alphaB : alphaA);
      this.uvs[i * 2] = u;
      this.uvs[i * 2 + 1] = side;
      this.shapes[i] = shape;
      this.times[i] = this.time;
    }
  }

  /** A camera-facing square of half-size `size`, turned by `spin`. */
  billboard(
    x: number,
    y: number,
    z: number,
    size: number,
    color: THREE.Color,
    alpha: number,
    shape: number,
    spin = 0,
  ): void {
    const c = this.cam;
    const cs = Math.cos(spin) * size,
      sn = Math.sin(spin) * size;
    this.quad(
      x,
      y,
      z,
      c[0] * cs + c[3] * sn,
      c[1] * cs + c[4] * sn,
      c[2] * cs + c[5] * sn,
      c[3] * cs - c[0] * sn,
      c[4] * cs - c[1] * sn,
      c[5] * cs - c[2] * sn,
      color,
      alpha,
      shape,
    );
  }

  /** A square lying flat on the ground, half-size `size`, turned by `spin`. */
  ground(
    x: number,
    y: number,
    z: number,
    size: number,
    color: THREE.Color,
    alpha: number,
    shape: number,
    spin = 0,
  ): void {
    const cs = Math.cos(spin) * size,
      sn = Math.sin(spin) * size;
    this.quad(x, y, z, cs, 0, sn, -sn, 0, cs, color, alpha, shape);
  }

  /** An upright square facing the camera about the vertical axis only. */
  upright(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    color: THREE.Color,
    alpha: number,
    shape: number,
  ): void {
    const c = this.cam;
    const l = Math.hypot(c[0], c[2]) || 1;
    // uv.x runs up the quad, uv.y across.
    this.quad(
      x,
      y,
      z,
      0,
      height,
      0,
      (c[0] / l) * width,
      0,
      (c[2] / l) * width,
      color,
      alpha,
      shape,
    );
  }

  /**
   * A beam from one point to another, `width` half-wide across the view:
   * uv.x runs 0 at `from` to 1 at `to`.
   */
  beam(
    fx: number,
    fy: number,
    fz: number,
    tx: number,
    ty: number,
    tz: number,
    width: number,
    color: THREE.Color,
    alpha: number,
    shape: number,
  ): void {
    const c = this.cam;
    const dx = (tx - fx) / 2,
      dy = (ty - fy) / 2,
      dz = (tz - fz) / 2;
    // Across: perpendicular to both the beam and the view direction.
    let px = dy * c[8] - dz * c[7],
      py = dz * c[6] - dx * c[8],
      pz = dx * c[7] - dy * c[6];
    const pl = Math.hypot(px, py, pz);
    if (pl < 1e-6) {
      px = c[0];
      py = c[1];
      pz = c[2];
    } else {
      px /= pl;
      py /= pl;
      pz /= pl;
    }
    this.quad(
      fx + dx,
      fy + dy,
      fz + dz,
      dx,
      dy,
      dz,
      px * width,
      py * width,
      pz * width,
      color,
      alpha,
      shape,
    );
  }

  /** Finish a frame: upload what was drawn and show the mesh if anything was. */
  end(): void {
    const geometry = this.mesh.geometry;
    for (const attribute of ATTRIBUTES) {
      const a = geometry.getAttribute(attribute) as THREE.BufferAttribute;
      a.clearUpdateRanges();
      if (this.vertex) {
        a.addUpdateRange(0, this.vertex * a.itemSize);
        a.needsUpdate = true;
      }
    }
    // A held piece re-checks its preparation every frame: after a context
    // restore its programs belong to the lost context until the kit recipe
    // runs again, so nothing draws until it has.
    const ready = this.ready();
    geometry.setDrawRange(0, ready ? this.vertex : 0);
    this.mesh.visible = ready && this.vertex > 0;
  }

  clear(): void {
    this.vertex = 0;
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    const errors: unknown[] = [];
    for (const release of [
      () => this.preparation.dispose(),
      () => this.mesh.removeFromParent(),
      () => this.mesh.geometry.dispose(),
      () => this.mesh.material.dispose(),
    ]) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, `${this.mesh.name} cleanup failed`);
  }
}

/** Smoothstep of t between from and to. */
export function ramp(t: number, from: number, to: number): number {
  const x = Math.min(1, Math.max(0, (t - from) / (to - from)));
  return x * x * (3 - 2 * x);
}

/** A stable pseudo-random 0..1 for index i and a salt. */
export function hash01(i: number, salt: number): number {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
