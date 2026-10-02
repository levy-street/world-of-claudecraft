// Coverage proof: each scenario must ACTUALLY fire its target subsystem (not just
// name it in a comment). These assertions inspect the live events + final state of
// a recorded run. If a future content change breaks a recipe, this fails loudly so
// the golden never silently stops exercising a system.
// Display-name literals follow the LOCKED NAME-MAP (authorized gate-text edit per the
// OPERATOR RULING, 2026-07-02, ip-refactor/02-WORKING-MEMORY.md); ability/aura IDS are frozen.
// Case block d of the coverage suite. The cases register through the `it`
// the parity runner passes in (run_scenarios.ts), which runs each one right
// after the gate case of the scenario it reads, on the SAME recording the
// gate compared with its golden (recording_cache.ts). Assertions are
// unchanged from the per-file suite they came from.

import { expect } from 'vitest';
import {
  HEROIC_DUNGEON_TUNING,
  HEROIC_MARK_ITEM_ID,
} from '../../src/sim/content/dungeon_difficulty';
import { FREEHOLD_INN_ROOM_DUNGEON_ID } from '../../src/sim/content/freehold';
import { HEROIC_BOSS_LOOT } from '../../src/sim/content/heroic_loot';
import { DUNGEONS, ITEMS, MOBS } from '../../src/sim/data';
import { countRawInSlots, countUnlockedInSlots } from '../../src/sim/item_lock';
import { RIFT_IMPAIRED_FUSE_CAP } from '../../src/sim/mob/rift_escape_window';
import {
  FARM_GOLDEN_BONUS_PATTERN_IDS,
  FARM_SEED_BACK_TWO_CHANCE,
  farmGoldenBonusSeedTier,
  farmingHarvestGainAt,
  farmSeedIdsOfTier,
  resolveFarmHarvest,
} from '../../src/sim/professions/farming';
import { PERFECTING_ATTEMPT_COST, PERFECTING_RANKS } from '../../src/sim/professions/perfecting';
import { riftNormalClearPool } from '../../src/sim/rift/loot_pools';
import {
  RIFT_COIN_BONUS_A,
  RIFT_COIN_BONUS_B,
  RIFT_COIN_BONUS_C,
  RIFT_COIN_BONUS_S,
  RIFT_PATTERN_ITEM_IDS,
} from '../../src/sim/rift/progression';
import { RIFT_S_ZONE_TEMPO } from '../../src/sim/rift/ranks';
import { type CoverageIt, type Ev, entities, recordShared as record, run } from './recording_cache';
import {
  FARM_GOLDEN_PADDING_CYCLES,
  FARM_GOLDEN_WIN_YIELD_SEED,
  FARM_TONIC_WINNER_YIELD_SEED,
  HEROIC_FIVE_MAN_BOSS_ID,
  HEROIC_FIVE_MAN_DUNGEON_ID,
  PERFECTING_WALK_ATTEMPT_CAP,
  SCENARIOS,
} from './scenarios';

