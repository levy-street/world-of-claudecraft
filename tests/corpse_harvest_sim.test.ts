import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; only the wire encode/decode and
// broadcast paths are under test (wireEntity round-trips plus a real GameServer
// snapshot pipeline), never persistence.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { type ClientSession, GameServer, wireEntity } from '../server/game';
import { corpseLootAvailability } from '../src/game/corpse_loot_availability';
import { ClientWorld } from '../src/net/online';
import { bagCapacity, stackSizeOf } from '../src/sim/bags';
import {
  HARVEST_COMPONENT_ITEMS,
  HARVEST_COMPONENT_SPECIMENS,
  MONSTER_MATERIAL_TIERS,
  monsterMaterialTierFor,
} from '../src/sim/content/professions';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { forfeitsEveryMappedYield, isHarvestableCorpse } from '../src/sim/professions/gathering';
import {
  bestOwnedAnyGatherToolTier,
  canHarvestMonsterMaterial,
} from '../src/sim/professions/tools';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { corpseHarvestView } from '../src/ui/hud/loot/corpse_harvest_view';

// End-to-end: a slain mob's corpse can be harvested for profession components
// exactly once, first-come. This is the deliberate OPPOSITE of a world gathering
// node (per-player, everyone gets their own harvest); here two players racing the
// same corpse must resolve to exactly one success, deterministically, even when
// both commands land in the SAME 20 Hz tick (server.game.ts processes a tick's
// command batch synchronously, one command at a time, so there is no interleaving
// to race).

type SimInternals = {
  entities: Map<number, Entity>;
  players: Map<number, PlayerMeta>;
};

function setup(seed = 11) {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const internals = sim as unknown as SimInternals;
  const a = sim.addPlayer('warrior', 'Alpha');
  const b = sim.addPlayer('warrior', 'Bravo');
  sim.tick();

  for (const pid of [a, b]) {
    const e = internals.entities.get(pid)!;
    e.pos = { x: 0, y: 0, z: 0 };
    e.prevPos = { x: 0, y: 0, z: 0 };
  }

  // A dead wolf corpse with profession component tags (hide, fang; see #1140).
  const template = MOBS.forest_wolf;
  const mob = createMob(9999, template, template.maxLevel, { x: 0, y: 0, z: 0 });
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  internals.entities.set(mob.id, mob);

  return { sim, internals, a, b, mob };
}

// Fill every free slot with distinct 1-per-slot gear so the next add has
// nowhere to go (same idiom as tests/bags.test.ts fillBags, per-player).
function fillBags(sim: Sim, internals: SimInternals, pid: number): void {
  const m = internals.players.get(pid)!;
  const cap = bagCapacity(m.bags);
  const gearIds = Object.values(ITEMS)
    .filter((d) => d.kind === 'weapon' || d.kind === 'armor')
    .map((d) => d.id);
  let i = 0;
  while (m.inventory.length < cap) {
    sim.addItem(gearIds[i % gearIds.length], 1, pid);
    i++;
  }
}

/**
 * One rig for "issue a harvest command against a corpse of `templateId` and
 * report every observable it could have moved". Module-scope and shared by the
 * #2509 and #2513 describes below, which used to hold two near-identical copies:
 * one rig means a future observable is added in one place, and the two suites
 * cannot drift into measuring different things.
 *
 * `arrange` runs after the corpse is in the world and before the command, so a
 * case can move the player, pre-claim the corpse, or poison the town focus and
 * still get the same measurement set.
 */
function harvestCommand(
  templateId: string,
  components: string[] | undefined,
  opts: {
    seed?: number;
    townFocus?: Record<string, number>;
    corpseId?: number;
    arrange?: (rig: ReturnType<typeof setup>, corpse: Entity) => void;
  } = {},
) {
  const rig = setup(opts.seed ?? 5);
  const { sim, internals, a } = rig;
  const template = MOBS[templateId];
  const corpse = createMob(opts.corpseId ?? 7513, template, template.maxLevel, {
    x: 0,
    y: 0,
    z: 0,
  });
  corpse.dead = true;
  corpse.aiState = 'dead';
  corpse.corpseTimer = 9999;
  corpse.respawnTimer = 9999;
  internals.entities.set(corpse.id, corpse);
  if (opts.townFocus) internals.players.get(a)!.townFocus = { ...opts.townFocus };
  opts.arrange?.(rig, corpse);
  sim.drainEvents();
  const before = structuredClone(internals.players.get(a)!.inventory);
  let draws = 0;
  const rng = (sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } }).rng;
  rng.setObserver(() => {
    draws++;
  });
  sim.harvestCorpse(corpse.id, components, a);
  rng.setObserver(null);
  const events = sim.drainEvents();
  return {
    sim,
    internals,
    a,
    b: rig.b,
    corpse,
    draws,
    events,
    before,
    errors: events
      .filter((e): e is Extract<typeof e, { type: 'error' }> => e.type === 'error')
      .map((e) => e.text),
    inventory: structuredClone(internals.players.get(a)!.inventory),
    items: internals.players.get(a)!.inventory.length,
    claimedBy: corpse.harvestClaimedBy,
    corpseTimer: corpse.corpseTimer,
  };
}

describe('corpse harvest: single-use, first-come (#1141)', () => {
  it('is unclaimed on a fresh corpse', () => {
    const { mob } = setup();
    expect(mob.harvestClaimedBy).toBeNull();
  });

  it('the first attempt succeeds and claims the corpse', () => {
    const { sim, mob, a } = setup();
    sim.harvestCorpse(mob.id, undefined, a);
    expect(mob.harvestClaimedBy).toBe(a);
  });

  it('a later solo attempt against an already-claimed corpse is denied', () => {
    const { sim, mob, a, b } = setup();
    sim.harvestCorpse(mob.id, undefined, a);
    expect(mob.harvestClaimedBy).toBe(a);
    // Bravo tries a full second later; still denied, still claimed by Alpha.
    for (let i = 0; i < 20; i++) sim.tick();
    sim.harvestCorpse(mob.id, undefined, b);
    expect(mob.harvestClaimedBy).toBe(a);
  });

  it('exactly one of two attempts in the SAME tick succeeds, deterministically', () => {
    // Simulate both players' commands landing in the same 20 Hz tick: the
    // server dispatches a tick's command batch synchronously, one at a time, so
    // this back-to-back call pair on one tick is the faithful reproduction.
    const { sim, mob, a, b } = setup();
    sim.harvestCorpse(mob.id, undefined, a);
    sim.harvestCorpse(mob.id, undefined, b);
    expect(mob.harvestClaimedBy).toBe(a);
  });

  it('is order-independent: whichever command is processed first wins, never both', () => {
    const run1 = setup();
    run1.sim.harvestCorpse(run1.mob.id, undefined, run1.a);
    run1.sim.harvestCorpse(run1.mob.id, undefined, run1.b);

    const run2 = setup();
    run2.sim.harvestCorpse(run2.mob.id, undefined, run2.b);
    run2.sim.harvestCorpse(run2.mob.id, undefined, run2.a);

    // Whichever pid is processed first claims the corpse; the second is always denied.
    expect(run1.mob.harvestClaimedBy).toBe(run1.a);
    expect(run2.mob.harvestClaimedBy).toBe(run2.b);
  });

  it('grants the mapped component item only to the winner', () => {
    const { sim, mob, a, b } = setup();
    sim.harvestCorpse(mob.id, undefined, a);
    sim.harvestCorpse(mob.id, undefined, b);
    // forest_wolf's componentTags (#1140) include 'hide', mapped to the
    // dedicated rough_hide material. #1142's focus-harvest tier
    // roll can grant more than one per tier, so the winner gets AT LEAST one,
    // never the loser.
    expect(sim.countItem('rough_hide', a)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('rough_hide', b)).toBe(0);
  });

  it('denies harvest against a mob with no profession component tags', () => {
    const { sim, internals, a } = setup();
    // warlock_imp carries no componentTags (#1140 only tagged a subset of mobs).
    expect(MOBS.warlock_imp.componentTags).toBeUndefined();
    const noTagTemplate = MOBS.warlock_imp;
    const noTagMob = createMob(8888, noTagTemplate, noTagTemplate.maxLevel, {
      x: 0,
      y: 0,
      z: 0,
    });
    noTagMob.dead = true;
    noTagMob.corpseTimer = 9999;
    noTagMob.respawnTimer = 9999;
    internals.entities.set(noTagMob.id, noTagMob);
    sim.harvestCorpse(noTagMob.id, undefined, a);
    expect(noTagMob.harvestClaimedBy).toBeNull();
  });

  it('denies harvest on a live (non-dead) mob', () => {
    const { sim, mob, a } = setup();
    mob.dead = false;
    sim.harvestCorpse(mob.id, undefined, a);
    expect(mob.harvestClaimedBy).toBeNull();
  });

  it('a dead player cannot harvest and does not consume the claim', () => {
    const { sim, internals, mob, a, b } = setup();
    const alpha = internals.entities.get(a)!;
    alpha.dead = true;
    sim.drainEvents();
    sim.harvestCorpse(mob.id, undefined, a);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error' && e.text === "You can't do that while dead.")).toBe(
      true,
    );
    expect(mob.harvestClaimedBy).toBeNull();
    expect(sim.countItem('rough_hide', a)).toBe(0);
    // The corpse stays unclaimed: a living player can still win it.
    sim.harvestCorpse(mob.id, undefined, b);
    expect(mob.harvestClaimedBy).toBe(b);
  });

  it('a full-bags harvest is refused and does not consume the claim', () => {
    const { sim, internals, mob, a, b } = setup();
    fillBags(sim, internals, a);
    sim.drainEvents();
    sim.harvestCorpse(mob.id, undefined, a);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(sim.countItem('rough_hide', a)).toBe(0);
    // The unconsumed claim is still winnable by a player with bag room.
    sim.harvestCorpse(mob.id, undefined, b);
    expect(mob.harvestClaimedBy).toBe(b);
    // #1142's focus-harvest tier roll can grant more than one per component.
    expect(sim.countItem('rough_hide', b)).toBeGreaterThanOrEqual(1);
  });

  it('a slot-full inventory with a nearly-full yield stack is refused, never taken over capacity', () => {
    // The tier roll can add up to harvestTierQuantity('legendary') = 6 of a
    // component's item, and addItem is never capacity-capped. A gate that only
    // reserves 1 would pass here (the partial stack absorbs 1) and the roll
    // could spill past capacity into a new slot; the gate must reserve the
    // roll's MAXIMUM. Focused single-component pick so the partial-stack path
    // is what decides, not a second component needing a free slot.
    const { sim, internals, mob, a, b } = setup();
    fillBags(sim, internals, a);
    const m = internals.players.get(a)!;
    const cap = bagCapacity(m.bags);
    // Convert one gear slot into a rough_hide stack with room for exactly 1.
    m.inventory[0] = { itemId: 'rough_hide', count: stackSizeOf(ITEMS.rough_hide) - 1 };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    sim.harvestCorpse(mob.id, ['hide'], a);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(m.inventory.length).toBeLessThanOrEqual(cap);
    expect(sim.countItem('rough_hide', a)).toBe(stackSizeOf(ITEMS.rough_hide) - 1);
    // The unconsumed claim is still winnable by a player with room.
    sim.harvestCorpse(mob.id, ['hide'], b);
    expect(mob.harvestClaimedBy).toBe(b);
    expect(sim.countItem('rough_hide', b)).toBeGreaterThanOrEqual(1);
  });

  it('a tagged corpse with no mapped item is refused, not silently claimed (#2513)', () => {
    // fen_troll's tags (claw, tusk) map to no harvest item. This pin used to
    // lock the opposite behavior, flagged in its own comment as an open design
    // call: the claim was spent, two tier rolls were drawn, nothing was granted
    // and NOTHING was emitted, so a player could not tell anything had
    // happened. #2513 settled that call by making isHarvestableCorpse answer on
    // mapped families, which routes this corpse to the pre-existing pre-claim,
    // rng-free refusal every untagged template already takes.
    const { sim, internals, mob, a, b } = setup();
    const template = MOBS.fen_troll;
    expect(template.componentTags).toEqual(['claw', 'tusk']);
    for (const tag of template.componentTags!) {
      expect(HARVEST_COMPONENT_ITEMS[tag]).toBeUndefined();
    }
    const noYieldMob = createMob(7777, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    noYieldMob.dead = true;
    noYieldMob.corpseTimer = 9999;
    noYieldMob.respawnTimer = 9999;
    internals.entities.set(noYieldMob.id, noYieldMob);
    const before = internals.players.get(a)!.inventory.length;
    sim.drainEvents();
    let draws = 0;
    const rng = (sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } }).rng;
    rng.setObserver(() => {
      draws++;
    });
    sim.harvestCorpse(noYieldMob.id, undefined, a);
    rng.setObserver(null);
    // The command says something, exactly once, and it is the localized
    // corpse-level refusal rather than a new string.
    expect(sim.drainEvents()).toEqual([
      { type: 'error', pid: a, text: 'That corpse has nothing to harvest.' },
    ]);
    // ...and nothing moved: no claim, no draw, no item, and the post-harvest
    // corpse-timer clamp never ran. Zero draws alone would not establish the
    // refusal (a spent claim used to draw two here), so the claim and the timer
    // are what say "refused".
    expect(noYieldMob.harvestClaimedBy).toBeNull();
    expect(draws).toBe(0);
    expect(noYieldMob.corpseTimer).toBe(9999);
    expect(internals.players.get(a)!.inventory.length).toBe(before);
    // A second player gets the same answer, not a "already harvested" one: the
    // corpse was never claimed, so there is no claim to lose the race for.
    sim.harvestCorpse(noYieldMob.id, undefined, b);
    expect(noYieldMob.harvestClaimedBy).toBeNull();
    expect(sim.drainEvents()).toEqual([
      { type: 'error', pid: b, text: 'That corpse has nothing to harvest.' },
    ]);
    // The rig is not simply refusing every corpse: the suite's own forest_wolf
    // corpse (hide, fang) still harvests on the same Sim, same tick.
    sim.harvestCorpse(mob.id, ['hide'], a);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(sim.countItem('rough_hide', a)).toBeGreaterThan(0);
  });

  it('clears the claim on respawn, so the next corpse is harvestable again', () => {
    const { sim, internals, mob, a, b } = setup();
    sim.harvestCorpse(mob.id, undefined, a);
    expect(mob.harvestClaimedBy).toBe(a);

    (sim as unknown as { ctx: { respawnMob(m: Entity): void } }).ctx.respawnMob(mob);
    expect(mob.harvestClaimedBy).toBeNull();

    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    internals.entities.set(mob.id, mob);

    sim.harvestCorpse(mob.id, undefined, b);
    expect(mob.harvestClaimedBy).toBe(b);
  });
});

