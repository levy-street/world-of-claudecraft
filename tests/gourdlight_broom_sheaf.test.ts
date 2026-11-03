// The Emberbristle Broom can be bought after five daily kills, or rarely drops directly.
// Each looted kill under Old Thatchgrin's world-boss daily lockout pays one
// Emberwoven Sheaf instead, Hester sells the broom for five, a character who keeps the
// broom gets no more sheaves and cannot buy a second, and the sheaves are permanent
// like the broom, so they carry over when Gourdlight Eve closes.
import { afterEach, describe, expect, it } from 'vitest';
import {
  CARVED_PUMPKIN_HEAD_ID,
  GOURDLIGHT_BROOM_ID,
  GOURDLIGHT_BROOM_SHEAVES,
  GOURDLIGHT_KEEPER_ENTITY_ID,
  GOURDLIGHT_KEEPER_NPC,
  GOURDLIGHT_SHEAF_ID,
} from '../src/sim/content/gourdlight_eve';
import { THATCHGRIN_ID, THATCHGRIN_SACK_ID } from '../src/sim/content/gourdlight_eve_scarecrow';
import { ITEMS, MOBS } from '../src/sim/data';
import { syncSeasonalDecorColliders } from '../src/sim/seasonal_decor_colliders';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';
import { seasonalItemTooltipText } from '../src/ui/seasonal_item_tooltip';

afterEach(() => syncSeasonalDecorColliders(WORLD_SEED, null));

function world(): Sim {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
  sim.resetDay = '2026-10-20';
  return sim;
}

function boss(sim: Sim): Entity | undefined {
  return [...sim.entities.values()].find((e) => e.templateId === THATCHGRIN_ID && !e.dead);
}

/** Stand him up (opening the event), kill him alone, and return the corpse. */
function kill(sim: Sim): Entity {
  sim.chat('/dev scarecrow reset');
  sim.tick();
  const b = boss(sim);
  if (!b) throw new Error('no Thatchgrin');
  const p = sim.player;
  p.pos = { ...b.pos, x: b.pos.x + 2 };
  p.prevPos = { ...p.pos };
  p.maxHp = 1_000_000;
  p.hp = 1_000_000;
  (sim as any).dealDamage(p, b, 10, false, 'physical', 'Chip', 'hit', true);
  sim.tick();
  (sim as any).dealDamage(p, b, b.hp + 10, false, 'physical', 'Chip', 'hit', true);
  sim.tick();
  expect(b.dead).toBe(true);
  return b;
}

const mine = (sim: Sim, b: Entity) =>
  (b.loot?.items ?? []).filter((s) => s.personalFor?.includes(sim.playerId)).map((s) => s.itemId);

function meta(sim: Sim) {
  return (sim as any).players.get(sim.playerId);
}

function standAtKeeper(sim: Sim): Entity {
  const keeper = sim.entities.get(GOURDLIGHT_KEEPER_ENTITY_ID) as Entity;
  sim.player.pos.x = keeper.pos.x + 1.5;
  sim.player.pos.z = keeper.pos.z;
  sim.player.pos.y = keeper.pos.y;
  return keeper;
}

describe('his loot table', () => {
  it('carries the broom only as his rare drop; it pays one sheaf, stopped by an owned broom', () => {
    const loot = MOBS[THATCHGRIN_ID].loot;
    // round 10: a 3% direct drop, never to a keeper (tests/gourdlight_scarecrow_night.test.ts)
    const broom = loot.filter((l) => l.itemId === GOURDLIGHT_BROOM_ID);
    expect(broom).toEqual([{ itemId: GOURDLIGHT_BROOM_ID, chance: 0.03, unlessOwned: true }]);
    expect(
      Object.entries(MOBS).some(
        ([id, m]) => id !== THATCHGRIN_ID && m.loot.some((l) => l.itemId === GOURDLIGHT_BROOM_ID),
      ),
    ).toBe(false);
    const row = loot.find((l) => l.itemId === GOURDLIGHT_SHEAF_ID);
    expect(row?.chance).toBe(1);
    expect(row?.unlessOwnedItem).toBe(GOURDLIGHT_BROOM_ID);
    expect(row?.unlessOwned).toBeUndefined();
    expect(row?.rollGroup).toBeUndefined();
    // the pumpkin head stays exactly as it was: guaranteed, never a second copy
    const head = loot.find((l) => l.itemId === CARVED_PUMPKIN_HEAD_ID);
    expect(head?.chance).toBe(1);
    expect(head?.unlessOwned).toBe(true);
  });
});

