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
const core = readFileSync(new URL('../src/ui/preview_prewarm_core.ts', import.meta.url), 'utf8');

describe('Armory preview lifecycle', () => {
  it('keeps one renderer and parks it instead of disposing on modal close', () => {
    const close = inspect.slice(
      inspect.indexOf('close(): void'),
      inspect.indexOf('destroy(): void'),
    );
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
    expect(preview).toContain('if (disposed || !active) return;');
    expect(preview).not.toMatch(/applyMode\(\);\s*animate\(\);/);
    expect(preview).toContain('setActive(next: boolean)');
    // The whole warming surface is gone with the schedule that used it: no
    // prewarm entry point, no warmup drawing buffer, and none of the deferral
    // machinery that existed only to hold card clicks arriving mid-warm. Pinned
    // negatively so it cannot creep back without a caller and a measurement
    // (docs/design/armory-preview-warming.md).
    expect(preview).not.toContain('prewarming');
    expect(preview).not.toContain('WarmupBuffer');
    expect(preview).not.toContain('pendingSelection');
    expect(preview).not.toContain('pendingActive');
    expect(inspect).not.toContain('prewarm');
  });

  it('reaches the Armory stage from a CARD CLICK and from nowhere else', () => {
    // The invariant this branch actually ships: no preparation on store open,
    // construction only on the click that opens a card. Symbol-absence searches
    // alone cannot say that (they pass if the chain returns under a new name),
    // so this walks the real chain and then pins that it is the ONLY one.
    //
    // ensureArmoryInspect is the single door to the stage: ensureStage is
    // private and reached only through it.
    const doors = [...inspect.matchAll(/this\.ensureStage\(\)/g)].length;
    expect(doors).toBeGreaterThan(0);
    const callers = [...store.matchAll(/this\.ensureArmoryInspect\(\)/g)].length;
    // Exactly one caller, and it is the card-open path.
    expect(callers).toBe(1);
    expect(store).toContain('this.ensureArmoryInspect().open(row)');

    // openStore never reaches it, DIRECTLY or through what it calls. Checking
    // openStore's own body alone would miss a preparation hidden one hop away,
    // so every method it reaches is checked too.
    const bodyOf = (name: string): string => {
      const at = store.indexOf(name);
      expect(at, `${name} not found`).toBeGreaterThan(-1);
      return store.slice(at, store.indexOf('\n  }', at));
    };
    const openStore = bodyOf('openStore(): void {');
    expect(openStore).toContain("this.tab = 'store'");
    for (const hop of [
      openStore,
      bodyOf('toggle(): void {'),
      bodyOf('private async renderCurrent('),
      bodyOf('private async renderStore('),
    ]) {
      expect(hop.toLowerCase()).not.toContain('ensurearmory');
      expect(hop.toLowerCase()).not.toContain('warm');
    }

    // And the hud's store entry point adds nothing of its own.
    const hudOpenStart = hud.indexOf('openWocStore(): void {');
    expect(hudOpenStart).toBeGreaterThan(-1);
    const hudOpen = hud.slice(hudOpenStart, hud.indexOf('\n  }', hudOpenStart));
    expect(hudOpen.toLowerCase()).not.toContain('armory');
    expect(hudOpen.toLowerCase()).not.toContain('warm');
  });

  it('keeps the armory catalog OUT of the post-entry prewarm schedule', () => {
    // The whole warming chain is gone from the store window, its catalog
    // helper included: nothing but the prewarm ever called it, so it went with
    // it rather than lingering as a method with no caller.
    expect(store).not.toContain('armoryPrewarmSkinIds');
    expect(store).not.toContain('prewarmArmoryPreview');
    expect(store).not.toContain('finishArmoryPreviewPrewarm');
    // Measured, warming it cost about 2.1 to 2.6 s of live-frame hitches that
    // every online session paid for a window only some players open, and the
    // cost was positional rather than per skin, so no gentler schedule was
    // available. The lazy per-card path builds what one inspected card needs,
    // and a second card measured 79 ms. Evidence and the before/after:
    // docs/design/armory-preview-warming.md.
    //
    // NEGATIVE pin, hardened against a rename. Checking for the old identifiers
    // alone would pass if the chain came back as warmArmoryCatalog(); the DOMAIN
    // WORD cannot be renamed away, so the composed plan must not mention armory
    // at all, in any casing.
    const composeStart = hud.indexOf('postEntryPreviewPrewarmUnits(');
    expect(composeStart).toBeGreaterThan(-1);
    const compose = hud.slice(composeStart, hud.indexOf('\n  }', composeStart));
    expect(compose.toLowerCase()).not.toContain('armory');
    // And the deps SURFACE itself, which is the other way it could come back:
    // a new optional dep would leave both the plan test and tsc silent.
    expect(core.toLowerCase()).not.toContain('armoryskinids');
    expect(core).not.toContain('prewarmArmorySkin');
    // The schedule itself still starts after the reveal, never holding the
    // loading curtain.
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
    // The prewarm variant, not the sync playerPortraitDataUrl: uploads prepaid
    // in bounded slices and the PNG encode off-thread (the sync capture books
    // 43 to 201 ms per cold portrait); a later sync call is a cache hit.
    expect(compose).toContain('prewarmPlayerPortrait(portraitClass as PlayerClass, skin, framing)');
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
});
