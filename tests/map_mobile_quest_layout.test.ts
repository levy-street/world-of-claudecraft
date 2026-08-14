import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');

function wideLandscapeLayout(uiScale: number): {
  mapPhysical: number;
  questPhysical: number;
  unusedPhysical: number;
} {
  const viewportWidth = 844;
  const viewportHeight = 390;
  const safeInset = 47;
  const edge = safeInset / uiScale;
  const available = viewportWidth / uiScale - edge * 2;
  const gap = 8;
  const rail = 58;
  const frame = 8 * 2 + 2;
  const map = Math.min(320, (viewportHeight - 104) / uiScale);
  const quest = Math.min(300, Math.max(220, available - gap - rail - frame - map));
  return {
    mapPhysical: map * uiScale,
    questPhysical: quest * uiScale,
    unusedPhysical: (available - quest - gap - rail - frame - map) * uiScale,
  };
}

function stackedLandscapeLayout(uiScale: number): {
  canvasPhysical: number;
  questPhysical: number;
  questWidthPhysical: number;
  bottomPhysical: number;
} {
  const viewportWidth = 819;
  const viewportHeight = 390;
  const stackTop = 10 / uiScale;
  // Source-level model for an iPhone-class 34px bottom safe area. Chromium's
  // desktop browser provider resolves env(safe-area-inset-bottom) to zero.
  const stackBottom = 34 / uiScale;
  const quest = Math.min(118, Math.max(88, viewportHeight / uiScale - 150));
  const gap = 8;
  const shellHeight = 22;
  const map = Math.min(
    viewportWidth * 0.52,
    320,
    viewportHeight / uiScale - stackTop - stackBottom - quest - gap - shellHeight,
  );
  const questWidth = Math.min(
    Math.min(680, Math.max(320, viewportWidth * 0.76)),
    viewportWidth / uiScale - 32,
  );
  return {
    canvasPhysical: (map + 4) * uiScale,
    questPhysical: quest * uiScale,
    questWidthPhysical: questWidth * uiScale,
    bottomPhysical: (stackTop + quest + gap + map + shellHeight + stackBottom) * uiScale,
  };
}

describe('wide landscape map and quest layout', () => {
  it('uses a scale-correct side-by-side contract with the narrow stacked fallback intact', () => {
    expect(css).toContain('@media (min-width: 820px)');
    expect(css).toContain(
      'body.mobile-touch.mobile-map-quest-open {\n        /* Shared by the sibling quest sheet and map window.',
    );
    expect(css).toContain('--mobile-map-rail: 58px;');
    expect(css).toContain('--mobile-map-frame: 18px;');
    expect(css).toContain(
      '--mobile-map-dual-edge-left: calc(\n          max(10px, env(safe-area-inset-left)) /\n          var(--ui-scale, 1)\n        );',
    );
    expect(css).toContain(
      '--mobile-map-dual-edge-right: calc(\n          max(10px, env(safe-area-inset-right)) /\n          var(--ui-scale, 1)\n        );',
    );
    expect(css).toContain(
      '--mobile-map-dual-edge-top: calc(max(10px, env(safe-area-inset-top)) / var(--ui-scale, 1));',
    );
    expect(css).toContain(
      '--mobile-map-dual-edge-bottom: calc(\n          max(10px, env(safe-area-inset-bottom)) /\n          var(--ui-scale, 1)\n        );',
    );
    expect(css).toContain('--mobile-map-dual-available-width: calc(');
    expect(css).toContain('calc((var(--app-vh) - 104px) / var(--ui-scale, 1))');
    expect(css).toContain('var(--mobile-map-dual-size) -\n            var(--mobile-map-frame)');
    expect(css).toContain('left: var(--mobile-map-dual-edge-left);');
    expect(css).toContain('right: var(--mobile-map-dual-edge-right);');
    expect(css).toContain('--mobile-map-size: var(--mobile-map-dual-size);');
    expect(css).toContain('max-height: calc(\n          var(--app-vh) /');

    const stackedRule = css.indexOf('body.mobile-touch.mobile-map-quest-open #map-window {');
    const wideRule = css.indexOf('@media (min-width: 820px)', stackedRule);
    expect(stackedRule).toBeGreaterThan(-1);
    expect(wideRule).toBeGreaterThan(stackedRule);
  });

  it.each([0.85, 1, 1.4])(
    'keeps the 844x390 map at least 272 physical pixels at UI scale %s without overlap',
    (uiScale) => {
      const layout = wideLandscapeLayout(uiScale);
      expect(layout.mapPhysical).toBeGreaterThanOrEqual(272);
      expect(layout.questPhysical).toBeGreaterThanOrEqual(220 * uiScale);
      expect(layout.unusedPhysical).toBeGreaterThanOrEqual(0);
    },
  );

  it('keeps the exact 820px wide breakpoint non-overlapping at maximum UI scale', () => {
    const uiScale = 1.4;
    const viewportWidth = 820;
    const viewportHeight = 390;
    const safeInset = 10;
    const edge = safeInset / uiScale;
    const available = viewportWidth / uiScale - edge * 2;
    const map = Math.min(320, (viewportHeight - 104) / uiScale);
    const quest = Math.min(300, Math.max(220, available - 8 - 58 - 18 - map));
    expect((available - quest - 8 - 58 - 18 - map) * uiScale).toBeGreaterThanOrEqual(0);
  });

  it('keeps the stacked fallback scale-correct below the side-by-side breakpoint', () => {
    expect(css).toContain(
      '--mobile-map-quest-stack-top: calc(max(10px, env(safe-area-inset-top)) / var(--ui-scale, 1));',
    );
    expect(css).toContain(
      '--mobile-map-quest-stack-bottom: calc(\n      max(10px, env(safe-area-inset-bottom)) /\n      var(--ui-scale, 1)\n    );',
    );
    expect(css).toContain('--mobile-map-stack-shell-height: 22px;');
    expect(css).toContain('--mobile-map-touch-target: max(40px, calc(40px / var(--ui-scale, 1)));');
    expect(css).toContain('body.mobile-touch.mobile-map-quest-open #quest-log-window .ql-item,');
    expect(css).toContain('min-width: var(--mobile-map-touch-target);');
    expect(css).toContain('min-height: var(--mobile-map-touch-target);');
    expect(css).toContain('max-width: calc(var(--app-vw) / var(--ui-scale, 1) - 32px);');
    expect(css).toContain('var(--mobile-map-quest-stack-top) -');
    expect(css).toContain('var(--mobile-map-quest-stack-bottom) -');
    expect(css).toContain('var(--mobile-map-stack-shell-height)');
    expect(css).toContain(
      'width: min(\n        calc(var(--mobile-map-size) + var(--mobile-map-rail) + var(--mobile-map-frame)),',
    );
    expect(css).toContain('padding-bottom: var(--window-pad);');

    for (const uiScale of [0.85, 1, 1.4]) {
      const layout = stackedLandscapeLayout(uiScale);
      expect(layout.questPhysical).toBeLessThanOrEqual(118 * uiScale);
      expect(layout.questWidthPhysical).toBeLessThanOrEqual(819 - 32 * uiScale);
      expect(layout.canvasPhysical).toBeGreaterThanOrEqual(140);
      expect(layout.bottomPhysical).toBeLessThanOrEqual(390 + Number.EPSILON * 512);
    }
  });
});
