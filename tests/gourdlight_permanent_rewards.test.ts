import { afterEach, describe, expect, it } from 'vitest';
import {
  CARVED_PUMPKIN_HEAD_ID,
  GOURDLIGHT_BROOM_ID,
  GOURDLIGHT_BROOM_MOUNT,
  GOURDLIGHT_COSTUMES,
  GOURDLIGHT_EVE_ITEMS,
  GOURDLIGHT_KEEPER_ENTITY_ID,
  GOURDLIGHT_ROUNDS_QUEST_ID,
  GOURDLIGHT_TITLE_WRITS,
  GOURDLIGHT_TOYS,
  JAR_OF_MISCHIEF_ID,
  PUMPKIN_HEAD_AURA_ID,
} from '../src/sim/content/gourdlight_eve';
import { GOURDLIGHT_DAILY_ITEMS } from '../src/sim/content/gourdlight_eve_dailies';
import {
  GOURDLIGHT_SCARECROW_ITEMS,
  STRAWLING_CHARM_ID,
  STRAWLING_GUISE_AURA_ID,
} from '../src/sim/content/gourdlight_eve_scarecrow';
import { QUESTS } from '../src/sim/data';
import { isToyCauldron, updateSeasonal } from '../src/sim/seasonal';
import {
  BOUND_RECHECK_TICKS,
  sweepEventBoundItems,
} from '../src/sim/seasonal/seasonal_bound_items';
import { syncSeasonalDecorColliders } from '../src/sim/seasonal_decor_colliders';
import { Sim } from '../src/sim/sim';
import { WORLD_SEED } from '../src/sim/world_seed';
import { seasonalItemTooltipText } from '../src/ui/seasonal_item_tooltip';

afterEach(() => syncSeasonalDecorColliders(WORLD_SEED, null));
const rewards = Object.keys({ ...GOURDLIGHT_EVE_ITEMS, ...GOURDLIGHT_SCARECROW_ITEMS });
const supplies = Object.keys(GOURDLIGHT_DAILY_ITEMS);
const world = () => new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });

