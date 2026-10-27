// The Hammer Council's pillars and their rubble (plan: council_fx_core.ts;
// docs/design/raid/smith_heart.md 5.18), a part of CouncilFx (council_fx.ts,
// which owns the root, the particles, the debris and the floor telegraph and
// hands them in as the host). The quarry's carved columns (the Hammer kit's
// own column) and the risen stone (the rock kit's needles), each with its crack
// shell (the piece's own stone pushed out along its normals: a seam net that
// opens and burns per integrity), its lean and the three pips round its foot;
// the rise, a lost piece, the fall into rubble, the sinking; the rubble's
// hazard footprint. Every shell, pip, lean and footprint draws on every tier;
// the dust, grit and debris thin with the host's density.

import * as THREE from 'three';
import { QUARRY_PILLAR_SPOTS } from '../../sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import {
  type CouncilRole,
  councilPillarRadius,
  COUNCIL_TUNING as T,
} from '../../sim/encounters/smith_heart/council_ids';
import type { Entity } from '../../sim/types';
import type { TelegraphFan, TelegraphKit } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { surfaceMat } from '../gfx';
import {
  heartKitLoaded,
  heartKitMeshes,
  heartKitPiece,
  SMITH_HEART_HAMMER_KIT_URL,
  SMITH_HEART_HEART_KIT_URL,
  SMITH_HEART_ROCK_KIT_URL,
} from '../smith_heart/heart_kit';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  COUNCIL_FX_COLORS as C,
  crackFlash,
  PILLAR_SETTLE_SECONDS,
  COUNCIL_FX_POOLS as POOLS,
  pillarFall,
  pillarLeanYaw,
  pillarLook,
  pillarPipSlots,
  pillarPips,
  pillarRise,
  pulseRadius,
  resonanceShake,
  SOUL_COLORS,
  soulPillarLook,
} from './council_fx_core';
import { CouncilPipSockets } from './council_pip_sockets';
import { CouncilSlabRigs } from './council_slab_fx';
import type { Rubble } from './hammer_fx';
import { fxHash } from './hammer_fx_core';

const SMITH_HEART = 'smith_heart';
const _slab = { lurch: 0, rock: 0, heading: 0 };
const COLUMN_PIECE = 'Kit_PitColumn';
const NEEDLE_PIECES = ['Kit_RockNeedleA', 'Kit_RockNeedleB'] as const;
/** A risen pillar's drawn height and radius (its wall's: 2.2 by 10). */
export const RISEN_HEIGHT = 10.6;
const RISEN_RADIUS = 2.05;
/** How far a crack shell stands off its pillar's surface (yards). */
const SHELL_PUSH = 0.045;

