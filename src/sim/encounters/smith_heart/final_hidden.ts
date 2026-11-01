// The Masterless Strength's hidden phase (docs/design/raid/smith_heart.md
// section 7.5, Jose's approved design; Mythic only, FINAL_PHASE_DIFFICULTY
// `hiddenPhase`). Normal and Heroic never reach any of this and it draws no
// rng of its own:
//
//   The fake death  at 1 percent a damage floor holds it (final_intermission.ts
//                   holdThreshold). It kneels in the centre: every bar, Splinter
//                   and footprint gone, nothing harms it, it strikes nobody.
//   The rebirth     the Heart beats: its health climbs to exactly 20 percent
//                   through the scene, still unharmable.
//   The collapse    every 30 s a whole quarter breaks (5 s of warning cracks, its
//                   floor still safe), fullest Overload bar first, the bars as the
//                   final phase switched them off; ties as the Splinters'. A body
//                   whose stretch of floor has gone falls, and dies at the bottom
//                   whatever shields it (final_plunge.ts). The mix and the poured
//                   elements run on; Masterless Fury does not: the collapse is
//                   the enrage.
//   The end         after the last quarter (120 s) the ring cracks, then breaks: a
//                   wipe (council_prison.ts `crush`). A real kill ends the fight
//                   as any kill does; a kill, a wipe or a reset leaves no floor
//                   gone (the fallen mask lives on this fight's state and its aura).
//
// A fallen quarter is a kill zone over the standing collision, on both hosts:
// the floor cannot truly open, so a body's fall is a carried pose. The painter
// draws the exact same test
// (hiddenFallenAt). Everything a client reads rides the phase aura and the
// hidden aura (no wire or IWorld change).

import { HEART_ROOM, type SmithHeartVein } from '../../content/smith_heart_layout';
import { HEART_QUARTERS, heartQuarterSpot } from '../../content/smith_heart_quarters';
import { DT } from '../../types';
import { clearCastIf } from '../sunken_bastion/claim';
import { clearAdds, phaseRules } from './final_adds';
import { clearBreath } from './final_breath';
import { clearHammer } from './final_hammer';
import { clearHeat } from './final_heat';
import { FINAL_AURAS } from './final_ids';
import { dropShield, dropWhatItHeld, pinCentre, shareHp } from './final_intermission';
import { stepMix } from './final_last';
import {
  FINAL_PHASE_AURAS as A,
  FINAL_PHASE_CASTS as C,
  hiddenFallOrder,
  hiddenNextCode,
  FINAL_PHASE_NAMES as N,
  FINAL_PHASES as P,
  FINAL_PHASE_CUES as Q,
  quarterBit,
} from './final_phase_ids';
import { finishFall, stepFalls, stepPlunges } from './final_plunge';
import { clearQuench } from './final_quench';
import {
  at,
  auraOf,
  cueAt,
  dropAura,
  dropFightObject,
  type FinalScope,
  heartListeners,
  overTheVoid,
  putMarker,
  raidWarn,
} from './final_scope';

const SCHOOL: Readonly<Record<SmithHeartVein, 'fire' | 'frost' | 'nature' | 'physical'>> = {
  heat: 'fire',
  quench: 'frost',
  breath: 'nature',
  hammer: 'physical',
};

const CRACK_TEXT: Readonly<Record<SmithHeartVein, { key: string; text: string }>> = {
  heat: { key: 'crackHeat', text: "The Heat's quarter is cracking! Get off it before it falls!" },
  quench: {
    key: 'crackQuench',
    text: "The Quench's quarter is cracking! Get off it before it falls!",
  },
  breath: {
    key: 'crackBreath',
    text: "The Breath's quarter is cracking! Get off it before it falls!",
  },
  hammer: {
    key: 'crackHammer',
    text: "The Hammer's quarter is cracking! Get off it before it falls!",
  },
};

/** The second a quarter's fall comes (`n` 0 the first). */
function fallAt(n: number): number {
  return P.fallEvery * (n + 1);
}

// ---- the fake death and the rebirth ---------------------------------------------------------

/** Unharmable, striking nobody, in the centre (the kneel, the rebirth). The
 *  raid can still target it: its blows show as doing nothing. */
function holdScene(s: FinalScope): void {
  const b = s.boss;
  b.damageImmune = true;
  b.swingTimer = Math.max(b.swingTimer, 0.6);
  pinCentre(s);
}

