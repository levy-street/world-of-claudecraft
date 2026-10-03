// The Drowned Temple's encounter visuals (plan: temple_fx_core.ts):
//  - a floor mark under every cast you dodge or kick, filling as its bar runs:
//    the Templeguard's Trident Sweep and the Snapper's Snap cones, the Eel's
//    Static Coil ring, a kick glyph under a Lullaby or a Call the Tide; the
//    Hydra's Tide Breath cones, the Colossus's Moonlight Lance lane and
//    Resonant Slam ring, Ysolei's Lunar Tide ring and the Undertow's crash
//    ring, a glyph under Selthe's Sea-Song;
//  - Selthe's marks round their players: a GOLD ring that gathers (Chorus:
//    stack in it) and a COLD BLUE ring that scatters (Solo: take it away);
//  - the encounter objects' circles: the Brine Spit pools and the heroic
//    echoes filling to their burst, the Riptide whirls;
//  - the Rising Tide: a silver-teal flood over the island's flooded half, a
//    shimmer on the half about to flood;
//  - a thread of moonlight from every Tideglass Reflection to the player it
//    mirrors, and the Mere Hydra's one body (temple_hydra.ts).
// Every shape is the shared floor telegraph (../floor_telegraph).
//
// Rules (src/render/CLAUDE.md): pooled geometry and materials built once,
// attached through the compile gate, no per-frame allocation in the pools.
// The telegraphs are ACTIONABLE: their footprint draws on every tier; only
// the curtains, motes and flashes shed on the low tier. Everything is derived
// from IWorld entity state, so offline and online look the same.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import { MOON_ALTAR } from '../../sim/content/drowned_temple_layout';
import {
  HYDRA_TUNING,
  POOL,
  REFLECTION_ID,
  TSUNAMI_TEMPLATES,
  tideStateOf,
} from '../../sim/encounters/drowned_temple/ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { type TelegraphFan, TelegraphKit, type TelegraphLane } from '../floor_telegraph';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { setRenderCategory } from '../renderer_diagnostics';
import {
  TEMPLE_ACCENTS,
  TEMPLE_MARK_SPECS,
  TEMPLE_OBJECT_SPECS,
  type TempleTelegraphSpec,
  templeTelegraphFill,
  templeTelegraphSpecs,
  templeTimedFill,
  tideLook,
} from './temple_fx_core';
import { TempleHydra } from './temple_hydra';
import { TempleYsoleiFx } from './temple_ysolei_fx';

const FAN_SLOTS = 14;
const LANE_SLOTS = 6;
const OBJECT_SLOTS = 12;
const MARK_SLOTS = 6;
const TETHER_SLOTS = 6;
const SCAN_SEC = 0.1;

interface CastSlot extends TelegraphFan {
  casterId: number;
  castId: string;
}

interface LaneSlot extends TelegraphLane {
  casterId: number;
  castId: string;
}

interface ObjectSlot extends TelegraphFan {
  objectId: number;
  since: number;
}

interface MarkSlot extends TelegraphFan {
  playerId: number;
  auraId: string;
}

interface TideSlot extends TelegraphFan {
  objectId: number;
}

interface WaveSlot extends TelegraphFan {
  objectId: number;
  since: number;
}

