// Lantern Hall's weekly dungeon contracts (src/sim/guild_contracts.ts) and its quartermaster
// (src/sim/guild_quartermaster.ts): the week's board, credit from the deeds kill path, the
// seals paid once a week, the milestone deeds, the cosmetic-only stock, and the save shape.
import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import {
  GUILD_BOSS_CONTRACTS,
  GUILD_CONTRACT_ITEMS,
  GUILD_CONTRACTS,
  GUILD_HEROIC_CONTRACTS,
  GUILD_QUARTERMASTER_STOCK,
  GUILD_TASK_CONTRACTS,
  LANTERN_SEAL_ITEM_ID,
} from '../src/sim/content/guild_contracts';
import {
  CONTRACT_CLERK_NPC_ID,
  GUILD_QUARTERMASTER_NPC_ID,
  GUILD_RECRUITER_NPC_ID,
  GUILDMASTER_NPC_ID,
  HIGHWATCH_GUILD_ENTITY_IDS,
} from '../src/sim/content/highwatch_guild';
import { DUNGEONS, ITEMS, MOBS } from '../src/sim/data';
import {
  ADD_TASKS,
  FINAL_BOSS_DUNGEONS,
  FLAWLESS_TASKS,
  onMobKillCreditForDeeds,
  SPLASH_TASKS,
} from '../src/sim/deeds';
import {
  guildContractsForWeek,
  onKillForGuildContracts,
  sanitizeGuildContractProgress,
  savedGuildContractProgress,
} from '../src/sim/guild_contracts';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { weeklyQuestWeekForResetDay } from '../src/sim/weekly_quests';

const FIVE = [
  'hollow_crypt',
  'sunken_bastion',
  'drowned_temple',
  'gravewyrm_sanctum',
  'wildheart_basin',
];

/** A reset day whose week posts `contractId` (searching forward from the epoch). */
function dayPosting(contractId: string): string {
  for (let week = 0; week < 400; week++) {
    if (guildContractsForWeek(`wk_${week}`).some((c) => c.id === contractId)) {
      const day = new Date(Date.UTC(2026, 8, 1 + week * 7));
      return day.toISOString().slice(0, 10);
    }
  }
  throw new Error(`no week posts ${contractId}`);
}

function sim(resetDay: string): Sim {
  const s = new Sim({ seed: 7, playerClass: 'warrior' });
  s.resetDay = resetDay;
  return s;
}

function fakeBoss(templateId: string): Entity {
  return { id: 999_999, kind: 'mob', templateId, pos: { x: 0, y: 0, z: 0 }, level: 20 } as Entity;
}

function seals(s: Sim): number {
  const pid = s.player.id;
  return s.ctx.countItem(LANTERN_SEAL_ITEM_ID, pid);
}

