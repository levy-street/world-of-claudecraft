import { describe, expect, it } from 'vitest';

import { questGateBlocksDamage } from '../src/sim/combat/quest_damage_gate';
import { ZONE2_OBJECTS } from '../src/sim/content/zone2';
import { CAMPS, ITEMS, MOBS, QUESTS } from '../src/sim/data';
import {
  FIREBOTTLE_COOLDOWN_SECS,
  firebottleBurnCheck,
  HUT_BURN_RANGE,
  HUT_REBURN_COOLDOWN_SECS,
  stableHutKey,
  throwFirebottleAtNearestHut,
} from '../src/sim/interactions/firebottle_hut';
import { isQuestGatedEntityHidden } from '../src/sim/quest_gated_entity';
import { regrantMissingQuestItems } from '../src/sim/quests/quest_commands';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, QuestProgress } from '../src/sim/types';

// Mirefen duplicate-objective rework: each duplicate quest keeps its id (no DB
// breakage) but gets a distinct objective so two quests are no longer literal
// copies. See docs/design and the quest-dedupe worktree.
describe('Mirefen quest de-duplication', () => {
  describe('No Rest in the Reeds becomes an elite capstone (q_no_rest)', () => {
    it('adds an elite Drowned Warlord mob', () => {
      const warlord = MOBS.drowned_warlord;
      expect(warlord).toBeDefined();
      expect(warlord.elite).toBe(true);
      expect(warlord.family).toBe('undead');
    });

    it('places the Drowned Warlord in the world at least once', () => {
      const camps = CAMPS.filter((c) => c.mobId === 'drowned_warlord');
      expect(camps.length).toBeGreaterThanOrEqual(1);
      expect(camps.every((c) => c.count >= 1)).toBe(true);
    });

    it('repoints q_no_rest at the elite and drops the drowned_dead kill duplicate', () => {
      const q = QUESTS.q_no_rest;
      expect(q.objectives).toHaveLength(1);
      const obj = q.objectives[0];
      expect(obj.type).toBe('kill');
      if (obj.type === 'kill') {
        expect(obj.targetMobId).toBe('drowned_warlord');
        expect(obj.count).toBe(1);
      }
      // The old duplicate objective (kill 14 Drowned Dead, shared with q_drowned)
      // must be gone.
      expect(q.objectives.some((o) => o.type === 'kill' && o.targetMobId === 'drowned_dead')).toBe(
        false,
      );
    });
  });

  describe('The Broodmother uses a destructible egg clutch (q_broodmother)', () => {
    it('adds a quest-gated Broodmother Egg (~100 HP, only damageable with the quest)', () => {
      const egg = MOBS.spider_egg;
      expect(egg).toBeDefined();
      expect(egg.requiresQuestId).toBe('q_broodmother');
      expect(egg.hpBase).toBe(100);
    });

    it('adds a widow hatchling smaller than a full Mirefen Widow', () => {
      const hatchling = MOBS.widow_hatchling;
      expect(hatchling).toBeDefined();
      expect(hatchling.scale ?? 1).toBeLessThan(MOBS.mire_widow.scale ?? 1);
    });

    it('places enough eggs to complete the destroy-8 objective', () => {
      const camps = CAMPS.filter((c) => c.mobId === 'spider_egg');
      expect(camps.length).toBeGreaterThanOrEqual(1);
      expect(camps.reduce((n, c) => n + c.count, 0)).toBeGreaterThanOrEqual(8);
    });

    it('swaps objective 1 to destroying eggs, keeping the Broodmother kill and dropping the widow duplicate', () => {
      const q = QUESTS.q_broodmother;
      const targets = q.objectives.map((o) => (o.type === 'kill' ? o.targetMobId : o.type));
      expect(targets).toContain('spider_egg');
      expect(targets).toContain('mirefen_broodmother');
      expect(targets).not.toContain('mire_widow');
      const eggObj = q.objectives.find((o) => o.type === 'kill' && o.targetMobId === 'spider_egg');
      expect(eggObj?.count).toBe(8);
    });
  });

  describe('quest-gated egg damage (questGateBlocksDamage)', () => {
    const egg = { kind: 'mob', templateId: 'spider_egg' } as unknown as Entity;
    const widow = { kind: 'mob', templateId: 'mire_widow' } as unknown as Entity;
    const player = { kind: 'player', id: 1 } as unknown as Entity;
    const pet = { kind: 'mob', id: 9, ownerId: 1 } as unknown as Entity;
    const players = (state?: QuestProgress['state']): Map<number, PlayerMeta> => {
      const log = new Map<string, QuestProgress>();
      if (state) log.set('q_broodmother', { questId: 'q_broodmother', counts: [0, 0], state });
      return new Map([[1, { entityId: 1, questLog: log } as unknown as PlayerMeta]]);
    };

    it('blocks a player with no Broodmother quest', () => {
      expect(questGateBlocksDamage(players(), player, egg)).toBe(true);
    });
    it('allows a player with the quest active or ready', () => {
      expect(questGateBlocksDamage(players('active'), player, egg)).toBe(false);
      expect(questGateBlocksDamage(players('ready'), player, egg)).toBe(false);
    });
    it('blocks a player who has already turned the quest in', () => {
      expect(questGateBlocksDamage(players('done'), player, egg)).toBe(true);
    });
    it('allows the pet of a questing player (credits via the pet owner)', () => {
      expect(questGateBlocksDamage(players('active'), pet, egg)).toBe(false);
    });
    it('never gates an ordinary mob', () => {
      expect(questGateBlocksDamage(players(), player, widow)).toBe(false);
    });
    it('blocks source-less (environmental/DoT) damage to a gated egg', () => {
      expect(questGateBlocksDamage(players('active'), null, egg)).toBe(true);
    });
    it('blocks a wild mob (non-pet) from harming a gated egg', () => {
      const wildMob = { kind: 'mob', id: 50, ownerId: null } as unknown as Entity;
      expect(questGateBlocksDamage(players('active'), wildMob, egg)).toBe(true);
    });
  });

  describe('Back to the Shallows becomes a firebottle burn (q_deepfen_purge)', () => {
    it('grants a firebottle and repoints the objective to burning 5 huts', () => {
      const q = QUESTS.q_deepfen_purge;
      expect(q.requiredItems).toContain('firebottle');
      expect(q.objectives).toHaveLength(1);
      const o = q.objectives[0];
      expect(o.type).toBe('interact');
      if (o.type === 'interact') {
        expect(o.targetObjectItemId).toBe('murloc_hut');
        expect(o.count).toBe(5);
      }
      // the old deepfen_murloc kill duplicate (shared with q_deepfen) is gone
      expect(q.objectives.some((x) => x.type === 'kill')).toBe(false);
    });

    it('defines the firebottle and hut items', () => {
      expect(ITEMS.firebottle?.questId).toBe('q_deepfen_purge');
      expect(ITEMS.murloc_hut?.name).toBeTruthy();
    });

    it('places 5 burnable huts at the shallows', () => {
      const huts = ZONE2_OBJECTS.find((o) => o.itemId === 'murloc_hut');
      expect(huts).toBeDefined();
      expect(huts?.positions.length).toBe(5);
    });
  });

  describe('firebottle burn gating (firebottleBurnCheck)', () => {
    const base = {
      onQuest: true,
      hasBottle: true,
      distance: 1,
      time: 100,
      bottleReadyAt: 0,
      hutOnCooldown: false,
    };
    it('succeeds up against the hut, holding a ready bottle, on the quest', () => {
      expect(firebottleBurnCheck(base)).toEqual({ ok: true });
    });
    it('requires the quest, a bottle, and close range', () => {
      expect(firebottleBurnCheck({ ...base, onQuest: false })).toMatchObject({
        reason: 'notOnQuest',
      });
      expect(firebottleBurnCheck({ ...base, hasBottle: false })).toMatchObject({
        reason: 'noBottle',
      });
      expect(firebottleBurnCheck({ ...base, distance: HUT_BURN_RANGE + 0.1 })).toMatchObject({
        reason: 'tooFar',
      });
      expect(firebottleBurnCheck({ ...base, distance: HUT_BURN_RANGE })).toEqual({ ok: true });
    });
    it('enforces the 5s bottle cooldown and blocks a hut still on its re-burn cooldown', () => {
      expect(FIREBOTTLE_COOLDOWN_SECS).toBe(5);
      expect(HUT_REBURN_COOLDOWN_SECS).toBe(120);
      expect(firebottleBurnCheck({ ...base, bottleReadyAt: 101 })).toMatchObject({
        reason: 'onCooldown',
      });
      expect(firebottleBurnCheck({ ...base, hutOnCooldown: true })).toMatchObject({
        reason: 'hutOnCooldown',
      });
    });
  });

  describe('using the firebottle torches the nearest hut (throwFirebottleAtNearestHut)', () => {
    const makeCtx = (hut: Entity | null, time = 100) => {
      const events: { type: string }[] = [];
      const entities = new Map<number, Entity>();
      if (hut) entities.set(hut.id, hut);
      const ctx = {
        time,
        entities,
        emit: (e: { type: string }) => events.push(e),
        error: (_pid: number, text: string) => events.push({ type: 'error', text } as never),
        countItem: () => 1,
        checkQuestReady: () => {},
      } as unknown as SimContext;
      return { ctx, events };
    };
    const onQuestMeta = (): PlayerMeta =>
      ({
        entityId: 1,
        counters: { questProgress: 0 },
        questLog: new Map([
          ['q_deepfen_purge', { questId: 'q_deepfen_purge', counts: [0], state: 'active' }],
        ]),
      }) as unknown as PlayerMeta;
    const player = { id: 1, pos: { x: 1, z: 0 } } as unknown as Entity;

    it('burns a nearby hut, credits the objective, and sets the 5s cooldown', () => {
      const hut = { id: 5, pos: { x: 0, z: 0 }, objectItemId: 'murloc_hut' } as unknown as Entity;
      const { ctx, events } = makeCtx(hut, 100);
      const meta = onQuestMeta();
      throwFirebottleAtNearestHut(ctx, player, meta);
      // Burn stamps key by the STABLE content key (item id + rounded position),
      // never the runtime entity id (which can alias across a reboot).
      expect(meta.questLog.get('q_deepfen_purge')?.burnedObjects?.map((b) => b.key)).toContain(
        'murloc_hut@0,0',
      );
      expect(meta.firebottleReadyAt).toBe(100 + FIREBOTTLE_COOLDOWN_SECS);
      // The bag cooldown swipe reads this materialized remaining value.
      expect((player as unknown as { firebottleCdRemaining: number }).firebottleCdRemaining).toBe(
        FIREBOTTLE_COOLDOWN_SECS,
      );
      expect(meta.questLog.get('q_deepfen_purge')?.counts[0]).toBe(1);
      expect(events.some((e) => e.type === 'worldObjectBurning')).toBe(true);
      expect(events.some((e) => e.type === 'questProgress')).toBe(true);
    });

    it('errors and burns nothing when no hut is within range', () => {
      const hut = { id: 5, pos: { x: 99, z: 99 }, objectItemId: 'murloc_hut' } as unknown as Entity;
      const { ctx, events } = makeCtx(hut, 100);
      const meta = onQuestMeta();
      throwFirebottleAtNearestHut(ctx, player, meta);
      expect(meta.questLog.get('q_deepfen_purge')?.burnedObjects ?? []).toHaveLength(0);
      expect(events.some((e) => e.type === 'error')).toBe(true);
    });

    it('blocks a re-burn within the 2-minute cooldown, then allows it once lapsed', () => {
      const hut = { id: 5, pos: { x: 0, z: 0 }, objectItemId: 'murloc_hut' } as unknown as Entity;
      const meta = onQuestMeta();
      throwFirebottleAtNearestHut(makeCtx(hut, 100).ctx, player, meta);
      expect(meta.questLog.get('q_deepfen_purge')?.counts[0]).toBe(1);
      // Within the cooldown (50s later): a warning only, no re-credit, no burn fx.
      const within = makeCtx(hut, 150);
      throwFirebottleAtNearestHut(within.ctx, player, meta);
      expect(meta.questLog.get('q_deepfen_purge')?.counts[0]).toBe(1);
      expect(within.events.some((e) => e.type === 'error')).toBe(true);
      expect(within.events.some((e) => e.type === 'worldObjectBurning')).toBe(false);
      // Past the cooldown: the same hut torches again and credits again.
      const after = makeCtx(hut, 100 + HUT_REBURN_COOLDOWN_SECS + 1);
      throwFirebottleAtNearestHut(after.ctx, player, meta);
      expect(meta.questLog.get('q_deepfen_purge')?.counts[0]).toBe(2);
      expect(after.events.some((e) => e.type === 'worldObjectBurning')).toBe(true);
    });
  });

  describe('quest-gated egg visibility (isQuestGatedEntityHidden)', () => {
    const egg = { kind: 'mob', templateId: 'spider_egg' } as unknown as Entity;
    const widow = { kind: 'mob', templateId: 'mire_widow' } as unknown as Entity;
    const object = { kind: 'object', templateId: 'ground_murloc_hut' } as unknown as Entity;
    const log = (state?: QuestProgress['state']): Map<string, QuestProgress> =>
      state
        ? new Map([['q_broodmother', { questId: 'q_broodmother', counts: [0, 0], state }]])
        : new Map();

    it('hides a Broodmother egg from a player not on the quest', () => {
      expect(isQuestGatedEntityHidden(egg, log())).toBe(true);
    });
    it('shows the egg once the quest is active', () => {
      expect(isQuestGatedEntityHidden(egg, log('active'))).toBe(false);
    });
    it('never hides an ordinary mob or a world object', () => {
      expect(isQuestGatedEntityHidden(widow, log())).toBe(false);
      expect(isQuestGatedEntityHidden(object, log())).toBe(false);
    });
  });
});

