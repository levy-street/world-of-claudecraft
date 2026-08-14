// The extracted delve interior scheduler (src/render/delve_interior_scheduler,
// moved out of renderer.ts at farming Phase 7 under the monolith ratchet). The
// move was verbatim, but until this suite the module had no direct consumer in
// tests: these arms pin the scheduling rules over a fake DelveInteriorCtx so a
// drift in the key space or the in-flight set reds here, not as a double-build
// hitch in a live delve.
import { describe, expect, it, vi } from 'vitest';

const buildStub = vi.hoisted(() => ({
  calls: [] as Array<{ moduleId: string; ox: number; oz: number }>,
  mode: 'resolve' as 'resolve' | 'reject',
}));
vi.mock('../src/render/delve_interiors', () => ({
  buildDelveModule: (_dungeons: unknown, moduleId: string, ox: number, oz: number) => {
    buildStub.calls.push({ moduleId, ox, oz });
    return buildStub.mode === 'resolve'
      ? Promise.resolve()
      : Promise.reject(new Error('synthetic build failure'));
  },
}));
vi.mock('../src/render/interior_kit', () => ({
  ensureDelveInteriorKit: () => Promise.resolve(),
}));

import {
  buildAllDelveModules,
  type DelveInteriorCtx,
  ensureDelveInteriorsNear,
  prebuildDelveInteriors,
  scheduleDelveModuleBuild,
} from '../src/render/delve_interior_scheduler';
import type { DungeonInteriors } from '../src/render/dungeon';
import {
  DELVE_MODULE_Z_START,
  defaultDelveModules,
  delveAt,
  delveModuleZOffset,
  delveOrigin,
} from '../src/sim/data';
import type { DelveModuleId } from '../src/sim/delve_layout';
import type { DelveRunInfo } from '../src/world_api/delves';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeCtx(run: DelveRunInfo | null = null): DelveInteriorCtx {
  return {
    dungeons: () => ({}) as DungeonInteriors,
    built: new Set<string>(),
    pending: new Set<string>(),
    run: () => run,
  };
}

describe('scheduleDelveModuleBuild', () => {
  it('schedules once, moves the key pending to built on resolve', async () => {
    buildStub.calls.length = 0;
    buildStub.mode = 'resolve';
    const ctx = fakeCtx();
    scheduleDelveModuleBuild(ctx, 'k1', 'mod_a' as DelveModuleId, 10, 20);
    expect(ctx.pending.has('k1')).toBe(true);
    // Re-scheduling while in flight must not double-build.
    scheduleDelveModuleBuild(ctx, 'k1', 'mod_a' as DelveModuleId, 10, 20);
    expect(buildStub.calls).toHaveLength(1);
    await flush();
    expect(ctx.built.has('k1')).toBe(true);
    expect(ctx.pending.has('k1')).toBe(false);
    // Built keys never rebuild.
    scheduleDelveModuleBuild(ctx, 'k1', 'mod_a' as DelveModuleId, 10, 20);
    expect(buildStub.calls).toHaveLength(1);
  });

  it('clears the in-flight claim on a failed build so a retry stays possible', async () => {
    buildStub.calls.length = 0;
    buildStub.mode = 'reject';
    const ctx = fakeCtx();
    scheduleDelveModuleBuild(ctx, 'k2', 'mod_a' as DelveModuleId, 0, 0);
    await flush();
    expect(ctx.built.has('k2'), 'a failed build must not read as built').toBe(false);
    expect(ctx.pending.has('k2'), 'a failed build must release its claim').toBe(false);
    buildStub.mode = 'resolve';
    scheduleDelveModuleBuild(ctx, 'k2', 'mod_a' as DelveModuleId, 0, 0);
    expect(buildStub.calls).toHaveLength(2);
  });
});

describe('buildAllDelveModules and prebuildDelveInteriors', () => {
  it('keys every module as delve:<id>:<slot>:<module> at its stacked z offset', () => {
    buildStub.calls.length = 0;
    buildStub.mode = 'resolve';
    const ctx = fakeCtx();
    const modules = ['m_one', 'm_two'] as unknown as readonly DelveModuleId[];
    buildAllDelveModules(ctx, 'the_delve', 3, { x: 100, z: 200 }, modules);
    expect([...ctx.pending].sort()).toEqual(['delve:the_delve:3:m_one', 'delve:the_delve:3:m_two']);
    expect(buildStub.calls.map((c) => c.oz)).toEqual([
      200 + delveModuleZOffset(modules, 0),
      200 + delveModuleZOffset(modules, 1),
    ]);
    expect(buildStub.calls.every((c) => c.ox === 100)).toBe(true);
  });

  it('prebuild is a no-op off-run and builds the whole stack on its own run', () => {
    buildStub.calls.length = 0;
    const run = {
      delveId: 'the_delve',
      slot: 1,
      origin: { x: 5, z: 9 },
      modules: ['m_one'] as unknown as DelveRunInfo['modules'],
    } as DelveRunInfo;
    prebuildDelveInteriors(fakeCtx(null), 'the_delve');
    expect(buildStub.calls).toHaveLength(0);
    prebuildDelveInteriors(fakeCtx(run), 'a_different_delve');
    expect(buildStub.calls).toHaveLength(0);
    prebuildDelveInteriors(fakeCtx(run), 'the_delve');
    expect(buildStub.calls).toHaveLength(1);
  });
});

describe('ensureDelveInteriorsNear', () => {
  it('does nothing away from any delve band', () => {
    buildStub.calls.length = 0;
    ensureDelveInteriorsNear(fakeCtx(), -1_000_000, 0);
    expect(buildStub.calls).toHaveLength(0);
  });

  it('builds the default stack for a player standing inside a live band', () => {
    buildStub.calls.length = 0;
    const origin = delveOrigin(0, 0);
    const delve = delveAt(origin.x);
    expect(delve, 'the slot-0 origin must sit inside its own delve band').toBeTruthy();
    if (!delve) return;
    const modules = defaultDelveModules(delve.id) as DelveModuleId[];
    expect(modules.length).toBeGreaterThan(0);
    const ctx = fakeCtx();
    ensureDelveInteriorsNear(ctx, origin.x, origin.z + DELVE_MODULE_Z_START + 5);
    expect(buildStub.calls.length).toBe(modules.length);
    expect(ctx.pending.size).toBe(modules.length);
    // Out of the band on z (before the first module): nothing schedules.
    buildStub.calls.length = 0;
    ensureDelveInteriorsNear(fakeCtx(), origin.x, origin.z + DELVE_MODULE_Z_START - 31);
    expect(buildStub.calls).toHaveLength(0);
  });
});
