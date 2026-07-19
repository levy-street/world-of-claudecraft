import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CRAFT_RING } from '../src/sim/content/professions';
import { ARCHETYPE_PAIR_TARGETS } from '../src/sim/professions/archetype';
import { archetypeTitleText, craftNameText, hobbyCraftText } from '../src/ui/char_window';
import { hasTranslation } from '../src/ui/i18n';

// The character window painter is a DOM module; driving the live DOM + events is
// the opt-in browser suite. This is the no-DOM-suite
// equivalent: it asserts the painter source carries the a11y
// attributes + focus-return, the token discipline, and that the
// Three.js preview + skin-event randomness stay out of the painter (HUD-owned),
// driving the paperdoll off the pure core.
const painter = readFileSync(new URL('../src/ui/char_window.ts', import.meta.url), 'utf8');

describe('char_window: no magic values', () => {
  it('carries no literal color in TS (colors live in tokens/stylesheet)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens/CSS: ${hex.join(', ')}`).toEqual([]);
    expect(painter, 'rgb()/hsl() color literal must move to tokens/CSS').not.toMatch(
      /\b(?:rgba?|hsla?)\(/,
    );
  });

  it('routes the quality + empty-slot colors through CSS tokens', () => {
    expect(painter).toContain("const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)'");
    expect(painter).toContain("const SLOT_EMPTY_TEXT_COLOR = 'var(--color-slot-empty-text)'");
    expect(painter).toContain("const SLOT_EMPTY_BORDER_COLOR = 'var(--color-slot-empty-border)'");
  });

  it('uses no em or en dashes (ASCII separators only)', () => {
    expect(painter.includes('—'), 'em dash found').toBe(false);
    expect(painter.includes('–'), 'en dash found').toBe(false);
  });
});

describe('char_window: WCAG 2.2 AA', () => {
  it('returns focus to the opener on close', () => {
    expect(painter).toContain('captureFocus');
    expect(painter).toContain('restoreFocus');
    const close = painter.slice(painter.indexOf('close(): void {'));
    expect(close).toContain('this.deps.restoreFocus(this.openerFocus)');
  });

  it('labels its controls (close, unequip, the skin row)', () => {
    expect(painter).toContain('hud.options.returnToGame'); // close button aria-label key
    expect(painter).toContain('hudChrome.paperdoll.unequipAria'); // unequip button aria-label
    expect(painter).toContain('role="list"'); // the skin row
    expect(painter).toContain("t('auth.appearance')"); // skin-row aria-label
  });

  it('keeps the keyboard/touch unequip focus on the rebuilt slot', () => {
    expect(painter).toContain('this.doUnequip(slot, true)'); // x button keeps focus
    expect(painter).toContain('document.getElementById'); // looks up the rebuilt slot row
  });
});

