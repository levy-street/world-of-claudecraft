// Decisive pins for the shared item-name color helper. Chat links, loot names,
// and tooltips all consume itemNameColor so quest gold cannot drift per surface.
// Source pins on hud + loot_roll keep call sites from re-inlining QUALITY_COLOR.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QUALITY_COLOR } from '../src/ui/icons';
import { itemNameColor, QUEST_ITEM_NAME_COLOR } from '../src/ui/item_name_color';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('item_name_color: quest purpose override', () => {
  it('quest kind always returns quest gold, even when quality is common/white', () => {
    expect(itemNameColor({ kind: 'quest', quality: 'common' })).toBe(QUEST_ITEM_NAME_COLOR);
    expect(itemNameColor({ kind: 'quest', quality: 'common' })).not.toBe(QUALITY_COLOR.common);
  });

  it('quest kind overrides every quality tier (purpose class, not rarity)', () => {
    for (const quality of ['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary'] as const) {
      expect(itemNameColor({ kind: 'quest', quality }), quality).toBe(QUEST_ITEM_NAME_COLOR);
    }
  });

  it('quest gold is the Phase 1 --color-quest token, not a raw hex', () => {
    expect(QUEST_ITEM_NAME_COLOR).toBe('var(--color-quest)');
    expect(itemNameColor({ kind: 'quest' })).toBe('var(--color-quest)');
  });

  it('is case-sensitive on kind: only exact sim token "quest" overrides', () => {
    expect(itemNameColor({ kind: 'Quest', quality: 'common' })).toBe(QUALITY_COLOR.common);
    expect(itemNameColor({ kind: 'QUEST', quality: 'common' })).toBe(QUALITY_COLOR.common);
    expect(itemNameColor({ kind: '', quality: 'common' })).toBe(QUALITY_COLOR.common);
  });
});

describe('item_name_color: quality path for non-quest', () => {
  it('keeps the QUALITY_COLOR map for every non-quest ItemKind', () => {
    for (const kind of [
      'weapon',
      'armor',
      'held_offhand',
      'junk',
      'food',
      'drink',
      'tool',
      'potion',
      'elixir',
      'bag',
      'mount',
    ]) {
      expect(itemNameColor({ kind, quality: 'rare' }), kind).toBe(QUALITY_COLOR.rare);
      expect(itemNameColor({ kind, quality: 'epic' }), kind).toBe(QUALITY_COLOR.epic);
    }
  });

  it('defaults missing quality to common', () => {
    expect(itemNameColor({ kind: 'weapon' })).toBe(QUALITY_COLOR.common);
    expect(itemNameColor({ kind: 'weapon', quality: null })).toBe(QUALITY_COLOR.common);
    expect(itemNameColor({ kind: 'weapon', quality: undefined })).toBe(QUALITY_COLOR.common);
  });

  it('uses the quality-default token when quality is unknown or hostile', () => {
    expect(itemNameColor({ kind: 'weapon', quality: 'mythic' })).toBe(
      'var(--color-quality-default)',
    );
    // Prototype key must not leak Object.prototype.constructor into a style attr.
    expect(itemNameColor({ kind: 'weapon', quality: 'constructor' })).toBe(
      'var(--color-quality-default)',
    );
    expect(itemNameColor({ kind: 'weapon', quality: '__proto__' })).toBe(
      'var(--color-quality-default)',
    );
  });

  it('works with kind absent (unknown item def / wire-only quality)', () => {
    expect(itemNameColor({ quality: 'uncommon' })).toBe(QUALITY_COLOR.uncommon);
    expect(itemNameColor({})).toBe(QUALITY_COLOR.common);
  });

  it('pins every QUALITY_COLOR tier through the helper (no silent map drift)', () => {
    for (const [quality, color] of Object.entries(QUALITY_COLOR)) {
      expect(itemNameColor({ kind: 'weapon', quality })).toBe(color);
    }
  });
});

describe('item_name_color: consumer source pins', () => {
  it('chat item links and tooltip titles route through itemNameColor', () => {
    const hudSrc = readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    );
    expect(hudSrc).toContain("from './item_name_color'");
    expect(hudSrc).toContain('itemNameColor(item)');
    // Chat link must not re-inline QUALITY_COLOR for the name color.
    expect(hudSrc).not.toMatch(/link\.style\.color\s*=\s*QUALITY_COLOR\[item\.quality/);
  });

  it('loot roll need/greed, watch, and master name colors use itemNameColor', () => {
    const lootSrc = readFileSync(
      path.join(__dirname, '../src/ui/hud/loot/loot_roll_controller.ts'),
      'utf8',
    ).replace(/^\s*\/\/.*$/gm, '');
    expect(lootSrc).toContain("from '../../item_name_color'");
    // Three name surfaces: active need/greed, status watch, master assign.
    const nameColorCalls = lootSrc.match(/itemNameColor\(\{\s*kind: item\?\.kind/g) ?? [];
    expect(nameColorCalls.length).toBe(3);
    expect(lootSrc).not.toContain('const qualityColor');
  });
});
