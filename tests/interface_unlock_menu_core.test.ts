// The interface editor's Frames Settings tables, driven for real rather than
// through a fake (review finding on PR #3284): both orientation arms of the
// toggle table, the persist-and-apply pair every row writes through, the
// select ranges, the per-frame reset-key table, and the sample party roster.
import { describe, expect, it } from 'vitest';
import type { GameSettings } from '../src/game/settings';
import { SETTING_RANGES } from '../src/game/settings';
import {
  buildFramesMenuSelects,
  buildFramesMenuToggles,
  buildPartySampleMembers,
  FRAME_SIZE_RESET_KEYS,
  type FramesMenuSettingsHooks,
  PARTY_SAMPLE_TOTAL,
} from '../src/ui/interface_unlock_menu_core';
import type { PartyFrameMember } from '../src/ui/party_frames';

const PARTY_RANGES = {
  partyFrameColumns: SETTING_RANGES.partyFrameColumns,
  partyFrameSpacing: SETTING_RANGES.partyFrameSpacing,
};

const makeHooks = (initial: Partial<GameSettings> = {}) => {
  const values: Record<string, number | boolean> = { ...initial };
  const applied: [string, number | boolean][] = [];
  const hooks: FramesMenuSettingsHooks = {
    settings: {
      get: (key) => values[key],
      set: (key, value) => {
        values[key] = value;
        return value;
      },
    },
    onSettingChange: (key, value) => {
      applied.push([key, value]);
    },
  };
  return { hooks, values, applied };
};

describe('buildFramesMenuToggles', () => {
  it('lists the eight behavior rows then three per-bar toggles while split', () => {
    const { hooks } = makeHooks();
    const ids = buildFramesMenuToggles(hooks, false).map((row) => row.id);
    expect(ids).toEqual([
      'combineActionBars',
      'hideUnusedActionSlots',
      'mouseoverCast',
      'lockActionBars',
      'buffsLeftToRight',
      'debuffsLeftToRight',
      'lockPlayerFrameToActionBar',
      'menuRailHorizontal',
      'frameSnapToGrid',
      'actionBar1Vertical',
      'actionBar2Vertical',
      'actionBar3Vertical',
    ]);
  });

  it('collapses the three bar toggles into one combined row while merged', () => {
    const { hooks } = makeHooks({ actionBar1Vertical: true });
    const rows = buildFramesMenuToggles(hooks, true);
    const ids = rows.map((row) => row.id);
    expect(ids).toContain('actionBarsVertical');
    expect(ids).not.toContain('actionBar1Vertical');
    expect(ids).not.toContain('actionBar2Vertical');
    // The combined row reads bar 1's setting as the group's value.
    expect(rows.find((row) => row.id === 'actionBarsVertical')?.value).toBe(true);
  });

  it('a split per-bar set writes only its own key, persist then apply', () => {
    const { hooks, values, applied } = makeHooks();
    const rows = buildFramesMenuToggles(hooks, false);
    rows.find((row) => row.id === 'actionBar2Vertical')?.set(true);
    expect(values.actionBar2Vertical).toBe(true);
    expect(values.actionBar1Vertical).toBeUndefined();
    expect(applied).toEqual([['actionBar2Vertical', true]]);
  });

  it('the combined set writes all three orientation keys', () => {
    const { hooks, values, applied } = makeHooks();
    const rows = buildFramesMenuToggles(hooks, true);
    rows.find((row) => row.id === 'actionBarsVertical')?.set(true);
    expect(values.actionBar1Vertical).toBe(true);
    expect(values.actionBar2Vertical).toBe(true);
    expect(values.actionBar3Vertical).toBe(true);
    expect(applied.map(([key]) => key)).toEqual([
      'actionBar1Vertical',
      'actionBar2Vertical',
      'actionBar3Vertical',
    ]);
  });

  it('a behavior row round-trips its current value and writes through both hooks', () => {
    const { hooks, values, applied } = makeHooks({ menuRailHorizontal: true });
    const rows = buildFramesMenuToggles(hooks, false);
    const rail = rows.find((row) => row.id === 'menuRailHorizontal');
    expect(rail?.value).toBe(true);
    rail?.set(false);
    expect(values.menuRailHorizontal).toBe(false);
    expect(applied).toEqual([['menuRailHorizontal', false]]);
  });

  it('returns no rows without hooks (edit mode before options attach)', () => {
    expect(buildFramesMenuToggles(null, false)).toEqual([]);
    expect(buildFramesMenuToggles(null, true)).toEqual([]);
  });
});

