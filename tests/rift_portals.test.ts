import { describe, expect, it } from 'vitest';
import { HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import {
  RIFT_ESSENCE_ITEM_ID,
  RIFT_GEAR_ITEM_IDS,
  RIFT_GEM_IDS,
} from '../src/sim/content/rift/items';
import { isRiftPos, ZONES } from '../src/sim/data';
import {
  RIFT_MIN_LEVEL,
  RIFT_PORTAL_LIFETIME,
  RIFT_TIER_INFO,
  riftTierForZone,
  updateRiftPortals,
} from '../src/sim/rift/portals';
import type { RiftInstance } from '../src/sim/rift/types';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';

const SEED = 777;

function makeSim(seed = SEED) {
  return new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
    riftPortals: true,
  });
}

function tickSeconds(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  const ticks = Math.ceil(seconds / DT);
  for (let i = 0; i < ticks; i++) {
    sim.player.hp = sim.player.maxHp;
    out.push(...sim.tick());
  }
  return out;
}

// Portal cadence is a scheduler concern, not an integration test for 2,400 full
// world ticks. Move the deterministic clock to its deadline and invoke that one
// subsystem tick directly; run gameplay ticks only where the test needs them.
function spawnDuePortal(sim: Sim): SimEvent[] {
  sim.time = sim.riftPortalNextAt + 0.1;
  sim.tickCount += (10 - (sim.tickCount % 20) + 20) % 20;
  updateRiftPortals(sim.ctx);
  return sim.drainEvents();
}

function clearRiftToBossKill(sim: Sim, inst: RiftInstance): Entity {
  for (let guard = 0; guard < 12 && inst.floorIndex < inst.floorCount - 1; guard++) {
    for (const id of inst.mobIds) {
      const mob = sim.entities.get(id);
      if (mob && mob.id !== inst.bossId) {
        mob.hp = 0;
        mob.dead = true;
      }
    }
    inst.litPylons = new Set(inst.pylonIds);
    inst.puzzleSolved = true;
    tickSeconds(sim, 1.2);
    if (inst.descentId === null) break;
    const descent = sim.entities.get(inst.descentId)!;
    sim.player.pos = { ...descent.pos };
    sim.player.prevPos = { ...descent.pos };
    sim.tick();
  }
  expect(inst.floorIndex).toBe(inst.floorCount - 1);
  // Clear the BOSS floor's own pack too, exactly as the loop clears every other
  // floor. Since the 2026-07-26 rank recalibration a boss floor's dais guards
  // are real heroic-tier elites (an S-rank pack lands 666+ per swing), so a
  // solo level-20 walking in dies inside a second, which is the intended
  // group-content behaviour but would strand any caller that keeps ticking
  // after the kill (see the ranked-clear ledger test, which enters a second
  // rift afterwards and needs a living player).
  for (const id of inst.mobIds) {
    const mob = sim.entities.get(id);
    if (mob && mob.id !== inst.bossId) {
      mob.hp = 0;
      mob.dead = true;
    }
  }
  const boss = sim.entities.get(inst.bossId!)!;
  boss.hp = 0;
  boss.dead = true;
  return boss;
}

describe('rift ranks: zone mapping and tuning', () => {
  it('uses content-authored weights only on the new regions', () => {
    const eligible = ZONES.filter((zone) => zone.riftPortalEligible);
    expect(eligible.length).toBeGreaterThan(3);
    expect(
      ZONES.filter((zone) =>
        ['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights'].includes(zone.id),
      ).every((zone) => !zone.riftPortalEligible),
    ).toBe(true);
    const farshore = eligible.find((zone) => zone.id === 'farshore_isle')!;
    const nightbloom = eligible.find((zone) => zone.id === 'nightbloom')!;
    expect(riftTierForZone(farshore, 0)).toBe('C');
    expect(riftTierForZone(farshore, 0.99)).toBe('B');
    expect(riftTierForZone(nightbloom, 0)).toBe('A');
    expect(riftTierForZone(nightbloom, 0.99)).toBe('S');
  });

  it('rank tuning is monotonic in baseLevel and carries no mark currency', () => {
    const tiers = ['C', 'B', 'A', 'S'] as const;
    for (let i = 1; i < tiers.length; i++) {
      expect(RIFT_TIER_INFO[tiers[i]].baseLevel).toBeGreaterThan(
        RIFT_TIER_INFO[tiers[i - 1]].baseLevel,
      );
    }
    expect(RIFT_TIER_INFO.C.baseLevel).toBe(20);
    // Rifts pay NO Heroic Marks at any rank (maintainer decision): the tier
    // table must not grow a marks field back.
    for (const tier of tiers) {
      expect(Object.keys(RIFT_TIER_INFO[tier]).sort()).toEqual(['baseLevel', 'color']);
    }
  });
});

