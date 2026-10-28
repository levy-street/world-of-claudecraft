// The Masterless Strength's four quarter rules (docs/design/raid/smith_heart.md
// section 7.5, the owner's approved design of 28 Oct 2026):
//
//   Overload        one bar per quarter. It fills while the boss stands in
//                   that quarter (empty to full in 40 s), and the active bar
//                   pulses the raid every 4 s, harder the fuller it is; full,
//                   it bursts (a heavy raid blast) and empties. Away from its
//                   quarter a bar drains at a third of its fill speed. Every
//                   difficulty.
//   Vein Shock      Heroic and Mythic: every quarter change hits the raid and
//                   leaves Vein-Shaken (20 s) on everyone struck; a change
//                   while still shaken hits three times as hard.
//   Taking Root     on entering a quarter (the first one too) the boss roots
//                   for 15 s: it cannot be dragged out. Every difficulty.
//   Heart Unbound   in the central ring above its final phase (15 percent)
//                   the boss gains a stack every second and pulses the raid
//                   for each stack: the tanks drag it through, never park it.
//   The base form   the first quarter it enters is its base form for the
//                   fight (the state aura carries it: the hook for the form's
//                   extra loot item, phase 2).
//
// Between roots the boss follows its tank like any boss: the tanks drag it
// across a ridge into the next quarter, and the kit changes with it.
// Deterministic: no pick here draws; the only rng draws are the damage rolls,
// in claim-player order.

import type { SmithHeartVein } from '../../content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  HEART_QUARTERS,
  type HeartQuarterZone,
  heartFinalPhase,
  heartQuarterAt,
  heartRidgeBetween,
  heartRidgeDistance,
} from '../../content/smith_heart_quarters';
import { DT, type Entity } from '../../types';
import {
  FINAL_AURAS,
  FINAL_CUES,
  FINAL_NAMES,
  FINAL_ZONE_CODES,
  overloadAuraId,
  overloadStep,
  pulseScale,
  FINAL_TUNING as T,
} from './final_ids';
import {
  at,
  auraOf,
  cueAt,
  cueOn,
  dropAura,
  type FinalScope,
  fromCentre,
  hit,
  livePlayers,
  putMarker,
  raidWarn,
  roll,
} from './final_scope';

/** How far past a ridge's line (yards along the arc) or the ring's edge the
 *  boss must step before the zone it left lets go: a boss swaying on a
 *  ridge never flickers between two quarters (each change roots it and, on
 *  Heroic, shocks the raid). */
export const ZONE_HOLD = { ridge: 3, ring: 1.5 } as const;

/** The zone the boss stands in now, held by the one it is in (ZONE_HOLD)
 *  unless `fresh` (the pull). */
export function bossZone(
  s: Pick<FinalScope, 'ctx' | 'inst' | 'boss' | 'st'>,
  fresh = false,
): HeartQuarterZone {
  const p = at(s, s.boss);
  const raw = heartQuarterAt(p.x, p.z);
  const cur = s.st.zone;
  if (fresh || raw === cur) return raw;
  const r = fromCentre(p);
  if (cur === 'ring') return r < HEART_QUARTERS.ringR + ZONE_HOLD.ring ? 'ring' : raw;
  if (raw === 'ring') return r < HEART_QUARTERS.ringR - ZONE_HOLD.ring ? 'ring' : cur;
  const k = heartRidgeBetween(cur, raw);
  if (k !== null && heartRidgeDistance(k, p.x, p.z) < ZONE_HOLD.ridge) return cur;
  return raw;
}

/** Is the boss in its final phase (the ring is its own then)? */
export function inFinalPhase(s: Pick<FinalScope, 'boss'>): boolean {
  return heartFinalPhase(s.boss.hp, s.boss.maxHp);
}

const ENTER_TEXT: Readonly<Record<SmithHeartVein, string>> = {
  heat: 'The Masterless Strength drinks the Heat! Dodge the fist, the swells and the whirls!',
  quench: 'The Masterless Strength drinks the Quench! Stay close together or freeze!',
  breath: 'The Masterless Strength drinks the Breath! Spread out and lean into the wind!',
  hammer: 'The Masterless Strength drinks the Hammer! Step out of the cracks and share the Anvil!',
};
const ENTER_KEY: Readonly<Record<SmithHeartVein, string>> = {
  heat: 'enterHeat',
  quench: 'enterQuench',
  breath: 'enterBreath',
  hammer: 'enterHammer',
};

// ---- Taking Root ---------------------------------------------------------------------------

