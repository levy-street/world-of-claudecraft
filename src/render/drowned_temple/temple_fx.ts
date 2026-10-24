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
//    mirrors, and the Mere Hydra's one body (temple_hydra.ts);
//  - Selthe's water magic (temple_selthe_fx.ts) and the Colossus's prism
//    slices, the Tideglass Fracture (temple_fracture_fx.ts);
//  - the encounter pass: the Hydra's Combined Breath, its Ice Wall, currents
//    and crystals (temple_hydra_combo_fx.ts), Ysolei's moon, its tears and
//    her Plenilune Ward (temple_moon_fx.ts), the Moonmantle Ray
//    (temple_manta_fx.ts) and the Moonbridge forming on the Colossus's beam
//    (temple_moonbridge_fx.ts);
//  - the trash mechanics pass (temple_trash_fx.ts): the Shrine Vigil, the
//    Moonset Oath, the Lullaby Echo, the Prism Glare, the Spiral Whirlpool,
//    the Arcing Spark and the Tidewisp's chill and Swollen Tide.
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
import { TempleCantorFinaleFx } from './temple_cantor_finale_fx';
import { TempleFractureFx } from './temple_fracture_fx';
import {
  isTemplePilgrimFrenzyCue,
  stepTempleShellStance,
  TEMPLE_ACCENTS,
  TEMPLE_MARK_SPECS,
  TEMPLE_MOONSPAWN_RISE,
  TEMPLE_OBJECT_SPECS,
  TEMPLE_PILGRIM_FRENZY_GESTURE,
  type TempleShellTrack,
  type TempleTelegraphSpec,
  templeMoonspawnRises,
  templeSentinelShellGesture,
  templeTelegraphFill,
  templeTelegraphSpecs,
  templeTimedFill,
  tideLook,
} from './temple_fx_core';
import { TempleHydra } from './temple_hydra';
import { TempleHydraComboFx } from './temple_hydra_combo_fx';
import { TempleLureFx } from './temple_lure_fx';
import { TempleMantaFx } from './temple_manta_fx';
import { TempleMoonFx } from './temple_moon_fx';
import { TempleMoonbridgeFx } from './temple_moonbridge_fx';
import { TempleSeltheFx } from './temple_selthe_fx';
import { TempleTrashFx } from './temple_trash_fx';
import { TempleYsoleiFx } from './temple_ysolei_fx';