// #1145 Pristine specimens: a rare-or-better rarity roll on a
// family with a specimen (HARVEST_COMPONENT_SPECIMENS) grants the specimen as
// a SIGNED instance IN ADDITION to the plain component; the regular component
// always grants plain, and below the rarity floor no specimen exists at all.
// A family WITHOUT a specimen (fang) keeps the original behavior: the
// component itself grants signed at rare-or-better. Each case focuses on a
// single component so the harvest draws exactly one tier roll and one rarity
// roll, keeping the seed choice legible. Seeds below are pre-verified against
// this exact setup() shape (two players, seeded before the harvest's rolls)
// to land on each side of the rarity floor; the rare-or-better seed was
// re-recorded from 10 to 2 after the Eastbrook camp respacing thinned the
// zone-1 camp counts and shifted the camp-driven world-gen draw sequence.
describe('signed Pristine specimens (#1145)', () => {
  it('a rare-or-better harvest grants the signed specimen PLUS the plain component (seed 2)', () => {
    const { sim, internals, a, mob } = setup(2);
    sim.drainEvents();
    sim.harvestCorpse(mob.id, ['hide'], a);
    // The signed jackpot landed signed: no downgrade notice fires.
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toHaveLength(0);
    const meta = internals.players.get(a)!;
    // The regular component grants plain (fungible, unsigned), at its rolled
    // tier quantity: the specimen is now the signed jackpot, not the hide.
    const plain = meta.inventory.find((s) => s.itemId === 'rough_hide');
    expect(plain).toBeDefined();
    expect(plain?.instance).toBeUndefined();
    expect(sim.countItem('rough_hide', a)).toBeGreaterThanOrEqual(1);
    // The specimen is granted exactly once and is ALWAYS signed: its own
    // single-count instance slot (addItemInstance), never a fungible stack.
    const specimen = meta.inventory.find((s) => s.itemId === 'pristine_hide');
    expect(specimen).toBeDefined();
    expect(specimen?.instance?.signer).toBe('Alpha');
    expect(sim.countItem('pristine_hide', a)).toBe(1);
  });

  it('a below-rare harvest grants a plain stack at its tier quantity and NO specimen (seed 3)', () => {
    const { sim, internals, a, mob } = setup(3);
    sim.harvestCorpse(mob.id, ['hide'], a);
    const meta = internals.players.get(a)!;
    const slot = meta.inventory.find((s) => s.itemId === 'rough_hide');
    expect(slot).toBeDefined();
    expect(slot?.instance).toBeUndefined();
    // This seed's focus-tier roll lands above the poor floor, so the fungible
    // grant is more than a single unit (harvestTierQuantity(tier), #1142).
    // Quantity re-recorded after the Eastbrook camp respacing thinned the
    // zone-1 camp counts (was 2).
    expect(sim.countItem('rough_hide', a)).toBe(3);
    expect(sim.countItem('pristine_hide', a)).toBe(0);
  });

  it('a specimen-less family (fang) keeps the signed-component behavior at rare-or-better (seed 2)', () => {
    const { sim, internals, a, mob } = setup(2);
    sim.harvestCorpse(mob.id, ['fang'], a);
    const meta = internals.players.get(a)!;
    const slot = meta.inventory.find((s) => s.itemId === 'wolf_fang');
    expect(slot).toBeDefined();
    expect(slot?.instance?.signer).toBe('Alpha');
    // Seed 10's fang roll lands a two-unit tier (harvestTierQuantity), and
    // roomy bags fit the whole thing: the signature truncates only when the
    // bags force it to, never the rolled quantity itself (#2139's own
    // contract).
    expect(sim.countItem('wolf_fang', a)).toBe(2);
  });

  it('an empty-bag signed grant lands the FULL rolled quantity, never truncated to one (seed 153)', () => {
    // Regression pin: the unfixed code called addItemInstance with no count
    // argument (defaulting to 1) even though grant.plainQty (the rolled tier
    // quantity, harvestTierQuantity) sat right there, silently discarding the
    // rest of a multi-unit signable roll. Empty bags have room for the whole
    // roll, so the fixed grant must land as one signed stack at the full
    // rolled count, not a single unit.
    const { sim, internals, a, mob } = setup(153);
    const meta = internals.players.get(a)!;
    // A fresh character's starting kit leaves the bags nearly empty (roomy,
    // not necessarily zero items): plenty of free slots for a 3-unit roll.
    expect(bagCapacity(meta.bags) - meta.inventory.length).toBeGreaterThan(3);
    sim.harvestCorpse(mob.id, ['fang'], a);
    const signedSlots = meta.inventory.filter(
      (s) => s.itemId === 'wolf_fang' && s.instance?.signer === 'Alpha',
    );
    // Exactly one signed stack, not several single-unit slots.
    expect(signedSlots).toHaveLength(1);
    expect(signedSlots[0].count).toBe(3);
    expect(sim.countItem('wolf_fang', a)).toBe(3);
  });

  it('every other specimen family grants its own jackpot beside the plain component (seed 2)', () => {
    // The hide row is exercised above; this sweeps the remaining three
    // specimen rows behaviorally (silk and venomSac via webwood_spider, meat
    // via wild_boar), so a mistargeted HARVEST_COMPONENT_SPECIMENS row cannot
    // hide behind hide-only coverage. Seed 2's rarity roll clears the
    // signable floor for a single focused component regardless of family
    // (the roll's draw position is identical).
    const families: { templateId: string; focus: string; plain: string; specimen: string }[] = [
      {
        templateId: 'webwood_spider',
        focus: 'silk',
        plain: 'spider_silk',
        specimen: 'pristine_silk',
      },
      {
        templateId: 'webwood_spider',
        focus: 'venomSac',
        plain: 'venom_gland',
        specimen: 'pristine_venom_gland',
      },
      { templateId: 'wild_boar', focus: 'meat', plain: 'game_meat', specimen: 'prime_cut' },
    ];
    for (const f of families) {
      const { sim, internals, a } = setup(2);
      const template = MOBS[f.templateId];
      const corpse = createMob(7776, template, template.maxLevel, { x: 0, y: 0, z: 0 });
      corpse.dead = true;
      corpse.aiState = 'dead';
      corpse.corpseTimer = 9999;
      corpse.respawnTimer = 9999;
      internals.entities.set(corpse.id, corpse);
      sim.harvestCorpse(corpse.id, [f.focus], a);
      const meta = internals.players.get(a)!;
      const plain = meta.inventory.find((s) => s.itemId === f.plain);
      expect(plain, `${f.focus} plain`).toBeDefined();
      expect(plain?.instance, `${f.focus} plain stays unsigned`).toBeUndefined();
      const specimen = meta.inventory.find((s) => s.itemId === f.specimen);
      expect(specimen?.instance?.signer, `${f.focus} jackpot`).toBe('Alpha');
      expect(sim.countItem(f.specimen, a)).toBe(1);
    }
  });

  it('the cloth family (no specimen) grants the signed component at rare-or-better (seed 2)', () => {
    const { sim, internals, a } = setup(2);
    const template = MOBS.vale_bandit;
    const corpse = createMob(7775, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    sim.harvestCorpse(corpse.id, ['cloth'], a);
    const meta = internals.players.get(a)!;
    const slot = meta.inventory.find((s) => s.itemId === 'homespun_cloth');
    expect(slot).toBeDefined();
    expect(slot?.instance?.signer).toBe('Alpha');
    // This corpse's own rolled quantity (#2473): the bandit's cloth tier rolls
    // one where the wolf's fang rolls two at the same seed, so the count
    // tracks the ROLL rather than any constant the arm could hardcode. The
    // contrast is the point, not the pair of numbers.
    expect(sim.countItem('homespun_cloth', a)).toBe(1);
  });

  it('a slot-full signed-family harvest falls back to the plain stack, never over capacity (seed 2)', () => {
    // The pre-gate reserves plain-stack room only, so a partial stack lets it
    // pass while a signed instance would still need a fresh slot. The rare+
    // arm must then fall back to the plain fungible top-up (the signature
    // truncates, the yield does not), same free-slot contract as the
    // specimen arm.
    const { sim, internals, a, mob } = setup(2);
    fillBags(sim, internals, a);
    const m = internals.players.get(a)!;
    const cap = bagCapacity(m.bags);
    m.inventory[0] = { itemId: 'wolf_fang', count: 1 };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    sim.harvestCorpse(mob.id, ['fang'], a);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(m.inventory.length).toBeLessThanOrEqual(cap);
    const signed = m.inventory.find((s) => s.itemId === 'wolf_fang' && s.instance?.signer);
    expect(signed).toBeUndefined();
    // Seed 2's rarity roll clears the signable floor with this exact draw
    // sequence (proven by the unfixed code overflowing here), so the count
    // above the seeded 1 proves the plain fallback delivered the yield.
    expect(sim.countItem('wolf_fang', a)).toBeGreaterThan(1);
    // Downgrade notice: the unsigned fallback tells the player, exactly once,
    // with the mark-lost arm (the yield survived, the signature did not).
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toEqual([
      { type: 'gatherDowngrade', pid: a, surface: 'corpse', lost: 'mark' },
    ]);
  });

  it('a slot-full specimen harvest truncates the specimen and keeps the plain yield (seed 2)', () => {
    // Plain grant tops up the partial stack without opening a slot, so the
    // specimen guard sees a full bag: the jackpot truncates rather than
    // overflowing, and the plain component still arrives.
    const { sim, internals, a, mob } = setup(2);
    fillBags(sim, internals, a);
    const m = internals.players.get(a)!;
    const cap = bagCapacity(m.bags);
    m.inventory[0] = { itemId: 'rough_hide', count: 1 };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    sim.harvestCorpse(mob.id, ['hide'], a);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(m.inventory.length).toBeLessThanOrEqual(cap);
    expect(m.inventory.some((s) => s.itemId === 'pristine_hide')).toBe(false);
    expect(sim.countItem('rough_hide', a)).toBeGreaterThan(1);
    // Downgrade notice: the dropped jackpot tells the player, exactly once,
    // with the find-lost arm (the plain yield survived, the pure extra did not).
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toEqual([
      { type: 'gatherDowngrade', pid: a, surface: 'corpse', lost: 'find' },
    ]);
  });

  it('one command losing a mark AND a find emits ONE downgrade, reporting the mark', () => {
    // The dedupe pin (the toolDeniedEmitted idiom): a spread wolf harvest
    // whose fang (no specimen: signed-or-plain) AND hide (specimen jackpot)
    // rolls both clear the signable floor, against slot-full bags with
    // partial stacks of both plain components, downgrades twice in one
    // command: the fang signature falls back to the plain top-up (loop one,
    // 'mark') and the hide jackpot truncates (loop two, 'find'). Exactly one
    // event may fire, and the first loop runs first, so it reports 'mark'.
    // The qualifying seed is hunted with a probe run (roomy bags: both signed
    // grants land as instances, proving both rolls signable), then asserted
    // on a FRESH same-seed world: the rarity draws are inventory-independent
    // (pinned by the grant-order contract above), so the same seed reproduces
    // the same rolls against the full bags.
    for (let seed = 1; seed <= 200; seed++) {
      const probe = setup(seed);
      probe.sim.harvestCorpse(probe.mob.id, undefined, probe.a);
      const pm = probe.internals.players.get(probe.a)!;
      const fangSigned = pm.inventory.some((s) => s.itemId === 'wolf_fang' && s.instance?.signer);
      const hideJackpot = pm.inventory.some((s) => s.itemId === 'pristine_hide');
      if (!fangSigned || !hideJackpot) continue;
      const { sim, internals, a, mob } = setup(seed);
      fillBags(sim, internals, a);
      const m = internals.players.get(a)!;
      const cap = bagCapacity(m.bags);
      m.inventory[0] = { itemId: 'wolf_fang', count: 1 };
      m.inventory[1] = { itemId: 'rough_hide', count: 1 };
      expect(m.inventory.length).toBe(cap);
      sim.drainEvents();
      sim.harvestCorpse(mob.id, undefined, a);
      expect(mob.harvestClaimedBy).toBe(a);
      expect(m.inventory.length).toBeLessThanOrEqual(cap);
      // Both downgrades happened: no signed fang, no jackpot, both plain
      // stacks absorbed their yields.
      expect(m.inventory.some((s) => s.itemId === 'wolf_fang' && s.instance)).toBe(false);
      expect(m.inventory.some((s) => s.itemId === 'pristine_hide')).toBe(false);
      expect(sim.countItem('wolf_fang', a)).toBeGreaterThan(1);
      expect(sim.countItem('rough_hide', a)).toBeGreaterThan(1);
      // ... but exactly ONE event fired, reporting the first-loop mark loss.
      expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toEqual([
        { type: 'gatherDowngrade', pid: a, surface: 'corpse', lost: 'mark' },
      ]);
      return;
    }
    throw new Error('no seed with both fang and hide signable within 200');
  });
});

// Grant order: a mob carrying TWO specimen families (wild_boar: hide -> and
// meat -> are both in HARVEST_COMPONENT_SPECIMENS, tusk maps to nothing) is
// where the grant ORDER matters: the pre-gate reserves room for the plain
// component stacks only, so a signed jackpot granted mid-loop could consume
// the slot reserved for a LATER family's plain stack and push the uncapped
// plain grant past capacity. Plain yields must all land before any signed
// instance; the jackpot is the extra that truncates, never the plain yield.
describe('two-specimen-family harvest capacity contract', () => {
  function addBoarCorpse(internals: SimInternals, id = 8888) {
    const template = MOBS.wild_boar;
    expect(template.componentTags).toEqual(['hide', 'tusk', 'meat']);
    const boar = createMob(id, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    boar.dead = true;
    boar.aiState = 'dead';
    boar.corpseTimer = 9999;
    boar.respawnTimer = 9999;
    internals.entities.set(boar.id, boar);
    return boar;
  }

  it('with a genuinely spare slot the jackpot still lands beside both plain yields (seed 24)', () => {
    // Seed 24 pre-verified: the hide rarity roll clears the signable floor with
    // this exact draw sequence (the rolls are inventory-independent, so this
    // arm also proves the two-free-slot arm below EARNED its jackpot).
    // Re-recorded from seed 6 after the Eastbrook camp respacing thinned the
    // zone-1 camp counts and shifted the camp-driven world-gen draw sequence.
    const { sim, internals, a } = setup(24);
    const boar = addBoarCorpse(internals);
    fillBags(sim, internals, a);
    const m = internals.players.get(a)!;
    const cap = bagCapacity(m.bags);
    m.inventory.length = cap - 3; // three free slots, no hide/meat stacks
    sim.harvestCorpse(boar.id, undefined, a);
    expect(boar.harvestClaimedBy).toBe(a);
    expect(m.inventory.length).toBeLessThanOrEqual(cap);
    expect(sim.countItem('rough_hide', a)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('game_meat', a)).toBeGreaterThanOrEqual(1);
    const specimen = m.inventory.find((s) => s.itemId === 'pristine_hide');
    expect(specimen?.instance?.signer).toBe('Alpha');
  });

  it('with exactly the reserved free slots the jackpot truncates, never the plain yield (seed 24)', () => {
    // Two free slots = exactly the pre-gate's reservation for the two plain
    // stacks. The unfixed code granted pristine_hide into the slot reserved
    // for game_meat and spilled the meat stack past capacity (17 of 16).
    const { sim, internals, a } = setup(24);
    const boar = addBoarCorpse(internals);
    fillBags(sim, internals, a);
    const m = internals.players.get(a)!;
    const cap = bagCapacity(m.bags);
    m.inventory.length = cap - 2; // exactly the two reserved plain-stack slots
    sim.harvestCorpse(boar.id, undefined, a);
    expect(boar.harvestClaimedBy).toBe(a);
    expect(m.inventory.length).toBeLessThanOrEqual(cap);
    expect(sim.countItem('rough_hide', a)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('game_meat', a)).toBeGreaterThanOrEqual(1);
    expect(m.inventory.some((s) => s.itemId === 'pristine_hide')).toBe(false);
  });
});

// #2139 companion: the filed crossing case (zero free slots, a
// partial PLAIN stack of the harvested component, a rare-plus roll on the
// specimen-less fang family) predates the grant-order fix above, so the
// first pin below is the issue's acceptance case verified against the shipped
// grant order. The rest pin the merge-aware signed guards: after
// identical-payload stacking (stage 1) a slot-full bag holding a byte-equal
// same-signer stack WITH room must keep the signature (the grant merges,
// canGrantItemInstance), and only a bag with NEITHER merge room NOR a free
// slot downgrades to the plain fallback and its gatherDowngrade notice.
describe('corpse signed-guard capacity vs merge room (#2139)', () => {
  it('no corpse tags two specimen-less harvest families together (the capacity pre-gate premise)', () => {
    // The fitsAll pre-gate reserves plain-stack room only, and a specimen-less
    // family's signed grant falls back to an UNCAPPED plain top-up when the
    // signed unit does not fit. With at most ONE specimen-less family per
    // corpse that fallback always lands inside its own reservation; a second
    // such family on one corpse could have its reservation consumed by the
    // first family's signed land and push one slot past capacity. This guard
    // makes that content shape a loud failure instead of a silent overflow.
    const specimenless = new Set(
      Object.keys(HARVEST_COMPONENT_ITEMS).filter((tag) => !(tag in HARVEST_COMPONENT_SPECIMENS)),
    );
    expect(specimenless.size).toBeGreaterThan(0);
    for (const mob of Object.values(MOBS)) {
      const tags = (mob.componentTags ?? []).filter((tag) => specimenless.has(tag));
      expect(tags.length, `${mob.id} tags ${tags.join('+')}`).toBeLessThanOrEqual(1);
    }
  });

  it('the filed crossing case: zero free slots + a partial plain stack tops up, never overflows', () => {
    // Hunted seed, the dedupe-pin idiom: probe on roomy bags proves the fang
    // roll clears the signable floor, then a FRESH same-seed world reproduces
    // the same draws (they are inventory-independent, pinned by the
    // grant-order contract above) against the issue's exact inventory shape.
    for (let seed = 1; seed <= 200; seed++) {
      const probe = setup(seed);
      probe.sim.harvestCorpse(probe.mob.id, ['fang'], probe.a);
      const pm = probe.internals.players.get(probe.a)!;
      if (!pm.inventory.some((s) => s.itemId === 'wolf_fang' && s.instance?.signer)) continue;
      const { sim, internals, a, mob } = setup(seed);
      fillBags(sim, internals, a);
      const m = internals.players.get(a)!;
      const cap = bagCapacity(m.bags);
      m.inventory[0] = { itemId: 'wolf_fang', count: 1 };
      expect(m.inventory.length).toBe(cap);
      sim.drainEvents();
      sim.harvestCorpse(mob.id, ['fang'], a);
      expect(mob.harvestClaimedBy).toBe(a);
      // The issue's acceptance: never past capacity, and the yield arrived as
      // the plain top-up (the signature truncated, the yield did not).
      expect(m.inventory.length).toBeLessThanOrEqual(cap);
      expect(m.inventory.some((s) => s.itemId === 'wolf_fang' && s.instance)).toBe(false);
      expect(sim.countItem('wolf_fang', a)).toBeGreaterThan(1);
      return;
    }
    throw new Error('no seed with a signable fang roll within 200');
  });

  it('a slot-full bag with a same-signer stack WITH room keeps the signature: the grant merges (seed 153)', () => {
    // Seed 153's fang roll clears the signable floor at tier 3 (pre-verified
    // above: harvestTierQuantity rolls a 3-unit yield). Slot 0 is the plain
    // partial stack the pre-gate reserves against (and the would-be fallback
    // target); slot 1 is the byte-equal same-signer stack whose room the
    // merge-aware guard must accept with zero free slots, and which has room
    // for the FULL rolled quantity (stackSizeOf(wolf_fang) - 3 existing is
    // far more than the 3-unit roll).
    const { sim, internals, a, mob } = setup(153);
    fillBags(sim, internals, a);
    const m = internals.players.get(a)!;
    const cap = bagCapacity(m.bags);
    m.inventory[0] = { itemId: 'wolf_fang', count: 1 };
    m.inventory[1] = { itemId: 'wolf_fang', count: 3, instance: { signer: 'Alpha' } };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    sim.harvestCorpse(mob.id, ['fang'], a);
    expect(mob.harvestClaimedBy).toBe(a);
    // The signed grant merged into the same-signer stack: no new slot, no
    // overflow, and the plain stack was never topped up. The stack absorbs the
    // whole three-unit roll (#2473) because seventeen units of merge room
    // cover it; the partial-room case is its own pin below.
    expect(m.inventory.length).toBe(cap);
    const signed = m.inventory.find((s) => s.itemId === 'wolf_fang' && s.instance);
    expect(signed?.instance?.signer).toBe('Alpha');
    expect(signed?.count).toBe(6);
    const plain = m.inventory.find((s) => s.itemId === 'wolf_fang' && !s.instance);
    expect(plain?.count).toBe(1);
    // The signature survived: no downgrade notice fires.
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toHaveLength(0);
  });

  it('a slot-full bag with the same-signer stack AT its cap still falls back plain, at the boundary (seed 2)', () => {
    // The boundary tick: the same-signer stack sits EXACTLY at stackSizeOf,
    // so it offers zero merge room and the guard must refuse, top up the
    // plain stack, and emit the mark-lost downgrade, never overflow.
    const { sim, internals, a, mob } = setup(2);
    fillBags(sim, internals, a);
    const m = internals.players.get(a)!;
    const cap = bagCapacity(m.bags);
    const stack = stackSizeOf(ITEMS.wolf_fang);
    m.inventory[0] = { itemId: 'wolf_fang', count: 1 };
    m.inventory[1] = { itemId: 'wolf_fang', count: stack, instance: { signer: 'Alpha' } };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    sim.harvestCorpse(mob.id, ['fang'], a);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(m.inventory.length).toBe(cap);
    const signed = m.inventory.find((s) => s.itemId === 'wolf_fang' && s.instance);
    expect(signed?.count).toBe(stack);
    const plain = m.inventory.find((s) => s.itemId === 'wolf_fang' && !s.instance);
    expect(plain?.count).toBeGreaterThan(1);
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toEqual([
      { type: 'gatherDowngrade', pid: a, surface: 'corpse', lost: 'mark' },
    ]);
  });

  it('a slot-full specimen jackpot merges into a same-signer specimen stack instead of truncating (seed 2)', () => {
    // The specimen arm shares the merge-aware guard: with the plain component
    // topping up its own partial stack, the jackpot's only room is the
    // byte-equal same-signer specimen stack, and it must land there signed
    // (the pre-merge contract truncated it outright, lost: 'find').
    const { sim, internals, a, mob } = setup(2);
    fillBags(sim, internals, a);
    const m = internals.players.get(a)!;
    const cap = bagCapacity(m.bags);
    m.inventory[0] = { itemId: 'rough_hide', count: 1 };
    m.inventory[1] = { itemId: 'pristine_hide', count: 2, instance: { signer: 'Alpha' } };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    sim.harvestCorpse(mob.id, ['hide'], a);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(m.inventory.length).toBe(cap);
    const specimen = m.inventory.find((s) => s.itemId === 'pristine_hide');
    expect(specimen?.instance?.signer).toBe('Alpha');
    expect(specimen?.count).toBe(3);
    // The plain component still arrived through its reserved top-up room.
    expect(sim.countItem('rough_hide', a)).toBeGreaterThan(1);
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toHaveLength(0);
  });
});

// #2473: on a specimen-less family the component ITSELF is the signed grant,
// so the signature and the yield ride one call. That call used to pass a
// hardcoded count of 1 while the downgrade fallback right beneath it granted
// the whole rolled quantity, so a rare roll was a yield LOSS and a fuller bag
// was a yield GAIN. The premium arm must never be the smaller grant: it lands
// the rolled quantity signed, or it does not land signed at all.
//
// The two rig seeds here were re-hunted (45 to 153, 63 to 104) after the
// Eastbrook camp respacing merged into this branch: world-gen draws 5 rng
// values per camp mob, so thinning the zone-1 camps shifted every seed's stream
// and seed 45's fang roll stopped clearing the signable floor. Both replacements
// reproduce the ORIGINAL rig profile exactly (a signed 3-unit fang roll, a
// signed 2-unit cloth roll, and for 104 a 2-unit signed spill beside a pending
// specimen), so every literal in this block is unchanged.
describe('a signed specimen-less grant carries its rolled quantity (#2473)', () => {
  it('draws no rng of its own: the count comes from the tier roll already taken', () => {
    // The draw pin ON the arm the change touched. The sibling cases in
    // tests/corpse_harvest_result_event.test.ts cover the plain and specimen
    // paths; a counted grant that re-rolled anything per unit would show up
    // here as more than the one tier roll plus one rarity roll.
    const { sim, a, mob } = setup(153);
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      sim.harvestCorpse(mob.id, ['fang'], a);
    } finally {
      sim.rng.setObserver(null);
    }
    // Never vacuous: this seed really does reach the multi-unit signed arm.
    expect(sim.countItem('wolf_fang', a)).toBe(3);
    expect(draws).toBe(2);
  });

  it('grants exactly the units its own downgrade fallback would, signed (seed 153, fang)', () => {
    // Same seed, same corpse, same roll: the ONLY difference between the two
    // runs is whether the bags can hold the instance. Rolling rare must not
    // cost the player units, so the two counts have to agree.
    const roomy = setup(153);
    roomy.sim.harvestCorpse(roomy.mob.id, ['fang'], roomy.a);
    const signedSlot = roomy.internals.players
      .get(roomy.a)!
      .inventory.find((s) => s.itemId === 'wolf_fang');
    // The premium arm really is the one under test: the units landed stamped.
    expect(signedSlot?.instance?.signer).toBe('Alpha');
    const signedQty = roomy.sim.countItem('wolf_fang', roomy.a);

    const full = setup(153);
    fillBags(full.sim, full.internals, full.a);
    const m = full.internals.players.get(full.a)!;
    m.inventory[0] = { itemId: 'wolf_fang', count: 1 };
    expect(m.inventory.length).toBe(bagCapacity(m.bags));
    full.sim.harvestCorpse(full.mob.id, ['fang'], full.a);
    expect(m.inventory.some((s) => s.itemId === 'wolf_fang' && s.instance)).toBe(false);
    // Minus the unit seeded into the partial stack the fallback tops up.
    const downgradedQty = full.sim.countItem('wolf_fang', full.a) - 1;

    expect(signedQty).toBe(downgradedQty);
    // Bound to the roll's own tier quantity too, so a future change that made
    // BOTH arms grant one unit could not pass the equality above alone.
    expect(downgradedQty).toBe(3);
  });

  it('grants the whole rolled quantity into ONE signed slot, never a unit per slot (seed 153)', () => {
    // A mergeable signer payload stacks (#1165), so three units are one slot,
    // not three: the counted grant must not cost the player bag space that a
    // plain grant of the same size would not.
    const { sim, internals, a, mob } = setup(153);
    const m = internals.players.get(a)!;
    const before = m.inventory.length;
    sim.drainEvents();
    sim.harvestCorpse(mob.id, ['fang'], a);
    const signed = m.inventory.filter((s) => s.itemId === 'wolf_fang');
    expect(signed).toHaveLength(1);
    expect(signed[0].count).toBe(3);
    expect(m.inventory.length).toBe(before + 1);
    // The slot's count is the ledger's count is the roll: bound to the event
    // rather than to the literal alone, so a change that moved the grant and
    // the report together could not pass by agreeing with itself.
    const result = sim
      .drainEvents()
      .find((e): e is Extract<typeof e, { type: 'harvestResult' }> => e.type === 'harvestResult');
    expect(result?.yields).toEqual([
      { itemId: 'wolf_fang', qty: signed[0].count, rarity: 'epic', kind: 'signed' },
    ]);
  });

  it('the cloth family carries its rolled quantity the same way (seed 153)', () => {
    // The second specimen-less family, so the fix is the ARM's behavior and not
    // a fang-shaped special case. Its roll is TWO where the fang above is
    // three, which is what proves the count is read off the roll.
    const { sim, internals, a } = setup(153);
    const template = MOBS.vale_bandit;
    const corpse = createMob(7775, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    sim.harvestCorpse(corpse.id, ['cloth'], a);
    const slot = internals.players.get(a)!.inventory.find((s) => s.itemId === 'homespun_cloth');
    expect(slot?.instance?.signer).toBe('Alpha');
    expect(slot?.count).toBe(2);
    // The two families really do land on different counts, so neither literal
    // can be a constant the arm hardcoded.
    const fang = setup(153);
    fang.sim.harvestCorpse(fang.mob.id, ['fang'], fang.a);
    expect(fang.sim.countItem('wolf_fang', fang.a)).not.toBe(slot?.count);
  });

  it('refuses the signature when only PART of the rolled quantity fits, never overflowing', () => {
    // The state a "grant plainQty whenever ONE copy fits" fix would break, and
    // the reason the guard counts the WHOLE quantity: zero free slots and a
    // same-signer stack with room for exactly one unit LESS than the roll. Two
    // units would merge and the third would push a fresh slot past capacity
    // (#2139), so the grant takes the plain fallback and its mark-lost toast
    // instead. The signature truncates, the yield does not: the same contract
    // the zero-merge-room boundary above follows.
    //
    // Seeded ONE short of the roll on purpose. At any looser distance a guard
    // that asked for `plainQty - 1` (or for a hardcoded 2) would refuse here
    // too and the case could not tell it from the real one; at exactly
    // plainQty - 1 that guard accepts, merges two, opens a slot, and overflows
    // the bag to 17 of 16. The accept side of the same boundary is the case
    // below.
    const { sim, internals, a, mob } = setup(153);
    fillBags(sim, internals, a);
    const m = internals.players.get(a)!;
    const cap = bagCapacity(m.bags);
    const stack = stackSizeOf(ITEMS.wolf_fang);
    m.inventory[0] = { itemId: 'wolf_fang', count: 1 };
    m.inventory[1] = { itemId: 'wolf_fang', count: stack - 2, instance: { signer: 'Alpha' } };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    sim.harvestCorpse(mob.id, ['fang'], a);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(m.inventory.length).toBe(cap);
    // Untouched: a partially-landed signed grant is not a thing.
    expect(m.inventory[1].count).toBe(stack - 2);
    // The yield still arrived WHOLE, through the plain stack's reserved room.
    expect(m.inventory[0].count).toBe(4);
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toEqual([
      { type: 'gatherDowngrade', pid: a, surface: 'corpse', lost: 'mark' },
    ]);
  });

  it('takes the signature when the merge room EXACTLY covers the roll (seed 153)', () => {
    // The accept side of the same boundary, one unit up from the case above:
    // room for exactly three against a three-unit roll. A guard that asked for
    // one unit more than the roll would refuse here and quietly cost players
    // signatures they earned, which no other case in the suite can see.
    const { sim, internals, a, mob } = setup(153);
    fillBags(sim, internals, a);
    const m = internals.players.get(a)!;
    const cap = bagCapacity(m.bags);
    const stack = stackSizeOf(ITEMS.wolf_fang);
    m.inventory[0] = { itemId: 'wolf_fang', count: 1 };
    m.inventory[1] = { itemId: 'wolf_fang', count: stack - 3, instance: { signer: 'Alpha' } };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    sim.harvestCorpse(mob.id, ['fang'], a);
    expect(m.inventory.length).toBe(cap);
    // The whole roll merged into the same-signer stack, filling it exactly.
    expect(m.inventory[1].count).toBe(stack);
    expect(m.inventory[1].instance?.signer).toBe('Alpha');
    // The plain stack was never touched: the signature took the whole yield.
    expect(m.inventory[0].count).toBe(1);
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toHaveLength(0);
  });

  it('a partial-merge spill can cost a pending specimen its slot, deliberately (seed 104)', () => {
    // The one behavior #2473 trades away, pinned so it stays a decision. With
    // partial same-signer merge room the counted grant needs a fresh slot
    // where the one-unit grant it replaced merged for free, so on a corpse
    // that procs a specimen too the last free slot goes to the component and
    // the jackpot truncates with its lost: 'find' notice. The component wins
    // that slot because its loop runs first, not because it holds a claim on
    // it: the pre-gate reserves PLAIN room, which a signed instance can never
    // spend. THIS bag has no plain fang stack, so refusing the signature would
    // route the fallback's uncapped addItem to the same slot and lose the mark
    // for nothing. The sibling case below is the other half, where refusing
    // WOULD have saved the jackpot and the trade is still taken.
    const stack = stackSizeOf(ITEMS.wolf_fang);
    const { sim, internals, a, mob } = setup(104);
    const m = internals.players.get(a)!;
    const cap = bagCapacity(m.bags);
    // Exactly ONE free slot, and a same-signer fang stack one unit short of
    // the roll, so the signed grant merges what it can and spills.
    fillBags(sim, internals, a);
    m.inventory[0] = { itemId: 'rough_hide', count: 14 };
    m.inventory[1] = { itemId: 'wolf_fang', count: stack - 1, instance: { signer: 'Alpha' } };
    m.inventory.pop();
    expect(m.inventory.length).toBe(cap - 1);
    sim.drainEvents();
    sim.harvestCorpse(mob.id, undefined, a);
    const events = sim.drainEvents();
    // The signature landed whole, across the filled stack and the free slot.
    expect(m.inventory.length).toBe(cap);
    expect(sim.countItem('wolf_fang', a)).toBe(stack - 1 + 2);
    expect(m.inventory.every((s) => s.itemId !== 'wolf_fang' || !!s.instance)).toBe(true);
    // ... and the jackpot had nowhere left to go, so it truncated and said so.
    expect(m.inventory.some((s) => s.itemId === 'pristine_hide')).toBe(false);
    expect(events.filter((e) => e.type === 'gatherDowngrade')).toEqual([
      { type: 'gatherDowngrade', pid: a, surface: 'corpse', lost: 'find' },
    ]);
  });

  it('and it costs the specimen even when a plain stack could have taken the yield', () => {
    // The refuting half of the case above, and the one the trade is actually
    // argued on: the same spill, but with a PLAIN fang stack holding room for
    // the whole roll. Refusing the signature here would have parked the yield
    // in that stack for free and left the slot to the jackpot, so this is the
    // state where holding back would genuinely have saved a Pristine Hide. It
    // is still not held back, because a rule that refuses whenever a jackpot
    // is pending costs tens of signatures for each specimen it saves. Pinning
    // the losing side too, so the trade cannot be mistaken for an oversight.
    const stack = stackSizeOf(ITEMS.wolf_fang);
    const { sim, internals, a, mob } = setup(104);
    const m = internals.players.get(a)!;
    const cap = bagCapacity(m.bags);
    fillBags(sim, internals, a);
    m.inventory[0] = { itemId: 'rough_hide', count: 14 };
    m.inventory[1] = { itemId: 'wolf_fang', count: 14 };
    m.inventory[2] = { itemId: 'wolf_fang', count: stack - 1, instance: { signer: 'Alpha' } };
    m.inventory.pop();
    expect(m.inventory.length).toBe(cap - 1);
    sim.drainEvents();
    sim.harvestCorpse(mob.id, undefined, a);
    const events = sim.drainEvents();
    // The signature took the free slot: the plain stack it could have merged
    // into on the downgrade arm is untouched.
    expect(m.inventory.length).toBe(cap);
    expect(m.inventory[1].count).toBe(14);
    expect(m.inventory[2].count).toBe(stack);
    // ... and the jackpot paid for it.
    expect(m.inventory.some((s) => s.itemId === 'pristine_hide')).toBe(false);
    expect(events.filter((e) => e.type === 'gatherDowngrade')).toEqual([
      { type: 'gatherDowngrade', pid: a, surface: 'corpse', lost: 'find' },
    ]);
  });
});

// #2474: a corpse is single-use, so the family a repeated tag names must be
// harvested ONCE however many times the frame repeats it. The pick reaches the
// sim straight off the wire (server/game.ts type-filters `components` and
// forwards it), and before the dedupe a hand-crafted ['hide','hide'] rolled,
// granted and logged the hide family twice off one claim, signed Pristine Hides
// included. Driven end to end here (rolls, grants, ledger, claim, lifecycle),
// not just at the pure boundary in tests/gathering.test.ts.
describe('a repeated component tag harvests the family once (#2474)', () => {
  // Same seed, same corpse template, one command each: the duplicated pick must
  // land the deduped pick's world, exactly.
  function harvestWith(
    templateId: string,
    components: string[],
    seed: number,
  ): { inventory: unknown; events: unknown; draws: number; claimedBy: number | null } {
    const { sim, internals, a } = setup(seed);
    const template = MOBS[templateId];
    const corpse = createMob(7774, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    sim.drainEvents();
    let draws = 0;
    const rng = (sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } }).rng;
    rng.setObserver(() => {
      draws++;
    });
    sim.harvestCorpse(corpse.id, components, a);
    rng.setObserver(null);
    return {
      inventory: structuredClone(internals.players.get(a)!.inventory),
      events: sim.drainEvents(),
      draws,
      claimedBy: corpse.harvestClaimedBy,
    };
  }

  // wild_boar tags hide/tusk/meat: three tags, so a two-entry pick stays under
  // the spread threshold and lands on the arm that used to hand the duplicate
  // straight through. old_greyjaw (hide/fang/claw) is the same arm one tag map
  // over. forest_wolf tags hide/fang: two tags, so ['hide','hide'] used to
  // clear `>= tagged.length` and spread onto fang instead.
  // `tags` is pinned per row, not just described: the arm a row exercises is
  // decided by the corpse's tag COUNT against the two-entry pick, so a content
  // retag would slide a row onto the other arm while the table still claimed to
  // cover both. Pinning the tags here is what keeps the matrix honest.
  const CASES: { templateId: string; tag: string; arm: string; tags: string[] }[] = [
    { templateId: 'wild_boar', tag: 'hide', arm: 'concentrate', tags: ['hide', 'tusk', 'meat'] },
    { templateId: 'wild_boar', tag: 'meat', arm: 'concentrate', tags: ['hide', 'tusk', 'meat'] },
    { templateId: 'old_greyjaw', tag: 'fang', arm: 'concentrate', tags: ['hide', 'fang', 'claw'] },
    { templateId: 'forest_wolf', tag: 'hide', arm: 'spread threshold', tags: ['hide', 'fang'] },
    { templateId: 'forest_wolf', tag: 'fang', arm: 'spread threshold', tags: ['hide', 'fang'] },
  ];

  it('covers both arms for real: each row is the corpse shape it claims to be', () => {
    for (const c of CASES) {
      expect(MOBS[c.templateId].componentTags, `${c.templateId} tags`).toEqual(c.tags);
      expect(c.tags, `${c.templateId} ${c.tag} is on the corpse`).toContain(c.tag);
      // A two-entry pick is under the spread threshold only while the corpse
      // carries MORE than two tags; at exactly two it clears `>= tagged.length`.
      const arm = c.tags.length > 2 ? 'concentrate' : 'spread threshold';
      expect(arm, `${c.templateId} ${c.tag} arm`).toBe(c.arm);
    }
    expect(CASES.map((c) => c.arm)).toContain('concentrate');
    expect(CASES.map((c) => c.arm)).toContain('spread threshold');
  });

  it('grants exactly what the single tag grants, on the same seed, on both arms', () => {
    for (const c of CASES) {
      for (const seed of [2, 5, 11]) {
        const label = `${c.templateId} ${c.tag} (${c.arm}) @${seed}`;
        const dup = harvestWith(c.templateId, [c.tag, c.tag], seed);
        const once = harvestWith(c.templateId, [c.tag], seed);
        // The whole observable result of the command: what landed in the bags,
        // every event it emitted (the harvestResult ledger included), and how
        // much rng it spent doing it.
        expect(dup.inventory, `${label} inventory`).toEqual(once.inventory);
        expect(dup.events, `${label} events`).toEqual(once.events);
        expect(dup.draws, `${label} draws`).toEqual(once.draws);
        // An absolute floor under that equality, so a mis-wired observer
        // reading 0 on both sides cannot pass: one mapped family costs exactly
        // one tier roll plus one rarity roll, on every row.
        expect(once.draws, `${label} single-pick draws`).toBe(2);
        // ... and the claim is still spent exactly once, by the harvester.
        expect(dup.claimedBy, `${label} claim`).toBe(once.claimedBy);
        expect(dup.claimedBy, `${label} claim is the harvester`).not.toBeNull();
      }
    }
  });

  it('never mints a second signed Pristine Hide off one claim (seed 128, the issue case)', () => {
    // The headline harm the issue reports, at the one state that actually
    // reaches it. Pre-fix, this seed rolls rare-or-better on BOTH of the
    // duplicate's rarity rolls and hands out two Pristine Hides off a
    // single-use corpse; nothing else in this suite exercises the doubled
    // SIGNED arm, which is the valuable half of the exploit (a non-fungible,
    // signer-stamped item, minted twice from one claim). Post-fix the repeat
    // lands the single tag's world exactly: no specimen, 4 hides, one claim.
    // Re-hunted from seed 11 after the Eastbrook camp respacing merged into
    // this branch and shifted the camp-driven world-gen draw sequence: seed 11
    // no longer clears the signable floor on either duplicate roll, so it no
    // longer reaches the doubled arm at all. Seed 128 does, and lands the same
    // post-fix world, so every literal below is unchanged. The doubled arm is
    // verified through ['hide','meat'] on this same corpse, which spends the
    // duplicate's exact draw positions at its exact concentration bonus (2
    // chosen of 3 tags) and comes back with BOTH specimens;
    // rollCorpseMaterialRarity is family-independent (a fixed baseline, one
    // draw), so the two rarity rolls are the duplicate's own.
    const { sim, internals, a } = setup(128);
    const template = MOBS.wild_boar;
    const corpse = createMob(7769, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    sim.harvestCorpse(corpse.id, ['hide', 'hide'], a);
    expect(sim.countItem('pristine_hide', a)).toBe(0);
    expect(sim.countItem('rough_hide', a)).toBe(4);
    // Signed instances never merge into a plain stack, so a doubled jackpot
    // would show up as instance slots, not as a bigger count.
    expect(
      internals.players.get(a)!.inventory.filter((s) => s.instance?.signer === 'Alpha'),
    ).toHaveLength(0);
  });

  it('rolls and grants the family ONE time, not once per repeat (seed 153, absolute counts)', () => {
    // The equality above would also pass if both sides were wrong together, so
    // the quantities are pinned to literals here. At this seed the deduped
    // single roll clears the signable floor, so the specimen below is the
    // ORDINARY one-family jackpot, not a doubled one: pre-fix the same command
    // rolled twice at a lower concentration bonus and came back with 8 plain
    // hides and no specimen at all. Both numbers move under a revert, which is
    // what makes them decisive. The doubled-specimen state has its own case
    // above, at the seed that actually reaches it.
    const { sim, internals, a } = setup(153);
    const template = MOBS.wild_boar;
    const corpse = createMob(7773, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    expect(template.componentTags).toEqual(['hide', 'tusk', 'meat']);
    sim.drainEvents();
    sim.harvestCorpse(corpse.id, ['hide', 'hide'], a);
    // Two draws is one family's worth (tier roll + rarity roll); four was the
    // bug. Read off the ledger the client actually prints, which carries one
    // entry per distinct granted item.
    const result = sim
      .drainEvents()
      .filter((e): e is Extract<typeof e, { type: 'harvestResult' }> => e.type === 'harvestResult');
    expect(result).toHaveLength(1);
    expect(result[0].yields.map((y) => y.itemId).sort()).toEqual(['pristine_hide', 'rough_hide']);
    // The QUANTITY on that entry, not its count: recordHarvestYield merges
    // same-item grants, so the doubled harvest also produced exactly one
    // rough_hide row, just carrying 8 instead of 4. Only the number can tell
    // the two apart.
    expect(result[0].yields.find((y) => y.itemId === 'rough_hide')?.qty).toBe(4);
    expect(sim.countItem('rough_hide', a)).toBe(4);
    expect(sim.countItem('pristine_hide', a)).toBe(1);
    const meta = internals.players.get(a)!;
    expect(meta.inventory.filter((s) => s.itemId === 'pristine_hide')).toHaveLength(1);
    // Nothing from the tags the caller never named.
    expect(sim.countItem('game_meat', a)).toBe(0);
  });

  it('a repeat cannot pull in a tag the caller never asked for (spread threshold, seed 5)', () => {
    // forest_wolf tags hide and fang, so ['hide','hide'] used to clear
    // `chosen.length >= tagged.length` and spread across BOTH families at the
    // zero concentration bonus a real two-tag pick earns. The fang line is the
    // decisive one: a dedupe that ran after the length test would still grant it.
    const { sim, mob, a } = setup(153);
    expect(MOBS.forest_wolf.componentTags).toEqual(['hide', 'fang']);
    sim.harvestCorpse(mob.id, ['hide', 'hide'], a);
    expect(sim.countItem('rough_hide', a)).toBeGreaterThan(0);
    expect(sim.countItem('wolf_fang', a)).toBe(0);
  });

  it('a repeat inside a MULTI-family pick collapses only its own family', () => {
    // The mixed case: the other tags in the same frame must still be harvested,
    // in the order they were named. wild_boar's tusk maps to no item, so hide
    // and meat are the two that land.
    const { sim, internals, a } = setup(153);
    const template = MOBS.wild_boar;
    const corpse = createMob(7772, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    sim.drainEvents();
    sim.harvestCorpse(corpse.id, ['meat', 'hide', 'meat'], a);
    const result = sim
      .drainEvents()
      .filter((e): e is Extract<typeof e, { type: 'harvestResult' }> => e.type === 'harvestResult');
    expect(result).toHaveLength(1);
    // Ledger order follows the pick's first-occurrence order, meat before hide,
    // which is also the chat-line order the player reads (#2457).
    expect(result[0].yields.map((y) => y.itemId)).toEqual(['game_meat', 'rough_hide']);
    expect(
      internals.players.get(a)!.inventory.filter((s) => s.itemId === 'game_meat'),
    ).toHaveLength(1);
  });

  it('leaves the corpse lifecycle exactly where a single-tag harvest leaves it', () => {
    // The claim is single-use whatever the frame said: the repeat spends it
    // once, the corpse is denied to everyone after, and the harvested-corpse
    // timer clamp is the same one the deduped pick produces.
    const { sim, mob, a, b } = setup(11);
    const once = setup(11);
    expect(mob.corpseTimer).toBe(9999);
    sim.harvestCorpse(mob.id, ['hide', 'hide'], a);
    once.sim.harvestCorpse(once.mob.id, ['hide'], once.a);
    expect(mob.harvestClaimedBy).toBe(a);
    // Literals, not only the twin comparison: two runs of the same post-fix
    // path move together, so an equality alone cannot fail. This corpse carries
    // no loot, so the harvest takes the collapse arm and clamps the timer to 4.
    expect(mob.corpseTimer).toBe(4);
    expect(mob.corpseTimer).toBe(once.mob.corpseTimer);
    // `lootable` is pinned against the arm that decides it rather than against
    // the twin: this corpse has no loot, so it takes the collapse arm and ends
    // false. Compared to the twin alone the line would hold even if the command
    // never ran, since a createMob corpse starts out unlootable.
    expect(mob.loot).toBeNull();
    expect(mob.lootable).toBe(false);
    expect(mob.lootable).toBe(once.mob.lootable);
    // A second command, repeated tag or not, is denied against the same corpse.
    sim.harvestCorpse(mob.id, ['hide', 'hide'], b);
    expect(mob.harvestClaimedBy).toBe(a);
  });

  it('reserves ONE family of stack room, so a repeat no longer over-reserves the gate', () => {
    // The boundary this fix actually MOVES, and the reason the pre-claim gate
    // and the roll have to agree: the gate reserves the most a component can
    // roll, so the duplicated pick used to ask for two families' worth (12
    // rough_hide, 2 x the legendary tier quantity) where one was ever granted.
    // A bag holding room for exactly one family therefore refused the repeat
    // outright while accepting the identical single-tag pick. Both now behave
    // the same, which is the whole contract.
    const stack = stackSizeOf(ITEMS.rough_hide);
    const rig = (components: string[]) => {
      const { sim, internals, a } = setup(153);
      const template = MOBS.wild_boar;
      const corpse = createMob(7771, template, template.maxLevel, { x: 0, y: 0, z: 0 });
      corpse.dead = true;
      corpse.aiState = 'dead';
      corpse.corpseTimer = 9999;
      corpse.respawnTimer = 9999;
      internals.entities.set(corpse.id, corpse);
      const m = internals.players.get(a)!;
      fillBags(sim, internals, a);
      // Zero free slots, and stack room for exactly one family's top roll.
      m.inventory[0] = { itemId: 'rough_hide', count: stack - 6 };
      let draws = 0;
      const rng = (sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } })
        .rng;
      rng.setObserver(() => {
        draws++;
      });
      sim.harvestCorpse(corpse.id, components, a);
      rng.setObserver(null);
      return {
        claimedBy: corpse.harvestClaimedBy,
        hides: sim.countItem('rough_hide', a),
        draws,
      };
    };
    const dup = rig(['hide', 'hide']);
    const once = rig(['hide']);
    // The single pick has always fit here, so this is the decisive half: the
    // repeat has to reach the same harvested state, not the refusal it used to
    // get. Absolute values, not just equality, so both sides cannot be wrong.
    expect(once.claimedBy).not.toBeNull();
    expect(once.draws).toBe(2);
    expect(dup.claimedBy).toBe(once.claimedBy);
    expect(dup.draws).toBe(once.draws);
    expect(dup.hides).toBe(once.hides);
    expect(dup.hides).toBe(stack - 6 + 4);
  });

  it('draws NO rng when refused, on every refusal arm, repeat or not', () => {
    // A refused command must not shift the world's draw order for everyone
    // else. Both source comments state that as a hard determinism contract and
    // nothing pinned it, and this change is what moved the gate that decides
    // one of these arms, so it is pinned here across all five.
    const refusals: {
      label: string;
      arrange: (rig: ReturnType<typeof setup>) => number;
    }[] = [
      {
        label: 'full bags (the pre-claim capacity gate)',
        arrange: ({ sim, internals, a, mob }) => {
          fillBags(sim, internals, a);
          return mob.id;
        },
      },
      {
        label: 'too far away',
        arrange: ({ internals, a, mob }) => {
          internals.entities.get(a)!.pos = { x: 500, y: 0, z: 0 };
          return mob.id;
        },
      },
      {
        label: 'the corpse is already claimed',
        arrange: ({ mob, b }) => {
          mob.harvestClaimedBy = b;
          return mob.id;
        },
      },
      {
        label: 'the harvester is dead',
        arrange: ({ internals, a, mob }) => {
          internals.entities.get(a)!.dead = true;
          return mob.id;
        },
      },
      {
        label: 'the corpse carries no component tags',
        arrange: ({ internals }) => {
          const template = MOBS.warlock_imp;
          const corpse = createMob(7770, template, template.maxLevel, { x: 0, y: 0, z: 0 });
          corpse.dead = true;
          corpse.aiState = 'dead';
          corpse.corpseTimer = 9999;
          corpse.respawnTimer = 9999;
          internals.entities.set(corpse.id, corpse);
          return corpse.id;
        },
      },
      {
        // The same early return reached the other way (#2513): the corpse
        // carries tags, but every one of them is unmapped, so
        // isHarvestableCorpse answers false and the command is refused before
        // the claim. Pre-#2513 this arm did not exist: it drew a tier roll per
        // effective family and spent the claim.
        label: 'the corpse carries only unmapped component families',
        arrange: ({ internals }) => {
          const template = MOBS.fen_troll;
          const corpse = createMob(7771, template, template.maxLevel, { x: 0, y: 0, z: 0 });
          corpse.dead = true;
          corpse.aiState = 'dead';
          corpse.corpseTimer = 9999;
          corpse.respawnTimer = 9999;
          internals.entities.set(corpse.id, corpse);
          return corpse.id;
        },
      },
      {
        // The seventh early return, and the only one that refuses SILENTLY (no
        // error text): the target is not a dead mob. "Every arm" has to mean
        // every arm, so the live mob and the unknown id are both here.
        label: 'the target mob is still alive',
        arrange: ({ mob }) => {
          mob.dead = false;
          mob.aiState = 'idle';
          return mob.id;
        },
      },
      {
        label: 'the target id is not an entity at all',
        arrange: () => 4242,
      },
    ];
    for (const arm of refusals) {
      for (const components of [['hide', 'hide'], ['hide']]) {
        const rig = setup(153);
        const mobId = arm.arrange(rig);
        let draws = 0;
        const rng = (
          rig.sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } }
        ).rng;
        rng.setObserver(() => {
          draws++;
        });
        rig.sim.harvestCorpse(mobId, components, rig.a);
        rng.setObserver(null);
        const label = `${arm.label} ${JSON.stringify(components)}`;
        expect(draws, `${label} draws`).toBe(0);
        expect(rig.sim.countItem('rough_hide', rig.a), `${label} yield`).toBe(0);
      }
    }
  });
});