describe('the sheaf, once a day', () => {
  it('a looted kill pays exactly one sheaf, and the daily lockout stops a second', () => {
    const sim = world();
    const b = kill(sim);
    const items = mine(sim, b);
    expect(items.filter((id) => id === GOURDLIGHT_SHEAF_ID)).toHaveLength(1);
    expect(items).not.toContain(GOURDLIGHT_BROOM_ID);
    expect(items).toContain(CARVED_PUMPKIN_HEAD_ID);
    sim.player.pos = { ...b.pos };
    expect(sim.lootCorpse(b.id)).toBe(true);
    expect(sim.countItem(GOURDLIGHT_SHEAF_ID)).toBe(1);
    expect(sim.countItem(GOURDLIGHT_BROOM_ID)).toBe(0);
    // same day: he stands again and falls again, and pays this character nothing
    const b2 = kill(sim);
    expect(mine(sim, b2)).toHaveLength(0);
    expect(sim.countItem(GOURDLIGHT_SHEAF_ID)).toBe(1);
    // the next day (the dev lockout reset stands in for the daily reset): one more
    sim.chat('/dev scarecrow lockout');
    const b3 = kill(sim);
    expect(mine(sim, b3).filter((id) => id === GOURDLIGHT_SHEAF_ID)).toHaveLength(1);
    sim.player.pos = { ...b3.pos };
    expect(sim.lootCorpse(b3.id)).toBe(true);
    expect(sim.countItem(GOURDLIGHT_SHEAF_ID)).toBe(2);
  });

  it('a character who keeps the broom (bags or bank) gets no sheaf, the rest still pays', () => {
    for (const where of ['bags', 'bank'] as const) {
      const sim = world();
      sim.chat('/dev season on');
      sim.tick();
      if (where === 'bags') sim.addItem(GOURDLIGHT_BROOM_ID, 1);
      else meta(sim).bank.inventory.push({ itemId: GOURDLIGHT_BROOM_ID, count: 1 });
      const items = mine(sim, kill(sim));
      expect(items, where).not.toContain(GOURDLIGHT_SHEAF_ID);
      expect(items, where).toContain(THATCHGRIN_SACK_ID);
    }
  });

  it('owning the broom moves no roll (the draw order is a function of the roster alone)', () => {
    const run = (owned: boolean) => {
      const sim = world();
      sim.chat('/dev season on');
      sim.tick();
      if (owned) sim.addItem(GOURDLIGHT_BROOM_ID, 1);
      kill(sim);
      return (sim as any).ctx.rng.next();
    };
    expect(run(true)).toBe(run(false));
  });
});

