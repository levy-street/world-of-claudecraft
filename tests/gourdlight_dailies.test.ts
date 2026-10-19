// Gourdlight Eve's rotating dailies (src/sim/seasonal/gourdlight_dailies.ts and
// content/gourdlight_eve_dailies.ts): one errand a reset day, picked by the realm's day
// (never a clock) from a pool of six, offered only while the event runs, each paying
// the rounds' pouch; their world pieces stand only during the event, resolved against
// the live world and seen only by a player on the errand.
import { afterEach, describe, expect, it } from 'vitest';
import { decodeTrickOrTreatWire } from '../src/net/seasonal_wire_state';
import { isBlocked } from '../src/sim/colliders';
import {
  GOURDLIGHT_KEEPER_ENTITY_ID,
  GOURDLIGHT_KEEPER_NPC,
  GOURDLIGHT_ROUNDS_QUEST_ID,
  GOURDLIGHT_TREAT_POUCH_ID,
  TRICK_OR_TREAT_NPC_IDS,
  TRICK_OR_TREAT_NPCS,
} from '../src/sim/content/gourdlight_eve';
import {
  CROW_FEATHER_ID,
  CURSED_CANDLE_ID,
  GOURDLIGHT_BASKET_NPCS,
  GOURDLIGHT_DAILY_BASKETS_QUEST_ID,
  GOURDLIGHT_DAILY_BOO_QUEST_ID,
  GOURDLIGHT_DAILY_FEATHERS_QUEST_ID,
  GOURDLIGHT_DAILY_PATCH_QUEST_ID,
  GOURDLIGHT_DAILY_POOL,
  GOURDLIGHT_DAILY_QUESTS,
  GOURDLIGHT_DAILY_TOWNS_QUEST_ID,
  GOURDLIGHT_DAILY_WICKS_QUEST_ID,
  PATCH_PUMPKIN_ID,
  PATCH_PUMPKINS_WANTED,
} from '../src/sim/content/gourdlight_eve_dailies';
import { GOURDLIGHT_CROW_ID } from '../src/sim/content/gourdlight_eve_scarecrow';
import { ITEMS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import { isQuestGatedEntityHidden } from '../src/sim/quest_gated_entity';
import * as seasonalMod from '../src/sim/seasonal';
import {
  freshSeasonalPlayerState,
  knockedToday,
  knockedTodayView,
  resolveScarecrowField,
  restoreSeasonalState,
  seasonalSaveFragment,
} from '../src/sim/seasonal';
import {
  booLedgerKey,
  gourdlightDailyForDay,
  wearsGourdlightCostume,
} from '../src/sim/seasonal/gourdlight_dailies';
import { DAILY_SITE_ROAD_CLEARANCE, gourdlightDailySites } from '../src/sim/seasonal_daily_sites';
import { syncSeasonalDecorColliders } from '../src/sim/seasonal_decor_colliders';
import { chapelAt } from '../src/sim/seasonal_decor_exclusions';
import { seasonalDecorLayout } from '../src/sim/seasonal_decor_layout';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { groundHeight, roadDistance, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

afterEach(() => syncSeasonalDecorColliders(WORLD_SEED, null));

const DAY = '2026-10-20';

function world(resetDay = DAY): Sim {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
  sim.resetDay = resetDay;
  sim.player.level = 20;
  return sim;
}

function open(sim: Sim): void {
  sim.chat('/dev season on');
  sim.tick();
}

/** Pin the day's errand by hand (the dev pick) and take it from Hester. */
function take(sim: Sim, questId: string): void {
  sim.chat(`/dev season daily ${questId}`);
  const keeper = sim.entities.get(GOURDLIGHT_KEEPER_ENTITY_ID) as Entity;
  standBeside(sim, keeper);
  sim.acceptQuest(questId);
  sim.tick();
  expect(sim.questState(questId)).toBe('active');
}

function npcEntity(sim: Sim, templateId: string): Entity {
  const npc = [...sim.entities.values()].find(
    (e) => e.kind === 'npc' && e.templateId === templateId,
  );
  if (!npc) throw new Error(`no ${templateId}`);
  return npc;
}

function standBeside(sim: Sim, e: Entity): void {
  sim.player.pos.x = e.pos.x + 1.5;
  sim.player.pos.z = e.pos.z;
  sim.player.pos.y = e.pos.y;
}

function seasonalEvents(events: SimEvent[]) {
  return events.filter((e): e is Extract<SimEvent, { type: 'seasonal' }> => e.type === 'seasonal');
}

function objectsOf(sim: Sim, itemId: string): Entity[] {
  return [...sim.entities.values()].filter((e) => e.kind === 'object' && e.objectItemId === itemId);
}

function dayAfter(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  // a plain month walk is enough for the October window these tests use
  const dd = d + n;
  return `${y}-${String(m + Math.floor((dd - 1) / 31)).padStart(2, '0')}-${String(((dd - 1) % 31) + 1).padStart(2, '0')}`;
}

describe('the day picks one errand from the pool', () => {
  it('is a pool of six, each a sweets-only daily of the event, from Hester', () => {
    expect(GOURDLIGHT_DAILY_POOL).toHaveLength(6);
    expect(new Set(GOURDLIGHT_DAILY_POOL).size).toBe(6);
    for (const id of GOURDLIGHT_DAILY_POOL) {
      const q = QUESTS[id];
      expect(q, id).toBe(GOURDLIGHT_DAILY_QUESTS[id]);
      expect(q.dailyReset && q.repeatable, id).toBe(true);
      expect(q.seasonalEvent).toBe('gourdlight_eve');
      expect(q.giverNpcId).toBe(GOURDLIGHT_KEEPER_NPC.id);
      expect(q.xpReward).toBe(0);
      expect(q.copperReward).toBe(0);
      expect(new Set(Object.values(q.itemRewards))).toEqual(new Set([GOURDLIGHT_TREAT_POUCH_ID]));
      expect(GOURDLIGHT_KEEPER_NPC.questIds).toContain(id);
    }
    // the rounds stay offered beside the day's errand
    expect(GOURDLIGHT_KEEPER_NPC.questIds).toContain(GOURDLIGHT_ROUNDS_QUEST_ID);
  });

  it('walks the pool day by day: six days, six errands, never the same twice running', () => {
    const picks = [0, 1, 2, 3, 4, 5].map((n) => gourdlightDailyForDay(dayAfter('2026-10-01', n)));
    expect(new Set(picks).size).toBe(6);
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
    // deterministic, and a day with no calendar falls back to the first errand
    expect(gourdlightDailyForDay('2026-10-03')).toBe(gourdlightDailyForDay('2026-10-03'));
    expect(gourdlightDailyForDay('')).toBe(GOURDLIGHT_DAILY_POOL[0]);
  });

  it("offers only the day's errand while the event runs, and none while it is closed", () => {
    const sim = world();
    sim.tick();
    for (const id of GOURDLIGHT_DAILY_POOL) expect(sim.questState(id)).toBe('unavailable');
    open(sim);
    const today = gourdlightDailyForDay(DAY);
    for (const id of GOURDLIGHT_DAILY_POOL) {
      expect(sim.questState(id), id).toBe(id === today ? 'available' : 'unavailable');
    }
    // the next reset day offers the next errand instead
    sim.resetDay = dayAfter(DAY, 1);
    const tomorrow = gourdlightDailyForDay(sim.resetDay);
    expect(tomorrow).not.toBe(today);
    expect(sim.questState(tomorrow)).toBe('available');
    expect(sim.questState(today)).toBe('unavailable');
  });
});

describe('Pumpkins from the Patch', () => {
  it('lays stray pumpkins round the field only while the event runs, off the road and clear', () => {
    const sites = gourdlightDailySites(WORLD_SEED).patch;
    expect(sites.length).toBeGreaterThanOrEqual(PATCH_PUMPKINS_WANTED + 2);
    const field = resolveScarecrowField(WORLD_SEED);
    expect(field).not.toBeNull();
    for (const s of sites) {
      // past his straw and his aggro reach (20 yd at most)
      if (field) expect(Math.hypot(s.x - field.x, s.z - field.z)).toBeGreaterThan(21);
      expect(roadDistance(s.x, s.z)).toBeGreaterThanOrEqual(DAILY_SITE_ROAD_CLEARANCE);
      expect(groundHeight(s.x, s.z, WORLD_SEED)).toBeGreaterThan(WATER_LEVEL);
      expect(isBlocked(WORLD_SEED, s.x, s.z, 0.5)).toBe(false);
    }
    const sim = world();
    sim.tick();
    expect(objectsOf(sim, PATCH_PUMPKIN_ID)).toHaveLength(0);
    open(sim);
    expect(objectsOf(sim, PATCH_PUMPKIN_ID)).toHaveLength(sites.length);
    sim.chat('/dev season off');
    sim.tick();
    expect(objectsOf(sim, PATCH_PUMPKIN_ID)).toHaveLength(0);
  });

  it('shows them only to a player on the errand, and five complete it', () => {
    const sim = world();
    open(sim);
    const pumpkins = objectsOf(sim, PATCH_PUMPKIN_ID);
    expect(isQuestGatedEntityHidden(pumpkins[0], sim.questLog)).toBe(true);
    take(sim, GOURDLIGHT_DAILY_PATCH_QUEST_ID);
    expect(isQuestGatedEntityHidden(pumpkins[0], sim.questLog)).toBe(false);
    for (const p of pumpkins.slice(0, PATCH_PUMPKINS_WANTED)) {
      standBeside(sim, p);
      sim.pickUpObject(p.id);
      sim.tick();
    }
    expect(sim.countItem(PATCH_PUMPKIN_ID)).toBe(PATCH_PUMPKINS_WANTED);
    expect(sim.questState(GOURDLIGHT_DAILY_PATCH_QUEST_ID)).toBe('ready');
    const keeper = sim.entities.get(GOURDLIGHT_KEEPER_ENTITY_ID) as Entity;
    standBeside(sim, keeper);
    sim.turnInQuest(GOURDLIGHT_DAILY_PATCH_QUEST_ID);
    sim.tick();
    expect(sim.countItem(GOURDLIGHT_TREAT_POUCH_ID)).toBe(1);
    expect(sim.countItem(PATCH_PUMPKIN_ID)).toBe(0);
    // done for the day
    expect(sim.questState(GOURDLIGHT_DAILY_PATCH_QUEST_ID)).not.toBe('available');
  });
});

describe('Boo!', () => {
  const folk = TRICK_OR_TREAT_NPCS.eastbrook_vale;

  it('needs a costume, frightens each townsperson once, and three complete it', () => {
    const sim = world();
    open(sim);
    take(sim, GOURDLIGHT_DAILY_BOO_QUEST_ID);
    const first = npcEntity(sim, folk[0]);
    standBeside(sim, first);
    sim.trickOrTreat(first.id, true);
    expect(seasonalEvents(sim.tick()).map((e) => e.what)).toEqual(['booNoCostume']);
    // a costume draught (any of Hester's three)
    sim.addItem('haunting_draught', 1);
    sim.useItem('haunting_draught');
    sim.tick();
    sim.trickOrTreat(first.id, true);
    const landed = seasonalEvents(sim.tick());
    expect(landed.map((e) => e.what)).toEqual(['boo']);
    expect(landed[0].npc).toBe(folk[0]);
    // the townsperson starts where everyone can see it
    expect(first.overheadEmoteId).toBe('cry');
    // the same one again: refused, no credit
    sim.trickOrTreat(first.id, true);
    expect(seasonalEvents(sim.tick()).map((e) => e.what)).toEqual(['booAlready']);
    expect(sim.questLog.get(GOURDLIGHT_DAILY_BOO_QUEST_ID)?.counts[0]).toBe(1);
    for (const id of folk.slice(1, 3)) {
      const npc = npcEntity(sim, id);
      standBeside(sim, npc);
      sim.trickOrTreat(npc.id, true);
      sim.tick();
    }
    expect(sim.questState(GOURDLIGHT_DAILY_BOO_QUEST_ID)).toBe('ready');
    // a fright is not a knock: the townsfolk still answer trick-or-treat today
    expect(sim.trickOrTreatedToday.filter((id) => !id.startsWith('boo_'))).toEqual([]);
  });

  it('counts the Gurglegreen goblin as a costume', () => {
    expect(wearsGourdlightCostume([{ id: 'gourdlight_toy_gurglegreen' }])).toBe(true);
    expect(wearsGourdlightCostume([{ id: 'gourdlight_toy_murmurwick' }])).toBe(false);
  });

  it('is refused to a player not on the errand', () => {
    const sim = world();
    open(sim);
    sim.addItem('haunting_draught', 1);
    sim.useItem('haunting_draught');
    sim.tick();
    const npc = npcEntity(sim, folk[0]);
    standBeside(sim, npc);
    sim.trickOrTreat(npc.id, true);
    expect(seasonalEvents(sim.tick()).map((e) => e.what)).toEqual(['booNotOnErrand']);
    expect(npc.overheadEmoteId).toBeNull();
  });
});

describe('Wicked Wicks', () => {
  it('sets five candles in each event town, off the road, clear of the dressing and chapels', () => {
    const candles = gourdlightDailySites(WORLD_SEED).candles;
    expect(candles).toHaveLength(15);
    const decor = seasonalDecorLayout(WORLD_SEED);
    for (const c of candles) {
      expect(roadDistance(c.x, c.z), c.anchor).toBeGreaterThanOrEqual(DAILY_SITE_ROAD_CLEARANCE);
      expect(chapelAt(c.x, c.z), c.anchor).toBeNull();
      expect(isBlocked(WORLD_SEED, c.x, c.z, 0.3), c.anchor).toBe(false);
      for (const p of decor.ground)
        expect(Math.hypot(p.x - c.x, p.z - c.z), c.anchor).toBeGreaterThan(1);
      for (const n of Object.values(NPCS)) {
        expect(Math.hypot(n.pos.x - c.x, n.pos.z - c.z), c.anchor).toBeGreaterThan(1.2);
      }
    }
  });

  it('six snuffed stubs complete it', () => {
    const sim = world();
    open(sim);
    take(sim, GOURDLIGHT_DAILY_WICKS_QUEST_ID);
    for (const c of objectsOf(sim, CURSED_CANDLE_ID).slice(0, 6)) {
      standBeside(sim, c);
      sim.pickUpObject(c.id);
      sim.tick();
    }
    expect(sim.questState(GOURDLIGHT_DAILY_WICKS_QUEST_ID)).toBe('ready');
  });
});

describe('A Door in Every Town', () => {
  it('counts one knock in each of the three towns', () => {
    const sim = world();
    open(sim);
    take(sim, GOURDLIGHT_DAILY_TOWNS_QUEST_ID);
    // two knocks in Eastbrook count once
    for (const id of TRICK_OR_TREAT_NPCS.eastbrook_vale.slice(0, 2)) {
      const npc = npcEntity(sim, id);
      standBeside(sim, npc);
      sim.trickOrTreat(npc.id);
      sim.tick();
    }
    expect(sim.questLog.get(GOURDLIGHT_DAILY_TOWNS_QUEST_ID)?.counts).toEqual([1, 0, 0]);
    for (const town of ['mirefen_marsh', 'thornpeak_heights']) {
      const npc = npcEntity(sim, TRICK_OR_TREAT_NPCS[town][0]);
      standBeside(sim, npc);
      sim.trickOrTreat(npc.id);
      sim.tick();
    }
    expect(sim.questState(GOURDLIGHT_DAILY_TOWNS_QUEST_ID)).toBe('ready');
  });
});

describe('Feathers for the Fire', () => {
  it('his crows drop a feather only to a player on the errand', () => {
    const row = MOBS[GOURDLIGHT_CROW_ID].loot.find((l) => l.itemId === CROW_FEATHER_ID);
    expect(row?.questId).toBe(GOURDLIGHT_DAILY_FEATHERS_QUEST_ID);
    expect(ITEMS[CROW_FEATHER_ID]?.questId).toBe(GOURDLIGHT_DAILY_FEATHERS_QUEST_ID);
    const kill = (sim: Sim) => {
      sim.chat('/dev spawn gourdlight_crow');
      sim.tick();
      const crow = [...sim.entities.values()].find(
        (e) => e.templateId === GOURDLIGHT_CROW_ID && !e.dead,
      ) as Entity;
      // biome-ignore lint/suspicious/noExplicitAny: the sim's private damage entry
      (sim as any).dealDamage(
        sim.player,
        crow,
        crow.hp + 50,
        false,
        'physical',
        'Chip',
        'hit',
        true,
      );
      sim.tick();
      standBeside(sim, crow);
      sim.lootCorpse(crow.id);
      sim.tick();
    };
    const off = world();
    open(off);
    kill(off);
    expect(off.countItem(CROW_FEATHER_ID)).toBe(0);
    const on = world();
    open(on);
    take(on, GOURDLIGHT_DAILY_FEATHERS_QUEST_ID);
    kill(on);
    expect(on.countItem(CROW_FEATHER_ID)).toBe(1);
  });
});

describe('Baskets for the Neighbours', () => {
  it('names one townsperson in each event town, and talking to each delivers', () => {
    const towns = ['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights'];
    GOURDLIGHT_BASKET_NPCS.forEach((id, i) => {
      expect(NPCS[id], id).toBeDefined();
      expect(TRICK_OR_TREAT_NPCS[towns[i]]).toContain(id);
    });
    const sim = world();
    open(sim);
    take(sim, GOURDLIGHT_DAILY_BASKETS_QUEST_ID);
    for (const id of GOURDLIGHT_BASKET_NPCS) {
      const npc = npcEntity(sim, id);
      standBeside(sim, npc);
      sim.talkToNpc(npc.id);
      sim.tick();
    }
    expect(sim.questState(GOURDLIGHT_DAILY_BASKETS_QUEST_ID)).toBe('ready');
  });
});

describe('the fright and the town credit keep the replay contract', () => {
  // biome-ignore lint/suspicious/noExplicitAny: the rng's raw state, for the draw-count pin
  const rngState = (sim: Sim) => (sim as any).rng.s as number;

  it('a BOO draws no rng, landed or refused', () => {
    const sim = world();
    open(sim);
    take(sim, GOURDLIGHT_DAILY_BOO_QUEST_ID);
    sim.addItem('haunting_draught', 1);
    sim.useItem('haunting_draught');
    sim.tick();
    const npc = npcEntity(sim, TRICK_OR_TREAT_NPCS.eastbrook_vale[0]);
    standBeside(sim, npc);
    for (let i = 0; i < 2; i++) {
      const before = rngState(sim);
      seasonalMod.knockOrBoo(sim.ctx, npc.id, true);
      expect(rngState(sim)).toBe(before);
    }
  });

  it('a knock draws exactly what it drew before round 8 (the town credit draws nothing)', () => {
    const run = (withErrand: boolean) => {
      const sim = world();
      open(sim);
      if (withErrand) take(sim, GOURDLIGHT_DAILY_TOWNS_QUEST_ID);
      const npc = npcEntity(sim, TRICK_OR_TREAT_NPCS.eastbrook_vale[1]);
      standBeside(sim, npc);
      const before = rngState(sim);
      seasonalMod.knockOrBoo(sim.ctx, npc.id, false);
      return { before, after: rngState(sim) };
    };
    const plain = run(false);
    const credited = run(true);
    // same advance from the same start, credit or not
    expect(credited.after - credited.before).toBe(plain.after - plain.before);
  });

  it('a fright survives save and load, and the knock wire carries it', () => {
    const meta = freshSeasonalPlayerState();
    knockedToday(meta, DAY).add(booLedgerKey('trader_wilkes'));
    knockedToday(meta, DAY).add('smith_haldren');
    const saved = seasonalSaveFragment(meta).seasonal;
    const back = freshSeasonalPlayerState();
    restoreSeasonalState(back, JSON.parse(JSON.stringify(saved)));
    expect(knockedTodayView(back, DAY)).toEqual(['boo_trader_wilkes', 'smith_haldren']);
    expect(decodeTrickOrTreatWire(knockedTodayView(back, DAY))).toEqual([
      'boo_trader_wilkes',
      'smith_haldren',
    ]);
  });

  it('a whole day of knocks and frights fits the ledger cap', () => {
    // every townsperson knocked AND frightened, under the saved ledger's bound (64)
    expect(TRICK_OR_TREAT_NPC_IDS.size * 2).toBeLessThanOrEqual(64);
  });
});