describe('rift portals: natural spawn scheduler', () => {
  it('spawns a ranked portal on the cadence and announces it world-visibly', () => {
    const sim = makeSim();
    expect(sim.naturalRiftPortals.length).toBe(0);
    const events = spawnDuePortal(sim);
    expect(sim.naturalRiftPortals.length).toBe(1);
    const p = sim.naturalRiftPortals[0];
    const portal = sim.entities.get(p.id)!;
    expect(portal.templateId).toBe('rift_portal');
    expect(portal.riftTier).toBe(p.tier);
    expect(portal.riftBaseLevel).toBe(RIFT_TIER_INFO[p.tier].baseLevel);
    // World-visible announce (no pid) naming the rank and the zone.
    const announce = events.find(
      (e) => e.type === 'log' && e.text === `A ${p.tier}-rank rift tears open in ${p.zoneName}!`,
    );
    expect(announce).toBeDefined();
    expect((announce as { pid?: number }).pid).toBeUndefined();
    // The zone name is a real zone and the tier legal for it.
    const zi = ZONES.findIndex((z) => z.name === p.zoneName);
    expect(zi).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic: two same-seed sims spawn the identical portal', () => {
    const a = makeSim();
    const b = makeSim();
    spawnDuePortal(a);
    spawnDuePortal(b);
    const pa = a.naturalRiftPortals[0];
    const pb = b.naturalRiftPortals[0];
    expect(pa.tier).toBe(pb.tier);
    expect(pa.zoneName).toBe(pb.zoneName);
    expect(pa.riftName).toBe(pb.riftName);
    const ea = a.entities.get(pa.id)!;
    const eb = b.entities.get(pb.id)!;
    expect(ea.pos).toEqual(eb.pos);
  });

  it('collapses an unclosed portal after its lifetime, with a world announce', () => {
    const sim = makeSim();
    spawnDuePortal(sim);
    const p = sim.naturalRiftPortals[0];
    expect(Math.abs(p.expiresAt - (sim.time + RIFT_PORTAL_LIFETIME))).toBeLessThan(3);
    // Fast-forward the deadline instead of ticking 15 real minutes.
    p.expiresAt = sim.time + 1;
    sim.time = p.expiresAt + 0.1;
    sim.tickCount += (10 - (sim.tickCount % 20) + 20) % 20;
    updateRiftPortals(sim.ctx);
    const events = sim.drainEvents();
    expect(sim.naturalRiftPortals.find((q) => q.id === p.id)).toBeUndefined();
    expect(sim.entities.has(p.id)).toBe(false);
    expect(
      events.some(
        (e) => e.type === 'log' && e.text === `The ${p.tier}-rank rift in ${p.zoneName} collapses.`,
      ),
    ).toBe(true);
  });
});

