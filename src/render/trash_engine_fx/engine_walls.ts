// The trash engine's temporary combat walls (plan: trash_engine_fx_core.ts
// wallBox / wallLife; body: ice_slab_geometry.ts), drawn from the wall objects
// the sim mirrors (template id = its shape in COMBAT_WALL_SHAPES, facing = its
// yaw, scale = its size): a hauled, cracked block of lake ice crashed into the
// snow, built to the very box the sim blocks movement and sight with. It
// crashes down on `trash_combat_wall_rise` (a burst of ice dust, shards and a
// shock ring), its cracks glow up over its last seconds, and on
// `trash_combat_wall_shatter` (a world-point event: the wall is gone that
// tick) it bursts into a storm of ice shards.
//
// The body is ACTIONABLE (it shows where the wall stops a player and a sight
// line): it draws on every tier; the glow shell's shimmer, the dust and the
// shards are cosmetic and thin on the low tier. Built once under the host's
// root before its gated attach; no light; no per-frame allocation.

import * as THREE from 'three';
import { COMBAT_WALL_SHAPES } from '../../sim/instances/combat_wall_state';
import type { Entity } from '../../sim/types';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { surfaceMat } from '../gfx';
import { buildIceSlabGeometry, buildIceSlabShellGeometry } from './ice_slab_geometry';
import { type WallLife, wallBox, wallLife } from './trash_engine_fx_core';
import type { TrashEngineHost } from './trash_engine_host';

const SLOTS = 6;
/** Seconds a vanished wall's spot is kept for its shatter (routed later). */
const GONE_KEEP = 0.5;
/** The fallback life of a wall with no leavesWall record (yards, seconds). */
const DEFAULT_SECONDS = 15;

const SHELL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
/** The cold light inside the ice: a faint fresnel rim, a low glow from the
 *  core, and crack lines that blaze up as the wall strains toward its
 *  shatter. Kept low while it stands, so the block reads as SOLID cover (a
 *  bright glassy glow read as a spell or as scenery in the playtest). */
