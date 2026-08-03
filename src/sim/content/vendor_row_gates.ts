// ---------------------------------------------------------------------------
// Proficiency gates on individual NPC vendor rows
// ---------------------------------------------------------------------------
//
// A side table keyed by item id, plus one pure resolver, in the shape of the
// Delve Marks shop gate (content/delves/shop.ts): the table says which stocked
// rows carry a requirement, the resolver answers "does this row's requirement
// hold for this player" and hands back the requirement itself so a surface can
// SAY it. The vendor window's pure view core (ui/hud/vendor/vendor_view.ts)
// reads it to render the advisory line; the values come from the wield table
// (professions/wield_gate.ts), so the line a counter shows can never disagree
// with the number the harvest gate enforces.
//
// ADVISORY, not enforcement (R22, docs/design/professions-tuning-packet-review.md):
// every counter sells ahead freely, the way Wilkes always sold the whole rod
// ladder (R20), and so do the market, trade, mail, and buyback. What is gated
// is the WIELD: the harvest gate refuses to put an unearned tool to work
// (professions/wield_gate.ts, read by gathering.ts harvestNode and the grade
// resolution), which closes every transfer route at the moment of use instead
// of at the counter. Owners are never stripped: a tool bought or received
// early sits in the bags and wields the moment its owner reaches the
// threshold. A row with an unmet requirement therefore still SELLS; it just
// says what the tool will ask of its owner, exactly like the requirement
// line on the tool's own tooltip.
//
// The buy path (items.ts buyItem) deliberately does NOT read this table any
// more: the authoritative purchase deny this file used to drive was retired
// when the wield gate landed, and tests/professions_tool_gate.test.ts pins
// the open counter and the wield-time refusal as a pair.
//
// DOM-free, rng-free and host-agnostic (src/sim purity, tests/architecture.test.ts).

import {
  TIER2_TOOL_WIELD_PROFICIENCY,
  TIER3_TOOL_WIELD_PROFICIENCY,
} from '../professions/wield_gate';
import type { GatheringProfessionId } from './professions';

// The displayed thresholds ARE the wield thresholds: one table
// (professions/wield_gate.ts) owns the numbers, and these aliases keep the
// advisory surface reading the same values the harvest gate enforces. The
// reachability of every threshold against the live gain curve is derived and
// pinned in tests/professions_tool_gate.test.ts.

/** Advisory display value: the tier-2 land tool's wield requirement (R22). */
export const TIER2_TOOL_GATE_PROFICIENCY = TIER2_TOOL_WIELD_PROFICIENCY;

/** Advisory display value: the tier-3 land tool's wield requirement (R22). */
export const TIER3_TOOL_GATE_PROFICIENCY = TIER3_TOOL_WIELD_PROFICIENCY;

/** One row's requirement: proficiency in a named gathering profession. */
export interface VendorRowGate {
  /** Which gathering counter is read. Always the tool's own profession. */
  professionId: GatheringProfessionId;
  /** The proficiency at or above which the row opens. */
  proficiency: number;
}

// The gated rows, by item id. Only the tier-2 and tier-3 LAND tools appear:
//
// - Tier 1 is ungated on purpose. It is the entry implement the gather quests
//   grant through requiredItems, and the #2343 rule makes it mandatory for any
//   harvest at all, so gating it would gate gathering itself.
// - Tier 4 and 5 are crafted, carry no buyValue and sit in no vendorItems row
//   (content/items.ts), so there is no vendor row to gate.
// - The tiered fishing RODS are deliberately absent: rods are R22-exempt
//   (the zone water gate plus the fishing teaching ceiling are that
//   profession's pacing, and its counter runs to 200 rather than 100, so the
//   numbers here would not mean the same thing on that ladder). The absence
//   is asserted, not assumed: tests/professions_tool_gate.test.ts pins that
//   no fishing implement carries a gate and that every priced land tool
//   above tier 1 does, so a new tool cannot ship unadvertised by omission.
// Frozen like its packet siblings (FISHING_ZONE_ROD_TIERS): the Readonly type
// stops a TS caller, not a JS one, and both worlds resolve the advisory line
// through this one object, so a runtime mutation would desync the line a
// counter shows from the number the harvest gate enforces. The rows are
// frozen too: a gate is two numbers, and half-mutable is worse than either.
export const VENDOR_ROW_GATES: Readonly<Record<string, VendorRowGate>> = Object.freeze({
  iron_mining_pick: Object.freeze({
    professionId: 'mining',
    proficiency: TIER2_TOOL_GATE_PROFICIENCY,
  }),
  mithril_mining_pick: Object.freeze({
    professionId: 'mining',
    proficiency: TIER3_TOOL_GATE_PROFICIENCY,
  }),
  felling_axe: Object.freeze({
    professionId: 'logging',
    proficiency: TIER2_TOOL_GATE_PROFICIENCY,
  }),
  ironbark_axe: Object.freeze({
    professionId: 'logging',
    proficiency: TIER3_TOOL_GATE_PROFICIENCY,
  }),
  bronze_sickle: Object.freeze({
    professionId: 'herbalism',
    proficiency: TIER2_TOOL_GATE_PROFICIENCY,
  }),
  silverleaf_sickle: Object.freeze({
    professionId: 'herbalism',
    proficiency: TIER3_TOOL_GATE_PROFICIENCY,
  }),
});

/** A vendor row resolved against one player's gathering proficiency: whether it
 *  is open, and, when it is not, the requirement to name. `requirement` is
 *  present on a gated row whether or not it is met, so a surface can show the
 *  threshold on an open row too if it ever wants to. */
export interface VendorRowGateState {
  /** True only when the row carries a gate the viewer has not met yet. */
  locked: boolean;
  /** The row's requirement, absent entirely on an ungated row. */
  requirement?: VendorRowGate;
}

/**
 * The one gate resolver. Its single caller is the vendor window's advisory
 * requirement sub-line (ui/hud/vendor/vendor_view.ts); the wiki table shares
 * the CONSTANTS this file reads (the tier gate proficiencies), not the
 * resolver. Per this file's header and R22, the buy path deliberately no
 * longer reads it (the purchase is advisory, enforcement moved to wield
 * time). `proficiency` is the player's gathering
 * counter map (`PlayerMeta.gatheringProficiency` in the sim, the mirrored
 * `IWorld.gatheringProficiency` in the client): an untracked or missing
 * profession reads 0, which locks every gated row rather than opening it.
 */
export function resolveVendorRowGate(
  itemId: string,
  proficiency: Readonly<Record<string, number>>,
): VendorRowGateState {
  // hasOwn, not a bare lookup: the table is an object literal, so `constructor`
  // and friends would otherwise resolve to a truthy non-gate. Unreachable from
  // either live call site today, but a custom world document can put arbitrary
  // strings into an NPC's vendorItems (sim/map_doc.ts), and this resolver is
  // exported and driven directly by tests. The mirrored delve gate is
  // array-find based, so matching its shape does not cover this.
  if (!Object.hasOwn(VENDOR_ROW_GATES, itemId)) return { locked: false };
  const requirement = VENDOR_ROW_GATES[itemId];
  // Coerced, never taken on trust. The sim's own map is sanitized on load
  // (normalizeGatheringProficiency admits only finite numbers), but the ONLINE
  // client assigns the mirrored map straight off the wire with no shape check,
  // and a non-finite value would sail through a bare `<` comparison: NaN < 40
  // is false, which would OPEN a gated row. Absent and malformed must both
  // read 0 and lock, which is what the contract above promises.
  const raw = proficiency[requirement.professionId];
  const held = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  return { locked: held < requirement.proficiency, requirement };
}
