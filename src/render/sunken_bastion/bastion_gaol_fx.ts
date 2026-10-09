// The Sunken Gaol's fifth-pass visuals (plan: bastion_gaol_reaper_core.ts), all
// read off mirrored entity state so offline and online look the same:
//  - the Gaol Turnkey's Iron Cage: a shadow filling under every marked player
//    while the Turnkey's bar runs (where the cage will fall), the slam when it
//    lands (dust, flagstone chips, a flash of sparks), sparks flying off the
//    bars at every point broken (an escape press or an ally's hit), a red
//    ember warning deepening as the cage nears its crush, and iron shards
//    bursting outward when it breaks;
//  - Gaoler Ossick's Drowned Anchor: a mark under its target while the throw
//    runs (on heroic, the Anchor Crash's ring round it), the impact, the iron
//    chain from the Drowning Winch to the anchor heating red as its victim
//    nears the pit, the pit's rim burning while anyone is hooked, the links
//    bursting when the chain breaks and a plume of sea water when it does not,
//    and the anchor slung on Ossick's back hidden while his thrown one lies out;
//  - the Shackle Pair: the chain between the two, hanging slack or drawn
//    taut and glowing hot past its reach, and the ring they must keep inside.
//
// Rules (src/render/CLAUDE.md): pooled meshes and materials built once under
// the Bastion telegraph root (compile-gated by BastionFx), no per-frame
// allocation. Everything a player acts on (the cage shadow, the anchor mark
// and crash ring, the chains and their heat, the pit rim, the shackle ring)
// draws on every tier; only the dust, sparks and debris shed on the low tier.

import * as THREE from 'three';
import {
  DROWNED_ANCHOR_ID,
  GAOL_CAGE_ID,
  OSSICK_ANCHOR,
  OSSICK_ANCHOR_MARK,
  OSSICK_ANCHORED,
  OSSICK_KEELHAULED,
  OSSICK_SHACKLE,
  OSSICK_SHACKLED,
  TURNKEY_CAGE_MARK,
  TURNKEY_CAGED,
  TURNKEY_ID,
  TURNKEY_IRON_CAGE,
  WINCH,
} from '../../sim/encounters/sunken_bastion/ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import {
  TELEGRAPH_ACCENTS,
  TELEGRAPH_THREAT_COLORS,
  type TelegraphFan,
  TelegraphKit,
  telegraphFillOf,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { bastionSlotOrigin, chainPoints, chainSag } from './bastion_boss_fx_core';
import {
  ANCHOR_MARK_RADIUS,
  ANCHOR_RING_HEIGHT,
  anchorHeat,
  CAGE_CRUSH_SECONDS,
  CAGE_MARK_RADIUS,
  ossickAnchorGesture,
  PIT_RIM_RADIUS,
  shackleLook,
  shackleRingRadius,
} from './bastion_gaol_reaper_core';
import { BastionParticles } from './bastion_particles';

type EntityView = IWorld['entities'] extends Map<number, infer E> ? E : never;

const SCAN_SEC = 0.1;
const MARK_SLOTS = 4;
const CHAIN_SLOTS = 6;
const LINKS = 36;
const WINCH_TOP = 4.2;
const IRON = new THREE.Color(0.05, 0.05, 0.055);
const HOT = new THREE.Color(1.0, 0.32, 0.1);

interface MarkSlot {
  fan: TelegraphFan;
  playerId: number;
  kind: 'cage' | 'anchor' | 'crash';
}

interface CageWatch {
  hp: number;
  floor: number;
}

interface AnchorWatch {
  victimId: number;
  start: number;
}

function auraOf(e: EntityView, id: string): EntityView['auras'][number] | undefined {
  for (const a of e.auras) if (a.id === id) return a;
  return undefined;
}

