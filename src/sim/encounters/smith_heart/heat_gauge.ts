// The Guardian of the Heat's heat (docs/design/raid/smith_heart.md section
// 7.4): "the flame that grows".
//
//   The heat       0 to 100 on the guardian (its resource: the target frame's
//                  bar), rising on its own (a point a second, faster with the
//                  stoking), cooled by every crystal ray a player takes,
//                  raised by every ray sent back (heat_crystals.ts). Every
//                  player on the floor wears a quiet marker carrying it (the
//                  HUD's heat gauge reads it), with its trend.
//   Hearth Pulse   every 3 s fire rolls over everyone on the floor, heavier
//                  the hotter the Hearth: the raid's healing check.
//   The wind-up    from 90 the guardian wears Overheating (the gauge flashes,
//                  the body burns white), with a raid warning.
//   Hearthburst    at 100 it overheats: a blast over the whole floor (a near
//                  wipe on normal, a wipe on heroic), then the Hearth has
//                  vented and the heat starts again from the bottom.
//   Stoked Hearth  every 40 s the heat rises faster, without end (a stack on
//                  the guardian): the soft enrage.
//
// Zero rng but the damage rolls, in player order.

import { DT, type Entity } from '../../types';
import {
  HEAT_AURAS,
  HEAT_CUES,
  HEAT_NAMES,
  pulseDamage,
  stokeMult,
  HEAT_TUNING as T,
} from './heat_ids';
import {
  auraOf,
  cueOnBoss,
  dropAura,
  fireHit,
  type HeatScope,
  livePlayers,
  putMarker,
  raidWarn,
  roll,
} from './heat_scope';
import { heatSay } from './heat_voice';

/** The wind-up clears once the heat falls this far under its mark. */
const WINDUP_CLEAR = 5;

/** Write the heat onto the guardian's resource and every floor player's
 *  marker (only what changed: what every client reads). */
export function showHeat(s: HeatScope): void {
  const st = s.st;
  const v = Math.round(st.heat);
  const b = s.boss;
  if (b.resourceType !== 'energy') b.resourceType = 'energy';
  if (b.maxResource !== T.heatMax) b.maxResource = T.heatMax;
  if (b.resource !== v) b.resource = v;
  for (const p of s.players) {
    if (p.dead) continue;
    st.marked[p.id] = true;
    const a = auraOf(p, HEAT_AURAS.heat);
    if (!a) {
      putMarker(p, HEAT_AURAS.heat, HEAT_NAMES.heat, 3600, b.id, {
        permanent: true,
        value: v,
        value2: st.trend,
        school: 'fire',
      });
      continue;
    }
    if (a.value !== v) a.value = v;
    if (a.value2 !== st.trend) a.value2 = st.trend;
  }
  // A player gone from the floor (dead, or away) loses the marker.
  for (const key of Object.keys(st.marked)) {
    const id = Number(key);
    if (s.players.some((p) => p.id === id && !p.dead)) continue;
    const e = s.ctx.entities.get(id);
    if (e) dropAura(e, HEAT_AURAS.heat);
    delete st.marked[id];
  }
}

/** Move the heat by `amount` (a ray's cool or its return). Hearthburst at
 *  the top. */
export function addHeat(s: HeatScope, amount: number): void {
  const st = s.st;
  st.heat = Math.max(0, Math.min(T.heatMax, st.heat + amount));
  if (st.heat >= T.heatMax - 1e-9) hearthburst(s);
}

/** Set the heat outright (the dev trigger), the wind-up following it. */
export function setHeat(s: HeatScope, value: number): void {
  s.st.heat = Math.max(0, Math.min(T.heatMax - 0.01, value));
  stepWindup(s);
  showHeat(s);
}

function stepWindup(s: HeatScope): void {
  const st = s.st;
  const b = s.boss;
  if (!st.windup && st.heat >= T.windupAt) {
    st.windup = true;
    putMarker(b, HEAT_AURAS.overheating, HEAT_NAMES.overheating, 3600, b.id, {
      permanent: true,
      school: 'fire',
    });
    cueOnBoss(s, HEAT_CUES.windup);
    raidWarn(
      s,
      b,
      'windup',
      'The Hearth is about to overheat! Cool it with the crystals or brace!',
    );
    heatSay(s, b, 'windup');
  } else if (st.windup && st.heat < T.windupAt - WINDUP_CLEAR) {
    st.windup = false;
    dropAura(b, HEAT_AURAS.overheating);
  }
}

/** The Hearth overheats: Hearthburst on everyone on the floor, then it has
 *  vented. Returns who it struck (the tests read it). Exported for the dev
 *  trigger. */
export function hearthburst(s: HeatScope): Entity[] {
  const st = s.st;
  const b = s.boss;
  st.overheats++;
  st.heat = T.ventTo;
  st.windup = false;
  dropAura(b, HEAT_AURAS.overheating);
  cueOnBoss(s, HEAT_CUES.overheat);
  raidWarn(s, b, 'overheat', 'The Hearth overheats!');
  heatSay(s, b, 'overheat');
  const mult = b.mechanicDamageMult ?? 1;
  const hit: Entity[] = [];
  for (const p of livePlayers(s)) {
    hit.push(p);
    fireHit(s, p, roll(s, s.rules.overheatMin, s.rules.overheatMax, mult), HEAT_NAMES.overheat);
  }
  return hit;
}

/** The Hearth Pulse: fire on everyone on the floor at the heat's weight.
 *  Returns who it struck. */
export function pulse(s: HeatScope): Entity[] {
  const mid = pulseDamage(s.st.heat);
  cueOnBoss(s, HEAT_CUES.pulse);
  const hit: Entity[] = [];
  for (const p of livePlayers(s)) {
    hit.push(p);
    fireHit(s, p, roll(s, mid * (1 - T.pulseSpread), mid * (1 + T.pulseSpread)), HEAT_NAMES.pulse);
  }
  return hit;
}

/** One tick of the heat: the rise, the trend, the wind-up, the pulse, the
 *  stoking. */
export function stepHeat(s: HeatScope): void {
  const st = s.st;
  // The stoking (soft enrage).
  st.stokeTimer -= DT;
  if (st.stokeTimer <= 1e-9) {
    st.stokeTimer += T.stokeEvery;
    st.stokeStacks++;
    const b = s.boss;
    const have = auraOf(b, HEAT_AURAS.stoked);
    if (have) have.stacks = st.stokeStacks;
    else
      putMarker(b, HEAT_AURAS.stoked, HEAT_NAMES.stoked, 3600, b.id, {
        permanent: true,
        stacks: st.stokeStacks,
        school: 'fire',
      });
    cueOnBoss(s, HEAT_CUES.stoke);
    if (st.stokeStacks >= 3) heatSay(s, b, 'stoke');
  }
  addHeat(s, T.heatRise * stokeMult(st.stokeStacks) * DT);
  // The trend: the heat against a second ago.
  st.trendTimer -= DT;
  if (st.trendTimer <= 1e-9) {
    st.trendTimer += 1;
    st.trend = st.heat >= st.heatRef - 1e-9 ? 1 : -1;
    st.heatRef = st.heat;
  }
  stepWindup(s);
  st.pulseTimer -= DT;
  if (st.pulseTimer <= 1e-9) {
    st.pulseTimer += T.pulseEvery;
    pulse(s);
  }
  showHeat(s);
}

/** Every mark of the heat off one body (a reset, a fall, a departure). */
export function clearHeatMarks(e: Entity): void {
  dropAura(e, HEAT_AURAS.heat);
  dropAura(e, HEAT_AURAS.burn);
}
