// The Hammer Council's Narrow Shelter (Heroic, Mythic), a part of CouncilFx: while
// Mountain's Wrath's bar runs, a row of gems on every standing pillar's sheltered
// side (away from the blast, where the hiding players look), one per player it can
// shield: lit one by one as players hide behind it (the vein's ochre), all of them
// red when one too many has (shelterRunes). It is what the raid reads to
// share out its pillars, so every tier draws it. The bot pass of 2026-11-04 lost
// the gems in the Wrath's clutter (rock, the waking, the blast's ring): each gem is
// now bigger, unlit and over-bright (the bloom takes it), set in a dark setting a
// size larger behind it (an outline that holds against any glow), a crowded
// pillar's whole row burning red. Built in the constructor under the host's root (one
// gated attach), two instanced draws, no light, no per-frame allocation past the
// first use.

import * as THREE from 'three';
import { SMITH_HEART_VEIN_COLORS } from '../../sim/content/smith_heart_layout';
import { pillarShelterCounts, shelterRunes } from './council_fx_core';
import type { CouncilFxHost, CouncilPillarsFx } from './council_pillars_fx';

/** The most pillars standing (COUNCIL_TUNING.pillarCap) and the most gems on one. */
const MAX_GEMS = 7 * 4;
/** The gems' height over the floor (over the hiding players' names, under every
 *  pillar's top), how far off the pillar's face they float, their size and their
 *  spacing along it (yards). */
const GEM_Y = 5.4;
const OFF_FACE = 0.75;
const GEM = 0.7;
const GEM_STEP = 0.95;
/** The dark setting behind a gem, as a share of the gem (a thin outline). */
const SETTING = 1.22;
/** How far over white a lit gem burns (the bloom picks it out of the clutter). */
const LIT_GAIN = 2.0;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _spent = new THREE.Color(0x5a5048);
const _lit = new THREE.Color(SMITH_HEART_VEIN_COLORS.hammer).multiplyScalar(LIT_GAIN);
// A crowded row is blood red, never the lit ochre's orange (over-bright it would
// clip to the same hue).
const _over = new THREE.Color(0xff1a10).multiplyScalar(1.25);

export class CouncilLimitFx {
  private readonly gems: THREE.InstancedMesh;
  private readonly settings: THREE.InstancedMesh;
  private readonly pillars: { x: number; z: number; r: number }[] = [];
  private readonly players: { x: number; z: number }[] = [];
  private readonly counts: number[] = [];
  /** The first crowded pillar of the last lay (its sound's spot). */
  readonly crowdedAt = { x: 0, z: 0 };

  constructor(
    private readonly h: CouncilFxHost,
    private readonly pillarsFx: CouncilPillarsFx,
  ) {
    const geo = new THREE.OctahedronGeometry(1, 0).scale(1, 1.35, 1);
    const mat = new THREE.MeshBasicMaterial({
      name: 'smithHeartCouncilLimitGem',
      toneMapped: false,
    });
    // The setting: the same gem a size larger, its back faces only, near black.
    const settingMat = new THREE.MeshBasicMaterial({
      name: 'smithHeartCouncilLimitSetting',
      color: 0x140d08,
      side: THREE.BackSide,
    });
    h.geometries.push(geo);
    h.materials.push(mat, settingMat);
    this.gems = new THREE.InstancedMesh(geo, mat, MAX_GEMS);
    this.gems.name = 'smithHeartCouncilLimitGems';
    this.settings = new THREE.InstancedMesh(geo, settingMat, MAX_GEMS);
    this.settings.name = 'smithHeartCouncilLimitSettings';
    for (const m of [this.gems, this.settings]) {
      m.count = 0;
      m.visible = false;
      m.frustumCulled = false;
      h.root.add(m);
    }
    // The color buffer exists from the start, so the first Wrath builds nothing.
    this.gems.setColorAt(0, _spent);
  }

  /** Lay the gems for a Wrath from (sx, sz): `limit` per pillar, `n` players read
   *  through `playerAt`. Called at the host's shelter pace, never a frame.
   *  Returns how many pillars are crowded (the first at `crowdedAt`). */
  lay(
    sx: number,
    sz: number,
    limit: number,
    n: number,
    playerAt: (i: number, out: { x: number; z: number }) => void,
  ): number {
    const count = this.pillarsFx.shelters(this.pillars);
    while (this.players.length < n) this.players.push({ x: 0, z: 0 });
    for (let i = 0; i < n; i++) playerAt(i, this.players[i]);
    pillarShelterCounts(sx, sz, this.players, n, this.pillars, count, this.counts);
    let g = 0;
    let crowded = 0;
    for (let i = 0; i < count; i++) {
      const pl = this.pillars[i];
      const runes = shelterRunes(this.counts[i], limit);
      if (runes.over && crowded++ === 0) {
        this.crowdedAt.x = pl.x;
        this.crowdedAt.z = pl.z;
      }
      const y = this.h.groundY(pl.x, pl.z) + GEM_Y;
      const yaw = Math.atan2(pl.x - sx, pl.z - sz);
      const r = pl.r + OFF_FACE;
      // The row's arc (radians) kept a fixed width over the pillar's face.
      const step = GEM_STEP / r;
      for (let k = 0; k < limit && g < MAX_GEMS; k++) {
        const a = yaw + (k - (limit - 1) / 2) * step;
        _p.set(pl.x + Math.sin(a) * r, y, pl.z + Math.cos(a) * r);
        _q.setFromAxisAngle(_up, a);
        _s.setScalar(GEM);
        _m.compose(_p, _q, _s);
        this.gems.setMatrixAt(g, _m);
        _s.setScalar(GEM * SETTING);
        _m.compose(_p, _q, _s);
        this.settings.setMatrixAt(g, _m);
        this.gems.setColorAt(g, runes.over ? _over : k < runes.lit ? _lit : _spent);
        g++;
      }
    }
    for (const m of [this.gems, this.settings]) {
      m.count = g;
      m.visible = g > 0;
      m.instanceMatrix.needsUpdate = true;
    }
    if (this.gems.instanceColor) this.gems.instanceColor.needsUpdate = true;
    return crowded;
  }

  hide(): void {
    for (const m of [this.gems, this.settings]) {
      m.visible = false;
      m.count = 0;
    }
  }
}
