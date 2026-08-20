import type * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DelveInteriorTracker } from '../src/render/delve_interior_tracker';
import type { DungeonInteriors } from '../src/render/dungeon';
import { delveModuleZOffset } from '../src/sim/data';
import type { DelveModuleId } from '../src/sim/delve_layout';

const buildDelveModuleMock = vi.hoisted(() => vi.fn());
const ensureDelveInteriorKitMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../src/render/delve_interiors', () => ({
  buildDelveModule: buildDelveModuleMock,
}));

vi.mock('../src/render/interior_kit', () => ({
  ensureDelveInteriorKit: ensureDelveInteriorKitMock,
}));

const group = (name: string) => ({ name }) as THREE.Group;

function deferredGroup() {
  let resolve!: (group: THREE.Group) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<THREE.Group>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushBuilds(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('DelveInteriorTracker', () => {
  beforeEach(() => {
    buildDelveModuleMock.mockReset();
    buildDelveModuleMock.mockImplementation(
      async (_dungeons: unknown, moduleId: DelveModuleId, ox: number, oz: number) => ({
        moduleId,
        ox,
        oz,
      }),
    );
    ensureDelveInteriorKitMock.mockClear();
  });

  it('rebuilds a rolled-back module after a stale replacement build rejects', async () => {
    const buildResults = [deferredGroup(), deferredGroup(), deferredGroup()];
    const builds = [...buildResults];
    buildDelveModuleMock.mockImplementation(() => {
      const build = builds.shift();
      if (!build) throw new Error('unexpected delve build');
      return build.promise;
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const retired: THREE.Group[] = [];
    const built = new Set<string>();
    const tracker = new DelveInteriorTracker(
      () => ({}) as DungeonInteriors,
      (stale) => retired.push(stale),
      built,
    );

    tracker.buildAll('run', 0, { x: 10, z: 20 }, ['litany_ring']);
    expect(buildDelveModuleMock).toHaveBeenCalledTimes(1);
    buildResults[0]?.resolve(group('old'));
    await flushBuilds();
    expect(built.has('delve:run:0:0')).toBe(true);

    tracker.buildAll('run', 0, { x: 10, z: 20 }, ['litany_sluice']);
    expect(buildDelveModuleMock).toHaveBeenCalledTimes(2);
    expect(retired.map((stale) => stale.name)).toEqual(['old']);
    expect(built.has('delve:run:0:0')).toBe(false);
    buildResults[1]?.reject(new Error('replacement failed'));
    await flushBuilds();

    tracker.buildAll('run', 0, { x: 10, z: 20 }, ['litany_ring']);
    expect(buildDelveModuleMock).toHaveBeenCalledTimes(3);
    expect(buildDelveModuleMock.mock.calls[2]?.[1]).toBe('litany_ring');

    warnSpy.mockRestore();
  });

  it('rebuilds the same litany_apse index when earlier modules change its computed z', async () => {
    const retire = vi.fn();
    const built = new Set<string>();
    const tracker = new DelveInteriorTracker(() => ({}) as DungeonInteriors, retire, built);
    const origin = { x: 24, z: 1_000 };
    const first: DelveModuleId[] = ['litany_sluice', 'litany_ledger', 'litany_ring', 'litany_apse'];
    const second: DelveModuleId[] = [
      'litany_sluice',
      'litany_baptistry',
      'litany_ring',
      'litany_apse',
    ];
    const apseKey = 'delve:drowned_litany:0:3';
    const firstApseOz = origin.z + delveModuleZOffset(first, 3);
    const secondApseOz = origin.z + delveModuleZOffset(second, 3);
    expect(secondApseOz).not.toBe(firstApseOz);

    tracker.buildAll('drowned_litany', 0, origin, first);
    await flushBuilds();

    const firstApseGroup = buildDelveModuleMock.mock.results[3]?.value
      ? await buildDelveModuleMock.mock.results[3].value
      : undefined;
    expect(built.has(apseKey)).toBe(true);

    tracker.buildAll('drowned_litany', 0, origin, second);
    await flushBuilds();

    const apseCalls = buildDelveModuleMock.mock.calls.filter(
      ([, moduleId]) => moduleId === 'litany_apse',
    );
    expect(apseCalls).toHaveLength(2);
    expect(apseCalls[0]?.slice(1, 4)).toEqual(['litany_apse', origin.x, firstApseOz]);
    expect(apseCalls[1]?.slice(1, 4)).toEqual(['litany_apse', origin.x, secondApseOz]);
    expect(retire).toHaveBeenCalledWith(firstApseGroup);
    expect(built.has(apseKey)).toBe(true);
  });
});
