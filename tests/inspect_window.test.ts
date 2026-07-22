import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The inspect ("Profile") window painter is a DOM module; this is the no-DOM
// equivalent of the char_window painter suite. It pins the WCAG focus-trap the
// extraction ADDED (the old inline inspect path had none), the token/reuse
// discipline, and that the painter reaches Hud only through injected deps (no Hud
// import, no Sim reference).
const painter = readFileSync(new URL('../src/ui/inspect_window.ts', import.meta.url), 'utf8');

describe('inspect_window: WCAG 2.2 AA focus trap (new to the extraction)', () => {
  it('marks #inspect-window a labelled dialog via the shared markDialogRoot helper', () => {
    // Same helper + pattern the other trapped windows use (leaderboard_window,
    // bank_window), keyed to the panel title span id.
    expect(painter).toContain('markDialogRoot');
    expect(painter).toContain("markDialogRoot(el, { labelledBy: 'inspect-window-title' })");
    expect(painter).toContain('id="inspect-window-title"');
  });

  it('captures the opener on open and restores focus to it on close', () => {
    expect(painter).toContain('this.deps.captureFocus()');
    expect(painter).toContain('this.deps.restoreFocus(this.openerFocus)');
    const close = painter.slice(painter.indexOf('close(): void {'));
    expect(close).toContain('this.deps.restoreFocus(this.openerFocus)');
  });

  it('applies the trap to BOTH the rich and the remote-profile paths', () => {
    const openInspect = painter.slice(painter.indexOf('openInspect('));
    const openRemote = painter.slice(painter.indexOf('openRemote('));
    expect(openInspect).toContain('markDialogRoot(el');
    expect(openRemote.slice(0, openRemote.indexOf('private '))).toContain('markDialogRoot(el');
  });
});

describe('inspect_window: thin painter, deps-only Hud access', () => {
  it('imports no Sim / Hud / render layer and no Three', () => {
    expect(painter).not.toMatch(/from\s+['"]\.\.\/render\//);
    expect(painter).not.toMatch(/from\s+['"]three['"]/);
    expect(painter).not.toMatch(/\bCharacterPreview\b/);
    expect(painter).not.toMatch(/from\s+['"]\.\/hud['"]/);
  });

  it('mounts the shared turntable through a dep, never constructing it here', () => {
    expect(painter).toContain('this.deps.mountPreview(');
  });

  it('feeds the inspected entity weapon skin to the turntable mount (Armory cosmetics)', () => {
    // The wire wsk field is the SERVER-resolved active skin the world renders
    // for that player; the inspect paperdoll must pass it through or a
    // purchased skin silently vanishes on inspect.
    expect(painter).toContain('weaponSkinId: e.weaponSkinId ?? null');
  });

  it('feeds the entity skin catalog to the pure core and the turntable mount (mech rigs)', () => {
    // Remote entities carry skinCatalog on the wire (the `cat` identity field); the
    // mount must see it or a mech-cosmetic player renders as a class rig wearing a
    // mech-catalog skin INDEX (the wrong skin entirely).
    expect(painter).toContain("skinCatalog: e.skinCatalog ?? 'class'");
    expect(painter).toContain('skinCatalog: model.skinCatalog');
  });

  it('reuses the shared socket-row family and quality-glow helper (no forked copies)', () => {
    expect(painter).toContain("row.className = 'equip-slot'");
    expect(painter).toContain('qualityGlowShadow(qColor)');
    expect(painter).toContain("from './quality_glow'");
    // Gear + badge decisions come from the pure inspect_view core.
    expect(painter).toContain('buildInspectView(');
    expect(painter).toContain('buildInspectRemoteView(');
  });

  it('carries no raw color literal (quality/class colors come from data + helpers)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to data/CSS: ${hex.join(', ')}`).toEqual([]);
  });
});
