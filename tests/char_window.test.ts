// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CRAFT_RING } from '../src/sim/content/professions';
import { ARCHETYPE_PAIR_TARGETS } from '../src/sim/professions/archetype';
import { STAT_DEFENSE, STAT_GRID } from '../src/ui/char_stats_view';
import {
  archetypeTitleText,
  CharWindow,
  craftNameText,
  hobbyCraftText,
  playtimeText,
} from '../src/ui/char_window';
import { hasTranslation } from '../src/ui/i18n';
import { ItemDragState } from '../src/ui/item_drag_state';
import { svgIcon } from '../src/ui/ui_icons';

// The character window painter is a DOM module. Most guards below inspect its
// source, while the profession-art arm opts into jsdom and drives the real
// painter. Under jsdom import.meta.url is an http URL, so resolve source from
// Vitest's injected filesystem dirname.
const painter = readFileSync(join(__dirname, '../src/ui/char_window.ts'), 'utf8');

afterEach(() => vi.restoreAllMocks());

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

describe('char_window: profession art placements', () => {
  it('renders gathering rows with their dedicated painted icons', () => {
    expect(painter).toMatch(/professionImageUrl\(`gather_\$\{r\.professionId\}`\)/);
    expect(painter).toContain('class="char-gather-icon"');
    expect(painter).toContain('class="char-gather-row"');
  });

  it('shows the current pair crest inline without inventing a tiny tooltip target', () => {
    expect(painter).toContain('archetypeImageUrl(world.archetypeTitle)');
    expect(painter).toContain('class="char-archetype-title-crest"');
    expect(painter).not.toContain('class="char-archetype-tooltip-crest"');
    expect(painter).toContain('alt=""');
  });

  it('paints the exact four gathering assets and replaces the inline pair crest', () => {
    let canvasContext: unknown;
    canvasContext = new Proxy(
      {},
      {
        get: () => () => canvasContext,
        set: () => true,
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,stub',
    );
    const root = document.createElement('div');
    let world = {
      cfg: { playerClass: 'warrior' },
      player: { name: 'Aurelia', level: 60, skin: 0 },
      equipment: {},
      honor: 0,
      archetypeTitle: 'weaponcrafting+armorcrafting' as string | null,
      hobbyCraft: 'jewelcrafting',
      selectedMount: () => null,
      ownedMounts: () => [],
      selectMount: () => {},
      professionsState: {
        skills: [
          { professionId: 'mining', skill: 11, maxSkill: 125 },
          { professionId: 'logging', skill: 12, maxSkill: 125 },
          { professionId: 'herbalism', skill: 13, maxSkill: 125 },
          { professionId: 'fishing', skill: 14, maxSkill: 125 },
        ],
      },
    };
    const attachTooltip = vi.fn();
    const win = new CharWindow({
      root: () => root,
      world: () => world as never,
      closeOthers: vi.fn(),
      hideTooltip: vi.fn(),
      captureFocus: () => null,
      restoreFocus: vi.fn(),
      slotName: (slot) => slot,
      statCellHtml: () => '',
      statTooltipHtml: () => '',
      talentSummaryHtml: () => '',
      progressionHtml: () => '',
      unequip: vi.fn(),
      beginUnequipDrag: vi.fn(),
      endUnequipDrag: vi.fn(),
      renderPreview: vi.fn(),
      renderSkinPicker: vi.fn(),
      openPlayerCard: vi.fn(),
      openPrestige: vi.fn(),
      openDeeds: vi.fn(),
      openReliquary: vi.fn(),
      dragState: new ItemDragState(),
      renderBags: vi.fn(),
      showError: vi.fn(),
      helmHidden: () => false,
      toggleHelm: vi.fn(),
      playtimeVisible: () => true,
      togglePlaytimeVisible: vi.fn(),
      itemIcon: () => '',
      moneyHtml: () => '',
      itemTooltip: () => '',
      attachTooltip,
    });

    win.render();
    expect(
      [...root.querySelectorAll<HTMLImageElement>('.char-gather-icon')].map((img) =>
        img.getAttribute('src'),
      ),
    ).toEqual([
      '/ui/professions/gather_mining.webp',
      '/ui/professions/gather_logging.webp',
      '/ui/professions/gather_herbalism.webp',
      '/ui/professions/gather_fishing.webp',
    ]);
    const crest = root.querySelector<HTMLImageElement>('.char-archetype-title-crest');
    expect(crest?.getAttribute('src')).toBe('/ui/professions/archetype_smith.webp');
    expect(crest?.getAttribute('alt')).toBe('');
    expect(attachTooltip.mock.calls.some(([target]) => target === crest?.parentElement)).toBe(
      false,
    );

    world = {
      ...world,
      archetypeTitle: 'engineering+alchemy',
      hobbyCraft: 'cooking',
    };
    win.render();
    expect(root.querySelectorAll('.char-archetype-title-crest')).toHaveLength(1);
    expect(
      root.querySelector<HTMLImageElement>('.char-archetype-title-crest')?.getAttribute('src'),
    ).toBe('/ui/professions/archetype_bombardier.webp');
    expect(root.innerHTML).not.toContain('/ui/professions/archetype_smith.webp');

    world = { ...world, archetypeTitle: null };
    win.render();
    expect(root.querySelector('.char-archetype-title-crest')).toBeNull();
    expect(root.innerHTML).not.toContain('/ui/professions/archetype_bombardier.webp');
  });

  it('floors a fractional gathering proficiency in the rendered row (issue 2339)', () => {
    // The sheet must never claim an uncrossed threshold: the deed evaluator
    // and the band ladder compare the raw value with >=, so 99.5 renders 99
    // (the professions-window floor convention), never a rounded 100.
    let canvasContext: unknown;
    canvasContext = new Proxy(
      {},
      {
        get: () => () => canvasContext,
        set: () => true,
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,stub',
    );
    const root = document.createElement('div');
    const world = {
      cfg: { playerClass: 'warrior' },
      player: { name: 'Aurelia', level: 60, skin: 0 },
      equipment: {},
      honor: 0,
      archetypeTitle: null,
      hobbyCraft: 'jewelcrafting',
      selectedMount: () => null,
      ownedMounts: () => [],
      selectMount: () => {},
      professionsState: {
        skills: [
          { professionId: 'mining', skill: 99.75, maxSkill: 100 },
          { professionId: 'logging', skill: 12, maxSkill: 100 },
          { professionId: 'herbalism', skill: 100, maxSkill: 100 },
          { professionId: 'fishing', skill: 99.5, maxSkill: 200 },
        ],
      },
    };
    const win = new CharWindow({
      root: () => root,
      world: () => world as never,
      closeOthers: vi.fn(),
      hideTooltip: vi.fn(),
      captureFocus: () => null,
      restoreFocus: vi.fn(),
      slotName: (slot) => slot,
      statCellHtml: () => '',
      statTooltipHtml: () => '',
      talentSummaryHtml: () => '',
      progressionHtml: () => '',
      unequip: vi.fn(),
      beginUnequipDrag: vi.fn(),
      endUnequipDrag: vi.fn(),
      renderPreview: vi.fn(),
      renderSkinPicker: vi.fn(),
      openPlayerCard: vi.fn(),
      openPrestige: vi.fn(),
      openDeeds: vi.fn(),
      openReliquary: vi.fn(),
      dragState: new ItemDragState(),
      renderBags: vi.fn(),
      showError: vi.fn(),
      helmHidden: () => false,
      toggleHelm: vi.fn(),
      playtimeVisible: () => true,
      togglePlaytimeVisible: vi.fn(),
      itemIcon: () => '',
      moneyHtml: () => '',
      itemTooltip: () => '',
      attachTooltip: vi.fn(),
    });

    win.render();
    const values = [...root.querySelectorAll('.char-gather-row b')].map((b) => b.textContent);
    // The row renders a BOUNDED "skill / max", never a bare integer. The floor
    // still holds (99.75 and 99.5 read 99, never a fake crossed 100), and
    // fishing's denominator is its own 200 cap, not the 100 the other three
    // share.
    expect(values).toEqual(['99 / 100', '12 / 100', '100 / 100', '99 / 200']);
    // Decisive against a regression to the bare integer: no row may render a
    // lone number with no denominator.
    for (const value of values) expect(value).toMatch(/^\d+ \/ \d+$/);
  });

  it('renders the gathering denominator through the shared professions skillValue key', () => {
    // The same key the professions window uses, so the two surfaces cannot
    // drift apart and a locale owns the separator. Never a concatenated
    // '/' literal in the painter.
    // Strip whole-line comments first: gatheringHtml's own comment names this
    // key in prose, so an uncommented read is one reword from self-satisfying.
    const code = painter.replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain("t('hudChrome.professions.skillValue'");
    expect(code).toMatch(/skill:\s*formatNumber\(r\.displayValue/);
    expect(code).toMatch(/max:\s*formatNumber\(r\.maxSkill/);
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

  it('renders one player-facing Warfare stat row (never the raw pvpOffense/pvpDefense stats)', () => {
    // The stat partition now lives in the char_stats_view core; the sheet shows a
    // single Warfare summary and never the internal pvpOffense/pvpDefense ids.
    expect(STAT_DEFENSE).toContain('warfare');
    expect(STAT_GRID).not.toContain('pvpOffense' as unknown as (typeof STAT_GRID)[number]);
    expect(STAT_GRID).not.toContain('pvpDefense' as unknown as (typeof STAT_GRID)[number]);
    // And the painter composes those groups off the pure core, not an inline grid.
    expect(painter).toContain("from './char_stats_view'");
    expect(painter).toContain('STAT_PANELS');
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

describe('char_window: focus carried across the 2 Hz rebuild', () => {
  function canvasStub(): void {
    let canvasContext: unknown;
    canvasContext = new Proxy({}, { get: () => () => canvasContext, set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,stub',
    );
  }

  function makeWin(root: HTMLElement): CharWindow {
    const world = {
      cfg: { playerClass: 'warrior' },
      player: { name: 'Aurelia', level: 60, skin: 0 },
      equipment: {},
      honor: 0,
      archetypeTitle: null,
      hobbyCraft: null,
      selectedMount: () => null,
      ownedMounts: () => [],
      selectMount: () => {},
      professionsState: { skills: [] },
    };
    return new CharWindow({
      root: () => root,
      world: () => world as never,
      closeOthers: vi.fn(),
      hideTooltip: vi.fn(),
      captureFocus: () => null,
      restoreFocus: vi.fn(),
      slotName: (slot) => slot,
      statCellHtml: () => '',
      statTooltipHtml: () => '',
      talentSummaryHtml: () => '',
      progressionHtml: () => '',
      unequip: vi.fn(),
      beginUnequipDrag: vi.fn(),
      endUnequipDrag: vi.fn(),
      renderPreview: vi.fn(),
      renderSkinPicker: vi.fn(),
      openPlayerCard: vi.fn(),
      openPrestige: vi.fn(),
      openDeeds: vi.fn(),
      openReliquary: vi.fn(),
      dragState: new ItemDragState(),
      renderBags: vi.fn(),
      showError: vi.fn(),
      helmHidden: () => false,
      toggleHelm: vi.fn(),
      playtimeVisible: () => true,
      togglePlaytimeVisible: vi.fn(),
      itemIcon: () => 'data:image/png;base64,stub',
      moneyHtml: () => '',
      itemTooltip: () => '',
      attachTooltip: vi.fn(),
    });
  }

  it('keeps focus on the same control when a signature repaint rebuilds the sheet', () => {
    // The behavioral arm for the latch's new trigger rate: refreshCharSheetIfChanged
    // calls renderIfOpen within 500 ms of any signed surface moving, so a
    // keyboard user with focus inside the sheet hits this path ROUTINELY. The
    // rebuilt-element inequality below is the proof this is a real innerHTML
    // wipe and not a no-op the assertion would pass vacuously.
    canvasStub();
    const root = document.createElement('div');
    document.body.appendChild(root);
    try {
      const win = makeWin(root);
      win.render();
      const share = root.querySelector<HTMLElement>('[data-act="share-card"]');
      expect(share, 'the share control must exist to focus').not.toBeNull();
      share?.focus();
      expect(document.activeElement).toBe(share);
      win.render();
      const rebuilt = root.querySelector<HTMLElement>('[data-act="share-card"]');
      expect(rebuilt).not.toBeNull();
      expect(rebuilt, 'the repaint must really rebuild the control').not.toBe(share);
      expect(document.activeElement).toBe(rebuilt);
    } finally {
      document.body.removeChild(root);
    }
  });

  it('falls back to Close for a focused control without a data-act identity', () => {
    // The ladder's second rung, pinned on the close button itself: it carries
    // data-close and no data-act, so the same-act arm cannot match it and the
    // fallback must land on the REBUILT close button (the not.toBe is the
    // vacuity guard proving a real wipe happened). Trimming the fallback out
    // of restoreFirstEnabled's candidate list reds here and nowhere else.
    canvasStub();
    const root = document.createElement('div');
    document.body.appendChild(root);
    try {
      const win = makeWin(root);
      win.render();
      const close = root.querySelector<HTMLElement>('[data-close]');
      expect(close, 'the close control must exist to focus').not.toBeNull();
      close?.focus();
      expect(document.activeElement).toBe(close);
      win.render();
      const rebuilt = root.querySelector<HTMLElement>('[data-close]');
      expect(rebuilt).not.toBeNull();
      expect(rebuilt, 'the repaint must really rebuild the control').not.toBe(close);
      expect(document.activeElement).toBe(rebuilt);
    } finally {
      document.body.removeChild(root);
    }
  });

  it('leaves focus alone when it sits OUTSIDE the sheet', () => {
    // The negative arm: a repaint while the player types in chat or targets
    // the world must not steal focus into the sheet.
    canvasStub();
    const root = document.createElement('div');
    const outside = document.createElement('button');
    document.body.appendChild(root);
    document.body.appendChild(outside);
    try {
      const win = makeWin(root);
      win.render();
      outside.focus();
      expect(document.activeElement).toBe(outside);
      win.render();
      expect(document.activeElement).toBe(outside);
    } finally {
      document.body.removeChild(root);
      document.body.removeChild(outside);
    }
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
    'tailoring+inscription': 'Inkweaver',
    'inscription+enchanting': 'Arcanist',
    'enchanting+jewelcrafting': 'Gembinder',
    'jewelcrafting+weaponcrafting': 'Bladewright',
    'weaponcrafting+armorcrafting': 'Smith',
    'armorcrafting+engineering': 'Gearwright',
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

describe('char_window: lifetime Time Played line (issue: character-sheet playtime)', () => {
  const MINUTE = 60;
  const HOUR = 3600;
  const DAY = 86_400;

  // RuneScape-style composition: the two coarsest non-zero units, the zero
  // minor unit dropped, floored (an accumulator never overstates), sub-minute
  // floor line. English catalog values resolve through the real i18n runtime,
  // so these also pin the plural leaves and the join template.
  it('formats the two coarsest units and drops a zero minor unit', () => {
    expect(playtimeText(0)).toBe('Less than a minute');
    expect(playtimeText(59)).toBe('Less than a minute');
    expect(playtimeText(MINUTE)).toBe('1 minute');
    expect(playtimeText(2 * MINUTE + 59)).toBe('2 minutes');
    expect(playtimeText(HOUR)).toBe('1 hour');
    expect(playtimeText(HOUR + MINUTE)).toBe('1 hour, 1 minute');
    // A minute-quantized ONLINE mirror value (always a multiple of 60, see
    // the ptime wire key) renders identically to its unfloored offline twin.
    expect(playtimeText(HOUR + 2 * MINUTE)).toBe('1 hour, 2 minutes');
    expect(playtimeText(5 * HOUR + 42 * MINUTE + 59)).toBe('5 hours, 42 minutes');
    expect(playtimeText(DAY)).toBe('1 day');
    expect(playtimeText(DAY + 59)).toBe('1 day');
    expect(playtimeText(DAY + HOUR)).toBe('1 day, 1 hour');
    // Minutes never ride a days-scale total: two coarsest units only.
    expect(playtimeText(12 * DAY + 5 * HOUR + 31 * MINUTE)).toBe('12 days, 5 hours');
    // Days-scale total with zero whole hours drops the minor unit even though
    // minutes remain (hours is the only legal minor unit at days scale).
    expect(playtimeText(2 * DAY + 31 * MINUTE)).toBe('2 days');
  });

  it('degrades a negative or non-finite total to the sub-minute floor', () => {
    expect(playtimeText(-5)).toBe('Less than a minute');
    expect(playtimeText(Number.NaN)).toBe('Less than a minute');
  });

  function renderSheet(opts: { visible: boolean; seconds: number }) {
    let canvasContext: unknown;
    canvasContext = new Proxy(
      {},
      {
        get: () => () => canvasContext,
        set: () => true,
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,stub',
    );
    const root = document.createElement('div');
    const world = {
      cfg: { playerClass: 'warrior' },
      player: { name: 'Aurelia', level: 60, skin: 0 },
      equipment: {},
      honor: 0,
      archetypeTitle: null,
      hobbyCraft: null,
      playtimeSeconds: opts.seconds,
      professionsState: { skills: [] },
    };
    // Mirror the production toggle (settings flip + synchronous sheet
    // repaint via the main.ts options arm) so the focus re-seat assertion
    // exercises the REBUILT eye, not the pre-repaint capture the rebuild
    // orphans.
    let visible = opts.visible;
    const togglePlaytimeVisible = vi.fn(() => {
      visible = !visible;
      win.render();
    });
    const restoreFocus = vi.fn();
    const attachTooltip = vi.fn();
    const win = new CharWindow({
      root: () => root,
      world: () => world as never,
      closeOthers: vi.fn(),
      hideTooltip: vi.fn(),
      captureFocus: () => null,
      restoreFocus,
      slotName: (slot) => slot,
      statCellHtml: () => '',
      statTooltipHtml: () => '',
      talentSummaryHtml: () => '',
      progressionHtml: () => '',
      unequip: vi.fn(),
      beginUnequipDrag: vi.fn(),
      endUnequipDrag: vi.fn(),
      renderPreview: vi.fn(),
      renderSkinPicker: vi.fn(),
      openPlayerCard: vi.fn(),
      openPrestige: vi.fn(),
      openDeeds: vi.fn(),
      openReliquary: vi.fn(),
      dragState: new ItemDragState(),
      renderBags: vi.fn(),
      showError: vi.fn(),
      helmHidden: () => false,
      toggleHelm: vi.fn(),
      playtimeVisible: () => visible,
      togglePlaytimeVisible,
      itemIcon: () => '',
      moneyHtml: () => '',
      itemTooltip: () => '',
      attachTooltip,
    });
    win.render();
    return { root, togglePlaytimeVisible, restoreFocus, attachTooltip };
  }

  it('renders the revealed value with the concealing eye affordance', () => {
    const { root } = renderSheet({ visible: true, seconds: 5 * HOUR + 42 * MINUTE });
    expect(root.querySelector('.char-playtime-label')?.textContent).toBe('Time Played');
    const value = root.querySelector('.char-playtime-value');
    expect(value?.textContent).toBe('5 hours, 42 minutes');
    expect(value?.classList.contains('char-playtime-value-hidden')).toBe(false);
    const eye = root.querySelector('[data-act="toggle-playtime"]');
    expect(eye?.getAttribute('aria-pressed')).toBe('false');
    expect(eye?.getAttribute('aria-label')).toBe('Hide time played');
    // Glyph polarity, pinned through the slash path's unique data (the DOM
    // re-serializes the SVG, so byte-equality with svgIcon() cannot hold):
    // eye-off is the eye PLUS the diagonal slash, so revealed must carry the
    // shared outline and NOT the slash.
    expect(svgIcon('eye-off')).toContain('M106 42');
    expect(svgIcon('eye')).not.toContain('M106 42');
    expect(eye?.innerHTML).toContain('M256 112');
    expect(eye?.innerHTML).not.toContain('M106 42');
  });

  it('conceals the VALUE, not the row, while hidden (and flips the eye state)', () => {
    const { root } = renderSheet({ visible: false, seconds: 12 * DAY });
    const value = root.querySelector('.char-playtime-value');
    expect(value?.textContent).toBe('Hidden');
    expect(value?.classList.contains('char-playtime-value-hidden')).toBe(true);
    // Decisive: the real total may leak nowhere in the sheet markup.
    expect(root.innerHTML).not.toContain('12 days');
    const eye = root.querySelector('[data-act="toggle-playtime"]');
    expect(eye?.getAttribute('aria-pressed')).toBe('true');
    expect(eye?.getAttribute('aria-label')).toBe('Show time played');
    // Glyph polarity: concealed shows the struck eye (the slash path).
    expect(eye?.innerHTML).toContain('M106 42');
  });

  it('routes the eye click through the HUD-owned toggle and re-seats focus on the rebuilt eye', () => {
    const { root, togglePlaytimeVisible, restoreFocus } = renderSheet({
      visible: true,
      seconds: HOUR,
    });
    const eye = root.querySelector<HTMLButtonElement>('[data-act="toggle-playtime"]');
    expect(eye).not.toBeNull();
    eye?.click();
    expect(togglePlaytimeVisible).toHaveBeenCalledTimes(1);
    // The toggle repaints the sheet (innerHTML rebuild), so the painter must
    // hand focus to the eye MINTED BY THE REPAINT: the stale pre-repaint
    // capture is orphaned by the rebuild and would drop a keyboard user on
    // <body>. Killing regressions: restoreFocus(oldEye), restoreFocus(null),
    // and a re-seat ordered before the repaint.
    const rebuilt = root.querySelector<HTMLButtonElement>('[data-act="toggle-playtime"]');
    expect(rebuilt).not.toBeNull();
    expect(rebuilt).not.toBe(eye);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
    expect(restoreFocus).toHaveBeenCalledWith(rebuilt);
    // And the repaint really flipped the row: the rebuilt eye is the
    // concealed arm now.
    expect(rebuilt?.getAttribute('aria-pressed')).toBe('true');
  });

  it('serves the swapping eye tooltip from the LIVE visibility state', () => {
    const { root, attachTooltip } = renderSheet({ visible: true, seconds: HOUR });
    const eyeCall = attachTooltip.mock.calls.find(
      ([el]) => (el as HTMLElement).getAttribute?.('data-act') === 'toggle-playtime',
    );
    expect(eyeCall).toBeDefined();
    const tooltipText = eyeCall?.[1] as () => string;
    expect(tooltipText()).toBe('Hide time played');
    // The callback reads the dep live, so after a toggle the SAME registered
    // closure serves the other arm.
    root.querySelector<HTMLButtonElement>('[data-act="toggle-playtime"]')?.click();
    expect(tooltipText()).toBe('Show time played');
  });
});

describe('char_window: own-paperdoll per-copy tooltip threading', () => {
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
