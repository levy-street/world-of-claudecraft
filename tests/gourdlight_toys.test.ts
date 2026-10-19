// Hester's toys (content/gourdlight_eve.ts GOURDLIGHT_TOYS, sim: seasonal/seasonal_toys.ts):
// five reusable cosmetic toys on her shelf (the cauldron's own rules: gourdlight_cauldron.test.ts).
// Pinned here: the shelf rows and prices, each
// toy's look and its duration, the cooldown that stops spamming, never consumed, refused
// in combat, in stealth and out of season, the prank's targeting rules (another living
// player, in reach, out of combat), no stat or combat effect, no rng drawn, the cues every
// nearby client draws and hears, the right-click cancel, and the sweep when the event ends.
import { afterEach, describe, expect, it } from 'vitest';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import {
  GOURDLIGHT_EVE_ID,
  GOURDLIGHT_KEEPER_ENTITY_ID,
  GOURDLIGHT_KEEPER_NPC,
  GOURDLIGHT_SHOP_ITEMS,
  GOURDLIGHT_SHOP_PRICES,
  GOURDLIGHT_SWEET_ID,
  GOURDLIGHT_TOYS,
  type GourdlightToy,
  JAR_OF_MISCHIEF_ID,
  PRANKERS_PUMPKIN_ID,
} from '../src/sim/content/gourdlight_eve';
import { ITEM_BASE_COOLDOWNS } from '../src/sim/content/item_cooldowns';
import { ITEMS } from '../src/sim/data';
import { SEASONAL_COSMETIC_AURA_IDS, TOY_FX_ABILITY_PREFIX, TOY_SFX } from '../src/sim/seasonal';
import { syncSeasonalDecorColliders } from '../src/sim/seasonal_decor_colliders';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

afterEach(() => syncSeasonalDecorColliders(WORLD_SEED, null));

function world(): Sim {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
  sim.resetDay = '2026-10-20';
  return sim;
}

function open(sim: Sim): void {
  sim.chat('/dev season on');
  sim.tick();
}

const toyOf = (effect: GourdlightToy['effect']): GourdlightToy => {
  const toy = GOURDLIGHT_TOYS.find((t) => t.effect === effect);
  if (!toy) throw new Error(effect);
  return toy;
};
/** The toys whose look plays on their own user (the cauldron sets an object down). */
const SELF_TOYS = GOURDLIGHT_TOYS.filter((t) => t.effect !== 'prank' && t.effect !== 'cauldron');
const PRANK = toyOf('prank');
const auraOn = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
const seasonal = (events: SimEvent[]) =>
  events.filter((e): e is Extract<SimEvent, { type: 'seasonal' }> => e.type === 'seasonal');
const errors = (events: SimEvent[]) =>
  events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
const toyCues = (events: SimEvent[]) =>
  events.filter(
    (e): e is Extract<SimEvent, { type: 'spellfxAt' }> =>
      e.type === 'spellfxAt' && (e.ability ?? '').startsWith(TOY_FX_ABILITY_PREFIX),
  );
// biome-ignore lint/suspicious/noExplicitAny: the rng's raw state, for the draw-count pin
const rngState = (sim: Sim) => (sim as any).rng.s as number;

function ticks(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) out.push(...sim.tick());
  return out;
}

/** A second player standing `dist` yards east of the first, out of combat. */
function friend(sim: Sim, dist: number): Entity {
  const pid = sim.addPlayer('mage', 'Pip');
  const e = sim.entities.get(pid) as Entity;
  e.pos.x = sim.player.pos.x + dist;
  e.pos.z = sim.player.pos.z;
  e.pos.y = sim.player.pos.y;
  return e;
}