// #2504: an entry naming no tag on the corpse is dropped before either length
// test, so it can no longer pad the pick past the `>= taggedComponents.length`
// spread threshold. Pre-fix, ['hide','junk'] on a two-tag corpse harvested BOTH
// families at bonus 0 (a family the caller never named), byte-identical to the
// empty pick; ['hide'] concentrated on hide. Same class as #2474 one step over.
describe('an invalid component tag is ignored entirely (#2504)', () => {
  // Same seed, same corpse template, one command each: the padded pick must
  // land the stripped pick's world, exactly.
  function harvestWith(
    templateId: string,
    components: string[],
    seed: number,
  ): { inventory: unknown; events: unknown; draws: number; claimedBy: number | null } {
    const { sim, internals, a } = setup(seed);
    const template = MOBS[templateId];
    const corpse = createMob(7754, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    sim.drainEvents();
    let draws = 0;
    const rng = (sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } }).rng;
    rng.setObserver(() => {
      draws++;
    });
    sim.harvestCorpse(corpse.id, components, a);
    rng.setObserver(null);
    return {
      inventory: structuredClone(internals.players.get(a)!.inventory),
      events: sim.drainEvents(),
      draws,
      claimedBy: corpse.harvestClaimedBy,
    };
  }

  // Which ARM a row exercises is decided by the deduped pick's raw length
  // against the corpse's tag COUNT, not by the template: at or above the count
  // the junk used to flip the whole command to spread, below it the junk was
  // already dropped by the old filter. Both are here, at two different widths,
  // and `tags` is pinned per row so a content retag cannot slide a row onto the
  // other arm while the table still claims to cover both.
  // `absent` is the item id of every family the pick did NOT name, so a row can
  // assert the harm directly (a spread grants them). Two rows have an empty
  // `absent` because the only family they leave out (claw, tusk) maps to no
  // item at all; for those, `spreadDraws` is what separates the arms, and the
  // test below pins it live rather than trusting the label.
  const CASES: {
    templateId: string;
    padded: string[];
    stripped: string[];
    tags: string[];
    arm: string;
    draws: number;
    spreadDraws: number;
    absent: string[];
  }[] = [
    {
      templateId: 'forest_wolf',
      padded: ['hide', 'junk'],
      stripped: ['hide'],
      tags: ['hide', 'fang'],
      arm: 'padded past the threshold',
      draws: 2,
      spreadDraws: 4,
      absent: ['wolf_fang'],
    },
    {
      templateId: 'old_greyjaw',
      padded: ['hide', 'fang', 'junk'],
      stripped: ['hide', 'fang'],
      tags: ['hide', 'fang', 'claw'],
      arm: 'padded past the threshold',
      draws: 4,
      spreadDraws: 5,
      absent: [],
    },
    {
      templateId: 'wild_boar',
      padded: ['meat', 'junk', 'hide'],
      stripped: ['meat', 'hide'],
      tags: ['hide', 'tusk', 'meat'],
      arm: 'padded past the threshold',
      draws: 4,
      spreadDraws: 5,
      absent: [],
    },
    {
      templateId: 'wild_boar',
      padded: ['hide', 'junk'],
      stripped: ['hide'],
      tags: ['hide', 'tusk', 'meat'],
      arm: 'under the threshold',
      draws: 2,
      spreadDraws: 5,
      absent: ['game_meat'],
    },
  ];

  it('covers both arms for real: each row is the corpse shape it claims to be', () => {
    for (const c of CASES) {
      expect(MOBS[c.templateId].componentTags, `${c.templateId} tags`).toEqual(c.tags);
      for (const tag of c.stripped) {
        expect(c.tags, `${c.templateId} ${tag} is on the corpse`).toContain(tag);
      }
      for (const tag of c.padded.filter((t) => !c.stripped.includes(t))) {
        expect(c.tags, `${c.templateId} ${tag} is NOT on the corpse`).not.toContain(tag);
      }
      // The pre-#2504 test: the RAW deduped count, junk included, against the
      // corpse's tag count.
      const arm =
        new Set(c.padded).size >= c.tags.length
          ? 'padded past the threshold'
          : 'under the threshold';
      expect(arm, `${c.templateId} ${JSON.stringify(c.padded)} arm`).toBe(c.arm);
      // Every `absent` id really is a family the pick leaves out, and really is
      // mapped to an item (an unmapped one could never show up in a count, so
      // asserting its absence would prove nothing).
      for (const itemId of c.absent) {
        const family = Object.keys(HARVEST_COMPONENT_ITEMS).find(
          (k) => HARVEST_COMPONENT_ITEMS[k] === itemId,
        );
        expect(family, `${itemId} maps to a family`).toBeDefined();
        expect(c.tags, `${c.templateId} ${family} is on the corpse`).toContain(family);
        expect(c.stripped, `${c.templateId} ${family} is not named`).not.toContain(family);
      }
      // And the spread really does cost a different number of draws than the
      // junk-free pick, live off the same corpse, so the per-row `draws` literal
      // in the next test is a decisive arm separator and not a coincidence.
      // This is what carries the two rows whose left-out family maps to no item.
      expect(harvestWith(c.templateId, [], 5).draws, `${c.templateId} spread draws`).toBe(
        c.spreadDraws,
      );
      expect(c.draws, `${c.templateId} concentrate vs spread`).not.toBe(c.spreadDraws);
    }
    expect(CASES.map((c) => c.arm)).toContain('padded past the threshold');
    expect(CASES.map((c) => c.arm)).toContain('under the threshold');
  });

  it('grants exactly what the junk-free pick grants, on the same seed, on both arms', () => {
    for (const c of CASES) {
      for (const seed of [2, 5, 11]) {
        const label = `${c.templateId} ${JSON.stringify(c.padded)} (${c.arm}) @${seed}`;
        const padded = harvestWith(c.templateId, c.padded, seed);
        const stripped = harvestWith(c.templateId, c.stripped, seed);
        // The whole observable result of the command: what landed in the bags,
        // every event it emitted (the harvestResult ledger included), and how
        // much rng it spent doing it.
        expect(padded.inventory, `${label} inventory`).toEqual(stripped.inventory);
        expect(padded.events, `${label} events`).toEqual(stripped.events);
        expect(padded.draws, `${label} draws`).toEqual(stripped.draws);
        // An absolute floor under that equality, per row, so a mis-wired
        // observer reading 0 on both sides cannot pass: one mapped family costs
        // one tier roll plus one rarity roll.
        expect(stripped.draws, `${label} junk-free draws`).toBe(c.draws);
        // ... and the claim is still spent exactly once, by the harvester.
        expect(padded.claimedBy, `${label} claim`).toBe(stripped.claimedBy);
        expect(padded.claimedBy, `${label} claim is the harvester`).not.toBeNull();
        // The harm, stated absolutely per row rather than only as an equality:
        // a family the caller never named is not in the bags at all. A spread
        // would put it there, which is precisely what the junk used to buy.
        const inv = padded.inventory as { itemId: string; count: number }[];
        for (const itemId of c.absent) {
          expect(
            inv.filter((s) => s.itemId === itemId).reduce((n, s) => n + s.count, 0),
            `${label} ${itemId} never named`,
          ).toBe(0);
        }
      }
    }
  });

  it('the issue case in absolute counts: junk no longer buys a family never named', () => {
    // The reproduction the issue files, on the corpse it files it against.
    // Pre-fix this command came back with 2 rough_hide and 4 wolf_fang off 4
    // draws, byte-identical to the empty pick; the fang line is the harm (a
    // family the caller never named) and the specimen line is the cost (the
    // concentration bonus a one-family pick earns, spent on spreading instead).
    const { sim, internals, a } = setup(153);
    expect(MOBS.forest_wolf.componentTags).toEqual(['hide', 'fang']);
    const corpse = createMob(7753, MOBS.forest_wolf, MOBS.forest_wolf.maxLevel, {
      x: 0,
      y: 0,
      z: 0,
    });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    sim.drainEvents();
    let draws = 0;
    const rng = (sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } }).rng;
    rng.setObserver(() => {
      draws++;
    });
    sim.harvestCorpse(corpse.id, ['hide', 'junk'], a);
    rng.setObserver(null);
    expect(sim.countItem('rough_hide', a)).toBe(3);
    expect(sim.countItem('wolf_fang', a)).toBe(0);
    expect(sim.countItem('pristine_hide', a)).toBe(1);
    expect(draws).toBe(2);
    // Read off the ledger the client actually prints, too: the junk string
    // reaches no grant of its own and leaves no entry behind.
    const result = sim
      .drainEvents()
      .filter((e): e is Extract<typeof e, { type: 'harvestResult' }> => e.type === 'harvestResult');
    expect(result).toHaveLength(1);
    expect(result[0].yields.map((y) => y.itemId).sort()).toEqual(['pristine_hide', 'rough_hide']);
    expect(result[0].yields.find((y) => y.itemId === 'rough_hide')?.qty).toBe(3);
  });

  it('an ALL-junk pick spreads, exactly as the empty pick does (the settled ruling)', () => {
    // The ordering consequence the issue asked to settle: with the filter ahead
    // of the length tests, a pick naming nothing on the corpse reaches the
    // `length === 0` arm. Ruled for spreading. Pre-fix this command spent the
    // claim and granted NOTHING, which is the outcome being retired.
    for (const templateId of ['forest_wolf', 'wild_boar']) {
      for (const seed of [2, 5, 11]) {
        for (const pick of [['junk'], ['junk', 'zzz'], ['junk', 'zzz', 'qqq']]) {
          const label = `${templateId} ${JSON.stringify(pick)} @${seed}`;
          const junk = harvestWith(templateId, pick, seed);
          const empty = harvestWith(templateId, [], seed);
          expect(junk.inventory, `${label} inventory`).toEqual(empty.inventory);
          expect(junk.events, `${label} events`).toEqual(empty.events);
          expect(junk.draws, `${label} draws`).toEqual(empty.draws);
          expect(junk.claimedBy, `${label} claim`).toBe(empty.claimedBy);
        }
      }
    }
    // Absolutes under the equality, so two identically-empty harvests cannot
    // pass it: the wolf spread costs 4 draws (two mapped families, a tier roll
    // and a rarity roll each) and really lands both families. Pre-fix the same
    // command drew 0 and granted 0.
    const junk = harvestWith('forest_wolf', ['junk'], 5);
    expect(junk.draws).toBe(4);
    expect(junk.claimedBy).not.toBeNull();
    const inv = junk.inventory as { itemId: string; count: number }[];
    expect(inv.filter((s) => s.itemId === 'rough_hide').reduce((n, s) => n + s.count, 0)).toBe(3);
    expect(inv.filter((s) => s.itemId === 'wolf_fang').reduce((n, s) => n + s.count, 0)).toBe(1);
  });

  const HIDE_STACK = stackSizeOf(ITEMS.rough_hide);
  // What the pre-claim gate reserves per component: the most one can roll,
  // harvestTierQuantity('legendary'). A literal, because WHERE that boundary
  // sits is the whole subject of the two tests below; a rig that only ever
  // proves "something fit" would pass on a gate reserving 3, or 1, or nothing.
  const RESERVED_PER_FAMILY = 6;

  // One rig for both capacity tests: zero free SLOTS, and a rough_hide stack
  // with exactly `room` units of headroom. That is the only bag shape where
  // "reserves one family" and "reserves the whole spread" can be told apart,
  // since a second family (wolf_fang) needs a free slot and there is none.
  const gateRig = (components: string[], room: number) => {
    const { sim, internals, a, mob } = setup(153);
    const m = internals.players.get(a)!;
    fillBags(sim, internals, a);
    m.inventory[0] = { itemId: 'rough_hide', count: HIDE_STACK - room };
    sim.drainEvents();
    let draws = 0;
    const rng = (sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } }).rng;
    rng.setObserver(() => {
      draws++;
    });
    sim.harvestCorpse(mob.id, components, a);
    rng.setObserver(null);
    return {
      claimedBy: mob.harvestClaimedBy,
      hides: sim.countItem('rough_hide', a),
      fangs: sim.countItem('wolf_fang', a),
      draws,
      errors: sim
        .drainEvents()
        .filter((e): e is Extract<typeof e, { type: 'error' }> => e.type === 'error')
        .map((e) => e.text),
    };
  };

  it('the pre-claim capacity gate reserves the junk-free pick, not the padded one', () => {
    // The gate and the roll read the same helper, so they move together for
    // free, but the boundary they share MOVES here and only a bag sized between
    // the old and new reservations can see it. Pre-fix ['hide','junk'] asked
    // for two families' worth on a two-tag corpse, so a bag with room for
    // exactly one REFUSED it while accepting the identical ['hide'].
    const padded = gateRig(['hide', 'junk'], RESERVED_PER_FAMILY);
    const stripped = gateRig(['hide'], RESERVED_PER_FAMILY);
    // The single pick has always fit here, so this is the decisive half: the
    // padded pick has to reach the same harvested state, not the refusal it
    // used to get. Absolute values, not just equality, so both sides cannot be
    // wrong together.
    expect(stripped.claimedBy).not.toBeNull();
    expect(stripped.draws).toBe(2);
    expect(stripped.errors).toEqual([]);
    expect(padded.claimedBy).toBe(stripped.claimedBy);
    expect(padded.draws).toBe(stripped.draws);
    expect(padded.hides).toBe(stripped.hides);
    expect(padded.hides).toBe(HIDE_STACK - RESERVED_PER_FAMILY + 3);
    expect(padded.errors).toEqual([]);
    // ONE unit less of room refuses both, which is what pins the reservation to
    // 6 rather than merely "an amount that happened to fit". Without this half
    // the accept side above would also pass a sanitize that dropped the VALID
    // tag along with the junk and so reserved nothing at all.
    const tightPadded = gateRig(['hide', 'junk'], RESERVED_PER_FAMILY - 1);
    const tightStripped = gateRig(['hide'], RESERVED_PER_FAMILY - 1);
    expect(tightStripped.claimedBy).toBeNull();
    expect(tightStripped.draws).toBe(0);
    expect(tightStripped.errors).toEqual(['Your bags are full.']);
    expect(tightPadded.claimedBy).toBeNull();
    expect(tightPadded.draws).toBe(0);
    expect(tightPadded.errors).toEqual(['Your bags are full.']);
    expect(tightPadded.hides).toBe(HIDE_STACK - RESERVED_PER_FAMILY + 1);
  });

  it('...and an all-junk pick reserves the whole SPREAD, not one family', () => {
    // The other side of the same moved boundary, and the one that changes a
    // REFUSAL rather than a grant. Run at the bag shape that can actually tell
    // the two reservations apart: room for exactly ONE family. A gate that
    // reserved one family for an all-junk pick would ACCEPT here, because
    // ['hide'] does on the identical rig (the discriminator line below); the
    // spread additionally needs a free slot for wolf_fang and there is none.
    // A totally full bag would refuse under either reservation and prove
    // nothing.
    const junk = gateRig(['junk'], RESERVED_PER_FAMILY);
    const oneFamily = gateRig(['hide'], RESERVED_PER_FAMILY);
    expect(oneFamily.claimedBy).not.toBeNull();
    expect(oneFamily.draws).toBe(2);
    expect(junk.claimedBy).toBeNull();
    expect(junk.draws).toBe(0);
    expect(junk.hides).toBe(HIDE_STACK - RESERVED_PER_FAMILY);
    expect(junk.fangs).toBe(0);
    expect(junk.errors).toEqual(['Your bags are full.']);
    // Same world as the empty pick, refusal included: an all-junk pick IS the
    // empty pick. Pre-fix it reserved nothing, sailed through the gate, and
    // spent the single-use claim for zero yield.
    const empty = gateRig([], RESERVED_PER_FAMILY);
    expect(junk.claimedBy).toBe(empty.claimedBy);
    expect(junk.errors).toEqual(empty.errors);
    expect(junk.draws).toBe(empty.draws);
  });

  it('draws NO rng when refused, on every refusal arm, junk in the pick or not', () => {
    // The determinism contract the issue names last: a refused command must not
    // shift the world's draw order for everyone else. This change moved what
    // the capacity gate reserves, which is one of these arms, so every arm is
    // re-run with a junk-bearing pick and with an all-junk pick.
    // Zero draws alone does NOT establish a refusal, which is exactly the trap
    // this fix closes: pre-fix, the full-bags arm with an all-junk pick was not
    // refused at all. It reserved nothing, passed the gate, SPENT the single-use
    // claim, granted nothing, emitted no harvestResult (that event is gated on
    // `granted.length > 0`) and clamped corpseTimer to 4, all while drawing zero
    // rng and yielding zero items. So every arm also pins the claim and the
    // corpse timer: an unspent claim on an untouched corpse is what "refused"
    // actually means here.
    const refusals: {
      label: string;
      arrange: (rig: ReturnType<typeof setup>) => number;
      // The pid that issues the command; defaults to the rig's player A.
      pid?: (rig: ReturnType<typeof setup>) => number;
      // Who owns the claim afterwards. Null everywhere except the arm that is
      // refused BECAUSE someone else already holds it.
      claimAfter?: (rig: ReturnType<typeof setup>) => number | null;
      // Overrides the shared junk picks for an arm the junk picks cannot reach.
      picks?: string[][];
    }[] = [
      {
        label: 'full bags (the pre-claim capacity gate)',
        arrange: ({ sim, internals, a, mob }) => {
          fillBags(sim, internals, a);
          return mob.id;
        },
      },
      {
        label: 'too far away',
        arrange: ({ internals, a, mob }) => {
          internals.entities.get(a)!.pos = { x: 500, y: 0, z: 0 };
          return mob.id;
        },
      },
      {
        label: 'the corpse is already claimed',
        arrange: ({ mob, b }) => {
          mob.harvestClaimedBy = b;
          return mob.id;
        },
        claimAfter: ({ b }) => b,
      },
      {
        label: 'the harvester is dead',
        arrange: ({ internals, a, mob }) => {
          internals.entities.get(a)!.dead = true;
          return mob.id;
        },
      },
      {
        label: 'the corpse carries no component tags',
        arrange: ({ internals }) => {
          const template = MOBS.warlock_imp;
          const corpse = createMob(7752, template, template.maxLevel, { x: 0, y: 0, z: 0 });
          corpse.dead = true;
          corpse.aiState = 'dead';
          corpse.corpseTimer = 9999;
          corpse.respawnTimer = 9999;
          internals.entities.set(corpse.id, corpse);
          return corpse.id;
        },
      },
      {
        label: 'the target mob is still alive',
        arrange: ({ mob }) => {
          mob.dead = false;
          mob.aiState = 'idle';
          return mob.id;
        },
      },
      {
        label: 'the target id is not an entity at all',
        arrange: () => 4242,
      },
      {
        // The two early returns the #2474 sweep this is modelled on left out.
        // "Every arm" has to mean every arm, so the non-mob entity and the
        // unresolvable caller are both here.
        label: 'the target id is an entity but not a mob',
        arrange: ({ a }) => a,
      },
      {
        label: 'the acting pid resolves to no player',
        arrange: ({ mob }) => mob.id,
        pid: () => 987654,
      },
      {
        // #2509's arm, added here so "every arm" keeps meaning every arm. It
        // needs its own picks and its own corpse: forest_wolf carries no
        // unmapped family, so the shared junk picks below cannot reach it.
        label: 'the pick names only families with no item behind them (#2509)',
        arrange: ({ internals }) => {
          const template = MOBS.old_greyjaw;
          const corpse = createMob(7753, template, template.maxLevel, { x: 0, y: 0, z: 0 });
          corpse.dead = true;
          corpse.aiState = 'dead';
          corpse.corpseTimer = 9999;
          corpse.respawnTimer = 9999;
          internals.entities.set(corpse.id, corpse);
          return corpse.id;
        },
        picks: [['claw'], ['claw', 'junk']],
      },
      {
        // #2513's arm, the corpse-level twin of the one above. The picks are
        // deliberately the ones that used to SUCCEED here: an omitted-equivalent
        // full cover, a single unmapped family, and junk beside it. Every one of
        // them spent the claim pre-fix.
        label: 'the corpse carries only unmapped component families (#2513)',
        arrange: ({ internals }) => {
          const template = MOBS.fen_troll;
          const corpse = createMob(7755, template, template.maxLevel, { x: 0, y: 0, z: 0 });
          corpse.dead = true;
          corpse.aiState = 'dead';
          corpse.corpseTimer = 9999;
          corpse.respawnTimer = 9999;
          internals.entities.set(corpse.id, corpse);
          return corpse.id;
        },
        picks: [['claw', 'tusk'], ['tusk'], ['tusk', 'junk'], ['junk'], []],
      },
    ];
    for (const arm of refusals) {
      for (const components of arm.picks ?? [['hide', 'junk'], ['junk'], ['junk', 'zzz']]) {
        const rig = setup(153);
        const mobId = arm.arrange(rig);
        let draws = 0;
        const rng = (
          rig.sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } }
        ).rng;
        rng.setObserver(() => {
          draws++;
        });
        rig.sim.harvestCorpse(mobId, components, arm.pid ? arm.pid(rig) : rig.a);
        rng.setObserver(null);
        const label = `${arm.label} ${JSON.stringify(components)}`;
        expect(draws, `${label} draws`).toBe(0);
        expect(rig.sim.countItem('rough_hide', rig.a), `${label} yield`).toBe(0);
        expect(rig.sim.countItem('wolf_fang', rig.a), `${label} fang yield`).toBe(0);
        // The lines that make "refused" mean something: the claim is not spent
        // and the corpse is left exactly as it was found, so the next harvester
        // can still take it. Skipped only where the target is not a corpse at
        // all (no entity, or a player entity), which have nothing to assert.
        const target = rig.internals.entities.get(mobId);
        if (target?.kind === 'mob') {
          expect(target.harvestClaimedBy, `${label} claim`).toBe(
            arm.claimAfter ? arm.claimAfter(rig) : null,
          );
          expect(target.corpseTimer, `${label} corpse timer`).toBe(9999);
        }
      }
    }
    // Positive control for the observer itself: every expectation above is
    // zero, so a mis-wired setObserver would make the whole sweep vacuous. The
    // SAME wiring on an accepted command has to read a nonzero count, and the
    // accepted command has to actually land (claim spent, corpse consumed).
    const ok = setup(153);
    let okDraws = 0;
    const okRng = (ok.sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } })
      .rng;
    okRng.setObserver(() => {
      okDraws++;
    });
    ok.sim.harvestCorpse(ok.mob.id, ['hide', 'junk'], ok.a);
    okRng.setObserver(null);
    expect(okDraws).toBe(2);
    expect(ok.mob.harvestClaimedBy).toBe(ok.a);
    expect(ok.mob.corpseTimer).not.toBe(9999);
  });
});

