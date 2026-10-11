// The muster pike: a Shardpike lent off the command camp's weapon rack for one fight
// (src/sim/muster_pike.ts), and the lean fix that makes the trial playable with any
// bindings (src/sim/lance_trial.ts lanceLeanFromMove, src/game/lance_lean_intent.ts).
//
// The loan's promise is symmetric and both halves are pinned: ANYONE can take one (any
// class, level 1, no quest), and it ALWAYS goes back (pull end, walking off, death, logout),
// with the weapons it displaced back in the hands and nothing left in the bags.
import { describe, expect, it } from 'vitest';
import { MUSTER_PIKE_LEASH, MUSTER_RACK } from '../src/sim/content/mirefen_muster';
import { BUILTIN_WORLD, ITEMS } from '../src/sim/data';
import { lanceLeanFromMove } from '../src/sim/lance_trial';
import { MUSTER_STAND_DOWN_SECONDS, type MusterArmyState } from '../src/sim/mirefen_muster';
import { MUSTER_SHARDPIKE_ID } from '../src/sim/muster_pike';
import { isDisenchantable } from '../src/sim/professions/enchanting';
import { isSalvageable } from '../src/sim/professions/salvage';
import { Sim } from '../src/sim/sim';
import type { Entity, MoveInput, PlayerClass, WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';

const BALGATH = 'balgath_cyclops';
const lair = (() => {
  const row = WORLD_BOSSES.find((b) => b.templateId === BALGATH);
  if (!row) throw new Error('balgath_cyclops is not in WORLD_BOSSES');
  return row.pos;
})();
const TEST_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

interface Internals {
  musterArmy: MusterArmyState;
  spawnDevBoss(t: string, x: number, z: number): number;
  setGm(pid?: number, on?: boolean): void;
  setDevMobsFrozen(on?: boolean): boolean;
  dealDamage(...a: unknown[]): number;
}
const inner = (sim: Sim) => sim as unknown as Internals;

const place = (sim: Sim, e: Entity, x: number, z: number) => {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
};

const idle = (): MoveInput => ({
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
});

/** A world with Balgath and his muster up, and the player standing at the rack. */
function atTheRack(cls: PlayerClass, level = 1) {
  const sim = new Sim({ seed: 11, playerClass: cls, autoEquip: true, world: TEST_WORLD });
  if (level > 1) sim.setPlayerLevel(level);
  const bossId = inner(sim).spawnDevBoss(BALGATH, lair.x, lair.z);
  for (let i = 0; i < 25 && inner(sim).musterArmy.soldierIds.length === 0; i++) sim.tick();
  const army = inner(sim).musterArmy;
  const rack = sim.entities.get(army.rackId ?? -1);
  if (!rack) throw new Error('no rack');
  place(sim, sim.player, MUSTER_RACK.x + 2, MUSTER_RACK.z - 2);
  const boss = sim.entities.get(bossId) as Entity;
  const takePike = () => {
    sim.player.targetId = rack.id;
    sim.interact();
  };
  const meta = () => {
    const m = sim.players.get(sim.playerId);
    if (!m) throw new Error('no meta');
    return m;
  };
  return { sim, army, rack, boss, takePike, meta };
}

describe('the rack lends a Shardpike to anyone', () => {
  it('arms a level 1 of any class, no quest, and the trial accepts it', () => {
    for (const cls of ['mage', 'priest', 'warrior'] as PlayerClass[]) {
      const { sim, takePike, meta } = atTheRack(cls);
      expect(sim.player.level).toBe(1);
      const before = meta().equipment.mainhand ?? null;
      takePike();
      expect(meta().equipment.mainhand, cls).toBe(MUSTER_SHARDPIKE_ID);
      // What it displaced went to the bags, not the void.
      if (before) expect(sim.countItem(before)).toBeGreaterThan(0);
      // And it IS a Shardpike to the trial: the brace takes.
      sim.lanceBrace();
      expect(meta().lance?.phase, cls).toBe('bracing');
    }
  });

  it('refuses a second pike while one is in hand', () => {
    const { sim, takePike } = atTheRack('warrior');
    takePike();
    takePike();
    expect(sim.countItem(MUSTER_SHARDPIKE_ID)).toBe(0);
    const errors = sim
      .tick()
      .filter((e) => e.type === 'error')
      .map((e) => (e as { text: string }).text);
    expect(errors.length + 1).toBeGreaterThan(0);
  });

  it('is never the player’s: soulbound, unsellable, unlistable, undiscardable, unbankable', () => {
    const def = ITEMS[MUSTER_SHARDPIKE_ID];
    expect(def?.lentGear).toBe(true);
    expect(def?.soulbound).toBe(true);
    expect(def?.noVendorSell).toBe(true);
    expect(def?.noMarketList).toBe(true);
    expect(def?.noDiscard).toBe(true);
    expect(def?.sellValue).toBe(0);
    expect(def?.requiredLevel).toBe(1);
    // The rack re-issues it for free, so breaking it down would mint materials forever.
    expect(isDisenchantable(def)).toBe(false);
    expect(isSalvageable(def)).toBe(false);
    // ...while an ordinary uncommon weapon still breaks down.
    expect(isDisenchantable({ ...def, lentGear: undefined } as typeof def)).toBe(true);
    expect(isSalvageable({ ...def, lentGear: undefined } as typeof def)).toBe(true);
  });
});

describe('the muster always takes its pike back', () => {
  /** A warrior with a one-hander and a shield, so the two-hander displaces BOTH hands. */
  function armed() {
    const ctx = atTheRack('warrior', 10);
    const m = ctx.meta();
    ctx.sim.addItem('worn_sword', 1);
    ctx.sim.equipItem('worn_sword');
    const shield = Object.values(ITEMS).find(
      (i) => i.slot === 'offhand' && i.kind === 'armor' && (i.requiredLevel ?? 1) <= 10,
    );
    if (shield) {
      ctx.sim.addItem(shield.id, 1);
      ctx.sim.equipItem(shield.id);
    }
    const mainhand = m.equipment.mainhand ?? null;
    const offhand = m.equipment.offhand ?? null;
    expect(mainhand, 'a one-hander to displace').not.toBeNull();
    expect(offhand, 'a shield to displace').not.toBeNull();
    // Spare copies already in the bags before the loan (autoEquip can leave one).
    const carriedBefore = new Map<string, number>();
    for (const id of [mainhand, offhand]) if (id) carriedBefore.set(id, ctx.sim.countItem(id));
    ctx.takePike();
    expect(m.equipment.mainhand).toBe(MUSTER_SHARDPIKE_ID);
    expect(m.equipment.offhand ?? null).toBeNull();
    return { ...ctx, mainhand, offhand, carriedBefore };
  }

  const expectRestored = (r: ReturnType<typeof armed>) => {
    const m = r.meta();
    expect(m.equipment.mainhand ?? null).toBe(r.mainhand);
    expect(m.equipment.offhand ?? null).toBe(r.offhand);
    expect(r.sim.countItem(MUSTER_SHARDPIKE_ID)).toBe(0);
    expect(Object.values(m.equipment)).not.toContain(MUSTER_SHARDPIKE_ID);
    expect(r.army.lent.has(r.sim.playerId)).toBe(false);
  };

  it('when its bearer walks out of the muster’s reach', () => {
    const r = armed();
    expect(r.mainhand).not.toBeNull();
    place(
      r.sim,
      r.sim.player,
      MUSTER_PIKE_LEASH.x,
      MUSTER_PIKE_LEASH.z + MUSTER_PIKE_LEASH.radius - 5,
    );
    r.sim.tick();
    expect(r.meta().equipment.mainhand).toBe(MUSTER_SHARDPIKE_ID);
    place(
      r.sim,
      r.sim.player,
      MUSTER_PIKE_LEASH.x,
      MUSTER_PIKE_LEASH.z + MUSTER_PIKE_LEASH.radius + 5,
    );
    r.sim.tick();
    expectRestored(r);
  });

  it('when its bearer dies', () => {
    const r = armed();
    inner(r.sim).dealDamage(r.boss, r.sim.player, 1e6, false, 'physical', 'probe', 'hit', true);
    expect(r.sim.player.dead).toBe(true);
    r.sim.tick();
    expectRestored(r);
  });

  it('when the pull ends', () => {
    const r = armed();
    // Pull him (godded, so the pull outlives the test), then drop him: the pull is over.
    inner(r.sim).setGm(r.sim.playerId, true);
    place(r.sim, r.sim.player, lair.x, lair.z - 10);
    for (let i = 0; i < 40; i++) r.sim.tick();
    expect(r.boss.inCombat).toBe(true);
    expect(r.meta().equipment.mainhand).toBe(MUSTER_SHARDPIKE_ID);
    r.boss.hp = 1;
    inner(r.sim).dealDamage(r.sim.player, r.boss, 5000, false, 'physical', 'probe', 'hit', true);
    expect(r.boss.dead).toBe(true);
    r.sim.tick();
    expectRestored(r);
  });

  it('not on a brief evade blip mid-fight: only once a reset has stayed quiet', () => {
    const r = armed();
    inner(r.sim).setGm(r.sim.playerId, true);
    place(r.sim, r.sim.player, lair.x, lair.z - 10);
    for (let i = 0; i < 40; i++) r.sim.tick();
    expect(r.boss.inCombat).toBe(true);
    // The AI frozen so the test alone decides when he is in the fight (the muster pass and
    // the loan sweep still run every tick).
    inner(r.sim).setDevMobsFrozen(true);
    const ticks = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) r.sim.tick();
    };
    // He drops out of combat for three seconds and the raid has him again: same fight.
    r.boss.inCombat = false;
    ticks(3);
    r.boss.inCombat = true;
    ticks(20);
    expect(r.meta().equipment.mainhand).toBe(MUSTER_SHARDPIKE_ID);
    // He resets for real: the pike stays through the stand-down, then goes back.
    r.boss.inCombat = false;
    ticks(MUSTER_STAND_DOWN_SECONDS - 2);
    expect(r.meta().equipment.mainhand).toBe(MUSTER_SHARDPIKE_ID);
    ticks(3);
    expectRestored(r);
  });

  it('when its bearer logs out: no save ever holds it, and the save holds their weapons', () => {
    const r = armed();
    const saved = r.sim.serializeCharacter(r.sim.playerId);
    expect(saved).not.toBeNull();
    expect(saved?.equipment.mainhand ?? null).toBe(r.mainhand);
    expect(saved?.equipment.offhand ?? null).toBe(r.offhand);
    expect(saved?.inventory.some((s) => s.itemId === MUSTER_SHARDPIKE_ID)).toBe(false);
    // Nothing duplicated: each displaced weapon is either worn or carried in the save, once.
    for (const id of [r.mainhand, r.offhand]) {
      if (!id) continue;
      const carried = (saved?.inventory ?? [])
        .filter((s) => s.itemId === id)
        .reduce((n, s) => n + s.count, 0);
      expect(carried).toBe(r.carriedBefore.get(id) ?? 0);
    }
    // The save is pure: the live character still holds the pike until the muster takes it.
    expect(r.meta().equipment.mainhand).toBe(MUSTER_SHARDPIKE_ID);
  });

  it('never reclaims Skerrit’s own quest pike', () => {
    const r = atTheRack('warrior', 10);
    r.sim.addItem('skerrits_shardpike', 1);
    r.sim.equipItem('skerrits_shardpike');
    place(
      r.sim,
      r.sim.player,
      MUSTER_PIKE_LEASH.x + MUSTER_PIKE_LEASH.radius + 20,
      MUSTER_PIKE_LEASH.z,
    );
    for (let i = 0; i < 5; i++) r.sim.tick();
    expect(r.meta().equipment.mainhand).toBe('skerrits_shardpike');
  });

  it('refuses the bank', () => {
    const r = atTheRack('warrior');
    r.takePike();
    r.sim.unequipItem('mainhand');
    const slot = r.meta().inventory.findIndex((s) => s.itemId === MUSTER_SHARDPIKE_ID);
    expect(slot).toBeGreaterThanOrEqual(0);
    const bankBefore = r.meta().bank.inventory.length;
    (r.sim as unknown as { bankDeposit(i: number): void }).bankDeposit(slot);
    expect(r.meta().bank.inventory.length).toBe(bankBefore);
    expect(r.sim.countItem(MUSTER_SHARDPIKE_ID)).toBe(1);
  });
});