/** Per-frame scratch (the frame allocates nothing). */
const _rise = { sunk: 0, shudder: 0 };
const _hum = { jitter: 0, heat: 0 };
const _soul = { crack: 0, heat: 0, glow: 0 };
/** The souls' colours as particle rgb (0..1), built once. */
const SOUL_RGB: Readonly<Record<CouncilRole, readonly [number, number, number]>> = {
  guardian: hexRgb(SOUL_COLORS.guardian.hex),
  slabwright: hexRgb(SOUL_COLORS.slabwright.hex),
  singer: hexRgb(SOUL_COLORS.singer.hex),
};
function hexRgb(hex: number): readonly [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
const _soulMote = {
  speed: 0.5,
  up: 2.2,
  life: 1.6,
  size: [0.5, 0.12] as const,
  color: SOUL_RGB.guardian as readonly [number, number, number],
  alpha: 0.9,
  pool: 'glow' as const,
};
const _dust = {
  speed: 1.4,
  up: 0.5,
  life: 1.6,
  size: [1.2, 3.2] as const,
  color: C.dust,
  alpha: 0.42,
  drag: 1.2,
};
const _rubblePaint = { fill: 1, clock: 0, range: 0, fade: 0.85 };
const PILLAR_GRIT = {
  speed: 0.3,
  life: 1.8,
  size: [0.4, 1.2] as const,
  color: C.dust,
  alpha: 0.4,
  gravity: 6,
};

const rgb = (c: readonly [number, number, number]) => new THREE.Color(c[0], c[1], c[2]);

/** What CouncilFx lends its parts: the root, the shared pools, the clock. */
export interface CouncilFxHost {
  root: THREE.Group;
  /** A mirrored entity by id (the Walking Slab is followed every frame). */
  entity: (id: number) => Entity | undefined;
  uTime: { value: number };
  particles: EngineParticles;
  debris: Rubble;
  kit: TelegraphKit;
  groundY: (x: number, z: number) => number;
  rand: () => number;
  now: () => number;
  density: number;
  detail: boolean;
  reducedMotion: () => boolean;
  shakeNear: (x: number, z: number, amount: number, reach?: number) => void;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

// ---- the crack shell ---------------------------------------------------------------------

const SHELL_VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The seams: the edges of a stretched 3D cell net in the piece's own frame,
 *  each cell opening once uCrack passes its hash; a dark lip round a hot
 *  core, the heat breathing, a flash when a piece is lost. */
const SHELL_FRAG = /* glsl */ `
uniform float uCrack;
uniform float uHeat;
uniform float uFlash;
uniform float uFreq;
uniform float uTime;
uniform vec3 uCore;
uniform vec3 uEdge;
uniform vec3 uDark;
varying vec3 vPos;
vec3 h3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}
void main() {
  vec3 p = vPos * uFreq;
  p.y *= 0.42;
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  vec3 cell = vec3(0.0);
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = h3(i + g);
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; cell = i + g; }
    else if (d < d2) { d2 = d; }
  }
  float edge = sqrt(d2) - sqrt(d1);
  float open = step(h3(cell).x, uCrack);
  float w = 0.06 + 0.08 * uCrack;
  float line = (1.0 - smoothstep(0.0, w, edge)) * open;
  if (line < 0.02) discard;
  float core = 1.0 - smoothstep(0.0, w * 0.45, edge);
  float breath = 0.82 + 0.18 * sin(uTime * 3.1 + cell.y * 1.7);
  float heat = clamp(uHeat * breath + uFlash, 0.0, 2.0);
  vec3 hot = mix(uEdge, uCore, clamp(core * heat, 0.0, 1.0));
  vec3 col = mix(uDark, hot * (0.6 + heat), core * clamp(heat + 0.2, 0.0, 1.0));
  gl_FragColor = vec4(col, line * (0.75 + 0.25 * core));
  #include <colorspace_fragment>
}
`;

// ---- the pips round a pillar's foot -------------------------------------------------------

const PIP_VERT = /* glsl */ `
varying vec2 vXZ;
void main() {
  vXZ = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** `uSlots` arcs round the foot, `uLit` of them burning; the last one of a
 *  pillar that started with more throbs. */
const PIP_FRAG = /* glsl */ `
uniform float uLit;
uniform float uSlots;
uniform float uFlash;
uniform float uTime;
uniform vec3 uOn;
uniform vec3 uOff;
varying vec2 vXZ;
void main() {
  float a = atan(vXZ.x, vXZ.y);
  float t = fract(a / 6.2831853 + 0.5);
  float k = floor(t * uSlots);
  float local = fract(t * uSlots);
  float gap = smoothstep(0.04, 0.09, local) * (1.0 - smoothstep(0.91, 0.96, local));
  if (gap < 0.02) discard;
  float lit = step(k + 0.5, uLit);
  float last = uLit < 1.5 && uSlots > 1.5 ? 0.5 + 0.5 * sin(uTime * 7.0) : 1.0;
  vec3 col = mix(uOff, uOn * (1.0 + uFlash * 1.5) * (0.65 + 0.35 * last), lit);
  gl_FragColor = vec4(col, gap * mix(0.55, 0.95, lit));
  #include <colorspace_fragment>
}
`;

// ---- a soul pillar's glow ---------------------------------------------------------------

const SOUL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** A sheath of the soul's light round the stone: strongest at the foot,
 *  veins of it climbing and flowing up, fading toward the crown. */
const SOUL_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float rise = pow(1.0 - vUv.y, 1.4);
  float veins = 0.5 + 0.5 * sin(vUv.x * 6.2831853 * 5.0 + sin(vUv.y * 9.0 + uTime) * 1.4);
  float flow = 0.55 + 0.45 * sin(vUv.y * 18.0 - uTime * 3.4 + vUv.x * 12.566);
  float lace = smoothstep(0.55, 0.95, veins * flow);
  float a = uAlpha * (0.15 + 0.85 * rise) * (0.2 + 0.8 * lace);
  gl_FragColor = vec4(uColor * (0.7 + 0.7 * lace), a);
  #include <colorspace_fragment>
}
`;

interface PillarSlot {
  /** Its place in the pool (its sockets' row). */
  index: number;
  id: number;
  state: 'idle' | 'standing' | 'falling' | 'sinking';
  risen: boolean;
  integrity: number;
  holder: THREE.Group;
  leanYaw: THREE.Group;
  lean: THREE.Group;
  bodyYaw: THREE.Group;
  body: THREE.Group | null;
  fallback: THREE.Mesh;
  seen: boolean;
  bodyKey: string;
  shell: THREE.Mesh;
  shellMat: THREE.ShaderMaterial;
  pips: THREE.Mesh;
  pipsMat: THREE.ShaderMaterial;
  /** Mythic: whose soul it holds (its look follows), else null. */
  soul: CouncilRole | null;
  soulGlow: THREE.Mesh;
  soulGlowMat: THREE.ShaderMaterial;
  /** Seconds of motes owed (a soul's light rising off its cracks). */
  motes: number;
  height: number;
  radius: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  riseAt: number;
  crackAt: number;
  endAt: number;
  grit: number;
}

interface RubbleSlot {
  id: number;
  group: THREE.Group;
  pieces: THREE.Group | null;
  /** Which kit pieces the pile already carries (a kit can land late). */
  hasScatter: boolean;
  hasPile: boolean;
  fan: TelegraphFan;
  r: number;
  x: number;
  y: number;
  z: number;
  seenAt: number;
}

export class CouncilPillarsFx {
  private readonly pillars: PillarSlot[] = [];
  /** Mythic: the Walking Slab's claws, collar, face and gouges. */
  private readonly slabs: CouncilSlabRigs;
  /** The pips as carved stone sockets holding their light. */
  private readonly sockets: CouncilPipSockets;
  private readonly rubble: RubbleSlot[] = [];
  /** Crack shells by kit piece (built once the kit lands). */
  private readonly shellGeo = new Map<string, THREE.BufferGeometry>();
  private readonly pieceBox = new Map<string, THREE.Box3>();
  /** Pillars whose rise arrived before they were scanned. */
  private readonly pendingRise = new Set<number>();
  /** The Resonance cracking each pillar this frame (pillar id to share). */
  readonly humming = new Map<number, number>();
  /** Mythic: each soul pillar's charge this frame (pillar id to 0..1: the
   *  Echo's bar, the song's clock), set by the soul part. */
  readonly charge = new Map<number, number>();

  constructor(
    private readonly h: CouncilFxHost,
    carrier: THREE.BufferGeometry,
  ) {
    const pipGeo = new THREE.RingGeometry(1, 1.16, 72, 1).rotateX(-Math.PI / 2);
    const drumGeo = new THREE.CylinderGeometry(0.92, 1, 1, 12, 1).translate(0, 0.5, 0);
    const sheathGeo = new THREE.CylinderGeometry(1, 1.06, 1, 36, 1, true).translate(0, 0.5, 0);
    this.h.geometries.push(pipGeo, drumGeo, sheathGeo);
    const drumMat = surfaceMat({ color: 0x8c8274, roughness: 0.9, flatShading: true });
    this.slabs = new CouncilSlabRigs(h, POOLS.souls);
    this.sockets = new CouncilPipSockets(h.root, POOLS.pillars, h.geometries, h.materials);
    // ---- the pillars ----
    for (let i = 0; i < POOLS.pillars; i++) {
      const holder = new THREE.Group();
      holder.name = 'smithHeartCouncilPillar';
      holder.visible = false;
      const leanYaw = new THREE.Group();
      const lean = new THREE.Group();
      const bodyYaw = new THREE.Group();
      holder.add(leanYaw);
      leanYaw.add(lean);
      lean.add(bodyYaw);
      // Until the kit lands: a plain stone drum of the wall's size.
      const fallback = new THREE.Mesh(drumGeo, drumMat);
      fallback.name = 'smithHeartPillarDrum';
      fallback.castShadow = this.h.detail;
      bodyYaw.add(fallback);
      const shellMat = new THREE.ShaderMaterial({
        name: 'smithHeartPillarCracks',
        uniforms: {
          uCrack: { value: 0 },
          uHeat: { value: 0 },
          uFlash: { value: 0 },
          uFreq: { value: 0.6 },
          uTime: this.h.uTime,
          uCore: { value: rgb(C.crackCore) },
          uEdge: { value: rgb(C.crackEdge) },
          uDark: { value: rgb(C.crackDark) },
        },
        vertexShader: SHELL_VERT,
        fragmentShader: SHELL_FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      });
      this.h.materials.push(shellMat);
      const shell = new THREE.Mesh(carrier, shellMat);
      shell.name = 'smithHeartPillarCracks';
      shell.frustumCulled = false;
      shell.visible = false;
      bodyYaw.add(shell);
      const pipsMat = new THREE.ShaderMaterial({
        name: 'smithHeartPillarPips',
        uniforms: {
          uLit: { value: 2 },
          uSlots: { value: 2 },
          uFlash: { value: 0 },
          uTime: this.h.uTime,
          uOn: { value: new THREE.Color(C.pipLit) },
          uOff: { value: new THREE.Color(C.pipSpent) },
        },
        vertexShader: PIP_VERT,
        fragmentShader: PIP_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      this.h.materials.push(pipsMat);
      const pips = new THREE.Mesh(pipGeo, pipsMat);
      pips.name = 'smithHeartPillarPips';
      pips.renderOrder = floorVfxRenderOrder('encounter', 20);
      pips.position.y = 0.06;
      pips.frustumCulled = false;
      holder.add(pips);
      const soulGlowMat = new THREE.ShaderMaterial({
        name: 'smithHeartSoulGlow',
        uniforms: {
          uAlpha: { value: 0 },
          uTime: this.h.uTime,
          uColor: { value: new THREE.Color(SOUL_COLORS.guardian.hex) },
        },
        vertexShader: SOUL_VERT,
        fragmentShader: SOUL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.h.materials.push(soulGlowMat);
      const soulGlow = new THREE.Mesh(sheathGeo, soulGlowMat);
      soulGlow.name = 'smithHeartSoulGlow';
      soulGlow.visible = false;
      soulGlow.frustumCulled = false;
      leanYaw.add(soulGlow);
      this.h.root.add(holder);
      this.pillars.push({
        index: i,
        id: -1,
        state: 'idle',
        risen: false,
        integrity: 2,
        holder,
        leanYaw,
        lean,
        bodyYaw,
        body: null,
        fallback,
        seen: false,
        bodyKey: '',
        shell,
        shellMat,
        pips,
        pipsMat,
        soul: null,
        soulGlow,
        soulGlowMat,
        motes: 0,
        height: 12,
        radius: 2.4,
        x: 0,
        y: 0,
        z: 0,
        rot: 0,
        riseAt: -99,
        crackAt: -99,
        endAt: -99,
        grit: 0,
      });
    }
    // ---- the rubble patches ----
    for (let i = 0; i < POOLS.rubble; i++) {
      const group = new THREE.Group();
      group.name = 'smithHeartCouncilRubble';
      group.visible = false;
      this.h.root.add(group);
      const fan = this.h.kit.fan(12);
      this.h.kit.layOutFan(fan, 360, { color: C.danger, accent: C.ochre });
      fan.group.visible = false;
      this.rubble.push({
        id: -1,
        group,
        pieces: null,
        hasScatter: false,
        hasPile: false,
        fan,
        r: 3,
        x: 0,
        y: 0,
        z: 0,
        seenAt: -99,
      });
    }
  }

  /** A standing pillar by its entity id (Resonance's thread aims at it). */
  standing(id: number): { x: number; y: number; z: number; height: number; radius: number } | null {
    const s = this.pillars.find((p) => p.id === id && p.state === 'standing');
    return s ?? null;
  }

  /** The standing pillars that hold no soul (the Echo's shelters), into
   *  `out` (reused: the frame allocates nothing past its first use). */
  shelters(out: { x: number; z: number; r: number }[]): number {
    let n = 0;
    for (const s of this.pillars) {
      if (s.state !== 'standing' || s.soul) continue;
      if (n >= out.length) out.push({ x: 0, z: 0, r: 0 });
      out[n].x = s.x;
      out[n].z = s.z;
      // The sim's own cover (its wall's radius plus the sight test's breath:
      // council_pillars.ts pillarBetween), never the model's.
      out[n].r = councilPillarRadius(s.risen) + 0.35;
      n++;
    }
    return n;
  }

  /** A scan begins: nothing seen yet. */
  beginScan(): void {
    for (const s of this.pillars) s.seen = false;
    for (const r of this.rubble) if (r.id >= 0) r.seenAt = -1;
  }

  /** A scan ended: a pillar it no longer saw sinks, its rubble goes. */
  endScan(): void {
    for (const s of this.pillars) {
      if (s.state === 'standing' && !s.seen) this.sinkPillar(s);
    }
    for (const r of this.rubble) {
      if (r.id >= 0 && r.seenAt === -1) this.dropRubble(r);
    }
  }

  /** `heart_council_pillar_rise`: it bursts out now (or once it is scanned). */
  rise(id: number): void {
    const s = this.pillars.find((p) => p.id === id && p.state === 'standing');
    if (s) this.startRise(s);
    else this.pendingRise.add(id);
  }

  /** `heart_council_pillar_crack`: a piece lost. */
  cracked(id: number): void {
    const s = this.pillars.find((p) => p.id === id);
    if (s) this.crack(s);
  }

  /** `heart_council_pillar_pulse` (heroic): its ring out to its reach. */
  pulse(id: number): void {
    const s = this.pillars.find((p) => p.id === id);
    if (s?.state !== 'standing') return;
    this.h.particles.shockRing(s.x, s.z, C.danger, pulseRadius(s.radius + 0.2), 0.45);
    this.h.particles.puff(s.x, s.y + 0.4, s.z, 4, {
      speed: 2,
      life: 0.8,
      size: [0.8, 2],
      color: C.dust,
      alpha: 0.35,
      radius: s.radius,
    });
  }

  update(dt: number): void {
    this.updatePillars(dt);
    this.updateRubble();
    this.slabs.update(dt);
  }

  /** A kit piece's local box (its baked stone, else any slot), cached. */
  boxOf(url: string, piece: string): THREE.Box3 | null {
    const key = `${url}|${piece}`;
    const have = this.pieceBox.get(key);
    if (have) return have;
    const geo = heartKitPiece(url, piece);
    const g = geo?.stone ?? geo?.glow ?? geo?.ice;
    if (!g) return null;
    if (!g.boundingBox) g.computeBoundingBox();
    const box = (g.boundingBox as THREE.Box3).clone();
    this.pieceBox.set(key, box);
    return box;
  }

  /** The crack shell of a kit piece: its stone pushed out along its normals. */
  shellOf(url: string, piece: string, scale: number): THREE.BufferGeometry | null {
    const key = `${url}|${piece}`;
    const have = this.shellGeo.get(key);
    if (have) return have;
    const geo = heartKitPiece(url, piece)?.stone;
    if (!geo) return null;
    const g = new THREE.BufferGeometry();
    const pos = geo.getAttribute('position');
    let nrm = geo.getAttribute('normal');
    if (!nrm) {
      const tmp = geo.clone();
      tmp.computeVertexNormals();
      nrm = tmp.getAttribute('normal');
      tmp.dispose();
    }
    const out = new Float32Array(pos.count * 3);
    const push = SHELL_PUSH / Math.max(0.05, scale);
    for (let i = 0; i < pos.count; i++) {
      out[i * 3] = pos.getX(i) + nrm.getX(i) * push;
      out[i * 3 + 1] = pos.getY(i) + nrm.getY(i) * push;
      out[i * 3 + 2] = pos.getZ(i) + nrm.getZ(i) * push;
    }
    g.setAttribute('position', new THREE.BufferAttribute(out, 3));
    if (geo.index) g.setIndex(geo.index.clone());
    g.computeBoundingSphere();
    this.h.geometries.push(g);
    this.shellGeo.set(key, g);
    return g;
  }

  /** Dress a pillar slot with its kit body once the kit has landed. */
  private dressPillar(s: PillarSlot): void {
    const url = s.risen ? SMITH_HEART_ROCK_KIT_URL : SMITH_HEART_HAMMER_KIT_URL;
    const piece = s.risen ? NEEDLE_PIECES[Math.floor(fxHash(s.id, 5) * 2) % 2] : COLUMN_PIECE;
    const key = `${url}|${piece}`;
    if (s.bodyKey === key && s.body) return;
    if (!heartKitLoaded(url)) return;
    const box = this.boxOf(url, piece);
    const mesh = heartKitMeshes(url, piece);
    if (!box || !mesh) return;
    if (s.body) s.bodyYaw.remove(s.body);
    // Scaled to its wall (the column stands at its own size: the static
    // plan's), its foot a hand into the floor.
    const size = new THREE.Vector3();
    box.getSize(size);
    let sx = 1;
    let sy = 1;
    if (s.risen) {
      sx = (RISEN_RADIUS * 2) / Math.max(0.1, Math.max(size.x, size.z));
      sy = RISEN_HEIGHT / Math.max(0.1, size.y);
    }
    mesh.scale.set(sx, sy, sx);
    mesh.position.y = -box.min.y * sy - (s.risen ? 0.6 : 0);
    for (const c of mesh.children) if (c instanceof THREE.Mesh) c.castShadow = this.h.detail;
    s.bodyYaw.add(mesh);
    s.body = mesh;
    s.bodyKey = key;
    s.fallback.visible = false;
    s.height = size.y * sy;
    s.radius = (Math.max(size.x, size.z) * sx) / 2;
    const shell = this.shellOf(url, piece, sx);
    if (shell) {
      s.shell.geometry = shell;
      s.shell.scale.copy(mesh.scale);
      s.shell.position.copy(mesh.position);
      // About one seam cell every 1.3 yd of stone.
      s.shellMat.uniforms.uFreq.value = sx / 1.3;
    }
  }

  seePillar(e: Entity, integrity: number, risen: boolean, soul: CouncilRole | null = null): void {
    let s = this.pillars.find((p) => p.id === e.id && p.state === 'standing');
    if (!s) {
      s = this.pillars.find((p) => p.state === 'idle');
      if (!s) return;
      s.id = e.id;
      this.setSoul(s, null);
      s.state = 'standing';
      s.risen = risen;
      s.integrity = integrity;
      s.x = e.pos.x;
      s.z = e.pos.z;
      s.y = this.h.groundY(e.pos.x, e.pos.z);
      s.rot = risen ? fxHash(e.id, 3) * Math.PI * 2 : this.columnRot(e);
      const rising = this.pendingRise.delete(e.id);
      s.riseAt = -99;
      s.crackAt = -99;
      s.grit = 0;
      s.bodyKey = '';
      if (s.body) {
        s.bodyYaw.remove(s.body);
        s.body = null;
      }
      s.height = risen ? RISEN_HEIGHT : 12.6;
      s.radius = risen ? RISEN_RADIUS : 2.25;
      s.fallback.visible = true;
      s.fallback.scale.set(s.radius, s.height, s.radius);
      s.holder.position.set(s.x, s.y, s.z);
      s.leanYaw.rotation.y = pillarLeanYaw(e.id);
      s.bodyYaw.rotation.y = s.rot - s.leanYaw.rotation.y;
      s.holder.visible = true;
      // Round the foot: a carved column's just past its socket's rim.
      s.pips.scale.setScalar(risen ? 2.55 : 3.95);
      // Its rise arrived before the scan saw it: burst out now.
      if (rising) this.startRise(s);
    }
    s.seen = true;
    s.integrity = integrity;
    if (s.soul !== soul) this.setSoul(s, soul);
    this.dressPillar(s);
  }

  /** Light a pillar with a soul's colours (or put the stone's own back). */
  private setSoul(s: PillarSlot, soul: CouncilRole | null): void {
    if (s.soul === 'slabwright' && soul !== 'slabwright') this.slabs.detach(s.id);
    s.soul = soul;
    const u = s.shellMat.uniforms;
    const pu = s.pipsMat.uniforms;
    if (soul) {
      const c = SOUL_COLORS[soul];
      (u.uCore.value as THREE.Color).setRGB(c.core[0], c.core[1], c.core[2]);
      (u.uEdge.value as THREE.Color).setRGB(c.edge[0], c.edge[1], c.edge[2]);
      (pu.uOn.value as THREE.Color).setHex(c.hex);
      (s.soulGlowMat.uniforms.uColor.value as THREE.Color).setHex(c.hex);
      s.soulGlow.visible = s.state === 'standing';
    } else {
      (u.uCore.value as THREE.Color).setRGB(C.crackCore[0], C.crackCore[1], C.crackCore[2]);
      (u.uEdge.value as THREE.Color).setRGB(C.crackEdge[0], C.crackEdge[1], C.crackEdge[2]);
      (pu.uOn.value as THREE.Color).setHex(C.pipLit);
      s.soulGlow.visible = false;
    }
  }

  /** The soul pillar standing (or just fallen) at (x, z), if any. */
  private soulSlotNear(x: number, z: number, reach = 2.5): PillarSlot | null {
    let best: PillarSlot | null = null;
    let bestD = reach;
    for (const s of this.pillars) {
      if (s.state === 'idle' || !s.soul) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** The soul's stream arrived: the soul wakes in its stone. */
  soulAwake(id: number, soul: CouncilRole): void {
    const s = this.pillars.find((p) => p.id === id && p.state === 'standing');
    if (!s) return;
    if (s.soul !== soul) this.setSoul(s, soul);
    s.crackAt = this.h.now();
    this.h.particles.puff(s.x, s.y + s.height * 0.5, s.z, 26, {
      speed: 4,
      up: 2,
      life: 1.1,
      size: [1.6, 4.4],
      color: SOUL_RGB[soul],
      alpha: 0.85,
      pool: 'glow',
      radius: s.radius,
    });
    this.h.particles.shockRing(s.x, s.z, SOUL_COLORS[soul].hex, s.radius + 6, 0.8);
    this.h.particles.shockRing(s.x, s.z, 0xfff4e0, s.radius + 2.5, 0.45);
    this.h.shakeNear(s.x, s.z, 0.3, 35);
  }

  /** `heart_council_soul_pip`: a soul pip struck off. */
  soulPip(id: number): void {
    const s = this.pillars.find((p) => p.id === id && p.state === 'standing');
    if (!s?.soul) return;
    this.crack(s);
    // The pip's light tears out of the stone's foot.
    this.h.particles.puff(s.x, s.y + 0.6, s.z, 18, {
      speed: 7,
      up: 1.5,
      life: 0.7,
      size: [0.9, 0.25],
      color: SOUL_RGB[s.soul],
      alpha: 1,
      pool: 'glow',
      radius: s.radius,
    });
    this.h.particles.shockRing(s.x, s.z, SOUL_COLORS[s.soul].hex, s.radius + 3.5, 0.5);
  }

  /** `heart_council_soul_burst`: the soul pillar bursts, its soul climbing
   *  out of the stone (its own collapse follows on the same frame). */
  soulBurstAt(x: number, z: number): void {
    const s = this.soulSlotNear(x, z);
    const soul = s?.soul ?? null;
    if (!s || !soul) return;
    const y = this.h.groundY(x, z);
    const rgb = SOUL_RGB[soul];
    const h = s.height;
    this.h.particles.puff(x, y + h * 0.5, z, 40, {
      speed: 6,
      up: 3,
      life: 1.4,
      size: [2, 6],
      color: rgb,
      alpha: 0.9,
      pool: 'glow',
      radius: 2.5,
    });
    // The soul dissipating: a slow column of its light climbing away.
    const n = Math.round(44 * this.h.density);
    _soulMote.color = rgb;
    for (let i = 0; i < n; i++) {
      const a = this.h.rand() * Math.PI * 2;
      const r = this.h.rand() * 2.5;
      _soulMote.up = 3 + this.h.rand() * 4;
      _soulMote.life = 2 + this.h.rand() * 1.5;
      this.h.particles.puff(
        x + Math.sin(a) * r,
        y + this.h.rand() * h,
        z + Math.cos(a) * r,
        1,
        _soulMote,
      );
    }
    this.h.particles.shockRing(x, z, SOUL_COLORS[soul].hex, 12, 1);
    this.h.particles.shockRing(x, z, 0xffffff, 6, 0.5);
    this.h.shakeNear(x, z, 0.5, 50);
  }

  /** A carved column's yaw: its socket's (the static plan's). */
  private columnRot(e: Entity): number {
    const def = DUNGEONS[SMITH_HEART];
    if (!def) return 0;
    const o = instanceOrigin(def.index, instanceSlotForZ(e.pos.z));
    let best = 0;
    let bestD = 4;
    for (const s of QUARRY_PILLAR_SPOTS) {
      const d = Math.hypot(e.pos.x - o.x - s.x, e.pos.z - o.z - s.z);
      if (d < bestD) {
        bestD = d;
        best = s.rot;
      }
    }
    return best;
  }

  startRise(s: PillarSlot): void {
    s.riseAt = this.h.now();
    const n = Math.round(28 * this.h.density);
    for (let i = 0; i < n; i++) {
      const a = this.h.rand() * Math.PI * 2;
      const sp = 4 + this.h.rand() * 9;
      this.h.debris.throw(
        s.x + Math.sin(a) * s.radius,
        s.y + 0.4,
        s.z + Math.cos(a) * s.radius,
        Math.sin(a) * sp,
        6 + this.h.rand() * 9,
        Math.cos(a) * sp,
        0.25 + this.h.rand() * 0.6,
      );
    }
    this.h.particles.puff(s.x, s.y + 0.6, s.z, 22, {
      speed: 6,
      up: 1.4,
      life: 2,
      size: [2, 6],
      color: C.dust,
      alpha: 0.5,
      drag: 1.6,
      radius: s.radius,
    });
    this.h.particles.puff(s.x, s.y + 1, s.z, 10, {
      speed: 3,
      up: 3,
      life: 0.5,
      size: [1.6, 4],
      color: C.flash,
      alpha: 0.6,
      pool: 'glow',
      radius: s.radius,
    });
    this.h.particles.shockRing(s.x, s.z, 0xffc27a, T.riseKnockRadius + 1.5, 0.4);
    this.h.shakeNear(s.x, s.z, 0.35, 35);
  }

  crack(s: PillarSlot): void {
    s.crackAt = this.h.now();
    const top = s.y + s.height * (0.4 + this.h.rand() * 0.5);
    const n = Math.round(10 * this.h.density);
    for (let i = 0; i < n; i++) {
      const a = this.h.rand() * Math.PI * 2;
      this.h.debris.throw(
        s.x + Math.sin(a) * s.radius,
        top,
        s.z + Math.cos(a) * s.radius,
        Math.sin(a) * 3,
        1 + this.h.rand() * 3,
        Math.cos(a) * 3,
        0.2 + this.h.rand() * 0.35,
      );
    }
    this.h.particles.puff(s.x, top, s.z, 10, {
      speed: 2,
      life: 1.5,
      size: [1, 3],
      color: C.dust,
      alpha: 0.45,
      radius: s.radius,
      gravity: 2,
    });
    this.h.shakeNear(s.x, s.z, 0.15, 25);
  }

  /** A pillar fell (its object is gone): the nearest standing slot falls. */
  collapseAt(x: number, z: number, r: number): void {
    let best: PillarSlot | null = null;
    let bestD = 1.5;
    for (const s of this.pillars) {
      if (s.state !== 'standing') continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    const y = this.h.groundY(x, z);
    if (best) {
      this.slabs.detach(best.id);
      best.state = 'falling';
      best.endAt = this.h.now();
      best.id = -1;
    }
    const n = Math.round(54 * this.h.density * (this.h.reducedMotion() ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const a = this.h.rand() * Math.PI * 2;
      const h = this.h.rand() * (best ? best.height : 10);
      const sp = 2 + this.h.rand() * 7;
      this.h.debris.throw(
        x + Math.sin(a) * r * 0.5,
        y + h,
        z + Math.cos(a) * r * 0.5,
        Math.sin(a) * sp,
        1 + this.h.rand() * 5,
        Math.cos(a) * sp,
        0.3 + this.h.rand() * 0.9,
      );
    }
    this.h.particles.puff(x, y + 2, z, 30, {
      speed: 6,
      up: 1,
      life: 3,
      size: [3, 9],
      color: C.dust,
      alpha: 0.55,
      drag: 1.4,
      radius: r * 0.7,
    });
    this.h.particles.puff(x, y + 4, z, 12, {
      speed: 4,
      life: 0.5,
      size: [2, 5],
      color: C.flash,
      alpha: 0.6,
      pool: 'glow',
      radius: 1.5,
    });
    this.h.particles.shockRing(x, z, 0xc89a66, r + 4, 0.8);
    this.h.shakeNear(x, z, 0.6, 50);
  }

  /** A pillar left without a fall (a reset, the council's fall): it sinks. */
  private sinkPillar(s: PillarSlot): void {
    this.slabs.detach(s.id);
    s.state = 'sinking';
    s.endAt = this.h.now();
    s.id = -1;
  }

  settleAt(x: number, z: number): void {
    const y = this.h.groundY(x, z);
    this.h.particles.puff(x, y + 0.5, z, 16, {
      speed: 3,
      up: 0.6,
      life: 2.4,
      size: [2, 5],
      color: C.dust,
      alpha: 0.45,
      radius: 2,
    });
  }

  updatePillars(dt: number): void {
    for (const s of this.pillars) {
      if (s.state === 'idle') continue;
      const look = pillarLook(s.integrity, s.risen);
      let sunk = 0;
      let jitter = 0;
      let tip = 0;
      if (s.state === 'standing' && s.soul) {
        this.updateSoul(s, dt);
        continue;
      }
      if (s.state === 'standing') {
        const rise = pillarRise(this.h.now() - s.riseAt, _rise);
        sunk = rise.sunk;
        jitter = rise.shudder;
        const hum = resonanceShake(this.humming.get(s.id) ?? 0, this.h.now(), _hum);
        jitter += hum.jitter;
        const flash = crackFlash(this.h.now() - s.crackAt);
        const humShare = this.humming.get(s.id) ?? 0;
        s.shellMat.uniforms.uCrack.value = Math.max(
          look.crack,
          flash > 0 ? 0.3 : 0,
          humShare * 0.35,
        );
        s.shellMat.uniforms.uHeat.value = look.heat + hum.heat;
        s.shellMat.uniforms.uFlash.value = flash;
        s.shell.visible = s.body !== null && (look.crack > 0 || flash > 0 || hum.heat > 0);
        s.pipsMat.uniforms.uLit.value = pillarPips(s.integrity, s.risen);
        s.pipsMat.uniforms.uSlots.value = pillarPipSlots(s.risen);
        s.pipsMat.uniforms.uFlash.value = flash;
        s.pips.visible = true;
        this.paintSockets(
          s,
          pillarPipSlots(s.risen),
          pillarPips(s.integrity, s.risen),
          C.pipLit,
          flash,
        );
        // Grit off a cracked pillar.
        if (look.grit > 0 && this.h.density > 0.5) {
          s.grit += dt * look.grit;
          while (s.grit >= 1) {
            s.grit -= 1;
            const a = this.h.rand() * Math.PI * 2;
            this.h.particles.puff(
              s.x + Math.sin(a) * s.radius,
              s.y + s.height * (0.5 + this.h.rand() * 0.45),
              s.z + Math.cos(a) * s.radius,
              1,
              PILLAR_GRIT,
            );
          }
        }
      } else if (s.state === 'falling') {
        const fall = pillarFall(this.h.now() - s.endAt);
        tip = fall.tip;
        sunk = fall.sunk;
        s.pips.visible = false;
        this.sockets.hide(s.index);
        if (s.soul) s.soulGlowMat.uniforms.uAlpha.value = Math.max(0, 0.6 * fall.alpha);
        s.shellMat.uniforms.uCrack.value = 1;
        s.shellMat.uniforms.uHeat.value = 1.3;
        s.shell.visible = s.body !== null;
        if (fall.alpha <= 0) {
          this.retirePillar(s);
          continue;
        }
      } else {
        const t = Math.min(1, (this.h.now() - s.endAt) / PILLAR_SETTLE_SECONDS);
        sunk = t * t;
        s.pips.visible = false;
        this.sockets.hide(s.index);
        if (t >= 1) {
          this.retirePillar(s);
          continue;
        }
      }
      s.lean.rotation.x = look.lean + tip;
      // Reduced motion keeps the lean and the sink, never the shudder.
      if (this.h.reducedMotion()) jitter = 0;
      s.leanYaw.position.set(
        jitter ? (this.h.rand() - 0.5) * 2 * jitter : 0,
        -sunk * s.height,
        jitter ? (this.h.rand() - 0.5) * 2 * jitter : 0,
      );
    }
  }

  /** A pillar's sockets round its foot, where its floor ring's arcs lie. */
  private paintSockets(
    s: PillarSlot,
    slots: number,
    lit: number,
    hex: number,
    flash: number,
    out = 0,
  ): void {
    const p = s.holder.position;
    // `out`: past the Walking Slab's collar and claws, so its pips show.
    this.sockets.paint(
      s.index,
      p.x,
      s.y,
      p.z,
      s.pips.scale.x * 1.08 + out,
      slots,
      lit,
      hex,
      flash,
      this.h.now(),
    );
  }

  private retirePillar(s: PillarSlot): void {
    this.sockets.hide(s.index);
    s.state = 'idle';
    s.id = -1;
    s.holder.visible = false;
    s.shell.visible = false;
    this.setSoul(s, null);
  }

  /** A standing soul pillar's frame: its cracks lit in the soul's colour,
   *  the sheath of light, its three pips; the Walking Slab followed (eased)
   *  every frame, grinding and trailing dust. Every tier draws the cracks,
   *  the sheath and the pips; only the motes and the dust thin. */
  private updateSoul(s: PillarSlot, dt: number): void {
    const soul = s.soul as CouncilRole;
    const now = this.h.now();
    let jitter = 0;
    let rock = 0;
    if (soul === 'slabwright') {
      const e = s.id >= 0 ? this.h.entity(s.id) : undefined;
      if (e) {
        const k = 1 - Math.exp(-dt * 10);
        const nx = s.x + (e.pos.x - s.x) * k;
        const nz = s.z + (e.pos.z - s.z) * k;
        const dx = nx - s.x;
        const dz = nz - s.z;
        const step = Math.hypot(dx, dz);
        s.x = nx;
        s.z = nz;
        s.y = this.h.groundY(nx, nz);
        if (!this.slabs.has(s.id)) this.slabs.attach(s.id, s, s.risen, s.x, s.z);
        if (this.slabs.follow(s.id, s.x, s.z, dx, dz, dt, _slab)) {
          // Its own walk: the face to the heading, the stone rocking forward
          // and lurching on each pull (its sim spot never moves for it).
          s.leanYaw.rotation.y = _slab.heading;
          s.bodyYaw.rotation.y = s.rot - _slab.heading;
          rock = _slab.rock;
          s.holder.position.set(
            s.x + Math.sin(_slab.heading) * _slab.lurch,
            s.y,
            s.z + Math.cos(_slab.heading) * _slab.lurch,
          );
        } else {
          s.holder.position.set(s.x, s.y, s.z);
          // Until the kit is in: the stone grinds round as it drags.
          if (step > 1e-4) s.bodyYaw.rotation.y += (step / Math.max(1, s.radius)) * 0.35;
        }
        if (step > 1e-4) {
          jitter = 0.03;
          s.grit += dt * 16 * this.h.density;
          while (s.grit >= 1) {
            s.grit -= 1;
            const a = this.h.rand() * Math.PI * 2;
            this.h.particles.puff(
              s.x + Math.sin(a) * s.radius,
              s.y + 0.3,
              s.z + Math.cos(a) * s.radius,
              1,
              _dust,
            );
          }
        }
      }
    }
    const charge = this.charge.get(s.id) ?? 0;
    const look = soulPillarLook(s.integrity, now, charge, _soul);
    const flash = crackFlash(now - s.crackAt);
    const rise = pillarRise(now - s.riseAt, _rise);
    s.shellMat.uniforms.uCrack.value = look.crack;
    s.shellMat.uniforms.uHeat.value = look.heat;
    s.shellMat.uniforms.uFlash.value = flash;
    s.shell.visible = s.body !== null;
    s.soulGlow.visible = true;
    s.soulGlow.scale.set(s.radius * 1.12, s.height * 1.02, s.radius * 1.12);
    s.soulGlowMat.uniforms.uAlpha.value = look.glow * (1 + flash * 1.5);
    s.pipsMat.uniforms.uLit.value = s.integrity;
    s.pipsMat.uniforms.uSlots.value = T.soulPips;
    s.pipsMat.uniforms.uFlash.value = flash;
    s.pips.visible = true;
    this.paintSockets(
      s,
      T.soulPips,
      s.integrity,
      SOUL_COLORS[soul].hex,
      flash,
      soul === 'slabwright' ? 0.9 : 0,
    );
    // Its light rising off the cracks.
    if (this.h.density > 0.5) {
      s.motes += dt * (6 + charge * 18);
      _soulMote.color = SOUL_RGB[soul];
      _soulMote.up = 2.2;
      _soulMote.life = 1.6;
      while (s.motes >= 1) {
        s.motes -= 1;
        const a = this.h.rand() * Math.PI * 2;
        this.h.particles.puff(
          s.x + Math.sin(a) * s.radius * 1.05,
          s.y + s.height * this.h.rand() * 0.9,
          s.z + Math.cos(a) * s.radius * 1.05,
          1,
          _soulMote,
        );
      }
    }
    jitter += rise.shudder + charge * 0.04;
    if (this.h.reducedMotion()) jitter = 0;
    s.lean.rotation.x = rock;
    s.leanYaw.position.set(
      jitter ? (this.h.rand() - 0.5) * 2 * jitter : 0,
      -rise.sunk * s.height,
      jitter ? (this.h.rand() - 0.5) * 2 * jitter : 0,
    );
  }

  seeRubble(e: Entity): void {
    let r = this.rubble.find((q) => q.id === e.id);
    if (!r) {
      r = this.rubble.find((q) => q.id < 0);
      if (!r) return;
      r.id = e.id;
      r.r = e.scale > 0 ? e.scale : 4;
      r.x = e.pos.x;
      r.z = e.pos.z;
      r.y = this.h.groundY(r.x, r.z);
      r.group.position.set(r.x, r.y, r.z);
      r.group.rotation.y = fxHash(e.id, 9) * Math.PI * 2;
      r.group.visible = true;
      r.fan.group.visible = true;
      this.h.kit.drapeFan(r.fan, this.h.groundY, r.x, r.y, r.z, 0, r.r);
    }
    // Dressed on every scan until both kits have given their piece (a kit
    // that lands after the pile was first seen still fills it in).
    if (!r.hasScatter || !r.hasPile) this.dressRubble(r);
    if (r.pieces) r.pieces.scale.setScalar(Math.max(0.6, r.r / 3.4));
    r.seenAt = this.h.now();
  }

  private dressRubble(r: RubbleSlot): void {
    if (!r.pieces) {
      r.pieces = new THREE.Group();
      r.group.add(r.pieces);
    }
    if (!r.hasScatter && heartKitLoaded(SMITH_HEART_HEART_KIT_URL)) {
      const scatter = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, 'Kit_RubbleScatter');
      if (scatter) r.pieces.add(scatter);
      r.hasScatter = true;
    }
    if (!r.hasPile && heartKitLoaded(SMITH_HEART_HAMMER_KIT_URL)) {
      const pile = heartKitMeshes(SMITH_HEART_HAMMER_KIT_URL, 'Kit_RubblePile');
      if (pile) {
        pile.position.set(0.6, 0, -0.4);
        r.pieces.add(pile);
      }
      r.hasPile = true;
    }
  }

  private dropRubble(r: RubbleSlot): void {
    this.h.particles.puff(r.x, r.y + 0.4, r.z, 10, {
      speed: 2,
      life: 1.6,
      size: [1.5, 3.5],
      color: C.dust,
      alpha: 0.35,
      radius: r.r * 0.7,
    });
    r.id = -1;
    r.group.visible = false;
    r.fan.group.visible = false;
  }

  updateRubble(): void {
    for (const r of this.rubble) {
      if (r.id < 0) continue;
      // A standing hazard: the footprint full, its warning breathing.
      _rubblePaint.clock = this.h.now();
      _rubblePaint.range = r.r;
      this.h.kit.paintFan(r.fan, _rubblePaint);
    }
  }
}
