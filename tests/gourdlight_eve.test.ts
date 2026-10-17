// Gourdlight Eve and the seasonal-event core (src/sim/seasonal/): closed unless
// the host or /dev opens it, the keeper rises and leaves with the event, the
// trick-or-treat knock (once per NPC per reset day, treat or trick, both paid in
// sweets, the rounds quest credited), the pumpkin head worn and re-worn, the
// shop's token price, the seasonal quest gate, the daily lock and the save shape.
import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { DEEDS } from '../src/sim/content/deeds';
import {
  CARVED_PUMPKIN_HEAD_ID,
  GOURDLIGHT_COSTUMES,
  GOURDLIGHT_EVE_ID,
  GOURDLIGHT_KEEPER_ENTITY_ID,
  GOURDLIGHT_KEEPER_NPC,
  GOURDLIGHT_KEEPER_POSTS,
  GOURDLIGHT_ROUNDS_DOORS,
  GOURDLIGHT_ROUNDS_QUEST_ID,
  GOURDLIGHT_SHOP_ITEMS,
  GOURDLIGHT_SHOP_PRICES,
  GOURDLIGHT_SWEET_ID,
  GOURDLIGHT_TITLE_WRITS,
  GOURDLIGHT_TRICKS,
  JAR_OF_MISCHIEF_ID,
  PUMPKIN_HEAD_AURA_ID,
  TRICK_OR_TREAT,
  TRICK_OR_TREAT_NPCS,
} from '../src/sim/content/gourdlight_eve';
import { getActiveWorldContent, ITEMS, NPCS, QUESTS } from '../src/sim/data';
import {
  activeSeasonalEventOf,
  freshSeasonalPlayerState,
  restoreSeasonalState,
  seasonalSaveFragment,
  updateSeasonal,
} from '../src/sim/seasonal';
import {
  KEEPER_POST_RINGS,
  resolvedKeeperPosts,
  resolveKeeperPost,
} from '../src/sim/seasonal_keeper_posts';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

function world(): Sim {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
  sim.resetDay = '2026-10-20';
  return sim;
}

function open(sim: Sim): void {
  sim.chat('/dev season on');
  sim.tick();
}

function npcEntity(sim: Sim, templateId: string): Entity {
  const npc = [...sim.entities.values()].find(
    (e) => e.kind === 'npc' && e.templateId === templateId,
  );
  if (!npc) throw new Error(`no ${templateId}`);
  return npc;
}

function standBeside(sim: Sim, npc: Entity): void {
  sim.player.pos.x = npc.pos.x + 1.5;
  sim.player.pos.z = npc.pos.z;
  sim.player.pos.y = npc.pos.y;
}

function seasonalEvents(events: SimEvent[]) {
  return events.filter((e): e is Extract<SimEvent, { type: 'seasonal' }> => e.type === 'seasonal');
}

describe('the seasonal core', () => {
  it('is closed on a world with no host calendar, and /dev season opens and closes it', () => {
    const sim = world();
    sim.tick();
    expect(sim.activeSeasonalEvent).toBeNull();
    expect(sim.entities.has(GOURDLIGHT_KEEPER_ENTITY_ID)).toBe(false);
    open(sim);
    expect(sim.activeSeasonalEvent).toBe(GOURDLIGHT_EVE_ID);
    expect(sim.entities.get(GOURDLIGHT_KEEPER_ENTITY_ID)?.templateId).toBe(
      GOURDLIGHT_KEEPER_NPC.id,
    );
    sim.chat('/dev season off');
    sim.tick();
    expect(sim.activeSeasonalEvent).toBeNull();
    expect(sim.entities.has(GOURDLIGHT_KEEPER_ENTITY_ID)).toBe(false);
  });

  it('follows the host-fed event when no dev override is set, and auto hands control back', () => {
    const sim = world();
    sim.seasonal.hostEventId = GOURDLIGHT_EVE_ID;
    sim.tick();
    expect(sim.activeSeasonalEvent).toBe(GOURDLIGHT_EVE_ID);
    sim.chat('/dev season off');
    sim.tick();
    expect(sim.activeSeasonalEvent).toBeNull();
    sim.chat('/dev season auto');
    sim.tick();
    expect(sim.activeSeasonalEvent).toBe(GOURDLIGHT_EVE_ID);
    expect(activeSeasonalEventOf({ hostEventId: 'x', devOverride: undefined })).toBe('x');
  });

  it('places the keeper clear of every collider', () => {
    const { x, z } = GOURDLIGHT_KEEPER_NPC.pos;
    expect(isBlocked(WORLD_SEED, x, z, 0.5)).toBe(false);
  });
});

