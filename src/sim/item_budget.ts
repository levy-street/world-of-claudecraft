// Pure item-level budget primitives: the quality/slot weightings and the two
// functions that turn (level, quality, slot) into an exact primary-stat budget and
// redistribute a stat line onto it. A LEAF module with no ./data import, so both
// item_level.ts (the source-index-aware readouts) and content/heroic_variants.ts
// (which runs at data-eval time, before item_level finishes initializing) can share
// this math without an import cycle. item_level.ts re-exports these for back-compat.
import type { CoreStats, ItemDef, ItemSlot } from './types';
import { SPELL_COEFF_DIVISOR } from './types';

// The five primary attributes an item can carry (armor is handled separately: it
// is an armor-class/slot property, not part of the comparable stat budget).
export const PRIMARY_STATS = ['str', 'agi', 'sta', 'int', 'spi'] as const;
export type PrimaryStat = (typeof PRIMARY_STATS)[number];

// A rarer item "punches above" the level of the content that drops it. Grounded in
// the classic convention that a blue from a level-N pull outclasses a green from
// the same pull; the exact bumps are tuned to this game's level-20 cap.
export const QUALITY_ILVL_BONUS: Record<string, number> = {
  poor: 0,
  common: 0,
  uncommon: 1,
  rare: 3,
  epic: 6,
  legendary: 10,
};

// Share of a level's stat budget that each quality grants. Whites/greys carry no
// primary stats (armor only), greens roughly half, blues most, purples the full
// ladder, mirroring the existing hand-authored content (uncommon mid pieces ~2-4
// pts, class-neutral rares ~5-7 pts; cf. the items.ts budget comment). Legendaries
// are a steep jump (the two in the game are flagship BiS artifacts that should dwarf
// epics), tuned so a capstone legendary weapon lands around its existing power.
export const QUALITY_STAT_MULT: Record<string, number> = {
  poor: 0,
  common: 0,
  uncommon: 0.55,
  rare: 0.8,
  epic: 1.0,
  legendary: 1.9,
};

// Slot weight for the stat budget: chest and main-hand carry the most, the smaller
// slots less. Matches the slot weighting already described for armor in items.ts
// (head ~1.0, shoulder ~0.75, gloves ~0.65, waist ~0.55) applied to stat points.
export const SLOT_STAT_MULT: Record<ItemSlot, number> = {
  mainhand: 1.0,
  offhand: 0.75,
  chest: 1.0,
  legs: 0.9,
  helmet: 0.85,
  shoulder: 0.75,
  waist: 0.7,
  gloves: 0.7,
  feet: 0.65,
  // Jewelry: small slots with no armor contribution. Items declare 'ring'
  // (never a concrete ring1/ring2 key); the concrete keys carry the same
  // weight so budget math is stable whichever form a caller passes.
  neck: 0.65,
  ring: 0.6,
  ring1: 0.6,
  ring2: 0.6,
};

// Primary-stat points granted per item level at full (rare-mult x chest-mult = 1).
export const STAT_PER_ILVL = 0.7;

// v0.27.1 re-budget: a two-handed weapon differentiates on weapon DPS (see
// TWOHAND_DPS_MULT below), never on stats. It carries a modest premium over the
// one-handed mainhand line and MUST stay strictly below the combined mainhand +
// offhand slot weights (1.0 + 0.75), so every dual-wield or weapon-and-shield
// setup out-stats a two-hander of the same item level (tests/twohand_rebudget
// pins this). The old value of 2 (both hands' budgets) assumed the offhand slot
// was sacrificed; Titan's Grip broke that assumption by filling both slots with
// two-handers. Consumers apply this only when an ItemDef is a weapon with hand
// 'twohand', rounding the product so budgets stay integral.
export const TWOHAND_STAT_MULT = 1.3;

// The weapon-DPS premium a two-hander carries over the one-hand budget line: the
// damage side of the stat tradeoff above (big slow swings, thinner stat sheet).
// Codifies the previously informal "Eastbrook/Highwatch greatsword rule" (the top
// of the 10-to-15% band) that the zone3 epics were authored against, so items,
// heroic variants, and tests all share one number.
export const TWOHAND_DPS_MULT = 1.15;

