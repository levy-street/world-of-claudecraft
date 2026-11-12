// Bankshot on the ground (src/sim/pvp/skill_event_bankshot.ts): the standing
// stones and the bolts in flight. Both are actionable (a stone is cover and a
// bank, a bolt is the thing to dodge or brace), so nothing here is gated by a
// graphics tier. The stones are lit grey pillars, so they sit in the world like
// any rock; a bolt is a small solid ball, pale while it is still harmless and
// red once it has bounced. Two instanced meshes, built at construction and
// attached through the compile gate so nothing links in a live frame. Composed
// by PvpGroundVisuals (skill_event_ground.ts).

import * as THREE from 'three';
import type { SkillEventInfo, SkillEventMarkBook } from '../world_api/world_pvp';
import { attachSceneGroupGated } from './gated_scene_attach';
import { skillEventBoltPositionInto } from './skill_event_ground_core';

const MAX_STONES = 16;
const MAX_BOLTS = 128;
const STONE_HEIGHT = 2.6;
const STONE_COLOR = 0x6e6a64;
const BOLT_RADIUS = 0.42;
/** Chest height, where a bolt flies. */
const BOLT_HEIGHT = 1.2;
const BOLT_SAFE = new THREE.Color(0xbfe4ff);
const BOLT_HARMFUL = new THREE.Color(0xff3b2a);

export class BankshotVisuals {
  private readonly group = new THREE.Group();
  private readonly stones: THREE.InstancedMesh;
  private readonly bolts: THREE.InstancedMesh;
  private stoneKey = '';
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly e = new THREE.Euler();
  private readonly at = { x: 0, z: 0 };

  constructor(
    scene: THREE.Scene,
    compileGate: ((target: THREE.Object3D) => Promise<unknown>) | undefined,
    private readonly groundY: (x: number, z: number) => number,
  ) {
    this.group.name = 'skill-event-bankshot';
    // A unit pillar, rough-sided like a standing stone, scaled per stone.
    const stoneGeo = new THREE.CylinderGeometry(0.85, 1, 1, 7, 1);
    stoneGeo.translate(0, 0.5, 0);
    const stoneMat = new THREE.MeshLambertMaterial({ color: STONE_COLOR, flatShading: true });
    stoneMat.name = 'skill-event-bankshot:stone';
    this.stones = new THREE.InstancedMesh(stoneGeo, stoneMat, MAX_STONES);
    this.stones.name = 'skill-event-bankshot-stones';
    this.stones.count = 0;
    this.stones.frustumCulled = false;
    const boltGeo = new THREE.SphereGeometry(BOLT_RADIUS, 12, 8);
    // Solid, unlit colour: an added glow washed out over bright grass, and a
    // bolt must read against any ground.
    const boltMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    boltMat.name = 'skill-event-bankshot:bolt';
    this.bolts = new THREE.InstancedMesh(boltGeo, boltMat, MAX_BOLTS);
    this.bolts.name = 'skill-event-bankshot-bolts';
    this.bolts.count = 0;
    this.bolts.frustumCulled = false;
    this.bolts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Seed the colour attribute so its program key is settled before the gate.
    this.bolts.setColorAt(0, BOLT_SAFE);
    this.group.add(this.stones, this.bolts);
    attachSceneGroupGated(scene, this.group, compileGate).catch(() => {});
  }

  sync(info: SkillEventInfo | null, book: SkillEventMarkBook): void {
    this.syncStones(info?.stones ?? null);
    let n = 0;
    for (const bolt of book.bolts) {
      if (n >= MAX_BOLTS) break;
      skillEventBoltPositionInto(this.at, bolt, book.now, book.boltSpeed);
      this.p.set(this.at.x, this.groundY(this.at.x, this.at.z) + BOLT_HEIGHT, this.at.z);
      this.s.set(1, 1, 1);
      this.bolts.setMatrixAt(n, this.m.compose(this.p, this.q.identity(), this.s));
      this.bolts.setColorAt(n, bolt.harmful ? BOLT_HARMFUL : BOLT_SAFE);
      n++;
    }
    if (n > 0 || this.bolts.count > 0) {
      this.bolts.count = n;
      this.bolts.instanceMatrix.needsUpdate = true;
      if (this.bolts.instanceColor) this.bolts.instanceColor.needsUpdate = true;
    }
  }

  /** The stones move only as the field closes: rebuild them when they change. */
  private syncStones(stones: SkillEventInfo['stones']): void {
    const key = stones ? stones.map((s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`).join(';') : '';
    if (key === this.stoneKey) return;
    this.stoneKey = key;
    const list = stones ?? [];
    let n = 0;
    for (const s of list) {
      if (n >= MAX_STONES) break;
      // A fixed turn, lean and height per stone (from its slot), so the field
      // reads as weathered standing stones rather than one repeated pillar.
      const turn = n * 2.399;
      const lean = 0.06 * Math.sin(n * 1.7);
      this.e.set(lean, turn, 0.04 * Math.cos(n * 2.3));
      this.p.set(s.x, this.groundY(s.x, s.z) - 0.2, s.z);
      this.s.set(s.r, STONE_HEIGHT * (0.85 + 0.15 * Math.sin(n * 3.1) ** 2), s.r);
      this.stones.setMatrixAt(n, this.m.compose(this.p, this.q.setFromEuler(this.e), this.s));
      n++;
    }
    this.stones.count = n;
    this.stones.instanceMatrix.needsUpdate = true;
  }
}