export class TempleFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly specs = templeTelegraphSpecs();
  private readonly casts: CastSlot[] = [];
  private readonly lanes: LaneSlot[] = [];
  private readonly objects: ObjectSlot[] = [];
  private readonly marks: MarkSlot[] = [];
  private readonly tides: TideSlot[] = [];
  private readonly waves: WaveSlot[] = [];
  private readonly tethers: THREE.Line[] = [];
  private readonly tetherPairs: [number, number][] = [];
  private readonly kit: TelegraphKit;
  private readonly hydra: TempleHydra;
  private readonly ysolei: TempleYsoleiFx;
  private readonly flashesOn: boolean;
  private scan = 0;
  private clock = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  ) {
    this.root.name = 'drowned-temple-telegraphs';
    setRenderCategory(this.root, 'ui3d');
    this.flashesOn =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.kit = new TelegraphKit(this.root, this.flashesOn);
    for (let i = 0; i < FAN_SLOTS; i++)
      this.casts.push({ ...this.kit.fan(18), casterId: -1, castId: '' });
    for (let i = 0; i < LANE_SLOTS; i++)
      this.lanes.push({ ...this.kit.lane(18), casterId: -1, castId: '' });
    for (let i = 0; i < OBJECT_SLOTS; i++)
      this.objects.push({ ...this.kit.fan(16), objectId: -1, since: 0 });
    for (let i = 0; i < MARK_SLOTS; i++)
      this.marks.push({ ...this.kit.fan(20), playerId: -1, auraId: '' });
    for (let i = 0; i < 2; i++) this.tides.push({ ...this.kit.fan(12), objectId: -1 });
    // The Mere Hydra's Tsunami: the half of the pool the wave will roll over.
    for (let i = 0; i < 2; i++) this.waves.push({ ...this.kit.fan(16), objectId: -1, since: 0 });
    const tetherMat = new THREE.LineBasicMaterial({
      color: 0xdde8f5,
      transparent: true,
      opacity: 0.8,
      name: 'drownedTempleReflectionTether',
    });
    for (let i = 0; i < TETHER_SLOTS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, tetherMat);
      line.frustumCulled = false;
      line.visible = false;
      line.renderOrder = 12;
      this.root.add(line);
      this.tethers.push(line);
      this.tetherPairs.push([-1, -1]);
    }
    const hydraRoot = new THREE.Group();
    hydraRoot.name = 'drowned-temple-hydra';
    this.root.add(hydraRoot);
    this.hydra = new TempleHydra(hydraRoot, world, this.flashesOn, groundY);
    this.ysolei = new TempleYsoleiFx(this.root, scene, world, groundY, this.flashesOn);
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  handleEvent(ev: SimEvent): boolean {
    this.hydra.handleEvent(ev);
    this.ysolei.handleEvent(ev);
    return false;
  }

  private spec(castId: string): TempleTelegraphSpec | undefined {
    return this.specs[castId];
  }

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanWorld(world);
    }
    this.hydra.update(dt, this.clock);
    this.ysolei.update(dt, this.clock);
    for (const slot of this.casts) {
      if (slot.casterId < 0) continue;
      const caster = world.entities.get(slot.casterId);
      const spec = this.spec(slot.castId);
      if (!caster || caster.dead || caster.castingAbility !== slot.castId || !spec) {
        slot.casterId = -1;
        slot.group.visible = false;
        continue;
      }
      const fill = templeTelegraphFill(caster.castRemaining, caster.castTotal);
      const yaw = spec.shape === 'sigil' ? this.clock * 1.4 : caster.facing;
      const x = caster.pos.x;
      const z = caster.pos.z;
      this.kit.drapeFan(slot, this.groundY, x, this.groundY(x, z), z, yaw, spec.range);
      this.kit.paintFan(slot, { fill, clock: this.clock, range: spec.range });
    }
    for (const slot of this.lanes) {
      if (slot.casterId < 0) continue;
      const caster = world.entities.get(slot.casterId);
      const spec = this.spec(slot.castId);
      if (!caster || caster.dead || caster.castingAbility !== slot.castId || !spec) {
        slot.casterId = -1;
        slot.group.visible = false;
        continue;
      }
      const fill = templeTelegraphFill(caster.castRemaining, caster.castTotal);
      const x = caster.pos.x;
      const z = caster.pos.z;
      this.kit.drapeLane(
        slot,
        this.groundY,
        x,
        this.groundY(x, z),
        z,
        caster.facing,
        spec.range,
        spec.halfWidth ?? 1,
        {
          color: spec.color,
          accent: spec.accent,
        },
      );
      this.kit.paintLane(slot, { fill, clock: this.clock, range: spec.range });
    }
    for (const slot of this.objects) {
      if (slot.objectId < 0) continue;
      const obj = world.entities.get(slot.objectId);
      const spec = obj ? TEMPLE_OBJECT_SPECS[obj.templateId] : undefined;
      if (!obj || !spec) {
        slot.objectId = -1;
        slot.group.visible = false;
        continue;
      }
      const radius = obj.scale;
      const fill =
        spec.fillSeconds > 0
          ? templeTimedFill(this.clock - slot.since, spec.fillSeconds)
          : 0.55 + 0.25 * Math.sin(this.clock * 4);
      const yaw = spec.fillSeconds > 0 ? 0 : this.clock * 2.2;
      this.kit.drapeFan(
        slot,
        this.groundY,
        obj.pos.x,
        this.groundY(obj.pos.x, obj.pos.z),
        obj.pos.z,
        yaw,
        radius,
      );
      this.kit.paintFan(slot, { fill, clock: this.clock, range: radius });
    }
    for (const slot of this.marks) {
      if (slot.playerId < 0) continue;
      const p = world.entities.get(slot.playerId);
      const aura = p?.auras.find((a) => a.id === slot.auraId);
      const spec = TEMPLE_MARK_SPECS[slot.auraId];
      if (!p || p.dead || !aura || !spec) {
        slot.playerId = -1;
        slot.group.visible = false;
        continue;
      }
      const fill = templeTimedFill(spec.seconds - aura.remaining, spec.seconds);
      // Gather turns the glyph one way, scatter the other.
      const yaw = this.clock * (spec.gather ? 1.6 : -1.6);
      this.kit.drapeFan(
        slot,
        this.groundY,
        p.pos.x,
        this.groundY(p.pos.x, p.pos.z),
        p.pos.z,
        yaw,
        spec.radius,
      );
      this.kit.paintFan(slot, { fill, clock: this.clock, range: spec.radius });
    }
    for (const slot of this.tides) {
      if (slot.objectId < 0) continue;
      const obj = world.entities.get(slot.objectId);
      const state = obj ? tideStateOf(obj.templateId) : null;
      if (!obj || state === null) {
        slot.objectId = -1;
        slot.group.visible = false;
        continue;
      }
      const look = tideLook(state, this.clock);
      slot.group.visible = look.visible;
      if (!look.visible) continue;
      // A half-disc over the island, from the causeway line toward its half.
      const north = obj.facing < Math.PI / 2;
      const cx = obj.pos.x;
      const cz = obj.pos.z + (north ? -MOON_ALTAR.r * 0.5 : MOON_ALTAR.r * 0.5);
      const radius = MOON_ALTAR.r - 0.6;
      this.kit.drapeFan(
        slot,
        this.groundY,
        cx,
        this.groundY(cx, cz),
        cz,
        north ? 0 : Math.PI,
        radius,
      );
      this.kit.paintFan(slot, {
        fill: look.fill,
        clock: this.clock,
        range: radius,
        fade: look.fade,
      });
    }
    for (const slot of this.waves) {
      if (slot.objectId < 0) continue;
      const obj = world.entities.get(slot.objectId);
      if (
        !obj ||
        (obj.templateId !== TSUNAMI_TEMPLATES.warn && obj.templateId !== TSUNAMI_TEMPLATES.surge)
      ) {
        slot.objectId = -1;
        slot.group.visible = false;
        continue;
      }
      // Centred on the pool, opening toward the rim the wave stands on.
      const cx = obj.pos.x - Math.sin(obj.facing) * POOL.r;
      const cz = obj.pos.z - Math.cos(obj.facing) * POOL.r;
      const radius = POOL.r + 3;
      const fill =
        obj.templateId === TSUNAMI_TEMPLATES.surge
          ? 1
          : templeTimedFill(this.clock - slot.since, HYDRA_TUNING.tsunamiCast);
      this.kit.drapeFan(
        slot,
        this.groundY,
        cx,
        this.groundY(cx, cz),
        cz,
        obj.facing + Math.PI,
        radius,
      );
      this.kit.paintFan(slot, { fill, clock: this.clock, range: radius });
    }
    this.updateTethers(world);
  }

  private updateTethers(world: IWorld): void {
    for (let i = 0; i < this.tethers.length; i++) {
      const [rid, oid] = this.tetherPairs[i];
      const line = this.tethers[i];
      if (rid < 0) {
        line.visible = false;
        continue;
      }
      const r = world.entities.get(rid);
      const o = world.entities.get(oid);
      if (!r || !o || r.dead) {
        this.tetherPairs[i] = [-1, -1];
        line.visible = false;
        continue;
      }
      const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, r.pos.x, r.pos.y + 1.6, r.pos.z);
      pos.setXYZ(1, o.pos.x, o.pos.y + 1.2, o.pos.z);
      pos.needsUpdate = true;
      line.visible = true;
    }
  }

  private scanWorld(world: IWorld): void {
    for (const e of world.entities.values()) {
      if (e.kind === 'player') {
        for (const aura of e.auras) {
          const spec = TEMPLE_MARK_SPECS[aura.id];
          if (!spec) continue;
          if (this.marks.some((m) => m.playerId === e.id && m.auraId === aura.id)) continue;
          const slot = this.marks.find((m) => m.playerId < 0);
          if (!slot) continue;
          this.kit.layOutFan(slot, 360, { color: spec.color, accent: spec.accent, sigil: true });
          slot.playerId = e.id;
          slot.auraId = aura.id;
          slot.group.visible = true;
        }
        continue;
      }
      if (e.kind !== 'mob') {
        const objSpec = TEMPLE_OBJECT_SPECS[e.templateId];
        if (objSpec) {
          if (this.objects.some((o) => o.objectId === e.id)) continue;
          const slot = this.objects.find((o) => o.objectId < 0);
          if (!slot) continue;
          this.kit.layOutFan(slot, 360, { color: objSpec.color, accent: objSpec.accent });
          slot.objectId = e.id;
          slot.since = this.clock;
          slot.group.visible = true;
          continue;
        }
        if (e.templateId === TSUNAMI_TEMPLATES.warn || e.templateId === TSUNAMI_TEMPLATES.surge) {
          if (this.waves.some((w) => w.objectId === e.id)) continue;
          const slot = this.waves.find((w) => w.objectId < 0);
          if (!slot) continue;
          this.kit.layOutFan(slot, 180, { color: 0xff5a3c, accent: TEMPLE_ACCENTS.tide });
          slot.objectId = e.id;
          slot.since = this.clock;
          slot.group.visible = true;
          continue;
        }
        if (tideStateOf(e.templateId) !== null) {
          if (this.tides.some((t) => t.objectId === e.id)) continue;
          const slot = this.tides.find((t) => t.objectId < 0);
          if (!slot) continue;
          this.kit.layOutFan(slot, 180, { color: 0x6fe3e0, accent: TEMPLE_ACCENTS.moon });
          slot.objectId = e.id;
        }
        continue;
      }
      if (e.dead) continue;
      if (e.templateId.startsWith(REFLECTION_ID) && e.forcedTargetId !== null) {
        const have = this.tetherPairs.findIndex(([r]) => r === e.id);
        if (have >= 0) this.tetherPairs[have][1] = e.forcedTargetId;
        else {
          const free = this.tetherPairs.findIndex(([r]) => r < 0);
          if (free >= 0) this.tetherPairs[free] = [e.id, e.forcedTargetId];
        }
      }
      const castId = e.castingAbility;
      const spec = castId ? this.spec(castId) : undefined;
      if (!castId || !spec) continue;
      if (spec.shape === 'lane') {
        if (this.lanes.some((t) => t.casterId === e.id)) continue;
        const slot = this.lanes.find((t) => t.casterId < 0);
        if (!slot) continue;
        slot.casterId = e.id;
        slot.castId = castId;
        slot.group.visible = true;
        continue;
      }
      if (this.casts.some((t) => t.casterId === e.id)) continue;
      const slot = this.casts.find((t) => t.casterId < 0);
      if (!slot) continue;
      this.kit.layOutFan(slot, spec.arcDeg, {
        color: spec.color,
        accent: spec.accent,
        sigil: spec.shape === 'sigil',
      });
      slot.casterId = e.id;
      slot.castId = castId;
      slot.group.visible = true;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hydra.dispose();
    this.ysolei.dispose();
    this.root.removeFromParent();
    this.kit.dispose();
    for (const t of this.tethers) t.geometry.dispose();
  }
}
