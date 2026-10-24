// The trash engine's line-of-sight nova (G6, sim/mob/trash_kit/kit_nova.ts):
// "hide behind something" made visible. While a mob casts a nova bar (its
// kit's `nova.castId`, or the every-Nth `unstoppableCastId`) the floor shows
// its SIGHT FIELD: the ring of the nova's radius filling over the bar, cut by
// every wall, pillar and ice slab between the caster and the floor, so the
// shadow behind cover reads as a dark, hatched, safe wedge. The reach of each
// of NOVA_RAYS rays is bisected over the sim's own sight test
// (sim/colliders.ts lineOfSightClear, the very call the sim's nova makes; the
// combat walls are in it, online too), a few rays a frame, round-robin, so a
// slab crashing down mid-bar carves its shadow in at once.
//  - The kickable bar wears the kick glyph under the caster (the interrupt
//    sigil of the shared kit) and the danger rim; the unstoppable one has no
//    glyph, a lethal rim, a crackling double edge and red-white sparks.
//  - On landing (spellfx 'nova', ability = the cast id) a frost wave races out
//    along the lit floor only: its front and a standing curtain of frost stop
//    dead at each block, bursting into spray against it, so the blast reads
//    as a sight line.
//
// The field lies on sight_field.ts's dense surface, draped once per bar (a
// planted caster never moves) and pulled toward the camera in depth, so it
// hugs a slope, a stair or a terrace lip with no z-fight; a reach carving in
// mid-bar only rewrites the sector's `aReach`.
//
// The sight field, its rim and the kick glyph are ACTIONABLE: every tier. The
// bands, the curtain and the sparks are cosmetic (the low tier sheds them).
// Built once under the host's root before its gated attach; no light; no
// per-frame allocation (the ray buffers are fixed per slot).

import * as THREE from 'three';
import { lineOfSightClear } from '../../sim/colliders';
import type { Entity, SimEvent } from '../../sim/types';
import { type TelegraphFan, telegraphFillOf } from '../floor_telegraph';
import {
  TELEGRAPH_THREAT_COLORS,
  type TelegraphLook,
  telegraphLook,
} from '../floor_telegraph/telegraph_look_core';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { SURFACE_LIFT } from './engine_geometry';
import {
  SIGHT_DRAPE_BUDGET,
  SIGHT_FIELD_VERT,
  SIGHT_SHADE_GLSL,
  SIGHT_STEEP_GLSL,
  SightFieldSurface,
} from './sight_field';
import { sightStations } from './sight_field_core';
import {
  kitOf,
  NOVA_RAYS,
  NOVA_WAVE_LINGER,
  NOVA_WAVE_SECONDS,
  type NovaCastLook,
  novaCastLook,
  novaWave,
  rgbOf,
  SCHOOL_TINT,
  sightReach,
} from './trash_engine_fx_core';
import type { TrashEngineHost } from './trash_engine_host';

const CAST_SLOTS = 6;
const WAVE_SLOTS = 3;
/** Rays re-measured per second per live bar, at most this many a frame, and
 *  how many the claim frame measures at once. */
const RAYS_PER_SECOND = 256;
const MAX_RAYS_PER_FRAME = 12;
const FIRST_RAYS = 16;
/** Seconds a released bar's sight field is kept for its landing wave. */
const KEEP_SECONDS = 1.2;
/** A planted caster that shows up this far from its bar's spot is a real
 *  resend (lay the field afresh); less is the mirror settling. */
const RESEND_YARDS = 0.3;

/** The whole field in one draw: out to the sector's reach the lit floor
 *  (the shared telegraph layers: tint, fill and its front, rim, warning,
 *  cosmetic bands, on yards from the caster, the rim drawn wherever the sight
 *  line ends: the nova's edge, or the face of the cover that stops it);
 *  beyond it the shadow behind cover, dark, cool and hatched (the nova cannot
 *  see here), its outer edge a faint dotted trace of the reach. */