describe("the week's board", () => {
  it('posts one contract of each kind, the same for every host, rolling every week', () => {
    for (let week = 0; week < 60; week++) {
      const board = guildContractsForWeek(`wk_${week}`);
      expect(board.map((c) => c.kind)).toEqual(['boss', 'heroic', 'task']);
      expect(guildContractsForWeek(`wk_${week}`)).toEqual(board);
      // never the same board two weeks running
      expect(guildContractsForWeek(`wk_${week + 1}`).map((c) => c.id)).not.toEqual(
        board.map((c) => c.id),
      );
    }
    expect(guildContractsForWeek('')).toEqual([]);
    expect(guildContractsForWeek('wk_x')).toEqual([]);
    // every contract comes round within a season of weeks
    const seen = new Set<string>();
    for (let week = 0; week < 17 * 7; week++) {
      for (const c of guildContractsForWeek(`wk_${week}`)) seen.add(c.id);
    }
    expect([...seen].sort()).toEqual(GUILD_CONTRACTS.map((c) => c.id).sort());
  });

  it("names only the five five-player dungeons' real bosses and real encounter tasks", () => {
    for (const contract of GUILD_CONTRACTS) {
      expect(FIVE, contract.id).toContain(contract.dungeonId);
      expect(DUNGEONS[contract.dungeonId], contract.id).toBeDefined();
      expect(MOBS[contract.mobId], contract.id).toBeDefined();
      const encounters = FINDER_ACTIVITIES.filter(
        (a) => a.dungeonId === contract.dungeonId,
      ).flatMap((a) => a.encounters.map((e) => e.mobId));
      expect(encounters, contract.id).toContain(contract.mobId);
    }
    // a Heroic clear is credited on the dungeon's own final boss
    for (const contract of GUILD_HEROIC_CONTRACTS) {
      expect(FINAL_BOSS_DUNGEONS[contract.mobId], contract.id).toBe(contract.dungeonId);
    }
    expect(GUILD_HEROIC_CONTRACTS.map((c) => c.dungeonId).sort()).toEqual([...FIVE].sort());
    // a task contract is one of the Book's own encounter deeds, on its own boss
    for (const contract of GUILD_TASK_CONTRACTS) {
      expect(DEEDS[contract.taskDeedId ?? ''], contract.id).toBeDefined();
      expect(DEEDS[contract.taskDeedId ?? ''].trigger, contract.id).toEqual({ kind: 'manual' });
    }
    expect(FLAWLESS_TASKS.morthen).toBe('dgn_morthen_flawless');
    expect(GUILD_BOSS_CONTRACTS.length).toBeGreaterThan(10);
  });
});

