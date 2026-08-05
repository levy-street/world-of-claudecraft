// The deferral policy behind the weapon-skin connection freeze: at most one
// rig application leaves the queue per frame, one entry per view, dead views
// dropped, and a queued skin the entity has since changed never applied.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  resolveQueuedSkinLookup,
  WEAPON_SKIN_APPLIES_PER_FRAME,
  type WeaponSkinApplyDecision,
  WeaponSkinApplyQueue,
} from '../src/render/weapon_vfx_apply_queue_core';

describe('WeaponSkinApplyQueue', () => {
  let queue: WeaponSkinApplyQueue;
  let out: WeaponSkinApplyDecision[];

  beforeEach(() => {
    queue = new WeaponSkinApplyQueue();
    out = [];
  });

  /** Live-skin lookup over a plain table; a missing id is a gone view/entity. */
  const lookup =
    (live: Record<number, string | null>) =>
    (viewId: number): string | null | undefined =>
      viewId in live ? live[viewId] : undefined;

  it('budgets applications per drain and keeps the rest queued in FIFO order', () => {
    const live = { 1: 'ice_fang', 2: 'ice_fang', 3: 'starfall' };
    queue.enqueue(1, 'ice_fang');
    queue.enqueue(2, 'ice_fang');
    queue.enqueue(3, 'starfall');
    expect(queue.size).toBe(3);

    expect(queue.take(1, lookup(live), out)).toEqual([{ viewId: 1, skinId: 'ice_fang' }]);
    expect(queue.size).toBe(2);
    expect(queue.take(1, lookup(live), out)).toEqual([{ viewId: 2, skinId: 'ice_fang' }]);
    expect(queue.take(1, lookup(live), out)).toEqual([{ viewId: 3, skinId: 'starfall' }]);
    expect(queue.size).toBe(0);
    expect(queue.take(1, lookup(live), out)).toEqual([]);
  });

  it('ships one application per frame by default', () => {
    expect(WEAPON_SKIN_APPLIES_PER_FRAME).toBe(1);
  });

  it('coalesces repeat enqueues into one entry that keeps its queue position', () => {
    queue.enqueue(1, 'ice_fang');
    queue.enqueue(2, 'starfall');
    // The renderer's per-frame diff re-enqueues every frame while an entry
    // waits (the view latch is only written when the apply runs).
    queue.enqueue(1, 'ice_fang');
    queue.enqueue(1, 'ice_fang');
    expect(queue.size).toBe(2);

    const live = { 1: 'ice_fang', 2: 'starfall' };
    expect(queue.take(4, lookup(live), out)).toEqual([
      { viewId: 1, skinId: 'ice_fang' },
      { viewId: 2, skinId: 'starfall' },
    ]);
  });

  it('lets the newest skin win without losing the queue position', () => {
    queue.enqueue(1, 'ice_fang');
    queue.enqueue(2, 'starfall');
    queue.enqueue(1, 'emberfang'); // changed again while queued
    expect(queue.size).toBe(2);

    const live = { 1: 'emberfang', 2: 'starfall' };
    expect(queue.take(4, lookup(live), out)).toEqual([
      { viewId: 1, skinId: 'emberfang' },
      { viewId: 2, skinId: 'starfall' },
    ]);
  });

  it('drops a cancelled view and never applies to it', () => {
    queue.enqueue(1, 'ice_fang');
    queue.enqueue(2, 'starfall');
    queue.cancel(1);
    expect(queue.has(1)).toBe(false);
    expect(queue.size).toBe(1);

    // Even with the entity still wearing the skin, the cancelled view is gone
    // from the queue: only the surviving view is applied.
    expect(queue.take(4, lookup({ 1: 'ice_fang', 2: 'starfall' }), out)).toEqual([
      { viewId: 2, skinId: 'starfall' },
    ]);
  });

  it('drops an entry whose view or entity disappeared before the drain', () => {
    queue.enqueue(1, 'ice_fang');
    queue.enqueue(2, 'starfall');

    // View 1's lookup returns undefined (view removed or recycled).
    expect(queue.take(4, lookup({ 2: 'starfall' }), out)).toEqual([
      { viewId: 2, skinId: 'starfall' },
    ]);
    expect(queue.size).toBe(0);
  });

  it('drops a stale entry without spending the frame budget', () => {
    queue.enqueue(1, 'ice_fang');
    queue.enqueue(2, 'starfall');

    // View 1 swapped to another cosmetic after being queued: the queued value
    // is stale, so it is dropped AND view 2 still gets this frame's one slot.
    const live = { 1: 'emberfang', 2: 'starfall' };
    expect(queue.take(WEAPON_SKIN_APPLIES_PER_FRAME, lookup(live), out)).toEqual([
      { viewId: 2, skinId: 'starfall' },
    ]);
    expect(queue.size).toBe(0);
    // The diff re-enqueues the fresh value on the next frame.
    queue.enqueue(1, 'emberfang');
    expect(queue.take(1, lookup(live), out)).toEqual([{ viewId: 1, skinId: 'emberfang' }]);
  });

  it('drops an entry whose skin was cleared to null while queued', () => {
    queue.enqueue(1, 'ice_fang');
    expect(queue.take(4, lookup({ 1: null }), out)).toEqual([]);
    expect(queue.size).toBe(0);
  });

  it('refills the caller-owned output array instead of allocating per drain', () => {
    out.push({ viewId: 99, skinId: 'stale' });
    queue.enqueue(1, 'ice_fang');
    const returned = queue.take(4, lookup({ 1: 'ice_fang' }), out);
    expect(returned).toBe(out);
    expect(out).toEqual([{ viewId: 1, skinId: 'ice_fang' }]);
  });

  it('takes nothing on a non-positive budget and leaves the queue untouched', () => {
    queue.enqueue(1, 'ice_fang');
    expect(queue.take(0, lookup({ 1: 'ice_fang' }), out)).toEqual([]);
    expect(queue.size).toBe(1);
  });

  it('clears every pending entry', () => {
    queue.enqueue(1, 'ice_fang');
    queue.enqueue(2, 'starfall');
    queue.clear();
    expect(queue.size).toBe(0);
  });

  describe('nearest-first ranking', () => {
    it('gives the frame budget to the nearest queued wearer, not the oldest', () => {
      // Arrival order is far, far, near: FIFO would make the wearer beside the
      // player wait three frames at one application each.
      queue.enqueue(1, 'ice_fang');
      queue.enqueue(2, 'ice_fang');
      queue.enqueue(3, 'starfall');
      const live = { 1: 'ice_fang', 2: 'ice_fang', 3: 'starfall' };
      const distanceSq: Record<number, number> = { 1: 900, 2: 400, 3: 4 };
      const rank = (viewId: number) => distanceSq[viewId];

      expect(queue.take(1, lookup(live), out, rank)).toEqual([{ viewId: 3, skinId: 'starfall' }]);
      expect(queue.take(1, lookup(live), out, rank)).toEqual([{ viewId: 2, skinId: 'ice_fang' }]);
      expect(queue.take(1, lookup(live), out, rank)).toEqual([{ viewId: 1, skinId: 'ice_fang' }]);
      expect(queue.size).toBe(0);
    });

    it('fills a multi-slot budget in ascending rank order', () => {
      queue.enqueue(1, 'a');
      queue.enqueue(2, 'b');
      queue.enqueue(3, 'c');
      const live = { 1: 'a', 2: 'b', 3: 'c' };
      const distanceSq: Record<number, number> = { 1: 25, 2: 1, 3: 9 };

      expect(queue.take(3, lookup(live), out, (id) => distanceSq[id])).toEqual([
        { viewId: 2, skinId: 'b' },
        { viewId: 3, skinId: 'c' },
        { viewId: 1, skinId: 'a' },
      ]);
    });

    it('ranks an unplaceable view worst instead of letting it jump the queue', () => {
      queue.enqueue(1, 'ice_fang');
      queue.enqueue(2, 'starfall');
      const live = { 1: 'ice_fang', 2: 'starfall' };
      // View 1 is queued but the caller cannot place it (undefined rank).
      const rank = (viewId: number) => (viewId === 1 ? undefined : 100);

      expect(queue.take(1, lookup(live), out, rank)).toEqual([{ viewId: 2, skinId: 'starfall' }]);
      // It is not dropped either: it drains once nothing placeable is left.
      expect(queue.take(1, lookup(live), out, rank)).toEqual([{ viewId: 1, skinId: 'ice_fang' }]);
    });

    it('breaks a rank tie by arrival order', () => {
      queue.enqueue(7, 'a');
      queue.enqueue(8, 'b');
      const live = { 7: 'a', 8: 'b' };
      expect(queue.take(1, lookup(live), out, () => 42)).toEqual([{ viewId: 7, skinId: 'a' }]);
    });

    it('stays FIFO when no rank is given', () => {
      queue.enqueue(5, 'a');
      queue.enqueue(6, 'b');
      queue.enqueue(7, 'c');
      const live = { 5: 'a', 6: 'b', 7: 'c' };

      expect(queue.take(1, lookup(live), out)).toEqual([{ viewId: 5, skinId: 'a' }]);
      expect(queue.take(2, lookup(live), out)).toEqual([
        { viewId: 6, skinId: 'b' },
        { viewId: 7, skinId: 'c' },
      ]);
    });

    it('still drops stale and dead entries when ranking', () => {
      queue.enqueue(1, 'ice_fang');
      queue.enqueue(2, 'starfall');
      queue.enqueue(3, 'emberfang');
      // View 1 is nearest but its entity moved on; view 2's view is gone.
      const live = { 1: 'other', 3: 'emberfang' };
      const distanceSq: Record<number, number> = { 1: 1, 2: 2, 3: 300 };

      expect(queue.take(1, lookup(live), out, (id) => distanceSq[id])).toEqual([
        { viewId: 3, skinId: 'emberfang' },
      ]);
      expect(queue.size).toBe(0);
    });
  });

  describe('allocation discipline', () => {
    it('reuses the same decision slots across drains', () => {
      queue.enqueue(1, 'ice_fang');
      queue.take(1, lookup({ 1: 'ice_fang' }), out);
      const firstSlot = out[0];
      expect(firstSlot).toEqual({ viewId: 1, skinId: 'ice_fang' });

      queue.enqueue(2, 'starfall');
      queue.take(1, lookup({ 2: 'starfall' }), out);
      // Same object, rewritten in place: a steady-state drain allocates nothing.
      expect(out[0]).toBe(firstSlot);
      expect(out[0]).toEqual({ viewId: 2, skinId: 'starfall' });
      expect(out).toHaveLength(1);
    });

    it('reuses slots per position when the budget grows', () => {
      queue.enqueue(1, 'a');
      queue.enqueue(2, 'b');
      queue.take(2, lookup({ 1: 'a', 2: 'b' }), out);
      const [slot0, slot1] = out;

      queue.enqueue(3, 'c');
      queue.enqueue(4, 'd');
      queue.take(2, lookup({ 3: 'c', 4: 'd' }), out);
      expect(out[0]).toBe(slot0);
      expect(out[1]).toBe(slot1);
      expect(slot0).not.toBe(slot1);
    });
  });
});