const FAN_SLOTS = 14;
const LANE_SLOTS = 6;
// The Combined Breath's pools and crystals and Ysolei's tears (and the
// heroic moonlight they leave) can all stand with the venom at once.
const OBJECT_SLOTS = 18;
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
  // Laverock's finale: the fallen rising as moonlight while he sings.
  private readonly cantor: TempleCantorFinaleFx;
  private readonly selthe: TempleSeltheFx;
  private readonly fracture: TempleFractureFx;
  // The encounter pass: the Combined Breath, Ysolei's moon, the Moonmantle
  // Ray and the Moonbridge forming.
  private readonly combo: TempleHydraComboFx;
  private readonly moon: TempleMoonFx;
  private readonly manta: TempleMantaFx;
  private readonly bridge: TempleMoonbridgeFx;
  private readonly trash: TempleTrashFx;
  private readonly lure: TempleLureFx;
  private readonly flashesOn: boolean;
  /** Each living Pearlguard Sentinel's shell stance and when it changed. */
  private readonly shellStance = new Map<number, TempleShellTrack>();
  /** When each Moonspawn was first seen (its Rise is offered for a moment). */
  private readonly moonspawnSeen = new Map<number, number>();
  private scan = 0;
  private clock = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
    shake?: (amount: number) => void,
    reducedMotion?: () => boolean,
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
    this.cantor = new TempleCantorFinaleFx(this.root, world, this.flashesOn);
    const calm = reducedMotion ?? (() => false);
    this.selthe = new TempleSeltheFx(this.root, world, groundY, this.flashesOn, shake, calm);
    this.fracture = new TempleFractureFx(this.root, world, groundY, this.flashesOn, shake, calm);
    const kit = this.kit;
    const on = this.flashesOn;
    this.combo = new TempleHydraComboFx(this.root, world, groundY, on, kit, shake, calm);
    this.moon = new TempleMoonFx(this.root, world, groundY, on, kit, shake, calm);
    this.manta = new TempleMantaFx(this.root, world, groundY, on, kit, shake, calm);
    this.bridge = new TempleMoonbridgeFx(this.root, world, groundY, on, kit, shake, calm);
    this.trash = new TempleTrashFx(this.root, world, groundY, on, kit, shake, calm);
    this.lure = new TempleLureFx(this.root, world, groundY, on, kit, calm);
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {
        // Linked: the caster and fracture layers may sleep while idle now.
        this.selthe.markGated();
        this.fracture.markGated();
        this.combo.markGated();
        this.moon.markGated();
        this.manta.markGated();
        this.bridge.markGated();
        this.trash.markGated();
        this.lure.markGated();
      })
      .catch(() => {});
  }

  /** True when the temple claims the event (the renderer skips its generic draw). */
  handleEvent(ev: SimEvent): boolean {
    if (this.disposed) return false;
    this.hydra.handleEvent(ev);
    this.ysolei.handleEvent(ev);
    this.cantor.handleEvent(ev);
    if (this.selthe.handleEvent(ev) || this.fracture.handleEvent(ev)) return true;
    if (this.combo.handleEvent(ev) || this.moon.handleEvent(ev)) return true;
    if (this.manta.handleEvent(ev) || this.bridge.handleEvent(ev)) return true;
    if (this.trash.handleEvent(ev) || this.lure.handleEvent(ev)) return true;
    if (ev.type === 'spellfx') {
      const source = this.world?.entities.get(ev.sourceId);
      // Claimed only when the Frenzy can actually play (a host without the
      // gesture hook keeps the generic burst).
      if (this.playGesture && isTemplePilgrimFrenzyCue(ev, source?.templateId)) {
        this.playGesture(ev.sourceId, TEMPLE_PILGRIM_FRENZY_GESTURE);
        return true;
      }
    }
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
      this.pruneTracks(world);
    }
    this.hydra.update(dt, this.clock);
    this.ysolei.update(dt, this.clock);
    this.cantor.update(dt, this.clock);
    this.selthe.update(dt, this.clock);
    this.fracture.update(dt, this.clock);
    this.combo.update(dt, this.clock);
    this.moon.update(dt, this.clock);
    this.manta.update(dt, this.clock);
    this.bridge.update(dt, this.clock);
    this.trash.update(dt, this.clock);
    this.lure.update(dt, this.clock);
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
      if (this.playGesture && e.templateId === 'pearlguard_sentinel')
        this.updateShellStance(e.id, e.templateId, e.auras, e.dead);
      if (this.playGesture && e.templateId === 'moonspawn')
        this.offerMoonspawnRise(e.id, e.templateId, e.dead);
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

  /** The Sentinel's Pearl Carapace: its shell shuts over it while the ward
   *  holds and opens when it goes (a stance gesture on the rig's phaseClips;
   *  the step itself is temple_fx_core's stepTempleShellStance). */
  private updateShellStance(
    id: number,
    templateId: string,
    auras: readonly { id: string }[],
    dead: boolean,
  ): void {
    const want = templeSentinelShellGesture(templateId, auras, dead);
    const step = stepTempleShellStance(this.shellStance.get(id), want, this.clock);
    if (step.next) this.shellStance.set(id, step.next);
    else this.shellStance.delete(id);
    if (step.send) this.playGesture?.(id, step.send);
  }

  /** A Moonspawn climbing out of the shore: its Rise is offered for the first
   *  moment after it is seen (the rig plays it once). */
  private offerMoonspawnRise(id: number, templateId: string, dead: boolean): void {
    let seen = this.moonspawnSeen.get(id);
    if (seen === undefined) {
      seen = this.clock;
      this.moonspawnSeen.set(id, seen);
    }
    if (templeMoonspawnRises(templateId, dead, this.clock - seen))
      this.playGesture?.(id, TEMPLE_MOONSPAWN_RISE);
  }

  /** Drop the tracks of bodies that left the world (or interest range). */
  private pruneTracks(world: IWorld): void {
    for (const id of this.shellStance.keys())
      if (!world.entities.has(id)) this.shellStance.delete(id);
    for (const id of this.moonspawnSeen.keys())
      if (!world.entities.has(id)) this.moonspawnSeen.delete(id);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hydra.dispose();
    this.ysolei.dispose();
    this.cantor.dispose();
    this.selthe.dispose();
    this.fracture.dispose();
    this.combo.dispose();
    this.moon.dispose();
    this.manta.dispose();
    this.bridge.dispose();
    this.trash.dispose();
    this.lure.dispose();
    this.root.removeFromParent();
    this.kit.dispose();
    for (const t of this.tethers) t.geometry.dispose();
    this.shellStance.clear();
    this.moonspawnSeen.clear();
  }
}
