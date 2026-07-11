import { describe, expect, it } from 'vitest';
import type { CategoryId } from '../src/ui/options_ia';
import {
  atRoot,
  currentLevel,
  depth,
  initialNav,
  LANDING_LEVEL,
  levelSelection,
  MOBILE_LANDING_ORDER,
  type MobileNavState,
  mobileCategoryRows,
  mobileSettingsMode,
  navForSelection,
  openCategory,
  openSubView,
  popClosesMenu,
  popLevel,
  pushLevel,
} from '../src/ui/options_mobile_shell_view';

const TOUCH = { touch: true, nativeShell: false };
const DESKTOP = { touch: false, nativeShell: false };
const NATIVE = { touch: true, nativeShell: true };

const noCount = (_id: CategoryId) => 0;
const noConflict = (_id: CategoryId) => false;

// ---------------------------------------------------------------------------
// Back-stack reducers
// ---------------------------------------------------------------------------
describe('options_mobile_shell_view: back-stack navigation', () => {
  it('opens rooted at the landing (level 0)', () => {
    const nav = initialNav();
    expect(currentLevel(nav)).toEqual(LANDING_LEVEL);
    expect(depth(nav)).toBe(0);
    expect(atRoot(nav)).toBe(true);
    // A pop request at the landing closes the menu.
    expect(popClosesMenu(nav)).toBe(true);
  });

  it('pushes a category to level 1 (a pop no longer closes)', () => {
    const nav = pushLevel(initialNav(), { kind: 'category', id: 'audio' });
    expect(currentLevel(nav)).toEqual({ kind: 'category', id: 'audio' });
    expect(depth(nav)).toBe(1);
    expect(atRoot(nav)).toBe(false);
    expect(popClosesMenu(nav)).toBe(false);
  });

  it('pushes a sub-view to level 2 over its parent category', () => {
    const nav = openSubView(initialNav(), 'bugreport', 'system');
    expect(depth(nav)).toBe(2);
    expect(currentLevel(nav)).toEqual({ kind: 'subview', view: 'bugreport', parent: 'system' });
    expect(popClosesMenu(nav)).toBe(false);
  });

  it('pops one level (deeper -> shallower), never emptying below the landing', () => {
    const deep = openSubView(initialNav(), 'bugreport', 'system');
    const atCategory = popLevel(deep);
    expect(currentLevel(atCategory)).toEqual({ kind: 'category', id: 'system' });
    expect(depth(atCategory)).toBe(1);
    const atLanding = popLevel(atCategory);
    expect(atLanding.stack).toHaveLength(1);
    expect(atRoot(atLanding)).toBe(true);
    // Popping at the landing is a no-op (the caller closes the menu instead).
    const stillLanding = popLevel(atLanding);
    expect(stillLanding.stack).toHaveLength(1);
    expect(currentLevel(stillLanding)).toEqual(LANDING_LEVEL);
  });

  it('openCategory always yields a single level-1 page regardless of prior depth', () => {
    const deep = openSubView(initialNav(), 'bugreport', 'system');
    const opened = openCategory(deep, 'graphics');
    expect(opened.stack).toHaveLength(2);
    expect(opened.stack[0]).toEqual(LANDING_LEVEL);
    expect(currentLevel(opened)).toEqual({ kind: 'category', id: 'graphics' });
    expect(depth(opened)).toBe(1);
  });

  it('reducers are immutable (never mutate the input state)', () => {
    const nav: MobileNavState = initialNav();
    const before = nav.stack.length;
    pushLevel(nav, { kind: 'category', id: 'interface' });
    openCategory(nav, 'interface');
    popLevel(nav);
    expect(nav.stack.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// level -> (activeCategory, subView) mapping (drives the reused body renderers)
// ---------------------------------------------------------------------------
describe('options_mobile_shell_view: level selection mapping', () => {
  it('maps the landing to Overview, a category to itself, a sub-view to its parent + view', () => {
    expect(levelSelection(LANDING_LEVEL)).toEqual({ category: 'overview', subView: 'none' });
    expect(levelSelection({ kind: 'category', id: 'controller' })).toEqual({
      category: 'controller',
      subView: 'none',
    });
    expect(levelSelection({ kind: 'subview', view: 'bugreport', parent: 'system' })).toEqual({
      category: 'system',
      subView: 'bugreport',
    });
  });
});

// ---------------------------------------------------------------------------
// The env-gated category list
// ---------------------------------------------------------------------------
describe('options_mobile_shell_view: category list env gating', () => {
  it('excludes Overview (it is the landing) and lists the touch categories in rail order', () => {
    const rows = mobileCategoryRows(TOUCH, noCount, noConflict).map((r) => r.id);
    expect(rows).not.toContain('overview');
    // Display, then Input, then System groups, flattened. Keybinds is desktop-only
    // (hidden on touch); the touch-only Touch category and the Controller category
    // both appear (Bluetooth pads are real on mobile).
    expect(rows).toEqual([
      'graphics',
      'interface',
      'accessibility',
      'controls',
      'controller',
      'touch',
      'audio',
      'system',
    ]);
    expect(rows).not.toContain('keybinds');
    expect(rows).toContain('touch');
    expect(rows).toContain('controller');
  });

  it('mirrors the desktop rail gating: Keybinds shows on desktop, Touch hides', () => {
    const rows = mobileCategoryRows(DESKTOP, noCount, noConflict).map((r) => r.id);
    expect(rows).toContain('keybinds');
    expect(rows).not.toContain('touch');
  });

  it('keeps the touch categories under the native app shell too', () => {
    const rows = mobileCategoryRows(NATIVE, noCount, noConflict).map((r) => r.id);
    expect(rows).toContain('touch');
    expect(rows).not.toContain('keybinds');
  });

  it('wires the per-category changed count and conflict dot from the callbacks', () => {
    const rows = mobileCategoryRows(
      TOUCH,
      (id) => (id === 'audio' ? 4 : 0),
      (id) => id === 'controller',
    );
    const audio = rows.find((r) => r.id === 'audio');
    const controller = rows.find((r) => r.id === 'controller');
    expect(audio?.changedCount).toBe(4);
    expect(audio?.hasConflict).toBe(false);
    expect(controller?.changedCount).toBe(0);
    expect(controller?.hasConflict).toBe(true);
  });

  it('carries each category icon slug + label/subhead keys for the row painter', () => {
    const rows = mobileCategoryRows(TOUCH, noCount, noConflict);
    const graphics = rows.find((r) => r.id === 'graphics');
    expect(graphics?.iconSlug).toBe('display');
    expect(graphics?.nameKey).toBe('hud.options.graphics');
    expect(graphics?.subheadKey).toBe('hudChrome.options.ia.catGraphicsSub');
  });
});

// ---------------------------------------------------------------------------
// Landing section order (spec section 9)
// ---------------------------------------------------------------------------
describe('options_mobile_shell_view: landing section order', () => {
  it('leads with the search field then the category grid (the front page)', () => {
    // No quickActions slot: Reset to Defaults and Logout ride the grid as action
    // tiles, so the landing has no separate button row.
    expect(MOBILE_LANDING_ORDER).toEqual(['search', 'categoryList', 'alerts', 'pins', 'status']);
    const idx = (s: string) => MOBILE_LANDING_ORDER.indexOf(s as never);
    expect(idx('search')).toBe(0);
    // The category grid is the front page: directly under search, above the
    // alerts / pins / status that follow it.
    expect(idx('categoryList')).toBe(1);
    expect(idx('categoryList')).toBeLessThan(idx('pins'));
    expect(idx('pins')).toBeLessThan(idx('status'));
  });
});

// ---------------------------------------------------------------------------
// Render mode: the back-stack shell (grid landing) at every touch width. The
// desktop-style rail two-pane was retired on touch; the game is landscape-only
// on mobile, so one shell serves both orientations.
// ---------------------------------------------------------------------------
describe('options_mobile_shell_view: render mode by viewport width', () => {
  it('selects the back-stack shell at wide / landscape widths', () => {
    // Former rail widths (1000x600 landscape, 1280 tablet, 834) now use the shell.
    expect(mobileSettingsMode(1000)).toBe('backstack');
    expect(mobileSettingsMode(1280)).toBe('backstack');
    expect(mobileSettingsMode(834)).toBe('backstack');
  });

  it('selects the back-stack shell at narrow / portrait widths', () => {
    expect(mobileSettingsMode(400)).toBe('backstack');
    expect(mobileSettingsMode(390)).toBe('backstack');
  });

  it('never selects a rail two-pane, at any width', () => {
    for (const w of [0, 320, 719, 720, 721, 1440, 3000])
      expect(mobileSettingsMode(w)).toBe('backstack');
  });
});

// ---------------------------------------------------------------------------
// navForSelection: rebuild a back-stack nav from a desktop (category, subView)
// selection (so a live wide->narrow switch keeps the current page). The inverse
// of levelSelection over every representable back-stack shape.
// ---------------------------------------------------------------------------
describe('options_mobile_shell_view: navForSelection (desktop selection -> back-stack)', () => {
  it('maps the Overview landing to the level-0 landing nav', () => {
    expect(navForSelection('overview', 'none')).toEqual(initialNav());
  });

  it('maps a category to its level-1 page', () => {
    const nav = navForSelection('graphics', 'none');
    expect(currentLevel(nav)).toEqual({ kind: 'category', id: 'graphics' });
    expect(depth(nav)).toBe(1);
  });

  it('maps a sub-view to its level-2 page over the parent category', () => {
    const nav = navForSelection('system', 'bugreport');
    expect(currentLevel(nav)).toEqual({ kind: 'subview', view: 'bugreport', parent: 'system' });
    expect(depth(nav)).toBe(2);
  });

  it('round-trips with levelSelection for every representable back-stack shape', () => {
    for (const nav of [
      initialNav(),
      openCategory(initialNav(), 'audio'),
      openSubView(initialNav(), 'bugreport', 'system'),
    ]) {
      const sel = levelSelection(currentLevel(nav));
      expect(navForSelection(sel.category, sel.subView)).toEqual(nav);
    }
  });
});