// Corpse premium-arm tool gating (Professions 2.0): the plain
// component grant is NEVER gated (the bare-hands floor); only the
// signed/specimen upgrade of a signable rarity roll checks the best owned
// gathering tool of ANY profession against MONSTER_MATERIAL_TIERS. Every
// wave-one family ships at tier 1, so the deny arm is unreachable through
// shipped content; the mutation seam below is documented on the test.
describe('corpse premium-arm tool gating (Professions 2.0)', () => {
  // A ONE-player rig (distinct from setup()'s two players): the deny/dedupe
  // seeds below were hunted against exactly this construction order, and the
  // second addPlayer would shift the world's draw positions.
  function soloRig(seed: number, templateId = 'forest_wolf') {
    const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
    const internals = sim as unknown as SimInternals;
    const a = sim.addPlayer('warrior', 'Alpha');
    sim.tick();
    const e = internals.entities.get(a)!;
    e.pos = { x: 0, y: 0, z: 0 };
    e.prevPos = { x: 0, y: 0, z: 0 };
    const template = MOBS[templateId];
    const mob = createMob(9999, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    internals.entities.set(mob.id, mob);
    return { sim, internals, a, mob };
  }

  // MONSTER_MATERIAL_TIERS is typed Readonly but is a plain runtime object,
  // and interaction.ts resolves monsterMaterialTierFor inline (no injectable
  // seam), so raising one family's tier here, restored in finally, is the
  // narrowest honest way to drive the REAL deny arm rather than pin a
  // re-implementation. Restored before any assertion runs.
  function withTier(component: string, tier: number, body: () => void): void {
    const tiers = MONSTER_MATERIAL_TIERS as Record<string, number>;
    const prior = tiers[component];
    tiers[component] = tier;
    try {
      body();
    } finally {
      // A future component absent from the table must restore to ABSENT, not
      // to a present-but-undefined key (which would surprise the literal set
      // pin below and any Object.keys comparison).
      if (prior === undefined) delete tiers[component];
      else tiers[component] = prior;
    }
  }

  it('lists every harvest component family literally, all at tier 1 (the wave-one prime directive)', () => {
    // LITERAL set equality, never derived from HARVEST_COMPONENT_ITEMS alone:
    // a future higher-tier corpse family must consciously re-pin this.
    expect(MONSTER_MATERIAL_TIERS).toEqual({
      hide: 1,
      fang: 1,
      silk: 1,
      venomSac: 1,
      meat: 1,
      cloth: 1,
    });
    expect(Object.keys(MONSTER_MATERIAL_TIERS).sort()).toEqual(
      Object.keys(HARVEST_COMPONENT_ITEMS).sort(),
    );
    expect(monsterMaterialTierFor('hide')).toBe(1);
    // An unlisted (future) component defaults to the bare-hands floor: never gated.
    expect(monsterMaterialTierFor('no_such_component')).toBe(1);
  });

  it('the pure deny decision: bare hands (tier 1) cannot cover a tier-2 material, tier 2 can', () => {
    expect(canHarvestMonsterMaterial(1, 2)).toBe(false);
    expect(canHarvestMonsterMaterial(2, 2)).toBe(true);
  });

  it('bare hands still earn the signed specimen on real content: tier-1 families never gate (seed 2)', () => {
    const { sim, internals, a, mob } = setup(2);
    const meta = internals.players.get(a)!;
    // Genuinely bare-handed: the starting kit resolves to the tier-1 floor.
    expect(bestOwnedAnyGatherToolTier(meta.inventory, ITEMS)).toBe(1);
    sim.drainEvents();
    sim.harvestCorpse(mob.id, ['hide'], a);
    expect(sim.drainEvents().some((e) => e.type === 'gatherDenied')).toBe(false);
    const specimen = meta.inventory.find((s) => s.itemId === 'pristine_hide');
    expect(specimen?.instance?.signer).toBe('Alpha');
    expect(sim.countItem('rough_hide', a)).toBeGreaterThanOrEqual(1);
  });

  it('a denied premium pull downgrades to the plain grant: same qty, same claim, same draws (seed 4)', () => {
    // Baseline arm, unmutated: seed 4's rarity roll clears the signable floor,
    // so the specimen jackpot lands beside the plain component. Re-recorded
    // from seed 45 after the Eastbrook camp respacing thinned the zone-1 camp
    // counts and shifted the camp-driven world-gen draw sequence.
    const base = soloRig(4);
    let baseDraws = 0;
    base.sim.rng.setObserver(() => baseDraws++);
    try {
      base.sim.harvestCorpse(base.mob.id, ['hide'], base.a);
    } finally {
      base.sim.rng.setObserver(null);
    }
    const basePlain = base.sim.countItem('rough_hide', base.a);
    expect(basePlain).toBe(3);
    expect(base.sim.countItem('pristine_hide', base.a)).toBe(1);

    // Denied arm: hide raised to tier 2, same seed, same rig, same draws.
    const { sim, internals, a, mob } = soloRig(4);
    sim.drainEvents();
    let draws = 0;
    withTier('hide', 2, () => {
      sim.rng.setObserver(() => draws++);
      try {
        sim.harvestCorpse(mob.id, ['hide'], a);
      } finally {
        sim.rng.setObserver(null);
      }
    });
    // Draw-order invariant: the rarity roll is STILL consumed on a denied
    // pull (the denial sits strictly after the roll and draws nothing).
    expect(baseDraws).toBe(2);
    expect(draws).toBe(2);
    // Claim outcome identical: the corpse is spent either way.
    expect(mob.harvestClaimedBy).toBe(a);
    // The yield downgrades to the plain fungible grant: same quantity, no
    // jackpot, no signed instance anywhere.
    expect(sim.countItem('rough_hide', a)).toBe(basePlain);
    expect(sim.countItem('pristine_hide', a)).toBe(0);
    const meta = internals.players.get(a)!;
    expect(meta.inventory.some((s) => s.itemId === 'rough_hide' && s.instance)).toBe(false);
    // Event shape pin: surface corpse carries NO professionId (the contract:
    // professionId is present exactly when surface === 'node').
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      { type: 'gatherDenied', pid: a, surface: 'corpse', requiredTier: 2 },
    ]);
  });

  it('an owned tier-2 tool restores the premium pull at a raised family tier (seed 4)', () => {
    // The canHarvestMonsterMaterial SUCCESS branch with a real tool: the
    // deny/downgrade arms above never prove a tool actually re-opens the
    // premium pull once a family tier rises.
    const { sim, internals, a, mob } = soloRig(4);
    sim.addItem('mithril_mining_pick', 1, a); // any-profession owned-best covers tier 2
    sim.drainEvents();
    let draws = 0;
    withTier('hide', 2, () => {
      sim.rng.setObserver(() => draws++);
      try {
        sim.harvestCorpse(mob.id, ['hide'], a);
      } finally {
        sim.rng.setObserver(null);
      }
    });
    // Same two draws as the bare-handed arms: the success branch adds none.
    expect(draws).toBe(2);
    expect(sim.drainEvents().some((e) => e.type === 'gatherDenied')).toBe(false);
    const meta = internals.players.get(a)!;
    const specimen = meta.inventory.find((s) => s.itemId === 'pristine_hide');
    expect(specimen?.instance?.signer).toBe('Alpha');
    expect(sim.countItem('rough_hide', a)).toBe(3);
    expect(mob.harvestClaimedBy).toBe(a);
  });

  it('at most ONE gatherDenied per harvest command, even with several denied families (seed 31)', () => {
    // Seed 31 pre-verified against soloRig: BOTH wolf families (hide and
    // fang) roll signable on an untagged harvest, so raising both tiers
    // denies two yields in one command; the dedupe flag must emit exactly one
    // event, tiered off the FIRST failing family. Re-recorded from seed 23
    // after the Eastbrook camp respacing thinned the zone-1 camp counts and
    // shifted the camp-driven world-gen draw sequence.
    const base = soloRig(31);
    base.sim.harvestCorpse(base.mob.id, undefined, base.a);
    const baseMeta = base.internals.players.get(base.a)!;
    expect(base.sim.countItem('pristine_hide', base.a)).toBe(1);
    expect(
      baseMeta.inventory.some((s) => s.itemId === 'wolf_fang' && s.instance?.signer === 'Alpha'),
    ).toBe(true);

    const { sim, internals, a, mob } = soloRig(31);
    sim.drainEvents();
    withTier('hide', 2, () => {
      withTier('fang', 2, () => {
        sim.harvestCorpse(mob.id, undefined, a);
      });
    });
    const denied = sim.drainEvents().filter((e) => e.type === 'gatherDenied');
    expect(denied).toEqual([{ type: 'gatherDenied', pid: a, surface: 'corpse', requiredTier: 2 }]);
    // Both families downgraded: plain yields land, nothing is signed.
    const meta = internals.players.get(a)!;
    expect(sim.countItem('rough_hide', a)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('wolf_fang', a)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('pristine_hide', a)).toBe(0);
    expect(meta.inventory.some((s) => s.instance?.signer)).toBe(false);
    expect(mob.harvestClaimedBy).toBe(a);
  });

  it('the single event is tiered off the FIRST failing family in yield order (seed 42)', () => {
    // hide precedes fang in the wolf's yield order, so asymmetric raised
    // tiers discriminate FIRST from min/max/last: (hide 2, fang 3) emits 2
    // (ruling out max and last), the mirror (hide 3, fang 2) emits 3 (ruling
    // out min). Same pre-hunted both-families-signable soloRig shape as the
    // dedupe arm above. Re-recorded from seed 63 after the Eastbrook camp
    // respacing thinned the zone-1 camp counts and shifted the camp-driven
    // world-gen draw sequence.
    const first = soloRig(42);
    first.sim.drainEvents();
    withTier('hide', 2, () => {
      withTier('fang', 3, () => {
        first.sim.harvestCorpse(first.mob.id, undefined, first.a);
      });
    });
    expect(first.sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      { type: 'gatherDenied', pid: first.a, surface: 'corpse', requiredTier: 2 },
    ]);
    const mirror = soloRig(42);
    mirror.sim.drainEvents();
    withTier('hide', 3, () => {
      withTier('fang', 2, () => {
        mirror.sim.harvestCorpse(mirror.mob.id, undefined, mirror.a);
      });
    });
    expect(mirror.sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      { type: 'gatherDenied', pid: mirror.a, surface: 'corpse', requiredTier: 3 },
    ]);
  });
});

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot directly
// (the established bare-client idiom; see bareClient in tests/snapshots.test.ts
// and tests/CLAUDE.md).
function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.playerId = pid;
  c.ownPlayerId = pid;
  c.ownPlayerClass = 'warrior';
  c.spectating = null;
  c.cupInfo = null;
  c.sportRole = null;
  c.moveInput = {};
  c.inventory = [];
  c.vendorBuyback = [];
  c.equipment = {};
  c.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  c.copper = 0;
  c.honor = 0;
  c.lifetimeHonor = 0;
  c.xp = 0;
  c.known = [];
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.selectedDungeonDifficulty = 'normal';
  c.tradeInfo = null;
  c.duelInfo = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.serverTickHz = null;
  c.missingSince = new Map();
  c.pendingFacingDelta = 0;
  c.connected = true;
  c.eventQueue = [];
  c.mouselookFacing = null;
  c.lastInputSentAt = 0;
  c.lastInputSig = '';
  c.inputSeq = 0;
  c.pendingInputSeqSentAt = new Map();
  c.ackedInputSeq = 0;
  c.inputEchoSamples = [];
  c.spectateFacingPending = false;
  c.pendingSpectateFacing = null;
  c.nodeCooldowns = new Map();
  return c;
}