describe('contract credit', () => {
  it('pays a named-boss contract once a week, from the deeds kill path, to the eligible roster', () => {
    const day = dayPosting('gc_boss_morthen');
    const s = sim(day);
    const meta = s.players.get(s.player.id);
    if (!meta) throw new Error('no meta');
    const before = seals(s);
    onMobKillCreditForDeeds(s.ctx, fakeBoss('morthen'), s.player, meta, [meta]);
    const events = s.tick();
    expect(seals(s) - before).toBe(1);
    expect(s.guildContracts.done).toEqual(['gc_boss_morthen']);
    expect(s.guildContracts.lifetime).toBe(1);
    const paid = events.filter((e: SimEvent) => e.type === 'guildContractDone');
    expect(paid).toEqual([
      expect.objectContaining({
        type: 'guildContractDone',
        contractId: 'gc_boss_morthen',
        seals: 1,
      }),
    ]);
    // the first contract earns its milestone deed
    expect(meta.deedsEarned.has('dgn_guild_first_contract')).toBe(true);
    // a second kill the same week pays nothing more
    onMobKillCreditForDeeds(s.ctx, fakeBoss('morthen'), s.player, meta, [meta]);
    expect(seals(s) - before).toBe(1);
    // a boss the board does not name pays nothing
    onMobKillCreditForDeeds(s.ctx, fakeBoss('forest_wolf'), s.player, meta, [meta]);
    expect(seals(s) - before).toBe(1);
    // the next week the board rolls: the done list clears, the lifetime count stays
    s.resetDay = new Date(Date.parse(`${day}T00:00:00Z`) + 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(s.guildContracts.done).toEqual([]);
    expect(s.guildContracts.lifetime).toBe(1);
    expect(s.guildContracts.week).toBe(weeklyQuestWeekForResetDay(s.resetDay));
  });

  it('pays a Heroic clear only on Heroic, and a task only when the encounter met it', () => {
    const heroicDay = dayPosting('gc_heroic_hollow_crypt');
    const s = sim(heroicDay);
    const meta = s.players.get(s.player.id);
    if (!meta) throw new Error('no meta');
    const grant = () => {};
    onKillForGuildContracts(s.ctx, fakeBoss('morthen'), false, [meta], [meta], [], grant);
    expect(s.guildContracts.done).not.toContain('gc_heroic_hollow_crypt');
    onKillForGuildContracts(s.ctx, fakeBoss('morthen'), true, [meta], [meta], [], grant);
    expect(s.guildContracts.done).toContain('gc_heroic_hollow_crypt');

    const taskDay = dayPosting('gc_task_dgn_vael_thralls');
    const t = sim(taskDay);
    const tmeta = t.players.get(t.player.id);
    if (!tmeta) throw new Error('no meta');
    // the kill alone, or the wrong task, does not pay; the task's recipients are paid
    onKillForGuildContracts(
      t.ctx,
      fakeBoss('vael_the_mistcaller'),
      false,
      [tmeta],
      [],
      ['dgn_vael_thralls'],
      grant,
    );
    expect(t.guildContracts.done).not.toContain('gc_task_dgn_vael_thralls');
    onKillForGuildContracts(
      t.ctx,
      fakeBoss('vael_the_mistcaller'),
      false,
      [],
      [tmeta],
      ['dgn_olen_arc'],
      grant,
    );
    expect(t.guildContracts.done).not.toContain('gc_task_dgn_vael_thralls');
    onKillForGuildContracts(
      t.ctx,
      fakeBoss('vael_the_mistcaller'),
      false,
      [],
      [tmeta],
      ['dgn_vael_thralls'],
      grant,
    );
    expect(t.guildContracts.done).toContain('gc_task_dgn_vael_thralls');
    expect(t.ctx.countItem(LANTERN_SEAL_ITEM_ID, t.player.id)).toBe(3);
  });

  it('draws no randomness: no rng draw rides a payment', () => {
    const s = sim(dayPosting('gc_boss_morthen'));
    const meta = s.players.get(s.player.id);
    if (!meta) throw new Error('no meta');
    let draws = 0;
    s.ctx.rng.setObserver(() => {
      draws++;
    });
    onKillForGuildContracts(
      s.ctx,
      fakeBoss('morthen'),
      true,
      [meta],
      [meta],
      ['dgn_morthen_flawless'],
      () => {},
    );
    s.ctx.rng.setObserver(null);
    // not vacuous: the payment happened
    expect(s.guildContracts.done.length).toBeGreaterThan(0);
    expect(draws).toBe(0);
  });
});

describe('the Lantern Seal and the save shape', () => {
  it('is a bound, kept, stacked token in the item table', () => {
    const seal = ITEMS[LANTERN_SEAL_ITEM_ID];
    expect(seal).toBe(GUILD_CONTRACT_ITEMS[LANTERN_SEAL_ITEM_ID]);
    expect(seal).toMatchObject({ kind: 'tool', soulbound: true, noDiscard: true, sellValue: 0 });
    expect(seal.stackSize).toBeGreaterThanOrEqual(50);
  });

  it('loads only a well-formed record and round-trips the save', () => {
    expect(sanitizeGuildContractProgress(null)).toBeNull();
    expect(sanitizeGuildContractProgress({ week: 'x', done: [], lifetime: 1 })).toBeNull();
    expect(
      sanitizeGuildContractProgress({
        week: 'wk_3',
        done: ['gc_boss_morthen', 'nope', 'gc_boss_morthen'],
        lifetime: -4,
      }),
    ).toEqual({ week: 'wk_3', done: ['gc_boss_morthen'], lifetime: 1 });
    const s = sim(dayPosting('gc_boss_morthen'));
    const meta = s.players.get(s.player.id);
    if (!meta) throw new Error('no meta');
    expect(savedGuildContractProgress(meta)).toBeUndefined();
    onMobKillCreditForDeeds(s.ctx, fakeBoss('morthen'), s.player, meta, [meta]);
    const saved = savedGuildContractProgress(meta);
    expect(saved).toEqual({ week: s.guildContracts.week, done: ['gc_boss_morthen'], lifetime: 1 });
    expect(sanitizeGuildContractProgress(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    // the full character save carries it, and a fresh sim restores it
    const state = s.serializeCharacter(s.player.id);
    const copy = JSON.parse(JSON.stringify(state));
    expect(copy.worldQuests?.guildContracts).toEqual(saved);
  });
});

describe('the quartermaster', () => {
  it('sells cosmetics only: every title offer a zero-Renown title feat', () => {
    const titles = GUILD_QUARTERMASTER_STOCK.filter((offer) => offer.kind === 'title');
    expect(titles.length).toBeGreaterThan(0);
    for (const offer of titles) {
      const deed = DEEDS[offer.deedId];
      expect(deed, offer.id).toBeDefined();
      expect(deed.feat, offer.id).toBe(true);
      expect(deed.renown, offer.id).toBe(0);
      expect(deed.reward?.kind, offer.id).toBe('title');
      expect(deed.trigger, offer.id).toEqual({ kind: 'manual' });
      expect(offer.seals, offer.id).toBeGreaterThan(0);
      // the Book's line names the live price, so a price change cannot leave it stale
      expect(deed.desc, offer.id).toContain(`for ${offer.seals} Lantern Seals.`);
    }
  });

  it('refuses from afar, short of seals, or owned; otherwise debits and grants the title', () => {
    const s = sim('2026-10-13');
    const pid = s.player.id;
    const meta = s.players.get(pid);
    if (!meta) throw new Error('no meta');
    const offer = GUILD_QUARTERMASTER_STOCK[0];
    if (offer.kind !== 'title') throw new Error('the first offer is a title');
    const reasons = (): string[] =>
      s
        .tick()
        .filter((e: SimEvent) => e.type === 'guildCosmeticRefused')
        .map((e) => (e as { reason: string }).reason);
    s.buyGuildCosmetic(offer.id);
    expect(reasons()).toEqual(['range']);
    const npc = s.entities.get(HIGHWATCH_GUILD_ENTITY_IDS[GUILD_QUARTERMASTER_NPC_ID]);
    if (!npc) throw new Error('no quartermaster');
    s.player.pos = { x: npc.pos.x + 2, y: npc.pos.y, z: npc.pos.z };
    s.buyGuildCosmetic(offer.id);
    expect(reasons()).toEqual(['seals']);
    s.ctx.addItem(LANTERN_SEAL_ITEM_ID, offer.seals + 1, pid);
    s.buyGuildCosmetic('nope');
    s.buyGuildCosmetic(offer.id);
    const events = s.tick();
    expect(events.some((e: SimEvent) => e.type === 'guildCosmeticBought')).toBe(true);
    expect(meta.deedsEarned.has(offer.deedId)).toBe(true);
    expect(s.ctx.countItem(LANTERN_SEAL_ITEM_ID, pid)).toBe(1);
    s.ctx.addItem(LANTERN_SEAL_ITEM_ID, offer.seals, pid);
    s.buyGuildCosmetic(offer.id);
    expect(reasons()).toEqual(['owned']);
    expect(s.ctx.countItem(LANTERN_SEAL_ITEM_ID, pid)).toBe(offer.seals + 1);
  });
});

describe('the residents at work', () => {
  it('the clerk and the quartermaster open the guild window on their tabs, the recruiter the finder', () => {
    const s = sim('2026-10-13');
    const opened: Record<string, SimEvent[]> = {};
    for (const npcId of [
      CONTRACT_CLERK_NPC_ID,
      GUILD_QUARTERMASTER_NPC_ID,
      GUILD_RECRUITER_NPC_ID,
      GUILDMASTER_NPC_ID,
    ]) {
      const entityId = HIGHWATCH_GUILD_ENTITY_IDS[npcId as keyof typeof HIGHWATCH_GUILD_ENTITY_IDS];
      const npc = s.entities.get(entityId);
      if (!npc) throw new Error(npcId);
      s.player.pos = { x: npc.pos.x + 2, y: npc.pos.y, z: npc.pos.z };
      s.talkToNpc(entityId);
      opened[npcId] = s
        .tick()
        .filter((e: SimEvent) => e.type === 'guildHallOpen' || e.type === 'guildRecruiterOpen');
    }
    expect(opened[CONTRACT_CLERK_NPC_ID]).toEqual([
      expect.objectContaining({ type: 'guildHallOpen', tab: 'contracts' }),
    ]);
    expect(opened[GUILD_QUARTERMASTER_NPC_ID]).toEqual([
      expect.objectContaining({ type: 'guildHallOpen', tab: 'quartermaster' }),
    ]);
    expect(opened[GUILD_RECRUITER_NPC_ID]).toEqual([
      expect.objectContaining({ type: 'guildRecruiterOpen' }),
    ]);
    expect(opened[GUILDMASTER_NPC_ID]).toEqual([]);
    // from across the hall nothing opens
    const clerk = s.entities.get(HIGHWATCH_GUILD_ENTITY_IDS[CONTRACT_CLERK_NPC_ID]);
    if (!clerk) throw new Error('clerk');
    s.player.pos = { x: clerk.pos.x + 20, y: clerk.pos.y, z: clerk.pos.z };
    s.talkToNpc(clerk.id);
    expect(s.tick().filter((e: SimEvent) => e.type === 'guildHallOpen')).toEqual([]);
  });
});

describe('the contracts across weeks, milestones and the save', () => {
  it('pins the persisted seal id to its literal', () => {
    expect(LANTERN_SEAL_ITEM_ID).toBe('lantern_seal');
  });

  it('pays the same contract again in a later week that posts it, and bumps the wire revision', () => {
    // two weeks that both post the Morthen bounty
    const days: string[] = [];
    for (let week = 0; week < 400 && days.length < 2; week++) {
      if (guildContractsForWeek(`wk_${week}`).some((c) => c.id === 'gc_boss_morthen'))
        days.push(new Date(Date.UTC(2026, 8, 1 + week * 7)).toISOString().slice(0, 10));
    }
    expect(days).toHaveLength(2);
    const s = sim(days[0]);
    const meta = s.players.get(s.player.id);
    if (!meta) throw new Error('no meta');
    const rev = meta.wireRev;
    onMobKillCreditForDeeds(s.ctx, fakeBoss('morthen'), s.player, meta, [meta]);
    expect(meta.wireRev).toBeGreaterThan(rev);
    s.resetDay = days[1];
    onMobKillCreditForDeeds(s.ctx, fakeBoss('morthen'), s.player, meta, [meta]);
    expect(seals(s)).toBe(2);
    expect(s.guildContracts.lifetime).toBe(2);
    expect(s.guildContracts.done).toEqual(['gc_boss_morthen']);
    expect(s.guildContracts.week).toBe(weeklyQuestWeekForResetDay(days[1]));
  });

  it('earns the ten and fifty contract milestones on the payment that reaches them', () => {
    const s = sim(dayPosting('gc_boss_morthen'));
    const meta = s.players.get(s.player.id);
    if (!meta) throw new Error('no meta');
    meta.guildContracts = { week: s.guildContracts.week, done: [], lifetime: 8 };
    onMobKillCreditForDeeds(s.ctx, fakeBoss('morthen'), s.player, meta, [meta]);
    expect(meta.deedsEarned.has('dgn_guild_ten_contracts')).toBe(false);
    meta.guildContracts = { week: s.guildContracts.week, done: [], lifetime: 9 };
    onMobKillCreditForDeeds(s.ctx, fakeBoss('morthen'), s.player, meta, [meta]);
    expect(meta.deedsEarned.has('dgn_guild_ten_contracts')).toBe(true);
    expect(meta.deedsEarned.has('dgn_guild_fifty_contracts')).toBe(false);
    meta.guildContracts = { week: s.guildContracts.week, done: [], lifetime: 49 };
    onMobKillCreditForDeeds(s.ctx, fakeBoss('morthen'), s.player, meta, [meta]);
    expect(meta.deedsEarned.has('dgn_guild_fifty_contracts')).toBe(true);
    expect(s.guildContracts.lifetime).toBe(50);
  });

  it('credits a task contract through the deeds kill path when the encounter met it', () => {
    // every task contract names a deed the kill path collects for its own boss
    for (const contract of GUILD_TASK_CONTRACTS) {
      const collected = [FLAWLESS_TASKS, ADD_TASKS, SPLASH_TASKS].some(
        (table) => table[contract.mobId] === contract.taskDeedId,
      );
      expect(collected, contract.id).toBe(true);
    }
    const s = sim(dayPosting('gc_task_dgn_vael_thralls'));
    const meta = s.players.get(s.player.id);
    if (!meta) throw new Error('no meta');
    expect(ADD_TASKS.vael_the_mistcaller).toBe('dgn_vael_thralls');
    onMobKillCreditForDeeds(s.ctx, fakeBoss('vael_the_mistcaller'), s.player, meta, [meta]);
    expect(s.guildContracts.done).toContain('gc_task_dgn_vael_thralls');
    expect(seals(s)).toBe(3);
  });

  it('restores the record from the character save, and an old save restores none', () => {
    const day = dayPosting('gc_boss_morthen');
    const s = sim(day);
    const meta = s.players.get(s.player.id);
    if (!meta) throw new Error('no meta');
    onMobKillCreditForDeeds(s.ctx, fakeBoss('morthen'), s.player, meta, [meta]);
    const state = JSON.parse(JSON.stringify(s.serializeCharacter(s.player.id)));
    const t = sim(day);
    const pid = t.addPlayer('warrior', 'Copy', { state });
    expect(t.players.get(pid)?.guildContracts).toEqual({
      week: weeklyQuestWeekForResetDay(day),
      done: ['gc_boss_morthen'],
      lifetime: 1,
    });
    expect(t.ctx.countItem(LANTERN_SEAL_ITEM_ID, pid)).toBe(1);
    const old = { ...state };
    delete old.worldQuests;
    const oldPid = t.addPlayer('warrior', 'Old', { state: old });
    expect(t.players.get(oldPid)?.guildContracts ?? null).toBeNull();
  });

  it('bounds every field a tampered save could carry', () => {
    expect(sanitizeGuildContractProgress([])).toBeNull();
    expect(sanitizeGuildContractProgress({ week: 3, done: [], lifetime: 1 })).toBeNull();
    expect(
      sanitizeGuildContractProgress({ week: 'wk_3', done: 'gc_boss_morthen', lifetime: 2 }),
    ).toEqual({ week: 'wk_3', done: [], lifetime: 2 });
    expect(
      sanitizeGuildContractProgress({ week: 'wk_3', done: [], lifetime: Number.NaN })?.lifetime,
    ).toBe(0);
    expect(sanitizeGuildContractProgress({ week: 'wk_3', done: [], lifetime: 2e9 })?.lifetime).toBe(
      1_000_000,
    );
  });
});

describe('the quartermaster at the edges', () => {
  it('ignores an unknown offer and a dead buyer, and needs the buyer on its floor', () => {
    const s = sim('2026-10-13');
    const pid = s.player.id;
    const meta = s.players.get(pid);
    if (!meta) throw new Error('no meta');
    const offer = GUILD_QUARTERMASTER_STOCK[0];
    if (offer.kind !== 'title') throw new Error('the first offer is a title');
    const npc = s.entities.get(HIGHWATCH_GUILD_ENTITY_IDS[GUILD_QUARTERMASTER_NPC_ID]);
    if (!npc) throw new Error('no quartermaster');
    s.ctx.addItem(LANTERN_SEAL_ITEM_ID, offer.seals, pid);
    const guildEvents = (): SimEvent[] =>
      s.tick().filter((e: SimEvent) => e.type.startsWith('guildCosmetic'));
    s.player.pos = { x: npc.pos.x + 2, y: npc.pos.y, z: npc.pos.z };
    s.buyGuildCosmetic('nope');
    s.buyGuildCosmetic('__proto__');
    expect(guildEvents()).toEqual([]);
    // a floor above the quartermaster is out of reach
    s.player.pos = { x: npc.pos.x + 2, y: npc.pos.y + 4, z: npc.pos.z };
    s.buyGuildCosmetic(offer.id);
    expect(guildEvents()).toEqual([
      expect.objectContaining({ type: 'guildCosmeticRefused', reason: 'range' }),
    ]);
    s.player.pos = { x: npc.pos.x + 2, y: npc.pos.y, z: npc.pos.z };
    s.player.dead = true;
    s.buyGuildCosmetic(offer.id);
    expect(guildEvents()).toEqual([]);
    expect(s.ctx.countItem(LANTERN_SEAL_ITEM_ID, pid)).toBe(offer.seals);
    expect(meta.deedsEarned.has(offer.deedId)).toBe(false);
  });
});
