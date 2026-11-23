import type * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { WOC_SHIPPED_SETS, wocSetManifest } from '../src/render/characters/woc_armor_catalog';
import { WOC_MERGED_SUFFIX, wocMergePartition } from '../src/render/characters/woc_parts_core';
import {
  armorStoreHarness as harness,
  heldQueue,
  manifest,
  model,
  releaseArmorStoreHarness,
} from './helpers/woc_armor_store_harness';

// The armor store's own rules (woc_armor_packs.ts), over the real store with only the loader
// and the graphics profile stubbed: a pack's prepare is one unit of the renderer's work
// queue (asked for when the file lands, in the background lane for a pack fetched ahead of
// need and ahead of it for one a character waits on), a queue that refuses or a file that
// cannot be prepared strands nobody, the idle rule frees by tier and profile (the crowd's
// tier stays on a desktop), a pack that throws while it is freed never keeps another, and a
// graphics change fetches the new tier of what is drawn, not of everything in memory. What
// one character sees of all this is tests/woc_armor_dressing.test.ts; the assembled high
// pack is tests/woc_armor_high_pack.test.ts.

/** The label kind of a prepare unit (what the frame budget prices). */
const PREPARE = 'woc-armor-prepare';

afterEach(() => {
  releaseArmorStoreHarness();
});

/** A store with the renderer's queue and the male rig in hand, as after the first world view. */
async function running(tier: 'low' | 'medium' | 'high' = 'medium') {
  const h = await harness(tier, 'now');
  const queue = heldQueue();
  h.packs.setWocArmorWorkQueue(queue);
  h.packs.noteWocArmorRig(model(), manifest);
  const url = (set: string, fileTier = 'medium'): string =>
    h.core.wocArmorPackUrl('male', set, fileTier as 'low');
  return { h, queue, url };
}