describe('resolveQueuedSkinLookup', () => {
  it('drops a queued entry whose entity is gone', () => {
    expect(resolveQueuedSkinLookup(undefined)).toBeUndefined();
  });

  it('drops a queued entry whose entity cleared its skin', () => {
    // Deliberate: the renderer's diff applies the null direction synchronously,
    // so nothing is lost by not queueing it.
    expect(resolveQueuedSkinLookup({ weaponSkinId: null })).toBeUndefined();
  });

  it('reports a different live skin so the stale-guard can reject the entry', () => {
    expect(resolveQueuedSkinLookup({ weaponSkinId: 'emberfang' })).toBe('emberfang');
  });

  it('reports the matching skin so the entry applies', () => {
    expect(resolveQueuedSkinLookup({ weaponSkinId: 'ice_fang' })).toBe('ice_fang');
  });

  it('feeds the queue guard end to end', () => {
    const queue = new WeaponSkinApplyQueue();
    const out: WeaponSkinApplyDecision[] = [];
    const entities = new Map<number, { weaponSkinId: string | null }>([
      [1, { weaponSkinId: 'ice_fang' }],
      [2, { weaponSkinId: null }],
      [3, { weaponSkinId: 'emberfang' }],
    ]);
    queue.enqueue(1, 'ice_fang');
    queue.enqueue(2, 'starfall');
    queue.enqueue(3, 'starfall');
    queue.enqueue(4, 'starfall');

    expect(queue.take(4, (id) => resolveQueuedSkinLookup(entities.get(id)), out)).toEqual([
      { viewId: 1, skinId: 'ice_fang' },
    ]);
    expect(queue.size).toBe(0);
  });
});

