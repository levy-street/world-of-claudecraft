// The corpse-harvest result event (#2457): one `harvestResult` per harvest
// command that landed something, carrying ONE entry per distinct granted item.
//
// The bug it closes: corpse harvest was the last profession flow still logging
// through the grant hub. It reaches the hub from six call sites inside
// harvestCorpse, so a two-component corpse printed two "You receive:" lines and
// two generic dings for one keypress, and a specimen proc on a two-specimen
// corpse (Mire Prowler) printed four of each. #2430 gave the other six flows a
// `callerLogs` flag that stands the hub line down, and deliberately skipped
// this one: with no result event of its own, flagging the grants would have
// made the whole harvest invisible. This suite pins the missing event, the
// flags it unlocks, and the arms of the harvest that feed it.
//
// Rig note: the two-player `setup()` construction order below matches
// tests/corpse_harvest_sim.test.ts exactly, because the seeds are hunted
// against it and a different number of `addPlayer` calls before the harvest
// shifts the world's draw positions.

import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { MONSTER_MATERIAL_TIERS } from '../src/sim/content/professions';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

type SimInternals = {
  entities: Map<number, Entity>;
  players: Map<number, PlayerMeta>;
};

function setup(seed: number, templateId = 'forest_wolf') {
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
  const template = MOBS[templateId];
  const mob = createMob(9999, template, template.maxLevel, { x: 0, y: 0, z: 0 });
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  internals.entities.set(mob.id, mob);
  return { sim, internals, a, b, mob };
}

// Fill every free slot with distinct 1-per-slot gear so the next add has
// nowhere to go (the tests/bags.test.ts fillBags idiom, per-player).
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

type HarvestResultEvent = Extract<SimEvent, { type: 'harvestResult' }>;
type LootEvent = Extract<SimEvent, { type: 'loot' }>;

/** Run one harvest against a drained event stream and split the result. */
function harvest(
  sim: Sim,
  mobId: number,
  components: string[] | undefined,
  pid: number,
): { results: HarvestResultEvent[]; loots: LootEvent[]; events: SimEvent[] } {
  sim.drainEvents();
  sim.harvestCorpse(mobId, components, pid);
  const events = sim.drainEvents();
  return {
    results: events.filter((e): e is HarvestResultEvent => e.type === 'harvestResult'),
    loots: events.filter((e): e is LootEvent => e.type === 'loot'),
    events,
  };
}