// The slot weight for an offhand that is WORN rather than held (occupiesHand
// false: today the hunter quivers). It replaces SLOT_STAT_MULT.offhand for those
// items, and is lower for the same reason TWOHAND_STAT_MULT dropped from 2 to
// 1.3: both numbers price a slot against what taking it costs you. A held
// offhand is priced at 0.75 because wearing one SACRIFICES the two-hander. A worn
// offhand sacrifices nothing (displacedSlotForEquip lets it coexist), so pricing
// it at 0.75 would hand its class the two-hander's 1.3 AND the offhand's 0.75 for
// 2.05, above the 1.75 ceiling the comment above guarantees. At 0.45 the pair
// sums to exactly 1.75, so a two-hander-plus-quiver hunter lands level with every
// dual-wield or weapon-and-shield setup of the same item level instead of ahead
// of it. tests/twohand_rebudget.test.ts pins the ceiling.
export const WORN_OFFHAND_STAT_MULT = 0.45;

// The source level the "Heroic X" upgraded drop variants read as: one heroic tier
// above the level-20 dungeons, so epics land at item level 28 (22 + the epic bump
// of 6) and rares at 25 (22 + 3). content/heroic_variants.ts scales each variant's
// stats to the matching budget; item_level.buildSourceIndex registers every
// `heroicOf` item at this source level.
export const HEROIC_VARIANT_SOURCE_LEVEL = 22;

// Base weapon DPS a weapon of this item level should deal. Weapon damage tracks item
// level (quality drives the STAT budget instead, see primaryStatBudget). A gentle
// linear curve FIT to the authored weapon ladder, not invented: the ilvl-20 rares sit
// near 11 to 11.5, the ilvl-26 dungeon epics near 14 to 15, and this puts ilvl-31 at
// 16.0, above the item-level-26 epics and below the hand-authored legendaries (item
// level 33 at 17+). Slope 0.3/ilvl keeps it under that legendary ceiling at the cap.
// Two-handers ride TWOHAND_DPS_MULT above this line (their side of the stat tradeoff),
// which puts a top-tier 2H above the one-hand legendary ceiling on raw weapon dps.
export function weaponDpsBudget(level: number): number {
  return 6.7 + 0.3 * level;
}

// Rescale a weapon's min/max damage to hit `dps` at its existing swing speed, keeping
// the low-to-high spread proportional. Returns rounded integers; the realized dps lands
// within rounding of the target. Used to level a heroic upgrade's weapon damage to its
// item level (content/heroic_variants.ts) and to author the heroic set weapons on-curve.
export function scaleWeaponDamage(
  weapon: { min: number; max: number; speed: number },
  dps: number,
): { min: number; max: number } {
  const curAvg = (weapon.min + weapon.max) / 2;
  if (curAvg <= 0) return { min: weapon.min, max: weapon.max };
  const k = (dps * weapon.speed) / curAvg;
  return {
    min: Math.max(1, Math.round(weapon.min * k)),
    max: Math.max(1, Math.round(weapon.max * k)),
  };
}

// The total primary-stat points an item of this level + quality + slot should grant.
// `slotMultOverride` replaces the SLOT_STAT_MULT lookup for an item whose slot
// weight is not decided by the slot alone; slotStatMultForItem below is the only
// thing that produces one.
export function primaryStatBudget(
  level: number,
  quality: ItemDef['quality'],
  slot: ItemSlot | undefined,
  slotMultOverride?: number,
): number {
  if (!slot) return 0;
  const q = QUALITY_STAT_MULT[quality ?? 'common'] ?? 0;
  const s = slotMultOverride ?? SLOT_STAT_MULT[slot] ?? 0.7;
  return Math.max(0, Math.round(level * q * s * STAT_PER_ILVL));
}

// The slot weight an item rides when its own def, not just its slot, decides the
// price: a WORN offhand takes the lighter worn line because it costs no two-hander
// (see WORN_OFFHAND_STAT_MULT). Returns undefined when the plain slot weight
// applies, which is every other item. Both budget call sites (expectedStatBudget
// for the live item, makeHeroicVariant for a generated upgrade) route through this
// so a quiver can never be priced two different ways.
export function slotStatMultForItem(item: ItemDef): number | undefined {
  return item.kind === 'held_offhand' && item.occupiesHand === false
    ? WORN_OFFHAND_STAT_MULT
    : undefined;
}