// The online half of the claim: the server encodes harvestClaimedBy as the
// sparse terse key `hcb` (server/game.ts wireEntity), ClientWorld mirrors it,
// and the corpse picker's availability core (corpseLootAvailability) therefore
// stops offering an already-claimed corpse online, exactly as offline.
describe('corpse harvest claim over the wire (online picker parity)', () => {
  it('a real claim rides hcb, mirrors into ClientWorld, and gates the picker', () => {
    const { sim, mob, a, b } = setup();
    sim.harvestCorpse(mob.id, undefined, a);
    expect(mob.harvestClaimedBy).toBe(a);

    const w = wireEntity(mob);
    expect(w.hcb).toBe(a);

    // Bravo's client sees Alpha's claim mirrored, and the picker refuses it.
    const client = bareClient(b);
    (client as any).applySnapshot({ t: 'snap', ents: [w] });
    const mirrored = client.entities.get(mob.id)!;
    expect(mirrored.harvestClaimedBy).toBe(a);
    expect(corpseLootAvailability(mirrored, b).harvestable).toBe(false);
  });

  it('an unclaimed tagged corpse stays harvestable through the mirror', () => {
    const { mob, b } = setup();

    const w = wireEntity(mob);
    expect(w).not.toHaveProperty('hcb');

    const client = bareClient(b);
    (client as any).applySnapshot({ t: 'snap', ents: [w] });
    const mirrored = client.entities.get(mob.id)!;
    expect(mirrored.harvestClaimedBy).toBeNull();
    expect(corpseLootAvailability(mirrored, b).harvestable).toBe(true);
  });
});

