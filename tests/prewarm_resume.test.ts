import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONSTRAINED_PREWARM_KEEP, skyAssetInlineWaitMs } from '../src/render/prewarm_policy';
import {
  buildPrewarmCompileUnits,
  type PrewarmResumeEntry,
  resumeDroppedPrewarmEntries,
  settlePrewarmBeforePublish,
  trackPrefetch,
  waitForPrefetch,
} from '../src/render/prewarm_resume';

function entry(id: string, unitIds: readonly string[]): PrewarmResumeEntry {
  return {
    id,
    units: unitIds.map((unitId) => ({ id: unitId, run: async () => {} })),
  };
}

describe('resumeDroppedPrewarmEntries', () => {
  it('resumes bounded units in manifest order with an idle slot before every unit', async () => {
    const events: string[] = [];
    const dropped: PrewarmResumeEntry[] = [
      {
        id: 'foliage.materials',
        units: ['oak', 'pine'].map((id) => ({
          id,
          run: async () => {
            events.push(`run:${id}`);
          },
        })),
      },
      {
        id: 'programs.compile',
        units: [
          {
            id: 'wolf',
            run: async () => {
              events.push('run:wolf');
            },
          },
        ],
      },
    ];

    await resumeDroppedPrewarmEntries(dropped, {
      idleSlot: async () => {
        events.push('idle');
      },
      afterEntry: (item) => events.push(`after:${item.id}`),
    });

    expect(events).toEqual([
      'idle',
      'run:oak',
      'idle',
      'run:pine',
      'after:foliage.materials',
      'idle',
      'run:wolf',
      'after:programs.compile',
    ]);
  });

  it('continues with later units and entries after one unit fails', async () => {
    const ran: string[] = [];
    const failures: string[] = [];
    await resumeDroppedPrewarmEntries(
      [
        {
          id: 'programs.compile',
          units: [
            { id: 'bad', run: async () => Promise.reject(new Error('boom')) },
            {
              id: 'good',
              run: async () => {
                ran.push('good');
              },
            },
          ],
        },
        {
          id: 'later',
          units: [
            {
              id: 'last',
              run: async () => {
                ran.push('last');
              },
            },
          ],
        },
      ],
      {
        idleSlot: async () => {},
        onUnitError: (item, unit) => failures.push(`${item.id}:${unit.id}`),
      },
    );
    expect(failures).toEqual(['programs.compile:bad']);
    expect(ran).toEqual(['good', 'last']);
  });

  it('does nothing for empty entries and never runs an unbounded entry callback', async () => {
    let idles = 0;
    await resumeDroppedPrewarmEntries([entry('empty', [])], {
      idleSlot: async () => {
        idles++;
      },
    });
    expect(idles).toBe(0);
  });

  it('allows each resumed unit to enter a shared scheduler', async () => {
    const events: string[] = [];
    await resumeDroppedPrewarmEntries([entry('textures', ['one', 'two'])], {
      idleSlot: async () => {
        events.push('idle');
      },
      runUnit: async (unit) => {
        events.push(`scheduled:${unit.id}`);
        await unit.run();
      },
    });
    expect(events).toEqual(['idle', 'scheduled:one', 'idle', 'scheduled:two']);
  });

  it('materializes one executable compile unit per unique archetype root', async () => {
    const player = { id: 'player' };
    const mob = { id: 'mob' };
    const compiled: string[] = [];
    const units = buildPrewarmCompileUnits(
      [
        { id: 'players', roots: [player] },
        { id: 'mobs', roots: [mob, player] },
      ],
      async (root) => {
        compiled.push(root.id);
      },
    );

    expect(units.map((unit) => unit.id)).toEqual(['players:0', 'mobs:0']);
    await units[0].run();
    expect(compiled).toEqual(['player']);
    await units[1].run();
    expect(compiled).toEqual(['player', 'mob']);
  });

  it('skips a root whose every dedupe key was already covered', async () => {
    // Hundreds of material-bearing leaves share programs (surfaceMat dedupes
    // materials): a root contributing no unseen key links nothing new, so it
    // must not cost a unit (each awaited compileAsync has a 10 ms poll floor).
    const first = { id: 'a', mats: ['stone'] };
    const duplicate = { id: 'b', mats: ['stone'] };
    const fresh = { id: 'c', mats: ['stone', 'moss'] };
    const compiled: string[] = [];
    const units = buildPrewarmCompileUnits(
      [{ id: 'scene', roots: [first, duplicate, fresh] }],
      async (root) => {
        compiled.push(root.id);
      },
      { dedupeKeys: (root) => root.mats },
    );
    expect(units.map((unit) => unit.id)).toEqual(['scene:0', 'scene:1']);
    for (const unit of units) await unit.run();
    expect(compiled).toEqual(['a', 'c']);
  });

  it('batches roots into one unit that awaits its compiles together', async () => {
    // r165 compileAsync resolves after N x 10 ms of setTimeout polling: awaited
    // one by one, the floors stack; awaited together, they overlap. The batch
    // still resolves only when every compile settles.
    const roots = ['a', 'b', 'c'].map((id) => ({ id }));
    const started: string[] = [];
    const release: Array<() => void> = [];
    const units = buildPrewarmCompileUnits(
      [{ id: 'scene', roots }],
      (root) =>
        new Promise<void>((resolve) => {
          started.push(root.id);
          release.push(resolve);
        }),
      { batchSize: 2 },
    );
    expect(units.map((unit) => unit.id)).toEqual(['scene:0', 'scene:1']);

    let firstDone = false;
    const firstRun = units[0].run();
    void Promise.resolve(firstRun).then(() => {
      firstDone = true;
    });
    await Promise.resolve();
    // Both compiles of the batch started before either resolved.
    expect(started).toEqual(['a', 'b']);
    release.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(firstDone).toBe(false);
    release.shift()?.();
    await firstRun;
    expect(firstDone).toBe(true);

    await Promise.all([units[1].run(), Promise.resolve().then(() => release.shift()?.())]);
    expect(started).toEqual(['a', 'b', 'c']);
  });

  it('never overlaps a compile that outlives its idle slot', async () => {
    let active = 0;
    let maxActive = 0;
    const release: Array<() => void> = [];
    const units = buildPrewarmCompileUnits(
      [{ id: 'programs', roots: [{ id: 'a' }, { id: 'b' }] }],
      () =>
        new Promise<void>((resolve) => {
          active++;
          maxActive = Math.max(maxActive, active);
          release.push(() => {
            active--;
            resolve();
          });
        }),
    );
    const run = resumeDroppedPrewarmEntries([{ id: 'programs.compile', units }], {
      idleSlot: async () => {},
    });

    await Promise.resolve();
    expect(release).toHaveLength(1);
    release.shift()?.();
    for (let turn = 0; turn < 10 && release.length === 0; turn++) await Promise.resolve();
    expect(release).toHaveLength(1);
    release.shift()?.();
    await run;
    expect(maxActive).toBe(1);
  });

  it('publishes only after resumed work settles', async () => {
    let release!: () => void;
    let publications = 0;
    const settled = settlePrewarmBeforePublish(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      () => {
        publications++;
      },
    );

    await Promise.resolve();
    expect(publications).toBe(0);
    release();
    await settled;
    expect(publications).toBe(1);
  });

  it('publishes exactly once when resumed work rejects', async () => {
    let publications = 0;
    const settled = settlePrewarmBeforePublish(
      async () => {
        throw new Error('resume failed');
      },
      () => {
        publications++;
      },
    );

    await expect(settled).rejects.toThrow('resume failed');
    expect(publications).toBe(1);
  });

  it('wires the production compile resume lane to bounded units', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const unitsStart = source.indexOf('const compileEntryUnits =');
    const unitsEnd = source.indexOf('const runEntry =', unitsStart);
    const unitsSlice = source.slice(unitsStart, unitsEnd);
    const compileEntryStart = source.indexOf("id: 'programs.compile'");
    const compileEntryEnd = source.indexOf("id: 'sky.current-zone'", compileEntryStart);
    const compileEntry = source.slice(compileEntryStart, compileEntryEnd);
    const resumeStart = compileEntry.indexOf('resumeUnits: () => {');
    const runStart = compileEntry.indexOf('run: async () => {', resumeStart);
    const resumeSlice = compileEntry.slice(resumeStart, runStart);

    expect(compileEntryStart).toBeGreaterThan(-1);
    expect(compileEntryEnd).toBeGreaterThan(compileEntryStart);
    expect(resumeStart).toBeGreaterThan(-1);
    expect(runStart).toBeGreaterThan(resumeStart);
    expect(unitsSlice.match(/buildPrewarmCompileUnits\(/g)).toHaveLength(1);
    expect(resumeSlice).toContain('return compileEntryUnits()');
    expect(unitsStart).toBeGreaterThan(-1);
    expect(unitsEnd).toBeGreaterThan(unitsStart);
    expect(unitsSlice).toContain('if (visibleOnly) root.traverseVisible(collect)');
    expect(unitsSlice).toContain('else root.traverse(collect)');
    expect(unitsSlice).toContain('roots: compileRoots(group.children, false)');
    expect(unitsSlice).toContain('await this.compilePrewarmColorPrograms(root, false)');
    expect(unitsSlice).toContain('await this.compileShadowPrograms(root)');
    expect(compileEntry).not.toContain('compileAsync(this.scene');
    expect(compileEntry).not.toContain('Promise.race');
    expect(source).toContain('void settlePrewarmBeforePublish(');
    expect(source).toContain('resumeDroppedPrewarmEntries(resume, {');
    expect(source).toContain(
      'this.backgroundGpuWork.run(unit.run, GPU_WORK_PRIORITY.BOOT_RESUME, unit.id)',
    );
    expect(source).toContain('const units = entry.resumeUnits?.() ?? [];');
    expect(source).toContain('droppedEntries.push({ id: entry.id, units })');
    expect(resumeSlice).toContain('deferPoolPublication =');
    expect(source).toContain(
      'cleanupPrewarmArtifacts({ clearVfx: true, publishPools: !deferPoolPublication })',
    );
    expect(source).toContain('cleanupPrewarmArtifacts({ clearVfx: false, publishPools: true })');
  });

  it('retains dropped texture uploads as one explicit idle unit per unique texture', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const helperStart = source.indexOf('const textureResumeUnits = (');
    const helperEnd = source.indexOf('\n\n    const manifest:', helperStart);
    const helper = source.slice(helperStart, helperEnd);
    const surfaceStart = source.indexOf("id: 'surface-detail.textures'");
    const surfaceEnd = source.indexOf("id: 'weather.materials'", surfaceStart);
    const surface = source.slice(surfaceStart, surfaceEnd);
    const sceneStart = source.indexOf("id: 'textures.scene'");
    const sceneEnd = source.indexOf("id: 'vfx.atlas'", sceneStart);
    const scene = source.slice(sceneStart, sceneEnd);

    expect(helper).toContain('new Set(textures)');
    expect(helper).toContain('run: () => this.prewarmTexture(texture)');
    expect(surface).toContain("textureResumeUnits('surface-detail'");
    expect(scene).toContain("textureResumeUnits('scene', this.collectInitialSceneTextures())");
    expect(surface).not.toContain('renderPrewarmPass');
    expect(scene).not.toContain('renderPrewarmPass');
  });

  // Weapon-skin rigs are worn by OTHER players, so nothing at boot draws one
  // and their programs otherwise link on the first sighting, mid-gameplay.
  it('warms the weapon-skin VFX programs as small resumable units', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const start = source.indexOf("id: 'vfx.weapon-skins'");
    const end = source.indexOf("id: 'vfx.ability-primitives'", start);
    const entry = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(entry).toContain("category: 'vfx'");
    expect(entry).toContain('required: false');
    // Three explicitly bounded units, never a whole-entry rerun.
    expect(entry).toContain("id: 'weapon-skins:group'");
    expect(entry).toContain("id: 'weapon-skins:textures'");
    expect(entry).toContain("id: 'weapon-skins:compile'");
    expect(entry).toContain('await this.compilePrewarmColorPrograms(weaponVfxPrewarmGroup, false)');
    expect(entry.match(/buildWeaponVfxPrewarmGroup\(\)/g)).toHaveLength(2); // run + resume unit
    expect(entry).toContain('for (const texture of weaponVfxPrewarmTextures()) ');
    // The sky dome is not warmed: the world path builds none any more.
    expect(entry).not.toContain('skyTex');

    // The staged group is torn out of the scene by both cleanup paths and
    // hidden between resumed entries, exactly like every other prewarm group.
    expect(source).toContain('if (weaponVfxPrewarmGroup) this.scene.remove(weaponVfxPrewarmGroup)');
    expect(source).toContain('weaponVfxPrewarmGroup = null;');
    const hideStart = source.indexOf('const hidePrewarmArtifacts = ');
    const hideEnd = source.indexOf('const cleanupPrewarmArtifacts = ', hideStart);
    expect(source.slice(hideStart, hideEnd)).toContain('weaponVfxPrewarmGroup,');
    // A dropped programs.compile still links it from its own bounded unit.
    expect(source).toContain("['weapon-vfx', weaponVfxPrewarmGroup],");
  });

  it('leaves the weapon-skin warm off the constrained keep-list', () => {
    expect(CONSTRAINED_PREWARM_KEEP).not.toContain('vfx.weapon-skins');
  });
});