export class BastionGaolFx {
  private readonly root = new THREE.Group();
  private readonly kit: TelegraphKit;
  private readonly fx: BastionParticles;
  private readonly marks: MarkSlot[] = [];
  private readonly shackleRings: { fan: TelegraphFan; a: number; b: number; strained: boolean }[] =
    [];
  private readonly links: THREE.InstancedMesh;
  private readonly rim: THREE.Mesh;
  private readonly rimMat: THREE.MeshBasicMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly tmpPts = new Float32Array(LINKS * 3);
  private readonly cages = new Map<number, CageWatch>();
  private readonly anchors = new Map<number, AnchorWatch>();
  private readonly marked: { id: number; kind: 'cage' | 'anchor' | 'crash' }[] = [];
  private readonly pairs: { a: number; b: number; range: number }[] = [];
  private readonly caged: number[] = [];
  private turnkeyId = -1;
  private ossickId = -1;
  private scan = 0;
  private clock = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(
    parent: THREE.Group,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world: IWorld | undefined,
    private readonly cosmetic: boolean,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.root.name = 'sunken-bastion-gaol-fx';
    parent.add(this.root);
    this.kit = new TelegraphKit(this.root, cosmetic);
    this.fx = new BastionParticles(this.root, cosmetic);
    for (let i = 0; i < MARK_SLOTS; i++)
      this.marks.push({ fan: this.kit.fan(16), playerId: -1, kind: 'cage' });
    for (let i = 0; i < 2; i++)
      this.shackleRings.push({ fan: this.kit.fan(13), a: -1, b: -1, strained: false });
    const linkGeo = new THREE.TorusGeometry(0.24, 0.07, 6, 10);
    linkGeo.scale(1, 1.45, 1);
    this.geometries.push(linkGeo);
    const linkMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.materials.push(linkMat);
    this.links = new THREE.InstancedMesh(linkGeo, linkMat, CHAIN_SLOTS * LINKS);
    this.links.frustumCulled = false;
    this.links.count = 0;
    this.links.setColorAt(0, IRON);
    this.root.add(this.links);
    const rimGeo = new THREE.RingGeometry(PIT_RIM_RADIUS - 0.35, PIT_RIM_RADIUS, 64);
    rimGeo.rotateX(-Math.PI / 2);
    this.geometries.push(rimGeo);
    this.rimMat = new THREE.MeshBasicMaterial({
      color: TELEGRAPH_THREAT_COLORS.lethal,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.materials.push(this.rimMat);
    this.rim = new THREE.Mesh(rimGeo, this.rimMat);
    this.rim.visible = false;
    this.rim.renderOrder = floorVfxRenderOrder('encounter', 18);
    this.root.add(this.rim);
  }

  // ---- scan --------------------------------------------------------------------------

  private scanWorld(world: IWorld): void {
    this.turnkeyId = -1;
    this.ossickId = -1;
    this.marked.length = 0;
    this.pairs.length = 0;
    this.caged.length = 0;
    const seenCages = new Set<number>();
    const seenAnchors = new Set<number>();
    for (const e of world.entities.values()) {
      if (e.kind === 'mob') {
        if (e.dead) continue;
        if (e.templateId === TURNKEY_ID) this.turnkeyId = e.id;
        else if (e.templateId === 'gaoler_ossick') this.ossickId = e.id;
        else if (e.templateId === GAOL_CAGE_ID) {
          seenCages.add(e.id);
          if (!this.cages.has(e.id))
            this.cages.set(e.id, { hp: e.hp, floor: this.groundY(e.pos.x, e.pos.z) });
        } else if (e.templateId === DROWNED_ANCHOR_ID) seenAnchors.add(e.id);
        continue;
      }
      if (e.kind !== 'player' || e.dead) continue;
      if (auraOf(e, TURNKEY_CAGE_MARK)) this.marked.push({ id: e.id, kind: 'cage' });
      const mark = auraOf(e, OSSICK_ANCHOR_MARK);
      if (mark) {
        this.marked.push({ id: e.id, kind: 'anchor' });
        if ((mark.value2 ?? 0) > 0) this.marked.push({ id: e.id, kind: 'crash' });
      }
      const anchored = auraOf(e, OSSICK_ANCHORED);
      if (anchored && !this.anchors.has(anchored.sourceId)) {
        const o = bastionSlotOrigin(e.pos.x, e.pos.z);
        this.anchors.set(anchored.sourceId, {
          victimId: e.id,
          start: Math.hypot(e.pos.x - o.x - WINCH.x, e.pos.z - o.z - WINCH.z),
        });
      }
      const sh = auraOf(e, OSSICK_SHACKLED);
      if (sh && e.id < sh.sourceId)
        this.pairs.push({ a: e.id, b: sh.sourceId, range: sh.value2 ?? 0 });
      if (auraOf(e, TURNKEY_CAGED)) this.caged.push(e.id);
    }
    for (const id of [...this.cages.keys()]) if (!seenCages.has(id)) this.cages.delete(id);
    for (const id of [...this.anchors.keys()]) if (!seenAnchors.has(id)) this.anchors.delete(id);
    // Ossick's slung anchor hides while a thrown one lies out; re-sent every scan
    // (idempotent), so a view built mid-fight takes the state.
    if (this.ossickId >= 0)
      this.playGesture?.(this.ossickId, ossickAnchorGesture(seenAnchors.size));
  }

  // ---- events ------------------------------------------------------------------------

  /** Claims the cage's and the anchor's own cues (their impacts and breaks);
   *  true when it drew the event, so no generic burst is drawn too. */
  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx' || !this.world) return false;
    const ability = ev.ability ?? '';
    const at = this.world.entities.get(ev.targetId) ?? this.world.entities.get(ev.sourceId);
    if (ability === TURNKEY_IRON_CAGE) {
      if (at) this.slam(at, 0xb8a890, 0x6b5a48, 1.0);
      return true;
    }
    if (ability === TURNKEY_CAGED) {
      const cage = this.world.entities.get(ev.sourceId) ?? at;
      if (cage) this.shatter(cage, 0x5a4636);
      return true;
    }
    if (ability === OSSICK_ANCHOR) {
      if (at) this.slam(at, 0xa9b4ad, 0x4a4f4b, 1.3);
      return true;
    }
    if (ability === OSSICK_ANCHORED) {
      const anchor = this.world.entities.get(ev.sourceId) ?? at;
      if (anchor) this.shatter(anchor, 0x2d2b2a);
      return true;
    }
    if (ability === OSSICK_KEELHAULED) {
      if (at) {
        const y = this.groundY(at.pos.x, at.pos.z);
        this.fx.burst(at.pos.x, y + 0.5, at.pos.z, 0xc8f4ff, 8, 1.2, 6, 1.1, 3.5, 2.5);
        this.fx.burst(at.pos.x, y + 0.2, at.pos.z, 0x4f8f8a, 5, 2, 7, 1.6, 0.8, 1.5, true);
      }
      return true;
    }
    return ability === OSSICK_SHACKLE;
  }

  /** A heavy body slamming into the flags: dust, chips and a flash. */
  private slam(e: EntityView, dust: number, chip: number, size: number): void {
    const y = this.groundY(e.pos.x, e.pos.z);
    this.fx.burst(e.pos.x, y + 0.4, e.pos.z, dust, 8, 1.2 * size, 5 * size, 1.3, 0.9, 2.2, true);
    this.fx.burst(e.pos.x, y + 0.6, e.pos.z, 0xffe0a8, 4, 0.3, 2.2 * size, 0.35, 0.2, 4);
    this.fx.chunksAt(e.pos.x, y + 0.3, e.pos.z, y, chip, 10, 4.5, 0.8);
  }

  /** A cage or chain bursting apart: iron shards, sparks and rust dust. */
  private shatter(e: EntityView, iron: number): void {
    const y = this.groundY(e.pos.x, e.pos.z);
    this.fx.chunksAt(e.pos.x, y + 1.6, e.pos.z, y, iron, 16, 7, 1.1);
    this.fx.burst(e.pos.x, y + 1.8, e.pos.z, 0xffb060, 10, 0.2, 1.4, 0.45, 1.5, 6);
    this.fx.burst(e.pos.x, y + 1.2, e.pos.z, 0x8a5a36, 6, 1.4, 5, 1.4, 0.7, 1.4, true);
  }

  // ---- frame --------------------------------------------------------------------------

  update(dt: number): void {
    const world = this.world;
    if (!world) return;
    this.clock += dt;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanWorld(world);
    }
    this.updateMarks(world);
    let n = 0;
    n = this.updateAnchors(world, n);
    n = this.updateShackles(world, n);
    this.links.count = n;
    this.links.instanceMatrix.needsUpdate = true;
    if (this.links.instanceColor) this.links.instanceColor.needsUpdate = true;
    this.updateCages(world);
    this.fx.update(dt);
  }