describe('one harvestResult per harvest command (#2457)', () => {
  it('a two-component harvest emits exactly ONE event, with one entry per distinct item', () => {
    // The everyday case the issue measures: two item-mapped tags is the most
    // any shipped mob carries, and it used to print two hub lines.
    const { sim, a, mob } = setup(3);
    const { results } = harvest(sim, mob.id, undefined, a);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      type: 'harvestResult',
      pid: a,
      yields: [
        { itemId: 'rough_hide', qty: 1, rarity: 'common', kind: 'plain' },
        { itemId: 'wolf_fang', qty: 2, rarity: 'common', kind: 'plain' },
      ],
    });
  });

  it('is personal: the pid is the harvester, so it never reaches the loser of the race', () => {
    // Personal delivery is what the server router (ev.pid === anchorPid) and
    // the HUD's own pid gate both key off. A wrong pid would silently drop the
    // whole harvest's feedback online.
    const { sim, a, b, mob } = setup(3);
    const { results } = harvest(sim, mob.id, undefined, a);
    expect(results[0].pid).toBe(a);
    expect(results[0].pid).not.toBe(b);
    // The corpse is single-use, so Bravo's later attempt is denied and emits
    // nothing at all.
    expect(harvest(sim, mob.id, undefined, b).results).toHaveLength(0);
  });

  it('every grant behind the event stands BOTH hub halves down, on every arm', () => {
    // The load-bearing half of the fix: the hub still emits its loot events
    // (the bag mirror, the discovery ledger and the quest hooks all ride
    // them), but each one carries silent + callerLogs so neither the generic
    // ding nor the "You receive:" line stacks on top of the event's own line.
    //
    // Driven across the ARMS, not just the ordinary roll. harvestCorpse reaches
    // the hub from six call sites and a single-seed case only ever touches the
    // plain one, so `silent` would sit unpinned on the premium arms and a
    // specimen proc could quietly ship two cues for one command. Each row below
    // is a distinct grant site: the seeds are the same ones the per-arm cases
    // above and below use, and the bag-full rows drive the downgrade
    // fallbacks. The tool-gate deny arm cannot be reached from content (every
    // MONSTER_MATERIAL_TIERS row is tier 1) and is covered by its own case
    // further down, plus the source sweep in
    // tests/professions_silent_loot.test.ts.
    const arms: { name: string; loots: LootEvent[] }[] = [];
    const plain = setup(3);
    arms.push({
      name: 'ordinary roll',
      loots: harvest(plain.sim, plain.mob.id, undefined, plain.a).loots,
    });
    const signed = setup(30);
    arms.push({
      name: 'signed non-specimen',
      loots: harvest(signed.sim, signed.mob.id, undefined, signed.a).loots,
    });
    const jackpot = setup(23);
    arms.push({
      name: 'specimen jackpot',
      loots: harvest(jackpot.sim, jackpot.mob.id, undefined, jackpot.a).loots,
    });
    const markLost = setup(5);
    fillBags(markLost.sim, markLost.internals, markLost.a);
    markLost.internals.players.get(markLost.a)!.inventory[0] = { itemId: 'wolf_fang', count: 1 };
    arms.push({
      name: 'full-bag mark loss',
      loots: harvest(markLost.sim, markLost.mob.id, ['fang'], markLost.a).loots,
    });
    const findLost = setup(5);
    fillBags(findLost.sim, findLost.internals, findLost.a);
    findLost.internals.players.get(findLost.a)!.inventory[0] = { itemId: 'rough_hide', count: 1 };
    arms.push({
      name: 'full-bag specimen truncation',
      loots: harvest(findLost.sim, findLost.mob.id, ['hide'], findLost.a).loots,
    });

    for (const arm of arms) {
      // Never vacuous: an arm that stopped granting would otherwise pass an
      // empty loop.
      expect(arm.loots.length, arm.name).toBeGreaterThanOrEqual(1);
      for (const ev of arm.loots) {
        expect(ev.silent, `${arm.name}: ${ev.text}`).toBe(true);
        expect(ev.callerLogs, `${arm.name}: ${ev.text}`).toBe(true);
      }
    }
    // The arms really are distinct grant sites, not five runs of the same one:
    // the specimen row grants a third item the plain row never does, and the
    // signed row's fang lands as an instance.
    expect(arms[0].loots).toHaveLength(2);
    expect(arms[2].loots).toHaveLength(3);
    // The signed row's multi-unit grant is ONE batched call, so it is one loot
    // event and one cue (#2473). A regression that looped the grant per unit
    // would keep the site-count sweep in tests/professions_silent_loot.test.ts
    // green while quietly firing a burst here.
    expect(arms[1].loots).toHaveLength(2);
  });

  it('reports quantities that match what actually landed in the bags', () => {
    // A ledger that drifted from the grants would print a line for units the
    // player never received. Checked against the inventory, not the roll.
    // Driven on the plain roll AND on the signed arm, whose entry carries the
    // rolled quantity of its own (#2473): a count passed to addItemInstance
    // that disagreed with the recorded one would otherwise go unseen.
    const seen: HarvestResultEvent['yields'] = [];
    for (const seed of [3, 30]) {
      const { sim, a, mob } = setup(seed);
      const { results } = harvest(sim, mob.id, undefined, a);
      expect(results[0].yields.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const y of results[0].yields) {
        expect(sim.countItem(y.itemId, a), `seed ${seed} ${y.itemId}`).toBe(y.qty);
        seen.push(y);
      }
    }
    // Never vacuous on the arm this case was widened for: seed 30 must really
    // have reached the multi-unit signed grant.
    expect(seen.some((y) => y.kind === 'signed' && y.qty > 1)).toBe(true);
  });

  it('adds no rng draw: the event is composed from grants that already happened', () => {
    // The draw sequence through harvestCorpse is load-bearing (one tier roll
    // plus one rarity roll per yielded component, in yield order), and the
    // emit must be purely additive to it.
    const { sim, a, mob } = setup(3);
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      sim.harvestCorpse(mob.id, ['hide'], a);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(draws).toBe(2);
  });
});

