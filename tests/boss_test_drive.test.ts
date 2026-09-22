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
import { WORLD_BOSSES } from '../src/sim/world_boss';

describe('parseBossTestDrive', () => {
  it('answers null for an ordinary session', () => {
    expect(parseBossTestDrive('')).toBeNull();
    expect(parseBossTestDrive('?gfx=low')).toBeNull();
  });

  it('accepts every spelling that means "the boss", case and padding insensitive', () => {
    for (const search of [
      '?boss',
      '?boss=',
      '?boss=1',
      '?boss=true',
      '?boss=balgath',
      '?boss=CYCLOPS',
      '?boss=%20cyclops%20',
    ]) {
      expect(parseBossTestDrive(search)?.templateId, search).toBe('balgath_cyclops');
    }
  });

  it('refuses to guess at anything else', () => {
    // Answering null starts an ordinary game. Guessing would put you somewhere you did
    // not ask to be, which is worse than doing nothing.
    expect(parseBossTestDrive('?boss=cylcops')).toBeNull();
    expect(parseBossTestDrive('?boss=thunzharr')).toBeNull();
    expect(parseBossTestDrive('?boss=0')).toBeNull();
  });

  it('names a template that actually exists', () => {
    const plan = parseBossTestDrive('?boss');
    expect(plan).not.toBeNull();
    expect(MOBS[plan?.templateId ?? ''], plan?.templateId).toBeDefined();
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
    applyBossTestDrive(sim, { templateId: 'balgath_cyclops' }, 'warrior');
    expect(order[0]).toBe('level');
    expect(order).toContain('equip');
  });

  it('gods the player and spawns the requested body at the barrow', () => {
    const { sim, calls } = fakeSim();
    const id = applyBossTestDrive(sim, { templateId: 'balgath_cyclops' }, 'warrior');
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
    applyBossTestDrive(sim, { templateId: 'balgath_cyclops' }, 'warrior');
    const dx = sim.player.pos.x - BOSS_TEST_DRIVE_POS.x;
    const dz = sim.player.pos.z - BOSS_TEST_DRIVE_POS.z;
    expect(Math.hypot(dx, dz)).toBeGreaterThan(8);
    expect(sim.player.pos.y).toBe(5);
    expect(sim.player.prevPos).toEqual(sim.player.pos);
    expect(sim.player.facing).toBeCloseTo(Math.atan2(-dx, -dz), 6);
  });
});

describe('the test drive stands where the live world puts him', () => {
  it('welds BOSS_TEST_DRIVE_POS to the scheduler spawn point', () => {
    // The literal is kept out of the client bundle on purpose (the dev module must not
    // pull the world-boss registry in), so this is the weld: a test drive that spawns him
    // somewhere the live scheduler never would is a test drive of a different encounter.
    const row = WORLD_BOSSES.find((b) => b.templateId === 'balgath_cyclops');
    expect(row).toBeDefined();
    expect(BOSS_TEST_DRIVE_POS).toEqual(row?.pos);
  });
});
