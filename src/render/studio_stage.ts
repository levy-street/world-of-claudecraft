import * as THREE from 'three';
import { groundHeight } from '../sim/world';
import { surfaceMat } from './gfx';
import type { Renderer } from './renderer';

export type StudioLighting = 'neutral' | 'bright' | 'dark';
type StageHost = {
  scene: Renderer['scene'];
  webgl: Renderer['webgl'];
  sim: Renderer['sim'];
  sun: Renderer['sun'];
  hemi: Renderer['hemi'];
  sunDir: Renderer['sunDir'];
  updateKeyLight: Renderer['updateKeyLight'];
};

/** Small terrain-faithful stage, lit by the production renderer's existing rig. */
export class StudioStage {
  readonly floor: THREE.Mesh;
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly host: StageHost;
  private readonly anchor = new THREE.Vector3();
  constructor(owner: object) {
    this.host = owner as StageHost;
    const { sim, scene, webgl } = this.host;
    const center = sim.player.pos;
    const geometry = new THREE.PlaneGeometry(160, 160, 128, 128);
    geometry.rotateX(-Math.PI / 2);
    const vertices = geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) {
      const x = center.x + vertices.getX(i),
        z = center.z + vertices.getZ(i);
      vertices.setXYZ(i, x, groundHeight(x, z, sim.cfg.seed) - 0.025, z);
    }
    geometry.computeVertexNormals();
    this.floor = new THREE.Mesh(geometry, surfaceMat({ color: 0x36414b, roughness: 0.84 }));
    this.floor.name = 'VFX review floor';
    this.floor.receiveShadow = true;
    scene.add(this.floor);

    // A bounded HDR softbox environment: actual specular reflections on armour,
    // with no world HDRIs, skyline meshes or additional runtime light variants.
    const width = 256,
      height = 128;
    const pixels = new Float32Array(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const u = x / width,
          v = y / height;
        const key = Math.exp(-((u - 0.23) ** 2 / 0.006 + (v - 0.3) ** 2 / 0.018)) * 5;
        const rim = Math.exp(-((u - 0.72) ** 2 / 0.003 + (v - 0.43) ** 2 / 0.06)) * 3;
        const base = 0.08 + Math.max(0, 0.7 - v) * 0.4;
        const i = (y * width + x) * 4;
        pixels[i] = base + key + rim * 0.65;
        pixels[i + 1] = base + key * 0.92 + rim * 0.82;
        pixels[i + 2] = base + key * 0.82 + rim;
        pixels[i + 3] = 1;
      }
    const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.needsUpdate = true;
    const generator = new THREE.PMREMGenerator(webgl);
    try {
      this.environment = generator.fromEquirectangular(texture);
    } finally {
      texture.dispose();
      generator.dispose();
    }
    scene.environment = this.environment.texture;
    this.light('neutral');
  }
  light(mode: StudioLighting): void {
    const { scene, sun, hemi, sunDir } = this.host;
    const bright = mode === 'bright',
      dark = mode === 'dark';
    const background = bright ? 0x9aa7b4 : dark ? 0x080e18 : 0x26313f;
    scene.background = new THREE.Color(background);
    scene.fog = new THREE.Fog(background, 48, 100);
    scene.environmentIntensity = dark ? 0.35 : bright ? 1.1 : 0.7;
    sun.color.set(0xffecd6);
    sun.intensity = dark ? 0.85 : bright ? 3.4 : 2.5;
    hemi.color.set(0xd6e8ff);
    hemi.groundColor.set(0x35303a);
    hemi.intensity = dark ? 0.28 : bright ? 1.5 : 0.8;
    sunDir.set(-0.5, 0.72, -0.48).normalize();
    this.update();
  }
  update(): void {
    const position = this.host.sim.player.pos;
    this.anchor.set(position.x, position.y, position.z);
    this.host.updateKeyLight(this.anchor);
  }
  dispose(): void {
    this.floor.removeFromParent();
    this.floor.geometry.dispose();
    this.environment.dispose();
  }
}

const STAGE_PREWARM = new Set([
  'views.required',
  'views.nearby',
  'entities.character-effect-variants',
  'world.settle-state',
  'post.initial-frame',
  'programs.compile-submit',
  'surface-detail.textures',
  'textures.scene',
  'vfx.atlas',
  'vfx.active-local-kit',
  'vfx.ability-primitives',
  'world.initial-frame',
  'programs.compile',
  'programs.budget-variants',
  'render.settle-passes',
  'diagnostics.baseline',
]);
export function studioPrewarmEntry(id: string): boolean {
  return STAGE_PREWARM.has(id);
}
