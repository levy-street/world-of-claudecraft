// Walking-skeleton contract for The Undermount Descent (docs/prd/furnace-lair-raid.md).
// Test-first: the pure seal-predicate + wing-chain metadata are the net-new sim
// logic and are asserted here directly; the "content" block pins the DUNGEON_DEFS +
// stub-boss records the wings need and stays RED until that content is authored.
//
// The seal rule: a wing's door is sealed until the prior wing's boss has been
// cleared (permanent progress, not the daily lockout); wing 1 is always open.

import { describe, expect, it } from 'vitest';
import {
  arenaOrigin,
  DUNGEONS,
  delveOrigin,
  dungeonAt,
  instanceOrigin,
  MOBS,
  yumiMazeOrigin,
} from '../src/sim/data';
import {
  UNDERMOUNT_WINGS,
  undermountWing,
  undermountWingSealed,
} from '../src/sim/encounters/undermount';

describe('Undermount wing chain metadata (pure)', () => {
  it('has three wings in descent order with unique orders 1..3', () => {
    expect(UNDERMOUNT_WINGS).toHaveLength(3);
    expect(UNDERMOUNT_WINGS.map((w) => w.order)).toEqual([1, 2, 3]);
  });

  it('assigns the pass-6 bosses: the duo, then Odrenn, then Volzharr (no Forge-Heart)', () => {
    expect(UNDERMOUNT_WINGS[0].bossMobIds).toEqual(['vosh_the_glazier', 'saan_the_stoker']);
    expect(UNDERMOUNT_WINGS[1].bossMobIds).toEqual(['odrenn_the_temperer']);
    expect(UNDERMOUNT_WINGS[2].bossMobIds).toEqual(['volzharr_buried_furnace']);
    expect(MOBS.the_forge_heart, 'the cut Forge-Heart wing leaves no mob behind').toBeUndefined();
  });

  it('chains each wing to the previous one (wing 1 requires nothing)', () => {
    expect(UNDERMOUNT_WINGS[0].requires).toBeNull();
    for (let i = 1; i < UNDERMOUNT_WINGS.length; i++) {
      expect(UNDERMOUNT_WINGS[i].requires).toBe(UNDERMOUNT_WINGS[i - 1].dungeonId);
    }
  });

  it('resolves a wing record by dungeonId and ignores non-wings', () => {
    expect(undermountWing('undermount_wing1')?.order).toBe(1);
    expect(undermountWing('hollow_crypt')).toBeUndefined();
  });
});

describe('Undermount dungeon x-band', () => {
  it('recognizes every wing and excludes the later instance bands', () => {
    expect(dungeonAt(instanceOrigin(10, 0).x)?.id).toBe('undermount_wing1');
    expect(dungeonAt(instanceOrigin(11, 0).x)?.id).toBe('undermount_wing2');
    expect(dungeonAt(instanceOrigin(12, 0).x)?.id).toBe('undermount_wing3');
    expect(dungeonAt(instanceOrigin(13, 0).x), 'no fourth wing band').toBeNull();
    expect(dungeonAt(arenaOrigin(0).x)).toBeNull();
    expect(dungeonAt(delveOrigin(0, 0).x)).toBeNull();
    expect(dungeonAt(yumiMazeOrigin(0).x)).toBeNull();
  });
});

describe('undermountWingSealed (pure seal predicate)', () => {
  const none = new Set<string>();

  it('never seals wing 1', () => {
    expect(undermountWingSealed(none, 'undermount_wing1')).toBe(false);
  });

  it('seals a wing until its prerequisite is cleared', () => {
    expect(undermountWingSealed(none, 'undermount_wing2')).toBe(true);
    expect(undermountWingSealed(new Set(['undermount_wing1']), 'undermount_wing2')).toBe(false);
  });

  it('unseals the chain one wing at a time', () => {
    const cleared = new Set<string>();
    expect(undermountWingSealed(cleared, 'undermount_wing2')).toBe(true);
    cleared.add('undermount_wing1');
    expect(undermountWingSealed(cleared, 'undermount_wing2')).toBe(false);
    expect(undermountWingSealed(cleared, 'undermount_wing3')).toBe(true);
    cleared.add('undermount_wing2');
    expect(undermountWingSealed(cleared, 'undermount_wing3')).toBe(false);
  });

  it('never seals a non-Undermount dungeon', () => {
    expect(undermountWingSealed(none, 'hollow_crypt')).toBe(false);
    expect(undermountWingSealed(none, 'gravewyrm_sanctum')).toBe(false);
  });
});

// RED until the wing content lands (task #2, delegated to codex). These pin the
// data contract the skeleton needs: a DUNGEON_DEFS entry per wing, a stub boss
// per wing, and the sealed-door chain object linking each wing to the next.
describe('Undermount wing content (skeleton)', () => {
  it('registers a DUNGEON_DEFS entry per wing with unique indices', () => {
    const indices = new Set<number>();
    for (const wing of UNDERMOUNT_WINGS) {
      const def = DUNGEONS[wing.dungeonId];
      expect(def, wing.dungeonId).toBeDefined();
      expect(def.id).toBe(wing.dungeonId);
      expect(indices.has(def.index), `duplicate index ${def.index}`).toBe(false);
      indices.add(def.index);
    }
  });

  it('defines every wing boss as a boss MobTemplate', () => {
    for (const wing of UNDERMOUNT_WINGS) {
      for (const id of wing.bossMobIds) {
        const boss = MOBS[id];
        expect(boss, id).toBeDefined();
        expect(boss.boss, id).toBe(true);
      }
    }
  });

  it('links each wing to the next via a sealed dungeon-door object', () => {
    for (let i = 0; i < UNDERMOUNT_WINGS.length - 1; i++) {
      const def = DUNGEONS[UNDERMOUNT_WINGS[i].dungeonId];
      const next = UNDERMOUNT_WINGS[i + 1].dungeonId;
      const door = (def.objects ?? []).find(
        (o) => o.templateId === 'dungeon_door' && o.dungeonId === next,
      );
      expect(door, `wing ${i + 1} -> ${next} door`).toBeDefined();
    }
  });
});