const FIELD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uRadius;
uniform float uFill;
uniform float uBase;
uniform float uFilled;
uniform float uFront;
uniform float uRim;
uniform float uWarn;
uniform float uDetail;
uniform float uHarsh;
uniform float uTime;
uniform float uFade;
varying float vR;
varying float vReach;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
${SIGHT_STEEP_GLSL}
${SIGHT_SHADE_GLSL}
void main() {
  if (sightSteep(vLocal)) discard;
  if (vR > vReach + 0.02) {
    vec4 shade = sightShade(vR, vReach, uRadius, vLocal);
    gl_FragColor = vec4(shade.rgb, shade.a * uFade);
    return;
  }
  float edge = max(0.0, vReach - vR);
  float open = smoothstep(uRadius - 0.3, uRadius - 0.05, vReach);
  float rimCore = 1.0 - smoothstep(0.05, 0.18, edge);
  float rimSoft = 1.0 - smoothstep(0.0, 0.7, edge);
  float fillYards = uFill * uRadius;
  float inside = 1.0 - smoothstep(fillYards - 0.08, fillYards + 0.08, vR);
  float front = (1.0 - smoothstep(0.0, 0.6, abs(vR - fillYards))) * uFront;
  float a = uBase + inside * uFilled + front + rimSoft * 0.3 + rimCore * uRim * mix(0.75, 1.0, open);
  a += uWarn * (0.12 + inside * 0.14);
  vec3 col = uColor * (0.8 + 0.35 * inside + 0.45 * rimCore) + uAccent * front * 0.6;
  // The unstoppable bar: a second, broken edge inside the rim that crackles.
  if (uHarsh > 0.5) {
    float inner = 1.0 - smoothstep(0.0, 0.12, abs(edge - 0.7));
    float crackle = step(0.45, hash(floor(vWorld.xz * 2.0) + floor(uTime * 12.0)));
    a += inner * (0.35 + 0.4 * crackle) * open;
    col += vec3(1.0, 0.85, 0.8) * inner * crackle * 0.6 * open;
  }
  if (uDetail > 0.0) {
    float band = fract(vR * 0.55 - uTime * 1.1);
    float bands = smoothstep(0.0, 0.1, band) * (1.0 - smoothstep(0.18, 0.32, band));
    a += bands * 0.08 * (1.0 - inside * 0.5) * uDetail;
  }
  col += vec3(1.0) * uWarn * 0.12;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uFade);
}
`;

/** The landing wave over the lit floor: a racing frost front, rime left
 *  glittering behind it. */
const WAVE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uFront;
uniform float uAlpha;
uniform float uTime;
varying float vR;
varying float vReach;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
${SIGHT_STEEP_GLSL}
void main() {
  if (sightSteep(vLocal)) discard;
  if (vR > uFront || vR > vReach + 0.02) discard;
  float d = uFront - vR;
  float crest = exp(-d * d * 1.6);
  float rime = (0.25 + 0.2 * hash(floor(vWorld.xz * 3.0))) * (1.0 - smoothstep(0.0, 9.0, d));
  float wall = 1.0 - smoothstep(0.0, 0.5, vReach - vR);
  vec3 col = mix(uColor, vec3(1.0), crest * 0.6) * (1.0 + crest * 1.2 + wall * 0.8);
  gl_FragColor = vec4(col * (crest + rime + wall * 0.6) * uAlpha, 1.0);
}
`;

const CURTAIN_VERT = /* glsl */ `
attribute float aH;
varying float vH;
varying vec3 vWorld;
void main() {
  vH = aH;
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  // Camera-relative (the CPU's double-precision modelView): instance bands
  // sit far out, where a float32 world point rounds by more than the lift.
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The standing frost curtain riding the wave's front. */
const CURTAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying float vH;
varying vec3 vWorld;
void main() {
  float streak = 0.6 + 0.4 * sin((vWorld.x - vWorld.z) * 3.1 + uTime * 9.0);
  float fall = pow(max(1.0 - vH, 0.0), 1.6);
  vec3 col = mix(uColor, vec3(1.0), 0.35) * 1.4;
  gl_FragColor = vec4(col * fall * streak * uAlpha, 1.0);
}
`;