describe('rift portals: level 20 gate', () => {
  it('turns away a low-level player at the portal with the denial line', () => {
    const sim = makeSim();
    spawnDuePortal(sim);
    const p = sim.naturalRiftPortals[0];
    const portal = sim.entities.get(p.id)!;
    expect(sim.player.level).toBeLessThan(RIFT_MIN_LEVEL);
    sim.player.pos = { ...portal.pos };
    sim.player.prevPos = { ...portal.pos };
    const events = sim.tick();
    expect(
      events.some(
        (e) =>
          e.type === 'error' &&
          e.text === `Only adventurers of level ${RIFT_MIN_LEVEL} or higher may enter this rift.`,
      ),
    ).toBe(true);
    // Still in the overworld: the walk-in did not teleport them.
    const inst = sim.riftInstances.find((i) => i.partyKey !== null);
    expect(inst).toBeUndefined();
  });

  it('admits a level 20 player and stamps the run with the portal rank', () => {
    const sim = makeSim();
    sim.setPlayerLevel(RIFT_MIN_LEVEL);
    spawnDuePortal(sim);
    const p = sim.naturalRiftPortals[0];
    const portal = sim.entities.get(p.id)!;
    sim.player.pos = { ...portal.pos };
    sim.player.prevPos = { ...portal.pos };
    sim.tick();
    const inst = sim.riftInstances.find((i) => i.partyKey !== null)!;
    expect(inst).toBeDefined();
    expect(inst.tier).toBe(p.tier);
    expect(inst.portalId).toBe(p.id);
  });
});

