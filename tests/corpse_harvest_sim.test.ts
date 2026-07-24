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
import {
  bestOwnedAnyGatherToolTier,
  canHarvestMonsterMaterial,
} from '../src/sim/professions/tools';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

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

  it('a tagged corpse with no mapped item consumes the claim and yields nothing', () => {
    // fen_troll's tags (claw, tusk) map to no harvest item yet: the documented
    // deferred-design path (single-use claimed, zero yield, zero emits; the
    // silent success is flagged upstream as an open design call, so this pin
    // locks the CURRENT behavior and reds intentionally if that call lands).
    const { sim, internals, a, b } = setup();
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
    sim.harvestCorpse(noYieldMob.id, undefined, a);
    expect(sim.drainEvents()).toEqual([]);
    expect(noYieldMob.harvestClaimedBy).toBe(a);
    expect(internals.players.get(a)!.inventory.length).toBe(before);
    // The zero-yield claim is still single-use for everyone else.
    sim.harvestCorpse(noYieldMob.id, undefined, b);
    expect(noYieldMob.harvestClaimedBy).toBe(a);
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
// to land on each side of the rarity floor.
describe('signed Pristine specimens (#1145)', () => {
  it('a rare-or-better harvest grants the signed specimen PLUS the plain component (seed 5)', () => {
    const { sim, internals, a, mob } = setup(5);
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

  it('a below-rare harvest grants a plain stack at its tier quantity and NO specimen (seed 2)', () => {
    const { sim, internals, a, mob } = setup(2);
    sim.harvestCorpse(mob.id, ['hide'], a);
    const meta = internals.players.get(a)!;
    const slot = meta.inventory.find((s) => s.itemId === 'rough_hide');
    expect(slot).toBeDefined();
    expect(slot?.instance).toBeUndefined();
    // This seed's focus-tier roll lands above the poor floor, so the fungible
    // grant is more than a single unit (harvestTierQuantity(tier), #1142).
    expect(sim.countItem('rough_hide', a)).toBe(2);
    expect(sim.countItem('pristine_hide', a)).toBe(0);
  });

  it('a specimen-less family (fang) keeps the signed-component behavior at rare-or-better (seed 5)', () => {
    const { sim, internals, a, mob } = setup(5);
    sim.harvestCorpse(mob.id, ['fang'], a);
    const meta = internals.players.get(a)!;
    const slot = meta.inventory.find((s) => s.itemId === 'wolf_fang');
    expect(slot).toBeDefined();
    expect(slot?.instance?.signer).toBe('Alpha');
    expect(sim.countItem('wolf_fang', a)).toBe(1);
  });

  it('every other specimen family grants its own jackpot beside the plain component (seed 5)', () => {
    // The hide row is exercised above; this sweeps the remaining three
    // specimen rows behaviorally (silk and venomSac via webwood_spider, meat
    // via wild_boar), so a mistargeted HARVEST_COMPONENT_SPECIMENS row cannot
    // hide behind hide-only coverage. Seed 5's rarity roll clears the
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
      const { sim, internals, a } = setup(5);
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

  it('the cloth family (no specimen) grants the signed component at rare-or-better (seed 5)', () => {
    const { sim, internals, a } = setup(5);
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
    expect(sim.countItem('homespun_cloth', a)).toBe(1);
  });

  it('a slot-full signed-family harvest falls back to the plain stack, never over capacity (seed 5)', () => {
    // The pre-gate reserves plain-stack room only, so a partial stack lets it
    // pass while a signed instance would still need a fresh slot. The rare+
    // arm must then fall back to the plain fungible top-up (the signature
    // truncates, the yield does not), same free-slot contract as the
    // specimen arm.
    const { sim, internals, a, mob } = setup(5);
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
    // Seed 5's rarity roll clears the signable floor with this exact draw
    // sequence (proven by the unfixed code overflowing here), so the count
    // above the seeded 1 proves the plain fallback delivered the yield.
    expect(sim.countItem('wolf_fang', a)).toBeGreaterThan(1);
    // Downgrade notice: the unsigned fallback tells the player, exactly once,
    // with the mark-lost arm (the yield survived, the signature did not).
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toEqual([
      { type: 'gatherDowngrade', pid: a, surface: 'corpse', lost: 'mark' },
    ]);
  });

  it('a slot-full specimen harvest truncates the specimen and keeps the plain yield (seed 5)', () => {
    // Plain grant tops up the partial stack without opening a slot, so the
    // specimen guard sees a full bag: the jackpot truncates rather than
    // overflowing, and the plain component still arrives.
    const { sim, internals, a, mob } = setup(5);
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

  it('with a genuinely spare slot the jackpot still lands beside both plain yields (seed 1)', () => {
    // Seed 1 pre-verified: the hide rarity roll clears the signable floor with
    // this exact draw sequence (the rolls are inventory-independent, so this
    // arm also proves the two-free-slot arm below EARNED its jackpot).
    const { sim, internals, a } = setup(1);
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

  it('with exactly the reserved free slots the jackpot truncates, never the plain yield (seed 1)', () => {
    // Two free slots = exactly the pre-gate's reservation for the two plain
    // stacks. The unfixed code granted pristine_hide into the slot reserved
    // for game_meat and spilled the meat stack past capacity (17 of 16).
    const { sim, internals, a } = setup(1);
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

  it('a slot-full bag with a same-signer stack WITH room keeps the signature: the grant merges (seed 5)', () => {
    // Seed 5's fang roll clears the signable floor (pre-verified above). Slot
    // 0 is the plain partial stack the pre-gate reserves against (and the
    // would-be fallback target); slot 1 is the byte-equal same-signer stack
    // whose room the merge-aware guard must accept with zero free slots.
    const { sim, internals, a, mob } = setup(5);
    fillBags(sim, internals, a);
    const m = internals.players.get(a)!;
    const cap = bagCapacity(m.bags);
    m.inventory[0] = { itemId: 'wolf_fang', count: 1 };
    m.inventory[1] = { itemId: 'wolf_fang', count: 3, instance: { signer: 'Alpha' } };
    expect(m.inventory.length).toBe(cap);
    sim.drainEvents();
    sim.harvestCorpse(mob.id, ['fang'], a);
    expect(mob.harvestClaimedBy).toBe(a);
    // The signed grant merged into the same-signer stack: one unit, no new
    // slot, no overflow, and the plain stack was never topped up.
    expect(m.inventory.length).toBe(cap);
    const signed = m.inventory.find((s) => s.itemId === 'wolf_fang' && s.instance);
    expect(signed?.instance?.signer).toBe('Alpha');
    expect(signed?.count).toBe(4);
    const plain = m.inventory.find((s) => s.itemId === 'wolf_fang' && !s.instance);
    expect(plain?.count).toBe(1);
    // The signature survived: no downgrade notice fires.
    expect(sim.drainEvents().filter((e) => e.type === 'gatherDowngrade')).toHaveLength(0);
  });

  it('a slot-full bag with the same-signer stack AT its cap still falls back plain, at the boundary (seed 5)', () => {
    // The boundary tick: the same-signer stack sits EXACTLY at stackSizeOf,
    // so it offers zero merge room and the guard must refuse, top up the
    // plain stack, and emit the mark-lost downgrade, never overflow.
    const { sim, internals, a, mob } = setup(5);
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

  it('a slot-full specimen jackpot merges into a same-signer specimen stack instead of truncating (seed 5)', () => {
    // The specimen arm shares the merge-aware guard: with the plain component
    // topping up its own partial stack, the jackpot's only room is the
    // byte-equal same-signer specimen stack, and it must land there signed
    // (the pre-merge contract truncated it outright, lost: 'find').
    const { sim, internals, a, mob } = setup(5);
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

  it('bare hands still earn the signed specimen on real content: tier-1 families never gate (seed 5)', () => {
    const { sim, internals, a, mob } = setup(5);
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

  it('a denied premium pull downgrades to the plain grant: same qty, same claim, same draws (seed 5)', () => {
    // Baseline arm, unmutated: seed 5's rarity roll clears the signable floor,
    // so the specimen jackpot lands beside the plain component.
    const base = soloRig(5);
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
    const { sim, internals, a, mob } = soloRig(5);
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

  it('an owned tier-2 tool restores the premium pull at a raised family tier (seed 5)', () => {
    // The canHarvestMonsterMaterial SUCCESS branch with a real tool: the
    // deny/downgrade arms above never prove a tool actually re-opens the
    // premium pull once a family tier rises.
    const { sim, internals, a, mob } = soloRig(5);
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

  it('at most ONE gatherDenied per harvest command, even with several denied families (seed 11)', () => {
    // Seed 11 pre-verified against soloRig: BOTH wolf families (hide and
    // fang) roll signable on an untagged harvest, so raising both tiers
    // denies two yields in one command; the dedupe flag must emit exactly one
    // event, tiered off the FIRST failing family.
    const base = soloRig(11);
    base.sim.harvestCorpse(base.mob.id, undefined, base.a);
    const baseMeta = base.internals.players.get(base.a)!;
    expect(base.sim.countItem('pristine_hide', base.a)).toBe(1);
    expect(
      baseMeta.inventory.some((s) => s.itemId === 'wolf_fang' && s.instance?.signer === 'Alpha'),
    ).toBe(true);

    const { sim, internals, a, mob } = soloRig(11);
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

  it('the single event is tiered off the FIRST failing family in yield order (seed 11)', () => {
    // hide precedes fang in the wolf's yield order, so asymmetric raised
    // tiers discriminate FIRST from min/max/last: (hide 2, fang 3) emits 2
    // (ruling out max and last), the mirror (hide 3, fang 2) emits 3 (ruling
    // out min). Same pre-hunted seed-11 rig as the dedupe arm above.
    const first = soloRig(11);
    first.sim.drainEvents();
    withTier('hide', 2, () => {
      withTier('fang', 3, () => {
        first.sim.harvestCorpse(first.mob.id, undefined, first.a);
      });
    });
    expect(first.sim.drainEvents().filter((e) => e.type === 'gatherDenied')).toEqual([
      { type: 'gatherDenied', pid: first.a, surface: 'corpse', requiredTier: 2 },
    ]);
    const mirror = soloRig(11);
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
