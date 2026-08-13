import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The bug (review finding): after a graphics rebuild, restoreGraphicsPreviewContexts
// restarted the paced post-entry prewarm schedule with the SAME plan as boot. At boot
// the ~700 ms paperdoll shell (plus its secondary WebGL context) is built behind the
// loading curtain (main.ts hud.prewarmCharPreviewShell(), gated on !GFX.tightMemory;
// see tests/ios_entry_memory.test.ts), so the schedule's char-window shell unit is a
// no-op there. resetGraphicsPreviewContexts destroys this.charPreview and cancels the
// schedule on a graphics rebuild, then restoreGraphicsPreviewContexts restarts it, but
// by then the REBUILD's own cover is already down: charPreview is null and the first
// unit would perform the full shell + context build as one unit on a live frame, the
// exact hitch class the curtain exists to avoid.
//
// The fix threads an `includeCharFamily` flag (buildPostEntryPreviewPrewarmUnits,
// preview_prewarm_core.ts) through Hud.startPostEntryPreviewPrewarm: it defaults to
// true (the boot call site keeps its exact call text, since the shell is already real
// work there) and the graphics-rebuild restart call site passes false explicitly, which
// drops the shell/skin/pose units while keeping portrait (canvas-2D, no dependence on
// the shell) and armory (lazily rebuilds its own stage) units on the rebuild plan too.
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('post-entry preview prewarm: char family excluded only on the graphics-rebuild restart', () => {
  it('the boot call site is unchanged: it starts the schedule with the default (char family included)', () => {
    expect(main).toContain('if (!GFX.tightMemory) hud.startPostEntryPreviewPrewarm();');
  });

  it('startPostEntryPreviewPrewarm defaults includeCharFamily to true, the boot semantics', () => {
    expect(hud).toContain(
      'startPostEntryPreviewPrewarm(includeCharFamily: boolean = true): PreviewPrewarmHandle {',
    );
  });

  it('the graphics-rebuild restart call site explicitly excludes the char family', () => {
    const restoreAt = hud.indexOf('restoreGraphicsPreviewContexts(): void {');
    expect(restoreAt).toBeGreaterThan(-1);
    const restoreEnd = hud.indexOf('\n  }', restoreAt);
    expect(restoreEnd).toBeGreaterThan(restoreAt);
    const restore = hud.slice(restoreAt, restoreEnd);
    expect(restore).toContain('this.startPostEntryPreviewPrewarm(false)');
    // Reverting to the old boot-identical restart (no argument) must fail this pin.
    expect(restore).not.toContain('this.startPostEntryPreviewPrewarm();');
  });

  it('postEntryPreviewPrewarmUnits forwards includeCharFamily into the pure-core plan builder', () => {
    const methodAt = hud.indexOf(
      'private postEntryPreviewPrewarmUnits(includeCharFamily: boolean): PreviewPrewarmUnit[] {',
    );
    expect(methodAt).toBeGreaterThan(-1);
    const methodEnd = hud.indexOf('renderCharShell:', methodAt);
    expect(methodEnd).toBeGreaterThan(methodAt);
    const method = hud.slice(methodAt, methodEnd);
    expect(method).toContain('includeCharFamily,');
  });
});