const SHELL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrain;
uniform float uFade;
uniform float uHeight;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
float h31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h31(i), h31(i + vec3(1, 0, 0)), u.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), u.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
void main() {
  float fres = pow(max(1.0 - abs(dot(normalize(vN), normalize(vView))), 0.0), 2.2);
  float t = clamp(vLocal.y / uHeight, 0.0, 1.0);
  // Cracks: thin ridges of a noise field, more of them as it strains.
  float n = vnoise(vLocal * 1.6) * 0.65 + vnoise(vLocal * 3.7) * 0.35;
  float width = 0.025 + 0.05 * uStrain;
  float crack = 1.0 - smoothstep(0.0, width, abs(n - 0.5));
  float pulse = 0.75 + 0.25 * sin(uTime * (3.0 + uStrain * 14.0) + n * 9.0);
  vec3 core = vec3(0.35, 0.72, 1.0) * (0.07 + 0.06 * (1.0 - t));
  vec3 rim = vec3(0.75, 0.93, 1.0) * fres * 0.4;
  vec3 cracks = vec3(0.7, 0.92, 1.0) * crack * (0.25 + 1.6 * uStrain) * pulse;
  gl_FragColor = vec4((core + rim + cracks) * uFade, 1.0);
}
`;

interface WallSlot {
  wallId: number;
  templateId: string;
  since: number;
  seconds: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  height: number;
  group: THREE.Group;
  body: THREE.Mesh;
  shell: THREE.Mesh;
  shellMat: THREE.ShaderMaterial;
  stain: THREE.Mesh;
  /** A falling chip of ice now and then while it strains. */
  chip: number;
  /** When its entity left (its spot is kept a moment for the shatter). */
  goneAt: number;
}

export class EngineWalls {
  private readonly slots: WallSlot[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  /** Body and shell geometry per wall template, built once (scale 1). */
  private readonly bodyGeo = new Map<string, THREE.BufferGeometry>();
  private readonly shellGeo = new Map<string, THREE.BufferGeometry>();
  private readonly life: WallLife = { drop: 0, squash: 1, strain: 0 };
  private clock = 0;

  constructor(private readonly host: TrashEngineHost) {
    for (const templateId of Object.keys(COMBAT_WALL_SHAPES)) {
      const box = wallBox(templateId, 1);
      if (!box) continue;
      const body = buildIceSlabGeometry(box);
      const shell = buildIceSlabShellGeometry(box);
      this.bodyGeo.set(templateId, body);
      this.shellGeo.set(templateId, shell);
      this.geometries.push(body, shell);
    }
    const first = Object.keys(COMBAT_WALL_SHAPES)[0];
    const bodyMat = surfaceMat({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.2,
      metalness: 0.04,
      emissive: 0x16324a,
      flatShading: true,
    });
    const stainMat = new THREE.MeshBasicMaterial({
      map: host.glowTex,
      color: 0x0b1c2c,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      name: 'trashEngineWallStain',
    });
    this.materials.push(stainMat);
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.geometries.push(plane);
    for (let i = 0; i < SLOTS; i++) {
      const group = new THREE.Group();
      group.name = 'trashEngineWall';
      group.visible = false;
      const body = new THREE.Mesh(this.bodyGeo.get(first), bodyMat);
      body.name = 'trashEngineWallBody';
      body.castShadow = host.density >= 1;
      body.receiveShadow = true;
      group.add(body);
      const shellMat = new THREE.ShaderMaterial({
        name: 'trashEngineWallShell',
        uniforms: {
          uTime: host.uTime,
          uStrain: { value: 0 },
          uFade: { value: 1 },
          uHeight: { value: 3.4 },
        },
        vertexShader: SHELL_VERT,
        fragmentShader: SHELL_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      this.materials.push(shellMat);
      const shell = new THREE.Mesh(this.shellGeo.get(first), shellMat);
      shell.name = 'trashEngineWallShell';
      shell.renderOrder = floorVfxRenderOrder('encounter', 26);
      group.add(shell);
      host.root.add(group);
      // The meltwater stain round its foot, on the floor (not in the group: it
      // never tilts or squashes with the block).
      const stain = new THREE.Mesh(plane, stainMat);
      stain.visible = false;
      stain.renderOrder = floorVfxRenderOrder('encounter', 1);
      host.root.add(stain);
      this.slots.push({
        wallId: -1,
        templateId: '',
        since: 0,
        seconds: DEFAULT_SECONDS,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        scale: 1,
        height: 3.4,
        group,
        body,
        shell,
        shellMat,
        stain,
        chip: 0,
        goneAt: -1e9,
      });
    }
  }

  /** A wall object seen by the scan (joined mid-life: no crash-down). */
  scan(e: Entity): void {
    if (!this.bodyGeo.has(e.templateId)) return;
    if (this.slots.some((s) => s.wallId === e.id)) return;
    this.claim(e, false);
  }

  /** `trash_combat_wall_rise`: the wall crashes down now. */
  rise(e: Entity): void {
    if (!this.bodyGeo.has(e.templateId)) return;
    const slot = this.slots.find((s) => s.wallId === e.id) ?? this.claim(e, true);
    if (!slot) return;
    slot.since = this.clock;
    const h = this.host;
    const r = Math.max(slot.height, 3) * 1.4;
    // The impact lands as the block touches down (the drop is a fifth of a
    // second); the dust and shards are thrown now and read as the crash.
    h.shockRing(slot.x, slot.z, 0xd6f3ff, r * 1.4, 0.55);
    h.shockRing(slot.x, slot.z, 0x7fc4e8, r, 0.4);
    h.shards.burst(slot.x, slot.y + 0.6, slot.z, 46, {
      speed: 7,
      up: 6,
      size: [0.3, 1.1],
      radius: 1.8,
      iron: 0,
    });
    h.puff(slot.x, slot.y + 0.4, slot.z, 40, {
      speed: 6,
      up: 1.2,
      life: 1.8,
      size: [1.2, 3.6],
      color: [0.9, 0.95, 1],
      alpha: 0.55,
      radius: 1.8,
      drag: 2.8,
    });
    h.puff(slot.x, slot.y + 1, slot.z, 30, {
      speed: 5,
      up: 3,
      life: 0.9,
      size: [0.2, 0.05],
      color: [0.8, 0.94, 1],
      alpha: 1,
      pool: 'glow',
      gravity: 8,
      radius: 1.5,
    });
    if (!h.reducedMotion()) h.shake(0.28);
  }

  /** `trash_combat_wall_shatter` at (x, z): the wall is gone; burst it. */
  shatter(x: number, z: number): void {
    let slot: WallSlot | undefined;
    let best = Infinity;
    for (const s of this.slots) {
      if (s.wallId < 0 && this.clock - s.goneAt > GONE_KEEP) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < best) {
        best = d;
        slot = s;
      }
    }
    const h = this.host;
    const gy = h.groundY(x, z);
    const height = slot && best < 2 ? slot.height : 3.4;
    const yaw = slot && best < 2 ? slot.yaw : 0;
    // Shards from the whole body, thrown out of both broad faces hardest.
    for (const side of [-1, 1]) {
      h.shards.burst(x, gy + height * 0.55, z, 40, {
        speed: 9,
        up: 6,
        size: [0.45, 1.6],
        radius: 1.6,
        heading: yaw + (side > 0 ? 0 : Math.PI),
        spread: 1.2,
        iron: 0,
      });
    }
    h.shards.burst(x, gy + height * 0.8, z, 30, {
      speed: 5,
      up: 9,
      size: [0.3, 1],
      radius: 1.4,
      iron: 0,
    });
    h.shockRing(x, z, 0xd6f3ff, 7, 0.6);
    h.shockRing(x, z, 0x5ab8ff, 4.5, 0.4);
    h.puff(x, gy + height * 0.5, z, 46, {
      speed: 6,
      up: 1,
      life: 2,
      size: [1.2, 3.8],
      color: [0.9, 0.95, 1],
      alpha: 0.55,
      radius: 1.8,
      drag: 2.6,
    });
    h.puff(x, gy + height * 0.6, z, 40, {
      speed: 7,
      up: 2.5,
      life: 1,
      size: [0.24, 0.06],
      color: [0.75, 0.92, 1],
      alpha: 1,
      pool: 'glow',
      gravity: 6,
      radius: 1.6,
    });
    h.puff(x, gy + height * 0.5, z, 6, {
      speed: 0.5,
      up: 0.3,
      life: 0.35,
      size: [4.5, 1.5],
      color: [0.6, 0.86, 1],
      alpha: 1,
      pool: 'glow',
    });
    if (!h.reducedMotion()) h.shake(0.38);
    if (slot && best < 2) {
      this.release(slot);
      slot.goneAt = -1e9;
    }
  }

  private claim(e: Entity, rising: boolean): WallSlot | null {
    const slot = this.slots.find((s) => s.wallId < 0);
    const body = this.bodyGeo.get(e.templateId);
    const shell = this.shellGeo.get(e.templateId);
    const box = wallBox(e.templateId, 1);
    if (!slot || !body || !shell || !box) return null;
    slot.wallId = e.id;
    slot.templateId = e.templateId;
    slot.seconds = this.host.catalog.wallSeconds.get(e.templateId) ?? DEFAULT_SECONDS;
    // Seen mid-life (no rise event): standing, its age unknown.
    slot.since = rising ? this.clock : this.clock - 1;
    slot.body.geometry = body;
    slot.shell.geometry = shell;
    slot.shellMat.uniforms.uHeight.value = box.height;
    slot.height = box.height * (e.scale > 0 ? e.scale : 1);
    slot.chip = 0;
    this.place(slot, e);
    slot.group.visible = true;
    slot.stain.visible = true;
    return slot;
  }

  private place(slot: WallSlot, e: Entity): void {
    const s = e.scale > 0 ? e.scale : 1;
    slot.x = e.pos.x;
    slot.z = e.pos.z;
    slot.yaw = e.facing;
    slot.scale = s;
    slot.y = this.host.groundY(slot.x, slot.z);
    slot.group.rotation.y = slot.yaw;
    const box = wallBox(slot.templateId, s);
    if (box) {
      slot.stain.position.set(slot.x, slot.y + 0.05, slot.z);
      slot.stain.rotation.y = slot.yaw;
      slot.stain.scale.set(box.hw * 3.4, 1, box.hd * 3.6);
    }
  }

  update(dt: number, clock: number): void {
    this.clock = clock;
    const world = this.host.world;
    for (const slot of this.slots) {
      if (slot.wallId < 0) continue;
      const e = world.entities.get(slot.wallId);
      if (!e) {
        // Gone: its shatter may still be routed this frame, so the spot is
        // kept a moment (a reset or a wall out of interest simply goes).
        this.release(slot);
        slot.goneAt = clock;
        continue;
      }
      if (
        e.pos.x !== slot.x ||
        e.pos.z !== slot.z ||
        e.facing !== slot.yaw ||
        e.scale !== slot.scale
      )
        this.place(slot, e);
      const age = clock - slot.since;
      const life = wallLife(age, slot.seconds, slot.height, this.life);
      slot.group.position.set(slot.x, slot.y + life.drop, slot.z);
      slot.group.scale.set(slot.scale, slot.scale * life.squash, slot.scale);
      slot.shellMat.uniforms.uStrain.value = life.strain;
      // Straining: chips of ice and frost dust fall off it.
      if (life.strain > 0) {
        slot.chip += dt * life.strain * 9 * this.host.density;
        while (slot.chip >= 1) {
          slot.chip -= 1;
          const a = this.host.rand() * Math.PI * 2;
          this.host.puff(
            slot.x + Math.cos(a) * 1.4,
            slot.y + slot.height * (0.4 + this.host.rand() * 0.5),
            slot.z + Math.sin(a) * 1.4,
            1,
            {
              speed: 0.6,
              up: 0.2,
              life: 0.9,
              size: [0.12, 0.04],
              color: [0.85, 0.95, 1],
              alpha: 1,
              pool: 'glow',
              gravity: 9,
            },
          );
        }
      }
    }
  }

  private release(slot: WallSlot): void {
    slot.wallId = -1;
    slot.group.visible = false;
    slot.stain.visible = false;
  }

  hideAll(): void {
    for (const slot of this.slots) this.release(slot);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
