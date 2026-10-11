import { describe, expect, it } from 'vitest';
import { AURA_CUE_NONE, AURA_CUES } from '../src/game/aura_cue_catalog';
import {
  assignCooldownSpell,
  COOLDOWN_GRID_MAX_SIDE,
  COOLDOWN_GROUP_NAME_MAX,
  COOLDOWN_LINE_MAX,
  COOLDOWN_MAX_GROUPS,
  type CooldownGroup,
  cooldownCell,
  cooldownGroupCapacity,
  cooldownGroupOf,
  cooldownGroupShown,
  cooldownSpellMatches,
  minGridLines,
  moveCooldownSpell,
  newCooldownGroup,
  patchCooldownGroup,
  sanitizeCooldownGroup,
  sanitizeCooldownGroupName,
  sanitizeCooldownGroups,
  sanitizeCooldownManagerLayout,
  sanitizeCooldownSpellConfig,
} from '../src/ui/hud/cooldown_manager/cooldown_manager_config';
import { CooldownManagerStore } from '../src/ui/hud/cooldown_manager/cooldown_manager_store';

const group = (kind: CooldownGroup['kind'], spells: string[], extra: Partial<CooldownGroup> = {}) =>
  ({ ...newCooldownGroup(kind, []), spells, ...extra }) as CooldownGroup;

describe('cooldown manager groups: capacity and layout cells', () => {
  it('holds one spell in a single button, a fixed line, and perLine x lines in a grid', () => {
    expect(cooldownGroupCapacity(group('single', []))).toBe(1);
    expect(cooldownGroupCapacity(group('line', []))).toBe(12);
    expect(COOLDOWN_LINE_MAX).toBe(12);
    expect(cooldownGroupCapacity(group('grid', [], { perLine: 4, lines: 2 }))).toBe(8);
  });

  it('lays a horizontal grid out row by row, wrapping every perLine', () => {
    const grid = group('grid', [], { perLine: 3 });
    expect([0, 1, 2, 3, 4].map((i) => cooldownCell(grid, i, 5))).toEqual([
      { column: 1, row: 1 },
      { column: 2, row: 1 },
      { column: 3, row: 1 },
      { column: 1, row: 2 },
      { column: 2, row: 2 },
    ]);
  });

  it('lays a vertical grid out column by column, and reverse fills from the far end', () => {
    const down = group('grid', [], { perLine: 2, orientation: 'vertical' });
    expect([0, 1, 2].map((i) => cooldownCell(down, i, 3))).toEqual([
      { column: 1, row: 1 },
      { column: 1, row: 2 },
      { column: 2, row: 1 },
    ]);
    const up = { ...down, direction: 'reverse' as const };
    expect(cooldownCell(up, 0, 3)).toEqual({ column: 1, row: 2 });
    const left = group('grid', [], { perLine: 3, direction: 'reverse' });
    expect(cooldownCell(left, 0, 3)).toEqual({ column: 3, row: 1 });
  });

  it('keeps a line on one run whatever its length (no wrap), in either direction', () => {
    const line = group('line', []);
    expect(cooldownCell(line, 4, 5)).toEqual({ column: 5, row: 1 });
    const leftward = { ...line, direction: 'reverse' as const };
    expect(cooldownCell(leftward, 0, 5)).toEqual({ column: 5, row: 1 });
    const column = { ...line, orientation: 'vertical' as const };
    expect(cooldownCell(column, 4, 5)).toEqual({ column: 1, row: 5 });
  });
});

describe('cooldown manager groups: visibility and search', () => {
  it('shows always, in combat only, or never, and the placement preview shows all', () => {
    expect(cooldownGroupShown('always', false, false)).toBe(true);
    expect(cooldownGroupShown('combat', false, false)).toBe(false);
    expect(cooldownGroupShown('combat', true, false)).toBe(true);
    expect(cooldownGroupShown('hidden', true, false)).toBe(false);
    expect(cooldownGroupShown('hidden', false, true)).toBe(true);
  });

  it('matches spell names by substring, ignoring case and accents; empty matches all', () => {
    expect(cooldownSpellMatches('Redharvest', 'harv')).toBe(true);
    expect(cooldownSpellMatches('Redharvest', 'HARV')).toBe(true);
    expect(cooldownSpellMatches('Éclair', 'ecl')).toBe(true);
    expect(cooldownSpellMatches('Flense', 'rend')).toBe(false);
    expect(cooldownSpellMatches('Flense', '  ')).toBe(true);
  });
});

