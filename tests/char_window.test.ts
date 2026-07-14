import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CRAFT_RING } from '../src/sim/content/professions';
import { archetypeTitleText, hobbyCraftText } from '../src/ui/char_window';

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
  it('renders one player-facing Warfare stat row', () => {
    expect(painter).toContain("'warfare'");
    expect(painter).not.toContain("'pvpOffense'");
    expect(painter).not.toContain("'pvpDefense'");
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

describe('archetypeTitleText (#1130): id-to-key view model', () => {
  it('falls back to the "no title yet" copy for null', () => {
    expect(archetypeTitleText(null)).toBe('None');
  });

  it('falls back to the "no title yet" copy for an unrecognized craft id', () => {
    expect(archetypeTitleText('not_a_real_craft')).toBe('None');
  });

  // Table-driven: one named title per craft on the ring, keyed by craft id (see
  // src/sim/content/professions.ts CRAFT_RING and the archetypeTitle catalog block
  // in src/ui/i18n.catalog/hud_chrome.ts). Every craft id must resolve to its own
  // distinct, non-fallback title.
  const EXPECTED_TITLE: Record<string, string> = {
    armorcrafting: 'Armorer',
    weaponcrafting: 'Weaponsmith',
    jewelcrafting: 'Jeweler',
    alchemy: 'Alchemist',
    engineering: 'Tinkerer',
    cooking: 'Chef',
    inscription: 'Scribe',
    enchanting: 'Enchanter',
    tailoring: 'Tailor',
    leatherworking: 'Leathercrafter',
  };

  it('has exactly one expected title per craft on the ring (test table stays in sync)', () => {
    expect(Object.keys(EXPECTED_TITLE).sort()).toEqual(CRAFT_RING.map((c) => c.id).sort());
  });

  it.each(
    CRAFT_RING.map((craft) => [craft.id, EXPECTED_TITLE[craft.id]] as const),
  )('resolves %s to its named title, not the fallback', (craftId, expected) => {
    const text = archetypeTitleText(craftId);
    expect(text).toBe(expected);
    expect(text).not.toBe('None');
  });

  it('resolves every craft id to a distinct title (no accidental key collision)', () => {
    const titles = CRAFT_RING.map((craft) => archetypeTitleText(craft.id));
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('hobbyCraftText (#1294): id-to-key view model', () => {
  // A hobby id IS a craft id on the ring, rendered through the same per-craft
  // name table as the archetype title (see src/ui/char_window.ts).
  it('falls back to the "no hobby yet" copy for null', () => {
    expect(hobbyCraftText(null)).toBe('None');
  });

  it('falls back to the "no hobby yet" copy for an unrecognized craft id', () => {
    expect(hobbyCraftText('not_a_real_craft')).toBe('None');
  });

  it('resolves a known craft id to its named title (never the fallback), for every ring craft', () => {
    for (const craft of CRAFT_RING) {
      const text = hobbyCraftText(craft.id);
      expect(text).toBe(archetypeTitleText(craft.id));
      expect(text).not.toBe('None');
    }
  });
});
