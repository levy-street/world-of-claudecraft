// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CRAFT_RING } from '../src/sim/content/professions';
import { ITEMS } from '../src/sim/data';
import { itemCopyPin } from '../src/sim/item_copy_ref';
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

  it('routes the empty-slot colors through CSS tokens and the cell color through the hex map', () => {
    // The cell color moved into the shared cell authority (worn_item_cell_view.ts,
    // the phase 13 QA), which answers a HEX literal always (its fallback is the
    // map's common rung, never the old var() token, since the inspect nameplate
    // and the player-card canvas consume the same value); the empty-slot pair
    // stays here.
    // Comment-stripped both ways: a comment quoting the expression must not
    // satisfy the positive pin, and one naming the retired token must not
    // fail the negative (the source-text pin trap).
    const cellView = readFileSync(join(__dirname, '../src/ui/worn_item_cell_view.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    expect(cellView).toContain("QUALITY_COLOR[quality ?? 'common'] ?? QUALITY_COLOR.common");
    expect(cellView).not.toContain('var(--color-quality-default)');
    expect(painter).not.toContain('QUALITY_DEFAULT_COLOR');
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

describe('char_window: paperdoll helm-visibility eye', () => {
  function renderHelmetSlot(helmSlotAvailable: boolean) {
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
      cfg: { playerClass: 'rogue' },
      player: { name: 'Aurelia', level: 60, skin: 0 },
      equipment: {},
      honor: 0,
      archetypeTitle: null,
      hobbyCraft: null,
      professionsState: { skills: [] },
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
      helmSlotAvailable: () => helmSlotAvailable,
      helmHidden: () => false,
      toggleHelm: vi.fn(),
      playtimeVisible: () => true,
      togglePlaytimeVisible: vi.fn(),
      itemIcon: () => '',
      moneyHtml: () => '',
      wornItemTooltip: () => '',
      attachTooltip: vi.fn(),
    });
    win.render();
    return root;
  }

  it('omits the eye for a class kit with no head piece to hide (issue: hide helmet does nothing)', () => {
    const root = renderHelmetSlot(false);
    expect(root.querySelector('.equip-helm-eye')).toBeNull();
  });

  it('shows the eye for a class kit that has a head piece', () => {
    const root = renderHelmetSlot(true);
    expect(root.querySelector('.equip-helm-eye')).not.toBeNull();
  });
});

describe('char_window: profession art placements', () => {
  it('renders gathering rows through the art-or-procedural icon resolver', () => {
    // professionIconUrl, not professionImageUrl: the resolver that falls back
    // to the procedural composer, so a pending-art profession still paints
    // (the five-icon render test below pins the behavior; this pins the seam).
    expect(painter).toMatch(/professionIconUrl\(`gather_\$\{r\.professionId\}`, 56\)/);
    expect(painter).toContain('class="char-gather-icon"');
    expect(painter).toContain('class="char-gather-row"');
  });

  it('shows the current pair crest inline without inventing a tiny tooltip target', () => {
    expect(painter).toContain('archetypeImageUrl(world.archetypeTitle)');
    expect(painter).toContain('class="char-archetype-title-crest"');
    expect(painter).not.toContain('class="char-archetype-tooltip-crest"');
    expect(painter).toContain('alt=""');
  });

  it('paints the exact gathering, Honor, and archetype identities', () => {
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
      honor: 187,
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
          { professionId: 'farming', skill: 0, maxSkill: 100 },
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
      helmSlotAvailable: () => true,
      helmHidden: () => false,
      toggleHelm: vi.fn(),
      playtimeVisible: () => true,
      togglePlaytimeVisible: vi.fn(),
      itemIcon: () => '',
      moneyHtml: () => '',
      wornItemTooltip: () => '',
      attachTooltip,
    });

    win.render();
    const honorBalance = root.querySelector<HTMLElement>('.char-honor-balance');
    expect(honorBalance?.textContent).toContain('187');
    expect(
      [...(honorBalance?.querySelectorAll<HTMLImageElement>('img') ?? [])].map((img) => ({
        className: img.className,
        src: img.getAttribute('src'),
        alt: img.getAttribute('alt'),
        draggable: img.getAttribute('draggable'),
      })),
    ).toEqual([
      {
        className: 'currency-inline currency-honor',
        src: '/ui/currency/honor.webp',
        alt: '',
        draggable: 'false',
      },
    ]);
    expect(
      [...root.querySelectorAll<HTMLImageElement>('.char-gather-icon')].map((img) =>
        img.getAttribute('src'),
      ),
    ).toEqual([
      '/ui/professions/gather_mining.webp',
      '/ui/professions/gather_logging.webp',
      '/ui/professions/gather_herbalism.webp',
      '/ui/professions/gather_fishing.webp',
      '/ui/professions/gather_farming.webp',
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
      helmSlotAvailable: () => true,
      helmHidden: () => false,
      toggleHelm: vi.fn(),
      playtimeVisible: () => true,
      togglePlaytimeVisible: vi.fn(),
      itemIcon: () => '',
      moneyHtml: () => '',
      wornItemTooltip: () => '',
      attachTooltip: vi.fn(),
    });

    win.render();
    const values = [...root.querySelectorAll('.char-gather-row b')].map((b) => b.textContent);
    // The row renders a BOUNDED "skill / max", never a bare integer. The floor
    // still holds (99.75 and 99.5 read 99, never a fake crossed 100), and
    // fishing's denominator is its own 200 cap, not the 100 the other four
    // share. Farming's untouched "0 / 100" tail is load-bearing: a gathering id
    // missing from GATHERING_PROFESSION_NAME_KEYS renders NO row at all, so
    // this list length is what catches the silent drop on a fifth profession.
    expect(values).toEqual(['99 / 100', '12 / 100', '100 / 100', '99 / 200', '0 / 100']);
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
    // The instances argument rides along since phase 13 so each socket row can
    // describe the worn COPY (color and chosen name).
    expect(painter).toContain(
      'buildPaperdollView(world.equipment, ITEMS, world.equipmentInstances)',
    );
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

  function makeWin(
    root: HTMLElement,
    extra: { world?: Record<string, unknown>; deps?: Record<string, unknown> } = {},
  ): CharWindow {
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
      ...extra.world,
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
      helmSlotAvailable: () => true,
      helmHidden: () => false,
      toggleHelm: vi.fn(),
      playtimeVisible: () => true,
      togglePlaytimeVisible: vi.fn(),
      itemIcon: () => 'data:image/png;base64,stub',
      moneyHtml: () => '',
      wornItemTooltip: () => '',
      attachTooltip: vi.fn(),
      // A test's own recording deps win over the stubs above.
      ...(extra.deps as object),
    });
  }

  it('the own worn row, tooltip, and unequip aria all read the FULL worn copy (both hosts)', () => {
    // The phase 13 QA parity finding, pinned behaviorally: the paperdoll
    // tooltip closure must read IWorld.equipmentInstances (full on both
    // hosts, `perfected` included) rather than the self entity mirror, which
    // online is the eqi-trimmed peer projection and dropped the Unique-Equipped
    // tag on one host only. The rig's world carries BOTH: the full worn copy
    // on equipmentInstances and the online-shaped eqi-trimmed self entity
    // mirror (no `perfected`, no bond), so a painter that reached for the
    // mirror would hand the tooltip a copy WITHOUT the stamp and fail the
    // whole-payload assertion below, rather than passing by absence.
    canvasStub();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const tooltips: unknown[] = [];
    const attached: { el: HTMLElement; build: () => string }[] = [];
    try {
      const win = makeWin(root, {
        world: {
          playerId: 1,
          equipment: { neck: 'wyrmfall_pendant' },
          equipmentInstances: {
            neck: {
              perfected: true,
              rolled: { quality: 'legendary', stats: { int: 2 } },
              name: 'Dawn Oath',
              boundTo: 1,
              signer: 'Forger',
            },
          },
          entities: new Map([
            [
              1,
              {
                id: 1,
                equippedInstances: {
                  neck: {
                    rolled: { quality: 'legendary', stats: { int: 2 } },
                    name: 'Dawn Oath',
                    signer: 'Forger',
                  },
                },
              },
            ],
          ]),
        },
        deps: {
          wornItemTooltip: (_item: unknown, instance: unknown) => {
            tooltips.push(instance);
            return '';
          },
          attachTooltip: (el: HTMLElement, build: () => string) => {
            attached.push({ el, build });
          },
        },
      });
      win.render();
      const row = root.querySelector<HTMLElement>('#equip-slot-neck');
      expect(row, 'the neck socket rendered').not.toBeNull();
      // The row label is the chosen name in legendary orange (the cell authority).
      const label = row?.querySelector<HTMLElement>('.slot-item') ?? null;
      expect(label?.textContent).toBe('Dawn Oath');
      expect(label?.style.color.replace(/\s/g, '')).toBe('#ff8000');
      // The unequip control hears the chosen name (a t() VALUE), never only the def.
      const unequip = row?.querySelector<HTMLElement>('.equip-unequip-btn') ?? null;
      expect(unequip?.getAttribute('aria-label')).toContain('Dawn Oath');
      // The tooltip closure hands the widened dep the wornTooltipInstance
      // projection of the FULL copy: name and the self-only `perfected` stamp
      // kept (the unique tag's input), the bond dropped.
      const hover = attached.find((a) => a.el === row);
      expect(hover, 'the row attached a tooltip').toBeDefined();
      hover?.build();
      expect(tooltips).toEqual([
        {
          signer: 'Forger',
          rolled: { quality: 'legendary', stats: { int: 2 } },
          name: 'Dawn Oath',
          perfected: true,
        },
      ]);
    } finally {
      document.body.removeChild(root);
    }
  });

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

  it('clears every stale socket highlight when the dragged copy leaves the bags', () => {
    canvasStub();
    const root = document.createElement('div');
    const inventory = [
      {
        itemId: 'warhewn_signet',
        count: 1,
        instance: { signer: 'Aurelia' },
      },
      { itemId: 'warhewn_signet', count: 1 },
    ];
    const dragState = new ItemDragState();
    const win = makeWin(root, {
      world: { inventory },
      deps: { dragState },
    });
    win.render();

    dragState.begin({
      itemId: 'warhewn_signet',
      count: 1,
      index: 0,
      copyPin: itemCopyPin(inventory[0]),
    });
    win.markDropTargets('warhewn_signet', 0);
    expect(root.querySelectorAll('.equip-slot.drop-target')).toHaveLength(2);

    // A snapshot moves the exact copy, then rebuilds the character sheet after
    // the bags window synchronizes the old sockets. The rebuilt sockets must
    // restore the live exact-copy hints, including on touch with no dragover.
    inventory.reverse();
    win.render();
    expect(root.querySelectorAll('.equip-slot.drop-target')).toHaveLength(2);
    const ring1 = root.querySelector<HTMLElement>('#equip-slot-ring1');

    // A later snapshot removes the signed copy while an indistinguishable base-id
    // neighbor shifts into its old cell. Revalidation must still reject the
    // drop, and its visual promise must be withdrawn at the same time.
    inventory.splice(1, 1);
    const dragover = new Event('dragover', { bubbles: true, cancelable: true });
    ring1?.dispatchEvent(dragover);

    expect(dragover.defaultPrevented).toBe(false);
    expect(root.querySelectorAll('.equip-slot.drop-target')).toHaveLength(0);

    // A sheet rebuild must not resurrect the hints on its newly minted rows.
    win.render();
    expect(root.querySelectorAll('.equip-slot.drop-target')).toHaveLength(0);
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
      helmSlotAvailable: () => true,
      helmHidden: () => false,
      toggleHelm: vi.fn(),
      playtimeVisible: () => visible,
      togglePlaytimeVisible,
      itemIcon: () => '',
      moneyHtml: () => '',
      wornItemTooltip: () => '',
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

describe('char_window: the socket row consumes the worn payload (source pins)', () => {
  // Moved here from tests/char_view.test.ts beside the painter's other pins
  // (they pin char_window.ts source, not the pure core). The row's color,
  // name, and icon-rim reads are plain string interpolations no behavioral
  // suite reaches (the sheet needs a real DOM world), so the wiring is pinned
  // at the source: the effective-quality resolver feeds the row color AND the
  // icon's q-<quality> class, the chosen-name fallback feeds the line, and
  // the unequip aria hears the same worn name.
  const src = painter.replace(/^\s*\/\/.*$/gm, '');

  it('threads instances into the view build and the row reads them through the one cell authority', () => {
    // The triple (name, quality, color) comes from worn_item_cell_view.ts, the
    // shared authority the inspect row and the player card read too (the
    // phase 13 QA rule-of-three extraction); the row never re-derives it.
    expect(src).toContain('const parts = item ? wornItemCellParts(item, instance) : null;');
    expect(src).toContain('const wornName = parts ? parts.name : null;');
    expect(src).not.toContain('tooltipEffectiveQuality(');
  });

  it('drives the socket icon rim off the same instance-effective quality, through the icon dep', () => {
    // The orange-glow-purple-rim fix: the icon paints through the widened
    // PainterHost itemIcon dep with the cell's own effective quality (the
    // injected seam, never a direct import that bypasses it).
    expect(src).toContain('this.deps.itemIcon(item, parts?.quality)');
    expect(src).not.toContain('knownItemIconHtml');
  });

  it('the unequip aria interpolates the worn-copy name as a t() value', () => {
    expect(src).toContain(
      "t('hudChrome.paperdoll.unequipAria', { item: wornName ?? itemDisplayName(item) })",
    );
  });

  it('maps the stale-selection refusal onto the sim-worded noItem toast', () => {
    expect(src).toContain("case 'blockedSelection':");
    expect(src).toContain("this.deps.showError(tSim('error.noItem'));");
  });
});

describe('char_window: own-paperdoll per-copy tooltip threading', () => {
  it('resolves the worn instance from IWorld.equipmentInstances inside the tooltip closure', () => {
    // The owner's FULL worn map on both hosts (offline the live meta, online
    // the einst self mirror), read per slot at hover time (a closure over
    // deps.world(), never a stale capture) and forwarded into the widened
    // itemTooltip dep. NOT the self ENTITY mirror: online that is the
    // eqi-trimmed peer projection, which drops `perfected`, so a promoted
    // copy's own Unique-Equipped tag vanished on one host only (the phase 13
    // QA parity finding). Dropping either line reverts the own paperdoll to
    // def-only tooltips while every pure-core suite stays green.
    // Comment-stripped: a pin over raw source is satisfied by a comment that
    // quotes the line (the source-text pin trap), so the code alone answers.
    const painterCode = painter
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    expect(painterCode).toContain('wornTooltipInstance(world.equipmentInstances?.[slot])');
    expect(painterCode).toContain('this.deps.wornItemTooltip(item, instance)');
    expect(painterCode).not.toContain('world.entities.get(world.playerId)?.equippedInstances');
  });
});

describe('char_window: the Masterwrought cap visibility family (phase 14)', () => {
  // Behavioral: the real CharWindow rendered over happy-dom, replacing the
  // raw-source pins that a comment quoting the line would have satisfied
  // (the source-text pin trap; the sibling describe above strips comments
  // for exactly that reason, and these had not).
  type SheetWorld = { equipment: Record<string, string> };
  function renderSheet(equipment: Record<string, string>) {
    const root = document.createElement('div');
    const tips: Array<{ el: Element; resolve: () => string }> = [];
    const world = {
      cfg: { playerClass: 'warrior' },
      player: { name: 'Aurelia', level: 60, skin: 0 },
      equipment,
      equipmentInstances: {},
      honor: 0,
      archetypeTitle: null,
      hobbyCraft: null,
      professionsState: { skills: [] },
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
      helmSlotAvailable: () => true,
      helmHidden: () => false,
      toggleHelm: vi.fn(),
      playtimeVisible: () => true,
      togglePlaytimeVisible: vi.fn(),
      itemIcon: () => '',
      moneyHtml: () => '',
      wornItemTooltip: () => 'deftip',
      attachTooltip: (el: Element, resolve: () => string) => tips.push({ el, resolve }),
    });
    win.render();
    return { root, tips, world: world as SheetWorld };
  }

  it('the slots row shows the live used count and hides entirely at zero worn', () => {
    // Zero worn: no row at all (before endgame the cap never binds, and a
    // standing "0 / 2" row would be noise on every sheet).
    expect(renderSheet({}).root.querySelector('.char-mw-slots')).toBeNull();
    // One worn, then two: the EXACT "{used} / {cap}" value tracks the flag
    // walk (a substring check on '2' was satisfied by the cap in '1 / 2', so
    // a frozen used-count survived it).
    const one = renderSheet({ mainhand: 'duskforged_warblade' });
    expect(one.root.querySelector('.char-mw-slots-value')?.textContent).toBe('1 / 2');
    const two = renderSheet({ mainhand: 'duskforged_warblade', offhand: 'duskforged_bulwark' });
    expect(two.root.querySelector('.char-mw-slots-value')?.textContent).toBe('2 / 2');
    expect(two.root.querySelector('.char-mw-slots-label')?.textContent?.length).toBeGreaterThan(0);
  });

  it('the worn-piece diamond renders on the flagged slot only, with an accessible name', () => {
    // A plain (unflagged) piece worn beside the Masterwrought one: the chip
    // must gate on the def flag, so exactly one chip renders and it sits on
    // the flagged slot (a chip-on-every-worn-item regression reds here).
    const plainChest = Object.values(ITEMS).find(
      (def) => def.kind === 'armor' && def.slot === 'chest' && !def.masterwrought,
    );
    expect(plainChest).toBeDefined();
    if (!plainChest) throw new Error('missing plain chest fixture');
    const { root } = renderSheet({ mainhand: 'duskforged_warblade', chest: plainChest.id });
    const chips = [...root.querySelectorAll('.equip-mw-chip')];
    expect(chips.length).toBe(1);
    const chip = chips[0] as HTMLElement;
    expect(chip.closest('#equip-slot-mainhand')).not.toBeNull();
    expect(root.querySelector('#equip-slot-chest .equip-mw-chip')).toBeNull();
    expect(chip.getAttribute('role')).toBe('img');
    expect(chip.getAttribute('aria-label')?.length).toBeGreaterThan(0);
  });

  it('the worn tooltip adds the occupies-a-slot line with the LIVE count at hover time', () => {
    const { root, tips, world } = renderSheet({ mainhand: 'duskforged_warblade' });
    const row = root.querySelector('#equip-slot-mainhand') as Element;
    const tip = tips.find((entry) => entry.el === row);
    expect(tip).toBeDefined();
    if (!tip) throw new Error('missing mainhand tooltip fixture');
    const atOne = tip.resolve();
    expect(atOne).toContain('deftip');
    expect(atOne).toContain('1');
    // The count resolves inside the closure, off the LIVE world: equipping a
    // second piece between hovers moves the line with no re-render (an eager
    // render-time count would serve the stale "1 of 2" byte-identically).
    world.equipment.offhand = 'duskforged_bulwark';
    const atTwo = tip.resolve();
    expect(atTwo).not.toBe(atOne);
    expect(atTwo).toContain('2');
  });
});

describe('char_window: forced-colors Masterwrought marker', () => {
  it('keeps the worn-piece diamond visible when author colors are suppressed', () => {
    const css = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8');
    expect(css).toMatch(
      /@media\s*\(forced-colors: active\)\s*\{\s*\.equip-mw-chip \{[^}]*border:\s*1px solid CanvasText;/,
    );
  });
});

describe('char_window: production worn-tooltip wiring', () => {
  it('disables comparison when Hud wires a worn-slot tooltip', () => {
    const hud = readFileSync(join(__dirname, '../src/ui/hud.ts'), 'utf8');
    const start = hud.indexOf('private readonly charWindow = new CharWindow({');
    const wiring = hud.slice(start, hud.indexOf('\n  });', start));
    expect(start).toBeGreaterThan(-1);
    expect(wiring).toContain(
      'wornItemTooltip: (item, instance) => this.itemTooltip(item, false, instance)',
    );
  });
});