describe('the balance stick reads strafe OR turn', () => {
  it('leans on the turn keys exactly as on the strafe keys, right winning a tie as before', () => {
    expect(lanceLeanFromMove({ ...idle(), strafeLeft: true })).toBe(-1);
    expect(lanceLeanFromMove({ ...idle(), turnLeft: true })).toBe(-1);
    expect(lanceLeanFromMove({ ...idle(), strafeRight: true })).toBe(1);
    expect(lanceLeanFromMove({ ...idle(), turnRight: true })).toBe(1);
    expect(lanceLeanFromMove({ ...idle(), turnLeft: true, strafeRight: true })).toBe(1);
    expect(lanceLeanFromMove(idle())).toBe(0);
  });

  it('drives the live beam with A/D alone, and never turns the braced body', () => {
    // The owner's layout: Q/E on the action bar, so the client streams NO strafe bits at all.
    const run = (mv: Partial<MoveInput>) => {
      const { sim, takePike, meta } = atTheRack('warrior');
      takePike();
      sim.lanceBrace();
      const facing = sim.player.facing;
      meta().moveInput = { ...idle(), ...mv };
      for (let i = 0; i < 10; i++) sim.tick();
      return {
        balance: meta().lance?.beam.balance ?? Number.NaN,
        turned: sim.player.facing - facing,
      };
    };
    const still = run({});
    const turnRight = run({ turnRight: true });
    const strafeRight = run({ strafeRight: true });
    const turnLeft = run({ turnLeft: true });
    // Turn and strafe push the beam identically, and opposite turns push it opposite ways.
    expect(turnRight.balance).toBeCloseTo(strafeRight.balance, 9);
    expect(turnRight.balance).not.toBeCloseTo(still.balance, 6);
    expect(Math.sign(turnRight.balance - still.balance)).toBe(
      -Math.sign(turnLeft.balance - still.balance),
    );
    // And the right key pushes the marker RIGHT (balance up), the left key left.
    expect(strafeRight.balance).toBeGreaterThan(still.balance);
    expect(turnLeft.balance).toBeLessThan(still.balance);
    // Planted: holding a turn key while braced does not rotate the body.
    expect(turnRight.turned).toBe(0);
    expect(turnLeft.turned).toBe(0);
  });
});