describe('the four grant arms each report themselves (#2457)', () => {
  it('ordinary roll: every entry is plain, and a multi-unit yield carries its count', () => {
    const { sim, a, mob } = setup(3);
    const { results } = harvest(sim, mob.id, undefined, a);
    expect(results[0].yields.map((y) => y.kind)).toEqual(['plain', 'plain']);
    // Both quantity variants in one harvest, which is what makes the client's
    // singular/quantity key choice reachable from a single case.
    expect(results[0].yields.map((y) => y.qty)).toEqual([1, 2]);
  });

  it('signed non-specimen family: the fang reports the signed arm at its rolled rarity', () => {
    // fang has no Pristine specimen (HARVEST_COMPONENT_SPECIMENS), so a
    // rare-or-better roll signs the component itself (#1145).
    const { sim, internals, a, mob } = setup(30);
    const { results } = harvest(sim, mob.id, undefined, a);
    expect(results[0].yields).toEqual([
      { itemId: 'rough_hide', qty: 1, rarity: 'common', kind: 'plain' },
      // The signed entry carries the roll's own quantity (#2473), which is what
      // makes the client's quantity key reachable on this arm at all.
      { itemId: 'wolf_fang', qty: 4, rarity: 'rare', kind: 'signed' },
    ]);
    // The arm identity: a signed instance really did land, stamped with the
    // harvester's name, so 'signed' is not just a label on a plain grant.
    const meta = internals.players.get(a)!;
    expect(meta.inventory.find((s) => s.itemId === 'wolf_fang')?.instance?.signer).toBe('Alpha');
  });

  it('specimen jackpot: the specimen is its OWN entry beside the plain component', () => {
    // The acceptance contract: a proc adds a line, it never replaces the
    // component's own yield line.
    const { sim, internals, a, mob } = setup(23);
    const { results } = harvest(sim, mob.id, undefined, a);
    expect(results[0].yields).toEqual([
      { itemId: 'rough_hide', qty: 1, rarity: 'rare', kind: 'plain' },
      { itemId: 'wolf_fang', qty: 1, rarity: 'uncommon', kind: 'plain' },
      { itemId: 'pristine_hide', qty: 1, rarity: 'rare', kind: 'specimen' },
    ]);
    const meta = internals.players.get(a)!;
    expect(meta.inventory.find((s) => s.itemId === 'pristine_hide')?.instance?.signer).toBe(
      'Alpha',
    );
  });

  it('all three kinds can ride one command', () => {
    // Seed 11 signs both wolf families: hide procs its specimen, fang signs
    // itself. Proof the three arms compose rather than shadowing each other.
    const { sim, a, mob } = setup(11);
    const { results } = harvest(sim, mob.id, undefined, a);
    expect(results[0].yields).toEqual([
      { itemId: 'rough_hide', qty: 2, rarity: 'rare', kind: 'plain' },
      { itemId: 'wolf_fang', qty: 2, rarity: 'rare', kind: 'signed' },
      // The specimen stays exactly one whatever the component rolled (#2473):
      // it is a jackpot, not a quantity.
      { itemId: 'pristine_hide', qty: 1, rarity: 'rare', kind: 'specimen' },
    ]);
  });

  it('full-bag mark loss: the entry reports the PLAIN top-up it actually became', () => {
    // The ledger records what landed, not what was rolled. A 'signed' entry
    // here would name an instance the player does not hold; the mark-lost
    // toast is what tells them the signature is the thing that got away.
    const { sim, internals, a, mob } = setup(5);
    fillBags(sim, internals, a);
    const m = internals.players.get(a)!;
    m.inventory[0] = { itemId: 'wolf_fang', count: 1 };
    expect(m.inventory.length).toBe(bagCapacity(m.bags));
    const { results, events } = harvest(sim, mob.id, ['fang'], a);
    expect(results[0].yields).toEqual([
      { itemId: 'wolf_fang', qty: 3, rarity: 'rare', kind: 'plain' },
    ]);
    expect(m.inventory.some((s) => s.itemId === 'wolf_fang' && s.instance)).toBe(false);
    // The pre-existing toast is unchanged, still exactly once.
    expect(events.filter((e) => e.type === 'gatherDowngrade')).toEqual([
      { type: 'gatherDowngrade', pid: a, surface: 'corpse', lost: 'mark' },
    ]);
  });

  it('full-bag specimen truncation: the dropped jackpot contributes NO entry', () => {
    // Nothing landed, so no line may claim it did. The find-lost toast is the
    // whole of that half of the feedback.
    const { sim, internals, a, mob } = setup(5);
    fillBags(sim, internals, a);
    const m = internals.players.get(a)!;
    m.inventory[0] = { itemId: 'rough_hide', count: 1 };
    expect(m.inventory.length).toBe(bagCapacity(m.bags));
    const { results, events } = harvest(sim, mob.id, ['hide'], a);
    expect(results[0].yields).toEqual([
      { itemId: 'rough_hide', qty: 3, rarity: 'rare', kind: 'plain' },
    ]);
    expect(results[0].yields.some((y) => y.kind === 'specimen')).toBe(false);
    expect(m.inventory.some((s) => s.itemId === 'pristine_hide')).toBe(false);
    expect(events.filter((e) => e.type === 'gatherDowngrade')).toEqual([
      { type: 'gatherDowngrade', pid: a, surface: 'corpse', lost: 'find' },
    ]);
  });

  it('premium tool-gate denial: the downgraded family still reports its plain yield', () => {
    // The deny arm grants the plain component and skips the premium push. It
    // is unreachable in shipped content (every MONSTER_MATERIAL_TIERS row is
    // tier 1), so the tier is raised for the duration of the call, the same
    // seam tests/corpse_harvest_sim.test.ts uses to drive the real arm.
    const tiers = MONSTER_MATERIAL_TIERS as Record<string, number>;
    const prior = tiers.hide;
    const { sim, a, mob } = setup(5);
    sim.drainEvents();
    tiers.hide = 2;
    try {
      sim.harvestCorpse(mob.id, ['hide'], a);
    } finally {
      tiers.hide = prior;
    }
    const events = sim.drainEvents();
    const results = events.filter((e): e is HarvestResultEvent => e.type === 'harvestResult');
    expect(results[0].yields).toEqual([
      { itemId: 'rough_hide', qty: 3, rarity: 'rare', kind: 'plain' },
    ]);
    // No specimen was pushed, and the pre-existing denial toast is unchanged.
    expect(sim.countItem('pristine_hide', a)).toBe(0);
    expect(events.filter((e) => e.type === 'gatherDenied')).toEqual([
      { type: 'gatherDenied', pid: a, surface: 'corpse', requiredTier: 2 },
    ]);
  });
});