describe('permanent Halloween rewards', () => {
  it('keeps every reward in bags, bank and courier through closure and a later sweep', () => {
    const sim = world();
    sim.chat('/dev season on');
    sim.tick();
    const meta = sim.players.get(sim.playerId)!;
    const stacks = () => rewards.map((itemId) => ({ itemId, count: 1 }));
    meta.inventory = stacks();
    meta.bank.inventory = stacks();
    meta.courier = {
      phase: 'outbound',
      x: 0,
      z: 0,
      bankerId: null,
      travelDistance: 0,
      cargo: stacks(),
      withdrawals: [],
      revision: 0,
      retryRemaining: 0,
    };
    sim.chat('/dev season off');
    // Drive the production seasonal tick without advancing the courier journey.
    for (let i = 0; i <= BOUND_RECHECK_TICKS; i++) updateSeasonal(sim.ctx);
    expect(meta.inventory).toEqual(stacks());
    expect(meta.bank.inventory).toEqual(stacks());
    expect(meta.courier.cargo).toEqual(stacks());
    expect(sim.entities.has(GOURDLIGHT_KEEPER_ENTITY_ID)).toBe(false);
    expect(sim.questState(GOURDLIGHT_ROUNDS_QUEST_ID)).not.toBe('available');
  });

  it('preserves saved rewards and deeds but clears unfinished quests and supplies on late login', () => {
    const sim = world();
    sim.chat('/dev season on');
    sim.tick();
    const meta = sim.players.get(sim.playerId)!;
    meta.inventory = [...rewards, ...supplies].map((itemId) => ({ itemId, count: 1 }));
    meta.bank.inventory = [{ itemId: GOURDLIGHT_BROOM_ID, count: 1 }];
    meta.questLog.set(GOURDLIGHT_ROUNDS_QUEST_ID, {
      questId: GOURDLIGHT_ROUNDS_QUEST_ID,
      state: 'active',
      counts: [2],
    });
    meta.questsDone.add(GOURDLIGHT_ROUNDS_QUEST_ID);
    const writ = GOURDLIGHT_TITLE_WRITS[0];
    sim.useItem(writ.itemId);
    const state = sim.serializeCharacter(sim.playerId)!;
    const other = world();
    const pid = other.addPlayer('warrior', 'Returning', { state });
    other.tick();
    const restored = other.players.get(pid)!;
    for (const id of rewards.filter((id) => id !== writ.itemId))
      expect(other.countItem(id, pid), id).toBe(1);
    for (const id of supplies) expect(other.countItem(id, pid), id).toBe(0);
    expect(restored.bank.inventory).toContainEqual({ itemId: GOURDLIGHT_BROOM_ID, count: 1 });
    expect(restored.questLog.has(GOURDLIGHT_ROUNDS_QUEST_ID)).toBe(false);
    expect(restored.questsDone.has(GOURDLIGHT_ROUNDS_QUEST_ID)).toBe(true);
    expect(restored.deedsEarned.has(writ.deedId)).toBe(true);
  });

  it('expires only temporary quest supplies and unfinished event logs on close', () => {
    const sim = world();
    sim.chat('/dev season on');
    sim.tick();
    const meta = sim.players.get(sim.playerId)!;
    meta.questLog.set(GOURDLIGHT_ROUNDS_QUEST_ID, {
      questId: GOURDLIGHT_ROUNDS_QUEST_ID,
      state: 'ready',
      counts: [5],
    });
    const ordinary = Object.values(QUESTS).find((quest) => !quest.seasonalEvent)!;
    meta.questLog.set(ordinary.id, {
      questId: ordinary.id,
      state: 'active',
      counts: ordinary.objectives.map(() => 0),
    });
    meta.inventory = supplies.map((itemId) => ({ itemId, count: 1 }));
    meta.bank.inventory = supplies.map((itemId) => ({ itemId, count: 1 }));
    const before = meta.wireRev;
    sim.chat('/dev season off');
    sim.tick();
    expect(meta.questLog.has(GOURDLIGHT_ROUNDS_QUEST_ID)).toBe(false);
    expect(meta.questLog.has(ordinary.id)).toBe(true);
    expect(meta.inventory).toEqual([]);
    expect(meta.bank.inventory).toEqual([]);
    expect(meta.wireRev).toBeGreaterThan(before);
    // A late quest supply is still swept; its permanent reward is retained.
    sim.addItem(supplies[0], 1);
    sim.addItem(GOURDLIGHT_BROOM_ID, 1);
    expect(sweepEventBoundItems(sim.ctx, meta, null)).toEqual([supplies[0]]);
    expect(sim.countItem(GOURDLIGHT_BROOM_ID)).toBe(1);
  });

  it('uses costumes, toys, writs, the head and charm outside the event with normal consumption', () => {
    const sim = world();
    const meta = sim.players.get(sim.playerId)!;
    const pid = sim.addPlayer('mage', 'Friend');
    const friend = sim.entities.get(pid)!;
    friend.pos = { ...sim.player.pos, x: sim.player.pos.x + 2 };
    sim.player.targetId = pid;
    for (const toy of GOURDLIGHT_TOYS) {
      sim.addItem(toy.itemId, 1);
      sim.useItem(toy.itemId);
      expect(sim.countItem(toy.itemId)).toBe(1);
      expect(sim.player.cooldowns.get(toy.itemId)).toBe(toy.cooldown);
    }
    const pot = [...sim.entities.values()].find(isToyCauldron)!;
    expect(sim.pickUpObject(pot.id)).toBe(true);
    for (const costume of GOURDLIGHT_COSTUMES) {
      sim.addItem(costume.itemId, 1);
      sim.useItem(costume.itemId);
      expect(sim.countItem(costume.itemId)).toBe(0);
      expect(sim.player.auras.some((a) => a.id === costume.auraId)).toBe(true);
    }
    for (const id of [CARVED_PUMPKIN_HEAD_ID, STRAWLING_CHARM_ID, JAR_OF_MISCHIEF_ID]) {
      sim.addItem(id, 1);
      sim.useItem(id);
    }
    expect(sim.countItem(JAR_OF_MISCHIEF_ID)).toBe(0);
    expect(sim.countItem(CARVED_PUMPKIN_HEAD_ID)).toBe(1);
    expect(sim.countItem(STRAWLING_CHARM_ID)).toBe(1);
    sim.useItem(STRAWLING_CHARM_ID);
    expect(sim.player.auras.some((a) => a.id === STRAWLING_GUISE_AURA_ID)).toBe(true);
    sim.player.inCombat = true;
    updateSeasonal(sim.ctx);
    expect(sim.player.auras.some((a) => a.id === STRAWLING_GUISE_AURA_ID)).toBe(false);
    expect(sim.player.auras.some((a) => a.id === PUMPKIN_HEAD_AURA_ID)).toBe(true);
    const writ = GOURDLIGHT_TITLE_WRITS[0];
    sim.addItem(writ.itemId, 1);
    sim.useItem(writ.itemId);
    expect(meta.deedsEarned.has(writ.deedId)).toBe(true);
    expect(sim.countItem(writ.itemId)).toBe(0);
  });

  it('summons the earned broom outside Halloween with riding training', () => {
    const sim = world();
    const meta = sim.players.get(sim.playerId)!;
    sim.addItem(GOURDLIGHT_BROOM_ID, 1);
    meta.ridingTrained = true;
    sim.useItem(GOURDLIGHT_BROOM_ID);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(sim.player.mountKey).toBe(GOURDLIGHT_BROOM_MOUNT);
  });

  it('describes permanent rewards without event-only use or expiry promises', () => {
    for (const id of rewards) {
      const text = seasonalItemTooltipText({ id }) ?? '';
      expect(text, id).not.toMatch(/only during|crumbles|gone from your bags/i);
    }
    expect(seasonalItemTooltipText({ id: GOURDLIGHT_BROOM_ID })).toContain('Kept permanently');
  });
});
