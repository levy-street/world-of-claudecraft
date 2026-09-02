import * as THREE from 'three';
import { drapeFanLocalY, drapeStrideFor, fanVertexSpacing } from '../drape_lod_core';
import { drapedBoundingSphere, drapeExtent } from '../draped_bounds_core';
import { DRAPE_AXIS_Y, DRAPED_VERTEX_SHADER } from './draped_shader';
import type { AbilityVfxTextures } from './fx_textures';

// Fading ground decals (scorch embers, frost rime, arcane runes, earth
// cracks, charred sunbursts), ported from
// the gallery's dissolve decal shader (arc_bolt_preview.js, decals section):
// visible where noise > uDissolve, with a bright dissolve edge, so marks etch
// in and burn away instead of alpha-popping. Fixed slot pool, one circle
// geometry clone and one material clone per slot at construction; a spawn only
// rebinds the style's shared texture uniform.
//
// Slope fix (selection-ring idiom, see ground_auras.ts): a flat disc buries
// its uphill half on any slope, so each spawn drapes the disc's vertices over
// the sampled terrain plus a small lift. A decal never moves or rescales, so
// the drape runs exactly once per spawn - zero steady-state work. Those samples
// still thin with camera distance (../drape_lod_core): a far mark samples the
// rim more coarsely and interpolates between, keeping its world position and
// radius exactly as they were.
//
// The drape rides its own single-float attribute (`aDrape`) rather than a
// rewrite of the position buffer, so the twelve slot geometries share ONE
// position, uv and index buffer, a spawn uploads one column instead of the
// whole disc, the flat shape is permanent enough for a closed-form bounding
// sphere (../draped_bounds_core) and the marks are frustum-CULLED again. The
// family also shares one material: the per-slot style map, colour, dissolve
// and spin are pushed through onBeforeRender, so twelve cloned materials
// collapse to one. See ground_auras.ts for the same three moves in prose.

const DECAL_SLOTS = 12;
const DECAL_SEGMENTS = 24;
const DRAPE_LIFT = 0.06; // yards above the sampled ground, against z-fighting

export type DecalStyle = 'ember' | 'rime' | 'rune' | 'crack' | 'char';

interface DecalSlot {
  mesh: THREE.Mesh;
  age: number;
  dur: number;
  spin: number;
  active: boolean;
  // Per-slot shader state, pushed into the SHARED material by onBeforeRender.
  map: THREE.Texture;
  color: THREE.Color;
  dissolve: number;
  spinPhase: number;
  // The live drape attribute (one float per vertex, added to the disc's local
  // up-axis in the vertex shader), written once per spawn.
  drape: THREE.BufferAttribute;
  drapeY: Float32Array;
}

export class GroundDecals {
  private slots: DecalSlot[] = [];
  private next = 0;
  private disposed = false;
  private maps: Record<DecalStyle, THREE.CanvasTexture>;
  // center-relative XZ of every disc vertex (all slots share the same base)
  private localXZ: Float32Array;
  private readonly baseGeometry: THREE.CircleGeometry;
  private readonly material: THREE.ShaderMaterial;
  // Latest camera position (pushed once a frame from the fx engine) and whether
  // one has ever arrived: before the first frame every drape stays exact.
  private camX = 0;
  private camZ = 0;
  private camKnown = false;

