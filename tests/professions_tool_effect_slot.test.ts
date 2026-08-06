// The tool-effect slot, end to end: the command that installs one, the read
// surface both worlds serve, and the persistence round trip.
//
// The claim under everything here is that a player who has never slotted an
// effect is byte-identical to one from before the field existed. PlayerMeta
// keeps `toolEffectSlots` ABSENT rather than an empty object, because an empty
// object still serializes into the parity state digest and initialising it
// moved every golden in the suite for a feature no scenario uses. Several arms
// below assert absence specifically, not emptiness.
import { describe, expect, it } from 'vitest';
import {
  GATHERING_PROFESSION_IDS,
  TOOL_EFFECT_IDS,
  TOOL_EFFECTS,
} from '../src/sim/content/professions';
import { MAX_ECHOED_WIRE_ID_LENGTH } from '../src/sim/professions/tool_effect_actions';
import {
  MAX_CRAFTED_BY_LENGTH,
  normalizeToolEffectSlots,
  RARITY_DURABILITY_BONUS,
  slotToolEffectRefused,
  startingDurabilityFor,
} from '../src/sim/professions/tools';
import { type CharacterState, type PlayerMeta, Sim } from '../src/sim/sim';
import { hasTranslation } from '../src/ui/i18n';
import { TOOL_EFFECT_NAME_KEYS } from '../src/ui/tool_effect_name';
import { runRecharge } from './helpers/enchant_family_cast';

const makeSim = (seed = 11) => new Sim({ seed, playerClass: 'warrior', autoEquip: false });
const metaOf = (sim: Sim): PlayerMeta => sim.meta(sim.playerId) as PlayerMeta;

/** Self-signed charm copies for both live effects (the acquisition craft's
 *  own output shape: the craft signs every rare-def copy with the crafter's
 *  name). A stack of each so multi-slot fixtures never run dry; Springback
 *  has no item at all (the policy-derived craftable set). */
function grantCharms(sim: Sim, count = 5): void {
  const signer = metaOf(sim).name;
  sim.addItemInstance('gatherers_cache', { signer }, sim.playerId, count);
  sim.addItemInstance('artisans_eye', { signer }, sim.playerId, count);
}

/** A sim whose player carries `itemId` plus self-crafted charm copies of
 *  both live effects, ready to slot. */
function simHolding(itemId: string): Sim {
  const sim = makeSim();
  sim.addItem(itemId, 1);
  grantCharms(sim);
  return sim;
}

describe('the slot is absent until a player actually slots something', () => {
  it('a fresh character has NO toolEffectSlots field at all, and reads an empty view', () => {
    const sim = makeSim();
    // Absence, not emptiness: `toBeUndefined` and not `toEqual({})`, because the
    // parity digest hashes the player and an empty object still serializes.
    expect(metaOf(sim).toolEffectSlots).toBeUndefined();
    expect(sim.toolEffectSlots).toEqual([]);
  });

  it('a refused slot leaves the field absent rather than creating an empty map', () => {
    // Every deny arm must return BEFORE the lazy `??= {}`, or a player who
    // merely tried something illegal would diverge from one who never tried.
    const sim = makeSim(); // carries no gathering tool at all
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots, 'no tool owned').toBeUndefined();

    const withTool = simHolding('copper_mining_pick');
    withTool.slotToolEffect('not_a_profession', 'gatherers_cache');
    expect(metaOf(withTool).toolEffectSlots, 'unknown profession').toBeUndefined();
    withTool.slotToolEffect('mining', 'not_an_effect');
    expect(metaOf(withTool).toolEffectSlots, 'unknown effect').toBeUndefined();
    // And the same sim CAN slot, so the three refusals above are refusals and
    // not a broken fixture.
    withTool.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(withTool).toolEffectSlots?.mining).toBeDefined();
  });

  it('the R9 policy refuses Springback Charm on every land profession, at the resolver', () => {
    // The charm's respawnSpeed bonus arm is a deliberate no-op while depletion
    // runs unconditionally: a slotted charm would burn charges for zero
    // benefit while its description promises respawn shortening. Refused until
    // the bonus arm is wired. Each profession carries its own real tool so the
    // refusal is provably the policy, not the no-tool gate.
    for (const [professionId, toolId] of [
      ['mining', 'copper_mining_pick'],
      ['logging', 'handaxe'],
      ['herbalism', 'gathering_sickle'],
    ] as const) {
      const sim = simHolding(toolId);
      sim.slotToolEffect(professionId, 'quickening_charm');
      expect(metaOf(sim).toolEffectSlots, professionId).toBeUndefined();
      // Positive control: the same sim slots a live effect fine.
      sim.slotToolEffect(professionId, 'artisans_eye');
      expect(metaOf(sim).toolEffectSlots?.[professionId]?.effectId).toBe('artisans_eye');
    }
  });

  it('the charm refusal is keyed off the catalog kind, so a rename cannot dodge it', () => {
    // resolveSlotToolEffect checks Object.hasOwn(TOOL_EFFECTS, id) BEFORE the
    // policy, so a bare id literal in the policy would go dead the day the
    // charm is renamed: the old name would be refused as unknown while the
    // renamed charm minted freely. Walk the catalog for every respawnSpeed
    // effect instead, whatever its id.
    const parked = TOOL_EFFECT_IDS.filter((id) => TOOL_EFFECTS[id].kind === 'respawnSpeed');
    expect(parked.length).toBeGreaterThan(0); // non-vacuity: the parked kind exists
    for (const effectId of parked) {
      expect(slotToolEffectRefused('mining', effectId), effectId).toBe(true);
      expect(slotToolEffectRefused('logging', effectId), effectId).toBe(true);
      expect(slotToolEffectRefused('herbalism', effectId), effectId).toBe(true);
    }
    // And the policy refuses nothing else on land: every non-respawnSpeed
    // effect stays mintable.
    for (const effectId of TOOL_EFFECT_IDS) {
      if (parked.includes(effectId)) continue;
      expect(slotToolEffectRefused('mining', effectId), effectId).toBe(false);
    }
  });

  it('the R9 policy refuses every effect on fishing, rod carried or not', () => {
    // completeFishing never consults the effect system, so a fishing slot
    // would be mintable, HUD-rendered, and fully inert: it never fires and
    // never spends. The rod in the bag proves this is the policy refusing,
    // not the no-tool gate.
    const sim = simHolding('ironreel_fishing_rod');
    for (const effectId of TOOL_EFFECT_IDS) {
      sim.slotToolEffect('fishing', effectId);
    }
    expect(metaOf(sim).toolEffectSlots).toBeUndefined();
  });

  it('refuses a profession the player owns no REAL tool for, bare hands included', () => {
    // The gate reads bestOwnedGatherToolTierOrNone (NO_TOOL_OWNED), never the
    // bare-hands floor, so carrying nothing is not carrying a tier-1 tool.
    const sim = simHolding('copper_mining_pick');
    sim.slotToolEffect('logging', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.logging).toBeUndefined();
    // A pick is a mining tool: it must not satisfy logging's gate.
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining).toBeDefined();
  });
});

