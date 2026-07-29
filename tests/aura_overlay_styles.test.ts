import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hudCss = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
const mobileCss = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');
const componentsCss = readFileSync(
  new URL('../src/styles/components.css', import.meta.url),
  'utf8',
);

describe('aura overlay placement styles', () => {
  it('keeps normalized positions viewport-relative on mobile', () => {
    expect(mobileCss).not.toMatch(
      /body\.mobile-touch\s+\.aura-overlay-frame\s*\{[^}]*\b(?:width|height)\s*:/s,
    );
  });

  it('protects touch dragging and renders the four-arrow move glyph', () => {
    expect(hudCss).toMatch(
      /#aura-overlays\.placement[\s\S]*?\.aura-overlay-arcs-shell\s*\{[^}]*touch-action:\s*none/s,
    );
    expect(hudCss).toMatch(/\.aura-overlay-move-handle\s*\{[^}]*touch-action:\s*none[^}]*\}/s);
    expect(hudCss).toContain(
      "d='M12%202l4%204h-3v5h5V8l4%204-4%204v-3h-5v5h3l-4%204-4-4h3v-5H6v3l-4-4%204-4v3h5V6H8l4-4z'",
    );
  });

  it('keeps every available aura translucent and mouse-selectable during placement', () => {
    expect(hudCss).toMatch(
      /#aura-overlays\.placement\s+\.aura-overlay-frame\.placement-preview\s*\{[^}]*opacity:\s*0\.28/s,
    );
    expect(hudCss).toMatch(
      /\.placement-preview\s+\.aura-overlay-icon[\s\S]*pointer-events:\s*auto/s,
    );
    expect(hudCss).toMatch(/#aura-overlays\.placement\s*\{[^}]*pointer-events:\s*auto/s);
    expect(hudCss).toMatch(/\.aura-overlay-arc\s*\{[^}]*pointer-events:\s*none/s);
  });

  it('scales aura blur with the static graphics shadow token', () => {
    expect(hudCss).toMatch(
      /drop-shadow\(\s*0 0 calc\(var\(--aura-glow-core\) \* var\(--fx-shadow,\s*1\)\) currentColor\s*\)/,
    );
    expect(hudCss).toMatch(
      /drop-shadow\(\s*0 0 calc\(var\(--aura-glow-halo\) \* var\(--fx-shadow,\s*1\)\) currentColor\s*\)/,
    );
    expect(hudCss).toMatch(
      /0 0 calc\(var\(--aura-glow-halo\) \* var\(--fx-shadow,\s*1\)\) currentColor/,
    );
  });

  it('places a non-interactive duration sweep and countdown over the spell icon', () => {
    expect(hudCss).toMatch(/\.aura-overlay-timer\s*\{[^}]*conic-gradient/s);
    expect(hudCss).toMatch(/\.aura-overlay-timer\s*\{[^}]*pointer-events:\s*none/s);
    expect(hudCss).toMatch(
      /\.aura-overlay-frame\.hide-icon\s+:is\(\.aura-overlay-icon,\s*\.aura-overlay-timer\)/s,
    );
  });

  it('ships a fallback theme for every supported class', () => {
    for (const playerClass of [
      'paladin',
      'hunter',
      'rogue',
      'priest',
      'shaman',
      'warlock',
      'druid',
    ]) {
      expect(hudCss).toMatch(new RegExp(`\\.aura-overlay-${playerClass}\\s*\\{[^}]*--aura-color:`));
    }
  });

  it('keeps the reposition toolbar background around wrapped controls and its select readable', () => {
    expect(componentsCss).toMatch(
      /\.aura-placement-toolbar\s*\{[^}]*box-sizing:\s*border-box[^}]*width:\s*max-content[^}]*flex-wrap:\s*wrap/s,
    );
    expect(componentsCss).toMatch(
      /\.aura-placement-select\s+option\s*\{[^}]*background:\s*var\(--color-bg-dark\)[^}]*color:\s*var\(--color-text-light\)/s,
    );
    expect(componentsCss).toMatch(
      /\.aura-placement-toolbar\s*\{[^}]*max-height:\s*calc\(\s*var\(--app-vh,\s*100vh\)\s*-\s*24px\s*-\s*env\(safe-area-inset-top,\s*0px\)\s*-\s*env\(safe-area-inset-bottom,\s*0px\)\s*\)[^}]*overflow-y:\s*auto/s,
    );
    expect(componentsCss).toMatch(
      /\.aura-placement-reset,\s*\.aura-placement-done\s*\{[^}]*min-width:\s*112px[^}]*min-height:\s*40px/s,
    );
    expect(componentsCss).toMatch(
      /\.aura-placement-actions\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(4,\s*40px\)/s,
    );
    expect(componentsCss).toMatch(
      /\.aura-placement-action-hint\s*\{[^}]*grid-column:\s*1\s*\/\s*-1[^}]*text-align:\s*center[^}]*white-space:\s*normal/s,
    );
    expect(componentsCss).toMatch(
      /\.aura-placement-footer\s*\{[^}]*display:\s*grid[^}]*flex:\s*1\s+0\s+100%[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)[^}]*border-top:/s,
    );
    expect(componentsCss).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.aura-placement-footer-actions\s*\{[^}]*display:\s*grid[^}]*width:\s*100%[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(componentsCss).toMatch(
      /\.aura-placement-sliders\s*\{[^}]*display:\s*grid[^}]*min-width:\s*460px[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(220px,\s*1fr\)\)/s,
    );
    expect(componentsCss).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.aura-placement-sliders\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*grid-template-columns:\s*1fr/s,
    );
    expect(componentsCss).toMatch(
      /\.aura-placement-selection\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*flex-start[^}]*flex-wrap:\s*wrap/s,
    );
    expect(componentsCss).toMatch(
      /\.aura-placement-parts\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(3,\s*max-content\)/s,
    );
    expect(componentsCss).toMatch(/\.aura-placement-toolbar strong\s*\{[^}]*margin-right:\s*0/s);
    expect(componentsCss).toMatch(
      /@media \(max-width:\s*560px\)[\s\S]*?\.aura-placement-selector\s*\{[^}]*justify-content:\s*flex-start/s,
    );
    expect(componentsCss).toMatch(
      /@media \(max-width:\s*560px\)[\s\S]*?\.aura-placement-parts\s*\{[^}]*width:\s*100%[^}]*grid-template-columns:\s*1fr/s,
    );
  });

  it('keeps the body-level reposition toolbar above the touch HUD and window backdrop', () => {
    const toolbarZ = Number(
      componentsCss.match(/\.aura-placement-toolbar\s*\{[^}]*z-index:\s*(\d+)/s)?.[1],
    );
    const touchUiZ = Number(
      mobileCss.match(/body\.mobile-touch\.mobile-window-open #ui\s*\{[^}]*z-index:\s*(\d+)/s)?.[1],
    );
    const backdropZ = Number(
      mobileCss.match(
        /body\.mobile-touch\.mobile-window-open #mobile-window-backdrop\s*\{[^}]*z-index:\s*(\d+)/s,
      )?.[1],
    );

    expect(toolbarZ).toBeGreaterThan(touchUiZ);
    expect(toolbarZ).toBeGreaterThan(backdropZ);
  });
});
