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

  it('walks every armory skin through the post-entry prewarm schedule', () => {
    expect(store).toContain('WEAPON_SKIN_LIST.map((skin) => skin.id)');
    expect(hud).toContain('this.dailyRewardsWindow.armoryPrewarmSkinIds()');
    // One MODE per paced unit (a whole-skin unit was a measured 170 to 225 ms
    // main-thread block in live play).
    expect(hud).toContain(
      'this.dailyRewardsWindow.prewarmArmoryPreviewSkins([skinId], [armoryMode])',
    );
    // The schedule starts after the reveal (post-entry paced units), no longer
    // holding the loading curtain for the whole catalog.
    const revealAt = main.indexOf('const revealWorld = (): void => {');
    expect(revealAt).toBeGreaterThan(-1);
    const startAt = main.indexOf('hud.startPostEntryPreviewPrewarm();', revealAt);
    expect(startAt).toBeGreaterThan(revealAt);
  });

  it('warms both portrait framings so Inspect never pays the first PNG capture', () => {
    // The plan lives in the pure core; the hud composes it with the real
    // portrait thunk.
    const core = readFileSync(
      new URL('../src/ui/preview_prewarm_core.ts', import.meta.url),
      'utf8',
    );
    const start = core.indexOf('export function buildPostEntryPreviewPrewarmUnits');
    expect(start).toBeGreaterThan(-1);
    const plan = core.slice(start);
    expect(plan).toContain("['headshot', 'body'] as const");
    expect(plan).toContain('deps.renderPortrait(portraitClass, skin, framing)');
    const hudStart = hud.indexOf(
      'private postEntryPreviewPrewarmUnits(includeCharFamily: boolean)',
    );
    expect(hudStart).toBeGreaterThan(-1);
    const compose = hud.slice(hudStart, hud.indexOf('startPostEntryPreviewPrewarm(', hudStart));
    expect(compose).toContain('buildPostEntryPreviewPrewarmUnits');
    expect(compose).toContain('playerPortraitDataUrl(portraitClass as PlayerClass, skin, framing)');
  });

  it('prewarms player-card poses and never resizes the live preview to capture them', () => {
    const captureStart = characterPreview.indexOf('private async captureCloseupNow');
    const captureEnd = characterPreview.indexOf('/** Cleanup resources */', captureStart);
    const capture = characterPreview.slice(captureStart, captureEnd);
    expect(capture).toContain('new THREE.WebGLRenderTarget');
    expect(capture).toContain('readRenderTargetPixelsAsync');
    expect(capture).not.toContain('this.renderer.setSize(');
    expect(hud).toContain('prewarmCloseupPoses([pose])');
  });

  it('carries a mid-prewarm setContainer/syncSize request past the CharacterPreview finally instead of a stale wasActive', () => {
    // syncSize (setContainer's own tail, and the resize observer that fires
    // when the char window's display flips) must not resize the buffer that
    // prewarm() has repurposed for warmup while it owns it; it should only
    // record the request.
    const syncSizeStart = characterPreview.indexOf('syncSize(): void {');
    const syncSizeEnd = characterPreview.indexOf('/** Compile and upload', syncSizeStart);
    const syncSize = characterPreview.slice(syncSizeStart, syncSizeEnd);
    expect(syncSize).toContain('if (this.prewarming) {');
    expect(syncSize).toContain(
      'this.pendingActive = this.container.clientWidth > 0 && this.container.clientHeight > 0;',
    );

    const prewarmStart = characterPreview.indexOf('async prewarm(skinIndices');
    const prewarmEnd = characterPreview.indexOf('async prewarmCloseupPoses(', prewarmStart);
    const prewarm = characterPreview.slice(prewarmStart, prewarmEnd);
    expect(prewarm).toContain('this.prewarming = true;');
    // The finally applies the latest mid-prewarm request over the stale
    // wasActive it captured at entry, then resyncs to the real size only
    // when a request actually arrived (no mid-flight calls means the
    // pre-warmup snapshot restored just above is already correct).
    expect(prewarm).toContain('const requestedActive = this.pendingActive;');
    expect(prewarm).toContain('this.renderActive = requestedActive ?? wasActive;');
    expect(prewarm).toContain('if (requestedActive !== null) this.syncSize();');
    expect(prewarm).not.toContain('this.renderActive = wasActive;');
  });

  it('carries a mid-prewarm setActive request past the ArmoryPreview finally instead of a stale wasActive', () => {
    // setActive must not touch the shared active/rAF state while prewarm()
    // owns the render buffer and loop; it should only record the request.
    const setActiveStart = preview.indexOf('setActive(next: boolean): void {');
    const setActiveEnd = preview.indexOf(
      'setAppearance(next: PreviewAppearance): void {',
      setActiveStart,
    );
    const setActive = preview.slice(setActiveStart, setActiveEnd);
    expect(setActive).toContain('if (prewarming) {');
    expect(setActive).toContain('pendingActive = next;');

    const prewarmStart = preview.indexOf('async prewarm(');
    const finallyStart = preview.indexOf('} finally {', prewarmStart);
    const finallyEnd = preview.indexOf('dispose(): void {', finallyStart);
    const finallyBody = preview.slice(finallyStart, finallyEnd);
    expect(finallyBody).toContain('const requestedActive = pendingActive;');
    expect(finallyBody).toContain('active = requestedActive ?? wasActive;');
    expect(finallyBody).not.toContain('active = wasActive;');
  });
});
