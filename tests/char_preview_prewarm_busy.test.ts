import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The post-entry preview prewarm's isFamilyBusy predicate lives inline in
// hud.ts (startPostEntryPreviewPrewarm), because it reads Hud's own private
// window/preview state; Hud is never instantiated directly in tests (it needs
// a full DOM + world + renderer), so this pins the wiring the way
// character_preview_policy.test.ts and armory_preview_lifecycle.test.ts
// already pin adjacent hud.ts prewarm wiring.
//
// The bug this guards: the shared CharacterPreview instance (this.charPreview)
// is displayed by TWO surfaces, the character sheet (charWindow) and the
// inspect ("Profile") window (via mountInspectPreview), but the predicate used
// to read only charWindow.isOpen. A char prewarm unit firing while the inspect
// overlay was open drew warmup frames on the visible canvas and warmed
// whatever rig the inspect stage had mounted (the INSPECTED player's), not the
// local paperdoll skin the unit was planned for.
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('hud.ts: post-entry preview prewarm char-family busy predicate', () => {
  it('the char family routes through isCharPreviewSurfaceVisible(), not charWindow.isOpen alone', () => {
    const startAt = hud.indexOf(
      'startPostEntryPreviewPrewarm(includeCharFamily: boolean = true): PreviewPrewarmHandle {',
    );
    expect(startAt).toBeGreaterThan(-1);
    const scheduleEnd = hud.indexOf('return handle;', startAt);
    expect(scheduleEnd).toBeGreaterThan(startAt);
    const schedule = hud.slice(startAt, scheduleEnd);
    // One family remains (the armory left with the catalog warming), so the
    // predicate is no longer a ternary. What it must still route through is
    // unchanged, and so is the regression it guards.
    expect(schedule).toContain('isFamilyBusy: () => this.isCharPreviewSurfaceVisible()');
    // The old, under-covering form: routing the char family straight back to
    // charWindow.isOpen must fail this pin, in either shape.
    expect(schedule).not.toContain('this.charWindow.isOpen');
  });

  it('the schedule watches no armory surface, because it plans no armory unit', () => {
    // This used to pin the armory arm of the predicate. That arm is gone with
    // the catalog warming, so the pin is inverted rather than deleted: a
    // returning schedule would need a busy key again, and it would land here.
    const startAt = hud.indexOf(
      'startPostEntryPreviewPrewarm(includeCharFamily: boolean = true): PreviewPrewarmHandle {',
    );
    const scheduleEnd = hud.indexOf('return handle;', startAt);
    const schedule = hud.slice(startAt, scheduleEnd);
    expect(schedule.toLowerCase()).not.toContain('armory');
    expect(schedule).not.toContain('dailyRewardsWindow');
  });

  it('isCharPreviewSurfaceVisible() covers both surfaces that mount the shared CharacterPreview', () => {
    const helperStart = hud.indexOf('private isCharPreviewSurfaceVisible(): boolean {');
    expect(helperStart).toBeGreaterThan(-1);
    const nextDocAt = hud.indexOf(
      '/** Start (or restart) the post-entry preview prewarm',
      helperStart,
    );
    expect(nextDocAt).toBeGreaterThan(helperStart);
    const helper = hud.slice(helperStart, nextDocAt);
    // The character sheet: the surface the predicate already covered.
    expect(helper).toContain('this.charWindow.isOpen');
    // The inspect ("Profile") window: mounts the SAME shared preview via
    // mountInspectPreview but carries no isOpen of its own, so the helper
    // reads its DOM display the same way mountInspectPreview itself already
    // does. Missing this arm is the exact regression under test.
    expect(helper).toContain("$('#inspect-window')");
    expect(helper).toContain("style.display === 'block'");
  });

  it('mountInspectPreview mounts the same shared this.charPreview instance the char sheet uses', () => {
    // Confirms the premise: the inspect window is a real second display
    // surface for this.charPreview, not an independent preview instance.
    const mountStart = hud.indexOf('private mountInspectPreview(');
    expect(mountStart).toBeGreaterThan(-1);
    const mountEnd = hud.indexOf('private renderCharSkinPicker', mountStart);
    const mount = hud.slice(mountStart, mountEnd);
    expect(mount).toContain('this.mountSharedPreview(container');
    const sharedStart = hud.indexOf('private mountSharedPreview(');
    expect(sharedStart).toBeGreaterThan(-1);
    const sharedEnd = hud.indexOf('private mountCharPreview(', sharedStart);
    const shared = hud.slice(sharedStart, sharedEnd);
    expect(shared).toContain('this.charPreview = new CharacterPreview(container');
    expect(shared).toContain('this.charPreview.setContainer(container)');
  });
});
