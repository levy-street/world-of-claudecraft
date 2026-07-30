import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const preview = readFileSync(new URL('../src/render/armory_preview.ts', import.meta.url), 'utf8');
const characterPreview = readFileSync(
  new URL('../src/render/characters/preview.ts', import.meta.url),
  'utf8',
);
const inspect = readFileSync(new URL('../src/ui/armory_inspect.ts', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/ui/daily_rewards_window.ts', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('Armory preview lifecycle', () => {
  it('keeps one renderer and parks it instead of disposing on modal close', () => {
    const close = inspect.slice(inspect.indexOf('close(): void'), inspect.indexOf('async prewarm'));
    expect(close).toContain('this.hideOverlay(true)');
    expect(close).not.toContain('.dispose()');
    expect(inspect).toContain('this.parking.appendChild(this.stage)');
    expect(inspect).toContain('this.preview?.setActive(false)');
    expect(store).toContain('this.armoryInspect?.close()');
  });

  it('runs no hidden animation loop and retains warmed skin rigs', () => {
    expect(preview).toContain('const weaponRigs = new Map<string, CachedWeaponRig>()');
    expect(preview).toContain(
      "const characterRigs = new Map<string, CharacterVisual>([['', visual]])",
    );
    expect(preview).toContain('selectCharacterRig(next);');
    expect(preview).toContain('if (disposed || !active || prewarming) return;');
    expect(preview).not.toMatch(/applyMode\(\);\s*animate\(\);/);
    expect(preview).toContain('setActive(next: boolean)');
    expect(preview).toContain('composer.render();\n        prewarming = false;');
  });

  it('warms every armory skin before the loading screen fades online', () => {
    expect(store).toContain('WEAPON_SKIN_LIST.map((skin) => skin.id)');
    expect(hud).toContain('async prewarmArmoryPreview()');
    const start = main.indexOf('await hud.prewarmCharacterPreview()');
    const loadingWarm = main.slice(start, main.indexOf('setLoadingPercent(100', start));
    expect(loadingWarm).toContain('await hud.prewarmArmoryPreview()');
  });

  it('warms both portrait framings before Inspect can request a PNG capture', () => {
    const start = hud.indexOf('async prewarmCharacterPreview()');
    const end = hud.indexOf('async prewarmArmoryPreview()', start);
    const warm = hud.slice(start, end);
    expect(warm).toContain("['headshot', 'body'] as const");
    expect(warm).toContain('playerPortraitDataUrl(portraitClass, skin, framing)');
    expect(warm).toContain('window.setTimeout(resolve, 0)');
  });

  it('prewarms player-card poses and never resizes the live preview to capture them', () => {
    const captureStart = characterPreview.indexOf('private async captureCloseupNow');
    const captureEnd = characterPreview.indexOf('/** Cleanup resources */', captureStart);
    const capture = characterPreview.slice(captureStart, captureEnd);
    expect(capture).toContain('new THREE.WebGLRenderTarget');
    expect(capture).toContain('readRenderTargetPixelsAsync');
    expect(capture).not.toContain('this.renderer.setSize(');
    expect(hud).toContain('prewarmCloseupPoses(CARD_POSES)');
  });
});
