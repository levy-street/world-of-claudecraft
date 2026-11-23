// What world entry does with the WOC player bodies under the curtain
// (src/render/characters/woc_entry_prepare.ts): the local player's own hairstyle and facial
// hair are given a bounded chance to settle before their body is built, and both body fits
// of every class are prepared, a slice at a time, so the first sighting of the other body
// type never measures and bakes it inside a live frame (PR 4360 review, S8). The clock and
// the yield are injected; the head store and prepareVisual are doubles.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareVisual, visualAssetsResident } from '../src/render/characters/assets';
import { DEFAULT_APPEARANCE } from '../src/render/characters/modular';
import { wocVisualKeys } from '../src/render/characters/woc_entry_core';
import {
  prepareWocEntry,
  prepareWocEntryVisuals,
  settleWocEntryLook,
  WOC_ENTRY_LOOK_WAIT_MS,
} from '../src/render/characters/woc_entry_prepare';
import { ensureWocHeadForAppearance } from '../src/render/characters/woc_head_packs';
import type { Entity } from '../src/sim/types';
import { ALL_CLASSES } from '../src/sim/types';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

/** The head store double: each file's state, set by the test. */
const store = vi.hoisted(() => ({ state: new Map<string, string>(), asks: [] as unknown[][] }));

vi.mock('../src/render/characters/assets', () => ({
  prepareVisual: vi.fn(),
  visualAssetsResident: vi.fn(() => true),
}));
vi.mock('../src/render/characters/woc_head_packs', () => ({
  // true once every file the look draws is resident (the store's own contract)
  ensureWocHeadForAppearance: vi.fn((...args: unknown[]) => {
    store.asks.push(args);
    return store.state.size > 0 && [...store.state.values()].every((s) => s === 'resident');
  }),
  wocHeadFileState: (url: string) => store.state.get(url) ?? 'idle',
}));

const DIR = 'models/chars/players/woc';
const CORE_A = `${DIR}/head_type_a_core.glb`;
const MOHAWK = `${DIR}/head_type_a_hair_mohawk.glb`;
const BEARDS = `${DIR}/head_type_a_beards.glb`;
const CORE_B = `${DIR}/head_type_b_core.glb`;
const BOB = `${DIR}/head_type_b_hair_bob.glb`;

const player = (app: Record<string, unknown> | null, over: Partial<Entity> = {}): Entity =>
  ({ kind: 'player', id: 1, templateId: 'mage', modularAppearance: app, ...over }) as Entity;

const male = player({ ...DEFAULT_APPEARANCE, headHair: 'mohawk', headBeard: 'goatee' });

/** A clock the waits advance, with what each wait asked for and a hook run before it. */
function fakeClock(onWait?: (waits: number) => void) {
  let t = 1_000;
  const waits: number[] = [];
  return {
    waits,
    advance: (ms: number) => {
      t += ms;
    },
    clock: {
      now: () => t,
      wait: async (ms: number) => {
        waits.push(ms);
        onWait?.(waits.length);
        t += ms;
      },
    },
  };
}

beforeEach(() => {
  store.state.clear();
  store.asks.length = 0;
  vi.mocked(prepareVisual).mockReset();
  vi.mocked(visualAssetsResident).mockReset().mockReturnValue(true);
  vi.mocked(ensureWocHeadForAppearance).mockClear();
});