describe('the worst case in shipped content (#2457)', () => {
  it('a Mire Prowler double proc is four entries, one per distinct item, in one event', () => {
    // The case the issue names: hide and meat both have specimens, so a
    // rare-or-better roll on both used to print four "You receive:" lines and
    // four dings. It is still four ITEMS, so still four lines, but now one
    // event, one cue, and every line carries its rarity, count and link.
    expect(MOBS.mire_prowler.componentTags).toEqual(['hide', 'claw', 'meat']);
    const { sim, a, mob } = setup(1, 'mire_prowler');
    const { results, loots } = harvest(sim, mob.id, undefined, a);
    expect(results).toHaveLength(1);
    expect(results[0].yields).toEqual([
      { itemId: 'rough_hide', qty: 2, rarity: 'rare', kind: 'plain' },
      { itemId: 'game_meat', qty: 2, rarity: 'rare', kind: 'plain' },
      { itemId: 'pristine_hide', qty: 1, rarity: 'rare', kind: 'specimen' },
      { itemId: 'prime_cut', qty: 1, rarity: 'rare', kind: 'specimen' },
    ]);
    // The 'claw' tag maps to no item, so it contributes neither a grant nor an
    // entry: four grants, four entries, never a phantom fifth line.
    expect(loots).toHaveLength(4);
  });
});

