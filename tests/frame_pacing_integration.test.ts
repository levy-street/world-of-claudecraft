import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainTs = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const rendererTs = readFileSync(
  new URL('../src/render/renderer.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const frameStart = mainTs.indexOf('  function frame(now: number): void {');
const frameEnd = mainTs.indexOf('  const controller = {', frameStart);
const frameLoop = mainTs.slice(frameStart, frameEnd);

describe('main-loop frame pacing contract', () => {
  it('gates before elapsed time, input, simulation, and rendering advance', () => {
    expect(frameStart).toBeGreaterThan(-1);
    expect(frameEnd).toBeGreaterThan(frameStart);
    expect(frameLoop).toMatch(
      /const pacing = framePacer\.step\(now, previousFrameWorkMs\);\s*if \(!pacing\.shouldRun\) return;\s*framePacingInfo\.intentional = pacing\.intentionallyPaced;\s*framePacingInfo\.targetFps = pacing\.targetFps;\s*framePacingInfo\.previousWorkMs = previousFrameWorkMs;\s*const frameWorkStartMs = performance\.now\(\);\s*let frameDt = \(now - last\) \/ 1000;\s*last = now;/,
    );
    expect(frameLoop.indexOf('if (!pacing.shouldRun) return;')).toBeLessThan(
      frameLoop.indexOf("perf.trace('input.updateTouchLook'"),
    );
    expect(frameLoop.indexOf('if (!pacing.shouldRun) return;')).toBeLessThan(
      frameLoop.indexOf('offlineSim.tick()'),
    );
  });

  it('forwards pacing and previous full-frame work through both render paths', () => {
    expect(frameLoop).toMatch(
      /framePacingInfo\.intentional = pacing\.intentionallyPaced;\s*framePacingInfo\.targetFps = pacing\.targetFps;\s*framePacingInfo\.previousWorkMs = previousFrameWorkMs;/,
    );
    expect(
      frameLoop.match(/renderer\.sync\((?:acc \/ DT|alpha), frameDt, rendererSyncOptions\)/g),
    ).toHaveLength(2);
    expect(
      frameLoop.match(
        /perf\.time\('hud',[\s\S]*?perf\.tick\(now\);\s*previousFrameWorkMs = performance\.now\(\) - frameWorkStartMs;\s*loadingHandoff\.markFirstRenderedFrame\(\);/g,
      ),
    ).toHaveLength(2);
  });

  it('forwards pacing and full-frame work through Renderer into the governor', () => {
    const syncStart = rendererTs.indexOf('  sync(');
    const syncEnd = rendererTs.indexOf('    this.viewportPollTimer += dt;', syncStart);
    const syncBlock = rendererTs.slice(syncStart, syncEnd);
    const adaptiveStart = rendererTs.indexOf('  private updateAdaptiveResolution(');
    const adaptiveEnd = rendererTs.indexOf('  private runtimeViewCreateBudget(', adaptiveStart);
    const adaptiveBlock = rendererTs.slice(adaptiveStart, adaptiveEnd);

    expect(syncStart).toBeGreaterThan(-1);
    expect(syncEnd).toBeGreaterThan(syncStart);
    expect(adaptiveStart).toBeGreaterThan(-1);
    expect(adaptiveEnd).toBeGreaterThan(adaptiveStart);
    expect(syncBlock).toMatch(
      /const framePacing = options\?\.framePacing;[\s\S]*?const previousFrameWorkMs = framePacing\?\.previousWorkMs \?\? 0;/,
    );
    expect(syncBlock).toMatch(
      /this\.updateAdaptiveResolution\(\s*dt,\s*intentionalFramePacing,\s*pacedTargetFps,\s*previousFrameWorkMs,?\s*\);/,
    );
    expect(adaptiveBlock).toMatch(
      /this\.renderBudgetGovernor\.update\(\{[\s\S]*?intentionalFramePacing,[\s\S]*?pacedTargetFps,[\s\S]*?workMs: previousFrameWorkMs > 0 \? previousFrameWorkMs : previousTotalMs,/,
    );
  });

  it('delegates bounded native panel calibration under the loading screen', () => {
    const calibrationStart = mainTs.indexOf(
      'if (NATIVE_APP) {',
      mainTs.indexOf('await renderer.prewarmInitialScene()'),
    );
    const loopStart = mainTs.indexOf('requestAnimationFrame(frame);', calibrationStart);
    const calibrationBlock = mainTs.slice(calibrationStart, loopStart);

    expect(calibrationStart).toBeGreaterThan(-1);
    expect(loopStart).toBeGreaterThan(calibrationStart);
    expect(calibrationBlock).toContain('await calibrateFramePacer(framePacer, {');
    expect(calibrationBlock).toContain(
      'requestAnimationFrame: (callback) => requestAnimationFrame(callback)',
    );
    expect(calibrationBlock).toContain(
      'cancelAnimationFrame: (handle) => cancelAnimationFrame(handle)',
    );
    expect(calibrationBlock).toContain('setTimeout: (callback, delayMs)');
  });

  it('arms the tested loading handoff before native calibration can stall', () => {
    const launchStart = mainTs.indexOf('  loadingHandoff.start(() => {', frameEnd);
    const launchEnd = mainTs.indexOf('  fadeOutHomepageMusic();', launchStart);
    const launchBlock = mainTs.slice(launchStart, launchEnd);
    const calibrationStart = launchBlock.indexOf('  if (NATIVE_APP) {');
    const frameRequest = launchBlock.indexOf('  requestAnimationFrame(frame);');

    expect(launchStart).toBeGreaterThan(frameEnd);
    expect(launchEnd).toBeGreaterThan(launchStart);
    expect(frameLoop.match(/loadingHandoff\.markFirstRenderedFrame\(\);/g)).toHaveLength(2);
    expect(launchBlock).toMatch(
      /loadingHandoff\.start\(\s*\(\) => \{\s*hideLoadingScreen\(\);\s*entryDiagnostics\.checkpoint\('first-paint'\);[\s\S]*?intro\.startedAt = performance\.now\(\);[\s\S]*?},\s*hideLoadingScreen,?\s*\);/,
    );
    expect(calibrationStart).toBeGreaterThan(-1);
    expect(frameRequest).toBeGreaterThan(calibrationStart);
  });

  it('scopes automatic pacing to the native runtime, not interface mode', () => {
    expect(mainTs).toMatch(
      /const framePacer = new FramePacer\(\{\s*enabled: NATIVE_APP,\s*maxFps: MOBILE_FRAME_RATE_CEILING_FPS,/,
    );
    expect(frameLoop).not.toContain('framePacer.setEnabled(');
  });
});
