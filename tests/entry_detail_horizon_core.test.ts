import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EntryDetailHorizonAdmission } from '../src/render/entry_detail_horizon';
import {
  advanceEntryDetailHorizon,
  createEntryDetailHorizonState,
  ENTRY_DETAIL_HORIZON_HEADROOM_MS,
  ENTRY_DETAIL_HORIZON_STABLE_FRAMES,
  ENTRY_DETAIL_HORIZON_STEPS,
  entrySceneryCullFar,
} from '../src/render/entry_detail_horizon_core';

describe('entry detail horizon admission', () => {
  it('starts with a useful near field rather than the full 700-yard detail bill', () => {
    expect(createEntryDetailHorizonState(700)).toEqual({
      cap: ENTRY_DETAIL_HORIZON_STEPS[0],
      step: 0,
      stableFrames: 0,
      complete: false,
    });
  });

  it('does not expand for elapsed time alone: compile, terrain and frame headroom must agree', () => {
    const initial = createEntryDetailHorizonState(700);
    const blocked = [
      { compileReady: false, terrainReadyFar: 700, frameMs: 10 },
      { compileReady: true, terrainReadyFar: ENTRY_DETAIL_HORIZON_STEPS[1] - 1, frameMs: 10 },
      {
        compileReady: true,
        terrainReadyFar: 700,
        frameMs: ENTRY_DETAIL_HORIZON_HEADROOM_MS + 1,
      },
    ];
    for (const input of blocked) {
      let state = initial;
      for (let i = 0; i < ENTRY_DETAIL_HORIZON_STABLE_FRAMES * 3; i++) {
        state = advanceEntryDetailHorizon(state, { ...input, targetFar: 700 });
      }
      expect(state.cap).toBe(ENTRY_DETAIL_HORIZON_STEPS[0]);
    }
  });

  it('opens one ring only after consecutive healthy frames, then reaches the target monotonically', () => {
    let state = createEntryDetailHorizonState(700);
    const seen = [state.cap];
    for (let i = 0; i < ENTRY_DETAIL_HORIZON_STABLE_FRAMES - 1; i++) {
      state = advanceEntryDetailHorizon(state, {
        targetFar: 700,
        compileReady: true,
        terrainReadyFar: 700,
        frameMs: 12,
      });
    }
    expect(state.cap).toBe(ENTRY_DETAIL_HORIZON_STEPS[0]);
    state = advanceEntryDetailHorizon(state, {
      targetFar: 700,
      compileReady: true,
      terrainReadyFar: 700,
      frameMs: 12,
    });
    expect(state.cap).toBe(ENTRY_DETAIL_HORIZON_STEPS[1]);

    while (!state.complete) {
      state = advanceEntryDetailHorizon(state, {
        targetFar: 700,
        compileReady: true,
        terrainReadyFar: 700,
        frameMs: 12,
      });
      seen.push(state.cap);
    }
    expect(state.cap).toBe(700);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });

  it('clamps the ladder to a smaller atmospheric target', () => {
    let state = createEntryDetailHorizonState(310);
    for (let i = 0; i < ENTRY_DETAIL_HORIZON_STABLE_FRAMES; i++) {
      state = advanceEntryDetailHorizon(state, {
        targetFar: 310,
        compileReady: true,
        terrainReadyFar: 700,
        frameMs: 10,
      });
    }
    expect(state.cap).toBe(310);
    expect(state.complete).toBe(true);
  });

  it('arms before presentation and reports why each ring is still held', () => {
    let nowMs = 100;
    const admission = new EntryDetailHorizonAdmission(700, () => nowMs);

    expect(admission.snapshot()).toMatchObject({ active: false, cap: 700, holdReason: 'inactive' });
    expect(admission.arm(700, true)).toBe(ENTRY_DETAIL_HORIZON_STEPS[0]);
    expect(admission.snapshot()).toMatchObject({
      active: true,
      cap: ENTRY_DETAIL_HORIZON_STEPS[0],
      nextCap: ENTRY_DETAIL_HORIZON_STEPS[1],
      armedAtMs: 100,
      holdReason: 'stabilizing',
      transitions: [],
    });

    admission.advanceFromFrame(
      true,
      700,
      [{ submittedAtMs: 1, settledAtMs: null, failedAtMs: null }],
      700,
      10,
    );
    expect(admission.snapshot().holdReason).toBe('compile-debt');

    nowMs = 250;
    for (let i = 0; i < ENTRY_DETAIL_HORIZON_STABLE_FRAMES; i++) {
      admission.advanceFromFrame(true, 700, [], 700, 10);
    }
    expect(admission.snapshot()).toMatchObject({
      cap: ENTRY_DETAIL_HORIZON_STEPS[1],
      holdReason: 'advanced',
      transitions: [
        { from: ENTRY_DETAIL_HORIZON_STEPS[0], to: ENTRY_DETAIL_HORIZON_STEPS[1], atMs: 250 },
      ],
    });
  });

  it('does not inspect compile lifecycle records after the entry horizon is inactive', () => {
    const admission = new EntryDetailHorizonAdmission(700);
    const records = new Proxy([] as never[], {
      get() {
        throw new Error('inactive horizon scanned compile records');
      },
    });

    expect(admission.advanceFromFrame(true, 700, records, 700, 16)).toBe(700);
    expect(admission.snapshot().holdReason).toBe('inactive');
  });

  it('accepts a healthy externally paced 30 Hz display as frame headroom', () => {
    let state = createEntryDetailHorizonState(700);
    for (let i = 0; i < ENTRY_DETAIL_HORIZON_STABLE_FRAMES; i++) {
      state = advanceEntryDetailHorizon(state, {
        targetFar: 700,
        compileReady: true,
        terrainReadyFar: 700,
        frameMs: 1000 / 30,
        externallyPaced: true,
      });
    }
    expect(state.cap).toBe(ENTRY_DETAIL_HORIZON_STEPS[1]);
  });

  describe('scenery cull far while the horizon expands', () => {
    const healthy = { targetFar: 700, compileReady: true, terrainReadyFar: 700, frameMs: 10 };
    const ringOne = (): ReturnType<typeof createEntryDetailHorizonState> => {
      let state = createEntryDetailHorizonState(700);
      for (let i = 0; i < ENTRY_DETAIL_HORIZON_STABLE_FRAMES; i++) {
        state = advanceEntryDetailHorizon(state, healthy);
      }
      return state;
    };

    it('pins the ring ladder the cap is read from', () => {
      expect([...ENTRY_DETAIL_HORIZON_STEPS]).toEqual([240, 360, 520, 700]);
    });

    it('caps a cull far wider than the ring the horizon has opened, at the CURRENT ring', () => {
      expect(entrySceneryCullFar(574, createEntryDetailHorizonState(700))).toBe(240);
      const advanced = ringOne();
      expect(advanced.cap).toBe(360);
      expect(entrySceneryCullFar(574, advanced)).toBe(360);
    });

    it('leaves a cull far already inside the ring alone', () => {
      expect(entrySceneryCullFar(230, createEntryDetailHorizonState(700))).toBe(230);
    });

    it('passes the cull far through once the horizon is complete', () => {
      const state = { ...createEntryDetailHorizonState(700), cap: 700, complete: true };
      expect(entrySceneryCullFar(950, state)).toBe(950);
    });

    it('caps on the admission only between arm and completion, following each ring', () => {
      const admission = new EntryDetailHorizonAdmission(700);
      expect(admission.sceneryCullFar(574)).toBe(574);
      admission.arm(700, true);
      expect(admission.sceneryCullFar(574)).toBe(240);
      let frames = 0;
      while (admission.snapshot().cap === 240) {
        admission.advanceFromFrame(true, 700, null, 700, 10);
        expect(frames++).toBeLessThan(ENTRY_DETAIL_HORIZON_STABLE_FRAMES * 2);
      }
      expect(admission.sceneryCullFar(574)).toBe(360);
      while (admission.snapshot().active) {
        admission.advanceFromFrame(true, 700, null, 700, 10);
        expect(frames++).toBeLessThan(ENTRY_DETAIL_HORIZON_STABLE_FRAMES * 8);
      }
      expect(admission.sceneryCullFar(950)).toBe(950);
      admission.arm(700, false);
      expect(admission.sceneryCullFar(574)).toBe(574);
    });

    it('holds at the open ring on the frames the horizon cannot tick, and reports it', () => {
      const admission = new EntryDetailHorizonAdmission(700);
      admission.arm(700, true);
      for (let i = 0; i < ENTRY_DETAIL_HORIZON_STABLE_FRAMES * 2; i++) {
        admission.advanceFromFrame(false, 700, null, 700, 10);
      }
      expect(admission.snapshot().cap).toBe(700);
      expect(admission.snapshot().sceneryCap).toBe(240);
      expect(admission.sceneryCullFar(574)).toBe(240);
      admission.arm(700, false);
      expect(admission.snapshot().sceneryCap).toBeNull();
    });

    it('is what the renderer hands the four reveal-gated painters at both frame sites', () => {
      const source = readFileSync('src/render/renderer.ts', 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      const prewarmStart = source.indexOf('private prewarmWorldFrame(');
      const prewarmFrame = source.slice(
        prewarmStart,
        source.indexOf('this.fish.update(', prewarmStart),
      );
      const liveStart = source.indexOf(
        'const sceneryFar = this.entryDetailHorizon.sceneryCullFar(fogFar);',
      );
      expect(liveStart).toBeGreaterThan(prewarmStart);
      const liveFrame = source.slice(liveStart, source.indexOf('this.fish.update(', liveStart));
      const painters = ['propsView', 'eastbrookTownView', 'fenbridgeTownView', 'foliage'];
      for (const painter of painters) {
        const inPrewarm = prewarmFrame.slice(prewarmFrame.indexOf(`this.${painter}.update(`));
        expect(inPrewarm.slice(0, inPrewarm.indexOf(');'))).toContain(
          'this.entryDetailHorizon.sceneryCullFar(fogFar)',
        );
        const inLive = liveFrame.slice(liveFrame.indexOf(`this.${painter}.update(`));
        expect(inLive.slice(0, inLive.indexOf(');'))).toContain('sceneryFar');
      }
      // Exactly the four painters, no raw fogFar left in their calls, at each site.
      expect(prewarmFrame.split('this.entryDetailHorizon.sceneryCullFar(fogFar)').length - 1).toBe(
        painters.length,
      );
      expect(liveFrame.split('sceneryFar,').length - 1).toBe(painters.length);
      // Terrain keeps the wide cull far at both sites: the same literal call, twice.
      const terrainCall =
        'this.terrainView.update(this.camera.position.x, this.camera.position.z, fogFar);';
      expect(source.split(terrainCall).length - 1).toBe(2);
      expect(source).not.toContain(
        'this.terrainView.update(this.camera.position.x, this.camera.position.z, sceneryFar',
      );
    });
  });
});