describe('cooldown manager groups: sanitizing a save', () => {
  it('drops junk groups, duplicate ids, and a spell an earlier group already claimed', () => {
    const groups = sanitizeCooldownGroups([
      { id: 'g1', kind: 'line', spells: ['flense', 'rendclaw', 'flense', 'Bad Id', 7] },
      { id: 'g1', kind: 'single', spells: ['gorebite'] },
      { id: 'nope', kind: 'line', spells: [] },
      { id: 'g2', kind: 'mystery', spells: [] },
      { id: 'g3', kind: 'single', spells: ['rendclaw', 'gorebite'] },
      null,
    ]);
    expect(groups.map((g) => [g.id, g.kind, g.spells])).toEqual([
      ['g1', 'line', ['flense', 'rendclaw']],
      // rendclaw is g1's; the single keeps only its first surviving slot.
      ['g3', 'single', []],
    ]);
  });

  it('caps the group count and clamps every number into range', () => {
    const many = Array.from({ length: COOLDOWN_MAX_GROUPS + 3 }, (_, i) => ({
      id: `g${i + 1}`,
      kind: 'single',
    }));
    expect(sanitizeCooldownGroups(many)).toHaveLength(12);
    const wild = sanitizeCooldownGroup({
      id: 'g1',
      kind: 'grid',
      posX: 9,
      posY: -1,
      scale: 50,
      padding: 99,
      opacity: 0,
      perLine: 0,
      lines: 400,
      orientation: 'diagonal',
      direction: 'sideways',
      visibility: 'sometimes',
      showTimer: 'yes',
    });
    expect(wild).toMatchObject({
      posX: 1,
      posY: 0,
      scale: 2,
      padding: 12,
      opacity: 0.2,
      perLine: 1,
      lines: 12,
      orientation: 'horizontal',
      direction: 'forward',
      visibility: 'always',
      showTimer: true,
    });
  });

  it('keeps a custom group name, cleaned and capped, and treats junk as no name', () => {
    const named = (name: unknown) => sanitizeCooldownGroup({ id: 'g1', kind: 'line', name })?.name;
    expect(named('  Burst   Window ')).toBe('Burst Window');
    expect(named('Tab\there\nnewline')).toBe('Tab here newline');
    expect(named('x'.repeat(COOLDOWN_GROUP_NAME_MAX + 10))).toHaveLength(32);
    expect(named(42)).toBe('');
    expect(named(undefined)).toBe('');
    expect(sanitizeCooldownGroupName('   ')).toBe('');
  });

  it('grows a grid to hold its spells rather than dropping one', () => {
    const grid = sanitizeCooldownGroup({
      id: 'g1',
      kind: 'grid',
      perLine: 2,
      lines: 1,
      spells: ['a1', 'a2', 'a3', 'a4', 'a5'],
    });
    expect(grid?.spells).toHaveLength(5);
    expect(grid?.lines).toBe(3);
    expect(minGridLines(5, 2)).toBe(3);
    expect(minGridLines(0, 4)).toBe(1);
  });

  it('reads an unknown cue and bad numbers back as silence and defaults', () => {
    expect(sanitizeCooldownSpellConfig({ soundId: 'ui_aura_gone', soundVolume: 'loud' })).toEqual({
      soundId: AURA_CUE_NONE,
      soundVolume: 0.7,
      glowWhenReady: true,
      onlyWhenReady: false,
      hotbarGlow: false,
      alertStacks: 0,
    });
    const cue = AURA_CUES[0].id;
    expect(sanitizeCooldownSpellConfig({ soundId: cue, hotbarGlow: true })).toMatchObject({
      soundId: cue,
      hotbarGlow: true,
    });
    // An aura's stack goal is an integer, clamped to the stack ceiling.
    expect(sanitizeCooldownSpellConfig({ alertStacks: 3.6 }).alertStacks).toBe(4);
    expect(sanitizeCooldownSpellConfig({ alertStacks: 99 }).alertStacks).toBe(20);
    expect(sanitizeCooldownSpellConfig({ alertStacks: -2 }).alertStacks).toBe(0);
    expect(sanitizeCooldownManagerLayout({ idleOpacity: 5, enabled: 'no' })).toEqual({
      enabled: true,
      idleOpacity: 1,
      soundInCombatOnly: false,
    });
  });
});