describe('char_window: paperdoll core + HUD-owned preview boundary', () => {
  it('registers every computed character-stat label used while opening the window', () => {
    for (const stat of [
      'str',
      'armor',
      'agi',
      'attackPower',
      'sta',
      'dps',
      'int',
      'critChance',
      'spi',
      'dodge',
      'parry',
    ]) {
      expect(hasTranslation(`itemUi.stats.${stat}`), stat).toBe(true);
    }
  });

  it('renders one player-facing Warfare stat row', () => {
    expect(painter).toContain("'warfare'");
    expect(painter).not.toContain("'pvpOffense'");
    expect(painter).not.toContain("'pvpDefense'");
  });

  it('shows the current spendable Honor balance in the character-sheet header', () => {
    expect(painter).toContain('world.honor');
    expect(painter).toContain("t('hudChrome.warfare.balance'");
    expect(painter).toContain('char-honor-balance');
  });

  it('drives the paperdoll off the pure char_view core', () => {
    expect(painter).toContain('buildPaperdollView(world.equipment, ITEMS)');
  });

  it('preserves the unequip / drag / context-menu dispatch', () => {
    expect(painter).toContain('this.deps.unequip(slot)');
    expect(painter).toContain('this.deps.beginUnequipDrag(slot)');
    expect(painter).toContain('this.deps.endUnequipDrag()');
    expect(painter).toContain("row.addEventListener('contextmenu'");
  });

  it('triggers the 3D preview + skin picker by callback, never building them here', () => {
    expect(painter).toContain('this.deps.renderPreview()');
    expect(painter).toContain('this.deps.renderSkinPicker()');
  });

  it('imports no Three / render layer and carries no skin-event randomness', () => {
    expect(painter).not.toMatch(/from\s+['"]\.\.\/render\//);
    expect(painter).not.toMatch(/from\s+['"]three['"]/);
    expect(painter).not.toMatch(/\bCharacterPreview\b/);
    expect(painter).not.toMatch(/\bMath\.random\b/);
  });
});

describe('archetypeTitleText (#1130, pair-named): id-to-key view model', () => {
  it('falls back to the "no title yet" copy for null', () => {
    expect(archetypeTitleText(null)).toBe('None');
  });

  it('falls back to the "no title yet" copy for an unrecognized pair id', () => {
    expect(archetypeTitleText('not_a_real_pair')).toBe('None');
  });

  it('falls back to the "no title yet" copy for a bare craft id (titles are per PAIR now)', () => {
    expect(archetypeTitleText('armorcrafting')).toBe('None');
  });

  // Table-driven: one named title per selectable adjacent pair, keyed by the
  // canonical pair id (see src/sim/professions/archetype.ts
  // ARCHETYPE_PAIR_TARGETS and the archetypePair catalog block in
  // src/ui/i18n.catalog/hud_chrome.ts). Every pair id must resolve to its own
  // distinct, non-fallback title.
  const EXPECTED_TITLE: Record<string, string> = {
    'engineering+alchemy': 'Bombardier',
    'alchemy+cooking': 'Apothecary',
    'cooking+leatherworking': 'Trapper',
    'leatherworking+tailoring': 'Outfitter',
    'tailoring+inscription': 'Mageweaver',
    'inscription+enchanting': 'Arcanist',
    'enchanting+jewelcrafting': 'Gembinder',
    'jewelcrafting+weaponcrafting': 'Bladewright',
    'weaponcrafting+armorcrafting': 'Smith',
    'armorcrafting+engineering': 'Cogsmith',
  };

  it('has exactly one expected title per selectable pair (test table stays in sync)', () => {
    expect(Object.keys(EXPECTED_TITLE).sort()).toEqual([...ARCHETYPE_PAIR_TARGETS].sort());
  });

  it.each(ARCHETYPE_PAIR_TARGETS.map((pairId) => [pairId, EXPECTED_TITLE[pairId]] as const))(
    'resolves %s to its named title, not the fallback',
    (pairId, expected) => {
      const text = archetypeTitleText(pairId);
      expect(text).toBe(expected);
      expect(text).not.toBe('None');
    },
  );

  it('resolves every pair id to a distinct title (no accidental key collision)', () => {
    const titles = ARCHETYPE_PAIR_TARGETS.map((pairId) => archetypeTitleText(pairId));
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('craftNameText: id-to-key view model', () => {
  it('falls back to the "none" copy for null and unrecognized ids', () => {
    expect(craftNameText(null)).toBe('None');
    expect(craftNameText('not_a_real_craft')).toBe('None');
  });

  // Table-driven: one display name per craft on the ring, keyed by craft id
  // (see src/sim/content/professions.ts CRAFT_RING and the craftName catalog
  // block in src/ui/i18n.catalog/hud_chrome.ts).
  const EXPECTED_CRAFT_NAME: Record<string, string> = {
    armorcrafting: 'Armorcrafting',
    weaponcrafting: 'Weaponcrafting',
    jewelcrafting: 'Jewelcrafting',
    alchemy: 'Alchemy',
    engineering: 'Engineering',
    cooking: 'Cooking',
    inscription: 'Inscription',
    enchanting: 'Enchanting',
    tailoring: 'Tailoring',
    leatherworking: 'Leatherworking',
  };

  it('has exactly one expected name per craft on the ring (test table stays in sync)', () => {
    expect(Object.keys(EXPECTED_CRAFT_NAME).sort()).toEqual(CRAFT_RING.map((c) => c.id).sort());
  });

  it.each(CRAFT_RING.map((craft) => [craft.id, EXPECTED_CRAFT_NAME[craft.id]] as const))(
    'resolves %s to its display name, not the fallback',
    (craftId, expected) => {
      const text = craftNameText(craftId);
      expect(text).toBe(expected);
      expect(text).not.toBe('None');
    },
  );
});

describe('hobbyCraftText (#1294): id-to-key view model', () => {
  // A hobby id IS a craft id on the ring, rendered through the per-craft
  // display-name table (see src/ui/char_window.ts craftNameText).
  it('falls back to the "no hobby yet" copy for null', () => {
    expect(hobbyCraftText(null)).toBe('None');
  });

  it('falls back to the "no hobby yet" copy for an unrecognized craft id', () => {
    expect(hobbyCraftText('not_a_real_craft')).toBe('None');
  });

  it('resolves a known craft id to its craft display name (never the fallback), for every ring craft', () => {
    for (const craft of CRAFT_RING) {
      const text = hobbyCraftText(craft.id);
      expect(text).toBe(craftNameText(craft.id));
      expect(text).not.toBe('None');
    }
  });
});

describe('char_window: own-paperdoll per-copy tooltip threading (Phase 6)', () => {
  it('resolves the worn instance from the self entity mirror inside the tooltip closure', () => {
    // Both worlds mirror the own worn set on the self entity
    // (equippedInstances), so the paperdoll tooltip must read it per slot at
    // hover time (a closure over deps.world(), never a stale capture) and
    // forward it into the widened itemTooltip dep. Dropping either line
    // reverts the own paperdoll to def-only tooltips while every pure-core
    // suite stays green.
    expect(painter).toContain('world.entities.get(world.playerId)?.equippedInstances?.[slot]');
    expect(painter).toContain('this.deps.itemTooltip(item, instance)');
  });
});