describe("Hester's toy shelf", () => {
  it('sells all five toys after the Jar of Mischief, priced around it, for sweets', () => {
    const jarAt = GOURDLIGHT_SHOP_ITEMS.indexOf(JAR_OF_MISCHIEF_ID);
    expect(GOURDLIGHT_SHOP_ITEMS.slice(jarAt + 1, jarAt + 6)).toEqual(
      GOURDLIGHT_TOYS.map((t) => t.itemId),
    );
    expect(GOURDLIGHT_TOYS.map((t) => [t.itemId, GOURDLIGHT_SHOP_PRICES[t.itemId]])).toEqual([
      ['prankers_pumpkin', 4],
      ['wanderwisp_lantern', 5],
      ['sack_of_startled_bats', 3],
      ['murmurwick_candle', 5],
      ['gurglegreen_cauldron', 5],
    ]);
    for (const toy of GOURDLIGHT_TOYS) {
      expect(GOURDLIGHT_KEEPER_NPC.vendorItems).toContain(toy.itemId);
      const price = GOURDLIGHT_SHOP_PRICES[toy.itemId];
      expect(Math.abs(price - GOURDLIGHT_SHOP_PRICES[JAR_OF_MISCHIEF_ID])).toBeLessThanOrEqual(2);
      expect(ITEMS[toy.itemId]?.priceItem).toEqual({ itemId: GOURDLIGHT_SWEET_ID, count: price });
    }
  });

  it('every toy is soulbound, unique, unsellable, stat-free and bound to the event', () => {
    for (const toy of GOURDLIGHT_TOYS) {
      const def = ITEMS[toy.itemId];
      expect(def?.name, toy.itemId).toBe(toy.itemName);
      expect(def?.soulbound, toy.itemId).toBe(true);
      expect(def?.unique, toy.itemId).toBe(true);
      expect(def?.noVendorSell, toy.itemId).toBe(true);
      expect(def?.sellValue, toy.itemId).toBe(0);
      expect(def?.seasonalEvent, toy.itemId).toBe(GOURDLIGHT_EVE_ID);
      expect(def?.use, toy.itemId).toEqual({ type: 'seasonal', action: 'toy' });
      expect('stats' in (def ?? {}), toy.itemId).toBe(false);
      // the bar swipe reads the same cooldown the sim sets
      expect(ITEM_BASE_COOLDOWNS[toy.itemId], toy.itemId).toBe(toy.cooldown);
      expect(SEASONAL_COSMETIC_AURA_IDS.has(toy.auraId), toy.itemId).toBe(true);
    }
  });

  it('buys a toy for its sweets, at any stall', () => {
    const sim = world();
    open(sim);
    const keeper = sim.entities.get(GOURDLIGHT_KEEPER_ENTITY_ID) as Entity;
    sim.player.pos.x = keeper.pos.x + 1.5;
    sim.player.pos.z = keeper.pos.z;
    sim.player.pos.y = keeper.pos.y;
    const toy = toyOf('candle');
    sim.addItem(GOURDLIGHT_SWEET_ID, 10);
    sim.buyItem(keeper.id, toy.itemId);
    sim.tick();
    expect(sim.countItem(toy.itemId)).toBe(1);
    expect(sim.countItem(GOURDLIGHT_SWEET_ID)).toBe(10 - toy.price);
  });
});