/** It kneels: whatever was running ends cleanly (Exported for the dev verb). */
export function beginKneel(s: FinalScope): void {
  const st = s.st;
  const ph = st.phase;
  const players = heartListeners(s.ctx, s.inst);
  const bars = ph.hiddenBars ?? { ...st.overload };
  dropWhatItHeld(s);
  clearAdds(s, players);
  clearHeat(s);
  clearQuench(s, players);
  clearBreath(s, players);
  clearHammer(s, players);
  clearCastIf(s.boss, C.call);
  dropShield(s);
  dropAura(s.boss, A.fury);
  dropAura(s.boss, FINAL_AURAS.unbound);
  ph.fury = 0;
  for (const v of Object.keys(st.overload) as SmithHeartVein[]) {
    st.overload[v] = 0;
    st.overloadWarned[v] = false;
  }
  st.unbound = 0;
  st.zone = 'ring';
  ph.hiddenBars = bars;
  ph.hidden = {
    scene: 0,
    fromHp: s.boss.hp,
    order: hiddenFallOrder(bars, st.lastQuarter),
    clock: 0,
    fallen: 0,
    warned: false,
    broken: false,
    fellAt: {},
    plunges: [],
  };
  ph.stage = 'kneel';
  holdScene(s);
  cueAt(s, Q.kneel, HEART_ROOM.x, HEART_ROOM.z, 40, 'arcane');
}

function beginRebirth(s: FinalScope): void {
  const h = s.st.phase.hidden;
  if (!h) return;
  s.st.phase.stage = 'rebirth';
  h.scene = 0;
  h.fromHp = s.boss.hp;
  cueAt(s, Q.rebirth, HEART_ROOM.x, HEART_ROOM.z, 40, 'arcane');
  raidWarn(
    s,
    'rebirth',
    'The Heart beats! The Masterless Strength drinks the four quarters and rises again!',
  );
}

/** The collapse begins, at exactly 20 percent or wherever a dev verb set it.
 *  Exported for the dev verb. */
export function beginCollapse(s: FinalScope): void {
  const ph = s.st.phase;
  const b = s.boss;
  ph.stage = 'collapse';
  ph.mixTurn = 0;
  ph.mixTimer = P.mixFirst;
  b.damageImmune = false;
  b.damageFloorHp = undefined;
  b.hostile = true;
  cueAt(s, Q.unmade, HEART_ROOM.x, HEART_ROOM.z, 40, 'arcane');
  raidWarn(
    s,
    'unmade',
    'The Anvil of the World is breaking apart! Kill the Masterless Strength before the last stone falls!',
  );
}

// ---- the floor falling --------------------------------------------------------------------

/** Every footprint on a quarter that just fell goes with it. */
function dropObjectsOn(s: FinalScope): void {
  const st = s.st;
  const keep = <T extends { objectId: number }>(
    list: T[],
    spot: (t: T) => { x: number; z: number },
  ) =>
    list.filter((t) => {
      if (!overTheVoid(s, spot(t))) return true;
      dropFightObject(s.ctx, s.inst, t.objectId);
      return false;
    });
  st.whirls = keep(st.whirls, (w) => {
    const e = s.ctx.entities.get(w.objectId);
    return e ? at(s, e) : HEART_ROOM;
  });
  st.pools = keep(st.pools, (p) => p);
  st.cracks = keep(st.cracks, (c) => c);
  st.tremors = keep(st.tremors, (c) => c);
  st.orbs = keep(st.orbs, (c) => c);
}

/** A quarter breaks and falls now. */
function dropQuarter(s: FinalScope, vein: SmithHeartVein): void {
  const ph = s.st.phase;
  const h = ph.hidden;
  if (!h) return;
  h.fallen++;
  h.warned = false;
  ph.fallenMask |= quarterBit(vein);
  h.fellAt[vein] = h.clock;
  dropObjectsOn(s);
  const spot = heartQuarterSpot(vein);
  cueAt(s, Q.quarterFall, spot.x, spot.z, 30, SCHOOL[vein]);
  if (h.fallen < h.order.length) return;
  cueAt(s, Q.ringCrack, HEART_ROOM.x, HEART_ROOM.z, HEART_QUARTERS.ringR, 'arcane');
  raidWarn(s, 'ringCrack', 'Only the central ring is left, and it is cracking! Kill it now!');
}

/** The ring breaks: nothing is left to stand on. */
function stepRingBroken(s: FinalScope): void {
  for (const p of s.players) {
    if (p.dead || p.ghost || p.gm || (p.profilerInvulnerable && s.ctx.devCommands)) continue;
    const here = at(s, p);
    cueAt(s, Q.bodyFall, here.x, here.z, 3, 'physical');
    finishFall(s, p, N.anvilEnd, s.boss);
  }
}