describe('firebottle lifecycle: giver re-grant and removal on finish (q_deepfen_purge)', () => {
  const HUT_QUEST = 'q_deepfen_purge';
  const makeSim = (): Sim =>
    new Sim({ seed: 4242, playerClass: 'warrior', playerName: 'Fenn', autoEquip: false });
  const standAtFenwick = (sim: Sim): Entity => {
    const npc = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'warden_fenwick',
    );
    if (!npc) throw new Error('warden_fenwick not found');
    const pos = sim.groundPos(npc.pos.x + 1, npc.pos.z);
    sim.player.pos = { ...pos };
    sim.player.prevPos = { ...pos };
    return npc;
  };

  it('re-grants a lost firebottle when you talk to the giver mid-quest', () => {
    const sim = makeSim();
    const npc = standAtFenwick(sim);
    // Set the quest active directly (bypassing accept), so no firebottle is granted.
    sim.questLog.set(HUT_QUEST, { questId: HUT_QUEST, counts: [0], state: 'active' });
    expect(sim.countItem('firebottle')).toBe(0);
    sim.talkToNpc(npc.id);
    expect(sim.countItem('firebottle')).toBe(1);
  });

  it('does not hand out a second firebottle when you still hold one', () => {
    const sim = makeSim();
    const npc = standAtFenwick(sim);
    sim.questLog.set(HUT_QUEST, { questId: HUT_QUEST, counts: [0], state: 'active' });
    sim.addItem('firebottle', 1);
    sim.talkToNpc(npc.id);
    expect(sim.countItem('firebottle')).toBe(1);
  });

  it('removes the firebottle on turn-in', () => {
    const sim = makeSim();
    standAtFenwick(sim);
    sim.addItem('firebottle', 1);
    sim.questLog.set(HUT_QUEST, { questId: HUT_QUEST, counts: [5], state: 'ready' });
    expect(sim.questState(HUT_QUEST)).toBe('ready');
    sim.turnInQuest(HUT_QUEST);
    expect(sim.questState(HUT_QUEST)).toBe('done');
    expect(sim.countItem('firebottle')).toBe(0);
  });

  it('removes the firebottle on abandon', () => {
    const sim = makeSim();
    standAtFenwick(sim);
    sim.addItem('firebottle', 1);
    sim.questLog.set(HUT_QUEST, { questId: HUT_QUEST, counts: [0], state: 'active' });
    sim.abandonQuest(HUT_QUEST);
    expect(sim.countItem('firebottle')).toBe(0);
    expect(sim.questLog.has(HUT_QUEST)).toBe(false);
  });

  it('persists burned huts (burnedObjects) across a save and reload', () => {
    const sim = makeSim();
    // rev: 1 marks this run as accepted under the reworked objective list, so
    // the restore-time migration passes it through untouched.
    sim.questLog.set(HUT_QUEST, {
      questId: HUT_QUEST,
      counts: [2],
      state: 'active',
      burnedObjects: [
        { key: 'murloc_hut@-78,269', at: 100 },
        { key: 'murloc_hut@-83,266', at: 140 },
      ],
      rev: 1,
    });
    const state = sim.serializeCharacter(sim.playerId)!;
    const reloaded = makeSim();
    const pid = reloaded.addPlayer('warrior', 'Reload', { state });
    const restored = reloaded.serializeCharacter(pid)!;
    const q = restored.questLog.find((x) => x.questId === HUT_QUEST);
    expect(q?.burnedObjects).toEqual([
      { key: 'murloc_hut@-78,269', at: 100 },
      { key: 'murloc_hut@-83,266', at: 140 },
    ]);
  });

  it('every authored hut position yields a distinct stable burn key', () => {
    // stableHutKey rounds positions to integers, so two huts within a unit of
    // each other would alias into one shared re-burn cooldown; pin that the
    // authored placements stay distinct under the rounding.
    const huts = ZONE2_OBJECTS.find((o) => o.itemId === 'murloc_hut');
    if (!huts) throw new Error('no murloc_hut objects');
    const keys = huts.positions.map((p) =>
      stableHutKey({ objectItemId: 'murloc_hut', pos: { x: p.x, z: p.z } } as unknown as Entity),
    );
    expect(new Set(keys).size).toBe(huts.positions.length);
  });

  it('keeps the mining pick on abandon: only quest-owned items strip', () => {
    // q_prof_intro grants the copper_mining_pick through requiredItems, but the
    // pick is a durable profession TOOL (kind 'tool'), not the quest's own item:
    // finishing or abandoning the quest must never delete it, or the player
    // cannot harvest again until they buy another (the #2343 tool gate).
    const sim = makeSim();
    sim.questLog.set('q_prof_intro', { questId: 'q_prof_intro', counts: [0], state: 'active' });
    sim.addItem('copper_mining_pick', 1);
    sim.abandonQuest('q_prof_intro');
    expect(sim.countItem('copper_mining_pick')).toBe(1);
    expect(sim.questLog.has('q_prof_intro')).toBe(false);
  });

  it('does not mint a banked tool through the giver re-grant', () => {
    // The mid-quest re-grant uses playerHoldsQuestItem (bags + bank + mail +
    // market escrow), the same predicate as accept: a pick parked in the bank
    // still counts as held, so talking to the giver mints nothing. A bags-only
    // read here was the unbounded starter-tool mint.
    const sim = makeSim();
    sim.questLog.set('q_prof_intro', { questId: 'q_prof_intro', counts: [0], state: 'active' });
    const meta = (sim as unknown as { players: Map<number, PlayerMeta> }).players.get(
      sim.playerId,
    )!;
    const bank = (meta as unknown as { bank: { inventory: { itemId: string; count: number }[] } })
      .bank;
    bank.inventory.push({ itemId: 'copper_mining_pick', count: 1 });
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    regrantMissingQuestItems(ctx, meta, 'foreman_odell');
    expect(sim.countItem('copper_mining_pick')).toBe(0);
    // The genuinely-lost case (no copy anywhere) still re-grants.
    bank.inventory.length = 0;
    regrantMissingQuestItems(ctx, meta, 'foreman_odell');
    expect(sim.countItem('copper_mining_pick')).toBe(1);
  });

  it('refuses a firebottle throw while dead', () => {
    const sim = makeSim();
    const hut = [...sim.entities.values()].find((e) => e.objectItemId === 'murloc_hut');
    if (!hut) throw new Error('no murloc hut in the world');
    const pos = sim.groundPos(hut.pos.x + 1, hut.pos.z);
    sim.player.pos = { ...pos };
    sim.player.prevPos = { ...pos };
    sim.questLog.set(HUT_QUEST, { questId: HUT_QUEST, counts: [0], state: 'active', rev: 1 });
    sim.addItem('firebottle', 1);
    // Alive control: the same spot burns and starts the cooldown.
    sim.useItem('firebottle');
    expect(sim.questLog.get(HUT_QUEST)?.counts[0]).toBe(1);
    // Dead: the use path's dead guard refuses before the throw arm runs.
    sim.questLog.set(HUT_QUEST, { questId: HUT_QUEST, counts: [0], state: 'active', rev: 1 });
    sim.player.dead = true;
    sim.player.firebottleCdRemaining = 0;
    (sim as unknown as { players: Map<number, PlayerMeta> }).players.get(
      sim.playerId,
    )!.firebottleReadyAt = 0;
    sim.useItem('firebottle');
    expect(sim.questLog.get(HUT_QUEST)?.counts[0]).toBe(0);
    expect(sim.player.firebottleCdRemaining).toBe(0);
  });
});