describe('settleWocEntryLook', () => {
  it('answers at once when the look is already resident, asking for the player own fit', async () => {
    for (const url of [CORE_A, MOHAWK, BEARDS]) store.state.set(url, 'resident');
    const { clock, waits } = fakeClock();
    await expect(settleWocEntryLook(male, clock)).resolves.toBe(true);
    expect(waits).toEqual([]);
    expect(store.asks).toEqual([['male', male.modularAppearance]]);
  });

  it('waits for the files of the look it wears, and no other, to land', async () => {
    store.state.set(CORE_A, 'resident');
    store.state.set(MOHAWK, 'loading');
    store.state.set(BEARDS, 'loading');
    // a hairstyle nobody on this body wears is still on the wire the whole time
    store.state.set(`${DIR}/head_type_a_hair_quiff.glb`, 'loading');
    const { clock, waits } = fakeClock((n) => {
      if (n === 2) store.state.set(MOHAWK, 'resident');
      if (n === 3) store.state.set(BEARDS, 'resident');
    });
    await expect(settleWocEntryLook(male, clock)).resolves.toBe(true);
    expect(waits).toEqual([50, 50, 50]);
  });

  it('reads a female body on its own head type', async () => {
    const female = player({
      ...DEFAULT_APPEARANCE,
      gender: 'female',
      headHair: 'bob',
      headBeard: 'none',
    });
    store.state.set(CORE_B, 'resident');
    store.state.set(BOB, 'loading');
    // the other type's files are no part of her look
    store.state.set(MOHAWK, 'failed');
    const { clock, waits } = fakeClock((n) => {
      if (n === 1) store.state.set(BOB, 'resident');
    });
    await expect(settleWocEntryLook(female, clock)).resolves.toBe(true);
    expect(waits).toEqual([50]);
    expect(store.asks).toEqual([['female', female.modularAppearance]]);
  });

  it('stops waiting the moment a file of the look has failed', async () => {
    store.state.set(CORE_A, 'resident');
    store.state.set(MOHAWK, 'loading');
    store.state.set(BEARDS, 'loading');
    const { clock, waits } = fakeClock((n) => {
      if (n === 1) store.state.set(MOHAWK, 'failed');
    });
    // the beard is still on the wire: a dead request must not hold the entry for it
    await expect(settleWocEntryLook(male, clock)).resolves.toBe(false);
    expect(waits).toEqual([50]);
  });

  it('gives up at its bound when the files never settle', async () => {
    store.state.set(CORE_A, 'resident');
    store.state.set(MOHAWK, 'loading');
    store.state.set(BEARDS, 'loading');
    const { clock, waits } = fakeClock();
    const before = clock.now();
    await expect(settleWocEntryLook(male, clock)).resolves.toBe(false);
    // four seconds, as a literal: the bound is a decision, not whatever the constant says
    expect(WOC_ENTRY_LOOK_WAIT_MS).toBe(4000);
    expect(clock.now() - before).toBe(4000);
    expect(waits).toHaveLength(80);
  });

  it('has nothing to wait for on a body with no WOC head', async () => {
    const { clock, waits } = fakeClock();
    await expect(settleWocEntryLook(player(null, { skinCatalog: 'mech' }), clock)).resolves.toBe(
      true,
    );
    await expect(settleWocEntryLook(null, clock)).resolves.toBe(true);
    await expect(
      settleWocEntryLook({ kind: 'mob', templateId: 'forest_wolf' } as Entity, clock),
    ).resolves.toBe(true);
    expect(waits).toEqual([]);
    expect(store.asks).toEqual([]);
  });
});

describe('prepareWocEntryVisuals', () => {
  it('prepares both body fits of every class, each once', async () => {
    const { clock } = fakeClock();
    await expect(prepareWocEntryVisuals(clock)).resolves.toBe(ALL_CLASSES.length * 2);
    const prepared = vi.mocked(prepareVisual).mock.calls.map(([key]) => key);
    expect(prepared).toEqual(wocVisualKeys());
    for (const cls of ALL_CLASSES) {
      expect(prepared).toContain(`player_${cls}`);
      expect(prepared).toContain(`player_${cls}_female`);
    }
    // it only asks whether a body is resident: it never fetches one
    for (const call of vi.mocked(visualAssetsResident).mock.calls) expect(call[1]).toBe(false);
  });

  it('leaves a key whose files are not resident to its own first build', async () => {
    vi.mocked(visualAssetsResident).mockImplementation((key: string) => !key.endsWith('_female'));
    const { clock } = fakeClock();
    await expect(prepareWocEntryVisuals(clock)).resolves.toBe(ALL_CLASSES.length);
    const prepared = vi.mocked(prepareVisual).mock.calls.map(([key]) => key);
    expect(prepared.some((key) => key.endsWith('_female'))).toBe(false);
    expect(prepared).toHaveLength(ALL_CLASSES.length);
  });

  it('yields between slices: no slice starts a key once its time is spent', async () => {
    // a slow machine: every key is longer than a slice on its own
    const slow = fakeClock();
    vi.mocked(prepareVisual).mockImplementation(() => {
      slow.advance(30);
      return undefined as never;
    });
    await prepareWocEntryVisuals(slow.clock);
    // a yield before every key but the first
    expect(slow.waits).toEqual(Array(ALL_CLASSES.length * 2 - 1).fill(0));

    // a fast one: several keys share a slice, and it still yields
    const fast = fakeClock();
    vi.mocked(prepareVisual).mockReset();
    vi.mocked(prepareVisual).mockImplementation(() => {
      fast.advance(3);
      return undefined as never;
    });
    await prepareWocEntryVisuals(fast.clock);
    expect(fast.waits.length).toBeGreaterThan(0);
    expect(fast.waits.length).toBeLessThan(ALL_CLASSES.length * 2 - 1);
  });

  it('logs a key that cannot be prepared once, and still prepares the rest', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(prepareVisual).mockImplementation((key: string) => {
      if (key === 'player_rogue') throw new Error('character asset not preloaded');
      return undefined as never;
    });
    const { clock } = fakeClock();
    await expect(prepareWocEntryVisuals(clock)).resolves.toBe(ALL_CLASSES.length * 2 - 1);
    expect(vi.mocked(prepareVisual).mock.calls).toHaveLength(ALL_CLASSES.length * 2);
    // a graphics rebuild runs the step again: the same miss is not logged a second time
    await expect(prepareWocEntryVisuals(clock)).resolves.toBe(ALL_CLASSES.length * 2 - 1);
    expect(
      errors.mock.calls.filter((args) => String(args[0]).includes('player_rogue')),
    ).toHaveLength(1);
    errors.mockRestore();
  });
});