describe('slotting mints charges from the best owned tool rarity', () => {
  it('a common tool mints the catalog base, an epic tool mints three rungs more', () => {
    const common = simHolding('copper_mining_pick'); // tier 1, common
    common.slotToolEffect('mining', 'gatherers_cache');
    expect(common.toolEffectSlots[0].charges).toBe(
      startingDurabilityFor('gatherers_cache', 'common'),
    );

    const epic = simHolding('arcanite_mining_pick'); // tier 5, epic
    epic.slotToolEffect('mining', 'gatherers_cache');
    expect(epic.toolEffectSlots[0].charges).toBe(startingDurabilityFor('gatherers_cache', 'epic'));
    // The two really differ, so the rarity read is not a coincidence.
    expect(epic.toolEffectSlots[0].charges - common.toolEffectSlots[0].charges).toBe(
      RARITY_DURABILITY_BONUS * 3,
    );
  });

  it('reads the BEST owned tool when the player carries several', () => {
    const sim = simHolding('copper_mining_pick');
    sim.addItem('arcanite_mining_pick', 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(sim.toolEffectSlots[0].charges).toBe(startingDurabilityFor('gatherers_cache', 'epic'));
  });

  it('maxCharges equals the minted charges, so a recharge restores what it was minted with', () => {
    const sim = simHolding('arcanite_mining_pick');
    sim.slotToolEffect('mining', 'artisans_eye');
    const [row] = sim.toolEffectSlots;
    expect(row.maxCharges).toBe(row.charges);
    expect(row.maxCharges).toBe(startingDurabilityFor('artisans_eye', 'epic'));
  });

  it('re-slotting resets to full, and switching effect replaces rather than stacks', () => {
    const sim = simHolding('copper_mining_pick');
    sim.slotToolEffect('mining', 'gatherers_cache');
    const meta = metaOf(sim);
    const slot = meta.toolEffectSlots?.mining;
    expect(slot).toBeDefined();
    if (slot) slot.durability = 1;
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(sim.toolEffectSlots[0].charges).toBe(sim.toolEffectSlots[0].maxCharges);
    // ONE row per profession, never a growing list.
    sim.slotToolEffect('mining', 'artisans_eye');
    expect(sim.toolEffectSlots).toHaveLength(1);
    expect(sim.toolEffectSlots[0].effectId).toBe('artisans_eye');
  });

  it('defaults to always, accepts prompt (R40), and refuses modes outside the union', () => {
    const sim = simHolding('copper_mining_pick');
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(sim.toolEffectSlots[0].confirmMode).toBe('always');
    // R40: 'prompt' is a real mode now that the confirm flow ships. A
    // re-slot that changes only the mode is a GAIN (the no_gain mode
    // conjunct), so it lands, consuming another charm.
    sim.slotToolEffect('mining', 'gatherers_cache', 'prompt');
    expect(sim.toolEffectSlots[0].confirmMode).toBe('prompt');
    // A mode outside the union is refused outright, never normalized: the
    // slot keeps the mode it had.
    sim.slotToolEffect('mining', 'gatherers_cache', 'sometimes' as never);
    expect(sim.toolEffectSlots[0].confirmMode).toBe('prompt');
    // Still exactly one slot: a mode change re-mints, never duplicates.
    expect(sim.toolEffectSlots).toHaveLength(1);
  });
});

describe('the mint consumes a crafted charm (the acquisition craft price)', () => {
  it('a successful slot consumes exactly one charm copy; a refusal consumes nothing', () => {
    const sim = simHolding('copper_mining_pick'); // 5 self-signed copies each
    expect(sim.countItem('gatherers_cache')).toBe(5);
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(sim.countItem('gatherers_cache')).toBe(4);
    // Refusals consume nothing, whatever the deny arm: unknown profession,
    // policy-refused pair, no-tool profession, out-of-union mode.
    sim.slotToolEffect('not_a_profession', 'gatherers_cache');
    sim.slotToolEffect('fishing', 'gatherers_cache');
    sim.slotToolEffect('logging', 'gatherers_cache'); // pick is not an axe
    sim.slotToolEffect('mining', 'gatherers_cache', 'sometimes' as never);
    expect(sim.countItem('gatherers_cache')).toBe(4);
    // R40: a mode change is a gain, so it re-mints and pays another charm.
    sim.slotToolEffect('mining', 'gatherers_cache', 'prompt');
    expect(sim.countItem('gatherers_cache')).toBe(3);
    expect(sim.countItem('artisans_eye')).toBe(5);
  });

  it('refuses outright without a charm in bags, tool or no tool', () => {
    const sim = makeSim();
    sim.addItem('copper_mining_pick', 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    // Absent, not empty: the no-charm deny returns before the lazy init too.
    expect(metaOf(sim).toolEffectSlots).toBeUndefined();
  });

  it('refuses a re-slot that would change nothing, so a double-click costs no charm', () => {
    // The zero-benefit refusal (the R9 doctrine at the mint): the button and
    // the command both round-trip, so a second click landing before the
    // repaint used to eat a whole charm for a byte-equal slot.
    const sim = simHolding('copper_mining_pick');
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(sim.countItem('gatherers_cache')).toBe(4);
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(sim.countItem('gatherers_cache')).toBe(4);
    // Every re-slot that DOES move something still lands: a different effect,
    // and a top-up of a partially spent slot.
    sim.slotToolEffect('mining', 'artisans_eye');
    expect(metaOf(sim).toolEffectSlots?.mining?.effectId).toBe('artisans_eye');
    expect(sim.countItem('artisans_eye')).toBe(4);
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    slot.durability -= 1;
    sim.slotToolEffect('mining', 'artisans_eye');
    expect(sim.countItem('artisans_eye')).toBe(3);
    expect(metaOf(sim).toolEffectSlots?.mining?.durability).toBe(
      startingDurabilityFor('artisans_eye', 'common'),
    );
  });

  it('a LESSER tool re-slots a full slot: the R47 ceiling-downgrade escape must land', () => {
    // The sanctioned toll off a high price rung. An epic-minted slot at FULL
    // durability held by a common-pick owner is not a no-op re-slot: the
    // mint moves maxDurability 50 to 20, which drops the R47 price floor,
    // and blocking it at exactly-full would strand the documented escape
    // behind "spend a charge first".
    const sim = makeSim();
    sim.addItem('arcanite_mining_pick', 1);
    grantCharms(sim);
    sim.slotToolEffect('mining', 'gatherers_cache');
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    expect(slot.maxDurability).toBe(startingDurabilityFor('gatherers_cache', 'epic'));
    slot.durability = slot.maxDurability; // exactly full
    sim.removeItem('arcanite_mining_pick', 1);
    sim.addItem('copper_mining_pick', 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.maxDurability).toBe(
      startingDurabilityFor('gatherers_cache', 'common'),
    );
    expect(sim.countItem('gatherers_cache')).toBe(3);
  });

  it('a provenance-upgrading re-slot lands: re-signing a bought slot is a real change', () => {
    // craftedBy decides the original-crafter recharge discount, so replacing
    // a foreign-crafted full slot with one's OWN signed charm is a permanent
    // economic move the no_gain arm must not eat.
    const sim = makeSim();
    sim.addItem('copper_mining_pick', 1);
    const own = metaOf(sim).name;
    sim.addItemInstance('gatherers_cache', { signer: 'Elsewhere' }, sim.playerId, 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.craftedBy).toBe('Elsewhere');
    sim.addItemInstance('gatherers_cache', { signer: own }, sim.playerId, 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.craftedBy).toBe(own);
    expect(sim.countItem('gatherers_cache')).toBe(0);
    // And the SAME-provenance full re-slot still refuses: with another
    // self-signed copy in bags and nothing that would change, the charm is
    // protected.
    sim.addItemInstance('gatherers_cache', { signer: own }, sim.playerId, 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(sim.countItem('gatherers_cache')).toBe(1);
  });

  it('a better tool re-slots a full slot, because the charge ceiling really moves', () => {
    const sim = simHolding('copper_mining_pick');
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.maxDurability).toBe(
      startingDurabilityFor('gatherers_cache', 'common'),
    );
    // The same full slot, now with an epic pick carried: the re-slot is worth
    // a charm because it mints three rungs more charges.
    sim.addItem('arcanite_mining_pick', 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(sim.countItem('gatherers_cache')).toBe(3);
    expect(metaOf(sim).toolEffectSlots?.mining?.maxDurability).toBe(
      startingDurabilityFor('gatherers_cache', 'epic'),
    );
  });

  it('re-slotting consumes another charm: the reset-to-full is never free', () => {
    // This is the R39 bypass math made concrete: a fresh mint resets charges
    // to full, so it must always cost a whole charm (whose reagents exceed
    // any recharge), never ride the first copy.
    const sim = simHolding('copper_mining_pick');
    sim.slotToolEffect('mining', 'gatherers_cache');
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    slot.durability = 1;
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.durability).toBe(
      startingDurabilityFor('gatherers_cache', 'common'),
    );
    expect(sim.countItem('gatherers_cache')).toBe(3);
  });

  it('prefers a self-signed copy, then an unsigned one, then the first foreign signature', () => {
    const sim = makeSim();
    sim.addItem('copper_mining_pick', 1);
    const own = metaOf(sim).name;
    // Bag order: foreign, unsigned, self-signed. Preference must override it.
    sim.addItemInstance('gatherers_cache', { signer: 'Elsewhere' }, sim.playerId, 1);
    sim.addItem('gatherers_cache', 1);
    sim.addItemInstance('gatherers_cache', { signer: own }, sim.playerId, 1);
    // Each re-slot spends a charge first, so it is a real top-up rather than
    // the byte-equal re-slot the resolver now refuses outright.
    const spendOne = (): void => {
      const slot = metaOf(sim).toolEffectSlots?.mining;
      if (slot) slot.durability -= 1;
    };
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.craftedBy).toBe(own);
    // The self-signed copy is gone; the other two survive.
    const held = metaOf(sim)
      .inventory.filter((entry) => entry.itemId === 'gatherers_cache')
      .map((entry) => entry.instance?.signer);
    expect(held.sort()).toEqual(['Elsewhere', undefined]);
    // Next slot takes the unsigned copy (no provenance) over the foreign one.
    spendOne();
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.craftedBy).toBeUndefined();
    // Last copy standing: the foreign signature, faithfully recorded.
    spendOne();
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.craftedBy).toBe('Elsewhere');
    expect(sim.countItem('gatherers_cache')).toBe(0);
    // And with the bags dry, the mint refuses (spend one first, so it is the
    // NO-CHARM arm refusing rather than the no-gain one).
    spendOne();
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.craftedBy).toBe('Elsewhere');
  });
});