// The Three half is a thin consumer, so its wiring is pinned in source: the
// expensive apply must not be reachable from the per-frame diff any more, and
// the post-application steps (latch, compile gate, light reconcile) must all
// still run for every applied view.
describe('renderer wiring', () => {
  const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

  function slice(from: string, to: string): string {
    const start = renderer.indexOf(from);
    expect(start, `missing anchor: ${from}`).toBeGreaterThan(-1);
    const end = renderer.indexOf(to, start);
    expect(end, `missing anchor: ${to}`).toBeGreaterThan(start);
    return renderer.slice(start, end);
  }

  it('enqueues the apply from the per-frame diff instead of running it there', () => {
    const diff = slice('// live weapon-skin swap:', 'const weaponAura = characterWeaponAuraInto(');
    expect(diff).toContain('this.weaponSkinApplies.enqueue(id, e.weaponSkinId)');
    // Clearing a skin builds no rig, so it stays synchronous, and cancels any
    // queued apply first.
    expect(diff).toContain('this.weaponSkinApplies.cancel(id)');
    expect(diff).toContain('this.applyWeaponSkin(v, null)');
    // The chain that used to freeze the frame is gone from the diff entirely,
    // and so is the latch that would have suppressed the retry.
    expect(diff).not.toContain('setWeaponSkin(e.weaponSkinId)');
    expect(diff).not.toContain('v.weaponSkinId = e.weaponSkinId');
  });

  it('keeps every post-application step on the applying path', () => {
    const apply = slice('private applyWeaponSkin(', 'private drainWeaponSkinApplies(');
    expect(apply).toContain('v.weaponSkinId = skinId;');
    expect(apply).toContain('v.visual.setWeaponSkin(skinId)');
    expect(apply).toContain('for (const node of changed) this.gateSwapOnCompile(node)');
    expect(apply).toContain('this.reconcileViewLights(v)');
  });

  it('drains one budgeted batch per frame right after the entity loop', () => {
    expect(renderer).toContain(
      'this.lastVisibleRigCount = visibleRigCount;\n    this.drainWeaponSkinApplies();',
    );
    const drain = slice('private drainWeaponSkinApplies(', '\n  private reconcileViewLights(');
    expect(drain).toContain('WEAPON_SKIN_APPLIES_PER_FRAME');
    expect(drain).toContain('this.weaponSkinLookup');
    expect(drain).toContain('this.weaponSkinApplyScratch');
    expect(drain).toContain('this.weaponSkinRank');
    expect((renderer.match(/this\.drainWeaponSkinApplies\(\)/g) ?? []).length).toBe(1);
  });

  it('binds the guard and the ranking once, off the per-frame path', () => {
    const callbacks = slice(
      'private readonly weaponSkinLookup = ',
      '/** Apply (or clear) a weapon-skin cosmetic',
    );
    // A view that is gone or has no rig reports gone; everything else defers to
    // the shared pure resolver rather than re-deriving the null collapse here.
    expect(callbacks).toContain('if (!this.views.get(viewId)?.visual) return undefined;');
    expect(callbacks).toContain('resolveQueuedSkinLookup(this.sim.entities.get(viewId))');
    expect(callbacks).not.toContain('?.weaponSkinId ?? undefined');
    // Nearest first, by the same squared-XZ measure the view bands use.
    expect(callbacks).toContain('distSqXZ(entity, this.sim.player)');
    // Bound as instance fields, so the drain mints no closure pair per frame.
    expect(callbacks).toContain('private readonly weaponSkinRank = (viewId: number)');
  });

  it('releases the shared emissive memo at renderer teardown, after the views', () => {
    const teardown = slice('private disposeRendererResources(', 'const webgl = this.webgl as');
    const viewsAt = teardown.indexOf('this.removeView(id, true)');
    const cacheAt = teardown.indexOf('disposeWeaponEmissiveCache()');
    expect(viewsAt).toBeGreaterThan(-1);
    // Order is load-bearing: the rigs that borrow these textures must be gone
    // before the cache releases them.
    expect(cacheAt).toBeGreaterThan(viewsAt);
    expect(teardown).toContain('bestEffort(() => disposeWeaponEmissiveCache())');
    expect(teardown).toContain('this.weaponSkinApplies.clear()');
  });

  it('cancels a pending apply when the view is dropped or recycled', () => {
    const remove = slice('private removeView(id: number, terminal = false)', 'this.scene.remove(');
    expect(remove).toContain('this.weaponSkinApplies.cancel(id)');
  });
});
