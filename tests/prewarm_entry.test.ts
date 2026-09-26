// A started boot-prewarm entry is fail-soft end to end: run(), progress() and
// resumePartialUnits() are one guarded unit. progress() used to be read outside
// the guard, so one entry's diagnostic callback throwing (the Warrior kit's
// recipe with its sheets not loaded yet) ended the whole manifest: every later
// entry was lost and the resume lane was never scheduled.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type PrewarmManifestEntry, runStartedPrewarmEntry } from '../src/render/prewarm_entry';
import {
  type PrewarmResumeEntry,
  type PrewarmResumeUnit,
  resumeDroppedPrewarmEntries,
} from '../src/render/prewarm_resume';

afterEach(() => vi.restoreAllMocks());

function entry(id: string, extra: Partial<PrewarmManifestEntry> = {}): PrewarmManifestEntry {
  return { id, category: 'vfx', priority: 1, required: false, run: () => {}, ...extra };
}

describe('runStartedPrewarmEntry', () => {
  it('keeps the manifest running and resumes the rest when a middle entry progress() throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ran: string[] = [];
    const resumed: string[] = [];
    const unit = (id: string): PrewarmResumeUnit => ({ id, run: () => void resumed.push(id) });
    const manifest = [
      entry('textures.scene', { run: () => void ran.push('textures.scene') }),
      entry('vfx.active-local-kit', {
        run: () => void ran.push('vfx.active-local-kit'),
        progress: () => {
          throw new Error('Authored contact texture is not loaded');
        },
        resumePartialUnits: () => [unit('kit:rest')],
      }),
      entry('vfx.ability-primitives', {
        run: () => void ran.push('vfx.ability-primitives'),
        progress: () => ({ done: 1, planned: 2, trimmed: true }),
        resumePartialUnits: () => [unit('primitives:rest')],
      }),
      entry('programs.compile', { run: () => void ran.push('programs.compile') }),
    ];
    // The renderer's manifest loop, reduced to what it does with an outcome.
    const statuses: string[] = [];
    const dropped: PrewarmResumeEntry[] = [];
    for (const e of manifest) {
      const outcome = await runStartedPrewarmEntry(e);
      statuses.push(outcome.status);
      if (outcome.partialUnits.length > 0) dropped.push({ id: e.id, units: outcome.partialUnits });
    }
    expect(ran).toEqual([
      'textures.scene',
      'vfx.active-local-kit',
      'vfx.ability-primitives',
      'programs.compile',
    ]);
    expect(statuses).toEqual(['completed', 'failed', 'partial', 'completed']);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      'Renderer prewarm entry failed: vfx.active-local-kit',
      expect.objectContaining({ message: 'Authored contact texture is not loaded' }),
    );
    await resumeDroppedPrewarmEntries(dropped, { idleSlot: async () => {} });
    expect(resumed).toEqual(['kit:rest', 'primitives:rest']);
  });

  it('reads progress and the partial remainder after a failed run()', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const progress = vi.fn(() => ({ done: 0, planned: 3, trimmed: true }));
    const outcome = await runStartedPrewarmEntry(
      entry('weather.materials', {
        run: async () => {
          throw new Error('link failed');
        },
        progress,
        resumePartialUnits: () => [{ id: 'weather:rest', run: () => {} }],
      }),
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.progress).toEqual({ done: 0, planned: 3, trimmed: true });
    expect(outcome.partialUnits.map((u) => u.id)).toEqual(['weather:rest']);
    expect(progress).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('records a throwing resumePartialUnits() as failed with nothing to resume', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const outcome = await runStartedPrewarmEntry(
      entry('props.material-variants', {
        progress: () => ({ done: 1, planned: 4, trimmed: true }),
        resumePartialUnits: () => {
          throw new Error('remainder unavailable');
        },
      }),
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.progress).toEqual({ done: 1, planned: 4, trimmed: true });
    expect(outcome.partialUnits).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'Renderer prewarm entry failed: props.material-variants',
      expect.objectContaining({ message: 'remainder unavailable' }),
    );
  });

  it('never asks a completed entry for a partial remainder, and ignores a throwing start hook', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resumePartialUnits = vi.fn(() => []);
    const run = vi.fn();
    const outcome = await runStartedPrewarmEntry(
      entry('views.required', {
        run,
        progress: () => ({ done: 2, planned: 2, trimmed: false }),
        resumePartialUnits,
      }),
      () => {
        throw new Error('diagnostics hook');
      },
    );
    expect(run).toHaveBeenCalledOnce();
    expect(outcome).toEqual({
      status: 'completed',
      progress: { done: 2, planned: 2, trimmed: false },
      partialUnits: [],
    });
    expect(resumePartialUnits).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports a null progress for an entry without the hook', async () => {
    const outcome = await runStartedPrewarmEntry(entry('sky.current-zone'));
    expect(outcome).toEqual({ status: 'completed', progress: null, partialUnits: [] });
  });
});

describe('the renderer manifest runs every started entry through the guard', () => {
  it('runEntry delegates run, progress and the partial remainder', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const start = source.indexOf('const runEntry = async (');
    const end = source.indexOf('const hidePrewarmArtifacts = ', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toContain('await runStartedPrewarmEntry(entry, () =>');
    expect(block).not.toContain('entry.run()');
    expect(block).not.toContain('entry.progress');
    expect(block).not.toContain('entry.resumePartialUnits');
  });
});