// Redistribute `budget` primary-stat points across whichever attributes the item
// already uses, keeping their ratio (its stat identity) and the integer sum EXACTLY
// equal to `budget`. armor is passed through untouched. Largest-remainder rounding
// makes it deterministic (ties broken by PRIMARY_STATS order). Note: under a very
// lopsided ratio with a tiny budget a minor attribute can still round to 0; the
// authored tiers use balanced ratios where every attribute survives.
export function normalizePrimaryStats(
  stats: Partial<CoreStats>,
  budget: number,
): Partial<CoreStats> {
  const out: Partial<CoreStats> = {};
  if (stats.armor !== undefined) out.armor = stats.armor;
  const present = PRIMARY_STATS.filter((k) => (stats[k] ?? 0) > 0);
  const total = present.reduce((a, k) => a + (stats[k] ?? 0), 0);
  if (present.length === 0 || total === 0 || budget <= 0) return out;
  const parts = present.map((k) => {
    const exact = (budget * (stats[k] ?? 0)) / total;
    const base = Math.floor(exact);
    return { k, base, frac: exact - base };
  });
  let assigned = parts.reduce((a, p) => a + p.base, 0);
  // Hand out the leftover points to the largest fractional parts first; the stable
  // PRIMARY_STATS order keeps ties deterministic across runs and hosts.
  const order = [...parts].sort((a, b) => b.frac - a.frac);
  for (let i = 0; assigned < budget; i++, assigned++) order[i % order.length].base += 1;
  for (const p of parts) out[p.k] = p.base;
  return out;
}

// --- The throughput lane (the TBC lesson, adopted 2026-08-30) -----------------
// Every archetype gets ONE throughput lane per kit on top of the primary-stat
// budget. Melee draw it as weapon dps (weaponDpsBudget x TWOHAND_DPS_MULT, the
// lane this file has always priced); casters draw the SAME lane as flat Spell
// Power (1 SP = 1/SPELL_COEFF_DIVISOR dps when chain-casting, so lane dps
// converts at x3.5), healers as Healing Power at half Spell Power's price
// (never adds damage; the classic-era 0.455-vs-0.855 ratio). Spell Power and
// Healing Power are therefore PRICED, never free: the kit-wide totals below
// are the whole caster/healer allowance for a tier, and
// tests/ignivar_affix_lane.test.ts pins the shipped kits to them exactly.
// The caster multiplier prices the uptime tax (melee white damage flows while
// positioning; casters pay full price for every idle GCD; measured 32-64%
// realized uptime in the sim-vs-reality decomposition): it is the ONE
// caster-vs-melee itemization dial. Raising it is a maintainer decision.
export const CASTER_LANE_MULT = 1.25;
export const HEAL_POWER_PRICE_OF_SP = 0.5;

/** Kit-wide flat Spell Power a caster tier at `level` may carry (floored). */
export function casterLaneSpTotal(level: number): number {
  return Math.floor(
    weaponDpsBudget(level) * TWOHAND_DPS_MULT * SPELL_COEFF_DIVISOR * CASTER_LANE_MULT,
  );
}

/** Kit-wide flat Healing Power a healer tier at `level` may carry. */
export function healerLaneHpTotal(level: number): number {
  return Math.floor(casterLaneSpTotal(level) / HEAL_POWER_PRICE_OF_SP);
}

// ---------------------------------------------------------------------------
// The stamina baseline model (2026-09). Every budgeted item carries a FREE
// stamina line of STAMINA_BASELINE_SHARE of its primary-stat budget, so a caster
// and a physical piece from the same place give the same health, and the budget
// itself is spent on offense and resource: Strength/Agility for a physical
// identity, Intellect/Spirit for a caster one.
//
// The two identities meet the budget differently because of how the catalog was
// authored. A physical item's stamina was always INSIDE its budget (a 25-point
// chest reads 17 Strength / 8 Stamina), so its offense line is the budget minus
// the baseline and the baseline is the stamina it already carried. A caster
// item's third stat was Spirit, the resource stat (17 Intellect / 8 Spirit), so
// its line is the whole budget and the baseline is added on top. Stamina ABOVE
// the baseline (tank pieces, shields, bear staves) is bought from the line at
// STAMINA_PREMIUM points per point; today that is one for one, and the constant
// exists so pricing tank stamina differently is a one-number decision.
//
// tests/item_stamina_baseline.test.ts is the repo-wide guard: every eligible item
// meets its floor, and every item not on the drift allowlist sits exactly on its
// line. docs/design/gear-stamina-baseline-2026-09-10.md has the measurements.
export const STAMINA_BASELINE_SHARE = 1 / 3;
export const STAMINA_PREMIUM = 1;

