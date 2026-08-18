// The boss test-drive dev entry (src/game/boss_test_drive.ts).
//
// Two things are worth pinning about a cheat path. The parser must never guess: a
// mistyped variant has to start an ordinary game rather than quietly test-drive the
// wrong body, because the whole point of the param is comparing two models and a silent
// substitution makes the comparison a lie. And the gear pick must be derived from live
// itemization rather than a hand-listed set, since a stale item id fails to equip and
// leaves a bare slot nobody notices.
import { describe, expect, it } from 'vitest';
import {
  applyBossTestDrive,
  BOSS_TEST_DRIVE_POS,
  bestInSlot,
  parseBossTestDrive,
} from '../src/game/boss_test_drive';
import { MOBS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';

describe('parseBossTestDrive', () => {
  it('answers null for an ordinary session', () => {
    expect(parseBossTestDrive('')).toBeNull();
    expect(parseBossTestDrive('?gfx=low')).toBeNull();
  });

  it('picks each body by name, case and padding insensitive', () => {
    expect(parseBossTestDrive('?boss=foreman')?.templateId).toBe('balgath_foreman');
    expect(parseBossTestDrive('?boss=cyclops')?.templateId).toBe('balgath_cyclops');
    expect(parseBossTestDrive('?boss=CYCLOPS')?.templateId).toBe('balgath_cyclops');
    expect(parseBossTestDrive('?boss=%20Foreman%20')?.templateId).toBe('balgath_foreman');
  });

  it('defaults a bare ?boss to the recommended body', () => {
    for (const search of ['?boss', '?boss=', '?boss=1', '?boss=true']) {
      expect(parseBossTestDrive(search)?.variant, search).toBe('foreman');
    }
  });

  it('refuses to guess at a typo', () => {
    // The failure mode this prevents: `?boss=cylcops` silently handing you the foreman
    // and a verdict reached about the wrong model.
    expect(parseBossTestDrive('?boss=cylcops')).toBeNull();
    expect(parseBossTestDrive('?boss=balgath')).toBeNull();
  });

  it('names templates that actually exist', () => {
    for (const search of ['?boss=foreman', '?boss=cyclops']) {
      const plan = parseBossTestDrive(search);
      expect(plan).not.toBeNull();
      expect(MOBS[plan?.templateId ?? ''], plan?.templateId).toBeDefined();
    }
  });
});

describe('bestInSlot', () => {
  it('fills every slot with gear the class can actually wear', () => {
    const picked = bestInSlot('warrior');
    expect(picked.length).toBeGreaterThan(5);
    for (const item of picked) expect(canEquipItem('warrior', item)).toBe(true);
    // One item per slot, never two competing for the same one.
    const slots = picked.map((i) => (i as { slot?: string }).slot);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('is deterministic, so two runs compare the same character', () => {
    expect(bestInSlot('warrior').map((i) => i.id)).toEqual(bestInSlot('warrior').map((i) => i.id));
  });

  it('differs by class, which is what makes it a real pick', () => {
    const warrior = bestInSlot('warrior').map((i) => i.id);
    const mage = bestInSlot('mage').map((i) => i.id);
    expect(warrior).not.toEqual(mage);
  });
});

describe('applyBossTestDrive', () => {
  function fakeSim() {
    const calls = {
      level: [] as number[],
      gm: [] as boolean[],
      added: [] as string[],
      equipped: [] as string[],
      spawned: [] as Array<[string, number, number]>,
    };
    const sim: {
      playerId: number;
      player: {
        pos: { x: number; y: number; z: number };
        prevPos: { x: number; y: number; z: number };
        facing: number;
      };
      setPlayerLevel: (level: number, pid?: number) => void;
      setGm: (pid?: number, enabled?: boolean) => void;
      addItem: (id: string, count: number, pid?: number) => unknown;
      equipItem: (id: string, pid?: number) => unknown;
      spawnDevBoss: (t: string, x: number, z: number) => number;
      groundPos: (x: number, z: number) => { x: number; y: number; z: number };
    } = {
      playerId: 7,
      player: { pos: { x: 0, y: 0, z: 0 }, prevPos: { x: 0, y: 0, z: 0 }, facing: 0 },
      setPlayerLevel: (level: number) => {
        calls.level.push(level);
      },
      setGm: (_pid?: number, enabled = true) => {
        calls.gm.push(enabled);
      },
      addItem: (id: string) => calls.added.push(id),
      equipItem: (id: string) => calls.equipped.push(id),
      spawnDevBoss: (t: string, x: number, z: number) => {
        calls.spawned.push([t, x, z]);
        return 99;
      },
      groundPos: (x: number, z: number) => ({ x, y: 5, z }),
    };
    return { sim, calls };
  }

  it('levels BEFORE equipping, or the gear silently refuses to go on', () => {
    // Equip checks the character's level against the item's requirement, so a level-1
    // warrior ends up standing next to the boss in nothing at all.
    const { sim, calls } = fakeSim();
    const order: string[] = [];
    sim.setPlayerLevel = () => {
      order.push('level');
    };
    sim.equipItem = (id: string) => {
      order.push('equip');
      calls.equipped.push(id);
    };
    applyBossTestDrive(sim, { templateId: 'balgath_foreman', variant: 'foreman' }, 'warrior');
    expect(order[0]).toBe('level');
    expect(order).toContain('equip');
  });

  it('gods the player and spawns the requested body at the barrow', () => {
    const { sim, calls } = fakeSim();
    const id = applyBossTestDrive(
      sim,
      { templateId: 'balgath_cyclops', variant: 'cyclops' },
      'warrior',
    );
    expect(id).toBe(99);
    expect(calls.gm).toEqual([true]);
    expect(calls.level).toEqual([20]);
    expect(calls.spawned).toEqual([
      ['balgath_cyclops', BOSS_TEST_DRIVE_POS.x, BOSS_TEST_DRIVE_POS.z],
    ]);
    expect(calls.equipped.length).toBeGreaterThan(5);
  });

  it('stands the player off the spawn point and faces them at it', () => {
    // Standing ON him spawns the camera inside his mesh; facing away opens on the back
    // of your own head. Both make the first frame useless for judging a silhouette.
    const { sim } = fakeSim();
    applyBossTestDrive(sim, { templateId: 'balgath_foreman', variant: 'foreman' }, 'warrior');
    const dx = sim.player.pos.x - BOSS_TEST_DRIVE_POS.x;
    const dz = sim.player.pos.z - BOSS_TEST_DRIVE_POS.z;
    expect(Math.hypot(dx, dz)).toBeGreaterThan(8);
    expect(sim.player.pos.y).toBe(5);
    expect(sim.player.prevPos).toEqual(sim.player.pos);
    expect(sim.player.facing).toBeCloseTo(Math.atan2(-dx, -dz), 6);
  });
});