describe('cooldown manager groups: assigning spells', () => {
  const groups: readonly CooldownGroup[] = [
    { ...group('line', ['flense', 'rendclaw']), id: 'g1' },
    { ...group('single', []), id: 'g2' },
  ];

  it('moves a spell between groups, keeping it in one group at most', () => {
    const moved = assignCooldownSpell(groups, 'rendclaw', 'g2');
    expect(moved.map((g) => g.spells)).toEqual([['flense'], ['rendclaw']]);
    expect(cooldownGroupOf(moved, 'rendclaw')).toBe('g2');
    const out = assignCooldownSpell(moved, 'rendclaw', null);
    expect(out.map((g) => g.spells)).toEqual([['flense'], []]);
    expect(cooldownGroupOf(out, 'rendclaw')).toBeNull();
  });

  it('returns the same array when refused: full, unknown group, bad id, or no change', () => {
    const full = assignCooldownSpell(groups, 'flense', 'g2');
    expect(assignCooldownSpell(full, 'rendclaw', 'g2')).toBe(full);
    expect(assignCooldownSpell(groups, 'flense', 'g9')).toBe(groups);
    expect(assignCooldownSpell(groups, 'Not An Id', 'g2')).toBe(groups);
    expect(assignCooldownSpell(groups, 'flense', 'g1')).toBe(groups);
    expect(assignCooldownSpell(groups, 'gorebite', null)).toBe(groups);
  });

  it('reorders within a group and stops at either end', () => {
    const later = moveCooldownSpell(groups, 'flense', 1);
    expect(later[0].spells).toEqual(['rendclaw', 'flense']);
    expect(moveCooldownSpell(later, 'flense', 1)[0].spells).toEqual(['rendclaw', 'flense']);
    expect(moveCooldownSpell(groups, 'gorebite', 1)).toBe(groups);
  });

  it('narrowing a grid reflows it: the run count grows to keep every spell', () => {
    const grid: CooldownGroup = {
      ...group('grid', ['a1', 'a2', 'a3', 'a4'], { perLine: 4, lines: 1 }),
      id: 'g1',
    };
    const [narrow] = patchCooldownGroup([grid], 'g1', { perLine: 2 });
    expect(narrow.spells).toHaveLength(4);
    expect(narrow.lines).toBe(2);
  });

  it('never drops a spell when a full grid is narrowed below what its rows can hold', () => {
    const spells = Array.from({ length: 20 }, (_, i) => `s${i}`);
    const grid: CooldownGroup = {
      ...group('grid', spells, { perLine: 4, lines: 5 }),
      id: 'g1',
    };
    // One column can only reach 12 rows: the width stays wide enough instead.
    const [narrow] = patchCooldownGroup([grid], 'g1', { perLine: 1 });
    expect(narrow.spells).toEqual(spells);
    expect(narrow.perLine).toBe(2);
    expect(narrow.lines).toBe(10);
  });

  it('staggers new groups and never reuses a live id', () => {
    const first = newCooldownGroup('line', []);
    const second = newCooldownGroup('line', [first]);
    expect(first.id).toBe('g1');
    expect(second.id).toBe('g2');
    expect(second.posY).toBeGreaterThan(first.posY);
  });
});

describe('cooldown manager store', () => {
  it('round-trips groups, layout and per-spell settings through storage, sanitized', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
    const store = new CooldownManagerStore('druid:Bob', storage);
    store.setGroups([{ ...group('line', ['flense']), id: 'g1' }]);
    store.patchLayout({ idleOpacity: 0.4 });
    store.patchSpell('flense', { hotbarGlow: true });
    expect([...data.keys()]).toEqual(['woc_cooldown_manager:druid:Bob']);
    const again = new CooldownManagerStore('druid:Bob', storage);
    expect(again.getGroups()[0].spells).toEqual(['flense']);
    expect(again.getLayout().idleOpacity).toBe(0.4);
    expect(again.getSpell('flense').hotbarGlow).toBe(true);
    data.set('woc_cooldown_manager:druid:Bob', '{not json');
    expect(new CooldownManagerStore('druid:Bob', storage).getGroups()).toEqual([]);
  });
});