export function coverageCasesD(it: CoverageIt): void {
  it('druid_engines: all three live buttons arm and their payoffs fire', () => {
    const rec = run('druid_engines');
    expect(rec.notes.moonlashArmed).toBe(true);
    expect(rec.notes.sunlanceArmed).toBe(true);
    expect(rec.notes.redharvestArmed).toBe(true);
    expect(rec.notes.marrowbreakArmed).toBe(true);
    expect(rec.notes.overbloomArmed).toBe(true);
    const abilities = (rec.allEvents as Ev[])
      .filter((event) => event.type === 'damage' || event.type === 'heal2')
      .map((event) => event.ability);
    expect(abilities).toContain('Moonsurge');
    expect(abilities).toContain('Sunwake');
    expect(abilities).toContain('Redharvest');
    expect(abilities).toContain('Marrowbreak');
    expect(abilities).toContain('Overbloom');
  });

  it('priest_codex: all three baseline loops fire and respec cleanup completes', () => {
    const rec = run('priest_codex');
    const ev = rec.allEvents as Ev[];
    expect(ev.some((event) => event.type === 'heal2' && event.ability === 'Doctrine')).toBe(true);
    expect(ev.some((event) => event.type === 'heal2' && event.ability === 'Seraphic Vigil')).toBe(
      true,
    );
    expect(ev.some((event) => event.type === 'heal2' && event.ability === 'Choirmend')).toBe(true);
    expect(
      ev.some((event) => event.type === 'heal2' && event.ability === 'Sunburst Canticle'),
    ).toBe(true);
    expect(ev.some((event) => event.type === 'damage' && event.ability === 'Effigy Echo')).toBe(
      true,
    );
    expect(
      ev.some((event) => event.type === 'damage' && event.ability === 'Tithefiend Strike'),
    ).toBe(true);
    expect(rec.notes.guardianId).not.toBeNull();
    expect(rec.notes.bankBeforeMindfracture).toBe(0);
    expect(rec.notes.bankAfterMindfracture).toBe(1);
    expect(rec.notes.mindfractureEchoTargets).toEqual(rec.notes.expectedEchoTargets);
    expect(rec.notes.foreignOwnerIsolated).toBe(true);
    expect(rec.notes.manaAfterGuardian).toBeGreaterThan(rec.notes.manaAfterSummon as number);
    expect(rec.notes.respecSucceeded).toBe(true);
    expect(rec.notes.cleanupComplete).toBe(true);
  });

  // This block exists because its absence is what let the scenario rot. Its
  // stand point for step 1 was an inlined coordinate; the v0.32.0 merge moved
  // ore_mirefen_t2 and the harvest became a "Too far away." denial, faithfully
  // recorded in the golden as 0 draws at the fine-grade frame and 4 total where
  // three granted harvests are 6. The gate stayed green the whole time, because
  // nothing here asserted the fine-grade arm actually fires.
  it('professions_gather_fine: all three harvests grant, and only the full-grade vein upgrades', () => {
    const { trace, rec } = record(SCENARIOS.find((s) => s.name === 'professions_gather_fine')!);
    const ev = rec.allEvents as Ev[];

    // Three granted harvests, in drive order, each carrying the grade its vein
    // and tool resolve to: fine at the full-grade vein (tier-3 pick strictly
    // above iron's rung 2), plain at the zone's tier-1 vein (the vein is below
    // the rung, so no tool upgrades it), plain at the herb patch (the tier-2
    // sickle only MATCHES goldleaf's rung, and the pick is the wrong
    // profession).
    const gathers = ev.filter((e) => e.type === 'gatherResult');
    expect(gathers).toHaveLength(3);
    expect(gathers.map((e) => [e.nodeId, e.itemId])).toEqual([
      ['ore_mirefen_t2', 'fine_iron_ore'],
      ['ore_mirefen_1', 'iron_ore'],
      ['herb_mirefen_t2', 'goldleaf_herb'],
    ]);

    // No harvest was refused for standing in the wrong place: the exact
    // regression this block guards, and the reason step 1's stand point is
    // derived from the node instead of inlined.
    expect(ev.some((e) => e.type === 'error' && e.text === 'Too far away.')).toBe(false);

    // Two draws per granted harvest and no more: six total, with the
    // fine-grade arm spending its own two (it spent ZERO while stale).
    const fine = trace.frames.find((f) => f.label === 'fine-grade-at-full-tier-vein');
    expect(fine, 'missing the fine-grade checkpoint frame').toBeTruthy();
    expect(fine!.rng.draws).toBe(2);
    expect(trace.draws).toBe(6);
  });

  it('professions_tool_effect_slot: draw-free mint, the quantity bonus fires, and one charge settles', () => {
    const { trace, rec } = record(
      SCENARIOS.find((s) => s.name === 'professions_tool_effect_slot')!,
    );
    const ev = rec.allEvents as Ev[];
    const pid = (rec.sim as any).playerId as number;
    const meta = (rec.sim as any).players.get(pid);

    // Two mints landed on the slot action (the 'always' mint plus the R40
    // prompt re-slot), both for this player's mining profession, and both
    // consumed charm copies are gone from the bags.
    const slotted = ev.filter((e) => e.type === 'toolEffectResult' && e.action === 'slot');
    expect(slotted).toHaveLength(2);
    for (const s of slotted) {
      expect(s.ok).toBe(true);
      expect(s.professionId).toBe('mining');
      expect(s.effectId).toBe('gatherers_cache');
      expect(s.pid).toBe(pid);
    }
    expect(meta.inventory.some((s: any) => s.itemId === 'gatherers_cache')).toBe(false);
    // Draw-free in every arm: the whole mint stands at zero draws.
    const minted = trace.frames.find((f) => f.label === 'effect-slotted');
    expect(minted, 'missing the mint checkpoint frame').toBeTruthy();
    expect(minted!.rng.draws).toBe(0);

    // Three granted harvests, in drive order: the 'always' bonus harvest,
    // the R40 UNCONFIRMED prompt use (base quantity, the fail-safe), and
    // the CONFIRMED prompt use (+1 fires). gatherResult carries no effect
    // flag, so each +1 is read off the granted qty against the shipped
    // yield table for the SAME rolled rarity (the same-draw base the R42
    // settle compares against).
    const gathers = ev.filter((e) => e.type === 'gatherResult');
    expect(gathers.map((g) => g.nodeId)).toEqual([
      'ore_mirefen_t2',
      'ore_mirefen_1',
      'ore_mirefen_t2b',
    ]);
    const qtyByRarity: Record<string, number> = {
      common: 1,
      uncommon: 2,
      rare: 2,
      epic: 3,
      legendary: 4,
    };
    const baseOf = (g: Ev): number => qtyByRarity[g.rarity] * (g.rareEvent ? 5 : 1);
    expect(gathers[0].professionId).toBe('mining');
    expect(gathers[0].qty).toBe(baseOf(gathers[0]) + 1);
    expect(gathers[1].qty).toBe(baseOf(gathers[1]));
    expect(gathers[2].qty).toBe(baseOf(gathers[2]) + 1);
    // A 30-charge slot never empties here, so the last-charge flag stays
    // ABSENT from every event (the additive-optional wire contract).
    expect(gathers.every((g) => !('effectDepleted' in g))).toBe(true);

    // The draw ledger, cumulative per checkpoint (rng.draws counts from
    // drive start): every granted harvest is exactly two draws and nothing
    // else draws, so the R40 consent gate adds NO draw on either of its
    // arms and both mints stay draw-free (the prompt re-slot checkpoint
    // sits at the same count as the harvest before it).
    const drawsAt = (label: string): number => {
      const frame = trace.frames.find((f) => f.label === label);
      expect(frame, `missing the ${label} checkpoint frame`).toBeTruthy();
      return frame?.rng.draws ?? -1;
    };
    expect(drawsAt('harvest-with-effect-applied')).toBe(2);
    expect(drawsAt('prompt-mode-reslotted')).toBe(2);
    expect(drawsAt('prompt-unconfirmed-skips-whole')).toBe(4);
    expect(drawsAt('prompt-confirmed-fires-and-spends')).toBe(6);
    expect(
      ev.some(
        (e) => e.type === 'error' && e.text === 'This resource node has not respawned for you yet.',
      ),
    ).toBe(true);
    expect(trace.draws).toBe(6);

    // The R42 charge settle, pinned where the golden records it: the final
    // checkpoint's sampled slot row. One bonus-bearing harvest spent exactly
    // one charge, so durability sits strictly below the slot's own ceiling.
    // The ceiling is an absolute pin, not a self-comparison: 20 base charges
    // for the cache plus one rarity rung for the uncommon tier-3 pick, and the
    // R47 use-time ratchet leaves it there because that pick was already the
    // best tool owned at mint time.
    const finalFrame = trace.frames.find((f) => f.label === 'final');
    expect(finalFrame, 'missing the final checkpoint frame').toBeTruthy();
    const slot = (finalFrame!.players?.[0] as any)?.toolEffectSlots?.mining;
    expect(slot, 'the final checkpoint sampled no mining tool-effect slot').toBeTruthy();
    expect(slot.effectId).toBe('gatherers_cache');
    // The R40 re-slot carried the prompt mode onto the live row, and only
    // the CONFIRMED use spent from the fresh 30: the unconfirmed one kept
    // its charge (the fail-safe), so exactly one charge is gone.
    expect(slot.confirmMode).toBe('prompt');
    // The self-signed charm's signer became the slot's original-crafter identity.
    expect(slot.craftedBy).toBe(meta.name);
    expect(slot.maxDurability).toBe(30);
    expect(slot.durability).toBeLessThan(slot.maxDurability);
    expect(slot.durability).toBe(29);
  });

  it('farming_session: plants draw two each, every harvest a golden roll and its bonus, the tier-3 one the seed-back too', () => {
    const { trace, rec } = record(SCENARIOS.find((s) => s.name === 'farming_session')!);
    const ev = rec.allEvents as Ev[];
    const pid = (rec.sim as any).playerId as number;
    const meta = (rec.sim as any).players.get(pid);

    // All five plants landed, in drive order, each instantly (no cast). The
    // second lands inside the tick window the drive still keeps between
    // plants; the third is the knobbed plant on the freed bed; the fourth is
    // the tier-3 barley at the Thornpeak patch; the fifth is the Phase 8
    // ready-notice beat back on the freed northern bed.
    expect(ev.filter((e) => e.type === 'farmPlanted').map((e) => e.bedId)).toEqual([
      'bed_eastbrook_1',
      'bed_eastbrook_2',
      'bed_eastbrook_1',
      'bed_thornpeak_1',
      'bed_eastbrook_1',
      // The Phase 11 (bw) extension: the padding cycles on the southern bed,
      // the golden-WIN plant on the northern bed, one more padding cycle,
      // then the paying-band barley at Thornpeak (see the drive's probe
      // comment for why the padding walks the stream). The count is composed
      // from the scenario's own constant, which Phase 11f re-probed from 28 to
      // 36 when the golden bonus draw lengthened a cycle.
      ...Array.from({ length: FARM_GOLDEN_PADDING_CYCLES }, () => 'bed_eastbrook_2'),
      'bed_eastbrook_1',
      'bed_eastbrook_2',
      'bed_thornpeak_1',
    ]);
    // One farmPlanted per plant and NO cast at all (the farming-tools report
    // retired the flavor cast: planting is instant), composed from the beats
    // rather than a bare literal: the five scripted plants, one per padding
    // cycle, the golden-win plant, the final padding cycle, and the paying
    // barley.
    const PLANTS = 5 + FARM_GOLDEN_PADDING_CYCLES + 1 + 1 + 1;
    expect(
      ev.filter((e) => e.type === 'farmPlanted'),
      'every plant landed as a farmPlanted event',
    ).toHaveLength(PLANTS);
    expect(
      ev.filter((e) => e.type === 'castStart' && e.ability === 'farming'),
      'no plant starts a cast any more',
    ).toHaveLength(0);
    expect(PLANTS, 'the session plants 44 crops').toBe(44);

    // THE READY NOTICE (Phase 8): the fifth plant is left standing across two
    // 1 Hz boundaries, so the sweep fires EXACTLY once for it: a second event
    // here means the notified flip stopped silencing the sweep, and zero
    // means the sweep stopped observing ready plots at all. Counts only, no
    // withered field on an all-survived notice.
    expect(ev.filter((e) => e.type === 'farmReady')).toEqual([
      { type: 'farmReady', pid, ready: 1 },
    ]);

    // THE DRAW LEDGER, the point of this scenario. rng.draws is cumulative
    // from drive start: two draws per plant (the contiguous survival + yield
    // seed pre-roll), EXACTLY one golden-harvest roll at EVERY harvest
    // (both outcomes, the celebrations phase), plus the seed-back roll at
    // the tier-3 harvest (so harvested-t3 sits at planted-t3 + 2, the
    // contiguous pair), and NOTHING anywhere else. Growth windows and the
    // husk trade sit at the count of the beat before them; the two tier-1
    // opening harvests land together in the harvested frame at +2 (one
    // golden roll each, survived and withered alike).
    const drawsAt = (label: string): number => {
      const frame = trace.frames.find((f) => f.label === label);
      expect(frame, `missing the ${label} checkpoint frame`).toBeTruthy();
      return frame?.rng.draws ?? -1;
    };
    // The ledger is spelled as ARITHMETIC over the contract's own terms rather
    // than as bare cumulative literals, and it was re-derived that way at
    // masterwrought Phase 11f, which added the golden BONUS roll and so moved
    // every harvest by one. A wall of recomputed numbers would have been
    // "adopt whatever the run printed"; written as sums, each line states the
    // MODEL and the total falls out, so a wrong count names which beat is
    // wrong instead of only that the file drifted.
    const PLANT = 2; // the contiguous survival + yield-seed pre-roll
    const HARVEST_LOW = 2; // tier 1/2: the golden roll, then the golden bonus
    const HARVEST_HIGH = 3; // tier 3/4: the seed-back roll, then those two
    const PAD_CYCLE = PLANT + HARVEST_LOW; // one tier-1 padding plant + harvest
    expect(drawsAt('planted-first')).toBe(PLANT);
    expect(drawsAt('planted')).toBe(2 * PLANT);
    expect(drawsAt('grown')).toBe(2 * PLANT); // growth windows draw nothing
    expect(drawsAt('harvested')).toBe(2 * PLANT + 2 * HARVEST_LOW);
    expect(drawsAt('planted-knobbed')).toBe(3 * PLANT + 2 * HARVEST_LOW);
    expect(drawsAt('harvested-toniced')).toBe(3 * PLANT + 3 * HARVEST_LOW);
    expect(drawsAt('husks-converted')).toBe(3 * PLANT + 3 * HARVEST_LOW); // the trade draws nothing
    expect(drawsAt('planted-t3')).toBe(4 * PLANT + 3 * HARVEST_LOW);
    expect(drawsAt('harvested-t3')).toBe(4 * PLANT + 3 * HARVEST_LOW + HARVEST_HIGH);
    // The Phase 8 ready-notice beat: its plant pre-rolls its pair, then
    // NOTHING draws through the sweep that emits the notice or the sampled
    // notified flag, and the closing tier-1 harvest spends exactly its own two.
    expect(drawsAt('ready-noticed')).toBe(5 * PLANT + 3 * HARVEST_LOW + HARVEST_HIGH);
    expect(drawsAt('harvested-noticed')).toBe(5 * PLANT + 4 * HARVEST_LOW + HARVEST_HIGH);
    // The Phase 11 (bw) extension: the padding cycles plus the win plant put the
    // golden-WIN harvest's rolls next, then the final padding cycle plus the
    // barley plant put the paying seed-back triple last. The padding arithmetic
    // is the probe comment in the drive; these sums are what pin it.
    const AFTER_NOTICED = 5 * PLANT + 4 * HARVEST_LOW + HARVEST_HIGH;
    const PLANTED_GOLDEN = AFTER_NOTICED + FARM_GOLDEN_PADDING_CYCLES * PAD_CYCLE + PLANT;
    expect(drawsAt('planted-golden')).toBe(PLANTED_GOLDEN);
    expect(drawsAt('harvested-golden-win')).toBe(PLANTED_GOLDEN + HARVEST_LOW);
    const PLANTED_T3_PAYING = PLANTED_GOLDEN + HARVEST_LOW + PAD_CYCLE + PLANT;
    expect(drawsAt('planted-t3-paying')).toBe(PLANTED_T3_PAYING);
    const TOTAL = PLANTED_T3_PAYING + HARVEST_HIGH;
    expect(drawsAt('harvested-t3-paying')).toBe(TOTAL);
    // THE PHASE 12 BEAT-P FRAMES: the dish's tick-phase mint and the whole
    // feast loop (place, bite, mint, expire) draw NOTHING, so the ledger closes
    // with every appended frame flat.
    expect(drawsAt('wellfed-eating')).toBe(TOTAL);
    expect(drawsAt('wellfed-dish-minted')).toBe(TOTAL);
    expect(drawsAt('feast-placed')).toBe(TOTAL);
    expect(drawsAt('feast-bitten')).toBe(TOTAL);
    expect(drawsAt('feast-wellfed-minted')).toBe(TOTAL);
    expect(drawsAt('feast-expired')).toBe(TOTAL);
    expect(trace.draws).toBe(TOTAL);
    // The composed total, stated ONCE as a literal beside the arithmetic:
    // without it a term that halved while another doubled would keep every sum
    // above self-consistent and the whole ledger would slide together.
    expect(TOTAL, 'the whole session costs 178 draws').toBe(178);

    // The knobbed plant really stored all three paid flags (farmPlanted is
    // knob-free on the wire, so the drive stashes the stored plot's flags).
    expect(rec.notes.knobbedFlags).toEqual({ compost: true, watch: true, tonic: true });

    // The first survived plot paid produce expanded from its stored yield
    // seed: the guaranteed three-pick floor, with no pick upgrading at
    // proficiency 0 (the fine chance there is 0.02), so BOTH fine fields stay
    // absent and the common harvest keeps the pre-field wire shape. No
    // seedBackCount either: tier 1 never rolls (the omit-zero doctrine).
    const harvested = ev.filter((e) => e.type === 'farmHarvested');
    expect(harvested).toHaveLength(6);
    // The Phase 8 closing harvest: skill sits at 75-and-change by now, and its
    // yieldSeed mints at a stream position the upstream rolls decide, so the
    // expansion's exact count is the recorded truth of the re-recorded golden,
    // a literal for the drawsAt reason above. It moved 3 -> 4 at Phase 11f
    // because the golden BONUS draw re-seated every later mint by one per
    // harvest; the SHAPE is what the arm is really about and did not move: no
    // fine fields and no seed-back on a tier-1 crop, and no goldenBonusItemId
    // because this harvest's own golden roll loses, so nothing multiplied.
    expect(harvested[3]).toEqual({
      type: 'farmHarvested',
      pid,
      bedId: 'bed_eastbrook_1',
      cropId: 'vale_wheat',
      itemId: 'vale_wheat',
      count: 4,
    });
    expect('fineItemId' in harvested[3]).toBe(false);
    expect('seedBackCount' in harvested[3]).toBe(false);
    expect(harvested[0].bedId).toBe('bed_eastbrook_1');
    expect(harvested[0].itemId).toBe('vale_wheat');
    expect(harvested[0].count).toBe(3);
    expect('fineItemId' in harvested[0]).toBe(false);
    expect('fineCount' in harvested[0]).toBe(false);
    expect('seedBackCount' in harvested[0]).toBe(false);

    // The plot forced to fail paid husks INSTEAD of produce, and said so with
    // its own event rather than a quiet empty harvest. Tier 1: no seed-back
    // field on the withered arm either.
    const withered = ev.filter((e) => e.type === 'farmWithered');
    // One from the original forced-fail beat, then one per padding cycle plus
    // the final one before the barley beat (all on the southern bed at the
    // written skill-0 window, each paying the same two-husk batch, none
    // carrying a seed-back field). Composed from the padding constant, so the
    // Phase 11f re-probe moved this by construction rather than by hand.
    const WITHERED = 1 + FARM_GOLDEN_PADDING_CYCLES + 1;
    expect(withered).toHaveLength(WITHERED);
    expect(WITHERED, 'the session withers 38 plots').toBe(38);
    expect(withered[0].bedId).toBe('bed_eastbrook_2');
    expect(withered[0].count).toBe(2);
    expect('seedBackCount' in withered[0]).toBe(false);
    for (const w of withered.slice(1)) {
      expect(w.bedId).toBe('bed_eastbrook_2');
      expect(w.count).toBe(2);
      expect('seedBackCount' in w).toBe(false);
    }

    // The toniced harvest, on the probed WINNING yieldSeed the drive wrote
    // (the M8 lesson: at a losing seed both expansions coincide and this
    // beat proves nothing). The in-arm non-vacuity guard is the first
    // assertion: the toniced expansion of that seed really exceeds the
    // unarmed one at the harvest-time skill of 1 (the first harvest's +1
    // gain had drained by then).
    const toniced = resolveFarmHarvest(FARM_TONIC_WINNER_YIELD_SEED, 1, true);
    const unarmed = resolveFarmHarvest(FARM_TONIC_WINNER_YIELD_SEED, 1, false);
    expect(toniced.count).toBeGreaterThan(unarmed.count);
    expect(toniced.fine).toBe(0); // the probe chose a fine-free winner
    expect(harvested[1].bedId).toBe('bed_eastbrook_1');
    expect(harvested[1].itemId).toBe('vale_wheat');
    expect(harvested[1].count).toBe(toniced.count);
    expect('fineItemId' in harvested[1]).toBe(false);
    expect('seedBackCount' in harvested[1]).toBe(false);

    // The husk trade: the withered beat paid exactly 2 husks, one batch, so
    // one call converts them into exactly one compost.
    const convertedEv = ev.filter((e) => e.type === 'farmHusksConverted');
    expect(convertedEv).toHaveLength(1);
    expect(convertedEv[0].husks).toBe(2);
    expect(convertedEv[0].compost).toBe(1);

    // The tier-3 harvest. The band is pinned as a LITERAL, the drawsAt style
    // above: it is the recorded truth of the re-recorded farming_session
    // golden and moves only with a deliberate re-record, never silently. Its
    // history is the point: the celebrations phase's golden rolls re-seated
    // the seed-back roll from the old draw 9 (0.297173, the one-seed band) to
    // draw 12 (0.981881, the zero band), and masterwrought Phase 11f's golden
    // BONUS draw re-seated it again, off the zero band and onto the TWO-seed
    // band. Both are expected ledger shifts from an appended draw, not band
    // retunes: FARM_SEED_BACK_TWO_CHANCE is untouched, which the arm below
    // states directly rather than leaving to the reader. The bag consistency
    // arm stays: the event's count must equal the highland_barley_seed bag
    // delta (the drive granted 1 seed and the plant spent it, so the final bag
    // IS the seed-back), and the base/fine grants must match their bags the
    // same way.
    const countOf = (itemId: string): number =>
      meta.inventory
        .filter((s: any) => s.itemId === itemId)
        .reduce((n: number, s: any) => n + (s.count ?? 1), 0);
    const barleyEv = harvested[2];
    expect(barleyEv.bedId).toBe('bed_thornpeak_1');
    expect(barleyEv.cropId).toBe('highland_barley');
    const seedBack = (barleyEv.seedBackCount as number | undefined) ?? 0;
    expect(seedBack).toBe(2);
    // Present, because it is positive: the omit-zero doctrine says the field
    // appears exactly when the roll paid, and this stream position now lands
    // in the two-seed band.
    expect('seedBackCount' in barleyEv).toBe(true);
    // The band constants themselves are UNTOUCHED by the phase, stated here so
    // "the shift is a re-seat, not a retune" is asserted rather than asserted
    // in a comment. Their own literal pin lives in
    // tests/professions_farming.test.ts.
    expect(FARM_SEED_BACK_TWO_CHANCE[3]).toBe(0.08);

    // THE PHASE 11 (bw) BEATS, in the same drawsAt-literal style: the golden
    // WIN and the PAYING seed-back band are the recorded truth of the
    // re-recorded golden and move only with a deliberate re-record.
    const goldenEv = harvested[4];
    const barleyPayingEv = harvested[5];
    // The WIN: the five-fold applies to BOTH grades of the probed
    // both-grades yield seed (the in-arm non-vacuity guard first, the M8
    // rule: the unfolded expansion really is nonzero in base AND fine, so
    // the x5 below cannot be five times zero on either grade).
    const goldenExpansion = resolveFarmHarvest(FARM_GOLDEN_WIN_YIELD_SEED, 75);
    expect(goldenExpansion.count).toBeGreaterThan(0);
    expect(goldenExpansion.fine).toBeGreaterThan(0);
    expect(goldenEv).toEqual({
      type: 'farmHarvested',
      pid,
      bedId: 'bed_eastbrook_1',
      cropId: 'vale_wheat',
      itemId: 'vale_wheat',
      count: goldenExpansion.count * 5,
      fineItemId: 'fine_vale_wheat',
      fineCount: goldenExpansion.fine * 5,
      // THE GOLDEN BONUS (masterwrought Phase 11f), the one beat in the whole
      // parity suite that reaches it. The literal is the recorded truth of the
      // re-recorded golden, in the drawsAt style; the PROPERTY beside it is
      // what the arm is really about and does not depend on the seed.
      goldenBonusItemId: 'bog_beet_seed',
    });
    // The upward drift, asserted rather than left to the literal: a golden
    // harvest of a TIER-1 crop pays a seed of tier 2, or (far more rarely) a
    // farming pattern. Both sides derived from content, so a new tier-2 crop
    // or a seventh pattern widens the claim by existing.
    const bonusId = goldenEv.goldenBonusItemId as string;
    const driftSeeds = farmSeedIdsOfTier(farmGoldenBonusSeedTier(1));
    expect(driftSeeds, 'the tier-1 drift target must have seeds').not.toHaveLength(0);
    expect(
      driftSeeds.includes(bonusId) || FARM_GOLDEN_BONUS_PATTERN_IDS.includes(bonusId),
      `${bonusId} is neither a tier-2 seed nor a farming pattern`,
    ).toBe(true);
    // And it is REALLY in the bags, not merely announced.
    const bonusHeld = meta.inventory
      .filter((slot: any) => slot.itemId === bonusId)
      .reduce((n: number, slot: any) => n + (slot.count ?? 1), 0);
    expect(bonusHeld, `${bonusId} must be granted, not just named`).toBe(1);
    // The announce fanout: exactly ONE gatherRareEvent (one player in zone),
    // the crop source naming the base grant, and the finder's visit mark
    // written while the reliquary field-note stays the ledgered no-op.
    const rare = ev.filter((e) => e.type === 'gatherRareEvent');
    expect(rare).toHaveLength(1);
    expect(rare[0]).toEqual({
      type: 'gatherRareEvent',
      pid,
      flavor: 'golden_harvest',
      finderName: 'Adventurer',
      finderPid: pid,
      zoneId: 'eastbrook_vale',
      nodeType: 'crop',
      itemId: 'vale_wheat',
    });
    expect(meta.deedStats.visited.has('gather_event:golden_harvest')).toBe(true);
    // The Reliquary field note pages too since masterwrought Phase 18 (the
    // ledgered cell deferral retired), so this arm flipped with the content.
    expect(meta.reliquary.marks.has('gather_event:golden_harvest')).toBe(true);
    // THE PAYING BAND: seedBackCount PRESENT at exactly one (the one-seed
    // band, 0.08 <= 0.155753 < 0.4), the upgrade from the zero-band beat
    // above whose grant proof degraded to 0 === 0.
    expect(barleyPayingEv.bedId).toBe('bed_thornpeak_1');
    expect(barleyPayingEv.cropId).toBe('highland_barley');
    expect(barleyPayingEv.seedBackCount).toBe(1);

    // Bag consistency across BOTH tier-3 beats: the zero-band beat left no
    // seed and the paying beat's one seed-back is the only barley seed the
    // player holds (each beat's granted seed was consumed by its own plant).
    expect(countOf('highland_barley_seed')).toBe(seedBack + 1);
    expect(countOf(barleyEv.itemId)).toBe(
      (barleyEv.count as number) + (barleyPayingEv.count as number),
    );
    if (barleyEv.fineItemId !== undefined || barleyPayingEv.fineItemId !== undefined) {
      const fineTotal =
        ((barleyEv.fineCount as number | undefined) ?? 0) +
        ((barleyPayingEv.fineCount as number | undefined) ?? 0);
      expect(countOf('fine_highland_barley')).toBe(fineTotal);
    }

    // ONE LINE PER FARM GRANT (#2430), pinned where it is actually
    // observable. Every farm payout goes through the shared inventory hub,
    // whose "You receive: X" loot event must ride with { silent: true,
    // callerLogs: true } so the client's own farming line is the only one a
    // player sees. The drive's scaffolding grants keep the plain hub line,
    // which is the inverse arm proving the flags come from the farming grant
    // path and not from every loot event in the world. The partition is
    // exhaustive and EXACT: no event may carry half the pair, the unflagged
    // side is pinned to the eight scaffolding grants in drive order, and the
    // flagged side is counted by arithmetic over the farm events themselves
    // (one hub grant per base payout, per present fine pair, per present
    // seedBackCount, per husk trade).
    const loot = ev.filter((e) => e.type === 'loot');
    const flagged = loot.filter((l) => l.silent === true && l.callerLogs === true);
    const unflagged = loot.filter((l) => l.silent === undefined && l.callerLogs === undefined);
    expect(flagged.length + unflagged.length, 'no loot event may carry half the flag pair').toBe(
      loot.length,
    );
    const receiveLine = (itemId: string, count = 1): string =>
      `You receive: ${(ITEMS as any)[itemId].name}${count > 1 ? ' x' + count : ''}.`;
    expect(unflagged.map((l) => l.text)).toEqual([
      receiveLine('vale_wheat_seed', 2),
      receiveLine('garden_hoe'),
      receiveLine('vale_wheat_seed'),
      receiveLine('compost'),
      receiveLine('growth_tonic'),
      receiveLine('vale_wheat', 2),
      receiveLine('skysilver_hoe'),
      receiveLine('highland_barley_seed'),
      receiveLine('vale_wheat_seed'), // the Phase 8 ready-notice beat's seed
      // The Phase 11 (bw) extension's scaffolding, in drive order: one seed
      // per padding cycle, the golden-win beat's seed, the final padding
      // cycle's seed, then the paying tier-3 beat's barley seed. Composed from
      // the padding constant, so the Phase 11f re-probe moved it by
      // construction.
      ...Array.from({ length: FARM_GOLDEN_PADDING_CYCLES + 2 }, () =>
        receiveLine('vale_wheat_seed'),
      ),
      receiveLine('highland_barley_seed'),
      // The Phase 12 beat-P scaffolding, in drive order: the dish the
      // tick-phase mint eats, then the feast item the place verb spends.
      receiveLine('evergarden_braised_greens'),
      receiveLine('harvest_feast'),
    ]);
    const expectedFlagged =
      harvested.reduce(
        (n, e) =>
          n +
          1 +
          (e.fineItemId !== undefined ? 1 : 0) +
          (e.seedBackCount !== undefined ? 1 : 0) +
          // The Phase 11f golden bonus is its own hub grant, and it carries
          // the same flag pair: the farmHarvested line owns its feedback too.
          (e.goldenBonusItemId !== undefined ? 1 : 0),
        0,
      ) +
      withered.reduce((n, e) => n + 1 + (e.seedBackCount !== undefined ? 1 : 0), 0) +
      convertedEv.length;
    expect(flagged).toHaveLength(expectedFlagged);

    // The bags agree with every beat: the fee spent 2 of the 5 produce held
    // (3 banked + 2 scaffolding) before the toniced harvest re-paid, the
    // Phase 8 closing harvest banked its own expansion on top (harvested[3]
    // above, pinned there rather than restated here), the
    // husk batch became the compost back in the bag (1 granted - 1 paid + 1
    // converted), the tonic was consumed, and every seed pouch is empty
    // except the seed-back. Both eastbrook beds and the thornpeak bed are
    // free again (one visit takes the plot out on either outcome).
    // The Phase 11 terms: the golden win banks its five-fold base grade on
    // top (signed instances count like any stack member here), the fine
    // grade is the win's alone, and the padding withers re-fill the husk
    // pouch AFTER the convert beat (two per cycle, never converted again).
    // Derived from the EVENTS rather than restating their literals: the arm's
    // claim is that the two surfaces agree, and the first and closing harvest
    // counts are already pinned above, so repeating them here would only make
    // this line move whenever the stream re-seats a yield mint.
    expect(countOf('vale_wheat')).toBe(
      (harvested[0].count as number) +
        toniced.count +
        (harvested[3].count as number) +
        goldenExpansion.count * 5,
    );
    expect(countOf('fine_vale_wheat')).toBe(goldenExpansion.fine * 5);
    expect(countOf('withered_husks')).toBe(
      withered.slice(1).reduce((n, w) => n + (w.count as number), 0),
    );
    expect(countOf('vale_wheat_seed')).toBe(0);
    expect(countOf('compost')).toBe(1);
    expect(countOf('growth_tonic')).toBe(0);

    // THE PHASE 12 BEAT P, event and state truth. Exactly one
    // farmFeastPlaced (the placer's own confirmation; everyone else learns
    // by seeing the entity), and the post-drive world holds NO feast: the
    // draw-free expiry write plus ONE 1 Hz updateFarming sweep dropped the
    // entity and the FeastState together.
    const placedEv = ev.filter((e) => e.type === 'farmFeastPlaced');
    expect(placedEv).toHaveLength(1);
    expect(placedEv[0].pid).toBe(pid);
    const simAny = rec.sim as any;
    expect(simAny.feasts.size).toBe(0);
    expect(simAny.entities.get(placedEv[0].feastId)).toBeUndefined();
    // The bite refreshed the dish mint (last-eaten-wins on the ONE unified
    // 'well_fed' id, Masterwrought 11c): the drive ends Well Fed at the
    // tier-4 dish's ladder value 5, and both beat-P items left the bags
    // (the dish eaten, the feast spent at placement).
    const wellfedAura = (simAny.player.auras as any[]).find((a) => a.id === 'well_fed');
    expect(wellfedAura?.value).toBe(5);
    expect(countOf('evergarden_braised_greens')).toBe(0);
    expect(countOf('harvest_feast')).toBe(0);
    expect(meta.farmPlots.size).toBe(0);

    // The gathering-grant drain across the whole session: the first harvest
    // and the toniced one both grant at low proficiency and are drained before
    // the drive's proficiency write of 75, then the barley harvest's tier-3
    // gain at 75 (tier 3 teaches past 75) lands on the tail ticks. The
    // Phase 11 extension leaves the SAME final value by a different route:
    // its padding withers at the written skill-0 window queue nothing, the
    // win harvest at the written 75 grays on a tier-1 crop, and only the
    // paying barley harvest adds its gain on top of the final restore of 75.
    //
    // STRICT equality, and the gain is READ rather than restated. Both halves
    // are deliberate: reading it means a future re-tune moves this arm with the
    // schedule instead of reddening it, and strict equality is now available at
    // all because every gain is exactly representable (masterwrought 11e), so a
    // toBeCloseTo here would tolerate the very accumulation drift the re-tune
    // removed.
    expect(meta.gatheringProficiency.farming).toBe(75 + farmingHarvestGainAt(75, 3));
  });

  it('bank_round_trip: both banker-counter stores actually move (the re-mint guard)', () => {
    // The golden is what UPDATE_PARITY regenerates wholesale, so a silently
    // broken recipe (a moved banker failing the proximity gate, every vault op
    // refusing) would mint a no-op arm with nothing red. Pin the final state
    // both stores must reach; the numbers are the scenario's own arithmetic
    // (71000 - 20000 - 50000 = 1000 copper; 10 ore deposited 6 then 2 back,
    // then the step-12 sweep re-stocks the carried 6; the whole 4-stack of
    // logs; the bank ladder's first 500-copper rung; and the sweep takes the
    // 5 wolf_fang the bank arm returned to the bags, wolf_fang being a recipe
    // reagent the honest material set admits).
    const rec = run('bank_round_trip');
    const pid = rec.notes.pid as number;
    // biome-ignore lint/suspicious/noExplicitAny: the recorder exposes the raw Sim
    const meta = (rec.sim as any).players.get(pid);
    expect(meta.vault.upgrades).toBe(2);
    expect(meta.vault.stock).toEqual({ ashwood_log: 4, copper_ore: 10, wolf_fang: 5 });
    expect(meta.copper).toBe(1000);
    expect(meta.bank.purchasedSlots).toBe(6);
    // The bank's ITEM arm nets to zero in the counters above (5 wolf_fang in,
    // 5 back out), so pin it directly: the bank ends empty, and the fangs the
    // withdraw returned to the bags are the SAME five the step-12 sweep then
    // stocked (the vault literal above), or a silently no-op'd
    // deposit/withdraw pair could still mint a green golden.
    expect(meta.bank.inventory).toEqual([]);
    // The sweep's OWN no-op arms: the dagger added beside it survives in the
    // bags (gear is not a material), the starting bread stays (a consumable is
    // not a material), and no carried material remains at all. NOTE: this pin
    // does NOT discriminate the sweep's iteration direction (every eligible
    // slot is fully consumed here, so ascending and descending end alike);
    // the direction guard is the slot-identity assertion in
    // tests/materials_vault.test.ts ('fills each material only to its
    // headroom, descending by slot index').
    // biome-ignore lint/suspicious/noExplicitAny: raw Sim inventory slots
    const carried = meta.inventory.map((s: any) => [s.itemId, s.count]);
    expect(carried).toEqual([
      ['baked_bread', 5],
      ['rusty_dagger', 1],
    ]);
  });

  it('bank_materials_satchel: a socketed satchel splits the pools, one gate answers twice', () => {
    // The re-mint guard for the ONE scenario in this suite that carries a
    // materials-only bag. Every other scenario runs with empty sockets, where
    // general = 16 / materials = 0 and the pool math is arithmetically the old
    // flat scalar, so a silently broken recipe here (the equip refusing, both
    // withdrawals refusing, both succeeding) would mint a golden that still
    // proves nothing about the two-pool mechanic and nothing would be red.
    //
    // The two discriminating instants are the SAME withdrawal of the SAME bank
    // slot, answered differently: refused while the general pool is full, then
    // allowed once materials-first packing parks the carried materials in the
    // materials pool. Everything below is the scenario's own arithmetic against
    // absolute literals, never a value read back out of bag_pools.ts.
    const scenario = SCENARIOS.find((s) => s.name === 'bank_materials_satchel');
    expect(scenario, 'no bank_materials_satchel scenario').toBeTruthy();
    const { trace, rec } = record(scenario!);
    const pid = rec.notes.pid as number;
    // biome-ignore lint/suspicious/noExplicitAny: the recorder exposes the raw Sim
    const meta = (rec.sim as any).players.get(pid);

    // The socket took, through the real equipBag path: without it there is no
    // materials pool at all and every assertion below degenerates.
    expect(meta.bags).toEqual(['foragers_haversack', null, null, null]);

    // biome-ignore lint/suspicious/noExplicitAny: sampled frames are plain JSON
    const at = (label: string): any => {
      const frame = trace.frames.find((f) => f.label === label);
      expect(frame, `missing the ${label} checkpoint frame`).toBeTruthy();
      return frame?.players?.[0];
    };
    // biome-ignore lint/suspicious/noExplicitAny: sampled inventory slots
    const rows = (sample: any): [string, number][] =>
      // biome-ignore lint/suspicious/noExplicitAny: sampled inventory slots
      (sample.inventory ?? []).map((s: any) => [s.itemId, s.count]);

    // The two setup instants checkpoint 1 stands on, pinned directly rather than
    // inferred from the refusal: the general pool really is packed to its 16-slot
    // budget before the material crosses back, and that withdrawal really did land
    // the whole 20-unit stack in satchel-only headroom (a partial move or a split
    // stack would still leave the bank empty and the refusal intact).
    expect(at('general-pool-full').inventory).toHaveLength(16);
    const withdrawn = at('material-withdrawn-into-satchel-headroom');
    expect(rows(withdrawn)).toContainEqual(['copper_ore', 20]);

    // Checkpoint 1, the flat-scalar discriminator. The general pool is full at
    // 16 non-material slots (5 loaves in one, 15 daggers in fifteen) and the
    // material withdrawal already landed in satchel headroom for a 17th slot.
    // 17 carried against a summed budget of 28 (16 base + 12 satchel) leaves 11
    // slots of FLAT headroom, so a flat scalar moves the dagger here. It must
    // still be in the bank.
    const refused = at('non-material-refused-with-flat-headroom');
    expect(refused.inventory).toHaveLength(17);
    expect(rows(refused).filter(([id]) => id === 'rusty_dagger')).toHaveLength(15);
    expect(refused.bank.inventory).toEqual([{ itemId: 'rusty_dagger', count: 1 }]);
    // Exactly one pool-honest refusal in the whole run: the step-5 withdrawal.
    // A second one would mean an arm meant to succeed did not.
    const ev = rec.allEvents as Ev[];
    const onlyMaterials = ev.filter(
      (e) => e.type === 'error' && e.text === 'Only materials fit in the space left in your bags.',
    );
    expect(onlyMaterials).toHaveLength(1);

    // Checkpoint 2, the allocation-order discriminator. 3 non-material slots
    // and 13 material slots is 16 carried, exactly the general budget, so a
    // general-first packing leaves zero general headroom and refuses again.
    // Materials-first puts 12 material slots in the materials pool and spills
    // one, so the general pool holds 4 of 16 and the same withdrawal now moves.
    const overfilled = at('materials-pool-overfilled');
    expect(overfilled.inventory).toHaveLength(16);
    expect(rows(overfilled).filter(([id]) => id === 'copper_ore')).toHaveLength(13);
    expect(rows(overfilled).filter(([id]) => id !== 'copper_ore')).toEqual([
      ['baked_bread', 5],
      ['rusty_dagger', 1],
      ['rusty_dagger', 1],
    ]);
    // The bank emptied, so the retry moved the very slot the refusal left.
    expect(meta.bank.inventory).toEqual([]);
    // biome-ignore lint/suspicious/noExplicitAny: raw Sim inventory slots
    const carried = meta.inventory.map((s: any) => [s.itemId, s.count]);
    expect(carried).toHaveLength(17);
    expect(carried.filter(([id]: [string, number]) => id === 'rusty_dagger')).toHaveLength(3);
    expect(carried.filter(([id]: [string, number]) => id === 'copper_ore')).toEqual(
      Array.from({ length: 13 }, () => ['copper_ore', 20]),
    );

    // Draw-free end to end, and that is the whole trace, not just these
    // checkpoints: equipBag, both deposits, all three withdrawals, the discard
    // and the grants are pure slot arithmetic, the bank is the same, and the
    // two-tick world tail draws nothing either, so the trace draws NOTHING
    // anywhere. The loop's one tooth: a pool change that starts drawing rng
    // moves a checkpoint off zero and goes red.
    for (const label of [
      'satchel-socketed',
      'deposited-material-and-gear',
      'general-pool-full',
      'material-withdrawn-into-satchel-headroom',
      'non-material-refused-with-flat-headroom',
      'materials-pool-overfilled',
      'gear-withdrawn-after-materials-first-packing',
    ]) {
      const frame = trace.frames.find((f) => f.label === label);
      expect(frame?.rng.draws, `${label} drew rng`).toBe(0);
    }
    // The whole-trace totals once, so no draw can hide between the checkpoints
    // or in the tail: zero draws, and the digest still sitting at the untouched
    // FNV-1a offset basis with nothing folded into it.
    expect(trace.draws).toBe(0);
    expect(trace.drawDigest).toBe('811c9dc5');
  });

  it('rift_boss_floor: stretched S fuse spawns, detonates, and boss death clears the pending zone', () => {
    const rec = run('rift_boss_floor');
    const ev = rec.allEvents as Ev[];
    const n = rec.notes as Record<string, unknown>;
    // The driver fired twice: the driven fuse plus the pre-death zone.
    const spawns = ev.filter((e) => e.type === 'riftDeathZoneSpawn');
    expect(spawns.length).toBeGreaterThanOrEqual(2);
    // The first fuse carries the S tempo (0.7) times the capped 50%-slow
    // stretch (2x) over Venom Pool's authored castTime: both arms really ran.
    expect((spawns[0] as { durationSecs?: number }).durationSecs).toBeCloseTo(
      MOBS.rift_boss_venom.deathZoneCast!.castTime * RIFT_S_ZONE_TEMPO * RIFT_IMPAIRED_FUSE_CAP,
      5,
    );
    // The fuse ran out: the detonation telegraph line fired.
    expect(
      ev.some(
        (e) => e.type === 'log' && typeof e.text === 'string' && e.text.includes('Venom Pool'),
      ),
    ).toBe(true);
    // Boss death cancelled the pending zone and told online mirrors.
    expect(ev.some((e) => e.type === 'riftDeathZoneClear')).toBe(true);
    // The escape window was genuinely open while the guard fought, and the
    // guard's web never landed inside it (riftControlSuppressed fired).
    expect(n.windowOpenDuringGuardFight).toBe(true);
    expect(n.playerRootedInWindow).toBe(false);
  });

  it('idle_mob_distance_culling: advances the near mob, freezes the far mob, and keeps passive rolls off the shared stream', () => {
    const scenario = SCENARIOS.find((item) => item.name === 'idle_mob_distance_culling');
    expect(scenario, 'missing the idle-mob culling parity scenario').toBeTruthy();
    if (!scenario) return;

    const { trace, rec } = record(scenario);
    expect(rec.sim.cfg.idleMobTickRadius).toBe(100);
    const near = rec.sim.entities.get(rec.notes.nearMobId as number);
    const far = rec.sim.entities.get(rec.notes.farMobId as number);
    expect(near, 'near boundary probe disappeared').toBeTruthy();
    expect(far, 'far boundary probe disappeared').toBeTruthy();
    if (!near || !far) return;
    expect(Math.hypot(near.pos.x - near.spawnPos.x, near.pos.z - near.spawnPos.z)).toBeGreaterThan(
      0.1,
    );
    expect({ x: far.pos.x, z: far.pos.z }).toEqual({ x: far.spawnPos.x, z: far.spawnPos.z });
    expect(trace.draws).toBe(0);
  });

  it('grix_respawn_window: both deaths roll an independent 15 to 30 minute timer', () => {
    const rec = run('grix_respawn_window');
    const first = rec.notes.firstRoll as number;
    const second = rec.notes.secondRoll as number;
    for (const roll of [first, second]) {
      // rng.range(36, 72) x 25s: uniform in the half-open [900, 1800).
      expect(roll).toBeGreaterThanOrEqual(900);
      expect(roll).toBeLessThan(1800);
    }
    // Independent draws: equal rolls would mean the death site stopped
    // consuming the stream per death (this seed pair does not collide).
    expect(first).not.toBe(second);
    // The in-place respawn between the kills really happened, so the second
    // roll came from a genuine second death of the same entity id.
    expect(rec.notes.respawned).toBe(true);
    const deaths = (rec.allEvents as Ev[]).filter((e) => e.type === 'death');
    expect(deaths.length).toBeGreaterThanOrEqual(2);
  });

  it('rift_clear_rewards: the winning A clear really pays the corpse ladder, pattern draw included', () => {
    const rec = run('rift_clear_rewards');
    const inst = rec.sim.riftInstances.find((i) => i.partyKey !== null);
    expect(inst, 'the rift instance disappeared before the clear').toBeTruthy();
    // completeRiftClear ran through the real sweep: won, rewarded, egress open.
    expect(inst?.outcome).toBe('won');
    expect(inst?.rewarded).toBe(true);
    expect(inst?.exitId).not.toBeNull();
    const boss = rec.sim.entities.get(rec.notes.bossId as number);
    expect(boss, 'the tracked boss corpse disappeared before the payout').toBeTruthy();
    const items = (boss?.loot?.items ?? []).map((entry) => entry.itemId);
    // Draw 2 (the guaranteed heroic epic) plus draw 6 (the pattern) both landed:
    // the seed is chosen so the 8% pattern roll SUCCEEDS in-window, so the golden
    // pins the rng.int pick over the sorted RIFT_PATTERN_ITEM_IDS too, and this
    // proves the recorded window really contains the whole payout, not a truncated
    // run that never reached completeRiftClear.
    const patterns = items.filter((id) =>
      (RIFT_PATTERN_ITEM_IDS as readonly string[]).includes(id),
    );
    expect(patterns.length).toBe(1);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(boss?.lootable).toBe(true);
    // The A-rank clear-time coin bonus landed on top of the static boss coin.
    expect(boss?.loot?.copper ?? 0).toBeGreaterThanOrEqual(RIFT_COIN_BONUS_A);
  });

  // The three sibling ranks (masterwrought Phase 11f). addRiftClearGearLoot's
  // ladder is rank-gated, so one rank exercises only its own arms: before these
  // three, draws 0, 1, 3 and 4 ran in no golden at all. Phase 11f appends a new
  // draw after draw 6 on the same winning path, so the ladder is pinned at every
  // rank FIRST and the append lands in a stream these goldens cover.
  //
  // Each arm asserts what its rank's arm REACHES, not merely that a clear paid:
  // an assertion that passes at every rank would not tell the four apart, which
  // is the whole point of recording them separately.
  it('rift_clear_rewards_c: the C arm pays draw 0 and RETURNS before every other draw', () => {
    const rec = run('rift_clear_rewards_c');
    const inst = rec.sim.riftInstances.find((i) => i.partyKey !== null);
    expect(inst?.outcome).toBe('won');
    expect(inst?.rewarded).toBe(true);
    const boss = rec.sim.entities.get(rec.notes.bossId as number);
    const items = (boss?.loot?.items ?? []).map((entry) => entry.itemId);
    // Draw 0 landed: exactly one guaranteed pick from the normal-clear pool.
    const normalPool = new Set(riftNormalClearPool());
    expect(items.filter((id) => normalPool.has(id)).length).toBe(1);
    // The EARLY RETURN is the pin: no pattern (draw 6) and no mount (draw 5)
    // can appear at C, whatever the seed, because the arm exits after draw 0.
    // This is the decisive half; a C run that shed either would mean the
    // early-out stopped exiting.
    expect(items.filter((id) => (RIFT_PATTERN_ITEM_IDS as readonly string[]).includes(id))).toEqual(
      [],
    );
    expect(items.filter((id) => id.startsWith('reins_'))).toEqual([]);
    expect(items.length).toBe(1);
    expect(boss?.loot?.copper ?? 0).toBeGreaterThanOrEqual(RIFT_COIN_BONUS_C);
    expect(boss?.lootable).toBe(true);
  });

  it('rift_clear_rewards_b: the B arm pays draws 1, 5 and 6, and the pattern lands in-window', () => {
    const rec = run('rift_clear_rewards_b');
    const inst = rec.sim.riftInstances.find((i) => i.partyKey !== null);
    expect(inst?.outcome).toBe('won');
    const boss = rec.sim.entities.get(rec.notes.bossId as number);
    const items = (boss?.loot?.items ?? []).map((entry) => entry.itemId);
    // Draw 1: RIFT_EPIC_CHANCE_B is 1.0, so B always sheds its heroic epic.
    // Draw 6: the seed was hunted so the 8% roll SUCCEEDS, which is what makes
    // this golden pin the rng.int pick over the sorted id list rather than a miss.
    const patterns = items.filter((id) =>
      (RIFT_PATTERN_ITEM_IDS as readonly string[]).includes(id),
    );
    expect(patterns.length).toBe(1);
    expect(items.length).toBeGreaterThanOrEqual(2);
    // B is NOT S: no legendary roll (draws 3 and 4) is reachable on this arm.
    expect(items.filter((id) => id.startsWith('reins_')).length).toBeLessThanOrEqual(1);
    expect(boss?.loot?.copper ?? 0).toBeGreaterThanOrEqual(RIFT_COIN_BONUS_B);
    expect(boss?.lootable).toBe(true);
  });

  it('rift_clear_rewards_s: the S arm reaches the legendary rolls and the pattern draw', () => {
    const rec = run('rift_clear_rewards_s');
    const inst = rec.sim.riftInstances.find((i) => i.partyKey !== null);
    expect(inst?.outcome).toBe('won');
    const boss = rec.sim.entities.get(rec.notes.bossId as number);
    const items = (boss?.loot?.items ?? []).map((entry) => entry.itemId);
    const patterns = items.filter((id) =>
      (RIFT_PATTERN_ITEM_IDS as readonly string[]).includes(id),
    );
    expect(patterns.length).toBe(1);
    // The S coin bonus is the arm's own discriminator: it is the only rank
    // paying RIFT_COIN_BONUS_S, so this fails if the scenario silently drifted
    // to another rank (a baseLevel typo would otherwise still look like a clear).
    expect(boss?.loot?.copper ?? 0).toBeGreaterThanOrEqual(RIFT_COIN_BONUS_S);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(boss?.lootable).toBe(true);
  });

  // The four rows tile the ladder between them rather than repeating one arm:
  // stated as a test so a future edit that points two scenarios at the same
  // baseLevel (the cheapest way to silently lose a rank) reds here.
  it('the four rift reward scenarios cover four DISTINCT ranks', () => {
    const names = [
      'rift_clear_rewards_c',
      'rift_clear_rewards_b',
      'rift_clear_rewards',
      'rift_clear_rewards_s',
    ];
    const bonuses = new Set<number>();
    for (const name of names) {
      const rec = run(name);
      const boss = rec.sim.entities.get(rec.notes.bossId as number);
      bonuses.add(boss?.loot?.copper ?? 0);
    }
    // C and B share a coin bonus literal (both 10 000c), so the copper alone
    // cannot separate all four; the C arm's item shape above is what tells
    // those two apart. Three distinct totals is the honest claim here.
    expect(bonuses.size).toBeGreaterThanOrEqual(3);
    expect(SCENARIOS.filter((s) => s.name.startsWith('rift_clear_rewards')).length).toBe(4);
  });

  it('supported_elevation_line_of_sight: heals across the stall jump and denies airborne cover sight', () => {
    const rec = run('supported_elevation_line_of_sight');
    const events = rec.allEvents as Ev[];
    const healerId = rec.notes.healerId as number;
    const allyId = rec.notes.allyId as number;

    const starts = events.filter(
      (event) =>
        event.type === 'castStart' &&
        event.entityId === healerId &&
        event.ability === 'lesser_heal',
    );
    expect(starts).toHaveLength(2);
    const heals = events.filter(
      (event) =>
        event.type === 'heal2' &&
        event.sourceId === healerId &&
        event.targetId === allyId &&
        event.ability === 'Whispered Prayer',
    );
    expect(heals).toHaveLength(2);
    const lineOfSightErrors = events.filter(
      (event) => event.type === 'error' && event.text === 'Line of sight.',
    );
    expect(lineOfSightErrors).toHaveLength(1);
  });

  it('perfecting_walk: denials draw nothing, every resolved attempt draws once, the bagged apex stamps Perfected and the worn one binds in place', () => {
    const { trace, rec } = record(SCENARIOS.find((s) => s.name === 'perfecting_walk')!);
    const ev = rec.allEvents as Ev[];
    const pid = rec.notes.pid as number;
    const meta = (rec.sim as any).players.get(pid);
    const errors = ev
      .filter((e) => e.type === 'error' && e.pid === pid)
      .map((e) => e.text as string);
    const logs = ev.filter((e) => e.type === 'log' && e.pid === pid).map((e) => e.text as string);

    // The SIX deny arms the drive stages, each answered by its DEDICATED
    // line and nothing else on the error channel, in drive order. The
    // post-stamp denial changed lines at phase 13: a nameless perfect_item on
    // a Perfected copy now routes to the promotion ladder, whose first
    // answer here is the missing-name refusal (the perfectAlready line is
    // retired from the sim). The last three joined at masterwrought Phase 18,
    // which moved the ladder's remaining arms onto this scenario; the
    // lock-only line is the one that matters most here, because a regression
    // that dropped its split would answer the GENUINE shortfall line instead
    // and this equality is what says which one landed.
    expect(errors).toEqual([
      'Perfecting that requires 125 skill in the craft that made it.',
      'That work needs a name to become a legend.',
      'You lack the materials to perfect that item.',
      "You don't have that item.",
      'Only Masterwrought items can be perfected.',
      'A material needed for perfecting is locked.',
    ]);

    // One bind per piece (the R2 stamp fires on the FIRST resolved attempt
    // only), one done line (the neck alone can complete), and the neck's
    // advances are the whole rank track in order; the ring's advances (zero
    // to two) are whatever it rolled.
    const binds = logs.filter((t) => /^Perfecting begins: .+ is now bound to you\.$/.test(t));
    expect(binds).toEqual([
      'Perfecting begins: Wyrmfall Pendant is now bound to you.',
      'Perfecting begins: Warhewn Signet is now bound to you.',
    ]);
    expect(logs.filter((t) => /^.+ is now Perfected!$/.test(t))).toEqual([
      'Wyrmfall Pendant is now Perfected!',
    ]);
    // The rank track is spelled from the module's constant on BOTH sides (the
    // emit interpolates the same import), so pin the constant here too or the
    // arm would follow a retuned rank count without noticing.
    expect(PERFECTING_RANKS).toBe(4);
    const advances = logs.filter((t) => /^Perfecting: .+ advances to rank \d+ of \d+\.$/.test(t));
    expect(advances.filter((t) => t.startsWith('Perfecting: Wyrmfall Pendant'))).toEqual(
      Array.from(
        { length: PERFECTING_RANKS },
        (_, i) => `Perfecting: Wyrmfall Pendant advances to rank ${i + 1} of ${PERFECTING_RANKS}.`,
      ),
    );
    const fails = logs.filter(
      (t) => t === 'The perfecting attempt fails; the materials are spent.',
    );
    // The fail-forward arm must really have fired on the pinned seed (a walk
    // with no failure at all has about a one-in-four chance): otherwise the
    // coverage string above would sit in the golden asserting an arm the
    // recording never reached (the professions_craft "proc missed for the
    // pinned seed" doctrine).
    expect(fails.length, 'the fail-forward arm fired on the pinned seed').toBeGreaterThan(0);

    // THE DRAW LEDGER, the point of this scenario: cumulative from drive
    // start, spelled as arithmetic over the contract's own terms. Zero at the
    // staged frame and the skill denial (nothing before them draws either:
    // the level jump and the grants are draw-free), one per resolved attempt
    // across the bagged walk, unchanged across the post-stamp denial, exactly
    // two more for the worn attempts, unchanged across the ember strip and
    // the materials denial, and NOTHING else.
    const frameAt = (label: string) => {
      const frame = trace.frames.find((f) => f.label === label);
      if (!frame) throw new Error(`missing the ${label} checkpoint frame`);
      return frame;
    };
    const drawsAt = (label: string): number => frameAt(label).rng.draws;
    const stateAt = (label: string): string => frameAt(label).state;
    const baggedAttempts = rec.notes.baggedAttempts as number;
    // (The drive's own loop bound already caps this from above; the completed
    // stamp below is what proves the walk finished inside it.)
    expect(baggedAttempts).toBeGreaterThanOrEqual(PERFECTING_RANKS);
    const WORN_ATTEMPTS = 2;
    expect(drawsAt('perfect-staged')).toBe(0);
    expect(drawsAt('perfect-denied-skill')).toBe(0);
    expect(drawsAt('perfect-bagged-walked')).toBe(baggedAttempts);
    expect(drawsAt('perfect-denied-perfected')).toBe(baggedAttempts);
    expect(drawsAt('perfect-worn-attempted')).toBe(baggedAttempts + WORN_ATTEMPTS);
    expect(drawsAt('perfect-embers-stripped')).toBe(baggedAttempts + WORN_ATTEMPTS);
    expect(drawsAt('perfect-denied-materials')).toBe(baggedAttempts + WORN_ATTEMPTS);
    // The three Phase 18 arms draw nothing either, so the ledger is flat from
    // the materials denial to the end of the drive.
    expect(drawsAt('perfect-staged-noitem')).toBe(baggedAttempts + WORN_ATTEMPTS);
    expect(drawsAt('perfect-denied-noitem')).toBe(baggedAttempts + WORN_ATTEMPTS);
    expect(drawsAt('perfect-denied-notapex')).toBe(baggedAttempts + WORN_ATTEMPTS);
    expect(drawsAt('perfect-materials-locked')).toBe(baggedAttempts + WORN_ATTEMPTS);
    expect(drawsAt('perfect-denied-locked')).toBe(baggedAttempts + WORN_ATTEMPTS);
    expect(trace.draws).toBe(baggedAttempts + WORN_ATTEMPTS);
    // ...and every draw is accounted for by exactly one notice: an advance or
    // a fail, never both, never neither.
    expect(advances.length + fails.length).toBe(trace.draws);

    // Every staged denial is a NO-OP on the sampled state, not merely
    // draw-free: the frame after each denial digests byte-identical to the
    // frame before it (bags, payloads, skills, equipment all unmoved), so a
    // denial that spent a material or touched the copy reds here even though
    // the end-of-run totals below would still reconcile. (wireRev is a
    // sampler exclusion, so a spurious wire bump on a deny arm is the one
    // mutation this pin cannot see.)
    expect(stateAt('perfect-denied-skill')).toBe(stateAt('perfect-staged'));
    expect(stateAt('perfect-denied-perfected')).toBe(stateAt('perfect-bagged-walked'));
    expect(stateAt('perfect-denied-materials')).toBe(stateAt('perfect-embers-stripped'));
    // The Phase 18 arms take the same bracket. The not-apex arm is bracketed
    // by the noItem denial's own frame rather than a staged one, which is
    // sound precisely because that denial is itself proven a no-op on the
    // line above: two consecutive no-ops leave one unmoved digest across all
    // three frames, so a not-apex arm that consumed a material still reds.
    expect(stateAt('perfect-denied-noitem')).toBe(stateAt('perfect-staged-noitem'));
    expect(stateAt('perfect-denied-notapex')).toBe(stateAt('perfect-denied-noitem'));
    expect(stateAt('perfect-denied-locked')).toBe(stateAt('perfect-materials-locked'));
    // The lock-only arm's PREMISE, so it cannot go vacuous by decaying into
    // the genuine shortfall it is supposed to be distinguished from: the
    // locking really happened (cells were locked), and the raw counts still
    // meet the whole bill at the moment of the denial.
    expect(rec.notes.lockedCells as number).toBeGreaterThanOrEqual(PERFECTING_ATTEMPT_COST.length);
    for (const c of PERFECTING_ATTEMPT_COST) {
      expect(countRawInSlots(meta.inventory, c.itemId), `raw ${c.itemId}`).toBeGreaterThanOrEqual(
        c.count,
      );
      expect(countUnlockedInSlots(meta.inventory, c.itemId), `unlocked ${c.itemId}`).toBeLessThan(
        c.count,
      );
    }

    // The bagged copy at rest: bound to the perfecter, the track field gone,
    // the stamp on, the R5 delta merged (an int 8 / sta 6 neck with a +1
    // delta: largest-remainder puts the point on int).
    const neck = meta.inventory.find((s: any) => s.itemId === 'wyrmfall_pendant');
    expect(neck?.instance).toEqual({
      boundTo: meta.entityId,
      perfected: true,
      rolled: { stats: { int: 1 } },
    });
    // The worn copy: seated on ring1 by the resolver, bound by its first
    // attempt, mid-track (two attempts can never stamp), never stat-baked.
    expect(meta.equipment.ring1).toBe('warhewn_signet');
    const ring = meta.equipmentInstance.ring1;
    expect(ring?.boundTo).toBe(meta.entityId);
    expect(ring?.perfected).toBeUndefined();
    expect(ring?.rolled).toBeUndefined();
    const ringAdvances = advances.filter((t) => t.startsWith('Perfecting: Warhewn Signet')).length;
    expect(ringAdvances).toBeLessThanOrEqual(WORN_ATTEMPTS);
    expect(ring?.perfecting).toBe(ringAdvances === 0 ? undefined : ringAdvances);

    // The bill: one of EACH material per resolved attempt, and no denial ever
    // spent one. The ember (the pacing lever) is billed from the count the
    // drive stashed just before stripping the stack to stage the last denial;
    // the other two are read off the live bags.
    // Billed PER COST-TABLE ENTRY (c.count, not an assumed 1), so a retuned
    // per-attempt count reds here for the right reason, and a NEW material
    // joining the table fails loudly until the readings map names it.
    const haveById: Record<string, number> = {
      sundered_essence: (rec.sim as any).countItem('sundered_essence', pid),
      prismglass_setting: (rec.sim as any).countItem('prismglass_setting', pid),
      makers_ember: rec.notes.emberBeforeStrip as number,
    };
    const remainingAttempts = PERFECTING_WALK_ATTEMPT_CAP + WORN_ATTEMPTS - trace.draws;
    expect(Object.keys(haveById).sort()).toEqual(
      PERFECTING_ATTEMPT_COST.map((c) => c.itemId).sort(),
    );
    for (const c of PERFECTING_ATTEMPT_COST) {
      expect(haveById[c.itemId], c.itemId).toBe(c.count * remainingAttempts);
    }

    // The stamp reaches the GOLDEN, not just the live sim: the final frame's
    // player sample carries the perfected copy and the bound worn copy
    // (inventory and equipmentInstance are sampled, never excluded), so a
    // sampler exclusion or a payload-shape change would move the golden
    // rather than hide behind it.
    const final = trace.frames[trace.frames.length - 1];
    expect(final.label).toBe('final');
    const sampled = (final.players as any[])[0];
    const sampledNeck = sampled.inventory.find((s: any) => s.itemId === 'wyrmfall_pendant');
    expect(sampledNeck?.instance?.perfected).toBe(true);
    expect(sampledNeck?.instance?.perfecting).toBeUndefined();
    expect(sampled.equipmentInstance?.ring1?.boundTo).toBe(meta.entityId);
  });
  it('ignivar_raid_tuning: pins live Heroic rays, final Brands, and wipe cooldown recovery', () => {
    const rec = run('ignivar_raid_tuning');
    const notes = rec.notes as Record<string, unknown>;
    const events = rec.allEvents as Ev[];

    expect(notes.rayHpAfterHit).toBe(500);
    expect(notes.rayHpAfterAdjacentTick).toBe(500);
    expect(notes.brandedPlayerIds as number[]).toHaveLength(3);
    expect(notes.attemptParticipantIds as number[]).toHaveLength(4);
    expect(notes.longCooldownReset).toBe(true);
    expect(notes.encounterReset).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'damage' && event.ability === 'Revolving Inferno' && event.amount === 500,
      ),
    ).toBe(true);
  });

  it('varkhul_raid_tuning: excludes visitors, pins Heroic Forgestorm, and scopes wipe recovery', () => {
    const rec = run('varkhul_raid_tuning');
    const notes = rec.notes as Record<string, unknown>;

    expect(notes.prePullParticipantIds).toEqual([]);
    expect(notes.pullParticipantIds as number[]).toHaveLength(1);
    expect(notes.forgestormHpAfterImpact).toBe(200);
    expect(notes.forgestormDamageSeen).toBe(true);
    expect(notes.visitorCooldownRetained).toBe(true);
    expect(notes.raiderCooldownReset).toBe(true);
    expect(notes.encounterReset).toBe(true);
  });

  it('world_quest_lifecycle: pins all states, reward families, counters, and zero RNG', () => {
    const scenario = SCENARIOS.find((item) => item.name === 'world_quest_lifecycle');
    expect(scenario).toBeDefined();
    if (!scenario) return;
    const { trace, rec } = record(scenario);
    const events = rec.allEvents as Ev[];
    // Five starts: the 2026-09-01 step opens a new daily cycle, which restarts
    // the confection board (WORLD_QUEST_ROTATION_DAYS is 1 since the zone
    // minimum levels playtest round).
    expect(events.filter((event) => event.type === 'worldQuestStarted')).toHaveLength(5);
    expect(events.filter((event) => event.type === 'worldQuestDone')).toHaveLength(3);
    expect(events.some((event) => event.type === 'worldQuestProgress')).toBe(true);
    expect(
      events.filter(
        (event) =>
          event.type === 'aura' &&
          event.abilityId === rec.notes.freightAuraId &&
          event.gained === true,
      ),
    ).toHaveLength(6);
    expect(
      events.filter(
        (event) =>
          event.type === 'aura' &&
          event.abilityId === rec.notes.freightAuraId &&
          event.gained === false,
      ),
    ).toHaveLength(6);
    expect(rec.notes.xpReward).toBe(2_784);
    // The shared copper schedule (content/world_quests.ts WORLD_QUEST_COPPER):
    // 700 + 120 * 20 at the cap, paid on every quest beside the XP.
    expect(rec.notes.copperReward).toBe(3_100);
    expect(rec.notes.itemReward).toBe(1);
    expect(rec.notes.questProgress).toBe(22);
    expect(rec.notes.questsCompleted).toBe(3);
    expect(rec.notes.sameCycleAfterOneDay).toBe(false);
    expect(rec.notes.rotationChanged).toBe(true);
    // Day 3's Thornpeak slot since the round-2 zone hunts widened the pool.
    expect(rec.notes.rotatedQuestIds).toEqual(['wq_thornpeak_zealots']);
    expect(trace.draws).toBe(0);
    expect(trace.drawDigest).toBe('811c9dc5');
  });

  it('heroic_five_man_clear: one shared claim, one equipment drop, marks and the lockout to every participant', () => {
    const rec = run('heroic_five_man_clear');
    const sim = rec.sim as any;
    const partyPids = rec.notes.partyPids as number[];
    const boss = sim.entities.get(rec.notes.bossId as number);

    // ONE claim, shared: all five walked the door and joined the same
    // instance, which is the premise the marks arm below is measured against
    // (a party left outside would record a one-player payout).
    expect(partyPids).toHaveLength(5);
    expect(rec.notes.instanceMembers).toEqual([...partyPids].sort((a, b) => a - b));
    const heroicClaims = sim.instances.filter(
      (i: any) => i.dungeonId === HEROIC_FIVE_MAN_DUNGEON_ID && i.difficulty === 'heroic',
    );
    expect(heroicClaims).toHaveLength(1);

    // The kill really resolved and really rolled loot.
    expect(boss.dead).toBe(true);
    const droppedIds = ((boss.loot?.items ?? []) as any[]).map((s) => s.itemId);
    expect(droppedIds.length).toBeGreaterThan(0);

    // The combined Heroic partition replaces the base equipment rolls.
    // Exactly one item must come from that slot; recipes/bags/mounts are extra.
    const gear = droppedIds.filter((id) =>
      ['armor', 'weapon', 'held_offhand'].includes(ITEMS[id]?.kind),
    );
    expect(gear).toHaveLength(1);
    const heroicGearIds = new Set(
      HEROIC_BOSS_LOOT[HEROIC_FIVE_MAN_BOSS_ID]
        .filter((entry) => entry.rollGroup === 'korzul_heroic')
        .map((entry) => entry.itemId),
    );
    expect(heroicGearIds.has(gear[0])).toBe(true);

    // ARM 3, awardHeroicMarks on a FIVE-MAN: the tuning's marksPerParticipant
    // to EVERY participant (the raid pays 3, so the number itself says which
    // table answered), plus the per-difficulty daily lockout and NOT the plain
    // normal key.
    const tuning = HEROIC_DUNGEON_TUNING[HEROIC_FIVE_MAN_DUNGEON_ID];
    expect(tuning.marksPerParticipant).toBe(1);
    for (const pid of partyPids) {
      expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid), `marks pid ${pid}`).toBe(
        tuning.marksPerParticipant,
      );
      const lockouts = sim.players.get(pid).raidLockouts;
      expect(lockouts.has(`${HEROIC_FIVE_MAN_DUNGEON_ID}:heroic`), `lock pid ${pid}`).toBe(true);
      expect(lockouts.has(HEROIC_FIVE_MAN_DUNGEON_ID), `plain key pid ${pid}`).toBe(false);
    }
    // Marks are paid into the bags, never onto the corpse.
    expect(droppedIds).not.toContain(HEROIC_MARK_ITEM_ID);
  });

  it('flask_consumables: one flask ever rides, upward replaces, downward refuses, and the whole path draws nothing', () => {
    const { trace, rec } = record(SCENARIOS.find((s) => s.name === 'flask_consumables')!);
    const sim = rec.sim as any;
    const pid = rec.notes.pid as number;
    const p = sim.entities.get(pid);
    const ev = rec.allEvents as Ev[];

    // The whole use path is draw-free, which is worth a golden on its own: a
    // consumable that STARTS drawing shifts every later draw in its host.
    expect(trace.draws).toBe(0);

    const frameAt = (label: string) => {
      const frame = trace.frames.find((f) => f.label === label);
      if (!frame) throw new Error(`missing the ${label} checkpoint frame`);
      return frame;
    };
    const stateAt = (label: string): string => frameAt(label).state;

    // BEAT 3, the downward refusal, is the one that can regress silently, so
    // it is pinned as a state NO-OP between its bracketing frames (bags and
    // auras alike unmoved) and by its own refusal line.
    expect(stateAt('flask-downgrade-refused')).toBe(stateAt('flask-upgraded'));
    const errors = ev.filter((e) => e.type === 'error' && e.pid === pid).map((e) => e.text);
    expect(errors).toEqual(['A more powerful effect is already active.']);
    // The refused unit was NOT consumed. Two went in and beat 1 spent one, so
    // one remains: a refusal that quietly drank would leave zero. (The digest
    // equality above is the decisive half, since the bags are sampled; this
    // spells the arithmetic so the count is readable on its own.)
    expect(sim.countItem('elixir_of_the_serpent', pid)).toBe(1);

    // BEATS 1, 2 and 4 really moved the aura set, so the no-op above is a
    // refusal rather than a path that does nothing at all. Each of the three
    // quaffs that landed spent exactly one unit.
    expect(stateAt('flask-elixir-up')).not.toBe(stateAt('flasks-staged'));
    expect(stateAt('flask-upgraded')).not.toBe(stateAt('flask-elixir-up'));
    expect(stateAt('flask-family-swapped')).not.toBe(stateAt('flask-downgrade-refused'));
    expect(sim.countItem('ironhusk_flask', pid)).toBe(1);
    expect(sim.countItem('warboar_flask', pid)).toBe(1);

    // THE ONE-FLASK RULE at rest: exactly one flask-MARKED aura rides, and it
    // is the last family quaffed. Keyed on the marker, never the aura id or
    // the item kind, which is what the sim keys on.
    const flaskAuras = (p.auras as any[]).filter((a) => a.flask === true);
    expect(flaskAuras).toHaveLength(1);
    expect(flaskAuras[0].kind).toBe('buff_ap');
    // ...and the stamina family it replaced is gone entirely, so the strip
    // shed the aura rather than leaving a stale second one behind.
    expect((p.auras as any[]).filter((a) => a.kind === 'buff_sta')).toEqual([]);
  });
  it('freehold_claim: two characters of one account share the owner claim, leave, and the empty claim reaps', () => {
    const scenario = SCENARIOS.find((s) => s.name === 'freehold_claim');
    if (!scenario) throw new Error('no scenario freehold_claim');
    const { rec, trace } = record(scenario);
    const inn = DUNGEONS[FREEHOLD_INN_ROOM_DUNGEON_ID];
    // The default record was seeded at addPlayer under the shared stamp.
    expect(rec.notes.record).toBe('inn_room');
    // ONE claim for both characters: the second enter rejoined the first's slot.
    expect(rec.notes.claimed).toBe(1);
    expect(typeof rec.notes.slotA).toBe('number');
    expect(rec.notes.slotA).toBe(rec.notes.slotB);
    // Both entered and both left through the real door: the def's lines, twice each.
    // inn.enterText / inn.leaveText are the def's own literals, pinned verbatim in
    // tests/freehold_dungeon_defs.test.ts, so these compare against the real lines.
    const logs = rec.allEvents.filter((ev) => ev.type === 'log');
    expect(logs.filter((ev) => ev.text === inn.enterText)).toHaveLength(2);
    expect(logs.filter((ev) => ev.text === inn.leaveText)).toHaveLength(2);
    expect(rec.allEvents.filter((ev) => ev.type === 'freeholdDenied')).toEqual([]);
    // The reap at the boundary: no Inn Room slot stays claimed and the tracked
    // exit entity is gone from the world.
    const sim = rec.sim;
    expect(
      sim.instances.filter(
        (i) => i.dungeonId === FREEHOLD_INN_ROOM_DUNGEON_ID && i.partyKey !== null,
      ),
    ).toEqual([]);
    // The claim frame draws no rng: an owner claim spawns nothing (spawns: []),
    // and the one tick that follows it on the slim world draws nothing either.
    const frame = (label: string) => {
      const found = trace.frames.find((fr) => fr.label === label);
      if (!found) throw new Error(`no frame ${label}`);
      return found;
    };
    const exitOf = (list: readonly { templateId?: unknown; dungeonId?: unknown }[]) =>
      list.some((e) => e.templateId === 'dungeon_exit' && e.dungeonId === inn.id);
    expect(exitOf(entities(rec))).toBe(false);
    // The positive control for that absence: the same predicate finds the
    // claim's exit entity in the checkpoint frame taken while the room was
    // claimed, so a renamed field could not turn the absence vacuous.
    expect(
      exitOf((frame('entered').entities ?? []) as { templateId?: unknown; dungeonId?: unknown }[]),
    ).toBe(true);
    expect(frame('entered').rng.draws - frame('seeded').rng.draws).toBe(0);
    expect(frame('shared').rng.draws - frame('entered').rng.draws).toBe(0);
  });
  it('freehold_hearth_key: the remote entry admits, the cooldown refuses, and the last leave drops the clock', () => {
    const scenario = SCENARIOS.find((s) => s.name === 'freehold_hearth_key');
    if (!scenario) throw new Error('no scenario freehold_hearth_key');
    const { rec, trace } = record(scenario);
    const inn = DUNGEONS[FREEHOLD_INN_ROOM_DUNGEON_ID];
    const frame = (label: string) => {
      const found = trace.frames.find((fr) => fr.label === label);
      if (!found) throw new Error(`no frame ${label}`);
      return found;
    };
    // Outdoors before the use, inside an Inn Room slot after it: the default
    // admission let the remote entry through, and the key is permanent.
    expect(rec.notes.slotOutdoors).toBeNull();
    expect(typeof rec.notes.slotInside).toBe('number');
    expect(rec.notes.keysAfterUse).toBe(1);
    // The clock the use wrote: the sim-time lockout clock plus one hour exactly.
    // The literal hour, never the production constant: the golden cannot see
    // the clock (notes are not serialized), so this is its only size pin.
    expect(rec.notes.clockAfterUse).toBe((rec.notes.useNowMs as number) + 3_600_000);
    // One entry and one leave through the real door lines.
    const logs = rec.allEvents.filter((ev) => ev.type === 'log');
    expect(logs.filter((ev) => ev.text === inn.enterText)).toHaveLength(1);
    expect(logs.filter((ev) => ev.text === inn.leaveText)).toHaveLength(1);
    expect(rec.notes.slotAfterLeave).toBeNull();
    // The second use is the one refusal, on the local clock, and it moved
    // nothing: no travel, no clock write, no state, no draw.
    expect(
      rec.allEvents.filter((ev) => ev.type === 'freeholdDenied').map((ev) => ev.reason),
    ).toEqual(['cooldown']);
    expect(rec.notes.slotAfterDenial).toBeNull();
    expect(rec.notes.clockAfterDenial).toBe(rec.notes.clockAfterUse);
    expect(frame('denied').state).toBe(frame('left').state);
    expect(frame('denied').rng).toEqual(frame('left').rng);
    // The remote entry itself draws nothing (spawns: [] and no roll on the key).
    expect(frame('entered').rng).toEqual(frame('keyed').rng);
    // The owner's last session out drops BOTH the live clock (the 07a eviction)
    // and the record, and the leave draws nothing.
    expect(rec.notes.clocksBeforeRelease).toBe(1);
    expect(rec.notes.recordsBeforeRelease).toBe(1);
    expect(rec.notes.clocksAfterRelease).toBe(0);
    expect(rec.notes.recordsAfterRelease).toBe(0);
    expect(frame('released').players).toEqual([]);
    expect(frame('released').rng).toEqual(frame('before_release').rng);
  });

  it('bop_party_trade_eligibility: a leaving drop-mate stays on the awarded copy', () => {
    const rec = run('bop_party_trade_eligibility');
    expect(rec.notes.eligibleCharacterIds).toEqual([101, 102]);
    const alice = [...rec.sim.ctx.players.values()].find((meta) => meta.name === 'AliceParity');
    const awarded = alice?.inventory.find((slot) => slot.itemId === 'sigil_anvil_helmet');
    expect(awarded?.instance?.partyTrade?.eligibleIds).toEqual([101, 102]);
  });
}
