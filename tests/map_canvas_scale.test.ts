// Regression for issue 1559: the world map did not scale with the UI-scale
// setting. #ui is magnified by `zoom: var(--ui-scale)`, but the desktop
// #map-canvas rule declared no display size, so its box was a replaced intrinsic
// size (the 560x560 backing store) that did not scale in lockstep with the window
// frame: the map underfilled the frame below 100% and clipped past it above 100%.
// The fix gives the desktop canvas an authored px display size matching the
// backing store, so it zoom-scales exactly like the frame. Guard that the desktop
// canvas keeps an explicit size pinned to the backing attribute, and that mobile
// keeps its fill-the-window override.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const componentsCss = readFileSync(join(root, 'src/styles/components.css'), 'utf8');
const mobileCss = readFileSync(join(root, 'src/styles/hud.mobile.css'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const playHtml = readFileSync(join(root, 'play.html'), 'utf8');

// The desktop #map-canvas rule block (components.css), up to its closing brace.
const rule = componentsCss.slice(componentsCss.indexOf('#map-canvas {'));
const desktopRule = rule.slice(0, rule.indexOf('}'));
// The canvas backing store width from the markup (the pixel resolution the map
// paints into): <canvas id="map-canvas" width="560" ...>. Both game entries carry
// their own canvas, so pin both so a drift in only one entry cannot slip through.
const backingRe = /id="map-canvas"[^>]*\bwidth="(\d+)"/;
const backing = indexHtml.match(backingRe);
const playBacking = playHtml.match(backingRe);

describe('map canvas scales with the UI scale (issue 1559)', () => {
  it('the desktop #map-canvas declares an explicit display size (not a replaced intrinsic size)', () => {
    expect(desktopRule).toMatch(/\bwidth:\s*\d+px/);
    expect(desktopRule).toMatch(/\bheight:\s*\d+px/);
  });

  it('the desktop display size is pinned to the canvas backing resolution (both entries)', () => {
    expect(backing, 'could not read the #map-canvas backing width from index.html').toBeTruthy();
    expect(playBacking, 'could not read the #map-canvas backing width from play.html').toBeTruthy();
    const backingPx = backing![1];
    // Both game entries must declare the same backing, and the CSS display size must
    // equal it, so the map stays 1:1 (no stretch) and a future change to any one
    // cannot silently diverge from the others.
    expect(playBacking![1]).toBe(backingPx);
    expect(desktopRule).toContain(`width: ${backingPx}px`);
    expect(desktopRule).toContain(`height: ${backingPx}px`);
  });

  it('keeps the content box exactly the backing size (content-box, not the border-box reset)', () => {
    // The global reset is border-box; a plain width:560px would shrink the content
    // box by the 2px border and downscale the backing. content-box keeps it 1:1.
    expect(desktopRule).toMatch(/\bbox-sizing:\s*content-box/);
  });

  it('mobile still overrides the canvas to fill its responsive window', () => {
    const mobileRule = mobileCss.slice(mobileCss.indexOf('body.mobile-touch #map-canvas {'));
    expect(mobileRule.slice(0, mobileRule.indexOf('}'))).toMatch(/\bwidth:\s*100%/);
  });
});