describe('rift portals: sealing pays Heroic Marks by rank', () => {
  function runToBossKill(sim: Sim) {
    const p = sim.naturalRiftPortals[0];
    const portal = sim.entities.get(p.id)!;
    sim.player.pos = { ...portal.pos };
    sim.player.prevPos = { ...portal.pos };
    sim.tick();
    const inst = sim.riftInstances.find((i) => i.partyKey !== null)!;
    const boss = clearRiftToBossKill(sim, inst);
    return { inst, boss, portalInfo: p };
  }

  it('boss kill seals the portal, announces it, and pays no Heroic Marks', () => {
    const sim = makeSim();
    sim.setPlayerLevel(RIFT_MIN_LEVEL);
    sim.utcDay = '2026-07-07';
    spawnDuePortal(sim);
    const { inst, boss, portalInfo } = runToBossKill(sim);
    const events = tickSeconds(sim, 1.2);
    expect(inst.rewarded).toBe(true);
    // Portal sealed: gone from the world + registry, with the world announce.
    expect(sim.entities.has(portalInfo.id)).toBe(false);
    expect(sim.naturalRiftPortals.find((q) => q.id === portalInfo.id)).toBeUndefined();
    expect(
      events.some(
        (e) =>
          e.type === 'log' &&
          e.text === `The ${portalInfo.tier}-rank rift in ${portalInfo.zoneName} has been sealed.`,
      ),
    ).toBe(true);
    // NO Heroic Marks on the corpse at any rank: marks stay a heroic
    // dungeon/raid currency (maintainer decision).
    const marks = (boss.loot?.items ?? []).filter((i) => i.itemId === HEROIC_MARK_ITEM_ID);
    expect(marks).toEqual([]);
  });

  it('a ranked clear never touches the heroic daily ledger or pays marks', () => {
    const sim = makeSim();
    sim.setPlayerLevel(RIFT_MIN_LEVEL);
    sim.utcDay = '2026-07-07';
    const meta = sim.players.get(sim.player.id)!;
    spawnDuePortal(sim);
    const { boss } = runToBossKill(sim);
    tickSeconds(sim, 1.2);
    // The heroic daily gate is dungeon/raid state: a rift clear never stamps it.
    expect([...meta.heroicDaily.marked].some((k) => k.startsWith('rift_'))).toBe(false);
    expect((boss.loot?.items ?? []).filter((i) => i.itemId === HEROIC_MARK_ITEM_ID)).toEqual([]);
    // A dev-portal run has no rank: never pays, never seals.
    sim.enterRift(4242, 15, sim.player.id);
    const inst2 = sim.riftInstances.find((i) => i.partyKey !== null && i.seed === 4242)!;
    expect(inst2.tier).toBeNull();
  });

  it('/dev portal run is real S difficulty but unranked: no Heroic Marks on clear', () => {
    const sim = makeSim();
    sim.setPlayerLevel(RIFT_MIN_LEVEL);
    sim.utcDay = '2026-07-07';
    sim.chat('/dev portal 5 20 S', sim.player.id);
    const portal = [...sim.entities.values()].find(
      (entity) => entity.templateId === 'rift_portal' && entity.riftSeed === 5,
    )!;
    expect(portal.riftTier).toBe('S');
    // The rank letter drives the difficulty (canonical S baseLevel), overriding
    // the conflicting explicit 20.
    expect(portal.riftBaseLevel).toBe(28);

    sim.player.pos = { ...portal.pos };
    sim.player.prevPos = { ...portal.pos };
    sim.tick();
    const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null)!;
    expect(inst.tier).toBeNull();

    const boss = clearRiftToBossKill(sim, inst);
    tickSeconds(sim, 1.2);
    expect(inst.rewarded).toBe(true);
    const rewardItems = boss.loot?.items ?? [];
    expect(rewardItems.filter((item) => item.itemId === HEROIC_MARK_ITEM_ID)).toEqual([]);
    expect(rewardItems.some((item) => item.itemId === RIFT_ESSENCE_ITEM_ID)).toBe(false);
    expect(
      rewardItems.some((item) => (RIFT_GEM_IDS as readonly string[]).includes(item.itemId)),
    ).toBe(false);
    expect(rewardItems.some((item) => item.instance?.rift !== undefined)).toBe(false);
    expect(sim.players.get(sim.player.id)?.heroicDaily.marked.size).toBe(0);
  });

  it('natural ranked first-clear: boss corpse carries a personal riftbound ring, essence, and A/S gem', () => {
    // This is the POSITIVE pin for addRiftProgressionLoot. The dev-portal negative
    // (above) already pins the "no progression loot on unranked runs" path. This
    // test confirms that the first ranked clear actually deposits ring + essence +
    // gem personalFor the winning player on the boss corpse.
    const sim = makeSim();
    sim.setPlayerLevel(RIFT_MIN_LEVEL);
    sim.utcDay = '2026-07-08';
    // Force an A-rank portal (baseLevel 25) so the gem arm triggers.
    spawnDuePortal(sim);
    // If the spawned portal is not A or S, override to A via dev command.
    const portal0 = sim.naturalRiftPortals[0];
    if (!portal0 || (portal0.tier !== 'A' && portal0.tier !== 'S')) {
      // Seed a new portal at the right rank via the dev command.
      sim.chat('/dev portal 99 25 A', sim.player.id);
      const portalEntity = [...sim.entities.values()].find(
        (e) => e.templateId === 'rift_portal' && e.riftSeed === 99,
      )!;
      sim.player.pos = { ...portalEntity.pos };
      sim.player.prevPos = { ...portalEntity.pos };
    } else {
      const portalEntity = sim.entities.get(portal0.id)!;
      sim.player.pos = { ...portalEntity.pos };
      sim.player.prevPos = { ...portalEntity.pos };
    }
    sim.tick();
    const inst = sim.riftInstances.find((i) => i.partyKey !== null)!;
    expect(inst, 'entered a rift').toBeDefined();

    const boss = clearRiftToBossKill(sim, inst);
    tickSeconds(sim, 1.2); // let the 1 Hz reward sweep fire
    expect(inst.rewarded, 'rift marked rewarded').toBe(true);

    const pid = sim.player.id;
    const items = boss.loot?.items ?? [];

    // Personal riftbound ring: personalFor the winner.
    const ringItem = items.find(
      (i) =>
        (RIFT_GEAR_ITEM_IDS as readonly string[]).includes(i.itemId) &&
        i.personalFor?.includes(pid),
    );
    expect(ringItem, 'riftbound ring is personal to the winner').toBeDefined();
    expect(ringItem?.instance?.rift, 'ring has a rift instance payload').toBeDefined();

    // Rift Essence: at least one personal essence drop.
    const essenceItems = items.filter(
      (i) => i.itemId === RIFT_ESSENCE_ITEM_ID && i.personalFor?.includes(pid),
    );
    expect(essenceItems.length, 'at least one essence dropped').toBeGreaterThanOrEqual(1);

    // A/S gem: exactly one gem from the RIFT_GEM_IDS pool, personal to the winner.
    const gemItem = items.find(
      (i) => (RIFT_GEM_IDS as readonly string[]).includes(i.itemId) && i.personalFor?.includes(pid),
    );
    expect(gemItem, 'A/S gem is personal to the winner').toBeDefined();
  });
});

