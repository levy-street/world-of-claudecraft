import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source-level guards for the talents painter. The window paints DOM (not a Canvas),
// so its colors flow through inline `var(--color-*)` references rather than a
// getComputedStyle resolve; the contract is the same: NO raw hex survives
// in the painter, the accents reference design tokens, and those tokens exist in the
// sheet. The DOM painting itself is covered by the byte-faithful extraction (the pure
// core is unit-tested in talents_view.test.ts; the painter markup mirrors the prior
// inline hud.ts code).
const painter = readFileSync(new URL('../src/ui/talents_window.ts', import.meta.url), 'utf8');

describe('talents_window: no magic values', () => {
  it('carries no literal hex color in TS (colors flow through --color-* tokens)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens: ${hex.join(', ')}`).toEqual([]);
  });

  it('drives the accent colors through CSS custom properties', () => {
    // The tree arrows died with the point trees (Talents 2.0 flip); the surviving
    // palette is the spec cards + Choices tab accents.
    for (const token of ['var(--color-talent-dormant)', 'var(--color-text-muted)', 'var(--gold)']) {
      expect(painter, `expected ${token}`).toContain(token);
    }
  });

  it('defines the talent color tokens it reads in the design-token sheet', () => {
    const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
    for (const tok of [
      '--color-talent-arrow',
      '--color-talent-arrow-dim',
      '--color-talent-opt-dim',
      '--color-talent-hint',
      '--color-talent-req',
      '--color-talent-dormant',
    ]) {
      expect(tokens, `missing ${tok}`).toContain(`${tok}:`);
    }
  });

  it('uses no em or en dashes (ASCII separators only)', () => {
    expect(painter.includes('—'), 'em dash found').toBe(false);
    expect(painter.includes('–'), 'en dash found').toBe(false);
  });

  // The warrior-overhaul window rework (2dc432c4a) moved the Choices rows out of the
  // painter into talent_rows_tab.ts and replaced the div-radio + roving-tabindex wiring
  // with NATIVE <button> options (tabbable and Enter/Space-activatable for free), so the
  // keyboard contract is now: real buttons, pressed state, a full accessible name (name +
  // description), and locked rows disabled.
  it('renders Choices row options as native buttons with pressed state and accessible names', () => {
    const rowsTab = readFileSync(new URL('../src/ui/talent_rows_tab.ts', import.meta.url), 'utf8');
    expect(painter).toContain('paintTalentRowsTab(body, rowsVm, {');
    expect(rowsTab).toContain('`<button type="button" class="tal-row-opt${o.picked ?');
    expect(rowsTab).toContain('aria-pressed="${o.picked}"');
    expect(rowsTab).toContain('aria-label="${esc(aria)}"');
    expect(rowsTab).toContain("${row.unlocked && !o.pending ? '' : 'disabled'}");
    expect(rowsTab).toContain('deps.pickRow(rowIndex, wasPicked ? null : optId);');
  });

  // The spec-commit fix: ALL TEN classes (the overhauled 'warrior' included,
  // operator decision 2026-07-11) commit an uncommitted spec through
  // deps.commitSpec (IWorld.setSpec via Hud) from the Select specialization
  // button; the committed spec keeps the navigation-only View talents button.
  // Behavior is pinned functionally in talents_window_spec_commit.test.ts; these
  // pins keep the source shape (the gate + the two labels + the dep) from drifting.
  it('gates the spec commit on the committed allocation only (no class exclusion)', () => {
    expect(painter).toContain('const committed = this.deps.currentAllocation().spec === sp.id;');
    expect(painter).toContain('const commits = !committed;');
    expect(painter).not.toContain("cls !== 'warrior'");
    expect(painter).toContain('if (commits) this.deps.commitSpec(sp.id);');
  });

  it('reads both button labels from the specPanel catalog keys', () => {
    expect(painter).toContain("t('hudChrome.specPanel.selectSpec')");
    expect(painter).toContain("t('hudChrome.specPanel.viewTalents')");
  });
});