describe('trick-or-treat', () => {
  it('lists only real NPCs, each standing in its own city', () => {
    const zones = getActiveWorldContent().zones;
    for (const [zoneId, ids] of Object.entries(TRICK_OR_TREAT_NPCS)) {
      const zone = zones.find((z) => z.id === zoneId);
      expect(zone, zoneId).toBeDefined();
      for (const id of ids) {
        const def = NPCS[id];
        expect(def, id).toBeDefined();
        const d = Math.hypot(def.pos.x - (zone?.hub.x ?? 0), def.pos.z - (zone?.hub.z ?? 0));
        expect(d, `${id} distance from ${zoneId}`).toBeLessThan(60);
      }
    }
  });

  it('is refused while the event is closed, without spending the door', () => {
    const sim = world();
    sim.tick();
    const npc = npcEntity(sim, 'trader_wilkes');
    standBeside(sim, npc);
    sim.trickOrTreat(npc.id);
    const events = seasonalEvents(sim.tick());
    expect(events.map((e) => e.what)).toEqual(['notActive']);
    expect(sim.trickOrTreatedToday).toEqual([]);
  });

  it('answers once per NPC per reset day with sweets, and credits the rounds quest', () => {
    const sim = world();
    open(sim);
    standBeside(sim, sim.entities.get(GOURDLIGHT_KEEPER_ENTITY_ID) as Entity);
    sim.acceptQuest(GOURDLIGHT_ROUNDS_QUEST_ID);
    expect(sim.questLog.has(GOURDLIGHT_ROUNDS_QUEST_ID)).toBe(true);
    const ids = Object.values(TRICK_OR_TREAT_NPCS).flat();
    let sweets = 0;
    let tricks = 0;
    for (const id of ids) {
      const npc = npcEntity(sim, id);
      standBeside(sim, npc);
      sim.trickOrTreat(npc.id);
      const [ev] = seasonalEvents(sim.tick());
      expect(ev?.what === 'treat' || ev?.what === 'trick', id).toBe(true);
      expect(ev.npc).toBe(id);
      if (ev.what === 'treat') expect(ev.sweets).toBe(TRICK_OR_TREAT.treatSweets);
      else {
        tricks++;
        expect(ev.sweets).toBe(TRICK_OR_TREAT.trickSweets);
        expect(GOURDLIGHT_TRICKS.some((t) => t.id === ev.trick)).toBe(true);
        expect(
          sim.player.auras.some((a) => a.id === ev.trick && a.kind === 'seasonal_cosmetic'),
        ).toBe(true);
      }
      sweets += ev.sweets ?? 0;
    }
    expect(sim.countItem(GOURDLIGHT_SWEET_ID)).toBe(sweets);
    expect(sweets).toBeGreaterThan(0);
    // Sixteen knocks are a fair sample of a 35% trick table on this seed.
    expect(tricks).toBeGreaterThan(0);
    expect(tricks).toBeLessThan(ids.length);
    expect([...sim.trickOrTreatedToday]).toEqual([...ids].sort());
    expect(sim.questState(GOURDLIGHT_ROUNDS_QUEST_ID)).toBe('ready');
    const progress = sim.questLog.get(GOURDLIGHT_ROUNDS_QUEST_ID);
    expect(progress?.counts[0]).toBe(GOURDLIGHT_ROUNDS_DOORS);

    // The same door twice in one day is refused and pays nothing.
    const wilkes = npcEntity(sim, 'trader_wilkes');
    standBeside(sim, wilkes);
    sim.trickOrTreat(wilkes.id);
    expect(seasonalEvents(sim.tick()).map((e) => e.what)).toEqual(['alreadyKnocked']);
    expect(sim.countItem(GOURDLIGHT_SWEET_ID)).toBe(sweets);

    // A new reset day opens every door again.
    sim.resetDay = '2026-10-21';
    sim.trickOrTreat(wilkes.id);
    const [again] = seasonalEvents(sim.tick());
    expect(again.what === 'treat' || again.what === 'trick').toBe(true);
    expect(sim.trickOrTreatedToday).toEqual(['trader_wilkes']);
  });

  it('refuses a knock from out of reach and an NPC that does not answer', () => {
    const sim = world();
    open(sim);
    const npc = npcEntity(sim, 'trader_wilkes');
    sim.player.pos.x = npc.pos.x + TRICK_OR_TREAT.range + 3;
    sim.player.pos.z = npc.pos.z;
    sim.trickOrTreat(npc.id);
    expect(seasonalEvents(sim.tick()).map((e) => e.what)).toEqual(['tooFar']);
    const merchant = npcEntity(sim, 'the_merchant');
    standBeside(sim, merchant);
    sim.trickOrTreat(merchant.id);
    expect(seasonalEvents(sim.tick())).toEqual([]);
    expect(sim.trickOrTreatedToday).toEqual([]);
  });

  it('draws the same outcomes from the same seed (deterministic)', () => {
    const run = () => {
      const sim = world();
      open(sim);
      const out: string[] = [];
      for (const id of TRICK_OR_TREAT_NPCS.eastbrook_vale) {
        const npc = npcEntity(sim, id);
        standBeside(sim, npc);
        sim.trickOrTreat(npc.id);
        const [ev] = seasonalEvents(sim.tick());
        out.push(`${ev.what}:${ev.trick ?? ''}`);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('the keeper, the shop and the pumpkin head', () => {
  it('sells the pumpkin head for sweets, and refuses a buyer who cannot pay', () => {
    const sim = world();
    open(sim);
    const keeper = sim.entities.get(GOURDLIGHT_KEEPER_ENTITY_ID) as Entity;
    standBeside(sim, keeper);
    const price = GOURDLIGHT_SHOP_PRICES[CARVED_PUMPKIN_HEAD_ID];
    sim.buyItem(keeper.id, CARVED_PUMPKIN_HEAD_ID);
    sim.tick();
    expect(sim.countItem(CARVED_PUMPKIN_HEAD_ID)).toBe(0);
    sim.addItem(GOURDLIGHT_SWEET_ID, price + 2);
    const copper = sim.copper;
    sim.buyItem(keeper.id, CARVED_PUMPKIN_HEAD_ID);
    sim.tick();
    expect(sim.countItem(CARVED_PUMPKIN_HEAD_ID)).toBe(1);
    expect(sim.countItem(GOURDLIGHT_SWEET_ID)).toBe(2);
    expect(sim.copper).toBe(copper);
    // A count request on a token row still buys one.
    sim.addItem(GOURDLIGHT_SWEET_ID, 30);
    sim.buyItem(keeper.id, JAR_OF_MISCHIEF_ID, { count: 5 });
    sim.tick();
    expect(sim.countItem(JAR_OF_MISCHIEF_ID)).toBe(1);
    expect(sim.countItem(GOURDLIGHT_SWEET_ID)).toBe(
      32 - GOURDLIGHT_SHOP_PRICES[JAR_OF_MISCHIEF_ID],
    );
  });

  it('wears the head while the event runs, puts it back after a strip, and takes it off on close', () => {
    const sim = world();
    sim.addItem(CARVED_PUMPKIN_HEAD_ID, 1);
    sim.tick();
    sim.useItem(CARVED_PUMPKIN_HEAD_ID);
    expect(seasonalEvents(sim.tick()).map((e) => e.what)).toEqual(['notActive']);
    const head = () => sim.player.auras.some((a) => a.id === PUMPKIN_HEAD_AURA_ID);
    expect(head()).toBe(false);
    open(sim);
    sim.useItem(CARVED_PUMPKIN_HEAD_ID);
    expect(seasonalEvents(sim.tick()).map((e) => e.what)).toEqual(['pumpkinOn']);
    expect(head()).toBe(true);
    expect(sim.countItem(CARVED_PUMPKIN_HEAD_ID)).toBe(1);
    // A body that lost the aura (a death's cleanup) gets it back while worn.
    sim.player.auras = sim.player.auras.filter((a) => a.id !== PUMPKIN_HEAD_AURA_ID);
    sim.tick();
    expect(head()).toBe(true);
    // The head is never a stat: the sheet is unchanged by wearing it.
    sim.chat('/dev season off');
    sim.tick();
    expect(head()).toBe(false);
    // Still the character's choice: it comes back when the event opens again.
    open(sim);
    expect(head()).toBe(true);
    sim.useItem(CARVED_PUMPKIN_HEAD_ID);
    sim.tick();
    expect(head()).toBe(false);
  });

  it('a worn head whose item is gone comes off for good, never stuck on the body', () => {
    const sim = world();
    open(sim);
    sim.addItem(CARVED_PUMPKIN_HEAD_ID, 1);
    sim.tick();
    sim.useItem(CARVED_PUMPKIN_HEAD_ID);
    sim.tick();
    const head = () => sim.player.auras.some((a) => a.id === PUMPKIN_HEAD_AURA_ID);
    expect(head()).toBe(true);
    sim.removeItem(CARVED_PUMPKIN_HEAD_ID, 1);
    sim.tick();
    expect(head()).toBe(false);
    expect(sim.serializeCharacter(sim.playerId)?.seasonal?.head).toBeUndefined();
    // a new head starts off: wearing is a fresh choice
    sim.addItem(CARVED_PUMPKIN_HEAD_ID, 1);
    sim.tick();
    expect(head()).toBe(false);
  });

  it('no trick body in a fight: the Jar refuses in combat, and combat ends a running trick', () => {
    const sim = world();
    open(sim);
    sim.addItem(JAR_OF_MISCHIEF_ID, 2);
    sim.tick();
    sim.player.inCombat = true;
    sim.useItem(JAR_OF_MISCHIEF_ID);
    sim.tick();
    const tricked = () => sim.player.auras.some((a) => a.kind === 'seasonal_cosmetic');
    expect(tricked()).toBe(false);
    expect(sim.countItem(JAR_OF_MISCHIEF_ID)).toBe(2);
    sim.player.inCombat = false;
    sim.player.combatTimer = 999;
    sim.useItem(JAR_OF_MISCHIEF_ID);
    sim.tick();
    expect(tricked()).toBe(true);
    sim.player.inCombat = true;
    sim.player.combatTimer = 0;
    sim.tick();
    expect(tricked()).toBe(false);
  });

  it('plays a trick from the Jar of Mischief and spends it', () => {
    const sim = world();
    open(sim);
    sim.addItem(JAR_OF_MISCHIEF_ID, 2);
    sim.tick();
    sim.useItem(JAR_OF_MISCHIEF_ID);
    const [ev] = seasonalEvents(sim.tick());
    expect(ev.what).toBe('jarTrick');
    expect(sim.player.auras.filter((a) => a.kind === 'seasonal_cosmetic')).toHaveLength(1);
    expect(sim.countItem(JAR_OF_MISCHIEF_ID)).toBe(1);
  });

  it('every event item is bound, unsellable and stat-free', () => {
    for (const id of [GOURDLIGHT_SWEET_ID, CARVED_PUMPKIN_HEAD_ID, JAR_OF_MISCHIEF_ID]) {
      const def = ITEMS[id];
      expect(def?.soulbound, id).toBe(true);
      expect(def?.sellValue, id).toBe(0);
      expect('stats' in (def ?? {}), id).toBe(false);
    }
  });
});

describe('the rounds quest', () => {
  it('is offered only while its event runs, and locks until the daily reset once handed in', () => {
    const sim = world();
    sim.tick();
    expect(sim.questState(GOURDLIGHT_ROUNDS_QUEST_ID)).toBe('unavailable');
    open(sim);
    expect(sim.questState(GOURDLIGHT_ROUNDS_QUEST_ID)).toBe('available');
    expect(QUESTS[GOURDLIGHT_ROUNDS_QUEST_ID].dailyReset).toBe(true);
    const keeper = sim.entities.get(GOURDLIGHT_KEEPER_ENTITY_ID) as Entity;
    standBeside(sim, keeper);
    sim.acceptQuest(GOURDLIGHT_ROUNDS_QUEST_ID);
    for (const id of TRICK_OR_TREAT_NPCS.eastbrook_vale.slice(0, GOURDLIGHT_ROUNDS_DOORS)) {
      const npc = npcEntity(sim, id);
      standBeside(sim, npc);
      sim.trickOrTreat(npc.id);
      sim.tick();
    }
    standBeside(sim, keeper);
    sim.turnInQuest(GOURDLIGHT_ROUNDS_QUEST_ID);
    sim.tick();
    expect(sim.questLog.has(GOURDLIGHT_ROUNDS_QUEST_ID)).toBe(false);
    expect(sim.countItem('gourdlight_treat_pouch')).toBe(1);
    expect(sim.questState(GOURDLIGHT_ROUNDS_QUEST_ID)).toBe('unavailable');
  });
});

describe('the seasonal save shape', () => {
  it('omits an untouched ledger and round-trips a used one', () => {
    const fresh = freshSeasonalPlayerState();
    expect(seasonalSaveFragment(fresh)).toEqual({});
    fresh.seasonalDay = '2026-10-20';
    fresh.seasonalKnocked.add('trader_wilkes');
    fresh.pumpkinHeadWorn = true;
    const saved = seasonalSaveFragment(fresh).seasonal;
    expect(saved).toEqual({ day: '2026-10-20', knocked: ['trader_wilkes'], head: true });
    const back = freshSeasonalPlayerState();
    restoreSeasonalState(back, saved);
    expect(back.seasonalDay).toBe('2026-10-20');
    expect([...back.seasonalKnocked]).toEqual(['trader_wilkes']);
    expect(back.pumpkinHeadWorn).toBe(true);
    // A hostile save cannot balloon the ledger or smuggle non-strings in.
    restoreSeasonalState(back, {
      knocked: [...Array(500)].map((_, i) => `n${i}`).concat([42 as unknown as string]),
    });
    expect(back.seasonalKnocked.size).toBe(64);
  });

  it('a whole character save carries the ledger through addPlayer', () => {
    const sim = world();
    open(sim);
    const npc = npcEntity(sim, 'trader_wilkes');
    standBeside(sim, npc);
    sim.trickOrTreat(npc.id);
    sim.tick();
    const state = sim.serializeCharacter(sim.playerId);
    expect(state?.seasonal?.knocked).toEqual(['trader_wilkes']);
    const other = world();
    const pid = other.addPlayer('mage', 'Copy', { state: state ?? undefined });
    expect(other.players.get(pid)?.seasonalKnocked.has('trader_wilkes')).toBe(true);
  });
});

describe('the seasonal aura names localize (buff frame, combat log)', () => {
  it('maps every trick and the worn head through the catalog, in English and a fill', async () => {
    const { localizeSimAuraName } = await import('../src/ui/sim_i18n');
    const { ensureLocaleLoaded, setLanguage } = await import('../src/ui/i18n');
    const { pumpkinHeadAura, trickAura } = await import('../src/sim/seasonal/seasonal_cosmetics');
    const { GOURDLIGHT_TRICKS } = await import('../src/sim/content/gourdlight_eve');
    setLanguage('en');
    expect(localizeSimAuraName(pumpkinHeadAura(1).name)).toBe('Carved Pumpkin Head');
    GOURDLIGHT_TRICKS.forEach((trick, i) => {
      expect(localizeSimAuraName(trickAura(i, 1).name)).toBe(trick.name);
    });
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    try {
      expect(localizeSimAuraName('Batty')).toBe('コウモリ化');
      expect(localizeSimAuraName('Carved Pumpkin Head')).toBe('彫りカボチャの頭');
    } finally {
      setLanguage('en');
    }
  });
});

describe('the seasonal cosmetics stay off the raid frames', () => {
  it('neither the worn head nor a trick spends a party frame aura slot', async () => {
    const { isPartyFrameRelevantAura } = await import('../src/sim/aura_classify');
    const { pumpkinHeadAura, trickAura } = await import('../src/sim/seasonal/seasonal_cosmetics');
    expect(isPartyFrameRelevantAura(pumpkinHeadAura(1))).toBe(false);
    expect(isPartyFrameRelevantAura(trickAura(0, 1))).toBe(false);
  });
});

describe('a stall in each city', () => {
  it('raises Hester at a stall in Eastbrook, Fenbridge and Highwatch, each under her own id', () => {
    const sim = world();
    open(sim);
    const zones = getActiveWorldContent().zones;
    const posts = resolvedKeeperPosts(WORLD_SEED);
    expect(posts.map((p) => p.post.zoneId)).toEqual([
      'eastbrook_vale',
      'mirefen_marsh',
      'thornpeak_heights',
    ]);
    for (const p of posts) {
      const npc = sim.entities.get(p.post.entityId);
      expect(npc?.templateId, p.post.id).toBe(GOURDLIGHT_KEEPER_NPC.id);
      expect(npc?.pos.x).toBeCloseTo(p.pos.x, 5);
      expect(npc?.pos.z).toBeCloseTo(p.pos.z, 5);
      expect(npc?.facing).toBeCloseTo(p.facing, 5);
      const hub = zones.find((z) => z.id === p.post.zoneId)?.hub;
      expect(Math.hypot(p.pos.x - (hub?.x ?? 0), p.pos.z - (hub?.z ?? 0))).toBeLessThan(45);
    }
    expect(new Set(GOURDLIGHT_KEEPER_POSTS.map((p) => p.entityId)).size).toBe(3);
    sim.chat('/dev season off');
    sim.tick();
    for (const p of GOURDLIGHT_KEEPER_POSTS) expect(sim.entities.has(p.entityId)).toBe(false);
  });

  it('seats a whole stall at every post today, on her own spot (no rework has moved her)', () => {
    new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    for (const p of resolvedKeeperPosts(WORLD_SEED)) {
      expect(p.stall, p.post.id).not.toBeNull();
      expect(p.moved, p.post.id).toBe(false);
      expect(isBlocked(WORLD_SEED, p.pos.x, p.pos.z, 0.5), p.post.id).toBe(false);
    }
  });

  it('walks out to the nearest spot that takes the stall when a rework builds over hers', () => {
    new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const post = GOURDLIGHT_KEEPER_POSTS[1];
    // an NPC planted on her counter: her own spot no longer takes the stall
    const resolved = resolveKeeperPost(WORLD_SEED, post, [{ x: post.pos.x, z: post.pos.z + 1.5 }]);
    expect(resolved.moved).toBe(true);
    expect(resolved.stall).not.toBeNull();
    const d = Math.hypot(resolved.pos.x - post.pos.x, resolved.pos.z - post.pos.z);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(KEEPER_POST_RINGS[KEEPER_POST_RINGS.length - 1] + 1e-6);
  });

  it('sells the same shelf and hands out the same quest at every stall', () => {
    const sim = world();
    open(sim);
    for (const p of GOURDLIGHT_KEEPER_POSTS) {
      const npc = sim.entities.get(p.entityId) as Entity;
      expect(npc.questIds).toEqual([GOURDLIGHT_ROUNDS_QUEST_ID]);
    }
    expect(GOURDLIGHT_KEEPER_NPC.vendorItems).toEqual([...GOURDLIGHT_SHOP_ITEMS]);
  });
});

describe('the costume draughts', () => {
  it('cost about half a day of sweets and wear their body for ten minutes, spent on use', () => {
    const sim = world();
    open(sim);
    for (const c of GOURDLIGHT_COSTUMES) {
      expect(GOURDLIGHT_SHOP_PRICES[c.itemId]).toBe(10);
      expect(ITEMS[c.itemId].priceItem).toEqual({ itemId: GOURDLIGHT_SWEET_ID, count: 10 });
      sim.addItem(c.itemId, 1);
      sim.useItem(c.itemId);
      const aura = sim.player.auras.find((a) => a.id === c.auraId);
      expect(aura?.kind, c.itemId).toBe('seasonal_cosmetic');
      expect(aura?.remaining).toBe(600);
      expect(sim.countItem(c.itemId)).toBe(0);
    }
    // one body at a time: the last one drunk is the one worn
    const worn = sim.player.auras.filter((a) => GOURDLIGHT_COSTUMES.some((c) => c.auraId === a.id));
    expect(worn.map((a) => a.id)).toEqual([GOURDLIGHT_COSTUMES[2].auraId]);
  });

  it('never in a fight: refused in combat (kept), and combat starting takes the body off', () => {
    const sim = world();
    open(sim);
    const c = GOURDLIGHT_COSTUMES[0];
    sim.addItem(c.itemId, 1);
    sim.player.inCombat = true;
    sim.useItem(c.itemId);
    expect(sim.countItem(c.itemId)).toBe(1);
    sim.player.inCombat = false;
    sim.useItem(c.itemId);
    expect(sim.player.auras.some((a) => a.id === c.auraId)).toBe(true);
    sim.player.inCombat = true;
    updateSeasonal((sim as any).ctx);
    expect(sim.player.auras.some((a) => a.id === c.auraId)).toBe(false);
  });

  it('comes off when the event closes, and is refused while it is closed', () => {
    const sim = world();
    open(sim);
    const c = GOURDLIGHT_COSTUMES[1];
    sim.addItem(c.itemId, 2);
    sim.useItem(c.itemId);
    sim.chat('/dev season off');
    sim.tick();
    expect(sim.player.auras.some((a) => a.id === c.auraId)).toBe(false);
    sim.useItem(c.itemId);
    expect(sim.countItem(c.itemId)).toBe(1);
  });
});

describe('the title writs', () => {
  it('cost 60 to 100 sweets and grant their title Feat once, spent on use', () => {
    const sim = world();
    open(sim);
    const meta = (sim as any).players.get(sim.playerId);
    for (const w of GOURDLIGHT_TITLE_WRITS) {
      const price = GOURDLIGHT_SHOP_PRICES[w.itemId];
      expect(price).toBeGreaterThanOrEqual(60);
      expect(price).toBeLessThanOrEqual(100);
      const deed = DEEDS[w.deedId];
      expect(deed?.reward).toEqual({ kind: 'title', text: w.title });
      expect(deed?.feat).toBe(true);
      expect(deed?.renown).toBe(0);
      sim.addItem(w.itemId, 1);
      sim.useItem(w.itemId);
      expect(meta.deedsEarned.has(w.deedId)).toBe(true);
      expect(sim.countItem(w.itemId)).toBe(0);
      // the title is wearable through the one title validator
      sim.setActiveTitle(w.deedId);
      expect(sim.player.title).toBe(w.deedId);
    }
  });

  it('refuses a second writ for a title already earned, keeping it', () => {
    const sim = world();
    open(sim);
    const w = GOURDLIGHT_TITLE_WRITS[0];
    sim.addItem(w.itemId, 1);
    sim.useItem(w.itemId);
    sim.addItem(w.itemId, 1);
    sim.useItem(w.itemId);
    const ev = seasonalEvents(sim.tick());
    expect(sim.countItem(w.itemId)).toBe(1);
    expect(ev.some((e) => e.what === 'titleKnown')).toBe(true);
  });
});