// The LIVE broadcast path (the hand-assembled snap envelopes above are always
// fullJson-shaped): the per-session entity cache sends identity only on first
// sight, so a claim landing AFTER a viewer has seen the corpse rides a lite
// (dyn-only) record, and leaving interest scope evicts the corpse from the
// session's sent set so re-entry gets a fresh full record. Both arms must
// deliver claim truth to the mirror.
interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) {
    if (sent[i].t === 'snap') return sent[i];
  }
  return null;
}

function joinServer(server: GameServer, fc: FakeClient, id: number, name: string): ClientSession {
  const session = server.join(fc.ws, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function broadcast(server: GameServer): void {
  (server as any).broadcastSnapshots();
}

describe('corpse harvest claim over the live broadcast (delta + interest scope)', () => {
  function liveSetup() {
    const server = new GameServer();
    const fcA = fakeWs();
    const fcB = fakeWs();
    const sa = joinServer(server, fcA, 81, 'Alpha');
    const sb = joinServer(server, fcB, 82, 'Bravo');
    const internals = server.sim as unknown as SimInternals;
    for (const pid of [sa.pid, sb.pid]) {
      const e = internals.entities.get(pid)!;
      e.pos = { x: 0, y: 0, z: 0 };
      e.prevPos = { x: 0, y: 0, z: 0 };
    }
    // A dead wolf corpse beside both players, with a world-unique entity id
    // (the server sim is a full generated world, so 9999 could collide).
    const template = MOBS.forest_wolf;
    const mobId = Math.max(...internals.entities.keys()) + 1;
    const mob = createMob(mobId, template, template.maxLevel, { x: 2, y: 0, z: 0 });
    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    internals.entities.set(mob.id, mob);
    // One tick re-indexes the spatial grid the interest scan reads
    // (forEachInRadius), so the moved players and the inserted corpse land in
    // their cells before the first broadcast.
    server.sim.tick();
    return { server, internals, fcB, sa, sb, mob };
  }

  it('a claim landing after first sight arrives as a lite delta record and gates the picker', () => {
    const { server, fcB, sa, sb, mob } = liveSetup();

    // First sight: Bravo's client mirrors the unclaimed corpse via a full record.
    broadcast(server);
    const client = bareClient(sb.pid);
    (client as any).applySnapshot(lastSnap(fcB.sent));
    const first = client.entities.get(mob.id)!;
    expect(first.harvestClaimedBy).toBeNull();
    expect(corpseLootAvailability(first, sb.pid).harvestable).toBe(true);

    // Alpha claims AFTER Bravo has seen the corpse: the next broadcast carries
    // the claim as a dyn-only lite record (identity already sent), the exact
    // production sequence the hcb mirror exists for.
    server.sim.harvestCorpse(mob.id, undefined, sa.pid);
    expect(mob.harvestClaimedBy).toBe(sa.pid);
    server.sim.tick(); // advance past the first broadcast's tick so the update is due
    broadcast(server);
    const snap = lastSnap(fcB.sent);
    const rec = snap.ents.find((e: any) => e.id === mob.id);
    expect(rec.hcb).toBe(sa.pid);
    expect(rec).not.toHaveProperty('nm'); // lite record: no identity resend

    (client as any).applySnapshot(snap);
    const mirrored = client.entities.get(mob.id)!;
    expect(mirrored.harvestClaimedBy).toBe(sa.pid);
    expect(corpseLootAvailability(mirrored, sb.pid).harvestable).toBe(false);
  });

  it('scope re-entry rebuilds claim truth: claims and clears made out of view arrive on return', () => {
    const { server, internals, fcB, sa, sb, mob } = liveSetup();

    broadcast(server);
    const client = bareClient(sb.pid);
    (client as any).applySnapshot(lastSnap(fcB.sent));
    expect(client.entities.get(mob.id)!.harvestClaimedBy).toBeNull();

    // Bravo walks far out of interest range; the server evicts the corpse from
    // this session's sent set, and the claim lands while it is out of view.
    const bEnt = internals.entities.get(sb.pid)!;
    const walkTo = (x: number) => {
      bEnt.pos = { x, y: 0, z: 0 };
      bEnt.prevPos = { x, y: 0, z: 0 };
      server.sim.tick(); // re-index the interest grid at the new position
      broadcast(server);
      (client as any).applySnapshot(lastSnap(fcB.sent));
    };
    walkTo(5000);
    server.sim.harvestCorpse(mob.id, undefined, sa.pid);
    broadcast(server);
    (client as any).applySnapshot(lastSnap(fcB.sent));

    // Re-entry: the fresh full record carries the claim made out of view.
    walkTo(0);
    const back = client.entities.get(mob.id)!;
    expect(back.harvestClaimedBy).toBe(sa.pid);
    expect(corpseLootAvailability(back, sb.pid).harvestable).toBe(false);

    // Inverse arm: the claim clears out of view (the respawn sweep write,
    // mob lifecycle), so the re-entry record omits hcb and the stale
    // mirrored pid must reset, not linger.
    walkTo(5000);
    mob.harvestClaimedBy = null;
    walkTo(0);
    const cleared = client.entities.get(mob.id)!;
    expect(cleared.harvestClaimedBy).toBeNull();
    expect(corpseLootAvailability(cleared, sb.pid).harvestable).toBe(true);
  });

  it('an owner-lock lapse after first sight rides a lite delta record and reopens the picker', () => {
    // The `ffa` key flips once per corpse INSIDE dynamicFields, the same
    // cached-record path as hcb, so the flip must invalidate the per-entity
    // dyn cache and reach a viewer who already saw the locked corpse.
    const { server, fcB, sa, sb, mob } = liveSetup();
    mob.lootable = true;
    mob.tappedById = sa.pid;
    mob.harvestClaimedBy = sa.pid; // harvest arm closed: canOpen isolates loot rights
    mob.lootFfaTimer = 60;
    mob.loot = { copper: 10, items: [{ itemId: 'wolf_fang', count: 1 }] };

    broadcast(server);
    const client = bareClient(sb.pid);
    (client as any).applySnapshot(lastSnap(fcB.sent));
    const locked = client.entities.get(mob.id)!;
    expect(locked.lootFfaTimer).toBe(Infinity);
    expect(corpseLootAvailability(locked, sb.pid).canOpen).toBe(false);

    // The lock lapses AFTER Bravo has seen the corpse: the next broadcast must
    // carry ffa:1 as a dyn-only lite record (identity already sent).
    mob.lootFfaTimer = 0;
    server.sim.tick();
    broadcast(server);
    const snap = lastSnap(fcB.sent);
    const rec = snap.ents.find((e: any) => e.id === mob.id);
    expect(rec.ffa).toBe(1);
    expect(rec).not.toHaveProperty('nm'); // lite record: no identity resend

    (client as any).applySnapshot(snap);
    const lapsed = client.entities.get(mob.id)!;
    expect(corpseLootAvailability(lapsed, sb.pid).canOpen).toBe(true);
    expect(corpseLootAvailability(lapsed, sb.pid).hasLoot).toBe(true);
  });
});

// The omitted-components town-focus default depends on an ABSENT
// wire field surviving the whole trip: ClientWorld.harvestCorpse(id) serializes
// NO components key (JSON.stringify drops undefined), and the server dispatch
// normalizes a missing or malformed field to undefined, never [], so
// sim.harvestCorpse sees the omission and derives the town-focus pick.
describe('harvestCorpse omitted components over the wire', () => {
  function wireSetup() {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 91, 'Alpha');
    return { server, session };
  }

  // The REAL client serializer, not a hand-built envelope: a bare ClientWorld
  // with a capturing ws socket.
  function clientRaw(id: number, components?: string[]): string {
    const sent: string[] = [];
    const client = bareClient(1);
    (client as any).ws = { readyState: 1, send: (payload: string) => sent.push(payload) };
    client.harvestCorpse(id, components);
    expect(sent).toHaveLength(1);
    return sent[0];
  }

  it('an omitted pick rides with NO components key and reaches harvestCorpse as undefined', () => {
    const { server, session } = wireSetup();
    const raw = clientRaw(4242);
    expect(raw).not.toContain('components');
    const spy = vi.spyOn(server.sim, 'harvestCorpse').mockImplementation(() => {});
    (server as any).dispatchMessage(session, JSON.parse(raw), raw, 0);
    expect(spy).toHaveBeenCalledWith(4242, undefined, session.pid);
  });

  it('an explicit pick passes through intact', () => {
    const { server, session } = wireSetup();
    const raw = clientRaw(4242, ['hide']);
    const spy = vi.spyOn(server.sim, 'harvestCorpse').mockImplementation(() => {});
    (server as any).dispatchMessage(session, JSON.parse(raw), raw, 0);
    expect(spy).toHaveBeenCalledWith(4242, ['hide'], session.pid);
  });
});

// #2474 over the wire. The `components` array is a client-supplied value the
// authoritative server acts on, and no shipped client sends a repeat (the loot
// window's picker and the interact key both build unique tags), so the only way
// in is a hand-crafted frame. This drives exactly that frame through a REAL
// GameServer into the REAL sim, because the wire is where the untrusted value
// enters and a fix that only held for a direct sim call would not close it.
// Two servers, one command each: GameServer pins a constant WORLD_SEED and
// neither run ticks, so the two worlds are byte-identical at harvest time and
// any difference in the result is the pick.
describe('a repeated component tag over the wire, through a real GameServer (#2474)', () => {
  function serverHarvest(components: string[]): {
    raw: string;
    inventory: { itemId: string; count: number; instance?: unknown }[];
    hides: number;
    draws: number;
    claimedBy: number | null;
  } {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 93, 'Alpha');
    const internals = server.sim as unknown as SimInternals;
    const self = internals.entities.get(session.pid)!;
    self.pos = { x: 0, y: 0, z: 0 };
    self.prevPos = { x: 0, y: 0, z: 0 };
    // wild_boar tags hide/tusk/meat: three tags, so a two-entry pick stays
    // under the spread threshold and lands on the arm that used to hand the
    // repeat through to the roll loop.
    const template = MOBS.wild_boar;
    const mobId = Math.max(...internals.entities.keys()) + 1;
    const mob = createMob(mobId, template, template.maxLevel, { x: 2, y: 0, z: 0 });
    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    internals.entities.set(mob.id, mob);
    // A hand-built frame, the untrusted shape the issue reproduces with, parsed
    // and dispatched exactly as a socket message is. `t: 'cmd'` is the real
    // envelope (ClientWorld.rawCmd); without it the dispatcher drops the frame
    // as a protocol anomaly and the test would pass on an unharvested corpse.
    const raw = JSON.stringify({ t: 'cmd', cmd: 'harvestCorpse', id: mobId, components });
    let draws = 0;
    const rng = (
      server.sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } }
    ).rng;
    rng.setObserver(() => {
      draws++;
    });
    (server as any).dispatchMessage(session, JSON.parse(raw), raw, 0);
    rng.setObserver(null);
    return {
      raw,
      inventory: structuredClone(internals.players.get(session.pid)!.inventory),
      hides: server.sim.countItem('rough_hide', session.pid),
      draws,
      claimedBy: mob.harvestClaimedBy,
    };
  }

  it('lands the same bags a single tag lands, and spends the claim once', () => {
    const dup = serverHarvest(['hide', 'hide']);
    const once = serverHarvest(['hide']);
    // The frame really carried the repeat: the assertion below is about the
    // sim collapsing it, not about the payload never arriving.
    expect(dup.raw).toContain('["hide","hide"]');
    // Not a vacuous comparison of two empty bags: the harvest actually yielded.
    expect(once.hides).toBeGreaterThan(0);
    expect(dup.hides).toBe(once.hides);
    expect(dup.inventory).toEqual(once.inventory);
    expect(dup.claimedBy).not.toBeNull();
    expect(dup.claimedBy).toBe(once.claimedBy);
    // The most decisive pin available over the wire, and the one the bags
    // alone cannot make: rolls are what a doubled harvest actually spent. One
    // family costs two draws (tier roll plus rarity roll); the repeat used to
    // cost four, so this is a literal, not an equality that could hold at any
    // value.
    expect(dup.draws).toBe(2);
    expect(once.draws).toBe(2);
  });

  it('forwards the repeat verbatim: the SIM boundary is what closes it, not the server', () => {
    // Deliberate, and the reason the fix lives in effectiveFocusComponents: the
    // offline Sim and the headless env call the same command without ever
    // passing through server/game.ts, so sanitizing here would have left both
    // hosts open. If a future change starts deduping on the server too, this
    // test is the one that should be re-argued, not quietly deleted.
    const server = new GameServer();
    const session = joinServer(server, fakeWs(), 94, 'Alpha');
    const raw = JSON.stringify({
      t: 'cmd',
      cmd: 'harvestCorpse',
      id: 4242,
      components: ['hide', 'hide'],
    });
    const spy = vi.spyOn(server.sim, 'harvestCorpse').mockImplementation(() => {});
    (server as any).dispatchMessage(session, JSON.parse(raw), raw, 0);
    expect(spy).toHaveBeenCalledWith(4242, ['hide', 'hide'], session.pid);
  });
});

// Two servers, one command each: GameServer pins a constant WORLD_SEED and
// neither run ticks, so the two worlds are byte-identical at harvest time and
// any difference in the result is the pick.
describe('an invalid component tag over the wire, through a real GameServer (#2504)', () => {
  function serverHarvest(components: string[]): {
    raw: string;
    inventory: { itemId: string; count: number; instance?: unknown }[];
    hides: number;
    fangs: number;
    draws: number;
    claimedBy: number | null;
  } {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 95, 'Alpha');
    const internals = server.sim as unknown as SimInternals;
    const self = internals.entities.get(session.pid)!;
    self.pos = { x: 0, y: 0, z: 0 };
    self.prevPos = { x: 0, y: 0, z: 0 };
    // forest_wolf tags hide/fang: two tags, so a two-entry pick CLEARS
    // `>= tagged.length` and lands on the arm the junk string used to flip to
    // spread. A three-tag corpse would never reach it, and this test would pass
    // on either body.
    const template = MOBS.forest_wolf;
    const mobId = Math.max(...internals.entities.keys()) + 1;
    const mob = createMob(mobId, template, template.maxLevel, { x: 2, y: 0, z: 0 });
    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    internals.entities.set(mob.id, mob);
    // A hand-built frame, the untrusted shape the issue reproduces with, parsed
    // and dispatched exactly as a socket message is. `t: 'cmd'` is the real
    // envelope (ClientWorld.rawCmd); without it the dispatcher drops the frame
    // as a protocol anomaly and the test would pass on an unharvested corpse.
    const raw = JSON.stringify({ t: 'cmd', cmd: 'harvestCorpse', id: mobId, components });
    let draws = 0;
    const rng = (
      server.sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } }
    ).rng;
    rng.setObserver(() => {
      draws++;
    });
    (server as any).dispatchMessage(session, JSON.parse(raw), raw, 0);
    rng.setObserver(null);
    return {
      raw,
      inventory: structuredClone(internals.players.get(session.pid)!.inventory),
      hides: server.sim.countItem('rough_hide', session.pid),
      fangs: server.sim.countItem('wolf_fang', session.pid),
      draws,
      claimedBy: mob.harvestClaimedBy,
    };
  }

  it('lands the same bags the junk-free tag lands, and spends the claim once', () => {
    const padded = serverHarvest(['hide', 'not_a_real_tag']);
    const once = serverHarvest(['hide']);
    // The frame really carried the junk: the assertion below is about the sim
    // dropping it, not about the payload never arriving.
    expect(padded.raw).toContain('["hide","not_a_real_tag"]');
    // Not a vacuous comparison of two empty bags: the harvest actually yielded,
    // and it yielded only the family the frame named.
    // A literal, not just "more than zero": GameServer pins a constant
    // WORLD_SEED and neither run ticks, so this value is knowable and a
    // regression that changed the yield would still clear a > 0 floor.
    // Re-recorded 4 to 2 after the Eastbrook camp respacing merged into this
    // branch: WORLD_SEED is fixed, so the only way to re-record this row is the
    // literal. The fang line below is what makes the pair decisive (a spread
    // would put wolf_fang in the bags), not the size of the hide yield.
    expect(once.hides).toBe(2);
    expect(once.fangs).toBe(0);
    expect(padded.hides).toBe(once.hides);
    expect(padded.fangs).toBe(0);
    expect(padded.inventory).toEqual(once.inventory);
    expect(padded.claimedBy).not.toBeNull();
    expect(padded.claimedBy).toBe(once.claimedBy);
    // The most decisive pin available over the wire, and the one the bags alone
    // cannot make: rolls are what the padded pick actually spent. One family
    // costs two draws (tier roll plus rarity roll); the padded pick used to
    // spread and cost four, so this is a literal, not an equality that could
    // hold at any value.
    expect(padded.draws).toBe(2);
    expect(once.draws).toBe(2);
  });

  it('forwards the junk verbatim: the SIM boundary is what closes it, not the server', () => {
    // Deliberate, and the reason the fix lives in effectiveFocusComponents: the
    // offline Sim and the headless env call the same command without ever
    // passing through server/game.ts, so validating tags here would have left
    // both hosts open. If a future change starts filtering on the server too,
    // this test is the one that should be re-argued, not quietly deleted.
    const server = new GameServer();
    const session = joinServer(server, fakeWs(), 96, 'Alpha');
    const raw = JSON.stringify({
      t: 'cmd',
      cmd: 'harvestCorpse',
      id: 4242,
      components: ['hide', 'not_a_real_tag'],
    });
    const spy = vi.spyOn(server.sim, 'harvestCorpse').mockImplementation(() => {});
    (server as any).dispatchMessage(session, JSON.parse(raw), raw, 0);
    expect(spy).toHaveBeenCalledWith(4242, ['hide', 'not_a_real_tag'], session.pid);
  });
});