describe('the R48 directional provenance arm and the deny-event reasons', () => {
  it('REFUSES the provenance downgrade: a double-click cannot rewrite a self-crafted slot to a foreign name', () => {
    // The adversarial round's double-click burn: the first click consumed
    // the last self-signed copy, so the second falls to a foreign copy;
    // before R48 the craftedBy difference counted as "a change", and the
    // second click burned the foreign charm AND silently retired the
    // owner's original-crafter recharge discount. Now only a rewrite TOWARD
    // the slotter's own signature justifies the mint.
    const sim = makeSim();
    sim.addItem('copper_mining_pick', 1);
    const own = metaOf(sim).name;
    sim.addItemInstance('gatherers_cache', { signer: own }, sim.playerId, 1);
    sim.addItemInstance('gatherers_cache', { signer: 'Elsewhere' }, sim.playerId, 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.craftedBy).toBe(own);
    sim.drainEvents();
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.craftedBy).toBe(own);
    expect(sim.countItem('gatherers_cache'), 'the foreign copy is protected').toBe(1);
    expect(sim.drainEvents().find((e) => e.type === 'toolEffectResult')).toMatchObject({
      action: 'slot',
      ok: false,
      reason: 'no_gain',
    });
  });

  it('REFUSES the lateral rewrite: foreign to different-foreign buys the owner nothing', () => {
    // Recharging is owner-performed (R46), so any craftedBy other than the
    // owner's own name prices at the generic rate: swapping which foreign
    // name is recorded changes nothing the owner can ever use.
    const sim = makeSim();
    sim.addItem('copper_mining_pick', 1);
    sim.addItemInstance('gatherers_cache', { signer: 'Aldous' }, sim.playerId, 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.craftedBy).toBe('Aldous');
    sim.addItemInstance('gatherers_cache', { signer: 'Belinda' }, sim.playerId, 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.craftedBy).toBe('Aldous');
    expect(sim.countItem('gatherers_cache')).toBe(1);
  });

  it('REFUSES clearing provenance: an unsigned copy over a foreign-crafted full slot is no gain', () => {
    // Foreign and absent provenance price identically at the recharge, so
    // burning a charm to blank the field is protected like any other no-op
    // (this arm ACCEPTED before R48; the directional compare closed it).
    const sim = makeSim();
    sim.addItem('copper_mining_pick', 1);
    sim.addItemInstance('gatherers_cache', { signer: 'Elsewhere' }, sim.playerId, 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    sim.addItem('gatherers_cache', 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.craftedBy).toBe('Elsewhere');
    expect(sim.countItem('gatherers_cache')).toBe(1);
  });

  it('LANDS the upgrade over a slot with NO recorded crafter: the legacy re-sign', () => {
    // The provenance-upgrade arm's other cell: a dev-era or pre-craft slot
    // carries no craftedBy at all, and the owner re-signing it with their
    // own charm is the same real economic move as re-signing a bought one.
    // The directional compare must read "unset" as not-the-slotter, never as
    // a wildcard match.
    const sim = makeSim();
    sim.addItem('copper_mining_pick', 1);
    const own = metaOf(sim).name;
    sim.addItem('gatherers_cache', 1); // unsigned: the legacy/dev-grant shape
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.craftedBy).toBeUndefined();
    sim.addItemInstance('gatherers_cache', { signer: own }, sim.playerId, 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.craftedBy).toBe(own);
    expect(sim.countItem('gatherers_cache')).toBe(0);
  });

  it('names invalid_request and no_tool on the personal event, not only in the resolver', () => {
    // The HUD switches its deny line off `reason`, so a mis-mapped reason
    // renders the wrong copy with every state assertion still green.
    const sim = makeSim();
    sim.drainEvents();
    sim.slotToolEffect('mining', 'nope');
    sim.slotToolEffect('skinning', 'gatherers_cache');
    const invalid = sim
      .drainEvents()
      .filter((e) => e.type === 'toolEffectResult')
      .map((e) => ('reason' in e ? e.reason : undefined));
    expect(invalid).toEqual(['invalid_request', 'invalid_request']);
    sim.addItem('gatherers_cache', 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(sim.drainEvents().find((e) => e.type === 'toolEffectResult')).toMatchObject({
      ok: false,
      reason: 'no_tool',
    });
  });

  it("refuses prototype-key ids ('constructor') as invalid_request with no state change", () => {
    // toolEffectSlots and the catalog tables are plain object literals; a
    // wire string like 'constructor' must hit the includes/hasOwn guards
    // before any index, on BOTH commands.
    const sim = simHolding('copper_mining_pick');
    sim.drainEvents();
    sim.slotToolEffect('constructor', 'gatherers_cache');
    sim.slotToolEffect('mining', 'constructor');
    runRecharge(sim, 'constructor');
    const reasons = sim
      .drainEvents()
      .filter((e) => e.type === 'toolEffectResult')
      .map((e) => ('reason' in e ? e.reason : undefined));
    expect(reasons).toEqual(['invalid_request', 'invalid_request', 'invalid_request']);
    expect(metaOf(sim).toolEffectSlots).toBeUndefined();
  });

  it('a successful slot bumps wireRev: the targeted splice owes the hub post-removal duty', () => {
    // The charm consume bypasses removeItem, so the action calls
    // ctx.onInventoryChangedForQuests itself; deleting that call would leave
    // the self inventory mirror stale until an unrelated change.
    const sim = simHolding('copper_mining_pick');
    const before = metaOf(sim).wireRev;
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).wireRev).toBeGreaterThan(before);
  });

  it('a persisted prompt row re-slots to always: the confirmMode conjunct is live', () => {
    // normalizeToolEffectSlots preserves a dev-era 'prompt' row on purpose;
    // re-slotting it is a REAL change (the mode moves back to the one mode
    // the mint accepts), so it must land and cost its charm.
    const sim = simHolding('copper_mining_pick');
    sim.slotToolEffect('mining', 'gatherers_cache');
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    slot.confirmMode = 'prompt';
    const held = sim.countItem('gatherers_cache');
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining?.confirmMode).toBe('always');
    expect(sim.countItem('gatherers_cache')).toBe(held - 1);
  });
});