/** One sight field: the lit floor and its shadows, one draw on one surface. */
interface Field {
  surface: SightFieldSurface;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

interface CastSlot {
  casterId: number;
  castId: string;
  look: NovaCastLook | null;
  /** The caster the field was measured for (kept after release). */
  lastCasterId: number;
  releasedAt: number;
  x: number;
  y: number;
  z: number;
  reach: Float32Array;
  cursor: number;
  /** Rays owed to the budget (fractional carry). */
  due: number;
  field: Field;
  sigil: TelegraphFan;
  spark: number;
}

interface WaveSlot {
  alive: boolean;
  born: number;
  radius: number;
  x: number;
  y: number;
  z: number;
  reach: Float32Array;
  /** Rays whose block the front has already splashed against. */
  splashed: Uint8Array;
  color: number;
  surface: SightFieldSurface;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  curtain: THREE.Mesh;
  curtainMat: THREE.ShaderMaterial;
}

export class EngineNova {
  private readonly casts: CastSlot[] = [];
  private readonly waves: WaveSlot[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly look: TelegraphLook = {
    base: 0,
    filled: 0,
    front: 0,
    rim: 0,
    warn: 0,
    detail: 0,
  };
  private readonly from = { x: 0, y: 0, z: 0 };
  private readonly to = { x: 0, z: 0 };
  /** The ray under test (unit direction), read by the one bound sight probe. */
  private rayX = 0;
  private rayZ = 0;
  private readonly clearAt = (d: number): boolean => {
    this.to.x = this.from.x + this.rayX * d;
    this.to.z = this.from.z + this.rayZ * d;
    return lineOfSightClear(this.host.world.cfg.seed, this.from, this.to, 0.05);
  };
  private readonly cosA = new Float32Array(NOVA_RAYS);
  private readonly sinA = new Float32Array(NOVA_RAYS);
  private readonly detail: boolean;
  /** Draped stations of every field: dense enough for the widest nova. */
  private readonly stations: number;
  /** Floor samples still free this frame (SIGHT_DRAPE_BUDGET, shared). */
  private drapeLeft = SIGHT_DRAPE_BUDGET;
  private clock = 0;

  constructor(private readonly host: TrashEngineHost) {
    this.detail = host.density >= 1;
    let widest = 0;
    for (const def of host.catalog.novas.values()) widest = Math.max(widest, def.radius);
    this.stations = sightStations(widest);
    for (let i = 0; i < NOVA_RAYS; i++) {
      const a = (i / NOVA_RAYS) * Math.PI * 2;
      // Sim convention: facing 0 looks down +z (x = sin, z = cos).
      this.sinA[i] = Math.sin(a);
      this.cosA[i] = Math.cos(a);
    }
    for (let i = 0; i < CAST_SLOTS; i++) {
      this.casts.push({
        casterId: -1,
        castId: '',
        look: null,
        lastCasterId: -1,
        releasedAt: -1e9,
        x: 0,
        y: 0,
        z: 0,
        reach: new Float32Array(NOVA_RAYS),
        cursor: 0,
        due: 0,
        field: this.field(),
        sigil: host.kit.fan(19),
        spark: 0,
      });
    }
    for (let i = 0; i < WAVE_SLOTS; i++) {
      const surface = new SightFieldSurface(NOVA_RAYS, this.stations);
      this.geometries.push(surface.geometry);
      const mat = new THREE.ShaderMaterial({
        name: 'trashEngineNovaWave',
        uniforms: {
          uColor: { value: new THREE.Color() },
          uFront: { value: 0 },
          uAlpha: { value: 0 },
          uTime: host.uTime,
        },
        vertexShader: SIGHT_FIELD_VERT,
        fragmentShader: WAVE_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(surface.geometry, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 22);
      host.root.add(mesh);
      // The curtain: one quad per ray, its foot on the front, 2.6 yd tall.
      const cg = new THREE.BufferGeometry();
      cg.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(NOVA_RAYS * 2 * 3), 3),
      );
      const hAttr = new Float32Array(NOVA_RAYS * 2);
      for (let r = 0; r < NOVA_RAYS; r++) hAttr[r * 2 + 1] = 1;
      cg.setAttribute('aH', new THREE.BufferAttribute(hAttr, 1));
      const ci: number[] = [];
      for (let r = 0; r < NOVA_RAYS; r++) {
        const j = (r + 1) % NOVA_RAYS;
        ci.push(r * 2, j * 2, r * 2 + 1, j * 2, j * 2 + 1, r * 2 + 1);
      }
      cg.setIndex(ci);
      this.geometries.push(cg);
      const curtainMat = new THREE.ShaderMaterial({
        name: 'trashEngineNovaCurtain',
        uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uTime: host.uTime },
        vertexShader: CURTAIN_VERT,
        fragmentShader: CURTAIN_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(curtainMat);
      const curtain = new THREE.Mesh(cg, curtainMat);
      curtain.frustumCulled = false;
      curtain.visible = false;
      curtain.renderOrder = floorVfxRenderOrder('encounter', 25);
      host.root.add(curtain);
      this.waves.push({
        alive: false,
        born: 0,
        radius: 0,
        x: 0,
        y: 0,
        z: 0,
        reach: new Float32Array(NOVA_RAYS),
        splashed: new Uint8Array(NOVA_RAYS),
        color: 0xffffff,
        surface,
        mesh,
        mat,
        curtain,
        curtainMat,
      });
    }
  }

  private field(): Field {
    const surface = new SightFieldSurface(NOVA_RAYS, this.stations);
    this.geometries.push(surface.geometry);
    const mat = new THREE.ShaderMaterial({
      name: 'trashEngineNovaSight',
      uniforms: {
        uColor: { value: new THREE.Color() },
        uAccent: { value: new THREE.Color() },
        uRadius: { value: 1 },
        uFill: { value: 0 },
        uBase: { value: 0 },
        uFilled: { value: 0 },
        uFront: { value: 0 },
        uRim: { value: 0 },
        uWarn: { value: 0 },
        uDetail: { value: 0 },
        uHarsh: { value: 0 },
        uTime: this.host.uTime,
        uFade: { value: 1 },
      },
      vertexShader: SIGHT_FIELD_VERT,
      fragmentShader: FIELD_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(mat);
    const mesh = new THREE.Mesh(surface.geometry, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = floorVfxRenderOrder('encounter', 15);
    this.host.root.add(mesh);
    return { surface, mesh, mat };
  }

  // ------------------------------------------------------------- sight rays

  /** The sim's own sight test from the caster to a floor spot `d` yards out. */
  private rayReach(
    at: { x: number; y: number; z: number },
    ray: number,
    radius: number,
    caster: Entity | null,
    steps?: number,
  ): number {
    this.from.x = caster ? caster.pos.x : at.x;
    this.from.y = caster ? caster.pos.y : at.y;
    this.from.z = caster ? caster.pos.z : at.z;
    this.rayX = this.sinA[ray];
    this.rayZ = this.cosA[ray];
    return sightReach(this.clearAt, radius, steps);
  }

  // ------------------------------------------------------------------ scans

  /** A mob seen by the scan: claim its nova bar. */
  scanMob(e: Entity): void {
    if (e.dead || !e.castingAbility) return;
    const look = novaCastLook(kitOf(e), e.castingAbility);
    if (!look) return;
    if (this.casts.some((c) => c.casterId === e.id)) return;
    const slot =
      this.casts.find((c) => c.casterId < 0 && this.clock - c.releasedAt > KEEP_SECONDS) ??
      this.casts.find((c) => c.casterId < 0);
    if (!slot) return;
    slot.casterId = e.id;
    slot.lastCasterId = e.id;
    slot.castId = e.castingAbility;
    slot.look = look;
    slot.x = e.pos.x;
    slot.y = this.host.groundY(e.pos.x, e.pos.z);
    slot.z = e.pos.z;
    slot.cursor = 0;
    slot.spark = 0;
    // Start open (the whole ring), then carve the shadows in as rays land:
    // a quarter of the rays are measured this very frame.
    for (let r = 0; r < NOVA_RAYS; r++) slot.reach[r] = look.radius;
    const f = slot.field;
    f.mesh.position.set(slot.x, slot.y, slot.z);
    f.surface.begin(slot.x, slot.y, slot.z, look.radius, SURFACE_LIFT);
    this.drapeLeft -= f.surface.drapeSome(this.host.groundY, this.drapeLeft);
    slot.due = 0;
    this.measure(slot, e, FIRST_RAYS);
    const lu = f.mat.uniforms;
    (lu.uColor.value as THREE.Color).setHex(look.color);
    (lu.uAccent.value as THREE.Color).setHex(look.accent);
    lu.uRadius.value = look.radius;
    lu.uHarsh.value = look.kickable ? 0 : 1;
    f.mesh.visible = true;
    if (look.kickable) {
      this.host.kit.layOutFan(slot.sigil, 360, {
        color: TELEGRAPH_THREAT_COLORS.interrupt,
        accent: look.accent,
        sigil: true,
      });
      slot.sigil.group.visible = true;
    }
  }

  private measure(slot: CastSlot, caster: Entity | null, count: number): void {
    const look = slot.look;
    if (!look) return;
    for (let k = 0; k < count; k++) {
      const ray = slot.cursor;
      slot.cursor = (slot.cursor + 1) % NOVA_RAYS;
      const reach = this.rayReach(slot, ray, look.radius, caster);
      if (Math.abs(reach - slot.reach[ray]) > 0.05) {
        slot.reach[ray] = reach;
        slot.field.surface.setRay(slot.reach, ray);
      }
    }
  }

  // ----------------------------------------------------------------- events

  /** A nova landed: its wave. True when drawn here. */
  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx' || ev.fx !== 'nova' || !ev.ability) return false;
    const def = this.host.catalog.novas.get(ev.ability);
    if (!def) return false;
    const caster = this.host.world.entities.get(ev.sourceId) ?? null;
    const slot =
      this.casts.find((c) => c.casterId === ev.sourceId) ??
      this.casts.find(
        (c) => c.lastCasterId === ev.sourceId && this.clock - c.releasedAt <= KEEP_SECONDS,
      );
    const wave = this.waves.find((w) => !w.alive) ?? this.waves[0];
    if (slot) {
      wave.reach.set(slot.reach);
      wave.x = slot.x;
      wave.y = slot.y;
      wave.z = slot.z;
      // The wave's floor: the bar's own draped field (no floor re-sampled).
      wave.surface.copyFrom(slot.field.surface);
      if (slot.casterId === ev.sourceId) this.release(slot);
      slot.lastCasterId = -1;
    } else if (caster) {
      // Seen landing without its bar (it came into view late): measure now.
      wave.x = caster.pos.x;
      wave.y = this.host.groundY(caster.pos.x, caster.pos.z);
      wave.z = caster.pos.z;
      // Coarse, so a late landing never stalls its frame: every fourth ray,
      // three bisection steps, each standing for its neighbours.
      for (let r = 0; r < NOVA_RAYS; r += 4) {
        const reach = this.rayReach(wave, r, def.radius, caster, 3);
        for (let k = 0; k < 4 && r + k < NOVA_RAYS; k++) wave.reach[r + k] = reach;
      }
      // Laid flat, then draped a budget a frame (updateWaves).
      wave.surface.begin(wave.x, wave.y, wave.z, def.radius, SURFACE_LIFT);
      wave.surface.setReach(wave.reach);
    } else return true;
    this.launchWave(wave, def.radius, SCHOOL_TINT[def.school] ?? SCHOOL_TINT.frost);
    return true;
  }

  private launchWave(wave: WaveSlot, radius: number, color: number): void {
    wave.alive = true;
    wave.born = this.clock;
    wave.radius = radius;
    wave.color = color;
    wave.splashed.fill(0);
    wave.mesh.position.set(wave.x, wave.y, wave.z);
    wave.curtain.position.set(wave.x, wave.y, wave.z);
    (wave.mat.uniforms.uColor.value as THREE.Color).setHex(color);
    (wave.curtainMat.uniforms.uColor.value as THREE.Color).setHex(color);
    wave.mesh.visible = true;
    wave.curtain.visible = this.detail;
    const h = this.host;
    // The blast at its heart.
    h.shockRing(wave.x, wave.z, 0xffffff, 3.5, 0.3);
    h.puff(wave.x, wave.y + 1.4, wave.z, 6, {
      speed: 0.3,
      life: 0.3,
      size: [5, 2],
      color: rgbOf(color),
      alpha: 1,
      pool: 'glow',
    });
    h.shards.burst(wave.x, wave.y + 1.2, wave.z, 24, {
      speed: 12,
      up: 3,
      size: [0.25, 0.8],
      radius: 0.8,
      iron: 0,
    });
    if (!h.reducedMotion()) h.shake(0.3);
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, clock: number): void {
    this.clock = clock;
    const world = this.host.world;
    // One floor-sample budget a frame for every draping field and wave.
    this.drapeLeft = SIGHT_DRAPE_BUDGET;
    for (const slot of this.casts) {
      if (slot.casterId < 0 || !slot.look) continue;
      const caster = world.entities.get(slot.casterId);
      if (!caster || caster.dead || caster.castingAbility !== slot.castId) {
        this.release(slot);
        continue;
      }
      const look = slot.look;
      if (Math.hypot(caster.pos.x - slot.x, caster.pos.z - slot.z) > RESEND_YARDS) {
        // A planted bar never moves; a resend only. Redraw where it stands.
        slot.x = caster.pos.x;
        slot.z = caster.pos.z;
        slot.y = this.host.groundY(slot.x, slot.z);
        const f = slot.field;
        f.mesh.position.set(slot.x, slot.y, slot.z);
        f.surface.begin(slot.x, slot.y, slot.z, look.radius, SURFACE_LIFT);
        f.surface.setReach(slot.reach);
      }
      // The drape runs on from the claim frame, from the shared budget.
      this.drapeLeft -= slot.field.surface.drapeSome(this.host.groundY, this.drapeLeft);
      // A rays-per-second budget (a full sweep about four times a second),
      // never more than a handful in one frame whatever the refresh rate.
      slot.due = Math.min(MAX_RAYS_PER_FRAME, slot.due + dt * RAYS_PER_SECOND);
      const now = Math.floor(slot.due);
      slot.due -= now;
      this.measure(slot, caster, now);
      const fill = telegraphFillOf(caster.castRemaining, caster.castTotal);
      const l = telegraphLook(fill, clock, this.detail, this.look);
      const u = slot.field.mat.uniforms;
      u.uFill.value = fill;
      u.uBase.value = l.base;
      u.uFilled.value = l.filled;
      u.uFront.value = l.front;
      u.uRim.value = l.rim;
      u.uWarn.value = look.kickable ? l.warn : Math.min(1, l.warn * 1.4 + 0.15 * fill);
      u.uDetail.value = l.detail;
      if (look.kickable) {
        this.host.kit.drapeFan(
          slot.sigil,
          this.host.groundY,
          slot.x,
          slot.y,
          slot.z,
          clock * 1.4,
          2.4,
        );
        this.host.kit.paintFan(slot.sigil, { fill, clock, range: 2.4 });
      } else {
        // The unstoppable bar: red-white sparks crackling round the caster.
        slot.spark += dt * 26 * this.host.density;
        while (slot.spark >= 1) {
          slot.spark -= 1;
          const a = this.host.rand() * Math.PI * 2;
          const r = 1.2 + this.host.rand() * 1.4;
          this.host.puff(slot.x + Math.sin(a) * r, slot.y + 0.3, slot.z + Math.cos(a) * r, 1, {
            speed: 0.6,
            up: 2.4 + fill * 3,
            life: 0.5,
            size: [0.22, 0.05],
            color: [1, 0.5 + 0.4 * this.host.rand(), 0.45],
            alpha: 1,
            pool: 'glow',
          });
        }
      }
    }
    this.updateWaves();
  }

  private updateWaves(): void {
    const h = this.host;
    for (const w of this.waves) {
      if (!w.alive) continue;
      const elapsed = this.clock - w.born;
      if (elapsed > NOVA_WAVE_SECONDS + NOVA_WAVE_LINGER) {
        w.alive = false;
        w.mesh.visible = false;
        w.curtain.visible = false;
        continue;
      }
      this.drapeLeft -= w.surface.drapeSome(h.groundY, this.drapeLeft);
      const wave = novaWave(elapsed, w.radius);
      w.mat.uniforms.uFront.value = wave.front;
      w.mat.uniforms.uAlpha.value = wave.alpha;
      const racing = elapsed < NOVA_WAVE_SECONDS;
      w.curtainMat.uniforms.uAlpha.value = racing ? 0.9 : Math.max(0, wave.alpha - 0.4);
      // The curtain stands on the front, held at each ray's block.
      const cp = w.curtain.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let ray = 0; ray < NOVA_RAYS; ray++) {
        const reach = w.reach[ray];
        const d = Math.min(wave.front, reach);
        const wx = w.x + this.sinA[ray] * d;
        const wz = w.z + this.cosA[ray] * d;
        const gy = h.groundY(wx, wz) - w.y;
        cp.setXYZ(ray * 2, wx - w.x, gy, wz - w.z);
        cp.setXYZ(ray * 2 + 1, wx - w.x, gy + 2.6, wz - w.z);
        // The blast slams into the cover that stops it: spray at the face.
        if (racing && w.splashed[ray] === 0 && reach < w.radius - 0.3 && wave.front >= reach) {
          w.splashed[ray] = 1;
          h.puff(wx, h.groundY(wx, wz) + 1.2, wz, 3, {
            speed: 2.6,
            up: 2,
            life: 0.9,
            size: [0.9, 2.4],
            color: [0.88, 0.95, 1],
            alpha: 0.5,
            dir: [-this.sinA[ray], 0.6, -this.cosA[ray]],
            spread: 0.6,
            drag: 2,
          });
          h.puff(wx, h.groundY(wx, wz) + 1.4, wz, 3, {
            speed: 3.2,
            up: 2.5,
            life: 0.5,
            size: [0.2, 0.05],
            color: rgbOf(w.color),
            alpha: 1,
            pool: 'glow',
            gravity: 6,
          });
        }
        // Frost thrown along every lit ray as the front passes.
        if (racing && reach >= w.radius - 0.3 && ray % 3 === 0 && h.rand() < 0.45 * h.density)
          h.puff(wx, h.groundY(wx, wz) + 0.4, wz, 1, {
            speed: 3,
            up: 1.2,
            life: 0.6,
            size: [0.6, 1.8],
            color: [0.86, 0.94, 1],
            alpha: 0.4,
            dir: [this.sinA[ray], 0.2, this.cosA[ray]],
            spread: 0.3,
            drag: 2.4,
          });
      }
      cp.needsUpdate = true;
    }
  }

  private release(slot: CastSlot): void {
    slot.casterId = -1;
    slot.look = null;
    slot.releasedAt = this.clock;
    slot.field.mesh.visible = false;
    slot.sigil.group.visible = false;
  }

  hideAll(): void {
    for (const s of this.casts) {
      this.release(s);
      s.lastCasterId = -1;
    }
    for (const w of this.waves) {
      w.alive = false;
      w.mesh.visible = false;
      w.curtain.visible = false;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
