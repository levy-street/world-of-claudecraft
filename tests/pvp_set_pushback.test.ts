// The Season 1 (WARFARE) and Season 2 (Vanguard) PvP sets grant immunity to
// damage cast pushback at two pieces, for every class that has a cast damage
// can delay. Season 1 carries it as a stat-set knob on all five families
// (content/item_sets.ts), Season 2 through the set engine's global talent seam
// (content/vanguard_set_bonuses.ts); both land on Entity.castPushbackReduction,
// which pushbackCast reads.
import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import {
  ITEM_SETS,
  PVP_SET_2PC_PUSHBACK_REDUCTION,
  PVP_SET_2PC_PUSHBACK_TEXT,
  SET_WARFARE_ASHSTALKER,
  SET_WARFARE_CINDERWEAVE,
  SET_WARFARE_FURYFORGED,
  SET_WARFARE_STORMBOUND,
  SET_WARFARE_THORNHIDE,
} from '../src/sim/content/item_sets';
import { SEASON2_SETS } from '../src/sim/content/pvp_honor_season2';
import { VANGUARD_PUSHBACK_SET_IDS } from '../src/sim/content/vanguard_set_bonuses';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, PlayerClass } from '../src/sim/types';

const SEASON1_SETS: ReadonlyArray<{ setId: string; cls: PlayerClass }> = [
  { setId: SET_WARFARE_STORMBOUND, cls: 'shaman' },
  { setId: SET_WARFARE_CINDERWEAVE, cls: 'mage' },
  { setId: SET_WARFARE_THORNHIDE, cls: 'druid' },
  { setId: SET_WARFARE_FURYFORGED, cls: 'paladin' },
  { setId: SET_WARFARE_ASHSTALKER, cls: 'hunter' },
];

function season1Pieces(setId: string): string[] {
  return Object.values(ITEMS)
    .filter((item) => (item as { set?: string }).set === setId)
    .map((item) => item.id)
    .sort();
}

// A spec "has a delayable cast" when its kit holds a cast-time or channeled
// ability that damage pushback can reach: not uninterruptible (Bladestorm), not
// Shadewolf (exempt by id in damage.ts), and not gated away from that spec.
function delayableCasts(cls: string, spec: string): string[] {
  return Object.values(ABILITIES)
    .filter(
      (a) =>
        a.class === cls &&
        (a.castTime > 0 || a.channel !== undefined) &&
        a.uninterruptible !== true &&
        a.id !== 'ghost_wolf' &&
        (a.specs === undefined || a.specs.includes(spec)) &&
        !(a.excludeSpecs ?? []).includes(spec),
    )
    .map((a) => a.id);
}