export type StatIdentity = 'caster' | 'physical';

// The free stamina an item of this budget carries. Rounded, so a 2-point budget
// carries 1 and a 4-point budget carries 1; the effective share settles inside
// 29 to 40 percent from budget 5 upward. Zero-budget items (whites) carry none.
export function staminaBaseline(budget: number): number {
  return budget > 0 ? Math.round(budget * STAMINA_BASELINE_SHARE) : 0;
}

// Which line an item spends its budget on. A piece carrying Intellect or Spirit
// and NO Strength or Agility is a caster piece. Everything else is priced on the
// physical line: pure physical pieces, stamina-only and stat-less items, and the
// rare all-stat hybrid (Heart of the Rift), whose stamina was authored inside its
// budget like a physical piece and whose line is all four offense stats.
export function statIdentity(stats: Partial<CoreStats> | undefined): StatIdentity {
  const casterStats = (stats?.int ?? 0) > 0 || (stats?.spi ?? 0) > 0;
  const physicalStats = (stats?.str ?? 0) > 0 || (stats?.agi ?? 0) > 0;
  return casterStats && !physicalStats ? 'caster' : 'physical';
}

// The primary-stat total (all five attributes) an item of this budget and
// identity is expected to carry: physical pieces already hold their baseline
// inside the budget, caster pieces carry it on top.
export function expectedStatTotal(budget: number, identity: StatIdentity): number {
  return identity === 'caster' ? budget + staminaBaseline(budget) : budget;
}

export interface StaminaModelCheck {
  identity: StatIdentity;
  budget: number;
  baseline: number;
  sta: number;
  /** Stamina above the baseline, charged to the line at STAMINA_PREMIUM. */
  extra: number;
  /** The realized offense/resource line (str+agi or int+spi). */
  line: number;
  expectedLine: number;
  total: number;
  expectedTotal: number;
  meetsFloor: boolean;
  onLine: boolean;
}

// Where an item stands against the model, for the guard test and tooling.
export function checkStaminaModel(
  stats: Partial<CoreStats> | undefined,
  budget: number,
): StaminaModelCheck {
  const s = stats ?? {};
  const identity = statIdentity(s);
  const baseline = staminaBaseline(budget);
  const sta = s.sta ?? 0;
  const extra = Math.max(0, sta - baseline);
  const line =
    identity === 'caster'
      ? (s.int ?? 0) + (s.spi ?? 0)
      : (s.str ?? 0) + (s.agi ?? 0) + (s.int ?? 0) + (s.spi ?? 0);
  const lineBudget = identity === 'caster' ? budget : budget - baseline;
  const expectedLine = Math.max(0, lineBudget - STAMINA_PREMIUM * extra);
  let total = 0;
  for (const k of PRIMARY_STATS) total += s[k] ?? 0;
  return {
    identity,
    budget,
    baseline,
    sta,
    extra,
    line,
    expectedLine,
    total,
    expectedTotal: expectedStatTotal(budget, identity),
    meetsFloor: sta >= baseline,
    onLine: line === expectedLine,
  };
}

function pickStats(stats: Partial<CoreStats>, keys: readonly PrimaryStat[]): Partial<CoreStats> {
  const out: Partial<CoreStats> = {};
  for (const k of keys) if ((stats[k] ?? 0) > 0) out[k] = stats[k];
  return out;
}