describe('the self toys (lantern, bats, candle)', () => {
  it('each plays its look for its duration, starts its cooldown and is never consumed', () => {
    for (const toy of SELF_TOYS) {
      const sim = world();
      open(sim);
      sim.addItem(toy.itemId, 1);
      sim.useItem(toy.itemId);
      const aura = auraOn(sim.player, toy.auraId);
      expect(aura?.kind, toy.itemId).toBe('seasonal_cosmetic');
      expect(aura?.duration, toy.itemId).toBe(toy.duration);
      expect(aura?.undispellable, toy.itemId).toBe(true);
      expect(sim.player.cooldowns.get(toy.itemId), toy.itemId).toBe(toy.cooldown);
      expect(sim.countItem(toy.itemId), toy.itemId).toBe(1);
      const events = sim.tick();
      expect(seasonal(events).map((e) => [e.what, e.trick])).toEqual([['toy', toy.itemId]]);
      // the cue every nearby client draws, carrying the toy's own sound
      const [cue] = toyCues(events);
      expect(cue?.ability).toBe(TOY_FX_ABILITY_PREFIX + toy.effect);
      expect(cue?.sfxKey).toBe(TOY_SFX[toy.effect]);
      expect(cue?.sourceId).toBe(sim.player.id);
      // its timer runs down like any aura's, and it is gone once that runs out
      expect(auraOn(sim.player, toy.auraId)?.remaining, toy.itemId).toBeCloseTo(
        toy.duration - DT,
        5,
      );
      const left = auraOn(sim.player, toy.auraId);
      if (left) left.remaining = 0.2;
      ticks(sim, 0.3);
      expect(auraOn(sim.player, toy.auraId), toy.itemId).toBeUndefined();
    }
  });

  it('the bats run their whole six seconds and fly off', () => {
    const sim = world();
    open(sim);
    const toy = toyOf('bats');
    sim.addItem(toy.itemId, 1);
    sim.useItem(toy.itemId);
    ticks(sim, toy.duration - 0.2);
    expect(auraOn(sim.player, toy.auraId)).toBeDefined();
    ticks(sim, 0.4);
    expect(auraOn(sim.player, toy.auraId)).toBeUndefined();
  });

  it('the lantern and the candle carry the spot they were set down; the bats do not', () => {
    for (const toy of SELF_TOYS) {
      const sim = world();
      open(sim);
      sim.addItem(toy.itemId, 1);
      sim.useItem(toy.itemId);
      const aura = auraOn(sim.player, toy.auraId);
      if (toy.effect === 'lantern' || toy.effect === 'candle') {
        const dx = (aura?.value2 ?? 999) - sim.player.pos.x;
        const dz = (aura?.value3 ?? 999) - sim.player.pos.z;
        expect(Math.hypot(dx, dz), toy.itemId).toBeCloseTo(1.2, 1);
      } else {
        expect(aura?.value2, toy.itemId).toBeUndefined();
      }
    }
  });

  it('cannot be spammed: refused while its cooldown runs, usable again after it', () => {
    const sim = world();
    open(sim);
    const toy = toyOf('bats');
    sim.addItem(toy.itemId, 1);
    sim.useItem(toy.itemId);
    sim.tick();
    ticks(sim, toy.duration + 0.5);
    expect(auraOn(sim.player, toy.auraId)).toBeUndefined();
    sim.useItem(toy.itemId);
    const refused = sim.tick();
    expect(errors(refused)).toContain('That item is not ready yet.');
    expect(auraOn(sim.player, toy.auraId)).toBeUndefined();
    expect(toyCues(refused)).toHaveLength(0);
    ticks(sim, toy.cooldown - toy.duration);
    expect(sim.player.cooldowns.has(toy.itemId)).toBe(false);
    sim.useItem(toy.itemId);
    sim.tick();
    expect(auraOn(sim.player, toy.auraId)).toBeDefined();
  });

  it('every cooldown outlasts its look, so one toy never stacks on itself', () => {
    for (const toy of GOURDLIGHT_TOYS)
      expect(toy.cooldown, toy.itemId).toBeGreaterThan(toy.duration);
  });

  it('is refused in combat, in stealth and while the event is closed, spending nothing', () => {
    for (const toy of SELF_TOYS) {
      const sim = world();
      // out of season: refused, and the event-bound toy does not even stay in the bags
      sim.addItem(toy.itemId, 1);
      sim.useItem(toy.itemId);
      expect(
        seasonal(sim.tick()).map((e) => e.what),
        toy.itemId,
      ).toEqual(['notActive', 'boundItemGone']);
      expect(sim.countItem(toy.itemId), toy.itemId).toBe(0);
      open(sim);
      sim.addItem(toy.itemId, 1);
      sim.player.inCombat = true;
      sim.useItem(toy.itemId);
      expect(errors(sim.tick()), toy.itemId).toContain("You can't do that while in combat.");
      sim.player.inCombat = false;
      sim.player.combatTimer = 999;
      sim.player.stealthed = true;
      sim.useItem(toy.itemId);
      expect(
        seasonal(sim.tick()).map((e) => e.what),
        toy.itemId,
      ).toEqual(['toyHidden']);
      sim.player.stealthed = false;
      expect(auraOn(sim.player, toy.auraId), toy.itemId).toBeUndefined();
      expect(sim.player.cooldowns.has(toy.itemId), toy.itemId).toBe(false);
      expect(sim.countItem(toy.itemId), toy.itemId).toBe(1);
    }
  });
});

