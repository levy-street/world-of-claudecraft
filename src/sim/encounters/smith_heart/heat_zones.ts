// The Guardian of the Heat's Wakefire (docs/design/raid/smith_heart.md
// section 7.4), phases 2 and 3: the Hearth's floor ignites in three bands
// round the wellspring (near the guardian, the middle, the back), one after
// another.
//
//   A run      every 34 s (first 16 s into phase 2): the bands always in order
//              from the guardian outward (melee, casters, the far shore); each
//              band warns 4 s (its ring builds on the floor), then ignites (a
//              massive blow to everyone in it) and burns 2 s more.
//              The next band begins its warning 2.5 s after the last began,
//              so the raid steps into the band that has just burned.
//
// Deterministic: the only rng draws are the damage rolls, in player order.

import { HEARTH_WELL } from '../../content/smith_heart_layout';
import { DT, type Entity } from '../../types';
import { inBand } from './heat_geometry';
import { HEAT_CUES, HEAT_NAMES, HEAT_TUNING as T, ZONE_BANDS, zoneTemplate } from './heat_ids';
import {
  at,
  cueAt,
  dropFightObject,
  fireHit,
  type HeatScope,
  livePlayers,
  raidWarn,
  roll,
  spawnFightObject,
} from './heat_scope';
import type { HeatZone } from './heat_state';
import { heatSay } from './heat_voice';

/** Every run's order: from the guardian outward. */
const ZONE_ORDER: readonly number[] = [0, 1, 2];

/** Begin a Wakefire run now. Exported for the dev trigger. */
export function startZones(s: HeatScope): void {
  const st = s.st;
  st.zoneTimer = T.zoneEvery;
  st.zoneRun = { order: [...ZONE_ORDER], next: 0, stepIn: 0 };
  raidWarn(s, s.boss, 'zones', 'Wakefire! The Hearth ignites band by band: step out!');
  heatSay(s, s.boss, 'zones');
}

/** The players in band `band` now. */
export function inZone(s: HeatScope, band: number): Entity[] {
  return livePlayers(s).filter((p) => {
    const here = at(s, p);
    return inBand(band, here.x, here.z);
  });
}

function setZone(s: HeatScope, z: HeatZone): void {
  const obj = s.ctx.entities.get(z.objectId);
  if (obj) obj.templateId = zoneTemplate(z.band, z.state, z.remaining);
}

/** One tick of Wakefire: the run's next band, each band's warning, its
 *  ignition and its burn. */
export function stepZones(s: HeatScope): void {
  const st = s.st;
  const run = st.zoneRun;
  if (run) {
    run.stepIn -= DT;
    if (run.stepIn <= 1e-9 && run.next < run.order.length) {
      const band = run.order[run.next];
      const obj = spawnFightObject(
        s.ctx,
        s.inst,
        zoneTemplate(band, 'warn', T.zoneWarn),
        HEAT_NAMES.zone,
        HEARTH_WELL.x,
        HEARTH_WELL.z,
        ZONE_BANDS[band][1],
      );
      st.zones.push({ objectId: obj.id, band, state: 'warn', remaining: T.zoneWarn, tick: 0 });
      run.next++;
      run.stepIn += T.zoneStep;
    }
    if (run.next >= run.order.length) st.zoneRun = null;
  }
  if (st.zones.length === 0) return;
  const keep: HeatZone[] = [];
  for (const z of st.zones) {
    z.remaining -= DT;
    if (z.state === 'warn') {
      if (z.remaining <= 1e-9) {
        z.state = 'burn';
        z.remaining = T.zoneBurn;
        z.tick = T.zoneTick;
        setZone(s, z);
        cueAt(s, HEAT_CUES.ignite, HEARTH_WELL.x, HEARTH_WELL.z, ZONE_BANDS[z.band][1]);
        for (const p of inZone(s, z.band))
          fireHit(s, p, roll(s, T.zoneMin, T.zoneMax), HEAT_NAMES.zone);
      }
      keep.push(z);
      continue;
    }
    if (z.remaining <= 1e-9) {
      dropFightObject(s.ctx, s.inst, z.objectId);
      continue;
    }
    z.tick -= DT;
    if (z.tick <= 1e-9) {
      z.tick += T.zoneTick;
      for (const p of inZone(s, z.band))
        fireHit(s, p, roll(s, T.zoneBurnMin, T.zoneBurnMax), HEAT_NAMES.zone);
    }
    keep.push(z);
  }
  st.zones = keep;
}

/** Every band off the floor and the run ended. */
export function clearZones(s: Pick<HeatScope, 'ctx' | 'inst' | 'st'>): void {
  for (const z of s.st.zones) dropFightObject(s.ctx, s.inst, z.objectId);
  s.st.zones = [];
  s.st.zoneRun = null;
}