// Model-aware normalization for GENERATED items (heroic variants, crucible
// collection pieces, rift bands): scale a stat profile onto `budget` so the result
// meets its stamina floor and sits exactly on its line, keeping the profile's
// offense identity. A physical profile keeps any stamina above the baseline (a
// tank profile stays a tank profile, paying for it from the line); a caster
// profile gets the baseline placed and its Intellect/Spirit ratio scaled onto the
// line. Armor passes through untouched, like normalizePrimaryStats.
export function normalizeToStaminaModel(
  stats: Partial<CoreStats>,
  budget: number,
): Partial<CoreStats> {
  const armor = stats.armor !== undefined ? { armor: stats.armor } : {};
  if (budget <= 0) return { ...armor };
  const identity = statIdentity(stats);
  const baseline = staminaBaseline(budget);
  if (identity === 'physical') {
    // Ratio-preserving over all five keeps a tank piece's stamina share; only a
    // profile under the floor is lifted to it and its offense fitted to the line.
    const scaled = normalizePrimaryStats(stats, budget);
    if ((scaled.sta ?? 0) >= baseline) return scaled;
    const offense = normalizePrimaryStats(
      pickStats(stats, ['str', 'agi', 'int', 'spi']),
      budget - baseline,
    );
    return { ...armor, ...offense, sta: baseline };
  }
  // Caster: the line is Intellect/Spirit on the whole budget; stamina is the
  // baseline plus whatever the profile carries above its share, charged to the line.
  const provisional = normalizePrimaryStats(stats, expectedStatTotal(budget, identity));
  const extra = Math.max(0, (provisional.sta ?? 0) - baseline);
  const lineStats = normalizePrimaryStats(
    pickStats(stats, ['int', 'spi']),
    Math.max(0, budget - STAMINA_PREMIUM * extra),
  );
  return { ...armor, ...lineStats, sta: baseline + extra };
}

// The bonus record a tier bump adds ON TOP of an item's own stats (masterwork,
// Perfecting): the line delta redistributed over the profile's offense identity,
// plus, for a caster identity, the growth of the free baseline between the two
// lines. A physical profile keeps the historical behavior exactly (its stamina
// is inside the line, so the ratio-preserving delta already carries it). Null
// when the bump adds nothing.
export function tierDeltaStats(
  profile: Partial<CoreStats>,
  lineBefore: number,
  lineAfter: number,
): Partial<CoreStats> | null {
  const delta = lineAfter - lineBefore;
  if (delta <= 0) return null;
  if (statIdentity(profile) === 'physical') {
    const out = normalizePrimaryStats(profile, delta);
    // Double rounding can leave the bumped piece under the floor of its new
    // line (a 16-to-17 bump over 11/5 rounds to str 1, sta 0 against a floor of
    // 6): move what the floor needs from the offense share of the delta. Only
    // for a base that meets its own floor; a stamina-free profile (a probe
    // fixture, a drift item) keeps the plain ratio delta rather than spending
    // the bump on a floor the base never had.
    const onModel = (profile.sta ?? 0) >= staminaBaseline(lineBefore);
    let need = onModel ? staminaBaseline(lineAfter) - ((profile.sta ?? 0) + (out.sta ?? 0)) : 0;
    for (const k of ['str', 'agi', 'int', 'spi'] as const) {
      if (need <= 0) break;
      const take = Math.min(out[k] ?? 0, need);
      if (take > 0) {
        out[k] = (out[k] ?? 0) - take;
        out.sta = (out.sta ?? 0) + take;
        need -= take;
      }
    }
    return out;
  }
  const out = normalizePrimaryStats(pickStats(profile, ['int', 'spi']), delta);
  const staDelta = staminaBaseline(lineAfter) - staminaBaseline(lineBefore);
  if (staDelta > 0) out.sta = staDelta;
  return out;
}

// The line budget an item's stat line realizes: the five-stat total for a
// physical identity (stamina sits inside it); for a caster identity the offense
// line plus the premium on stamina above the baseline of that budget. The
// baseline depends on the budget, so it is solved by iteration; the iterate
// settles in a step or two for any real item, and on the rare input where it
// alternates (a one-point line with one stamina: 1, 2, 1, 2) the larger value
// wins, which is the direction that never prices a piece under what it carries.
export function realizedLineBudget(stats: Partial<CoreStats>): number {
  let total = 0;
  for (const k of PRIMARY_STATS) total += stats[k] ?? 0;
  if (statIdentity(stats) === 'physical') return total;
  const line = (stats.int ?? 0) + (stats.spi ?? 0);
  const sta = stats.sta ?? 0;
  const seen = new Set<number>();
  let budget = line;
  let best = line;
  for (let i = 0; i < 16; i++) {
    if (seen.has(budget)) break;
    seen.add(budget);
    best = Math.max(best, budget);
    const next = line + STAMINA_PREMIUM * Math.max(0, sta - staminaBaseline(budget));
    if (next === budget) return budget;
    budget = next;
  }
  return best;
}
