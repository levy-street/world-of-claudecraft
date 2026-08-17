import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPrewarmResumeLedger } from '../src/render/prewarm_resume_ledger_core';

const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

const entry = (id: string, unitIds: string[]) => ({ id, units: unitIds.map((u) => ({ id: u })) });
const isDebt = (id: string): boolean => id.startsWith('programs.') || id === 'textures.scene';

describe('prewarm resume ledger', () => {
  it('keeps "nothing was dropped" distinct from "the lane ran and did nothing"', () => {
    const ledger = createPrewarmResumeLedger();
    expect(ledger.stats().status).toBe('none');
    ledger.schedule([], isDebt);
    expect(ledger.stats().status).toBe('none');
    // finish() on an empty schedule must not invent a completed lane: a reader
    // would then take "the resume lane is done" as evidence the dropped work
    // ran, when nothing was ever dropped.
    ledger.finish(true);
    expect(ledger.stats().status).toBe('none');
  });

  it('records the plan, the lane, and what actually started', () => {
    const ledger = createPrewarmResumeLedger();
    ledger.schedule(
      [
        entry('programs.compile', ['compile:0', 'compile:1']),
        entry('vfx.weapon-skins', ['group', 'textures', 'compile']),
      ],
      isDebt,
    );
    expect(ledger.stats()).toMatchObject({
      status: 'scheduled',
      plannedEntries: 2,
      plannedUnits: 5,
      startedUnits: 0,
      failedUnits: 0,
    });
    ledger.noteStart('programs.compile');
    ledger.noteStart('programs.compile');
    ledger.noteStart('vfx.weapon-skins');
    ledger.noteFailure('vfx.weapon-skins', 'group');
    ledger.finish(true);
    const stats = ledger.stats();
    expect(stats).toMatchObject({
      status: 'done',
      plannedUnits: 5,
      startedUnits: 3,
      failedUnits: 1,
      failedUnitIds: ['vfx.weapon-skins:group'],
    });
    // The lane matters: cosmetic resume runs under BOOT_RESUME and can be
    // starved for minutes, while debt runs under BOOT_DEBT. A report that could
    // not tell them apart could not tell a tolerable delay from a defect.
    expect(stats.entries).toEqual([
      { id: 'programs.compile', lane: 'debt', planned: 2, started: 2, failed: 0 },
      { id: 'vfx.weapon-skins', lane: 'cosmetic', planned: 3, started: 1, failed: 1 },
    ]);
    // A schedule that never drains stays visibly short of its plan: 1 of 3
    // started on the cosmetic entry is exactly the starvation shape.
    expect(stats.startedUnits).toBeLessThan(stats.plannedUnits);
  });

  it('records a lane that threw as failed, not as done', () => {
    const ledger = createPrewarmResumeLedger();
    ledger.schedule([entry('textures.scene', ['upload'])], isDebt);
    ledger.finish(false);
    expect(ledger.stats().status).toBe('failed');
  });

  it('ignores notes for an entry it was never given', () => {
    const ledger = createPrewarmResumeLedger();
    ledger.schedule([entry('programs.compile', ['compile:0'])], isDebt);
    ledger.noteStart('never.scheduled');
    ledger.noteFailure('never.scheduled', 'x');
    expect(ledger.stats()).toMatchObject({ startedUnits: 0, failedUnits: 0, failedUnitIds: [] });
  });

  it('bounds the failed-id list without hiding the count', () => {
    const ledger = createPrewarmResumeLedger({ failedUnitIdLimit: 2 });
    ledger.schedule([entry('programs.compile', ['a', 'b', 'c', 'd'])], isDebt);
    for (const unit of ['a', 'b', 'c', 'd']) ledger.noteFailure('programs.compile', unit);
    const stats = ledger.stats();
    expect(stats.failedUnitIds).toHaveLength(2);
    // The COUNT stays authoritative while the id list is a bounded sample, the
    // same asymmetry the manifest id lists already carry into the beacon.
    expect(stats.failedUnits).toBe(4);
  });

  it('is wired into the renderer as a GETTER, not a value captured at pass end', () => {
    // The behavioural test below builds its own getter, so on its own it proves
    // the SHAPE works and nothing about the production seam. Replace
    // renderer.ts's getter with `resume: resumeLedger.stats()` and every other
    // test here stays green while the beacon reports `scheduled` forever, which
    // is a plausible-looking row rather than a visible failure.
    const statsStart = renderer.indexOf('const stats: RendererPrewarmStats = {');
    expect(statsStart).toBeGreaterThan(-1);
    const literal = renderer.slice(statsStart, renderer.indexOf('\n    };', statsStart));
    expect(literal).toContain('get resume() {');
    expect(literal).toContain('return resumeLedger.stats();');
    // The failure mode spelled out, so a rename cannot quietly satisfy it.
    expect(literal).not.toMatch(/\bresume:\s*resumeLedger/);

    // Building it live is only half: the object then travels to
    // lastPrewarmStats and out through perfStats(), and a spread at either hop
    // would evaluate the getter once and freeze it, which is the same silent
    // `scheduled` row by another route.
    expect(renderer).toContain('this.lastPrewarmStats = stats;');
    expect(renderer).not.toMatch(/this\.lastPrewarmStats\s*=\s*\{\s*\.\.\./);
    expect(renderer).toContain('prewarm: this.lastPrewarmStats,');
    expect(renderer).not.toMatch(/prewarm:\s*\{\s*\.\.\.\s*this\.lastPrewarmStats/);
    expect(renderer).not.toMatch(/structuredClone\(\s*this\.lastPrewarmStats/);
    // Copying the stats INTO a fresh object is the dangerous shape. Mutating a
    // sub-object in place is not, and markGpuHitchReveal legitimately does that
    // to prewarmPacing, so the pin has to tell the two apart.
    expect(renderer).not.toMatch(/Object\.assign\(\s*\{[^)]*this\.lastPrewarmStats/);
    expect(renderer).toContain('Object.assign(\n        this.lastPrewarmStats.prewarmPacing,');
  });

  it('reads LIVE through a getter, so a spread cannot freeze it at scheduled', () => {
    // The resume lane is fire-and-forget: it settles long after the stats
    // object is built, which is why RendererPrewarmStats.resume is a getter.
    // Nothing else in the suite fails if a future contributor writes
    // `{ ...stats }` on the way to the beacon, and the symptom would be a
    // plausible-looking `scheduled` row forever rather than a crash.
    const ledger = createPrewarmResumeLedger();
    ledger.schedule([entry('programs.compile', ['a'])], isDebt);
    const stats = {
      get resume() {
        return ledger.stats();
      },
    };
    expect(stats.resume.status).toBe('scheduled');
    ledger.noteStart('programs.compile');
    ledger.finish(true);
    // Live read: the same object now reports the settled lane.
    expect(stats.resume.status).toBe('done');
    expect(stats.resume.startedUnits).toBe(1);
    // Serialisation must invoke it, because the beacon is JSON.
    expect(JSON.parse(JSON.stringify(stats)).resume.status).toBe('done');
    // A spread is what breaks it, and it breaks it silently: the copy keeps
    // whatever the lane happened to have done at that instant.
    const frozen = { ...stats };
    ledger.schedule([entry('textures.scene', ['b'])], isDebt);
    expect(stats.resume.plannedEntries).toBe(2);
    expect(frozen.resume.plannedEntries).toBe(1);
  });

  it('hands back copies, so a reader cannot mutate the ledger', () => {
    const ledger = createPrewarmResumeLedger();
    ledger.schedule([entry('programs.compile', ['a'])], isDebt);
    const first = ledger.stats();
    first.entries[0].started = 99;
    first.failedUnitIds.push('forged');
    expect(ledger.stats().entries[0].started).toBe(0);
    expect(ledger.stats().failedUnitIds).toEqual([]);
  });
});
