// The Hammer Council's Narrow Shelter (Heroic, Mythic), a part of CouncilFx: while
// Mountain's Wrath's bar runs, a row of gems on every standing pillar's sheltered
// side (away from the blast, where the hiding players look), one per player it can
// shield: lit one by one as players hide behind it (the vein's ochre), all of them
// red when one too many has (shelterRunes). It is what the raid reads to
// share out its pillars, so every tier draws it. Built in the constructor under the
// host's root (one gated attach), one instanced draw, no light, no per-frame
// allocation past the first use.

import * as THREE from 'three';
import { SMITH_HEART_VEIN_COLORS } from '../../sim/content/smith_heart_layout';
import { pillarShelterCounts, shelterRunes } from './council_fx_core';
import type { CouncilFxHost, CouncilPillarsFx } from './council_pillars_fx';

/** The most pillars standing (COUNCIL_TUNING.pillarCap) and the most gems on one. */
const MAX_GEMS = 7 * 4;
/** The gems' height over the floor (over a player's head, under every pillar's
 *  top), how far off the pillar's face they float, their size and their spacing
 *  round it (yards, radians). */
const GEM_Y = 3.8;
const OFF_FACE = 0.55;
const GEM = 0.42;
const GEM_STEP = 0.42;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _spent = new THREE.Color(0x2c241c);
const _lit = new THREE.Color(SMITH_HEART_VEIN_COLORS.hammer);
const _over = new THREE.Color(0xff3a22);

export class CouncilLimitFx {
  private readonly gems: THREE.InstancedMesh;
  private readonly pillars: { x: number; z: number; r: number }[] = [];
  private readonly players: { x: number; z: number }[] = [];
  private readonly counts: number[] = [];

  constructor(
    private readonly h: CouncilFxHost,
    private readonly pillarsFx: CouncilPillarsFx,
  ) {
    const geo = new THREE.OctahedronGeometry(1, 0);
    const mat = new THREE.MeshBasicMaterial({ name: 'smithHeartCouncilLimitGem' });
    h.geometries.push(geo);
    h.materials.push(mat);
    this.gems = new THREE.InstancedMesh(geo, mat, MAX_GEMS);
    this.gems.name = 'smithHeartCouncilLimitGems';
    this.gems.count = 0;
    this.gems.visible = false;
    this.gems.frustumCulled = false;
    // The color buffer exists from the start, so the first Wrath builds nothing.
    this.gems.setColorAt(0, _spent);
    h.root.add(this.gems);
  }

  /** Lay the gems for a Wrath from (sx, sz): `limit` per pillar, `n` players read
   *  through `playerAt`. Called at the host's shelter pace, never a frame. */
  lay(
    sx: number,
    sz: number,
    limit: number,
    n: number,
    playerAt: (i: number, out: { x: number; z: number }) => void,
  ): void {
    const count = this.pillarsFx.shelters(this.pillars);
    while (this.players.length < n) this.players.push({ x: 0, z: 0 });
    for (let i = 0; i < n; i++) playerAt(i, this.players[i]);
    pillarShelterCounts(sx, sz, this.players, n, this.pillars, count, this.counts);
    let g = 0;
    for (let i = 0; i < count; i++) {
      const pl = this.pillars[i];
      const runes = shelterRunes(this.counts[i], limit);
      const y = this.h.groundY(pl.x, pl.z) + GEM_Y;
      const yaw = Math.atan2(pl.x - sx, pl.z - sz);
      const r = pl.r + OFF_FACE;
      for (let k = 0; k < limit && g < MAX_GEMS; k++) {
        const a = yaw + (k - (limit - 1) / 2) * GEM_STEP;
        _p.set(pl.x + Math.sin(a) * r, y, pl.z + Math.cos(a) * r);
        _s.setScalar(GEM);
        _m.compose(_p, _q, _s);
        this.gems.setMatrixAt(g, _m);
        this.gems.setColorAt(g, runes.over ? _over : k < runes.lit ? _lit : _spent);
        g++;
      }
    }
    this.gems.count = g;
    this.gems.visible = g > 0;
    this.gems.instanceMatrix.needsUpdate = true;
    if (this.gems.instanceColor) this.gems.instanceColor.needsUpdate = true;
  }

  hide(): void {
    this.gems.visible = false;
    this.gems.count = 0;
  }
}