describe('buildFramesMenuSelects', () => {
  it('offers the two party layout knobs over their whole settings range', () => {
    const { hooks } = makeHooks({ partyFrameColumns: 2 });
    const selects = buildFramesMenuSelects(hooks, PARTY_RANGES);
    expect(selects.map((sel) => sel.id)).toEqual(['partyFrameColumns', 'partyFrameSpacing']);
    const columns = selects[0];
    const range = SETTING_RANGES.partyFrameColumns;
    expect(columns.options).toHaveLength(range.max - range.min + 1);
    expect(columns.options[0]?.value).toBe(range.min);
    expect(columns.options.at(-1)?.value).toBe(range.max);
    expect(columns.value).toBe(2);
  });

  it('a select set persists then applies like the toggle rows', () => {
    const { hooks, values, applied } = makeHooks();
    buildFramesMenuSelects(hooks, PARTY_RANGES)[1].set(6);
    expect(values.partyFrameSpacing).toBe(6);
    expect(applied).toEqual([['partyFrameSpacing', 6]]);
  });

  it('returns no rows without hooks', () => {
    expect(buildFramesMenuSelects(null, PARTY_RANGES)).toEqual([]);
  });
});

describe('FRAME_SIZE_RESET_KEYS', () => {
  it('maps exactly the three settings-sized frames to scale plus dimensions', () => {
    expect(Object.keys(FRAME_SIZE_RESET_KEYS)).toEqual([
      'playerFrame',
      'targetFrame',
      'partyFrames',
    ]);
    expect(FRAME_SIZE_RESET_KEYS.playerFrame).toEqual([
      'playerFrameScale',
      'playerFrameWidth',
      'playerFrameHeight',
    ]);
    expect(FRAME_SIZE_RESET_KEYS.targetFrame).toEqual([
      'targetFrameScale',
      'targetFrameWidth',
      'targetFrameHeight',
    ]);
    expect(FRAME_SIZE_RESET_KEYS.partyFrames).toEqual([
      'partyFrameScale',
      'partyFrameWidth',
      'partyFrameHeight',
    ]);
  });
});

describe('buildPartySampleMembers', () => {
  const realMember = (pid: number, name: string): PartyFrameMember =>
    ({
      pid,
      name,
      cls: 'mage',
      level: 18,
      hp: 80,
      mhp: 100,
      res: 60,
      mres: 100,
      rtype: 'mana',
      x: 1,
      z: 2,
      dead: 0,
      inCombat: 0,
      group: 1,
      connected: 1,
      oor: false,
    }) as PartyFrameMember;

  it('is the owner-requested 10-member preview roster', () => {
    // Every other assertion here compares against the constant, so pin the
    // literal once or a drifted roster size keeps the whole suite green.
    expect(PARTY_SAMPLE_TOTAL).toBe(10);
  });

  it('pads an empty party to the full sample roster with negative pids', () => {
    const members = buildPartySampleMembers([]);
    expect(members).toHaveLength(PARTY_SAMPLE_TOTAL);
    expect(members.every((m) => m.pid < 0)).toBe(true);
    // Distinct pids: recycled row keys must never collide.
    expect(new Set(members.map((m) => m.pid)).size).toBe(PARTY_SAMPLE_TOTAL);
  });

  it('keeps real members first and only pads the remainder', () => {
    const real = [realMember(41, 'Aurelia'), realMember(42, 'Brann')];
    const members = buildPartySampleMembers(real);
    expect(members).toHaveLength(PARTY_SAMPLE_TOTAL);
    expect(members[0]?.pid).toBe(41);
    expect(members[1]?.pid).toBe(42);
    expect(members.slice(2).every((m) => m.pid < 0)).toBe(true);
  });

  it('a full party gains no dummies', () => {
    const real = Array.from({ length: PARTY_SAMPLE_TOTAL }, (_, i) =>
      realMember(100 + i, `Member${i}`),
    );
    expect(buildPartySampleMembers(real)).toHaveLength(PARTY_SAMPLE_TOTAL);
    expect(buildPartySampleMembers(real).every((m) => m.pid >= 100)).toBe(true);
  });

  it('warrior dummies start empty on rage while casters sit full', () => {
    const members = buildPartySampleMembers([]);
    const warrior = members.find((m) => m.cls === 'warrior');
    const mage = members.find((m) => m.cls === 'mage');
    expect(warrior?.rtype).toBe('rage');
    expect(warrior?.res).toBe(0);
    expect(mage?.rtype).toBe('mana');
    expect(mage?.res).toBe(100);
  });
});
