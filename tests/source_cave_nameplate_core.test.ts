// The Source Cave's two-phase nameplate rules (src/render/source_cave_nameplate_core.ts).
// The room shows a tribute plate (name over contribution rung) while the
// contributors are friendly, and a threat plate (level + role-tinted diamond)
// from the reboot onward. These cases pin both phases AND the guardian carve-out,
// since "this one is not in the fight" is a deliberate readability decision, not
// an accident of having no combat role.

import { describe, expect, it } from 'vitest';
import {
  type SourceCaveNameplateInput,
  sourceCaveNameplateRows,
} from '../src/render/source_cave_nameplate_core';

function input(over: Partial<SourceCaveNameplateInput> = {}): SourceCaveNameplateInput {
  return {
    hostile: false,
    dead: false,
    lootable: false,
    combatant: true,
    elite: false,
    boss: false,
    combatTier: null,
    ...over,
  };
}

describe('friendly tribute phase (before the reboot)', () => {
  it('shows the rung title and hides every combat cue', () => {
    expect(
      sourceCaveNameplateRows(input({ elite: true, boss: true, combatTier: 'worldwright' })),
    ).toEqual({
      showTitle: true,
      showLevel: false,
      marker: '',
      markerRole: '',
      frame: '',
    });
  });

  it('hides the combat cues for an elite Architect too, not just for the boss', () => {
    const rows = sourceCaveNameplateRows(input({ elite: true, combatTier: 'architect' }));
    expect(rows.showLevel).toBe(false);
    expect(rows.marker).toBe('');
    expect(rows.frame).toBe('');
    expect(rows.markerRole).toBe('');
  });

  it('still shows a lootable corpse its coin, and drops the title', () => {
    const rows = sourceCaveNameplateRows(input({ dead: true, lootable: true }));
    expect(rows.marker).toBe('$');
    expect(rows.markerRole).toBe('loot');
    expect(rows.showTitle).toBe(false);
  });
});

describe('hostile threat phase (from the reboot onward)', () => {
  it('tints the diamond per combat role and keeps the classic frames', () => {
    const runesmith = sourceCaveNameplateRows(
      input({ hostile: true, elite: true, combatTier: 'runesmith' }),
    );
    const architect = sourceCaveNameplateRows(
      input({ hostile: true, elite: true, combatTier: 'architect' }),
    );
    const boss = sourceCaveNameplateRows(
      input({ hostile: true, elite: true, boss: true, combatTier: 'worldwright' }),
    );

    expect(runesmith.markerRole).toBe('runesmith');
    expect(architect.markerRole).toBe('architect');
    expect(boss.markerRole).toBe('worldwright');
    // Three distinct classes: the whole point is that they stop looking alike.
    expect(new Set([runesmith.markerRole, architect.markerRole, boss.markerRole]).size).toBe(3);
    expect(runesmith.frame).toBe('elite');
    expect(architect.frame).toBe('elite');
    expect(boss.frame).toBe('boss');
    for (const rows of [runesmith, architect, boss]) {
      expect(rows.marker).toBe('◆');
      expect(rows.showLevel).toBe(true);
      expect(rows.showTitle).toBe(false);
    }
  });

  it('gives the non-elite swarm roles a level but no diamond', () => {
    for (const role of ['tinkerer', 'artificer']) {
      const rows = sourceCaveNameplateRows(input({ hostile: true, combatTier: role }));
      expect(rows.showLevel, role).toBe(true);
      expect(rows.marker, role).toBe('');
      expect(rows.markerRole, role).toBe('');
      expect(rows.frame, role).toBe('');
    }
  });

  it('strips the diamond and the frame from a corpse', () => {
    const rows = sourceCaveNameplateRows(
      input({ hostile: true, dead: true, elite: true, boss: true, combatTier: 'worldwright' }),
    );
    expect(rows.marker).toBe('');
    expect(rows.frame).toBe('');
    expect(rows.showLevel).toBe(false);
  });
});

describe('overflow guardians stay visually plain', () => {
  it('draws no diamond and no frame even when the contributor is elite by prestige', () => {
    const rows = sourceCaveNameplateRows(
      input({ hostile: true, combatant: false, elite: true, combatTier: null }),
    );
    expect(rows.marker).toBe('');
    expect(rows.markerRole).toBe('');
    expect(rows.frame).toBe('');
    // They ARE a real threat once pulled, so the level badge stays.
    expect(rows.showLevel).toBe(true);
  });

  it('never takes the boss frame, whatever the roster flags say', () => {
    const rows = sourceCaveNameplateRows(
      input({ hostile: true, combatant: false, elite: true, boss: true }),
    );
    expect(rows.frame).toBe('');
  });

  it('differs from a same-prestige combatant, which is the signal the raid reads', () => {
    const guardian = sourceCaveNameplateRows(
      input({ hostile: true, combatant: false, elite: true, combatTier: null }),
    );
    const combatant = sourceCaveNameplateRows(
      input({ hostile: true, combatant: true, elite: true, combatTier: 'architect' }),
    );
    expect(guardian.marker).not.toBe(combatant.marker);
    expect(guardian.frame).not.toBe(combatant.frame);
  });
});