/** The boss takes root where it stands. Exported for the dev trigger. */
export function takeRoot(s: FinalScope): void {
  const b = s.boss;
  s.st.rootLeft = T.rootSeconds;
  s.st.rootAt = { ...b.pos };
  b.auras = b.auras.filter((a) => a.id !== FINAL_AURAS.root);
  b.auras.push({
    id: FINAL_AURAS.root,
    name: FINAL_NAMES.root,
    kind: 'root',
    remaining: T.rootSeconds,
    duration: T.rootSeconds,
    value: 0,
    sourceId: b.id,
    school: 'nature',
    undispellable: true,
    unbreakableControl: true,
    encounterOwned: true,
  });
  cueOn(s, b, FINAL_CUES.root, 'physical');
}

/** The boss held where it took root (any move this tick undone). */
export function holdRoot(s: FinalScope): void {
  const st = s.st;
  const b = s.boss;
  const r = st.rootAt;
  if (st.rootLeft <= 0 || !r || st.bar) return;
  if (b.pos.x === r.x && b.pos.z === r.z) return;
  b.pos.x = r.x;
  b.pos.y = r.y;
  b.pos.z = r.z;
  s.ctx.rebucket(b);
}

/** One tick of the root: its clock, the hold, its end. */
export function stepRoot(s: FinalScope): void {
  const st = s.st;
  if (st.rootLeft <= 0) return;
  st.rootLeft = Math.max(0, st.rootLeft - DT);
  holdRoot(s);
  if (st.rootLeft <= 1e-9) endRoot(s);
}

/** The root ends now (its clock, or a dev move). */
export function endRoot(s: FinalScope): void {
  s.st.rootLeft = 0;
  s.st.rootAt = null;
  dropAura(s.boss, FINAL_AURAS.root);
}

// ---- the zone changes ----------------------------------------------------------------------

/** The shockwave of a quarter change (Heroic): every player struck, three
 *  times as hard while still Vein-Shaken, and shaken anew. Returns who. */
export function veinShock(s: FinalScope): Entity[] {
  const struck: Entity[] = [];
  const b = s.boss;
  const p0 = at(s, b);
  cueAt(s, FINAL_CUES.shock, p0.x, p0.z, 12, 'physical');
  for (const p of livePlayers(s)) {
    const shaken = auraOf(p, FINAL_AURAS.shaken) !== undefined;
    const amount = roll(s, T.shockMin, T.shockMax) * (shaken ? T.shakenMult : 1);
    hit(s, p, amount, FINAL_NAMES.shock, 'arcane');
    struck.push(p);
    if (p.dead) continue;
    putMarker(p, FINAL_AURAS.shaken, FINAL_NAMES.shaken, T.shakenSeconds, b.id, {
      school: 'arcane',
    });
  }
  s.st.shakenLeft = T.shakenSeconds;
  return struck;
}

/** The boss has entered `zone` (the kit's clocks are the coordinator's). Returns true when it entered a quarter. */
export function enterZone(s: FinalScope, zone: HeartQuarterZone): boolean {
  const st = s.st;
  st.zone = zone;
  if (zone === 'ring') return false;
  const last = st.lastQuarter;
  if (last !== null && last !== zone) {
    st.switches++;
    if (s.rules.switchShock) veinShock(s);
  }
  if (st.baseForm === null) st.baseForm = zone;
  st.lastQuarter = zone;
  st.pulseTimer = T.pulseEvery;
  takeRoot(s);
  raidWarn(s, ENTER_KEY[zone], ENTER_TEXT[zone]);
  return true;
}

// ---- the Overload bars ---------------------------------------------------------------------

/** A bar bursts: the heavy raid blast; the bar empties. Returns who. */
export function burstBar(s: FinalScope, vein: SmithHeartVein): Entity[] {
  s.st.overload[vein] = 0;
  s.st.bursts++;
  s.st.pulseTimer = T.pulseEvery;
  cueOn(s, s.boss, FINAL_CUES.burst, 'arcane');
  raidWarn(s, 'burst', 'Overload! The strength bursts through the Anvil!');
  const struck: Entity[] = [];
  for (const p of livePlayers(s)) {
    hit(s, p, roll(s, T.burstMin, T.burstMax), FINAL_NAMES.burst, 'arcane');
    struck.push(p);
  }
  return struck;
}

/** An Overload pulse from the active bar. Returns who. */
export function pulseBar(s: FinalScope, vein: SmithHeartVein): Entity[] {
  const scale = pulseScale(s.st.overload[vein]);
  cueOn(s, s.boss, FINAL_CUES.pulse, 'arcane');
  const struck: Entity[] = [];
  for (const p of livePlayers(s)) {
    hit(s, p, Math.round(roll(s, T.pulseMin, T.pulseMax) * scale), FINAL_NAMES.pulse, 'arcane');
    struck.push(p);
  }
  return struck;
}