function wear(
  cls: PlayerClass,
  itemIds: readonly string[],
  count: number,
  seed = 61,
  spec?: string,
): Sim {
  const sim = new Sim({ seed, playerClass: cls, autoEquip: false });
  sim.setPlayerLevel(20);
  if (spec) expect(sim.setSpec(spec)).toBe(true);
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

describe('the PvP set pushback roster', () => {
  it('Season 2: exactly the sets whose spec has a cast damage can delay', () => {
    const delayable = SEASON2_SETS.filter(
      (set) => delayableCasts(set.cls, set.spec).length > 0,
    ).map((set) => set.setId);
    expect([...VANGUARD_PUSHBACK_SET_IDS].sort()).toEqual(delayable.sort());
    expect(VANGUARD_PUSHBACK_SET_IDS).toHaveLength(21);
    // The six left out are every warrior and rogue set, and nothing else.
    const left = SEASON2_SETS.filter((set) => !VANGUARD_PUSHBACK_SET_IDS.includes(set.setId));
    expect(new Set(left.map((set) => set.cls))).toEqual(new Set(['warrior', 'rogue']));
    expect(left).toHaveLength(6);
  });

  it('Marksmanship, the case that asked for it, is in through its rotation shots', () => {
    expect(delayableCasts('hunter', 'marksmanship')).toEqual(
      expect.arrayContaining(['aimed_shot', 'measured_shot', 'rapid_fire']),
    );
    expect(VANGUARD_PUSHBACK_SET_IDS).toContain('vanguard_hunter_marksmanship');
  });

  it('says so on every pushback 2-piece tooltip, and on no other PvP set', () => {
    const pushbackIds = new Set([
      ...SEASON1_SETS.map((set) => set.setId),
      ...VANGUARD_PUSHBACK_SET_IDS,
    ]);
    const allPvp = [...SEASON1_SETS.map((set) => set.setId), ...SEASON2_SETS.map((s) => s.setId)];
    for (const setId of allPvp) {
      const twoPiece = ITEM_SETS[setId]?.bonuses.find((tier) => tier.pieces === 2);
      expect(twoPiece, setId).toBeDefined();
      expect(twoPiece?.text.includes(PVP_SET_2PC_PUSHBACK_TEXT), setId).toBe(
        pushbackIds.has(setId),
      );
    }
  });
});

describe('two pieces grant pushback immunity (Season 1)', () => {
  for (const set of SEASON1_SETS) {
    it(`${set.setId}: immune at 2 pieces, not at 1`, () => {
      const pieces = season1Pieces(set.setId);
      expect(pieces.length).toBeGreaterThanOrEqual(2);
      expect(wear(set.cls, pieces, 1).player.castPushbackReduction).toBe(0);
      expect(wear(set.cls, pieces, 2).player.castPushbackReduction).toBe(
        PVP_SET_2PC_PUSHBACK_REDUCTION,
      );
    });
  }
});

describe('two pieces grant pushback immunity (Season 2)', () => {
  for (const set of SEASON2_SETS) {
    const immune = VANGUARD_PUSHBACK_SET_IDS.includes(set.setId);
    it(`${set.setId}: ${immune ? 'immune at 2 pieces, not at 1' : 'never immune'}`, () => {
      const cls = set.cls as PlayerClass;
      expect(wear(cls, set.itemIds, 1).player.castPushbackReduction).toBe(0);
      expect(wear(cls, set.itemIds, 2).player.castPushbackReduction).toBe(
        immune ? PVP_SET_2PC_PUSHBACK_REDUCTION : 0,
      );
    });
  }
});

describe('a real cast is not pushed back by damage', () => {
  function castDelayUnderHit(
    cls: PlayerClass,
    itemIds: readonly string[],
    pieces: number,
    abilityId: string,
    spec?: string,
  ): number {
    const sim = wear(cls, itemIds, pieces, 62, spec);
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
    sim.castAbility(abilityId);
    expect(player.castingAbility).toBe(abilityId);
    const totalBefore = player.castTotal;
    ctx.dealDamage(mob, player, 10, false, 'physical', 'Bite', 'hit');
    return player.castTotal - totalBefore;
  }

  it('a 2-piece Cinderweave mage keeps its Frostbolt cast time; one piece is pushed back', () => {
    const pieces = season1Pieces(SET_WARFARE_CINDERWEAVE);
    expect(castDelayUnderHit('mage', pieces, 2, 'frostbolt')).toBe(0);
    expect(castDelayUnderHit('mage', pieces, 1, 'frostbolt')).toBeGreaterThan(0);
  });

  it('a 2-piece Farsight Marksmanship hunter keeps its Long Draw cast time; one piece is pushed back', () => {
    const farsight = SEASON2_SETS.find((set) => set.setId === 'vanguard_hunter_marksmanship');
    const pieces = farsight?.itemIds ?? [];
    expect(castDelayUnderHit('hunter', pieces, 2, 'aimed_shot', 'marksmanship')).toBe(0);
    expect(castDelayUnderHit('hunter', pieces, 1, 'aimed_shot', 'marksmanship')).toBeGreaterThan(0);
  });
});
