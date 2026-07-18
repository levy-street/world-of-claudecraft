import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source-level guards for the Talents V2 painter. DOM behavior is exercised in the
// browser suite; these checks keep the painter on canonical allocation/world APIs and
// prevent the removed point-tree staging model from creeping back in.
const painter = readFileSync(new URL('../src/ui/talents_window.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');

describe('talents_window: no magic values', () => {
  it('carries no literal hex color in TS (colors flow through --color-* tokens)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens: ${hex.join(', ')}`).toEqual([]);
  });

  it('drives row and accent colors through CSS custom properties', () => {
    // The tree arrows died with the point trees (Talents 2.0 flip); the surviving
    // palette is the choice rows plus the spec cards + Choices tab accents.
    for (const token of [
      'var(--color-talent-opt-dim)',
      'var(--color-talent-hint)',
      'var(--gold)',
    ]) {
      expect(painter, `expected ${token}`).toContain(token);
    }
    expect(styles).toContain('var(--color-text-muted)');
  });

  it('defines the talent color tokens it reads in the design-token sheet', () => {
    const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
    for (const tok of ['--color-talent-opt-dim', '--color-talent-hint']) {
      expect(tokens, `missing ${tok}`).toContain(`${tok}:`);
    }
  });

  it('uses the canonical authoritative row-selection bridge without local staging', () => {
    expect(painter).toContain('this.deps.currentAllocation()');
    expect(painter).toContain('this.deps.commitSpec(entry.spec.id)');
    expect(painter).toContain('this.deps.selectRow(');
    expect(painter).toContain('AUTHORITATIVE_REFRESH_MS');

    for (const removed of [
      'getStage',
      'setStage',
      'stage.ranks',
      'stage.rows',
      'rowPicks',
      'pickRow',
    ]) {
      expect(painter, `removed point-tree/staging token survived: ${removed}`).not.toContain(
        removed,
      );
    }
  });

  it('renders accessible choice rows and explicit spec actions', () => {
    // Spec cards are a keyboard radiogroup (click/Enter commits); View talents
    // is the explicit navigate action. The radio control is the panel HEAD, not
    // the panel, so the focusable button/tiles inside the panel are not nested
    // in an interactive element (axe nested-interactive).
    expect(painter).toContain("grid.setAttribute('role', 'radiogroup');");
    expect(painter).toContain("head.setAttribute('role', 'radio');");
    expect(painter).toContain("head.setAttribute('aria-checked', String(entry.selected));");
    expect(painter).toContain("t('hudChrome.specPanel.viewTalents')");
    expect(styles).toContain('.tal-rows');
    expect(styles).toContain('.tal-row-opts');
    expect(styles).toContain('.tal-row-opt.picked');
    expect(styles).toContain('.tal-row-opt:focus-visible');
  });

  it('uses no em or en dashes (ASCII separators only)', () => {
    expect(painter.includes('—'), 'em dash found').toBe(false);
    expect(painter.includes('–'), 'en dash found').toBe(false);
  });

  it('un-zooms the fitBodyToWindow rect measurements by the live UI Scale before writing an author-space cap', () => {
    // fitBodyToWindow reads getBoundingClientRect() (visual/zoomed px under #ui's
    // `zoom: var(--ui-scale)`) but writes body.style.maxHeight (author px, which the
    // browser re-multiplies by that same zoom). Regression guard for the bug where
    // the cap came out ~47px too generous at uiScale 0.85 and clipped the foot panel
    // again, or ~120px too small at uiScale 1.4.
    expect(painter).toContain("import { getUiScale } from './ui_scale';");
    expect(painter).toMatch(/const uiScale = getUiScale\(\);/);
    expect(painter).toMatch(/bodyTop =\s*\([\s\S]*?\) \/ uiScale;/);
    expect(painter).toMatch(/footHeight = foot\.getBoundingClientRect\(\)\.height \/ uiScale;/);
  });

  it('commits a spec pick to the world (not just the local stage)', () => {
    // Regression pin: clicking a spec card must reach IWorld.setSpec. Before
    // this, the pick only mutated the staged buffer, so the spec (its kit,
    // signature, and mastery) never actually applied unless the player took
    // the save-a-loadout detour.
    expect(painter).toContain('commitSpec(specId: string): void;');
    expect(painter).toContain('this.deps.commitSpec(entry.spec.id);');
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    expect(hud).toContain('commitSpec: (specId) => this.sim.setSpec(specId),');
  });
});

describe('talents_window: WAI-ARIA spec/rows tabs', () => {
  // The spec/rows tab strip's markup and roving Arrow/Home/End + Enter/Space
  // wiring now come from the shared tab_strip_view.ts / tab_strip_painter.ts
  // building block (their own contracts are pinned in tab_strip_view.test.ts /
  // tab_strip_painter.test.ts), the same modules social_window.ts composes for
  // its plain-button strip. This pins that talents_window composes them with
  // its button-tag + picked-count-badge shape instead of hand-rolling the
  // markup or the keyboard handler itself.
  it('builds its tab strip from the shared tab_strip_view / tab_strip_painter modules', () => {
    expect(painter).toContain("from './tab_strip_view'");
    expect(painter).toContain("from './tab_strip_painter'");
    expect(painter).toContain('tabStripHtml(');
    expect(painter).toContain('tabStripModel(');
    expect(painter).toContain('wireTabStrip(');
    expect(painter).toContain("panelId: 'tal-body'");
    expect(painter).toContain("stripClass: 'tal-tabs'");
    expect(painter).toContain("tabClass: 'tal-tab'");
    expect(painter).toContain("selectedClass: 'active'");
    expect(painter).toContain("id: 'spec',");
    expect(painter).toContain("id: 'rows',");
  });

  it('refocuses the newly active tab only on a keyboard move, matching the shared wiring contract', () => {
    expect(painter).toContain('(id, focusFollow) => {');
    expect(painter).toContain('if (focusFollow) focusActiveTab(root,');
  });
});