/** One tick of the four bars, the active one's pulses and its burst. */
export function stepOverload(s: FinalScope): void {
  const st = s.st;
  const active = st.zone === 'ring' ? null : st.zone;
  for (const vein of HEART_QUARTER_ORDER)
    st.overload[vein] = overloadStep(st.overload[vein], vein === active, DT);
  if (!active) return;
  if (st.overload[active] >= 1 - 1e-9) {
    burstBar(s, active);
    return;
  }
  st.pulseTimer -= DT;
  if (st.pulseTimer > 1e-9) return;
  st.pulseTimer = T.pulseEvery;
  pulseBar(s, active);
}

// ---- Heart Unbound -------------------------------------------------------------------------

/** One tick of the centre's ramp: in the ring above the final phase a stack
 *  a second and a pulse of every stack; out of it, gone. */
export function stepUnbound(s: FinalScope): void {
  const st = s.st;
  const b = s.boss;
  if (st.zone !== 'ring' || inFinalPhase(s)) {
    if (st.unbound > 0 || auraOf(b, FINAL_AURAS.unbound)) {
      st.unbound = 0;
      st.unboundTimer = 0;
      dropAura(b, FINAL_AURAS.unbound);
    }
    return;
  }
  st.unboundTimer -= DT;
  if (st.unboundTimer > 1e-9) return;
  st.unboundTimer = T.unboundEvery;
  st.unbound = Math.min(T.unboundMax, st.unbound + 1);
  if (st.unbound === 1)
    raidWarn(s, 'unbound', 'The strength is unbound in the centre! Drag it out!');
  const a = auraOf(b, FINAL_AURAS.unbound);
  if (a) {
    a.stacks = st.unbound;
    a.value = st.unbound;
  } else {
    putMarker(b, FINAL_AURAS.unbound, FINAL_NAMES.unbound, 3600, b.id, {
      permanent: true,
      stacks: st.unbound,
      value: st.unbound,
      school: 'arcane',
    });
  }
  cueOn(s, b, FINAL_CUES.unbound, 'arcane');
  for (const p of livePlayers(s))
    hit(
      s,
      p,
      Math.round(roll(s, T.unboundPerStack, T.unboundPerStack) * st.unbound),
      FINAL_NAMES.unbound,
      'arcane',
    );
}

// ---- what every client reads ---------------------------------------------------------------

/** Write the zone, the base form, the switch mark and the four bars onto the
 *  boss's auras (only when they change). */
export function showState(s: FinalScope): void {
  const st = s.st;
  const b = s.boss;
  st.shakenLeft = Math.max(0, st.shakenLeft - DT);
  const zone = FINAL_ZONE_CODES[st.zone];
  const base = st.baseForm === null ? -1 : FINAL_ZONE_CODES[st.baseForm];
  const mark = Math.ceil(st.shakenLeft);
  const a = auraOf(b, FINAL_AURAS.state);
  if (!a) {
    putMarker(b, FINAL_AURAS.state, FINAL_NAMES.state, 3600, b.id, {
      permanent: true,
      value: zone,
      value2: base,
      value3: mark,
      school: 'arcane',
    });
  } else {
    if (a.value !== zone) a.value = zone;
    if (a.value2 !== base) a.value2 = base;
    if (a.value3 !== mark) a.value3 = mark;
  }
  const active = st.zone === 'ring' ? null : st.zone;
  for (const vein of HEART_QUARTER_ORDER) {
    const id = overloadAuraId(vein);
    const v = Math.round(st.overload[vein] * 100);
    const trend = vein === active ? 1 : v > 0 ? -1 : 0;
    const bar = auraOf(b, id);
    if (!bar) {
      putMarker(b, id, FINAL_NAMES.overload, 3600, b.id, {
        permanent: true,
        value: v,
        value2: trend,
        school: 'arcane',
      });
      continue;
    }
    if (bar.value !== v) bar.value = v;
    if (bar.value2 !== trend) bar.value2 = trend;
  }
}

/** Every rule's aura off the boss (the fight's end). */
export function clearRules(b: Entity): void {
  dropAura(b, FINAL_AURAS.state);
  dropAura(b, FINAL_AURAS.root);
  dropAura(b, FINAL_AURAS.unbound);
  for (const vein of HEART_QUARTER_ORDER) dropAura(b, overloadAuraId(vein));
}