describe('prepareWocEntry', () => {
  it('prepares no body until the look has settled', async () => {
    store.state.set(CORE_A, 'resident');
    store.state.set(MOHAWK, 'loading');
    store.state.set(BEARDS, 'resident');
    const preparedWhileWaiting: number[] = [];
    const { clock, waits } = fakeClock((n) => {
      // still on the wire: nothing may have been prepared behind the wait
      preparedWhileWaiting.push(vi.mocked(prepareVisual).mock.calls.length);
      if (n === 3) store.state.set(MOHAWK, 'resident');
    });
    await prepareWocEntry(male, undefined, clock);
    expect(waits.slice(0, 3)).toEqual([50, 50, 50]);
    expect(preparedWhileWaiting.slice(0, 3)).toEqual([0, 0, 0]);
    expect(vi.mocked(prepareVisual).mock.calls.map(([key]) => key)).toEqual(wocVisualKeys());
  });

  it('announces itself before it does anything, and a throwing announcement costs nothing', async () => {
    for (const url of [CORE_A, MOHAWK, BEARDS]) store.state.set(url, 'resident');
    const order: string[] = [];
    vi.mocked(ensureWocHeadForAppearance).mockImplementationOnce(() => {
      order.push('look');
      return true;
    });
    vi.mocked(prepareVisual).mockImplementation(() => {
      order.push('prepare');
      return undefined as never;
    });
    const { clock } = fakeClock();
    await prepareWocEntry(male, () => order.push('announce'), clock);
    expect(order.slice(0, 3)).toEqual(['announce', 'look', 'prepare']);

    // diagnostics must never change whether the step runs
    vi.mocked(prepareVisual).mockClear();
    await expect(
      prepareWocEntry(
        male,
        () => {
          throw new Error('probe storage is full');
        },
        clock,
      ),
    ).resolves.toBeUndefined();
    expect(vi.mocked(prepareVisual).mock.calls).toHaveLength(ALL_CLASSES.length * 2);
  });

  it('never rejects: a failure here is a head start lost, not an entry lost', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { clock } = fakeClock();
    // the look step throws
    vi.mocked(ensureWocHeadForAppearance).mockImplementationOnce(() => {
      throw new Error('head store blew up');
    });
    await expect(prepareWocEntry(male, undefined, clock)).resolves.toBeUndefined();
    // the prepare step throws outside its per-key guard
    for (const url of [CORE_A, MOHAWK, BEARDS]) store.state.set(url, 'resident');
    vi.mocked(visualAssetsResident).mockImplementation(() => {
      throw new Error('manifest blew up');
    });
    await expect(prepareWocEntry(male, undefined, clock)).resolves.toBeUndefined();
    errors.mockRestore();
  });
});

describe('the renderer runs it ahead of the prewarm budget', () => {
  it('awaits it after the first-paint boundary is installed and before the budget clock', () => {
    // comments stripped: a commented-out call must not satisfy the pin
    const renderer = codeWithoutLineComments(
      readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
    );
    const start = renderer.indexOf('async prewarmInitialScene(');
    const boundaryAt = renderer.indexOf('this.initialGpuWorkStart =', start);
    const gatesAt = renderer.indexOf('this.installSceneryRevealGates();', start);
    const prepareAt = renderer.indexOf('await prepareWocEntry(this.sim.player, announceBodies);');
    // the manifest's clock: a wait or a slice before it costs the prewarm none of its budget
    const clockAt = renderer.indexOf('const started = performance.now();', start);
    const requiredAt = renderer.indexOf("id: 'views.required'", start);
    expect(start).toBeGreaterThan(-1);
    expect(boundaryAt).toBeGreaterThan(start);
    expect(gatesAt).toBeGreaterThan(boundaryAt);
    expect(prepareAt).toBeGreaterThan(gatesAt);
    expect(clockAt).toBeGreaterThan(prepareAt);
    // and before the player's own view is built
    expect(requiredAt).toBeGreaterThan(clockAt);
    // it is the only call, and it announces itself to the entry crash probe like an entry
    expect(renderer.match(/prepareWocEntry\(/g)).toHaveLength(1);
    expect(renderer).toContain(
      "const announceBodies = () => options.onEntryStart?.('entities.player-bodies', 'entities');",
    );
  });
});