describe('trackPrefetch', () => {
  it('observes resolution synchronously after settlement', async () => {
    let resolveTask: () => void = () => {};
    const prefetch = trackPrefetch(
      new Promise<void>((resolve) => {
        resolveTask = resolve;
      }),
    );
    expect(prefetch.isSettled()).toBe(false);
    expect(prefetch.rejection()).toBeNull();
    resolveTask();
    await prefetch.task;
    expect(prefetch.isSettled()).toBe(true);
    expect(prefetch.rejection()).toBeNull();
  });

  it('records a rejection without leaking an unhandled rejection', async () => {
    const failure = new Error('fetch failed');
    const prefetch = trackPrefetch(Promise.reject(failure));
    await Promise.resolve();
    await Promise.resolve();
    expect(prefetch.isSettled()).toBe(true);
    expect(prefetch.rejection()).toBe(failure);
    // The raw task still rejects for callers that await it deliberately.
    await expect(prefetch.task).rejects.toBe(failure);
  });
});

describe('waitForPrefetch: a stalled fetch can never starve the compute budget', () => {
  it('returns pending after exactly the budgeted wait when the fetch stalls', async () => {
    // Fake-clock harness: the fetch NEVER resolves (a black-holed network),
    // the sleeper is the only thing that can end the wait, and it records the
    // budget it was given.
    const sleeps: number[] = [];
    let releaseSleep: () => void = () => {};
    const sleeper = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return new Promise((resolve) => {
        releaseSleep = resolve;
      });
    };
    const prefetch = trackPrefetch(new Promise<void>(() => {}));
    const wait = waitForPrefetch(prefetch, 9_000, sleeper);
    await Promise.resolve();
    expect(sleeps).toEqual([9_000]);
    releaseSleep();
    // The stalled fetch loses the race: the caller gets 'pending' and moves on
    // to the budget-hungry stages instead of blocking on the network. This is
    // the ordering fix: the pre-fix shape awaited the fetch unconditionally
    // and was measured eating 11.5s of the 12s boot budget.
    expect(await wait).toBe('pending');
    expect(prefetch.isSettled()).toBe(false);
  });

  it('budget composition: entry start plus wait always precedes deadline minus reserve', async () => {
    // The wait the renderer passes comes from skyAssetInlineWaitMs, so with a
    // stalled fetch the sky entry consumes AT MOST deadline - reserve - now.
    // Simulate the schedule with a virtual clock advanced only by sleeps.
    let clock = 1_000; // sky entry start
    const deadline = 13_000;
    const reserve = 3_000;
    const waitMs = skyAssetInlineWaitMs({
      nowMs: clock,
      deadlineMs: deadline,
      reserveMs: reserve,
      finishFullManifestBeforeReveal: false,
    });
    const sleeper = (ms: number): Promise<void> => {
      clock += ms;
      return Promise.resolve();
    };
    const outcome = await waitForPrefetch(
      trackPrefetch(new Promise<void>(() => {})),
      waitMs,
      sleeper,
    );
    expect(outcome).toBe('pending');
    // The compute/tail stages still start before the manifest deadline, with
    // the full reserve intact.
    expect(clock).toBeLessThanOrEqual(deadline - reserve);
  });

  it('returns ready without sleeping when the prefetch already settled', async () => {
    const prefetch = trackPrefetch(Promise.resolve());
    await prefetch.task;
    let slept = false;
    const outcome = await waitForPrefetch(prefetch, 5_000, () => {
      slept = true;
      return Promise.resolve();
    });
    expect(outcome).toBe('ready');
    expect(slept).toBe(false);
  });

  it('returns ready when the fetch wins the race', async () => {
    let resolveTask: () => void = () => {};
    const prefetch = trackPrefetch(
      new Promise<void>((resolve) => {
        resolveTask = resolve;
      }),
    );
    const wait = waitForPrefetch(prefetch, 5_000, () => new Promise<void>(() => {}));
    resolveTask();
    expect(await wait).toBe('ready');
  });

  it('treats a settled rejection as ready so the caller surfaces the failure itself', async () => {
    const prefetch = trackPrefetch(Promise.reject(new Error('down')));
    await Promise.resolve();
    await Promise.resolve();
    expect(await waitForPrefetch(prefetch, 5_000)).toBe('ready');
  });

  it('a zero or negative budget never waits at all', async () => {
    let slept = false;
    const sleeper = (): Promise<void> => {
      slept = true;
      return Promise.resolve();
    };
    const prefetch = trackPrefetch(new Promise<void>(() => {}));
    expect(await waitForPrefetch(prefetch, 0, sleeper)).toBe('pending');
    expect(await waitForPrefetch(prefetch, -100, sleeper)).toBe('pending');
    expect(slept).toBe(false);
  });

  it('an Infinity budget awaits settlement outright (the finish-full-manifest arm)', async () => {
    let resolveTask: () => void = () => {};
    const prefetch = trackPrefetch(
      new Promise<void>((resolve) => {
        resolveTask = resolve;
      }),
    );
    let settled = false;
    const wait = waitForPrefetch(prefetch, Number.POSITIVE_INFINITY, () => {
      throw new Error('the unbounded arm must not consult the sleeper');
    }).then((outcome) => {
      settled = true;
      return outcome;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveTask();
    expect(await wait).toBe('ready');
  });
});