  private updateMarks(world: IWorld): void {
    for (const slot of this.marks) {
      if (slot.playerId < 0) continue;
      if (!this.marked.some((m) => m.id === slot.playerId && m.kind === slot.kind)) {
        slot.playerId = -1;
        slot.fan.group.visible = false;
      }
    }
    for (const m of this.marked) {
      if (this.marks.some((s) => s.playerId === m.id && s.kind === m.kind)) continue;
      const slot = this.marks.find((s) => s.playerId < 0);
      if (!slot) break;
      slot.playerId = m.id;
      slot.kind = m.kind;
      this.kit.layOutFan(slot.fan, 360, {
        color: m.kind === 'cage' ? TELEGRAPH_THREAT_COLORS.control : TELEGRAPH_THREAT_COLORS.lethal,
        accent: TELEGRAPH_ACCENTS.physical,
      });
      slot.fan.group.visible = true;
    }
    for (const slot of this.marks) {
      if (slot.playerId < 0) continue;
      const p = world.entities.get(slot.playerId);
      const caster =
        slot.kind === 'cage'
          ? world.entities.get(this.turnkeyId)
          : world.entities.get(this.ossickId);
      if (!p) continue;
      const fill = caster ? telegraphFillOf(caster.castRemaining, caster.castTotal) : 1;
      const mark = slot.kind === 'crash' ? auraOf(p, OSSICK_ANCHOR_MARK) : undefined;
      const r =
        slot.kind === 'cage'
          ? CAGE_MARK_RADIUS
          : slot.kind === 'crash'
            ? (mark?.value2 ?? ANCHOR_MARK_RADIUS)
            : ANCHOR_MARK_RADIUS;
      this.kit.drapeFan(
        slot.fan,
        this.groundY,
        p.pos.x,
        this.groundY(p.pos.x, p.pos.z),
        p.pos.z,
        0,
        r * (slot.kind === 'crash' ? 1 : 1.3 - 0.3 * fill),
      );
      this.kit.paintFan(slot.fan, { fill, clock: this.clock, range: r });
    }
  }