describe("Hester's broom", () => {
  it('is on her shelf, priced in sheaves', () => {
    expect(GOURDLIGHT_KEEPER_NPC.vendorItems).toContain(GOURDLIGHT_BROOM_ID);
    expect(GOURDLIGHT_BROOM_SHEAVES).toBe(5);
    expect(ITEMS[GOURDLIGHT_BROOM_ID].priceItem).toEqual({
      itemId: GOURDLIGHT_SHEAF_ID,
      count: GOURDLIGHT_BROOM_SHEAVES,
    });
  });

  it('five sheaves buy the broom (no riding skill or level 20 needed), four do not', () => {
    const sim = world();
    sim.chat('/dev season on');
    sim.tick();
    meta(sim).ridingTrained = false;
    sim.player.level = 12;
    const keeper = standAtKeeper(sim);
    sim.addItem(GOURDLIGHT_SHEAF_ID, GOURDLIGHT_BROOM_SHEAVES - 1);
    const copper = sim.copper;
    sim.buyItem(keeper.id, GOURDLIGHT_BROOM_ID);
    sim.tick();
    expect(sim.countItem(GOURDLIGHT_BROOM_ID)).toBe(0);
    expect(sim.countItem(GOURDLIGHT_SHEAF_ID)).toBe(GOURDLIGHT_BROOM_SHEAVES - 1);
    sim.addItem(GOURDLIGHT_SHEAF_ID, 1);
    sim.buyItem(keeper.id, GOURDLIGHT_BROOM_ID);
    sim.tick();
    expect(sim.countItem(GOURDLIGHT_BROOM_ID)).toBe(1);
    expect(sim.countItem(GOURDLIGHT_SHEAF_ID)).toBe(0);
    expect(sim.copper).toBe(copper);
  });

  it('refuses a second broom, whether the first is in the bags or the bank', () => {
    for (const where of ['bags', 'bank'] as const) {
      const sim = world();
      sim.chat('/dev season on');
      sim.tick();
      if (where === 'bags') sim.addItem(GOURDLIGHT_BROOM_ID, 1);
      else meta(sim).bank.inventory.push({ itemId: GOURDLIGHT_BROOM_ID, count: 1 });
      const keeper = standAtKeeper(sim);
      sim.addItem(GOURDLIGHT_SHEAF_ID, GOURDLIGHT_BROOM_SHEAVES);
      sim.buyItem(keeper.id, GOURDLIGHT_BROOM_ID);
      sim.tick();
      expect(sim.countItem(GOURDLIGHT_BROOM_ID), where).toBe(where === 'bags' ? 1 : 0);
      expect(sim.countItem(GOURDLIGHT_SHEAF_ID), where).toBe(GOURDLIGHT_BROOM_SHEAVES);
    }
  });
});

describe('the sheaf itself', () => {
  it('is a soulbound, permanent token that stacks at least five', () => {
    const def = ITEMS[GOURDLIGHT_SHEAF_ID];
    expect(def.name).toBe('Emberwoven Sheaf');
    expect(def.seasonalEvent).toBeUndefined();
    expect(def.soulbound).toBe(true);
    expect(def.noVendorSell).toBe(true);
    expect(def.stackSize ?? 1).toBeGreaterThanOrEqual(GOURDLIGHT_BROOM_SHEAVES);
  });

  it('stays in the bags and bank after the event closes', () => {
    const sim = world();
    sim.chat('/dev season on');
    sim.tick();
    sim.addItem(GOURDLIGHT_SHEAF_ID, 3);
    meta(sim).bank.inventory.push({ itemId: GOURDLIGHT_SHEAF_ID, count: 1 });
    sim.tick();
    expect(sim.countItem(GOURDLIGHT_SHEAF_ID)).toBe(3);
    sim.chat('/dev season off');
    sim.tick();
    expect(sim.countItem(GOURDLIGHT_SHEAF_ID)).toBe(3);
    expect(
      meta(sim).bank.inventory.some((s: { itemId: string }) => s.itemId === GOURDLIGHT_SHEAF_ID),
    ).toBe(true);
  });

  it('its tooltip says what it is for, with the live price', () => {
    const text = seasonalItemTooltipText({ id: GOURDLIGHT_SHEAF_ID }) ?? '';
    expect(text).toContain(`trades ${GOURDLIGHT_BROOM_SHEAVES} for the broom`);
    expect(text).toContain('Old Thatchgrin');
    expect(text).toContain('until you own the Emberbristle Broom');
    const broom = seasonalItemTooltipText({ id: GOURDLIGHT_BROOM_ID }) ?? '';
    expect(broom).toContain(`for ${GOURDLIGHT_BROOM_SHEAVES} Emberwoven Sheaves`);
  });
});