// #2509: a pick can name a family the corpse really CARRIES that no harvest
// item is wired to yet (claw, tusk, gills, horn). It survives sanitization for
// that reason, so pre-fix it spent the single-use claim, drew one tier roll per
// named family, granted nothing, and emitted NOTHING AT ALL (the harvestResult
// ledger is gated on `granted.length > 0`). Measured on old_greyjaw with
// ['claw']: claim spent, 1 draw, 0 items, 0 events. Reachable from the shipped
// picker, which renders a row per tag with no mapping filter, and on the three
// `gills, hide` murlocs a single checkbox is enough.
//
// The fix is a pre-claim, rng-free refusal at the command boundary, NOT a
// narrowing inside effectiveFocusComponents: narrowing would move the
// concentration bonus (`taggedComponents.length - effectiveChosen.length`) on
// every mixed pick. The "yields are untouched" describe below is what holds
// that line.
describe('a pick of nothing but unmapped families is refused, claim intact (#2509)', () => {
  // The shared module-scope rig, with this suite's own corpse id so its cases
  // and the #2513 suite's cannot collide on one entity.
  const harvest2509 = (
    templateId: string,
    components: string[] | undefined,
    seed = 5,
    townFocus?: Record<string, number>,
  ) => harvestCommand(templateId, components, { seed, townFocus, corpseId: 7509 });

  const REFUSAL = 'Nothing you selected can be harvested from that corpse.';
  // The corpse-level refusal #2513 routes an all-unmapped template to, distinct
  // from the pick-level REFUSAL above and deliberately the pre-existing string
  // every untagged corpse already answers with.
  const NOT_HARVESTABLE = 'That corpse has nothing to harvest.';

  it('is about families the content really leaves unmapped, not a made-up set', () => {
    // Read off the real table rather than restated, so a family gaining an item
    // retires these cases instead of silently inverting what they claim. A
    // LITERAL set on both sides: deriving the unmapped list from
    // HARVEST_COMPONENT_ITEMS alone would make this pass against any table.
    const tagged = new Set(Object.values(MOBS).flatMap((m) => m.componentTags ?? []));
    expect([...tagged].filter((t) => !HARVEST_COMPONENT_ITEMS[t]).sort()).toEqual([
      'claw',
      'gills',
      'horn',
      'tusk',
    ]);
    expect(Object.keys(HARVEST_COMPONENT_ITEMS).sort()).toEqual([
      'cloth',
      'fang',
      'hide',
      'meat',
      'silk',
      'venomSac',
    ]);
  });

  it('refuses the pick the issue reproduces, and leaves the corpse exactly as it found it', () => {
    // old_greyjaw carries hide, fang and claw; only claw is unmapped.
    expect(MOBS.old_greyjaw.componentTags).toEqual(['hide', 'fang', 'claw']);
    const refused = harvest2509('old_greyjaw', ['claw']);
    // Every observable the pre-fix command moved, pinned as UNMOVED. Zero
    // draws alone would not establish a refusal (pre-fix this arm drew one and
    // still spent the claim), so the claim and the corpse timer are what say
    // "refused": the clamp at the end of harvestCorpse never ran.
    expect(refused.claimedBy).toBeNull();
    expect(refused.draws).toBe(0);
    expect(refused.corpseTimer).toBe(9999);
    expect(refused.errors).toEqual([REFUSAL]);
    // ...and the ONLY event is that refusal: no harvestResult, no loot line.
    expect(refused.events.map((e) => e.type)).toEqual(['error']);
    // The discriminator, on the identical rig: a mapped pick on this same
    // corpse still harvests, so the rig is not simply refusing everything.
    const ok = harvest2509('old_greyjaw', ['hide']);
    expect(ok.claimedBy).not.toBeNull();
    expect(ok.draws).toBe(2);
    expect(ok.sim.countItem('rough_hide', ok.a)).toBeGreaterThan(0);
  });

  it('leaves the corpse harvestable, so the player recovers the yield they nearly threw away', () => {
    // The whole point of refusing rather than reporting: the single-use claim
    // survives the mistake. Same corpse, second command, full yield.
    const { sim, internals, a } = setup(153);
    const template = MOBS.old_greyjaw;
    const corpse = createMob(7510, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    sim.harvestCorpse(corpse.id, ['claw'], a);
    expect(corpse.harvestClaimedBy).toBeNull();
    sim.harvestCorpse(corpse.id, ['hide'], a);
    expect(corpse.harvestClaimedBy).toBe(a);
    expect(sim.countItem('rough_hide', a)).toBeGreaterThan(0);
  });

  it('covers every shipped template that mixes mapped and unmapped families', () => {
    // Derived from content, not listed by hand: a retag that adds or removes a
    // mixed template moves this sweep instead of leaving the new one untested.
    const mixed = Object.entries(MOBS).filter(([, m]) => {
      const tags = m.componentTags ?? [];
      return (
        tags.some((t) => HARVEST_COMPONENT_ITEMS[t]) &&
        tags.some((t) => !HARVEST_COMPONENT_ITEMS[t])
      );
    });
    // The count is asserted so an empty or one-row sweep cannot pass quietly.
    expect(mixed.map(([id]) => id).sort()).toEqual([
      'deepfen_murloc',
      'glimmermere_wader',
      'mire_prowler',
      'mudfin_murloc',
      'old_cragmaw',
      'old_greyjaw',
      'ridge_stalker',
      'sethrael_palecoil',
      'wild_boar',
      'wildheart_hexcaller',
    ]);
    for (const [id, m] of mixed) {
      const tags = m.componentTags!;
      const unmapped = tags.filter((t) => !HARVEST_COMPONENT_ITEMS[t]);
      const mapped = tags.filter((t) => HARVEST_COMPONENT_ITEMS[t]);
      // Each unmapped family alone, then all of them together: on
      // sethrael_palecoil (hide, claw, horn) two of the three boxes are traps.
      for (const pick of [...unmapped.map((t) => [t]), unmapped]) {
        const r = harvest2509(id, pick);
        const label = `${id} ${JSON.stringify(pick)}`;
        expect(r.claimedBy, `${label} claim`).toBeNull();
        expect(r.draws, `${label} draws`).toBe(0);
        expect(r.corpseTimer, `${label} timer`).toBe(9999);
        expect(r.errors, `${label} errors`).toEqual([REFUSAL]);
      }
      // ...and the mapped families on the same template still harvest, so no
      // row of this sweep is passing because the template is broken.
      const ok = harvest2509(id, mapped);
      expect(ok.claimedBy, `${id} mapped pick`).not.toBeNull();
      expect(ok.errors, `${id} mapped pick errors`).toEqual([]);
    }
  });

  it('does NOT fire on a corpse whose every family is unmapped: the other gate does (#2513)', () => {
    // The second condition of THIS gate, still false on fen_troll and still
    // meaning what it always meant: no pick forfeits anything there, because no
    // pick could have paid out. What refuses that corpse is the corpse-level
    // isHarvestableCorpse gate #2513 added upstream, with its own message. The
    // two are pinned apart on purpose: a fixture where both fired would let
    // either one rot, and collapsing them would move the concentration bonus.
    expect(MOBS.fen_troll.componentTags).toEqual(['claw', 'tusk']);
    for (const pick of [undefined, [], ['claw'], ['tusk'], ['claw', 'tusk']] as (
      | string[]
      | undefined
    )[]) {
      const label = `fen_troll ${JSON.stringify(pick)}`;
      // This predicate, called directly: it is the #2509 rule that must stay
      // quiet here, independently of which gate ends up refusing the command.
      expect(forfeitsEveryMappedYield(['claw', 'tusk'], pick ?? []), `${label} predicate`).toBe(
        false,
      );
      const r = harvest2509('fen_troll', pick);
      expect(r.errors, `${label} errors`).toEqual([NOT_HARVESTABLE]);
      expect(r.claimedBy, `${label} claim`).toBeNull();
      expect(r.draws, `${label} draws`).toBe(0);
      expect(r.corpseTimer, `${label} timer`).toBe(9999);
    }
    // Decisive contrast, same pick, same seed: ['claw'] is refused on BOTH
    // corpses now, but by different gates carrying different text. A single
    // merged gate, or a gate keyed on the pick alone, would fail exactly this
    // pair by making the two messages the same one.
    expect(harvest2509('fen_troll', ['claw']).errors).toEqual([NOT_HARVESTABLE]);
    expect(harvest2509('old_greyjaw', ['claw']).errors).toEqual([REFUSAL]);
    expect(NOT_HARVESTABLE).not.toBe(REFUSAL);
  });

  it('refuses the DERIVED pick too, when a persisted town focus names only unmapped families', () => {
    // An omitted `components` resolves to the persisted town focus, so it can
    // be an all-unmapped pick with no client involved. #2511 has since closed
    // the write route (set_town_focus rejects an unmapped key and the load arm
    // drops one an older save carries), so the direct meta poke below stands
    // in for exactly that: a save written before the key check existed.
    // Pre-fix that burned the corpse on a plain interact press, with no picker
    // open and no line printed. The refusal covers this path for the same
    // reason it covers the explicit one: the yield is still being forfeited.
    const poisoned = harvest2509('old_greyjaw', undefined, 5, { claw: 5 });
    expect(poisoned.claimedBy).toBeNull();
    expect(poisoned.draws).toBe(0);
    expect(poisoned.errors).toEqual([REFUSAL]);
    // The ordinary focus path is untouched: a focus on a mapped family still
    // derives that pick and harvests it.
    const healthy = harvest2509('old_greyjaw', undefined, 5, { hide: 5 });
    expect(healthy.claimedBy).not.toBeNull();
    expect(healthy.errors).toEqual([]);
    expect(healthy.sim.countItem('rough_hide', healthy.a)).toBeGreaterThan(0);
  });

  it('the picker offers exactly what the command accepts, driven against a real Sim', () => {
    // The mirror, pinned end to end rather than as two restatements of one
    // rule: for every shipped mixed template and every subset of its tags, the
    // picker's harvestDisabled must equal what the real harvestCorpse actually
    // does with that pick. Nothing here re-derives the gate, so a change made
    // on EITHER side reds this, which is the whole point (a divergence is
    // invisible to the sim suite and to the view suite separately).
    // "Refused" spans BOTH gates after #2513: the pick-level REFUSAL and the
    // corpse-level NOT_HARVESTABLE. Scoping this to REFUSAL alone would let the
    // picker disable an all-unmapped corpse while this sweep called it accepted,
    // which is the exact divergence the sweep exists to catch.
    let disabledSeen = 0;
    let byPick = 0;
    let byCorpse = 0;
    for (const [id, m] of Object.entries(MOBS)) {
      const tags = m.componentTags;
      if (!tags?.length) continue;
      for (let mask = 0; mask < 1 << tags.length; mask++) {
        const selected = tags.filter((_, i) => mask & (1 << i));
        const label = `${id} ${JSON.stringify(selected)}`;
        const disabled = corpseHarvestView(tags, new Set(selected)).harvestDisabled;
        const r = harvest2509(id, selected);
        const refused = r.errors.includes(REFUSAL) || r.errors.includes(NOT_HARVESTABLE);
        expect(disabled, `${label} picker vs command`).toBe(refused);
        // ...and "refused" is read off the world, not just off the text.
        expect(r.claimedBy === null, `${label} claim vs refusal`).toBe(refused);
        if (refused) disabledSeen++;
        if (r.errors.includes(REFUSAL)) byPick++;
        if (r.errors.includes(NOT_HARVESTABLE)) byCorpse++;
      }
    }
    // The sweep has to visit the disabled arm at all: an all-false pass would
    // agree trivially. Split by gate so a change that moved every refusal onto
    // ONE of them could not pass the total: 12 pick-level rows on the ten mixed
    // templates, and fen_troll's four subsets at the corpse level.
    expect(disabledSeen).toBe(16);
    expect(byPick).toBe(12);
    expect(byCorpse).toBe(4);
    // The two gates partition the refusals: no row is refused by both, so the
    // two messages can never be reported together. (Arithmetically implied by
    // the three literals above, kept as the statement of intent.)
    expect(byPick + byCorpse).toBe(disabledSeen);
  });

  it('keeps the settled #2504 ruling: an ALL-junk pick still spreads, junk beside claw still refuses', () => {
    // The two rules meet here. A tag the corpse does not CARRY sanitizes away,
    // so a pick of nothing but junk is the empty pick and spreads (#2504). A
    // tag it DOES carry survives, so ['claw','junk'] is exactly ['claw'] and is
    // refused. Neither rule may swallow the other.
    const junk = harvest2509('old_greyjaw', ['junk']);
    const empty = harvest2509('old_greyjaw', []);
    expect(junk.claimedBy).not.toBeNull();
    expect(junk.errors).toEqual([]);
    expect(junk.inventory).toEqual(empty.inventory);
    expect(junk.draws).toBe(empty.draws);
    const clawJunk = harvest2509('old_greyjaw', ['claw', 'junk']);
    expect(clawJunk.claimedBy).toBeNull();
    expect(clawJunk.draws).toBe(0);
    expect(clawJunk.errors).toEqual([REFUSAL]);
  });

  it('draws NO rng and moves nothing on the new refusal arm, across every mixed width', () => {
    // The determinism contract every refusal arm in this file carries: a
    // refused command must not shift the world's draw order for everyone else.
    // Widths matter because the pick's length against the tag count is what
    // picks the concentrate-vs-spread arm; both a 2-tag and a 3-tag corpse are
    // here, and on the 2-tag murloc a single box is the whole refusal.
    for (const [templateId, pick] of [
      ['mudfin_murloc', ['gills']],
      ['wild_boar', ['tusk']],
      ['old_greyjaw', ['claw']],
      ['sethrael_palecoil', ['claw', 'horn']],
    ] as [string, string[]][]) {
      for (const seed of [2, 5, 11]) {
        const label = `${templateId} ${JSON.stringify(pick)} @${seed}`;
        const r = harvest2509(templateId, pick, seed);
        // The world as it stands with the command never issued at all: the
        // refusal has to land exactly here, not merely "somewhere quiet".
        const never = harvest2509(templateId, ['not_a_tag_at_all'], seed);
        const untouched = harvest2509(templateId, undefined, seed);
        expect(r.draws, `${label} draws`).toBe(0);
        expect(r.claimedBy, `${label} claim`).toBeNull();
        expect(r.corpseTimer, `${label} timer`).toBe(9999);
        expect(r.inventory, `${label} inventory`).toEqual(r.before);
        // The two controls on the same seed, which is what makes the zeros
        // above mean "refused" rather than "inert rig": a junk-only pick
        // spreads (#2504) and an omitted pick harvests, both on this corpse.
        expect(never.claimedBy, `${label} junk control claim`).not.toBeNull();
        expect(never.draws, `${label} junk control draws`).toBeGreaterThan(0);
        expect(untouched.claimedBy, `${label} omitted control claim`).not.toBeNull();
      }
    }
  });
});

// #2513: the corpse-level half of the same class. fen_troll carries claw and
// tusk and HARVEST_COMPONENT_ITEMS maps NEITHER, so it is the one shipped
// template on which no pick could ever have paid out. #2509's pick-level
// refusal deliberately left it alone (nothing is forfeited when nothing was on
// offer), which left the original harm standing on the one corpse where the
// player had no better option: it advertised itself as harvestable, took the
// command, spent the single-use claim, drew one tier roll per effective family,
// granted nothing and emitted NOTHING AT ALL. Measured pre-fix at seed 5: an
// omitted pick, `[]` and `['claw','tusk']` each drew 2, `['claw']` and
// `['tusk']` each drew 1, every one of them silent with the claim spent and the
// corpse timer clamped from 9999 to 4.
//
// The fix answers the corpse-level question honestly instead of reporting the
// dead end: isHarvestableCorpse reads the MAPPED families a template carries,
// so this corpse takes the same path as the 101 templates that carry no
// component tags at all. No new string (the pre-existing localized
// error.corpseNothingToHarvest), no new event, no wire or IWorld change, and
// nothing moves on a MIXED corpse: the describe below still holds every one of
// its pre-#2509 literals.
describe('a corpse whose EVERY family is unmapped is never offered a harvest (#2513)', () => {
  const harvestAt = (
    templateId: string,
    components: string[] | undefined,
    seed = 5,
    townFocus?: Record<string, number>,
    arrange?: (rig: { internals: SimInternals; a: number; b: number }, corpse: Entity) => void,
  ) =>
    harvestCommand(templateId, components, {
      seed,
      townFocus,
      corpseId: 7513,
      arrange: arrange as never,
    });

  const harvest2513 = (
    components: string[] | undefined,
    seed = 5,
    townFocus?: Record<string, number>,
    arrange?: (rig: { internals: SimInternals; a: number; b: number }, corpse: Entity) => void,
  ) => harvestAt('fen_troll', components, seed, townFocus, arrange);

  const NOT_HARVESTABLE = 'That corpse has nothing to harvest.';
  const PICK_REFUSAL = 'Nothing you selected can be harvested from that corpse.';

  it('is about a template the content really leaves fully unmapped, derived not listed', () => {
    // A retag that gives claw or tusk an item, or that leaves a SECOND template
    // fully unmapped, moves this row instead of leaving the new case untested.
    const allUnmapped = Object.entries(MOBS)
      .filter(([, m]) => (m.componentTags?.length ?? 0) > 0)
      .filter(([, m]) => !m.componentTags!.some((t) => HARVEST_COMPONENT_ITEMS[t]))
      .map(([id]) => id);
    expect(allUnmapped).toEqual(['fen_troll']);
    expect(MOBS.fen_troll.componentTags).toEqual(['claw', 'tusk']);
    expect(isHarvestableCorpse(MOBS.fen_troll.componentTags)).toBe(false);
    // The contrast that makes the predicate mean "mapped families" rather than
    // "these two tags": wild_boar also carries tusk and stays harvestable.
    expect(MOBS.wild_boar.componentTags).toEqual(['hide', 'tusk', 'meat']);
    expect(isHarvestableCorpse(MOBS.wild_boar.componentTags)).toBe(true);
  });

  it('refuses every pick shape, pre-claim and rng-free, and says so exactly once', () => {
    // Every shape that reaches the command: omitted (the town-focus default),
    // an explicit empty pick, each single family, and the full cover. Pre-fix
    // each of these spent the claim and emitted nothing; the draw counts they
    // used to spend are in the describe comment above.
    for (const pick of [undefined, [], ['claw'], ['tusk'], ['claw', 'tusk']] as (
      | string[]
      | undefined
    )[]) {
      const label = `fen_troll ${JSON.stringify(pick)}`;
      const r = harvest2513(pick);
      expect(r.errors, `${label} errors`).toEqual([NOT_HARVESTABLE]);
      // The refusal is the ONLY event: no harvestResult, no loot line, no cue.
      expect(
        r.events.map((e) => e.type),
        `${label} events`,
      ).toEqual(['error']);
      expect(r.claimedBy, `${label} claim`).toBeNull();
      expect(r.draws, `${label} draws`).toBe(0);
      // The post-harvest clamp never ran, so the corpse keeps its own decay.
      expect(r.corpseTimer, `${label} timer`).toBe(9999);
      expect(r.inventory, `${label} inventory`).toEqual(r.before);
    }
  });

  it('refuses the DERIVED pick too, whatever a persisted town focus names', () => {
    // An omitted `components` resolves through meta.townFocus, so a persisted
    // allocation is the pick. #2511 has since closed the route that could WRITE
    // an unmapped key (set_town_focus rejects one and the load arm drops one an
    // older save carries), so the direct meta poke in the rig stands in for
    // exactly that: a save written before the key check existed. Pre-fix a
    // `{ claw: 5 }` allocation burned this corpse on a plain interact press with
    // no picker open and no line printed. The corpse-level gate fires before the
    // pick is even derived, which is why every focus shape lands the same
    // refusal here: a mapped focus, an unmapped one, junk, and none at all. That
    // insensitivity to the focus is the point, and it is what makes this gate
    // independent of #2511 rather than relying on it.
    const focuses: (Record<string, number> | undefined)[] = [
      undefined,
      { claw: 5 },
      { tusk: 5 },
      { hide: 5 },
      { junk: 5 },
    ];
    for (const focus of focuses) {
      const r = harvest2513(undefined, 5, focus);
      const label = JSON.stringify(focus ?? 'no focus');
      expect(r.errors, `${label} errors`).toEqual([NOT_HARVESTABLE]);
      expect(r.claimedBy, `${label} claim`).toBeNull();
      expect(r.draws, `${label} draws`).toBe(0);
    }
  });

  it('holds across seeds, which is a statement about the gate reading no rng state', () => {
    // Deliberately NOT claimed as "not one lucky draw stream": the gate is
    // rng-free and pre-claim, so all three rows run byte-identical code today and
    // no seed can pass while another fails. What the row buys is the future: a
    // change that made the gate read anything seed-derived (a roll, a shuffled
    // tag order) would break exactly here and nowhere else in this file.
    for (const seed of [2, 5, 11]) {
      const r = harvest2513(undefined, seed);
      expect(r.draws, `@${seed} draws`).toBe(0);
      expect(r.claimedBy, `@${seed} claim`).toBeNull();
      expect(r.corpseTimer, `@${seed} timer`).toBe(9999);
      expect(r.errors, `@${seed} errors`).toEqual([NOT_HARVESTABLE]);
    }
  });

  it('preempts the range and already-claimed refusals, which is a message change', () => {
    // Gate ORDER, pinned because the diff changed which message a player gets
    // and no other case asserts precedence. The corpse-level gate sits above the
    // range check and the claim resolve, so on an all-unmapped corpse it answers
    // first: an out-of-range press used to say "Too far away." and a
    // second-comer used to say "This corpse has already been harvested." Both
    // now say the corpse has nothing to harvest, which is the more useful of the
    // two answers (the range and the claim are not the reason it will never
    // work) and is what an untagged corpse has always said.
    const far = harvest2513(undefined, 5, undefined, (rig) => {
      rig.internals.entities.get(rig.a)!.pos = { x: 500, y: 0, z: 0 };
    });
    expect(far.errors).toEqual([NOT_HARVESTABLE]);
    expect(far.draws).toBe(0);
    const claimed = harvest2513(undefined, 5, undefined, (rig, corpse) => {
      corpse.harvestClaimedBy = rig.b;
    });
    expect(claimed.errors).toEqual([NOT_HARVESTABLE]);
    expect(claimed.draws).toBe(0);
    // The discriminator: on a HARVESTABLE corpse both of those gates still own
    // their own message, so this is precedence on one template and not the
    // corpse gate swallowing the others.
    const farWolf = harvestAt('forest_wolf', undefined, 5, undefined, (rig) => {
      rig.internals.entities.get(rig.a)!.pos = { x: 500, y: 0, z: 0 };
    });
    expect(farWolf.errors).toEqual(['Too far away.']);
    const claimedWolf = harvestAt('forest_wolf', undefined, 5, undefined, (rig, corpse) => {
      corpse.harvestClaimedBy = rig.b;
    });
    expect(claimedWolf.errors).toEqual(['This corpse has already been harvested.']);
  });

  it('leaves the sim IDENTICAL to the command never being issued', () => {
    // The determinism contract: a refused command must not shift the world's
    // draw order or move any state for anyone else. Stated as an equality
    // against a run of the same seed that never calls harvestCorpse at all, so
    // it cannot pass by comparing the refusal with itself.
    const issued = harvest2513(['claw'], 5);
    const { sim: quiet, internals: quietInternals, a: quietA } = setup(5);
    const template = MOBS.fen_troll;
    const corpse = createMob(7513, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    quietInternals.entities.set(corpse.id, corpse);
    quiet.drainEvents();
    expect(issued.inventory).toEqual(quietInternals.players.get(quietA)!.inventory);
    expect(issued.corpse.harvestClaimedBy).toBe(corpse.harvestClaimedBy);
    expect(issued.corpse.corpseTimer).toBe(corpse.corpseTimer);
    // Same rng stream position: the next draw either world takes is the same
    // one. A refusal that drew anything would desync exactly here.
    const nextOf = (s: typeof quiet) => (s as unknown as { rng: { next(): number } }).rng.next();
    expect(nextOf(issued.sim)).toBe(nextOf(quiet));
  });

  it('is a corpse-level gate, so the pick-level #2509 rule is untouched', () => {
    // The two predicates answer independently. On fen_troll the #2509 rule is
    // false for every pick (nothing is forfeited), and the command is refused
    // anyway. On a mixed corpse the #2509 rule still fires and its message is
    // still the one reported.
    for (const pick of [[], ['claw'], ['tusk'], ['claw', 'tusk']]) {
      expect(forfeitsEveryMappedYield(['claw', 'tusk'], pick), JSON.stringify(pick)).toBe(false);
    }
    expect(forfeitsEveryMappedYield(['hide', 'fang', 'claw'], ['claw'])).toBe(true);
    // Same rig, same seed, same pick: the mixed corpse still answers with the
    // PICK-level message, so the corpse-level gate has not swallowed it.
    expect(harvestAt('old_greyjaw', ['claw']).errors).toEqual([PICK_REFUSAL]);
    expect(harvest2513(['claw']).errors).toEqual([NOT_HARVESTABLE]);
  });

  it('every command that spends the claim reports at least one yield', () => {
    // The #2457 "granted path only" contract in src/sim/types.ts used to be
    // pinned by fen_troll alone: it was the only production fixture that took
    // the `granted.length > 0` guard's FALSE arm, and #2513 makes that arm
    // unreachable. Rather than leave the contract asserted by nothing, state it
    // as the property it now is, swept over every shipped template and every
    // subset of its tags: if the claim was spent, the ledger is non-empty and
    // one event carries it. The two gates together are what make this true.
    let spent = 0;
    let refused = 0;
    for (const [id, m] of Object.entries(MOBS)) {
      const tags = m.componentTags;
      if (!tags?.length) continue;
      for (let mask = 0; mask < 1 << tags.length; mask++) {
        const selected = tags.filter((_, i) => mask & (1 << i));
        const label = `${id} ${JSON.stringify(selected)}`;
        const r = harvestAt(id, selected);
        const results = r.events.filter(
          (e): e is Extract<typeof e, { type: 'harvestResult' }> => e.type === 'harvestResult',
        );
        if (r.claimedBy === null) {
          refused++;
          expect(results, `${label} refused emits no ledger`).toHaveLength(0);
          continue;
        }
        spent++;
        expect(results, `${label} one ledger event`).toHaveLength(1);
        expect(results[0].yields.length, `${label} non-empty ledger`).toBeGreaterThan(0);
        // ...and every entry really landed a positive quantity, so a phantom
        // zero-count row could not satisfy the length above.
        for (const y of results[0].yields) {
          expect(y.qty, `${label} ${y.itemId} qty`).toBeGreaterThan(0);
        }
      }
    }
    // Both arms are visited, so neither half of the property is vacuous. These
    // two literals are what carry that: a sweep that stopped spending claims, or
    // one that stopped refusing, moves one of them. The total is every subset of
    // every tagged template (it grew with the templates #1584 added), stated so a
    // shrunk sweep reads as wrong rather than merely smaller.
    expect(spent).toBe(86);
    expect(refused).toBe(16);
    expect(spent + refused).toBe(102);
  });

  it('keeps every mixed template harvestable, so the gate is not a blanket refusal', () => {
    // The nine templates that mix mapped and unmapped families still claim,
    // still draw and still grant on their mapped picks. Derived from content so
    // a retag cannot quietly shrink the sweep.
    const mixed = Object.entries(MOBS).filter(([, m]) => {
      const tags = m.componentTags ?? [];
      return (
        tags.some((t) => HARVEST_COMPONENT_ITEMS[t]) &&
        tags.some((t) => !HARVEST_COMPONENT_ITEMS[t])
      );
    });
    expect(mixed).toHaveLength(10);
    for (const [id, m] of mixed) {
      const mapped = m.componentTags!.filter((t) => HARVEST_COMPONENT_ITEMS[t]);
      const r = harvestAt(id, mapped);
      expect(r.errors, `${id} errors`).toEqual([]);
      expect(r.claimedBy, `${id} claim`).not.toBeNull();
      expect(r.draws, `${id} draws`).toBeGreaterThan(0);
      expect(r.inventory.length, `${id} inventory`).toBeGreaterThan(r.before.length);
    }
    // ...and a template with no tags at all still answers the SAME corpse-level
    // refusal fen_troll now takes, which is the point of routing it there.
    expect(MOBS.warlock_imp.componentTags).toBeUndefined();
    expect(harvestAt('warlock_imp', undefined).errors).toEqual([NOT_HARVESTABLE]);
  });
});

// The other half of the #2509 acceptance criteria, and the reason the fix is a
// refusal at the command boundary rather than a narrowing inside
// effectiveFocusComponents: every pick that yields anything must behave EXACTLY
// as it did before. Narrowing the unmapped families out of the pick would raise
// the concentration bonus (`taggedComponents.length - effectiveChosen.length`)
// on every mixed pick and stop an explicit full cover from spreading. These are
// literals measured on the pre-fix build, not equalities against a second run.
describe('the concentration bonus on a mixed corpse is untouched (#2509)', () => {
  function yieldOf(components: string[] | undefined) {
    const { sim, internals, a } = setup(153);
    const template = MOBS.old_greyjaw;
    const corpse = createMob(7511, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    corpse.dead = true;
    corpse.aiState = 'dead';
    corpse.corpseTimer = 9999;
    corpse.respawnTimer = 9999;
    internals.entities.set(corpse.id, corpse);
    sim.drainEvents();
    let draws = 0;
    const rng = (sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } }).rng;
    rng.setObserver(() => {
      draws++;
    });
    sim.harvestCorpse(corpse.id, components, a);
    rng.setObserver(null);
    sim.drainEvents();
    return {
      draws,
      hide: sim.countItem('rough_hide', a),
      fang: sim.countItem('wolf_fang', a),
      pristine: sim.countItem('pristine_hide', a),
      claimedBy: corpse.harvestClaimedBy,
    };
  }

  // old_greyjaw, tags hide/fang/claw, seed 5. Every pick shape that yields
  // something. The rig seed was re-hunted (45 to 153) after the Eastbrook camp
  // respacing merged into this branch moved the shared rng's position before
  // the harvest rolls; 153 reproduces the recorded profile exactly, so every
  // quantity and every `draws` count below is unchanged, which is the claim
  // this table actually protects. `bonus` is not asserted
  // directly (the roll is internal); the tier-driven quantities and the draw
  // counts are what a moved denominator would change, and they are pinned.
  const CASES: {
    pick: string[] | undefined;
    draws: number;
    hide: number;
    fang: number;
    pristine: number;
  }[] = [
    // Spread across all three tags at bonus 0. claw costs a tier roll and
    // grants nothing, which is exactly what makes the denominator 3.
    { pick: undefined, draws: 5, hide: 2, fang: 5, pristine: 0 },
    { pick: [], draws: 5, hide: 2, fang: 5, pristine: 0 },
    // An explicit FULL cover still spreads, byte-identical to the empty pick.
    // A narrowing fix would have dropped claw, made this a 2-of-3 concentrate
    // at bonus 1, and broken that documented equivalence.
    { pick: ['hide', 'fang', 'claw'], draws: 5, hide: 2, fang: 5, pristine: 0 },
    // Concentrate on one mapped family: bonus 2, and the extra tier shift is
    // what lands the signed pristine_hide.
    { pick: ['hide'], draws: 2, hide: 4, fang: 0, pristine: 1 },
    // The mixed pick the narrowing fix would have re-tuned: hide beside claw
    // is a 2-of-3 concentrate at bonus 1 today. Under a narrowing it would
    // have become the ['hide'] row above (bonus 2, a pristine_hide out of
    // thin air). It stays here.
    { pick: ['hide', 'claw'], draws: 3, hide: 3, fang: 0, pristine: 0 },
    { pick: ['hide', 'fang'], draws: 4, hide: 3, fang: 6, pristine: 0 },
  ];

  for (const c of CASES) {
    it(`${JSON.stringify(c.pick)} yields exactly what it did before the refusal landed`, () => {
      const r = yieldOf(c.pick);
      expect(r.claimedBy).not.toBeNull();
      expect(r.draws).toBe(c.draws);
      expect(r.hide).toBe(c.hide);
      expect(r.fang).toBe(c.fang);
      expect(r.pristine).toBe(c.pristine);
    });
  }

  it('the full cover and the empty pick still land the identical world', () => {
    // Stated as an equality too, so the rows above cannot both drift together.
    expect(yieldOf(['hide', 'fang', 'claw'])).toEqual(yieldOf([]));
    // ...and the mixed pick is NOT the concentrated one, which is the exact
    // difference a narrowing fix would have erased.
    expect(yieldOf(['hide', 'claw'])).not.toEqual(yieldOf(['hide']));
  });

  it('holds on the TWO-tag mixed corpse too, where the bonus arithmetic differs', () => {
    // old_greyjaw above is the 3-tag shape. The three `gills, hide` murlocs are
    // the 2-tag shape, where a single box is the whole refusal and the spread
    // denominator is 2 rather than 3, so a narrowing scoped to them would slip
    // past every row above. Literals, measured the same way. `claimedBy` is the
    // harvester's entity id, re-recorded 832 to 820 because thinning the zone-1
    // camps removed mobs from world-gen and the players are numbered after
    // them; every yield literal is unchanged.
    const boar = (components: string[] | undefined) => {
      const { sim, internals, a } = setup(153);
      const template = MOBS.mudfin_murloc;
      const corpse = createMob(7512, template, template.maxLevel, { x: 0, y: 0, z: 0 });
      corpse.dead = true;
      corpse.aiState = 'dead';
      corpse.corpseTimer = 9999;
      corpse.respawnTimer = 9999;
      internals.entities.set(corpse.id, corpse);
      let draws = 0;
      const rng = (sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } })
        .rng;
      rng.setObserver(() => {
        draws++;
      });
      sim.harvestCorpse(corpse.id, components, a);
      rng.setObserver(null);
      sim.drainEvents();
      return {
        draws,
        hide: sim.countItem('rough_hide', a),
        pristine: sim.countItem('pristine_hide', a),
        claimedBy: corpse.harvestClaimedBy,
      };
    };
    expect(MOBS.mudfin_murloc.componentTags).toEqual(['gills', 'hide']);
    // Spread over both tags at bonus 0: gills costs a tier roll and grants
    // nothing, which is exactly what keeps the denominator at 2.
    expect(boar(undefined)).toEqual({ draws: 3, hide: 5, pristine: 0, claimedBy: 820 });
    expect(boar(['gills', 'hide'])).toEqual(boar([]));
    // Concentrating on hide is bonus 1, and stays bonus 1.
    expect(boar(['hide'])).toEqual({ draws: 2, hide: 3, pristine: 1, claimedBy: 820 });
  });
});