  /** Lay one chain's links from A to B into the instanced links at `n`. */
  private lay(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    sag: number,
    count: number,
    color: THREE.Color,
    n: number,
  ): number {
    chainPoints(ax, ay, az, bx, by, bz, sag, count, this.tmpPts);
    for (let i = 0; i < count; i++) {
      if (n >= CHAIN_SLOTS * LINKS) return n;
      const j = Math.min(count - 1, i + 1);
      const k = i === count - 1 ? i - 1 : i;
      this.v.set(
        this.tmpPts[j * 3] - this.tmpPts[k * 3],
        this.tmpPts[j * 3 + 1] - this.tmpPts[k * 3 + 1],
        this.tmpPts[j * 3 + 2] - this.tmpPts[k * 3 + 2],
      );
      this.v.normalize();
      this.q.setFromUnitVectors(UP, this.v);
      if (i % 2 === 1) this.q.multiply(QUARTER);
      this.s.set(this.tmpPts[i * 3], this.tmpPts[i * 3 + 1], this.tmpPts[i * 3 + 2]);
      this.m4.compose(this.s, this.q, ONE);
      this.links.setMatrixAt(n, this.m4);
      this.links.setColorAt(n, color);
      n++;
    }
    return n;
  }

  private updateAnchors(world: IWorld, n: number): number {
    let hooked = false;
    let rimAt: { x: number; z: number } | null = null;
    for (const [anchorId, watch] of this.anchors) {
      const anchor = world.entities.get(anchorId);
      const p = world.entities.get(watch.victimId);
      if (!anchor || !p || anchor.dead) continue;
      const o = bastionSlotOrigin(anchor.pos.x, anchor.pos.z);
      const wx = o.x + WINCH.x;
      const wz = o.z + WINCH.z;
      const wy = this.groundY(wx, wz) + WINCH_TOP;
      const dist = Math.hypot(p.pos.x - wx, p.pos.z - wz);
      const heat = anchorHeat(dist, watch.start);
      this.c
        .copy(IRON)
        .lerp(HOT, heat * heat * (0.75 + 0.25 * Math.sin(this.clock * (6 + heat * 16))));
      const ay = this.groundY(anchor.pos.x, anchor.pos.z) + ANCHOR_RING_HEIGHT * anchor.scale;
      const span = Math.hypot(anchor.pos.x - wx, anchor.pos.z - wz);
      n = this.lay(
        wx,
        wy,
        wz,
        anchor.pos.x,
        ay,
        anchor.pos.z,
        chainSag(span) * 0.6,
        LINKS - 8,
        this.c,
        n,
      );
      // The short bite from the anchor's fluke to its victim.
      const fy = this.groundY(anchor.pos.x, anchor.pos.z) + 1.3;
      n = this.lay(
        anchor.pos.x,
        fy,
        anchor.pos.z,
        p.pos.x,
        p.pos.y + 1.1,
        p.pos.z,
        0.15,
        6,
        this.c,
        n,
      );
      if (this.cosmetic && heat > 0.55 && this.fx.rand() < 0.2)
        this.fx.burst(p.pos.x, p.pos.y + 0.2, p.pos.z, 0x9aa4a0, 1, 0.5, 1.6, 0.6, 0.4, 0.8, true);
      hooked = true;
      rimAt = { x: wx, z: wz };
    }
    this.rim.visible = hooked;
    if (hooked && rimAt) {
      this.rim.position.set(rimAt.x, this.groundY(rimAt.x + WINCH.r + 1, rimAt.z) + 0.1, rimAt.z);
      this.rimMat.opacity = 0.55 + 0.35 * Math.sin(this.clock * 7);
    }
    return n;
  }

