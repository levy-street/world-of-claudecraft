import { describe, expect, it } from 'vitest';
import { targetOfTargetEntityId, targetOfTargetView } from '../src/ui/target_of_target_view';

describe('targetOfTargetEntityId', () => {
  it('uses the authoritative aggro victim for mobs, pets, and combat NPCs', () => {
    expect(targetOfTargetEntityId({ kind: 'mob', targetId: null, aggroTargetId: 42 })).toBe(42);
    expect(targetOfTargetEntityId({ kind: 'npc', targetId: null, aggroTargetId: 7 })).toBe(7);
  });

  it('uses another player selected target when that state is available', () => {
    expect(targetOfTargetEntityId({ kind: 'player', targetId: 19, aggroTargetId: 3 })).toBe(19);
  });

  it('hides the chip for no target, world objects, and units with no target', () => {
    expect(targetOfTargetEntityId(null)).toBeNull();
    expect(targetOfTargetEntityId({ kind: 'object', targetId: 2, aggroTargetId: 2 })).toBeNull();
    expect(targetOfTargetEntityId({ kind: 'mob', targetId: null, aggroTargetId: null })).toBeNull();
  });
});

describe('targetOfTargetView', () => {
  const text = {
    name: 'Forest Wolf',
    accessibleLabel: "Mark's Mark: Forest Wolf",
    portraitKey: '7:base',
  };

  it('builds the compact hostile unit-frame view with clamped health', () => {
    const view = targetOfTargetView(
      {
        id: 7,
        kind: 'mob',
        templateId: 'forest_wolf',
        hostile: true,
        dead: false,
        hp: 33,
        maxHp: 100,
      },
      1,
      text,
    );

    expect(view.entityId).toBe(7);
    expect(view.accent).toBe('hostile');
    expect(view.classId).toBe('forest_wolf');
    expect(view.accessibleLabel).toBe("Mark's Mark: Forest Wolf");
    expect(view.frame.name).toBe('Forest Wolf');
    expect(view.frame.hpFrac).toBe(0.33);
    expect(view.frame.hpState).toBe('wounded');
    expect(view.frame.portraitKey).toBe('7:base');
  });

  it('marks the player as self and treats zero health as dead', () => {
    const view = targetOfTargetView(
      {
        id: 1,
        kind: 'player',
        templateId: 'warrior',
        hostile: false,
        dead: false,
        hp: 0,
        maxHp: 100,
      },
      1,
      { ...text, name: 'Thorgar', portraitKey: '1:base' },
    );

    expect(view.isSelf).toBe(true);
    expect(view.accent).toBe('self');
    expect(view.frame.dead).toBe(true);
    expect(view.frame.hpState).toBe('dead');
  });

  it('reuses one absent view for missing subjects', () => {
    expect(targetOfTargetView(null, 1, null)).toBe(targetOfTargetView(null, 2, null));
    expect(targetOfTargetView(null, 1, null).frame.present).toBe(false);
  });
});
