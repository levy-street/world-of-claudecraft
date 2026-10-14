// The Season 1 (WARFARE) and Season 2 (Vanguard) caster PvP sets grant
// immunity to damage cast pushback at two pieces. Season 1 carries it as a
// stat-set knob (content/item_sets.ts), Season 2 through the set engine's
// global talent seam (content/vanguard_set_bonuses.ts); both land on
// Entity.castPushbackReduction, which pushbackCast reads.
import { describe, expect, it } from 'vitest';
import {
  ITEM_SETS,
  PVP_CASTER_SET_2PC_PUSHBACK_REDUCTION,
  PVP_CASTER_SET_2PC_PUSHBACK_TEXT,
  SET_WARFARE_ASHSTALKER,
  SET_WARFARE_CINDERWEAVE,
  SET_WARFARE_FURYFORGED,
  SET_WARFARE_STORMBOUND,
  SET_WARFARE_THORNHIDE,
} from '../src/sim/content/item_sets';
import { SEASON2_SETS } from '../src/sim/content/pvp_honor_season2';
import { VANGUARD_CASTER_SET_IDS } from '../src/sim/content/vanguard_set_bonuses';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, PlayerClass } from '../src/sim/types';

const SEASON1_SETS: ReadonlyArray<{ setId: string; cls: PlayerClass; caster: boolean }> = [
  { setId: SET_WARFARE_STORMBOUND, cls: 'shaman', caster: true },
  { setId: SET_WARFARE_CINDERWEAVE, cls: 'mage', caster: true },
  { setId: SET_WARFARE_THORNHIDE, cls: 'druid', caster: true },
  { setId: SET_WARFARE_FURYFORGED, cls: 'warrior', caster: false },
  { setId: SET_WARFARE_ASHSTALKER, cls: 'rogue', caster: false },
];

function season1Pieces(setId: string): string[] {
  return Object.values(ITEMS)
    .filter((item) => (item as { set?: string }).set === setId)
    .map((item) => item.id)
    .sort();
}

// A caster set is one whose pieces carry Intellect (with Spell or Healing
// Power alongside), which is how the task scopes "caster".
function isCasterBySets(itemIds: readonly string[]): boolean {
  return itemIds.some((id) => {
    const item = ITEMS[id] as { stats?: { int?: number } } | undefined;
    return (item?.stats?.int ?? 0) > 0;
  });
}

function wear(cls: PlayerClass, itemIds: readonly string[], count: number, seed = 61): Sim {
  const sim = new Sim({ seed, playerClass: cls, autoEquip: false });
  sim.setPlayerLevel(20);
  const meta = (
    sim as unknown as { players: Map<number, { equipment: Record<string, string> }> }
  ).players.get(sim.player.id);
  for (const id of itemIds.slice(0, count)) {
    sim.addItem(id, 1);
    sim.equipItem(id);
    expect(Object.values(meta?.equipment ?? {}), `${id} equipped`).toContain(id);
  }
  sim.tick();
  return sim;
}

describe('the caster PvP set roster', () => {
  it('matches the Intellect-carrying sets exactly, in both seasons', () => {
    for (const set of SEASON1_SETS) {
      expect(isCasterBySets(season1Pieces(set.setId)), set.setId).toBe(set.caster);
    }
    const casterSeason2 = SEASON2_SETS.filter((set) => isCasterBySets(set.itemIds)).map(
      (set) => set.setId,
    );
    expect([...VANGUARD_CASTER_SET_IDS].sort()).toEqual(casterSeason2.sort());
    expect(VANGUARD_CASTER_SET_IDS).toHaveLength(14);
  });

  it('says so on every caster 2-piece tooltip, and on no other set', () => {
    const casterIds = new Set([
      ...SEASON1_SETS.filter((set) => set.caster).map((set) => set.setId),
      ...VANGUARD_CASTER_SET_IDS,
    ]);
    const allPvp = [...SEASON1_SETS.map((set) => set.setId), ...SEASON2_SETS.map((s) => s.setId)];
    for (const setId of allPvp) {
      const twoPiece = ITEM_SETS[setId]?.bonuses.find((tier) => tier.pieces === 2);
      expect(twoPiece, setId).toBeDefined();
      expect(twoPiece?.text.includes(PVP_CASTER_SET_2PC_PUSHBACK_TEXT), setId).toBe(
        casterIds.has(setId),
      );
    }
  });
});

describe('two caster pieces grant pushback immunity (Season 1)', () => {
  for (const set of SEASON1_SETS) {
    it(`${set.setId}: ${set.caster ? 'immune at 2 pieces, not at 1' : 'never immune'}`, () => {
      const pieces = season1Pieces(set.setId);
      expect(pieces.length).toBeGreaterThanOrEqual(2);
      expect(wear(set.cls, pieces, 1).player.castPushbackReduction).toBe(0);
      expect(wear(set.cls, pieces, 2).player.castPushbackReduction).toBe(
        set.caster ? PVP_CASTER_SET_2PC_PUSHBACK_REDUCTION : 0,
      );
    });
  }
});

describe('two caster pieces grant pushback immunity (Season 2)', () => {
  for (const set of SEASON2_SETS) {
    const caster = VANGUARD_CASTER_SET_IDS.includes(set.setId);
    it(`${set.setId}: ${caster ? 'immune at 2 pieces, not at 1' : 'never immune'}`, () => {
      const cls = set.cls as PlayerClass;
      expect(wear(cls, set.itemIds, 1).player.castPushbackReduction).toBe(0);
      expect(wear(cls, set.itemIds, 2).player.castPushbackReduction).toBe(
        caster ? PVP_CASTER_SET_2PC_PUSHBACK_REDUCTION : 0,
      );
    });
  }
});

describe('a real cast is not pushed back by damage', () => {
  function castDelayUnderHit(pieces: number): number {
    const sim = wear('mage', season1Pieces(SET_WARFARE_CINDERWEAVE), pieces, 62);
    const player = sim.player;
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    const mob = createMob(9911, MOBS.forest_wolf, 20, {
      x: player.pos.x,
      y: player.pos.y,
      z: player.pos.z + 20,
    });
    mob.hostile = true;
    mob.maxHp = mob.hp = 100_000;
    (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
    sim.targetEntity(mob.id);
    player.facing = 0;
    player.resource = player.maxResource;
    sim.castAbility('frostbolt');
    expect(player.castingAbility).toBe('frostbolt');
    const totalBefore = player.castTotal;
    ctx.dealDamage(mob, player, 10, false, 'physical', 'Bite', 'hit');
    return player.castTotal - totalBefore;
  }

  it('a 2-piece Cinderweave mage keeps its cast time; one piece is pushed back', () => {
    expect(castDelayUnderHit(2)).toBe(0);
    expect(castDelayUnderHit(1)).toBeGreaterThan(0);
  });
});