describe("Pranker's Pumpkin", () => {
  it('lands on another player in reach: their head is a pumpkin for 30 s, thrower on cooldown', () => {
    const sim = world();
    open(sim);
    const pip = friend(sim, 8);
    sim.addItem(PRANKERS_PUMPKIN_ID, 1);
    sim.player.targetId = pip.id;
    sim.useItem(PRANKERS_PUMPKIN_ID);
    const head = auraOn(pip, PRANK.auraId);
    expect(head?.kind).toBe('seasonal_cosmetic');
    expect(head?.duration).toBe(30);
    expect(head?.sourceId).toBe(sim.player.id);
    expect(auraOn(sim.player, PRANK.auraId)).toBeUndefined();
    expect(sim.player.cooldowns.get(PRANKERS_PUMPKIN_ID)).toBe(PRANK.cooldown);
    expect(sim.countItem(PRANKERS_PUMPKIN_ID)).toBe(1);
    const events = sim.tick();
    const lines = seasonal(events).map((e) => [e.what, e.who, e.pid]);
    expect(lines).toEqual([
      ['toy', 'Pip', sim.player.id],
      ['pranked', sim.player.name, pip.id],
    ]);
    const [cue] = toyCues(events);
    expect(cue?.targetId).toBe(pip.id);
    expect(cue?.sourceId).toBe(sim.player.id);
    // the splat's sound is the render layer's, timed to the landing
    expect(cue?.sfxKey).toBeUndefined();
    ticks(sim, 30.2);
    expect(auraOn(pip, PRANK.auraId)).toBeUndefined();
  });

  it('needs a valid target: none, itself, a creature, too far, dead, hidden or fighting', () => {
    const sim = world();
    open(sim);
    sim.addItem(PRANKERS_PUMPKIN_ID, 1);
    const tryAt = (targetId: number | null): SimEvent[] => {
      sim.player.targetId = targetId;
      sim.useItem(PRANKERS_PUMPKIN_ID);
      return sim.tick();
    };
    expect(errors(tryAt(null))).toContain('You have no target.');
    expect(seasonal(tryAt(sim.player.id)).map((e) => e.what)).toEqual(['prankNeedsPlayer']);
    const keeper = sim.entities.get(GOURDLIGHT_KEEPER_ENTITY_ID) as Entity;
    expect(seasonal(tryAt(keeper.id)).map((e) => e.what)).toEqual(['prankNeedsPlayer']);
    const far = friend(sim, (PRANK.range ?? 0) + 1);
    expect(errors(tryAt(far.id))).toContain('Out of range.');
    const pip = friend(sim, 5);
    for (const flag of ['dead', 'stealthed', 'inCombat'] as const) {
      pip[flag] = true;
      expect(
        seasonal(tryAt(pip.id)).map((e) => e.what),
        flag,
      ).toEqual(['prankNeedsPlayer']);
      pip[flag] = false;
      pip.combatTimer = 999;
    }
    for (const e of [far, pip]) expect(auraOn(e, PRANK.auraId)).toBeUndefined();
    expect(sim.player.cooldowns.has(PRANKERS_PUMPKIN_ID)).toBe(false);
    // and the thrower in a fight never throws
    sim.player.inCombat = true;
    expect(errors(tryAt(pip.id))).toContain("You can't do that while in combat.");
    expect(auraOn(pip, PRANK.auraId)).toBeUndefined();
  });

  it('the pranked player can right-click the head off', () => {
    const sim = world();
    open(sim);
    const pip = friend(sim, 4);
    sim.addItem(PRANKERS_PUMPKIN_ID, 1);
    sim.player.targetId = pip.id;
    sim.useItem(PRANKERS_PUMPKIN_ID);
    sim.tick();
    expect(auraOn(pip, PRANK.auraId)).toBeDefined();
    sim.cancelAura(PRANK.auraId, pip.id);
    sim.tick();
    expect(auraOn(pip, PRANK.auraId)).toBeUndefined();
  });
});

describe('the toys are pure fun', () => {
  it('change no stat, health, resource or speed, and draw no rng', () => {
    const sim = world();
    open(sim);
    const pip = friend(sim, 4);
    sim.tick();
    const sheet = (e: Entity) =>
      JSON.stringify([e.stats, e.maxHp, e.hp, e.resource, e.maxResource, e.inCombat]);
    const mine = sheet(sim.player);
    const theirs = sheet(pip);
    for (const toy of GOURDLIGHT_TOYS) {
      sim.addItem(toy.itemId, 1);
      sim.player.targetId = pip.id;
      const before = rngState(sim);
      sim.useItem(toy.itemId);
      expect(rngState(sim), toy.itemId).toBe(before);
    }
    sim.tick();
    // the lantern, the bats and the candle on their user (the cauldron stands on the ground)
    expect(sim.player.auras.filter((a) => a.kind === 'seasonal_cosmetic')).toHaveLength(3);
    expect(sheet(sim.player)).toBe(mine);
    expect(sheet(pip)).toBe(theirs);
  });

  it('every toy cue names a real, catalogued sound', () => {
    for (const key of Object.values(TOY_SFX)) expect(key in SFX_CLIPS, key).toBe(true);
    for (const key of [
      'impact_prank_pumpkin_splat',
      'gurglegreen_bubble_loop',
      'spell_gurglegreen_quaff',
    ])
      expect(key in SFX_CLIPS, key).toBe(true);
  });
});

describe('when Gourdlight Eve ends', () => {
  it('every running toy look comes off and every toy leaves the bags', () => {
    const sim = world();
    open(sim);
    const pip = friend(sim, 4);
    for (const toy of GOURDLIGHT_TOYS) sim.addItem(toy.itemId, 1);
    sim.player.targetId = pip.id;
    for (const toy of GOURDLIGHT_TOYS) sim.useItem(toy.itemId);
    sim.tick();
    expect(auraOn(pip, PRANK.auraId)).toBeDefined();
    sim.chat('/dev season off');
    sim.tick();
    for (const toy of GOURDLIGHT_TOYS) {
      expect(auraOn(sim.player, toy.auraId), toy.itemId).toBeUndefined();
      expect(sim.countItem(toy.itemId), toy.itemId).toBe(0);
    }
    expect(auraOn(pip, PRANK.auraId)).toBeUndefined();
    // the cauldron set down while it ran is gone from the world too
    const potLeft = [...sim.entities.values()].some(
      (e) => e.objectItemId === 'gurglegreen_cauldron',
    );
    expect(potLeft).toBe(false);
  });
});