  private updateShackles(world: IWorld, n: number): number {
    for (const ring of this.shackleRings) {
      if (ring.a < 0) continue;
      if (!this.pairs.some((p) => p.a === ring.a && p.b === ring.b)) {
        ring.a = -1;
        ring.b = -1;
        ring.fan.group.visible = false;
      }
    }
    for (const pair of this.pairs) {
      const a = world.entities.get(pair.a);
      const b = world.entities.get(pair.b);
      if (!a || !b) continue;
      const dist = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      const look = shackleLook(dist, pair.range);
      this.c
        .copy(IRON)
        .lerp(HOT, look.strained ? 0.7 + 0.3 * Math.sin(this.clock * 18) : look.tension * 0.25);
      n = this.lay(
        a.pos.x,
        a.pos.y + 1.0,
        a.pos.z,
        b.pos.x,
        b.pos.y + 1.0,
        b.pos.z,
        look.sag,
        18,
        this.c,
        n,
      );
      if (look.strained && this.fx.rand() < 0.35) {
        const t = this.fx.rand();
        this.fx.burst(
          a.pos.x + (b.pos.x - a.pos.x) * t,
          a.pos.y + 1.0,
          a.pos.z + (b.pos.z - a.pos.z) * t,
          0xffa050,
          1,
          0.2,
          0.6,
          0.3,
          1.2,
          2,
        );
      }
      let ring = this.shackleRings.find((r) => r.a === pair.a && r.b === pair.b);
      if (!ring) {
        ring = this.shackleRings.find((r) => r.a < 0);
        if (!ring) continue;
        ring.a = pair.a;
        ring.b = pair.b;
        ring.strained = !look.strained;
        ring.fan.group.visible = true;
      }
      if (ring.strained !== look.strained) {
        ring.strained = look.strained;
        this.kit.layOutFan(ring.fan, 360, {
          color: look.strained ? TELEGRAPH_THREAT_COLORS.lethal : TELEGRAPH_THREAT_COLORS.control,
          accent: TELEGRAPH_ACCENTS.physical,
        });
      }
      const mx = (a.pos.x + b.pos.x) / 2;
      const mz = (a.pos.z + b.pos.z) / 2;
      const r = shackleRingRadius(pair.range);
      this.kit.drapeFan(ring.fan, this.groundY, mx, this.groundY(mx, mz), mz, 0, r);
      this.kit.paintFan(ring.fan, {
        fill: look.strained ? 1 : 0.25 + 0.5 * look.tension,
        clock: this.clock,
        range: r,
      });
    }
    return n;
  }

  private updateCages(world: IWorld): void {
    for (const [id, watch] of this.cages) {
      const cage = world.entities.get(id);
      if (!cage) continue;
      // A point broken (a press or a hit): sparks off the bars.
      if (cage.hp < watch.hp - 1e-6) {
        const h = 1.2 + this.fx.rand() * 2.2;
        const a = this.fx.rand() * Math.PI * 2;
        this.fx.burst(
          cage.pos.x + Math.sin(a) * 1.5,
          watch.floor + h,
          cage.pos.z + Math.cos(a) * 1.5,
          0xffc070,
          3,
          0.15,
          0.9,
          0.3,
          1.6,
          3,
        );
      }
      watch.hp = cage.hp;
    }
    // The crush drawing near: embers rising inside a cage in its last seconds.
    for (const pid of this.caged) {
      const p = world.entities.get(pid);
      const a = p ? auraOf(p, TURNKEY_CAGED) : undefined;
      if (!p || !a) continue;
      const left = a.remaining - 1;
      if (left < CAGE_CRUSH_SECONDS * 0.35 && this.fx.rand() < 0.3)
        this.fx.burst(
          p.pos.x + (this.fx.rand() - 0.5) * 2,
          p.pos.y + 0.3,
          p.pos.z + (this.fx.rand() - 0.5) * 2,
          0xff5a2a,
          1,
          0.25,
          0.7,
          0.9,
          1.8,
        );
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.links.dispose();
    this.fx.dispose();
    this.kit.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const QUARTER = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2);