describe('the read surface is one row per profession, sorted, and identity-free', () => {
  it('projects one row per slotted profession, sorted by profession id', () => {
    // THREE real tools, one per land gathering profession (fishing is refused
    // by the R9 slot policy, so it cannot participate). A one-row fixture
    // cannot see a sort at all: `expect(rows).toEqual([...rows].sort())` on a
    // single element is a tautology, and an earlier version of this test
    // bought exactly that by reaching for two ids that are not gathering
    // tools (`rusty_hatchet` is a weapon, `herb_pouch` does not exist, and
    // addItem accepts an unknown id silently).
    const sim = simHolding('copper_mining_pick');
    for (const id of ['handaxe', 'gathering_sickle']) {
      sim.addItem(id, 1);
    }
    for (const professionId of ['mining', 'logging', 'herbalism']) {
      sim.slotToolEffect(professionId, 'gatherers_cache');
    }
    // A LITERAL expected order, never a self-sort. The slot order above is
    // mining/logging/herbalism, so alphabetical genuinely reorders and
    // deleting the sort reddens this.
    expect(sim.toolEffectSlots.map((r) => r.professionId)).toEqual([
      'herbalism',
      'logging',
      'mining',
    ]);
  });

  it('never projects craftedBy, so no other player identity reaches the client', () => {
    const sim = simHolding('copper_mining_pick');
    sim.slotToolEffect('mining', 'gatherers_cache');
    // The consumed self-signed charm's signer IS the slot's craftedBy (the
    // acquisition craft's provenance chain): recorded server-side for the
    // original-crafter recharge discount and the R48 provenance arm.
    expect(metaOf(sim).toolEffectSlots?.mining?.craftedBy).toBe(metaOf(sim).name);
    // The projection drops the NAME: identity stays sim-side. What crosses
    // instead is the R48 `selfCrafted` boolean (whether the crafter is the
    // viewer), which carries no identity at all and is exactly what the
    // window's affordance resolver needs for server parity.
    expect(Object.keys(sim.toolEffectSlots[0]).sort()).toEqual([
      'charges',
      'confirmMode',
      'effectId',
      'maxCharges',
      'professionId',
      'selfCrafted',
    ]);
    // The boolean's two arms: the slotter's own signed charm projects true...
    expect(sim.toolEffectSlots[0].selfCrafted).toBe(true);
    // ...and rewriting the recorded crafter to a foreign name projects false
    // without the name itself appearing anywhere in the row.
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot must exist');
    slot.craftedBy = 'Somebody Else';
    expect(sim.toolEffectSlots[0].selfCrafted).toBe(false);
    expect(JSON.stringify(sim.toolEffectSlots)).not.toContain('Somebody Else');
  });

  it('draws no rng, so a player who slots walks the same stream as one who does not', () => {
    // The whole reason depletion became charge-based: the harvest path is
    // golden-pinned at two draws, and a slot must not add a third anywhere.
    const sim = simHolding('copper_mining_pick');
    // The Rng observer seam, which is the only way to count draws without
    // changing the stream: it never affects the returned value or the state.
    const drawn: number[] = [];
    sim.rng.setObserver((v) => drawn.push(v));
    // POSITIVE CONTROL FIRST: prove the observer is actually watching the Rng
    // the slot path would reach. Without it, `drawn` staying empty is equally
    // consistent with a no-op observer or the wrong instance.
    sim.rng.next();
    expect(drawn, 'the observer must see a real draw').toHaveLength(1);
    drawn.length = 0;
    sim.slotToolEffect('mining', 'gatherers_cache');
    sim.slotToolEffect('mining', 'artisans_eye');
    sim.slotToolEffect('nope', 'gatherers_cache');
    sim.rng.setObserver(null);
    expect(drawn).toEqual([]);
  });
});