function stepCollapse(s: FinalScope): void {
  const ph = s.st.phase;
  const h = ph.hidden;
  if (!h) return;
  if (!s.st.bar) pinCentre(s);
  h.clock += DT;
  stepMix(s);
  if (h.fallen < h.order.length) {
    const when = fallAt(h.fallen);
    const vein = h.order[h.fallen];
    if (!h.warned && h.clock >= when - P.fallWarn - 1e-9) {
      h.warned = true;
      const spot = heartQuarterSpot(vein);
      cueAt(s, Q.quarterCrack, spot.x, spot.z, 30, SCHOOL[vein]);
      raidWarn(s, CRACK_TEXT[vein].key, CRACK_TEXT[vein].text);
    }
    if (h.clock >= when - 1e-9) dropQuarter(s, vein);
  } else if (!h.broken && h.clock >= fallAt(h.order.length - 1) + P.ringWarn - 1e-9) {
    h.broken = true;
    cueAt(s, Q.ringBreak, HEART_ROOM.x, HEART_ROOM.z, HEART_QUARTERS.ringR, 'arcane');
  }
  stepPlunges(s);
  stepFalls(s);
  if (h.broken) stepRingBroken(s);
}

// ---- the coordinator's calls ----------------------------------------------------------------

/** The final phase's watch: at 1 percent, on a tier with the hidden phase, it
 *  kneels. */
export function watchHidden(s: FinalScope): void {
  const ph = s.st.phase;
  if (ph.stage !== 'final' || ph.hidden || !phaseRules(s).hiddenPhase) return;
  if (s.boss.hp <= shareHp(s.boss.maxHp, P.hiddenAt)) beginKneel(s);
}

/** One tick of a hidden stage (a no-op for any other stage). */
export function stepHidden(s: FinalScope): void {
  const ph = s.st.phase;
  const h = ph.hidden;
  if (!h) return;
  if (ph.stage === 'kneel') {
    holdScene(s);
    h.scene += DT;
    if (h.scene >= P.kneelSeconds - 1e-9) beginRebirth(s);
  } else if (ph.stage === 'rebirth') {
    holdScene(s);
    h.scene += DT;
    const b = s.boss;
    const to = shareHp(b.maxHp, P.rebirthTo);
    const k = Math.min(1, h.scene / P.rebirthSeconds);
    b.hp = Math.max(b.hp, Math.round(h.fromHp + (to - h.fromHp) * k));
    if (h.scene >= P.rebirthSeconds - 1e-9) {
      b.hp = to;
      beginCollapse(s);
    }
  } else if (ph.stage === 'collapse') stepCollapse(s);
}

/** Write the collapse onto its aura (only when it changes). */
export function showHidden(s: FinalScope): void {
  const ph = s.st.phase;
  const h = ph.hidden;
  if (ph.stage !== 'collapse' || !h) return;
  const b = s.boss;
  const quarters = h.fallen < h.order.length;
  const next = h.broken ? null : quarters ? h.order[h.fallen] : 'ring';
  const when = quarters ? fallAt(h.fallen) : fallAt(h.order.length - 1) + P.ringWarn;
  const code = hiddenNextCode(next);
  const seconds = h.broken ? 0 : Math.max(0, Math.ceil(when - h.clock - 1e-9));
  const a = auraOf(b, A.hidden);
  if (!a) {
    putMarker(b, A.hidden, N.unmade, 3600, b.id, {
      permanent: true,
      value: ph.fallenMask,
      value2: code,
      value3: seconds,
      school: 'arcane',
    });
    return;
  }
  if (a.value !== ph.fallenMask) a.value = ph.fallenMask;
  if (a.value2 !== code) a.value2 = code;
  if (a.value3 !== seconds) a.value3 = seconds;
}

// ---- dev ------------------------------------------------------------------------------------

/** A quarter falls now (`vein`, or the next in the order); the clock moves to
 *  its time, so the cadence runs on from it. Returns it, or null when it has
 *  already fallen. */
export function devFall(s: FinalScope, vein: SmithHeartVein | null): SmithHeartVein | null {
  const h = s.st.phase.hidden;
  if (!h || h.fallen >= h.order.length) return null;
  const v = vein ?? h.order[h.fallen];
  const i = h.order.indexOf(v);
  if (i < h.fallen) return null;
  h.order.splice(i, 1);
  h.order.splice(h.fallen, 0, v);
  h.clock = Math.max(h.clock, fallAt(h.fallen));
  dropQuarter(s, v);
  return v;
}

/** Every quarter gone and the ring's warning running. */
export function devCrack(s: FinalScope): void {
  const h = s.st.phase.hidden;
  if (!h) return;
  while (h.fallen < h.order.length) devFall(s, null);
}
