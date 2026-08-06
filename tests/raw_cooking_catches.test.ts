// Raw fishing catches as cooking reagents only: non-edible content shape,
// useItem refuse (no heal, no consume), cooked meal control still eats, and
// the pure id set export for sim + Phase 2 UI reuse. Phase 2 also pins pet
// feed: kind food + foodHp gates feedPet, so raw junk catches cannot be pet food.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRawCookingCatch, RAW_COOKING_CATCH_IDS } from '../src/sim/content/items';
import { ITEMS } from '../src/sim/data';
import * as items from '../src/sim/items';
import { MATERIAL_ITEM_IDS } from '../src/sim/material_taxonomy';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';
import { localizeSimText } from '../src/ui/sim_i18n';

const RAW_CATCH_IDS = [
  'raw_mirror_trout',
  'raw_river_perch',
  'raw_marsh_pike',
  'raw_bog_eel',
  'raw_frostgill_trout',
  'raw_stonescale_carp',
  'glimmerfin_koi',
] as const;

const REFUSE = 'That is raw. Cook it first.';
const COOKED_CONTROL = 'pan_seared_perch';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

function playerWithEmptyBags(sim: Sim) {
  const pid = sim.addPlayer('warrior', 'Angler');
  const anySim = sim as unknown as {
    entities: Map<number, Entity>;
    players: Map<number, { inventory: { itemId: string; count: number }[] }>;
  };
  const p = anySim.entities.get(pid)!;
  const meta = anySim.players.get(pid)!;
  meta.inventory.length = 0;
  return { pid, p, meta };
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

describe('RAW_COOKING_CATCH_IDS', () => {
  it('is exactly the locked catch set', () => {
    expect([...RAW_COOKING_CATCH_IDS].sort()).toEqual([...RAW_CATCH_IDS].sort());
  });

  it('isRawCookingCatch matches the set and rejects non-catches', () => {
    for (const id of RAW_CATCH_IDS) expect(isRawCookingCatch(id), id).toBe(true);
    expect(isRawCookingCatch(COOKED_CONTROL)).toBe(false);
    expect(isRawCookingCatch('game_meat')).toBe(false);
    expect(isRawCookingCatch('baked_bread')).toBe(false);
    expect(isRawCookingCatch('tangled_weed')).toBe(false);
  });
});

describe('raw catch content: non-edible cooking reagents', () => {
  it('every catch is junk, has no foodHp, and is an honest material', () => {
    for (const id of RAW_CATCH_IDS) {
      const def = ITEMS[id];
      expect(def, id).toBeTruthy();
      expect(def.kind, id).toBe('junk');
      expect(def.foodHp, id).toBeUndefined();
      expect(MATERIAL_ITEM_IDS.has(id), id).toBe(true);
    }
  });
});

// Phase 3 economy review: floors stay weak copper so market/cook demand wins
// over vendor dump. Numbers accepted unchanged (2026-08-04); pin so a future
// raise cannot silently gut the raw-fish market.
describe('raw catch sellValue floors', () => {
  const FLOORS = {
    raw_river_perch: 2,
    raw_mirror_trout: 3,
    raw_marsh_pike: 6,
    raw_bog_eel: 6,
    raw_frostgill_trout: 10,
    raw_stonescale_carp: 10,
    glimmerfin_koi: 75,
  } as const;

  it('pins the accepted weak copper floors', () => {
    for (const [id, copper] of Object.entries(FLOORS)) {
      expect(ITEMS[id]?.sellValue, id).toBe(copper);
    }
  });

  it('keeps zone-tier monotonicity (vale < marsh < peak < rare koi)', () => {
    expect(ITEMS.raw_river_perch.sellValue).toBeLessThan(ITEMS.raw_marsh_pike.sellValue);
    expect(ITEMS.raw_mirror_trout.sellValue).toBeLessThan(ITEMS.raw_marsh_pike.sellValue);
    expect(ITEMS.raw_marsh_pike.sellValue).toBeLessThan(ITEMS.raw_frostgill_trout.sellValue);
    expect(ITEMS.raw_bog_eel.sellValue).toBeLessThan(ITEMS.raw_stonescale_carp.sellValue);
    expect(ITEMS.raw_frostgill_trout.sellValue).toBeLessThan(ITEMS.glimmerfin_koi.sellValue);
  });

  it('raw floors stay below their primary cooked meal vendor value', () => {
    expect(ITEMS.raw_river_perch.sellValue).toBeLessThan(ITEMS.pan_seared_perch.sellValue);
    expect(ITEMS.raw_marsh_pike.sellValue).toBeLessThan(ITEMS.herbed_marsh_pike.sellValue);
    expect(ITEMS.raw_bog_eel.sellValue).toBeLessThan(ITEMS.ashwood_smoked_eel.sellValue);
    expect(ITEMS.raw_frostgill_trout.sellValue).toBeLessThan(ITEMS.frostgill_chowder.sellValue);
    expect(ITEMS.raw_stonescale_carp.sellValue).toBeLessThan(ITEMS.silvered_carp_supper.sellValue);
  });
});

describe('useItem: raw catches refuse, cooked control still eats', () => {
  it('refuses every raw catch: error once, no eat, stack unchanged, no heal', () => {
    for (const id of RAW_CATCH_IDS) {
      const sim = makeWorld();
      const { pid, p } = playerWithEmptyBags(sim);
      const ctx = ctxOf(sim);
      const hpBefore = p.hp;
      sim.addItem(id, 3, pid);
      expect(sim.countItem(id, pid)).toBe(3);

      items.useItem(ctx, id, pid);

      const errs = errorTexts(sim.drainEvents());
      expect(errs, id).toEqual([REFUSE]);
      expect(p.eating, id).toBeNull();
      expect(p.sitting, id).toBe(false);
      expect(sim.countItem(id, pid), id).toBe(3);
      expect(p.hp, id).toBe(hpBefore);
    }
  });

  it('cooked control still starts eating and consumes one', () => {
    const sim = makeWorld();
    const { pid, p } = playerWithEmptyBags(sim);
    const ctx = ctxOf(sim);
    expect(ITEMS[COOKED_CONTROL]?.kind).toBe('food');
    expect(ITEMS[COOKED_CONTROL]?.foodHp).toBeGreaterThan(0);
    sim.addItem(COOKED_CONTROL, 2, pid);

    items.useItem(ctx, COOKED_CONTROL, pid);

    expect(errorTexts(sim.drainEvents())).not.toContain(REFUSE);
    expect(p.sitting).toBe(true);
    expect(p.eating?.itemId).toBe(COOKED_CONTROL);
    expect(sim.countItem(COOKED_CONTROL, pid)).toBe(1);
  });
});

describe('raw catch refuse localization', () => {
  it('sim_i18n EXACT-matches the refuse literal', () => {
    // English identity: the EXACT key re-renders the same bytes for en.
    expect(localizeSimText(REFUSE)).toBe(REFUSE);
  });
});

describe('pet feed: raw catches are not pet food', () => {
  it('catches fail the feedPet kind+foodHp gate that live food must pass', () => {
    // feedPet (src/sim/pet/pet_commands.ts) only accepts kind food with foodHp.
    // Raw catches are junk reagents with no foodHp, so they can never be pet food.
    for (const id of RAW_CATCH_IDS) {
      const def = ITEMS[id];
      expect(def.kind, id).not.toBe('food');
      expect(def.foodHp, id).toBeUndefined();
    }
    const feedSrc = readFileSync(join(process.cwd(), 'src/sim/pet/pet_commands.ts'), 'utf8');
    expect(feedSrc).toMatch(/kind !== ['"]food['"]\s*\|\|\s*!item\.foodHp/);
  });
});