describe('persistence: absent stays absent, present round-trips', () => {
  it('omits the key entirely for a player with no slot', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId);
    expect(state).not.toBeNull();
    // `in` and not a value check: writing `toolEffectSlots: undefined` would
    // still add the key to the JSONB row for every character in the realm.
    expect(state && 'toolEffectSlots' in state).toBe(false);
  });

  it('writes the slot and restores it on load', () => {
    const sim = simHolding('arcanite_mining_pick');
    sim.slotToolEffect('mining', 'artisans_eye');
    const state = sim.serializeCharacter(sim.playerId) as CharacterState;
    expect(state.toolEffectSlots?.mining?.effectId).toBe('artisans_eye');

    const reloaded = makeSim(12);
    const pid = reloaded.addPlayer('warrior', 'Reload', { state });
    const meta = reloaded.meta(pid) as PlayerMeta;
    expect(meta.toolEffectSlots?.mining).toEqual({
      effectId: 'artisans_eye',
      durability: startingDurabilityFor('artisans_eye', 'epic'),
      maxDurability: startingDurabilityFor('artisans_eye', 'epic'),
      // The crafter identity survives the round trip: the discount must still
      // resolve after a relog, or provenance would be a session-only perk.
      craftedBy: 'Adventurer',
      confirmMode: 'always',
    });
  });

  it('the saved snapshot is a deep copy, so later harvests cannot rewrite it', () => {
    // depleteEffect mutates durability IN PLACE, so a shallow spread would hand
    // the save layer the very object the sim keeps decrementing.
    const sim = simHolding('copper_mining_pick');
    sim.slotToolEffect('mining', 'gatherers_cache');
    const state = sim.serializeCharacter(sim.playerId) as CharacterState;
    const savedCharges = state.toolEffectSlots?.mining?.durability;
    const live = metaOf(sim).toolEffectSlots?.mining;
    expect(live).toBeDefined();
    if (live) live.durability -= 5;
    expect(state.toolEffectSlots?.mining?.durability).toBe(savedCharges);
  });

  it('a save from before the field existed loads with the field still absent', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId) as CharacterState;
    const reloaded = makeSim(13);
    const pid = reloaded.addPlayer('warrior', 'Old', { state });
    expect((reloaded.meta(pid) as PlayerMeta).toolEffectSlots).toBeUndefined();
  });

  it('drops a row naming content that no longer exists, rather than loading it', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId) as CharacterState;
    // `as unknown as` deliberately: 'retired_effect' is NOT a ToolEffectId, and
    // that is the entire point of the fixture. A save written before an effect
    // was retired carries exactly this shape, and the type system cannot see
    // persisted JSONB.
    state.toolEffectSlots = {
      mining: {
        effectId: 'retired_effect',
        durability: 5,
        maxDurability: 5,
        confirmMode: 'always',
      },
    } as unknown as CharacterState['toolEffectSlots'];
    const reloaded = makeSim(14);
    const pid = reloaded.addPlayer('warrior', 'Retired', { state });
    // Nothing usable survived, so the field is absent again rather than {}.
    expect((reloaded.meta(pid) as PlayerMeta).toolEffectSlots).toBeUndefined();
    // The bare TOOL_EFFECTS index is why this matters: an unresolvable id would
    // hand applyEffectBonus an undefined def and throw on the next harvest.
    expect(Object.hasOwn(TOOL_EFFECTS, 'retired_effect')).toBe(false);
  });

  it('drops policy-refused rows on the REAL load path and round-trips as a fixed point', () => {
    // The normalizer-unit arms above cannot see a load-path regression (for
    // example initializing the field to {} instead of leaving it undefined),
    // which would put an empty-object blob into every save and move parity
    // goldens. So: drive addPlayer with a persisted blob and pin the whole
    // serialize-load-serialize cycle, the same fixed-point contract the
    // cadence field carries in tests/professions_quest_cadence.test.ts.
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId) as CharacterState;
    state.toolEffectSlots = {
      mining: {
        effectId: 'quickening_charm',
        durability: 5,
        maxDurability: 5,
        confirmMode: 'always',
      },
      fishing: {
        effectId: 'gatherers_cache',
        durability: 3,
        maxDurability: 30,
        confirmMode: 'always',
      },
      logging: {
        effectId: 'gatherers_cache',
        durability: 7,
        maxDurability: 30,
        confirmMode: 'always',
      },
    } as CharacterState['toolEffectSlots'];
    const reloaded = makeSim(16);
    const pid = reloaded.addPlayer('warrior', 'Policy', { state });
    const meta = reloaded.meta(pid) as PlayerMeta;
    // The live row survives byte-faithful; both refused rows are gone.
    expect(meta.toolEffectSlots).toEqual({
      logging: {
        effectId: 'gatherers_cache',
        durability: 7,
        maxDurability: 30,
        confirmMode: 'always',
      },
    });
    // Fixed point: a second save-load cycle changes nothing. The intermediate
    // is pinned to the literal FIRST, so a serializer that stopped emitting
    // the field entirely cannot satisfy the equality with undefined on both
    // sides.
    const resaved = reloaded.serializeCharacter(pid) as CharacterState;
    expect(resaved.toolEffectSlots).toEqual({
      logging: {
        effectId: 'gatherers_cache',
        durability: 7,
        maxDurability: 30,
        confirmMode: 'always',
      },
    });
    const again = makeSim(17);
    const pid2 = again.addPlayer('warrior', 'Policy2', { state: resaved });
    expect(again.serializeCharacter(pid2)?.toolEffectSlots).toEqual(resaved.toolEffectSlots);
  });

  it('an all-refused blob loads AND re-saves with the field absent, never {}', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId) as CharacterState;
    state.toolEffectSlots = {
      fishing: {
        effectId: 'gatherers_cache',
        durability: 3,
        maxDurability: 30,
        confirmMode: 'always',
      },
    } as CharacterState['toolEffectSlots'];
    const reloaded = makeSim(18);
    const pid = reloaded.addPlayer('warrior', 'AllRefused', { state });
    expect((reloaded.meta(pid) as PlayerMeta).toolEffectSlots).toBeUndefined();
    const resaved = reloaded.serializeCharacter(pid) as CharacterState;
    expect('toolEffectSlots' in resaved).toBe(false);
  });

  it('clamps a corrupt counter instead of loading a negative or over-full charge', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId) as CharacterState;
    state.toolEffectSlots = {
      mining: {
        effectId: 'gatherers_cache',
        durability: -8,
        maxDurability: 30,
        confirmMode: 'always',
      },
      logging: {
        effectId: 'gatherers_cache',
        durability: 999,
        maxDurability: 30,
        confirmMode: 'always',
      },
    } as CharacterState['toolEffectSlots'];
    const reloaded = makeSim(15);
    const pid = reloaded.addPlayer('warrior', 'Corrupt', { state });
    const meta = reloaded.meta(pid) as PlayerMeta;
    expect(meta.toolEffectSlots?.mining?.durability).toBe(0);
    expect(meta.toolEffectSlots?.logging?.durability).toBe(30);
  });
});