describe('the armor store preparing a pack off the frame', () => {
  it('prepares a pack fetched ahead of need in the background lane, so its first wearer only attaches', async () => {
    const { h, queue, url } = await running();
    h.packs.prefetchWocArmorPack(url('test'));
    expect(h.fetches).toEqual([url('test')]);
    await h.land('medium');
    // nobody waits on it: behind everything a frame is waiting for
    expect(queue.kinds()).toEqual([PREPARE]);
    expect(queue.labels()).toEqual(['woc-armor-prepare:male:test:medium']);
    expect(queue.units[0].priority).toBe(GPU_WORK_PRIORITY.BACKGROUND);
    expect(h.packs.wocArmorPackPrepared(url('test'))).toBe(false);
    queue.drain();
    expect(h.packs.wocArmorPackPrepared(url('test'))).toBe(true);
    expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(1);
    // the first wearer: nothing left to prepare, in a unit or on the spot
    expect(h.packs.wocArmorPackAwaitsPrepare(url('test'))).toBe(false);
    expect(queue.units).toEqual([]);
    const body = model();
    expect(h.packs.attachWocArmorPack(body, url('test'), 'test', manifest)).not.toBeNull();
    expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(1);
  });

  it('downloads a pack fetched ahead of need as background work, and as a demand once a character waits on it', async () => {
    const { h, url } = await running();
    h.packs.prefetchWocArmorPack(url('test'));
    // behind every file somebody needs now (assets/load_queue_core.ts)
    expect(h.asks).toEqual([{ url: url('test'), priority: 'background' }]);
    // a wearer turns up while the file still waits: the loader is asked again, as a demand,
    // which is what moves a waiting load up; the same fetch, never a second one
    h.packs.ensureWocArmorPack(url('test'));
    expect(h.asks).toEqual([
      { url: url('test'), priority: 'background' },
      { url: url('test'), priority: 'demand' },
    ]);
    expect(h.fetches).toEqual([url('test')]);
    // ...and a wearer that asks every frame does not ask the loader every frame
    h.packs.ensureWocArmorPack(url('test'));
    expect(h.asks).toHaveLength(2);
    // a pack a character asked for from the start is a demand from the start
    h.packs.ensureWocArmorPack(url('other'));
    expect(h.asks.at(-1)).toEqual({ url: url('other'), priority: 'demand' });
    await h.land('medium');
    expect(h.packs.wocArmorPackResident(url('test'))).toBe(true);
  });

  it('asks again at once for the first wearer of a pack whose prefetch failed', async () => {
    const { h, url } = await running();
    h.packs.prefetchWocArmorPack(url('test'));
    await h.fail('medium');
    // nobody waits on it: a second ask ahead of need sits out the cooldown like any retry
    h.packs.prefetchWocArmorPack(url('test'));
    expect(h.fetches).toEqual([url('test')]);
    // a character wears it now: that failure was nobody's wait, so its fetch goes out at
    // once, as a demand
    h.packs.ensureWocArmorPack(url('test'));
    expect(h.fetches).toEqual([url('test'), url('test')]);
    expect(h.asks.at(-1)).toEqual({ url: url('test'), priority: 'demand' });
    // the wearer's OWN failed fetch does start the cooldown (8 s)
    await h.fail('medium');
    h.packs.ensureWocArmorPack(url('test'));
    expect(h.fetches).toHaveLength(2);
    h.advance(7999);
    h.packs.ensureWocArmorPack(url('test'));
    expect(h.fetches).toHaveLength(2);
    h.advance(1);
    h.packs.ensureWocArmorPack(url('test'));
    expect(h.fetches).toHaveLength(3);
  });

  it('prepares nothing ahead of need for a tier the crowd stopped drawing while it streamed', async () => {
    const { h, queue, url } = await running('medium');
    h.packs.prefetchWocArmorPack(url('test'));
    // the preset drops with the file on the wire: a crowd draws the low files now
    h.gfx.tier = 'low';
    await h.land('medium');
    expect(h.packs.wocArmorPackResident(url('test'))).toBe(true);
    expect(queue.units).toEqual([]);
    expect(h.bind.prepareWocArmor).not.toHaveBeenCalled();
    // a low file fetched ahead of need on the new preset is prepared ahead as ever
    h.packs.prefetchWocArmorPack(url('test', 'low'));
    await h.land('low');
    expect(queue.labels()).toEqual(['woc-armor-prepare:male:test:low']);
    expect(queue.units[0].priority).toBe(GPU_WORK_PRIORITY.BACKGROUND);
    // ...and a character that does wear the medium file prepares it like any pack
    expect(h.packs.wocArmorPackAwaitsPrepare(url('test'))).toBe(true);
    expect(queue.units.map((unit) => unit.priority)).toEqual([
      GPU_WORK_PRIORITY.BACKGROUND,
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
    ]);
  });

  it('moves the prepare of a prefetched pack ahead the moment a character waits on it', async () => {
    const { h, queue, url } = await running();
    h.packs.prefetchWocArmorPack(url('test'));
    await h.land('medium');
    expect(queue.units.map((unit) => unit.priority)).toEqual([GPU_WORK_PRIORITY.BACKGROUND]);
    // a wearer turns up before the background lane got to it
    expect(h.packs.wocArmorPackAwaitsPrepare(url('test'))).toBe(true);
    expect(queue.units.map((unit) => unit.priority)).toEqual([
      GPU_WORK_PRIORITY.BACKGROUND,
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
    ]);
    // asking again every frame queues nothing more
    expect(h.packs.wocArmorPackAwaitsPrepare(url('test'))).toBe(true);
    expect(queue.units).toHaveLength(2);
    // the queue runs the one ahead first: prepared once, and the one left behind runs to nothing
    queue.units.pop()?.run();
    expect(h.packs.wocArmorPackPrepared(url('test'))).toBe(true);
    expect(h.packs.wocArmorPackAwaitsPrepare(url('test'))).toBe(false);
    queue.drain();
    expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(1);
  });

  it('queues the prepare ahead from the landing when a character asked while the prefetch still streamed', async () => {
    const { h, queue, url } = await running();
    h.packs.prefetchWocArmorPack(url('test'));
    // a wearer's own ask for the file in flight: one fetch, and its landing is now awaited
    h.packs.ensureWocArmorPack(url('test'));
    expect(h.fetches).toEqual([url('test')]);
    await h.land('medium');
    expect(queue.units.map((unit) => unit.priority)).toEqual([GPU_WORK_PRIORITY.VISIBLE_PREWARM]);
  });

  it('prepares what landed before the queue, or before any body of its fit, once both are known', async () => {
    const h = await harness('medium', 'now');
    const url = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.prefetchWocArmorPack(url);
    await h.land('medium');
    // no queue: nothing to ride
    const queue = heldQueue();
    h.packs.setWocArmorWorkQueue(queue);
    // a queue, and no rig of its fit to prepare it against
    expect(queue.units).toEqual([]);
    h.packs.noteWocArmorRig(model(), manifest);
    expect(queue.kinds()).toEqual([PREPARE]);
    expect(queue.units[0].priority).toBe(GPU_WORK_PRIORITY.BACKGROUND);
    // the same body noted again, or the same queue handed in again, asks nothing more
    h.packs.noteWocArmorRig(model(), manifest);
    h.packs.setWocArmorWorkQueue(queue);
    expect(queue.units).toHaveLength(1);
    queue.drain();
    expect(h.packs.wocArmorPackPrepared(url)).toBe(true);
  });

  it('prepares it when the rig came first and the queue second, too', async () => {
    const h = await harness('medium', 'now');
    const url = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.noteWocArmorRig(model(), manifest);
    h.packs.prefetchWocArmorPack(url);
    await h.land('medium');
    const queue = heldQueue();
    h.packs.setWocArmorWorkQueue(queue);
    expect(queue.kinds()).toEqual([PREPARE]);
  });

  it('asks ahead for a pack a character asked for, when the queue and the rig arrive after it landed', async () => {
    const h = await harness('medium', 'now');
    const url = h.core.wocArmorPackUrl('male', 'test', 'medium');
    // fetched at a character's word while no queue was running (a graphics rebuild's own
    // fetch of the new tier): resident, and nobody has prepared it
    h.packs.ensureWocArmorPack(url);
    await h.land('medium');
    const queue = heldQueue();
    h.packs.setWocArmorWorkQueue(queue);
    expect(queue.units).toEqual([]);
    h.packs.noteWocArmorRig(model(), manifest);
    // the next body that wears it must not pay the prepare inside its own build
    expect(queue.kinds()).toEqual([PREPARE]);
    expect(queue.units[0].priority).toBe(GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    // its wearer asking changes nothing: one unit
    expect(h.packs.wocArmorPackAwaitsPrepare(url)).toBe(true);
    expect(queue.units).toHaveLength(1);
  });

  it('answers that nothing can prepare it off the frame with no queue, or no rig of its fit', async () => {
    const h = await harness('medium', 'now');
    const url = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.ensureWocArmorPack(url);
    // not resident: nothing to wait on
    expect(h.packs.wocArmorPackAwaitsPrepare(url)).toBe(false);
    await h.land('medium');
    expect(h.packs.wocArmorPackAwaitsPrepare(url)).toBe(false);
    h.packs.setWocArmorWorkQueue(heldQueue());
    expect(h.packs.wocArmorPackAwaitsPrepare(url)).toBe(false);
    // ...so the attach prepares it on the spot, as every first attach did
    expect(h.packs.attachWocArmorPack(model(), url, 'test', manifest)).not.toBeNull();
    expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(1);
    expect(h.packs.wocArmorPackAwaitsPrepare('no/such/pack.glb')).toBe(false);
  });

  it('strands nobody when the queue refuses the unit: the next body prepares the pack itself', async () => {
    const h = await harness('medium', 'now');
    const url = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.noteWocArmorRig(model(), manifest);
    // a queue shut down under a renderer rebuild rejects everything handed to it
    const asked: (string | undefined)[] = [];
    const dead = {
      run<T>(_work: () => T | Promise<T>, _priority?: number, label?: string): Promise<T> {
        asked.push(label?.split(':')[0]);
        return Promise.reject(new Error('Renderer shut down'));
      },
    };
    h.packs.setWocArmorWorkQueue(dead);
    h.packs.ensureWocArmorPack(url);
    await h.land('medium');
    expect(asked).toEqual([PREPARE]);
    await h.flush();
    // the dead queue is let go of: no unit is pending, and none is asked of it again
    expect(h.packs.wocArmorPackAwaitsPrepare(url)).toBe(false);
    expect(asked).toEqual([PREPARE]);
    expect(h.packs.attachWocArmorPack(model(), url, 'test', manifest)).not.toBeNull();
    // the next renderer's queue serves the next pack
    const queue = heldQueue();
    h.packs.setWocArmorWorkQueue(queue);
    h.packs.ensureWocArmorPack(h.core.wocArmorPackUrl('male', 'other', 'medium'));
    await h.land('medium', 'other');
    expect(queue.kinds()).toEqual([PREPARE]);
  });

  it('asks the queue in hand again for a prepare that a replaced queue still holds', async () => {
    const { h, queue, url } = await running();
    h.packs.prefetchWocArmorPack(url('test'));
    h.packs.ensureWocArmorPack(url('other'));
    await h.land('medium');
    await h.land('medium', 'other');
    expect(queue.kinds()).toEqual([PREPARE, PREPARE]);
    // another renderer's queue takes over, and the old one never answers for its units
    const next = heldQueue();
    h.packs.setWocArmorWorkQueue(next);
    // both are asked of the new queue at once, each in its own lane
    expect(next.units.map((unit) => unit.priority)).toEqual([
      GPU_WORK_PRIORITY.BACKGROUND,
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
    ]);
    // ...and a wearer asking again, however often, queues nothing more
    expect(h.packs.wocArmorPackAwaitsPrepare(url('other'))).toBe(true);
    expect(h.packs.wocArmorPackAwaitsPrepare(url('other'))).toBe(true);
    expect(next.units).toHaveLength(2);
    next.drain();
    expect(h.packs.wocArmorPackPrepared(url('test'))).toBe(true);
    expect(h.packs.wocArmorPackPrepared(url('other'))).toBe(true);
    // the old queue's units, should they ever run after all, prepare nothing twice
    queue.drain();
    expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(2);
  });

  it('is not disturbed when a replaced queue shuts down afterwards: one unit stays pending, and the queue in hand is kept', async () => {
    const h = await harness('medium', 'now');
    const url = h.core.wocArmorPackUrl('male', 'test', 'medium');
    const other = h.core.wocArmorPackUrl('male', 'other', 'medium');
    h.packs.noteWocArmorRig(model(), manifest);
    // the old renderer's queue: it holds what it is handed, and rejects it all when it shuts down
    const shutdown: (() => void)[] = [];
    const old = {
      run<T>(): Promise<T> {
        return new Promise<T>((_resolve, reject) => {
          shutdown.push(() => reject(new Error('Renderer shut down')));
        });
      },
    };
    h.packs.setWocArmorWorkQueue(old);
    h.packs.ensureWocArmorPack(url);
    await h.land('medium');
    expect(shutdown).toHaveLength(1);
    // the next renderer's queue is handed in, and a wearer asks for the prepare on it
    const next = heldQueue();
    h.packs.setWocArmorWorkQueue(next);
    expect(h.packs.wocArmorPackAwaitsPrepare(url)).toBe(true);
    expect(next.kinds()).toEqual([PREPARE]);
    // only now does the old queue shut down, rejecting the unit it still held
    for (const reject of shutdown) reject();
    await h.flush();
    // the unit in the queue in hand is still the one pending: nothing is asked twice
    expect(h.packs.wocArmorPackAwaitsPrepare(url)).toBe(true);
    expect(next.kinds()).toEqual([PREPARE]);
    next.drain();
    expect(h.packs.wocArmorPackPrepared(url)).toBe(true);
    expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(1);
    // ...and the live queue did not go with the dead one: the next pack still rides it
    h.packs.ensureWocArmorPack(other);
    await h.land('medium', 'other');
    expect(next.kinds()).toEqual([PREPARE]);
  });

  it('attaches all of a file or none of it: a throw half way leaves nothing on the model and takes no reference', async () => {
    const { h, url } = await running();
    h.packs.ensureWocArmorPack(url('test'));
    await h.land('medium');
    const wearer = model();
    const worn = h.packs.attachWocArmorPack(wearer, url('test'), 'test', manifest);
    expect(h.packs.wocArmorPackRefs(url('test'))).toBe(1);
    // the next body's attach throws while its rigid parts are hung
    const body = model();
    h.bind.hangWocRigidArmor.mockImplementationOnce(() => {
      throw new Error('a bone that will not take it');
    });
    expect(() => h.packs.attachWocArmorPack(body, url('test'), 'test', manifest)).toThrow(
      'a bone that will not take it',
    );
    // nothing of the file is on that body, and it holds no reference
    expect(h.packs.wocArmorContainers(body)).toEqual([]);
    expect(body.getObjectByName('Armor_Test_Helm')).toBeUndefined();
    expect(h.packs.wocArmorPackRefs(url('test'))).toBe(1);
    // ...so its teardown gives back nothing that is another wearer's
    h.packs.releaseWocArmorOf(body);
    expect(h.packs.wocArmorPackRefs(url('test'))).toBe(1);
    h.packs.releaseWocArmorContainer(worn as THREE.Object3D);
    expect(h.packs.wocArmorPackRefs(url('test'))).toBe(0);
  });

  it('leaves a file whose prepare throws off for good, named once, and never throws into a frame', async () => {
    const { h, queue, url } = await running();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.bind.prepareWocArmor.mockImplementationOnce(() => {
      throw new Error('a broken armor file');
    });
    h.packs.ensureWocArmorPack(url('test'));
    await h.land('medium');
    expect(() => queue.drain()).not.toThrow();
    expect(h.packs.wocArmorPackPrepared(url('test'))).toBe(false);
    expect(logged).toHaveBeenCalledTimes(1);
    // not asked for again, in a unit or on the spot: its wearers keep their suit
    expect(h.packs.wocArmorPackAwaitsPrepare(url('test'))).toBe(false);
    expect(queue.units).toEqual([]);
    expect(h.packs.attachWocArmorPack(model(), url('test'), 'test', manifest)).toBeNull();
    expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('drops the unit of a pack freed while it waited, and prepares the refetched parse afresh', async () => {
    const { h, queue, url } = await running('high');
    // a low file on a preset where it is nobody's tier, asked for by a character that then
    // left: freed after the long window (fetched ahead of need it would not be prepared
    // ahead at all, being off the crowd's tier)
    h.packs.ensureWocArmorPack(url('test', 'low'));
    await h.land('low');
    expect(queue.kinds()).toEqual([PREPARE]);
    h.advance(h.core.WOC_ARMOR_IDLE_EVICT_MS);
    expect(h.packs.sweepWocArmorPacks()).toEqual([url('test', 'low')]);
    queue.drain();
    expect(h.bind.prepareWocArmor).not.toHaveBeenCalled();
    h.packs.ensureWocArmorPack(url('test', 'low'));
    await h.land('low');
    queue.drain();
    expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(1);
    expect(h.packs.wocArmorPackPrepared(url('test', 'low'))).toBe(true);
  });
});

describe('the armor store freeing what nobody draws', () => {
  /** A pack landed and worn once, then let go at the harness clock's now. */
  async function worn(h: Awaited<ReturnType<typeof harness>>, set: string, tier: string) {
    const url = h.core.wocArmorPackUrl('male', set, tier as 'low');
    h.packs.ensureWocArmorPack(url);
    await h.land(tier, set);
    const container = h.packs.attachWocArmorPack(model(), url, set, manifest);
    if (!container) throw new Error('the fixture pack did not attach');
    h.packs.releaseWocArmorContainer(container);
    return url;
  }

  it('keeps the tier a crowd draws for the session on a desktop, worn once or only fetched', async () => {
    const h = await harness('medium');
    const wornOnce = await worn(h, 'test', 'medium');
    const fetched = h.core.wocArmorPackUrl('male', 'other', 'medium');
    h.packs.prefetchWocArmorPack(fetched);
    await h.land('medium', 'other');
    h.advance(1000 * h.core.WOC_ARMOR_IDLE_EVICT_MS);
    expect(h.packs.sweepWocArmorPacks()).toEqual([]);
    expect(h.packs.wocArmorPackResident(wornOnce)).toBe(true);
    expect(h.packs.wocArmorPackResident(fetched)).toBe(true);
    expect(h.released).toEqual([]);
  });

  it('follows the live preset: a tier the crowd no longer draws ages out, and the one it draws now is kept', async () => {
    const h = await harness('medium');
    const medium = await worn(h, 'test', 'medium');
    const low = await worn(h, 'test', 'low');
    // on the medium preset the low file is the one left behind
    h.advance(h.core.WOC_ARMOR_IDLE_EVICT_MS - 1);
    expect(h.packs.sweepWocArmorPacks()).toEqual([]);
    // the player switches down to the low preset inside the window: the rules trade places,
    // and each file's idle time so far counts against its new rule
    h.gfx.tier = 'low';
    h.advance(1);
    expect(h.packs.sweepWocArmorPacks()).toEqual([medium]);
    expect(h.packs.wocArmorPackResident(medium)).toBe(false);
    expect(h.packs.wocArmorPackResident(low)).toBe(true);
    h.advance(1000 * h.core.WOC_ARMOR_IDLE_EVICT_MS);
    expect(h.packs.sweepWocArmorPacks()).toEqual([]);
    expect(h.packs.wocArmorPackResident(low)).toBe(true);
  });

  it('frees everything soon on the phone-class memory profile, a pack only fetched included', async () => {
    const h = await harness('high');
    h.gfx.constrainedMemory = true;
    const wornOnce = await worn(h, 'test', 'low');
    const fetched = h.core.wocArmorPackUrl('male', 'other', 'low');
    h.packs.prefetchWocArmorPack(fetched);
    await h.land('low', 'other');
    h.advance(h.core.WOC_ARMOR_CONSTRAINED_IDLE_EVICT_MS - 1);
    expect(h.packs.sweepWocArmorPacks()).toEqual([]);
    h.advance(1);
    expect(h.packs.sweepWocArmorPacks().sort()).toEqual([wornOnce, fetched].sort());
    expect(h.packs.wocArmorPackResident(wornOnce)).toBe(false);
    expect(h.packs.wocArmorPackResident(fetched)).toBe(false);
    expect([...h.released].sort()).toEqual([wornOnce, fetched].sort());
  });

  it('never frees a pack somebody draws, whatever its rule', async () => {
    const h = await harness('high');
    h.gfx.constrainedMemory = true;
    const url = h.core.wocArmorPackUrl('male', 'test', 'low');
    h.packs.ensureWocArmorPack(url);
    await h.land('low');
    const container = h.packs.attachWocArmorPack(model(), url, 'test', manifest);
    h.advance(1000 * h.core.WOC_ARMOR_IDLE_EVICT_MS);
    expect(h.packs.sweepWocArmorPacks()).toEqual([]);
    expect(h.packs.wocArmorPackResident(url)).toBe(true);
    // its window starts when its last wearer leaves, not when it landed
    h.packs.releaseWocArmorContainer(container as THREE.Object3D);
    h.advance(h.core.WOC_ARMOR_CONSTRAINED_IDLE_EVICT_MS - 1);
    expect(h.packs.sweepWocArmorPacks()).toEqual([]);
    h.advance(1);
    expect(h.packs.sweepWocArmorPacks()).toEqual([url]);
  });

  it('frees every expired pack, and all of each, when one resource throws on the way out', async () => {
    const h = await harness('high');
    // two low files on a preset that draws them for nobody
    const first = h.core.wocArmorPackUrl('male', 'test', 'low');
    const second = h.core.wocArmorPackUrl('male', 'other', 'low');
    const bodies = [model(), model()];
    h.packs.ensureWocArmorPack(first);
    h.packs.ensureWocArmorPack(second);
    await h.land('low');
    await h.land('low', 'other');
    const containers = [
      h.packs.attachWocArmorPack(bodies[0], first, 'test', manifest) as THREE.Group,
      h.packs.attachWocArmorPack(bodies[1], second, 'other', manifest) as THREE.Group,
    ];
    const helms = containers.map((c) => c.children[0] as THREE.SkinnedMesh);
    // the first pack's material throws as it is disposed (a listener of a renderer gone)
    vi.spyOn(helms[0].material as THREE.Material, 'dispose').mockImplementation(() => {
      throw new Error('a material that will not let go');
    });
    const firstGeometry = vi.spyOn(helms[0].geometry, 'dispose');
    const secondMaterial = vi.spyOn(helms[1].material as THREE.Material, 'dispose');
    const secondGeometry = vi.spyOn(helms[1].geometry, 'dispose');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const container of containers) h.packs.releaseWocArmorContainer(container);
    h.advance(h.core.WOC_ARMOR_IDLE_EVICT_MS);
    let expired: string[] = [];
    expect(() => {
      expired = h.packs.sweepWocArmorPacks();
    }).not.toThrow();
    expect(expired).toEqual([first, second]);
    // the rest of the pack that threw, and the whole of the other one, are freed all the same
    expect(firstGeometry).toHaveBeenCalled();
    expect(secondMaterial).toHaveBeenCalled();
    expect(secondGeometry).toHaveBeenCalled();
    expect(h.packs.wocArmorPackResident(first)).toBe(false);
    expect(h.packs.wocArmorPackResident(second)).toBe(false);
    expect(h.released).toEqual([first, second]);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('gives a reference back, and throws nothing, when the release that follows frees a pack that throws', async () => {
    const h = await harness('high');
    const idle = h.core.wocArmorPackUrl('male', 'other', 'low');
    const drawn = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.ensureWocArmorPack(idle);
    h.packs.ensureWocArmorPack(drawn);
    await h.land('low', 'other');
    await h.land('medium');
    const body = model();
    const left = h.packs.attachWocArmorPack(model(), idle, 'other', manifest) as THREE.Group;
    const worn = h.packs.attachWocArmorPack(body, drawn, 'test', manifest) as THREE.Group;
    vi.spyOn((left.children[0] as THREE.Mesh).geometry, 'dispose').mockImplementation(() => {
      throw new Error('a geometry that will not let go');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.packs.releaseWocArmorContainer(left);
    h.advance(h.core.WOC_ARMOR_IDLE_EVICT_MS);
    // this release sweeps, and the sweep frees the idle pack that throws
    expect(() => h.packs.releaseWocArmorOf(body)).not.toThrow();
    expect(h.packs.wocArmorPackRefs(drawn)).toBe(0);
    expect(h.packs.wocArmorPackResident(idle)).toBe(false);
    expect(h.packs.wocArmorContainers(body)).toEqual([]);
    expect(worn.parent).toBeNull();
  });
});

describe('a graphics preset change fetching the new armor tier', () => {
  it('fetches it for the sets drawn now or until moments ago, never for every set in memory', async () => {
    const h = await harness('medium');
    const url = (set: string, tier: string): string =>
      h.core.wocArmorPackUrl('male', set, tier as 'low');
    // a set worn long ago and a set only fetched: both still in memory on a desktop
    h.packs.ensureWocArmorPack(url('old', 'medium'));
    await h.land('medium', 'old');
    const gone = h.packs.attachWocArmorPack(model(), url('old', 'medium'), 'old', manifest);
    h.packs.releaseWocArmorContainer(gone as THREE.Object3D);
    h.packs.prefetchWocArmorPack(url('fetched', 'medium'));
    await h.land('medium', 'fetched');
    h.advance(h.core.WOC_ARMOR_IDLE_EVICT_MS);
    // a set worn right now, and one whose wearer the rebuild released a moment ago
    for (const set of ['worn', 'released']) {
      h.packs.ensureWocArmorPack(url(set, 'medium'));
      await h.land('medium', set);
    }
    h.packs.attachWocArmorPack(model(), url('worn', 'medium'), 'worn', manifest);
    const released = h.packs.attachWocArmorPack(
      model(),
      url('released', 'medium'),
      'released',
      manifest,
    );
    h.packs.releaseWocArmorContainer(released as THREE.Object3D);
    h.advance(1000);
    for (const set of ['old', 'fetched']) {
      expect(h.packs.wocArmorPackResident(url(set, 'medium'))).toBe(true);
    }
    h.fetches.length = 0;
    let settled = false;
    const done = h.packs.prepareWocArmorTier('low').then(() => {
      settled = true;
    });
    // the rebuilt characters' sets, and only theirs: the curtain waits on nothing else
    expect([...h.fetches].sort()).toEqual([url('released', 'low'), url('worn', 'low')].sort());
    await h.land('low', 'worn');
    expect(settled).toBe(false);
    await h.land('low', 'released');
    await done;
    expect(settled).toBe(true);
  });

  it('asks for nothing when every set drawn is already resident at the new tier', async () => {
    const h = await harness('medium');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.ensureWocArmorPack(medium);
    await h.land('medium');
    h.packs.attachWocArmorPack(model(), medium, 'test', manifest);
    h.fetches.length = 0;
    await h.packs.prepareWocArmorTier('medium');
    expect(h.fetches).toEqual([]);
  });
});

describe('what a pack is prepared against, with no wearer in hand', () => {
  // The store prepares a pack that landed for nobody against the rig and a manifest of its
  // FIT, remembered from the first body built on it, whatever class that body was. Sound only
  // while every manifest of a fit partitions a set's parts alike (the partition keeps two
  // independently worn items out of one merged draw): the shipped manifests, held to it here.
  it('partitions every shipped set alike through any manifest of its fit', () => {
    let compared = 0;
    for (const fit of ['male', 'female'] as const) {
      const manifests = WOC_SHIPPED_SETS.map((set) => {
        const own = wocSetManifest(fit, set);
        if (!own) throw new Error(`no manifest for the shipped set ${fit} ${set}`);
        return own;
      });
      for (const own of manifests) {
        for (const item of Object.values(own.items)) {
          for (const node of item.nodes) {
            // a part's mesh as the file names it, as the merge renames it, and as the loader
            // splits a part of two materials
            for (const mesh of [node, `${node}${WOC_MERGED_SUFFIX}`, `${node}_1`]) {
              const expected = wocMergePartition(own, mesh);
              expect(expected.startsWith('item:'), `${fit} ${mesh}`).toBe(true);
              for (const other of manifests) {
                expect(wocMergePartition(other, mesh), `${fit} ${mesh}`).toBe(expected);
                compared++;
              }
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
});