describe('a harvest that lands nothing never gets that far (#2457, #2513)', () => {
  it('a corpse whose every tag maps to no item is refused, so there is nothing to report', () => {
    // fen_troll carries claw and tusk, neither of which is in
    // HARVEST_COMPONENT_ITEMS. The "no result event, no loot line" half of this
    // pin is the #2457 contract and still holds; what changed is WHY. Pre-#2513
    // the claim was spent and the ledger was skipped, so the client got a
    // no-op it could not distinguish from a lost keypress. Now the command is
    // refused at the corpse-level gate before the claim, and the one thing the
    // player gets is the refusal.
    expect(MOBS.fen_troll.componentTags).toEqual(['claw', 'tusk']);
    const { sim, a, mob } = setup(3, 'fen_troll');
    const { results, loots, events } = harvest(sim, mob.id, undefined, a);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(results).toHaveLength(0);
    expect(loots).toHaveLength(0);
    // Exactly one event, and it is the refusal: no cue is ever cued for a no-op.
    expect(events).toEqual([
      { type: 'error', pid: a, text: 'That corpse has nothing to harvest.' },
    ]);
  });

  it('still emits the ledger on the mixed corpse next door, so the gate is not a mute button', () => {
    // The discriminator on the same rig: mire_prowler also carries the unmapped
    // `claw`, but it carries hide and meat too, so it harvests and reports.
    expect(MOBS.mire_prowler.componentTags).toEqual(['hide', 'claw', 'meat']);
    const { sim, a, mob } = setup(3, 'mire_prowler');
    const { results, loots } = harvest(sim, mob.id, undefined, a);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(results).toHaveLength(1);
    expect(loots.length).toBeGreaterThan(0);
  });
});

describe('corpse LOOT is untouched by the harvest fix (#2457)', () => {
  it('a looted corpse item still prints its own hub line and plays its own ding', () => {
    // The unified interact press runs the harvest and then lootCorpse, so a
    // flag that leaked out of harvestCorpse into the shared hub would silence
    // ordinary mob loot for everyone. lootCorpse's grant must stay unflagged.
    const { sim, internals, a, mob } = setup(3);
    mob.lootable = true;
    mob.loot = { copper: 0, items: [{ itemId: 'rough_hide', count: 1 }] };
    mob.targetId = a;
    sim.drainEvents();
    sim.lootCorpse(mob.id, a);
    const loots = sim.drainEvents().filter((e): e is LootEvent => e.type === 'loot');
    expect(loots.length).toBeGreaterThan(0);
    for (const ev of loots) {
      expect(ev.silent).toBeUndefined();
      expect(ev.callerLogs).toBeUndefined();
      expect(ev.text).toContain('You receive:');
    }
    expect(internals.players.get(a)!.inventory.length).toBeGreaterThan(0);
  });
});