describe('the id tables and the load normalizer, directly', () => {
  it('names every effect the catalog ships, and no id it does not', () => {
    // The drift that costs a player something is the ADD direction: a fourth
    // effect in TOOL_EFFECTS with no key here renders no HUD row at all,
    // silently and forever, because the painter treats an unknown id as
    // "render nothing". Mirrors the sibling guard for the gathering-profession
    // name table in tests/gather_event_i18n.test.ts.
    expect(Object.keys(TOOL_EFFECT_NAME_KEYS).sort()).toEqual([...TOOL_EFFECT_IDS].sort());
    for (const id of TOOL_EFFECT_IDS) {
      expect(hasTranslation(TOOL_EFFECT_NAME_KEYS[id]), `name key for ${id}`).toBe(true);
    }
  });

  it('drops a persisted row the R9 policy refuses, exactly like a retired id', () => {
    // A row minted before the policy existed (or hand-written into the JSONB)
    // must not outlive the policy through a restart: the load arm consults
    // slotToolEffectRefused, so the mint refusal and the load refusal cannot
    // drift apart.
    const charm = normalizeToolEffectSlots({
      mining: {
        effectId: 'quickening_charm',
        durability: 5,
        maxDurability: 20,
        confirmMode: 'always',
      },
    } as never);
    expect(charm).toBeUndefined();
    const fishing = normalizeToolEffectSlots({
      fishing: {
        effectId: 'gatherers_cache',
        durability: 5,
        maxDurability: 20,
        confirmMode: 'always',
      },
    } as never);
    expect(fishing).toBeUndefined();
    // And a refused row beside a live one drops ALONE: the live row survives.
    const mixed = normalizeToolEffectSlots({
      mining: {
        effectId: 'gatherers_cache',
        durability: 5,
        maxDurability: 20,
        confirmMode: 'always',
      },
      fishing: {
        effectId: 'gatherers_cache',
        durability: 5,
        maxDurability: 20,
        confirmMode: 'always',
      },
    } as never);
    expect(mixed?.mining?.effectId).toBe('gatherers_cache');
    expect(mixed && 'fishing' in mixed).toBe(false);
  });

  it('craftedBy shape clamp: legal names keep provenance, junk drops ALONE', () => {
    // Phase 16 blob-growth bound: character names cap at 16 ASCII chars
    // (server/auth.ts), so a longer or non-ASCII stored craftedBy is a
    // hand-edited or corrupted row. The clamp DROPS rather than truncates (a
    // truncated prefix could equal a DIFFERENT player's real name and
    // misattribute the original-crafter recharge discount) and the slot
    // itself survives.
    const load = (craftedBy: unknown) =>
      normalizeToolEffectSlots({
        mining: {
          effectId: 'gatherers_cache',
          durability: 5,
          maxDurability: 20,
          confirmMode: 'always',
          craftedBy,
        },
      } as never)?.mining;
    expect(load('Loggerholm')?.craftedBy).toBe('Loggerholm');
    // Exactly at the ceiling: the longest legal name survives byte-faithfully.
    expect(load('A'.repeat(MAX_CRAFTED_BY_LENGTH))?.craftedBy).toBe(
      'A'.repeat(MAX_CRAFTED_BY_LENGTH),
    );
    // One over: the string drops, the slot stays live with its charges.
    const over = load('A'.repeat(MAX_CRAFTED_BY_LENGTH + 1));
    expect(over?.craftedBy).toBeUndefined();
    expect(over?.durability).toBe(5);
    // The KEY is omitted, not set to an explicit undefined: an
    // explicit-undefined key survives `in` and Object.keys, which is the
    // same distinction the equipment and bag arms make by deleting.
    expect(over && 'craftedBy' in over).toBe(false);
    expect(MAX_CRAFTED_BY_LENGTH).toBe(16);
    // Inside the length ceiling but outside the ASCII name alphabet, which
    // a length-only test lets straight through: 16 code units of multi-byte
    // text weigh several times a real name once JSON escapes them, and no
    // account can hold one. Spelled with a char code because this repo's
    // source is ASCII.
    const accented = 'A'.repeat(15) + String.fromCharCode(0xe9);
    expect(accented).toHaveLength(MAX_CRAFTED_BY_LENGTH);
    // The KEY is omitted, not set to explicit undefined, same as the length
    // arm above: an explicit-undefined key survives 'in' and Object.keys.
    const accentedRow = load(accented);
    expect(accentedRow && 'craftedBy' in accentedRow).toBe(false);
    const controlRow = load('Log\nherholm');
    expect(controlRow && 'craftedBy' in controlRow).toBe(false);
    // The slot itself still survives the drop, exactly like the length arm.
    expect(accentedRow?.durability).toBe(5);
  });

  it('confirmMode load coercion: kept modes, legacy absent reads always, garbage fails safe to prompt', () => {
    // The four value-domain arms of the load coercion. ABSENT is a legacy
    // row minted before the union existed, when every slot fired
    // unconditionally: 'always' is its faithful reading. A GARBLED value has
    // no live writer (the mint refuses out-of-union outright); it coerces to
    // 'prompt', the direction that asks before spending a charge rather
    // than the one that silently spends.
    const load = (confirmMode: unknown) =>
      normalizeToolEffectSlots({
        mining: { effectId: 'gatherers_cache', durability: 5, maxDurability: 20, confirmMode },
      } as never)?.mining?.confirmMode;
    expect(load('prompt')).toBe('prompt');
    expect(load('always')).toBe('always');
    expect(load(undefined)).toBe('always');
    // null is the never-set shape a JSON column plausibly writes: it reads
    // as legacy-absent, never as garbage (the fix-round review).
    expect(load(null)).toBe('always');
    expect(load('sometimes')).toBe('prompt');
    expect(load(7)).toBe('prompt');
  });

  it('normalizes the five safe-by-construction garbage shapes, pinned so the guards cannot rot', () => {
    // Each arm names the guard that catches it: Number.isFinite for
    // Infinity, Math.max(0, ...) for a negative durability, Math.floor for a
    // fractional max, typeof for an object craftedBy, and the !row skip for
    // a null row. All traced safe by review; these pins keep them safe.
    const inf = normalizeToolEffectSlots({
      mining: {
        effectId: 'gatherers_cache',
        durability: 5,
        maxDurability: Number.POSITIVE_INFINITY,
        confirmMode: 'always',
      },
    } as never);
    expect(inf?.mining?.maxDurability).toBe(TOOL_EFFECTS.gatherers_cache.startingDurability);
    const negative = normalizeToolEffectSlots({
      mining: {
        effectId: 'gatherers_cache',
        durability: -7,
        maxDurability: 20,
        confirmMode: 'always',
      },
    } as never);
    expect(negative?.mining?.durability).toBe(0);
    const fractional = normalizeToolEffectSlots({
      mining: {
        effectId: 'gatherers_cache',
        durability: 5,
        maxDurability: 20.9,
        confirmMode: 'always',
      },
    } as never);
    expect(fractional?.mining?.maxDurability).toBe(20);
    const objectCrafter = normalizeToolEffectSlots({
      mining: {
        effectId: 'gatherers_cache',
        durability: 5,
        maxDurability: 20,
        craftedBy: { name: 'Elsewhere' },
        confirmMode: 'always',
      },
    } as never);
    expect(objectCrafter?.mining?.craftedBy).toBeUndefined();
    const nullRow = normalizeToolEffectSlots({
      mining: null,
      logging: {
        effectId: 'gatherers_cache',
        durability: 5,
        maxDurability: 20,
        confirmMode: 'always',
      },
    } as never);
    expect(nullRow?.logging?.effectId).toBe('gatherers_cache');
    expect(nullRow && 'mining' in nullRow).toBe(false);
  });

  it('drops a saved row whose PROFESSION no longer exists, not just a retired effect', () => {
    // The retirement path the per-profession keying makes possible. Structural
    // (the normalizer iterates GATHERING_PROFESSION_IDS rather than the saved
    // keys), but nothing pinned it.
    const out = normalizeToolEffectSlots({
      skinning: {
        effectId: 'gatherers_cache',
        durability: 5,
        maxDurability: 20,
        confirmMode: 'always',
      },
    } as never);
    expect(out).toBeUndefined();
  });

  it('falls back to the catalog value for every unusable maxDurability, negatives included', () => {
    // The negative arm is the one a `Math.floor(x) || catalog` idiom gets
    // wrong: -5 is truthy, so it short-circuits past the fallback and a
    // Math.max(1, ...) floor hands back a ONE-charge slot instead.
    const base = TOOL_EFFECTS.gatherers_cache.startingDurability;
    for (const bad of [0, -5, Number.NaN, undefined]) {
      const out = normalizeToolEffectSlots({
        mining: {
          effectId: 'gatherers_cache',
          durability: 5,
          maxDurability: bad,
          confirmMode: 'always',
        },
      } as never);
      expect(out?.mining?.maxDurability, `maxDurability ${String(bad)}`).toBe(base);
      expect(out?.mining?.durability, `durability beside ${String(bad)}`).toBe(5);
    }
    // A usable stored max is kept verbatim, including one ABOVE the catalog
    // value: it must survive a future rebalance downward, which is the whole
    // reason it is stored rather than re-derived.
    const kept = normalizeToolEffectSlots({
      mining: {
        effectId: 'gatherers_cache',
        durability: 60,
        maxDurability: 50,
        confirmMode: 'always',
      },
    } as never);
    expect(kept?.mining?.maxDurability).toBe(50);
  });

  it('coerces a corrupt confirmMode to the asking mode and drops a non-string craftedBy', () => {
    const out = normalizeToolEffectSlots({
      mining: {
        effectId: 'gatherers_cache',
        durability: 5,
        maxDurability: 20,
        confirmMode: 'nonsense',
        craftedBy: 42,
      },
    } as never);
    // Fail-safe direction (the phase 14 QA): a garbled mode loads as
    // 'prompt', the mode that asks before spending a charge; only a literal
    // 'always' (or the legacy absent field) fires unconditionally.
    expect(out?.mining?.confirmMode).toBe('prompt');
    // The docblock promises every row is checked; craftedBy was the one field
    // passing through unvalidated, and it re-serializes on the next save.
    expect(out?.mining?.craftedBy).toBeUndefined();
  });

  it('deep-copies EVERY slotted profession on save, not just the first', () => {
    // A one-row fixture cannot see a loop that copies the first entry and
    // aliases the rest.
    const sim = simHolding('copper_mining_pick');
    sim.addItem('handaxe', 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    sim.slotToolEffect('logging', 'gatherers_cache');
    const state = sim.serializeCharacter(sim.playerId) as CharacterState;
    const saved = {
      mining: state.toolEffectSlots?.mining?.durability,
      logging: state.toolEffectSlots?.logging?.durability,
    };
    const live = metaOf(sim).toolEffectSlots;
    if (live?.mining) live.mining.durability -= 3;
    if (live?.logging) live.logging.durability -= 4;
    expect(state.toolEffectSlots?.mining?.durability).toBe(saved.mining);
    expect(state.toolEffectSlots?.logging?.durability).toBe(saved.logging);
  });
});

describe('the deny echo clamps wire-supplied ids (the whole-branch hardening)', () => {
  it('pins the ceiling literal and that every shipped id sits far under it', () => {
    // 64 is the wire contract: the deny arms echo the raw client strings and
    // the clamp is the only bound between a 16 KiB junk id and the sender.
    expect(MAX_ECHOED_WIRE_ID_LENGTH).toBe(64);
    for (const id of [...GATHERING_PROFESSION_IDS, ...TOOL_EFFECT_IDS]) {
      expect(id.length, id).toBeLessThan(MAX_ECHOED_WIRE_ID_LENGTH);
    }
  });

  it('a slot deny echoes an oversized professionId clamped, never byte-for-byte', () => {
    const sim = simHolding('copper_mining_pick');
    const junk = 'x'.repeat(5000);
    sim.drainEvents();
    sim.slotToolEffect(junk, 'gatherers_cache');
    expect(sim.drainEvents().find((e) => e.type === 'toolEffectResult')).toMatchObject({
      action: 'slot',
      ok: false,
      professionId: junk.slice(0, MAX_ECHOED_WIRE_ID_LENGTH),
    });
  });

  it('a slot deny clamps an oversized effectId the same way', () => {
    const sim = simHolding('copper_mining_pick');
    const junk = 'e'.repeat(5000);
    sim.drainEvents();
    sim.slotToolEffect('mining', junk);
    expect(sim.drainEvents().find((e) => e.type === 'toolEffectResult')).toMatchObject({
      action: 'slot',
      ok: false,
      effectId: junk.slice(0, MAX_ECHOED_WIRE_ID_LENGTH),
    });
  });

  it('a recharge deny clamps the oversized professionId too', () => {
    const sim = makeSim();
    const junk = 'r'.repeat(16000);
    sim.drainEvents();
    runRecharge(sim, junk);
    expect(sim.drainEvents().find((e) => e.type === 'toolEffectResult')).toMatchObject({
      action: 'recharge',
      ok: false,
      professionId: junk.slice(0, MAX_ECHOED_WIRE_ID_LENGTH),
    });
  });

  it('a valid id is untouched by the clamp on a real deny', () => {
    // The clamp must be invisible to legal traffic: a genuine deny still
    // names the exact profession the player asked about.
    const sim = makeSim(); // no tool at all
    sim.drainEvents();
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(sim.drainEvents().find((e) => e.type === 'toolEffectResult')).toMatchObject({
      action: 'slot',
      ok: false,
      professionId: 'mining',
      effectId: 'gatherers_cache',
    });
  });
});

describe('the dead gate on both player-reachable actions (the whole-branch hardening)', () => {
  it('a dead player cannot slot: the charm stays in the bags and the family line answers', () => {
    // R31 doctrine, the family standard: every adjacent surface (vendor buy/
    // sell, harvest, fishing, delve buy) refuses dead, and these two commands
    // consume real materials, so a ghost must not spend them.
    const sim = simHolding('copper_mining_pick');
    sim.player.dead = true;
    sim.player.hp = 0;
    sim.drainEvents();
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots, 'no slot minted while dead').toBeUndefined();
    expect(sim.countItem('gatherers_cache'), 'the charm is not consumed').toBe(5);
    const err = sim.drainEvents().find((e) => e.type === 'error');
    expect(err).toMatchObject({ text: "You can't do that while dead." });
  });

  it('a dead player cannot recharge: materials stay and the same line answers', () => {
    // Decisive fixture (the fix-round review): the slot is DEPLETED and the
    // materials are IN THE BAGS, so a live recharge here would succeed and
    // consume; only the dead gate stands between the attempt and the spend.
    const sim = simHolding('copper_mining_pick');
    sim.slotToolEffect('mining', 'gatherers_cache');
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    slot.durability = 0;
    sim.addItem('arcane_dust', 10);
    sim.player.dead = true;
    sim.player.hp = 0;
    sim.drainEvents();
    runRecharge(sim, 'mining');
    const err = sim.drainEvents().find((e) => e.type === 'error');
    expect(err).toMatchObject({ text: "You can't do that while dead." });
    expect(sim.countItem('arcane_dust'), 'materials untouched').toBe(10);
    expect(slot.durability, 'no refill happened').toBe(0);
    // Alive-control: the SAME sim recharges fine, so the gate is the refusal.
    sim.player.dead = false;
    runRecharge(sim, 'mining');
    expect(sim.countItem('arcane_dust')).toBeLessThan(10);
    expect(slot.durability).toBeGreaterThan(0);
  });

  it('the same player alive can slot, so the gate is the refusal and not a broken fixture', () => {
    const sim = simHolding('copper_mining_pick');
    sim.player.dead = true;
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots).toBeUndefined();
    sim.player.dead = false;
    sim.slotToolEffect('mining', 'gatherers_cache');
    expect(metaOf(sim).toolEffectSlots?.mining).toBeDefined();
  });
});