// Two servers, one command each: the refusal lives at the SIM boundary, so the
// server must still forward an all-unmapped pick verbatim.
describe('an unmapped-only pick over the wire, through a real GameServer (#2509)', () => {
  it('forwards the pick verbatim: the SIM boundary is what refuses it, not the server', () => {
    // Same argument as #2474 and #2504: the offline Sim and the headless env
    // call harvestCorpse without ever passing through server/game.ts, so
    // validating the tag vocabulary here would have left both hosts open. If a
    // future change starts filtering on the server too, this test is the one to
    // re-argue rather than quietly delete.
    const server = new GameServer();
    const session = joinServer(server, fakeWs(), 97, 'Alpha');
    const raw = JSON.stringify({
      t: 'cmd',
      cmd: 'harvestCorpse',
      id: 4242,
      components: ['claw'],
    });
    const spy = vi.spyOn(server.sim, 'harvestCorpse').mockImplementation(() => {});
    (server as any).dispatchMessage(session, JSON.parse(raw), raw, 0);
    expect(spy).toHaveBeenCalledWith(4242, ['claw'], session.pid);
  });

  it('refuses the frame end to end, claim intact, and reports it to that client only', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const bystanderFc = fakeWs();
    const session = joinServer(server, fc, 98, 'Alpha');
    // A second client standing on the same corpse: the refusal is a personal
    // event, so it must reach Alpha's socket and NOT Bravo's. Without this
    // client the routing half of the title would assert nothing.
    const bystander = joinServer(server, bystanderFc, 198, 'Bravo');
    const internals = server.sim as unknown as SimInternals;
    for (const pid of [session.pid, bystander.pid]) {
      const e = internals.entities.get(pid)!;
      e.pos = { x: 0, y: 0, z: 0 };
      e.prevPos = { x: 0, y: 0, z: 0 };
    }
    const template = MOBS.old_greyjaw;
    const mobId = Math.max(...internals.entities.keys()) + 1;
    const mob = createMob(mobId, template, template.maxLevel, { x: 2, y: 0, z: 0 });
    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    internals.entities.set(mob.id, mob);
    // `t: 'cmd'` is the real envelope; without it the dispatcher drops the
    // frame as a protocol anomaly and this test would pass on an untouched
    // corpse for the wrong reason.
    const raw = JSON.stringify({ t: 'cmd', cmd: 'harvestCorpse', id: mobId, components: ['claw'] });
    (server as any).dispatchMessage(session, JSON.parse(raw), raw, 0);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(server.sim.countItem('rough_hide', session.pid)).toBe(0);
    // The refusal really rides the wire, to the harvester alone. A gate that
    // returned silently would leave the claim intact too, so without this the
    // whole "in silence" half of #2509 would go unpinned over the wire, and a
    // gate that stamped the wrong pid would broadcast it to the bystander.
    // routeEvents is the real fan-out the tick loop drives; the events frame
    // is `{t:'events', list:[...]}`, separate from the snapshot frame.
    (server as any).routeEvents(server.sim.drainEvents());
    const errorsFor = (sent: any[]) =>
      sent
        .filter((frame) => frame.t === 'events')
        .flatMap((frame) => frame.list as any[])
        .filter((e) => e.type === 'error')
        .map((e) => e.text);
    expect(errorsFor(fc.sent)).toEqual(['Nothing you selected can be harvested from that corpse.']);
    expect(errorsFor(bystanderFc.sent)).toEqual([]);
    // The discriminator over the same wire: a mapped pick on an identical
    // second server does claim the corpse, so the refusal is the pick's doing.
    const ok = new GameServer();
    const okSession = joinServer(ok, fakeWs(), 99, 'Alpha');
    const okInternals = ok.sim as unknown as SimInternals;
    const okSelf = okInternals.entities.get(okSession.pid)!;
    okSelf.pos = { x: 0, y: 0, z: 0 };
    okSelf.prevPos = { x: 0, y: 0, z: 0 };
    const okMobId = Math.max(...okInternals.entities.keys()) + 1;
    const okMob = createMob(okMobId, template, template.maxLevel, { x: 2, y: 0, z: 0 });
    okMob.dead = true;
    okMob.aiState = 'dead';
    okMob.corpseTimer = 9999;
    okMob.respawnTimer = 9999;
    okInternals.entities.set(okMob.id, okMob);
    const okRaw = JSON.stringify({
      t: 'cmd',
      cmd: 'harvestCorpse',
      id: okMobId,
      components: ['hide'],
    });
    (ok as any).dispatchMessage(okSession, JSON.parse(okRaw), okRaw, 0);
    expect(okMob.harvestClaimedBy).toBe(okSession.pid);
    expect(ok.sim.countItem('rough_hide', okSession.pid)).toBeGreaterThan(0);
  });
});