  constructor(
    scene: THREE.Scene,
    tex: AbilityVfxTextures,
    private groundY: (x: number, z: number) => number,
  ) {
    this.maps = {
      ember: tex.ember,
      rime: tex.rime,
      rune: tex.rune,
      crack: tex.crack,
      char: tex.char,
    };
    // Rotation baked into the geometry (instead of mesh.rotation.x) so the
    // local Y IS the up-axis the drape attribute displaces along.
    const geo = new THREE.CircleGeometry(1, DECAL_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    this.baseGeometry = geo;
    const basePos = geo.getAttribute('position') as THREE.BufferAttribute;
    this.localXZ = new Float32Array(basePos.count * 2);
    for (let i = 0; i < basePos.count; i++) {
      this.localXZ[i * 2] = basePos.getX(i);
      this.localXZ[i * 2 + 1] = basePos.getZ(i);
    }
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex.rune },
        uNoise: { value: tex.noise },
        uColor: { value: new THREE.Color() },
        uDissolve: { value: 1 },
        uHdr: { value: 1.6 },
        uSpin: { value: 0 },
        uDrapeAxis: { value: DRAPE_AXIS_Y },
      },
      vertexShader: DRAPED_VERTEX_SHADER,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform sampler2D uNoise;
        uniform vec3 uColor;
        uniform float uDissolve;
        uniform float uHdr;
        uniform float uSpin;
        varying vec2 vUv;
        void main() {
          vec2 c = vUv - 0.5;
          float cs = cos(uSpin), sn = sin(uSpin);
          vec2 ruv = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
          vec4 tex = texture2D(uMap, ruv);
          float n = texture2D(uNoise, vUv * 2.3).r;
          float body = tex.a * smoothstep(uDissolve, uDissolve + 0.14, n);
          float edge = (smoothstep(uDissolve - 0.02, uDissolve + 0.04, n)
            - smoothstep(uDissolve + 0.08, uDissolve + 0.16, n)) * tex.a;
          float a = clamp(body + edge, 0.0, 1.0);
          // A dissolving mark is mostly cut away: early-out below the additive
          // floor rather than blend a transparent fragment the bloom re-reads
          // (../vfx.ts / overlay_sprites.ts idiom, depth writes already off).
          if (a < 0.004) discard;
          vec3 col = tex.rgb * uColor * uHdr + vec3(0.92, 0.95, 1.0) * edge * uHdr * 2.0;
          gl_FragColor = vec4(col, a);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const baseUv = geo.getAttribute('uv');
    for (let i = 0; i < DECAL_SLOTS; i++) {
      // The slot geometry SHARES the base disc's position, uv and index buffers
      // and owns only its own drape column.
      const slotGeo = new THREE.BufferGeometry();
      slotGeo.setAttribute('position', basePos);
      if (baseUv) slotGeo.setAttribute('uv', baseUv);
      slotGeo.setIndex(geo.getIndex());
      const drapeY = new Float32Array(basePos.count);
      const drape = new THREE.BufferAttribute(drapeY, 1).setUsage(THREE.DynamicDrawUsage);
      slotGeo.setAttribute('aDrape', drape);
      slotGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
      const slot: DecalSlot = {
        mesh: new THREE.Mesh(slotGeo, this.material),
        age: 0,
        dur: 3,
        spin: 0,
        active: false,
        map: tex.rune,
        color: new THREE.Color(),
        dissolve: 1,
        spinPhase: 0,
        drape,
        drapeY,
      };
      const mesh = slot.mesh;
      mesh.visible = false;
      mesh.renderOrder = 3; // over terrain decals, under the shock rings
      mesh.userData.renderCategory = 'vfx';
      // Culled again: the flat disc is permanent now, and the sphere is
      // refreshed from the drape extent at every spawn (see spawn).
      mesh.frustumCulled = true;
      // One material for the family: three uploads a ShaderMaterial's uniforms
      // whenever uniformsNeedUpdate is set, whatever its material-change check
      // decided, so each slot writes its own state here right before its draw.
      mesh.onBeforeRender = () => {
        const uniforms = this.material.uniforms;
        uniforms.uMap.value = slot.map;
        (uniforms.uColor.value as THREE.Color).copy(slot.color);
        uniforms.uDissolve.value = slot.dissolve;
        uniforms.uSpin.value = slot.spinPhase;
        this.material.uniformsNeedUpdate = true;
      };
      scene.add(mesh);
      this.slots.push(slot);
    }
  }

  /** Where the camera is this frame, for the drape distance LOD. */
  setCameraPosition(x: number, z: number): void {
    this.camX = x;
    this.camZ = z;
    this.camKnown = true;
  }

  spawn(
    x: number,
    y: number,
    z: number,
    radius: number,
    colorHex: number,
    style: DecalStyle,
    dur: number,
  ): void {
    if (this.disposed) return;
    const slot = this.slots[this.next];
    this.next = (this.next + 1) % DECAL_SLOTS;
    slot.active = true;
    slot.age = 0;
    slot.dur = dur;
    slot.spin = style === 'rune' ? 0.35 : 0;
    slot.map = this.maps[style];
    slot.color.setHex(colorHex);
    slot.dissolve = 1;
    slot.spinPhase = 0;
    slot.mesh.position.set(x, y, z);
    slot.mesh.scale.setScalar(radius);
    // drape the disc over the terrain so no arc buries on a slope (the lift
    // dodges z-fighting the old flat +0.04 offset handled)
    const dx = x - this.camX;
    const dz = z - this.camZ;
    drapeFanLocalY(
      this.localXZ,
      x,
      z,
      y,
      radius,
      DRAPE_LIFT,
      this.groundY,
      slot.drapeY,
      // -1 reads as "unknown" to drapeStrideFor, which then drapes exactly. A
      // wide mark's rim vertices are already yards apart, so the spacing cap
      // there refuses to thin it at all.
      drapeStrideFor(
        this.camKnown ? dx * dx + dz * dz : -1,
        fanVertexSpacing(radius, DECAL_SEGMENTS),
      ),
    );
    slot.drape.clearUpdateRanges();
    slot.drape.addUpdateRange(0, slot.drapeY.length);
    slot.drape.needsUpdate = true;
    const [low, high] = drapeExtent(slot.drapeY);
    const bounds = drapedBoundingSphere(1, low, high);
    const sphere = slot.mesh.geometry.boundingSphere as THREE.Sphere;
    sphere.center.set(0, bounds.center, 0);
    sphere.radius = bounds.radius;
    slot.mesh.visible = true;
  }

  update(dt: number): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      const t = slot.age / slot.dur;
      if (t >= 1) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }
      // etch in over the first 18%, hold, then dissolve away over the last 45%
      const dissolve =
        t < 0.18 ? 1 - (t / 0.18) * 0.85 : t < 0.55 ? 0.15 : 0.15 + ((t - 0.55) / 0.45) * 0.85;
      slot.dissolve = dissolve;
      if (slot.spin > 0) slot.spinPhase = slot.age * slot.spin;
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.mesh.visible = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    for (const slot of this.slots) {
      slot.mesh.onBeforeRender = () => {};
      slot.mesh.removeFromParent();
      slot.mesh.geometry.dispose();
    }
    // The slot geometries share the base disc's buffers, so the base owns the
    // release; the family shares one material, so it is disposed once.
    this.baseGeometry.dispose();
    this.material.dispose();
  }
}
