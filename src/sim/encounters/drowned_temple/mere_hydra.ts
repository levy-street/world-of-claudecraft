// The Mere Hydra in the Hydra Pool (docs/design/dungeon-rework/drowned_temple.md
// 4.3, reworked in the sixth pass): three stationary heads rising from one moon
// pool, one pull (G17 linked parts: the heads share one fight state, referenced
// from each head).
//
//   Snap           each head bites whoever stands in its long reach (its own
//                  swing: the tank).
//   Three elements the left head is ICE (Freezing Breath), the centre VENOM (Venom
//                  Spit), the right WATER (Crushing Torrent): hydra_elements.ts.
//                  When a head falls the survivors INHERIT its attack, so
//                  killing one never makes the fight quieter.
//   Tsunami        the Hydra sinks and a wave rolls over one half of the pool;
//                  run to the other half or into a column's lee
//                  (hydra_tsunami.ts).
//   Regrowth       a fallen head grows back 20 s later while another lives
//                  (hydra_regrowth.ts): bring the three down close together.
//   Enraged Hydra  each fallen head drives the others 15 percent harder.
//   Combined Breath between two Tsunamis two heads fuse their elements, in a
//                  fixed order (hydra_combo.ts): the Frostlocked Torrent's Ice
//                  Wall shelters from the next wave, the Venom Current slides
//                  the pools, the Toxic Rime freezes them to burst.
//
// Zero rng in every pick (the victims are hashed, the Tsunami's side
// alternates); the only draws are the damage rolls.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity, type HydraFightState } from '../../types';
import { bossEngaged, claimBoss, clearCastOf, dropEncounterObject, grantClaimDeed } from './claim';
import {
  clearCombo,
  comboHolding,
  stepCombo,
  stepComboHazards,
  stepComboSlots,
} from './hydra_combo';
import {
  startBrineSpit,
  startTideBreath,
  startTorrent,
  stepBreath,
  stepTorrent,
  stepVenom,
} from './hydra_elements';
import { regrowHead, releaseHeldHeadLoot, stepRegrowth } from './hydra_regrowth';
import { clearTsunami, startTsunami, stepTsunami } from './hydra_tsunami';
import {
  HYDRA_CRUSHING_TORRENT,
  HYDRA_ENRAGED,
  HYDRA_HEAD_TEMPLATES,
  HYDRA_SUBMERGED,
  HYDRA_TIDE_BREATH,
  HYDRA_TSUNAMI,
  HYDRA_TUNING,
  hydraElementOwners,
} from './ids';

export { startCombo } from './hydra_combo';
export { startBrineSpit, startTideBreath, startTorrent } from './hydra_elements';
export { startTsunami } from './hydra_tsunami';

const T = HYDRA_TUNING;
export const HYDRA_DEED = 'dgn_mere_hydra';

function freshState(): HydraFightState {
  return {
    kind: 'hydra',
    breathTimer: T.breathFirst,
    spitTimer: T.spitFirst,
    torrentTimer: T.torrentFirst,
    spits: [],
    venom: [],
    torrent: null,
    tsunamiTimer: T.tsunamiFirst,
    tsunamis: 0,
    tsunami: null,
    casts: 0,
    diedAt: [null, null, null],
    combos: 0,
    comboSlot: 0,
    combo: null,
    iceWall: null,
    currents: [],
    crystals: [],
  };
}

/** The claim's three heads, left to right (dead or alive), or null when a
 *  claim has none (another dungeon). */
export function hydraHeads(ctx: SimContext, inst: InstanceSlot): (Entity | null)[] | null {
  const heads = HYDRA_HEAD_TEMPLATES.map((id) => claimBoss(ctx, inst, id));
  return heads.some((h) => h !== null) ? heads : null;
}

/** The head wielding each element now (ice, venom, water), or null. */
export function elementWielders(heads: readonly (Entity | null)[]): (Entity | null)[] {
  const owners = hydraElementOwners(heads.map((h) => !h || h.dead));
  return owners.map((i) => (i === null ? null : heads[i]));
}

/** Enraged Hydra: every living head wears one stack per fallen head. */
function applyEnrage(ctx: SimContext, heads: readonly (Entity | null)[], fallen: number): void {
  for (const h of heads) {
    if (!h || h.dead) continue;
    const have = h.auras.find((a) => a.id === HYDRA_ENRAGED);
    if (fallen <= 0) {
      if (have) h.auras = h.auras.filter((a) => a.id !== HYDRA_ENRAGED);
      continue;
    }
    const value = T.enragePerHead * fallen;
    if (have && Math.abs(have.value - value) < 1e-9) continue;
    ctx.applyAura(h, {
      id: HYDRA_ENRAGED,
      name: 'Enraged Hydra',
      kind: 'buff_dmg_done',
      remaining: 9999,
      duration: 9999,
      value,
      stacks: fallen,
      sourceId: h.id,
      school: 'physical',
    });
  }
}