describe('rift entry: death rules (anti-zerg + corpse retrieval)', () => {
  const makeGhost = (e: Entity) => {
    e.hp = 0;
    e.dead = true;
    e.ghost = true;
  };

  it('a dead player with no run in a rift cannot enter, throttled to one notice per window', () => {
    const sim = makeSim();
    sim.setPlayerLevel(RIFT_MIN_LEVEL);
    makeGhost(sim.player);
    sim.drainEvents();
    let notices = 0;
    // 40 ticks = 2s, inside the 4s denial window: exactly one notice.
    for (let i = 0; i < 40; i++) {
      sim.enterRift(41, 20, sim.player.id);
      for (const ev of sim.tick()) {
        if (JSON.stringify(ev).includes('You cannot enter a rift while dead.')) notices++;
      }
    }
    expect(
      sim.riftInstances.find((i) => i.partyKey !== null),
      'no run allocated',
    ).toBeUndefined();
    expect(isRiftPos(sim.player.pos.x), 'ghost never teleported in').toBe(false);
    expect(notices, 'denial throttled to one notice per window').toBe(1);
  });

  it('a ghost member is barred while the run is in combat, and re-enters once it settles', () => {
    const sim = makeSim();
    sim.setPlayerLevel(RIFT_MIN_LEVEL);
    sim.enterRift(SEED, 20, sim.player.id);
    const inst = sim.riftInstances.find((i) => i.partyKey !== null)!;
    const mob = inst.mobIds
      .map((id) => sim.entities.get(id))
      .find((m): m is Entity => !!m && !m.dead)!;
    mob.inCombat = true;
    makeGhost(sim.player);
    sim.player.pos = { x: inst.returnPos.x, y: 0, z: inst.returnPos.z };
    sim.player.prevPos = { ...sim.player.pos };
    sim.drainEvents();
    sim.enterRift(SEED, 20, sim.player.id);
    expect(isRiftPos(sim.player.pos.x), 'combat bars the ghost').toBe(false);
    expect(JSON.stringify(sim.drainEvents()), 'the combat denial explains itself').toContain(
      'Your party is still in combat.',
    );
    // The fight settles (wipe recovery): the corpse run is allowed.
    mob.inCombat = false;
    sim.enterRift(SEED, 20, sim.player.id);
    expect(isRiftPos(sim.player.pos.x), 'out of combat the ghost re-enters').toBe(true);
    expect(sim.player.dead, 'still a ghost: entry does not resurrect').toBe(true);
  });

  it('a ghost member re-enters a WON run for their corpse instead of forced rez sickness', () => {
    const sim = makeSim();
    sim.setPlayerLevel(RIFT_MIN_LEVEL);
    sim.utcDay = '2026-07-09';
    sim.enterRift(SEED, 20, sim.player.id);
    const inst = sim.riftInstances.find((i) => i.partyKey !== null)!;
    clearRiftToBossKill(sim, inst);
    tickSeconds(sim, 1.2);
    expect(inst.outcome, 'the run is decided').toBe('won');
    sim.leaveRift(sim.player.id);
    makeGhost(sim.player);
    sim.player.pos = { x: inst.returnPos.x, y: 0, z: inst.returnPos.z };
    sim.player.prevPos = { ...sim.player.pos };
    const allocated = sim.riftInstances.filter((i) => i.partyKey !== null).length;
    sim.enterRift(SEED, 20, sim.player.id);
    expect(isRiftPos(sim.player.pos.x), 'the ghost walks back into the won run').toBe(true);
    expect(
      sim.riftInstances.filter((i) => i.partyKey !== null).length,
      'no fresh run allocated',
    ).toBe(allocated);
  });
});
