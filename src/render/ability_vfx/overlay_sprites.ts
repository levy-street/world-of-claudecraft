import * as THREE from 'three';
import { type AbilityVfxTextures, OVERLAY_ATLAS_GRID } from './fx_textures';

// One pooled point cloud for every persistent overlay sprite (windup orbs,
// buff-orbit bands): positions are recomputed each frame by the owner, so this
// is an immediate-mode surface with a hard capacity. beginFrame() resets the
// cursor, push() writes the next point, commit() uploads once. One draw call
// for every orbiting sprite in the scene; zero allocation after construction.

const CAPACITY = 128;

export class OverlaySprites {
  private points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(CAPACITY * 3);
  private col = new Float32Array(CAPACITY * 3);
  private size = new Float32Array(CAPACITY);
  private cell = new Float32Array(CAPACITY);
  private alpha = new Float32Array(CAPACITY);
  private count = 0;
  private wasEmpty = true;
  private tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene, tex: AbilityVfxTextures) {
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setAttribute(
      'aColor',
      new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setAttribute(
      'aSize',
      new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setAttribute(
      'aCell',
      new THREE.BufferAttribute(this.cell, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setAttribute(
      'aAlpha',
      new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(450, 0, 0), 2400);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 600 }, uAtlas: { value: tex.overlay } },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aCell;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vCell;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = aColor;
          vCell = aCell;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * uScale / max(1.0, -mv.z), 0.0, 96.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uAtlas;
        varying vec3 vColor;
        varying float vCell;
        varying float vAlpha;
        void main() {
          float idx = floor(vCell + 0.5);
          vec2 cell = vec2(mod(idx, ${OVERLAY_ATLAS_GRID}.0), floor(idx / ${OVERLAY_ATLAS_GRID}.0));
          vec2 uv = (cell + gl_PointCoord) / ${OVERLAY_ATLAS_GRID}.0;
          uv.y = 1.0 - uv.y; // canvas row 0 is the visual top (the vfx.ts atlas idiom)
          vec4 tex = texture2D(uAtlas, uv);
          float lum = max(tex.r, max(tex.g, tex.b)) * tex.a;
          if (lum * vAlpha < 0.012) discard;
          gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    this.points.userData.renderCategory = 'vfx';
    scene.add(this.points);
  }

  setViewportScale(value: number): void {
    ((this.points.material as THREE.ShaderMaterial).uniforms.uScale as { value: number }).value =
      value;
  }

  beginFrame(): void {
    this.count = 0;
  }

  push(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    size: number,
    cell: number,
    alpha: number,
    brightness = 1,
  ): void {
    if (this.count >= CAPACITY) return;
    const i = this.count++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.tmpColor.setHex(colorHex).multiplyScalar(brightness);
    this.col[i * 3] = this.tmpColor.r;
    this.col[i * 3 + 1] = this.tmpColor.g;
    this.col[i * 3 + 2] = this.tmpColor.b;
    this.size[i] = size;
    this.cell[i] = cell;
    this.alpha[i] = alpha;
  }

  commit(): void {
    if (this.count === 0) {
      if (!this.wasEmpty) {
        this.wasEmpty = true;
        this.geo.setDrawRange(0, 0);
      }
      return;
    }
    this.wasEmpty = false;
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aCell as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    this.geo.setDrawRange(0, this.count);
  }
}