/** The fight ended without a kill: the pools drain, the wave falls back and
 *  every fallen head grows back whole for the next attempt. */
function resetHydra(ctx: SimContext, inst: InstanceSlot, heads: readonly (Entity | null)[]): void {
  const anyAlive = heads.some((h) => h !== null && !h.dead);
  for (const h of heads) {
    if (!h) continue;
    const st = h.templeFight?.kind === 'hydra' ? h.templeFight : null;
    if (st) {
      for (const s of st.spits) dropEncounterObject(ctx, inst, s.objectId);
      for (const v of st.venom) dropEncounterObject(ctx, inst, v.objectId);
      st.spits = [];
      st.venom = [];
      clearTsunami(ctx, inst, st);
      clearCombo(ctx, inst, heads, st);
    }
    for (const id of [HYDRA_TIDE_BREATH, HYDRA_CRUSHING_TORRENT, HYDRA_TSUNAMI]) clearCastOf(h, id);
    h.auras = h.auras.filter((a) => a.id !== HYDRA_ENRAGED && a.id !== HYDRA_SUBMERGED);
    h.templeFight = undefined;
    if (h.dead && anyAlive) regrowHead(ctx, h, 1);
  }
}

/** The element clocks: each fires from whoever wields it, when that head is free. */
function stepElements(
  ctx: SimContext,
  inst: InstanceSlot,
  heads: readonly (Entity | null)[],
  st: HydraFightState,
): void {
  const [ice, venom, water] = elementWielders(heads);
  // A Combined Breath due or running holds the plain bars (hydra_combo.ts).
  const hold = comboHolding(inst, st);
  const free = (h: Entity | null): h is Entity =>
    !hold && h !== null && !h.dead && h.castingAbility === null && !ctx.isStunned(h);
  st.breathTimer -= DT;
  if (st.breathTimer <= 0) {
    st.breathTimer = free(ice) && startTideBreath(ctx, inst, ice, st) ? T.breathEvery : 1;
  }
  st.torrentTimer -= DT;
  if (st.torrentTimer <= 0) {
    st.torrentTimer = free(water) && startTorrent(ctx, inst, water, st) ? T.torrentEvery : 1;
  }
  st.spitTimer -= DT;
  if (st.spitTimer <= 0) {
    // The spit is instant (no bar): only a stun or death stops it.
    st.spitTimer =
      venom && !venom.dead && !ctx.isStunned(venom) && startBrineSpit(ctx, inst, venom, st) > 0
        ? T.spitEvery
        : 1;
  }
}

/** One tick of the Mere Hydra's fight (all three heads). */
export function tickMereHydra(ctx: SimContext, inst: InstanceSlot): void {
  const heads = hydraHeads(ctx, inst);
  if (!heads) return;
  const living = heads.filter((h): h is Entity => h !== null && !h.dead);
  const anyState = heads.find((h) => h?.templeFight?.kind === 'hydra')?.templeFight;
  const found = anyState?.kind === 'hydra' ? anyState : null;
  if (living.length === 0) {
    for (const h of heads) releaseHeldHeadLoot(h);
    if (found) {
      const d = found.diedAt.map((t) => t ?? ctx.time);
      if (Math.max(...d) - Math.min(...d) <= T.deedWindow) grantClaimDeed(ctx, inst, HYDRA_DEED);
      resetHydra(ctx, inst, heads);
    }
    return;
  }
  const engaged = living.some((h) => bossEngaged(h));
  if (!engaged) {
    if (found) resetHydra(ctx, inst, heads);
    return;
  }
  const st = found ?? freshState();
  if (!found) for (const h of heads) if (h) h.templeFight = st;
  // Each head's fall on the fight's clock (a regrown head clears its own).
  heads.forEach((h, i) => {
    if (h?.dead && st.diedAt[i] === null) st.diedAt[i] = ctx.time;
  });
  if (!st.tsunami) stepRegrowth(ctx, heads, st);
  const standing = heads.filter((h): h is Entity => h !== null && !h.dead);
  applyEnrage(ctx, heads, heads.filter((h) => h?.dead).length);
  for (const h of standing) {
    stepBreath(ctx, inst, h);
    stepTorrent(ctx, inst, h, st);
  }
  const [, venomHead] = elementWielders(heads);
  stepVenom(ctx, inst, st, venomHead ?? standing[0]);
  stepCombo(ctx, inst, heads, st);
  stepComboHazards(ctx, inst, st, venomHead ?? standing[0]);
  if (stepTsunami(ctx, inst, standing, st)) return;
  st.tsunamiTimer -= DT;
  if (st.tsunamiTimer <= 0) {
    if (startTsunami(ctx, inst, standing, st)) {
      st.tsunamiTimer = T.tsunamiEvery;
      return;
    }
    st.tsunamiTimer = 0.5;
  }
  stepComboSlots(ctx, inst, heads, st);
  stepElements(ctx, inst, heads, st);
}
