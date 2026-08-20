import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { presentFrame } from '../src/render/frame_present';
import { gpuPrepEventsSnapshot, resetGpuPrepEventsForTest } from '../src/render/gpu_prep_events';
import * as liveProgramWatch from '../src/render/live_program_watch';
import {
  armLiveProgramWatch,
  recordNewLivePrograms,
  resetLiveProgramWatchForTest,
} from '../src/render/live_program_watch';
import {
  absorbLivePrograms as absorbCore,
  armLiveProgramWatch as armCore,
  collectNewLivePrograms,
  createLiveProgramWatch,
  type LiveProgramEntry,
  liveProgramIdentity,
} from '../src/render/live_program_watch_core';

const program = (id: number, name: string): LiveProgramEntry => ({
  id,
  name,
  cacheKey: `${name}|${id}`,
});

function infoHost(programs: LiveProgramEntry[]) {
  return { info: { programs, memory: { textures: 0 } } };
}

describe('liveProgramWatch core', () => {
  it('reports nothing before the arm, however many programs boot links', () => {
    const watch = createLiveProgramWatch();
    const out: string[] = [];

    expect(collectNewLivePrograms(watch, [program(1, 'MeshStandardMaterial')], out)).toBe(0);
    expect(out).toEqual([]);
  });

  it('reports only what appears after the arm, once each', () => {
    const watch = createLiveProgramWatch();
    const programs = [program(1, 'MeshStandardMaterial'), program(2, 'MeshBasicMaterial')];
    armCore(watch, programs);
    const out: string[] = [];

    // A frame that links nothing.
    expect(collectNewLivePrograms(watch, programs, out)).toBe(0);

    programs.push(program(3, 'MeshLambertMaterial'));
    expect(collectNewLivePrograms(watch, programs, out)).toBe(1);
    expect(out).toEqual(['MeshLambertMaterial']);

    // Same list on the next frame: reported once, never again.
    expect(collectNewLivePrograms(watch, programs, out)).toBe(0);
  });

  it('walks only when the list GREW, which is the per-frame cost', () => {
    const watch = createLiveProgramWatch();
    const programs = [program(1, 'MeshStandardMaterial')];
    armCore(watch, programs);
    let reads = 0;
    const counted = new Proxy(programs, {
      get(target, key, receiver) {
        if (key === Symbol.iterator) reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    const out: string[] = [];

    collectNewLivePrograms(watch, counted, out);
    expect(reads).toBe(0);

    programs.push(program(2, 'MeshBasicMaterial'));
    collectNewLivePrograms(watch, counted, out);

    expect(reads).toBe(1);
    expect(out).toEqual(['MeshBasicMaterial']);
  });

  it('still reports a program relinked after three released one', () => {
    const watch = createLiveProgramWatch();
    const programs = [program(1, 'MeshStandardMaterial'), program(2, 'MeshBasicMaterial')];
    armCore(watch, programs);
    const out: string[] = [];

    // The last material of #2 was disposed, so three dropped its program.
    programs.pop();
    expect(collectNewLivePrograms(watch, programs, out)).toBe(0);
    // A later draw links the same variant again: a NEW id, so it is news.
    programs.push(program(7, 'MeshBasicMaterial'));

    expect(collectNewLivePrograms(watch, programs, out)).toBe(1);
    expect(out).toEqual(['MeshBasicMaterial']);
  });

  it('remembers a program by its link id, not by its cache key', () => {
    // A released and relinked program keeps its cache key and takes a fresh
    // id, and that difference is the whole point of the identity.
    expect(liveProgramIdentity({ id: 4, cacheKey: 'k', name: 'n' })).toBe('#4');
    expect(liveProgramIdentity({ cacheKey: 'k', name: 'n' })).toBe('k');
    expect(liveProgramIdentity({ name: 'n' })).toBe('n');
  });
});

describe('liveProgramWatch core, absorb before the draw', () => {
  it('adopts what compile prologues minted between two draws as prep, not escapes', () => {
    const watch = createLiveProgramWatch();
    const programs = [program(1, 'MeshStandardMaterial')];
    armCore(watch, programs);
    const out: string[] = [];

    // A gate's compileAsync prologue pushed a program between two frames.
    programs.push(program(2, 'MeshLambertMaterial'));
    absorbCore(watch, programs);
    expect(collectNewLivePrograms(watch, programs, out)).toBe(0);

    // The draw itself minted one: that is the escape.
    programs.push(program(3, 'MeshBasicMaterial'));
    expect(collectNewLivePrograms(watch, programs, out)).toBe(1);
    expect(out).toEqual(['MeshBasicMaterial']);
  });
});

describe('the renderer-facing watch', () => {
  afterEach(() => {
    resetGpuPrepEventsForTest();
    // The watch is module state: without the disarm, the next case's arm sits
    // on the previous case's baseline.
    resetLiveProgramWatchForTest();
  });

  it('records one live-program event per program minted after the reveal', () => {
    resetGpuPrepEventsForTest();
    const programs = [program(1, 'MeshStandardMaterial')];
    const webgl = infoHost(programs);

    // Boot: linked behind the curtain, so nothing is recorded.
    recordNewLivePrograms(webgl);
    armLiveProgramWatch(webgl);
    programs.push(program(2, 'MeshPhysicalMaterial'));
    recordNewLivePrograms(webgl);
    recordNewLivePrograms(webgl);

    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.counts['live-program']).toBe(1);
    const event = snapshot.events.at(-1);
    expect(event?.kind).toBe('live-program');
    expect(event?.key).toBe('MeshPhysicalMaterial');
    expect(event?.ageMs).toBe(0);
  });

  it('rides the present host: the renderer injects the module, a bare host draws unwatched', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(source).toContain('programWatch: liveProgramWatch,');
    resetGpuPrepEventsForTest();
    const programs = [program(1, 'MeshStandardMaterial')];
    armLiveProgramWatch(infoHost(programs));
    const bare = {
      vfx: { prepareDraw(): void {} },
      post: null,
      webgl: {
        info: { programs },
        render(): void {
          programs.push(program(2, 'MeshBasicMaterial'));
        },
      },
      scene: {},
      camera: {},
    };
    expect(presentFrame(bare, 1 / 60, true)).toBe(true);
    expect(gpuPrepEventsSnapshot().counts['live-program']).toBe(0);
  });

  it('is armed from the renderer reveal receipt', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const reveal = source.indexOf('markGpuHitchReveal(): void {');
    expect(reveal).toBeGreaterThan(-1);
    expect(source.slice(reveal, source.indexOf('\n  }', reveal))).toContain(
      'armLiveProgramWatch(this.webgl)',
    );
  });

  it('brackets exactly the render call: prologue mints are prep, draw mints are escapes', () => {
    resetGpuPrepEventsForTest();
    const programs = [program(1, 'MeshStandardMaterial')];
    const webgl = {
      info: { programs },
      render(): void {
        programs.push(program(3, 'MeshBasicMaterial'));
      },
    };
    armLiveProgramWatch(infoHost(programs));
    // Between two frames a compileAsync prologue minted a program.
    programs.push(program(2, 'MeshLambertMaterial'));
    const host = {
      vfx: { prepareDraw(): void {} },
      post: null,
      webgl,
      scene: {},
      camera: {},
      // The renderer hands the module itself to its present host.
      programWatch: liveProgramWatch,
    };
    expect(presentFrame(host, 1 / 60, true)).toBe(true);

    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.counts['live-program']).toBe(1);
    expect(snapshot.events.at(-1)?.key).toBe('MeshBasicMaterial');
    // A skipped frame draws nothing and records nothing.
    programs.push(program(4, 'MeshPhongMaterial'));
    expect(presentFrame(host, 1 / 60, false)).toBe(false);
    expect(gpuPrepEventsSnapshot().counts['live-program']).toBe(1);
  });

  it('adopts what a SKIPPED frame minted, so the next real draw does not blame it', () => {
    resetGpuPrepEventsForTest();
    const programs = [program(1, 'MeshStandardMaterial')];
    const webgl = {
      info: { programs },
      render(): void {},
    };
    armLiveProgramWatch(infoHost(programs));
    const host = {
      vfx: { prepareDraw(): void {} },
      post: null,
      webgl,
      scene: {},
      camera: {},
      // The renderer hands the module itself to its present host.
      programWatch: liveProgramWatch,
    };

    // A hidden window: a gate's compileAsync prologue keeps minting while
    // nothing draws.
    programs.push(program(2, 'MeshLambertMaterial'));
    expect(presentFrame(host, 1 / 60, false)).toBe(false);

    // Already adopted by the skipped frame itself, which is what the absorb
    // ahead of the skip buys: the recorder the drawing arm ends on has
    // nothing to say about it, whoever calls it next.
    recordNewLivePrograms(webgl);
    expect(gpuPrepEventsSnapshot().counts['live-program']).toBe(0);

    // And the next real draw, which links nothing of its own, reports nothing.
    expect(presentFrame(host, 1 / 60, true)).toBe(true);
    expect(gpuPrepEventsSnapshot().counts['live-program']).toBe(0);
  });
});
