import { describe, expect, it, vi } from 'vitest';
import { DrainChannelStopLatch } from '../src/render/drain_channel_visual_core';
import { Renderer } from '../src/render/renderer';
import type { Entity, SimEvent } from '../src/sim/types';

interface DrainRendererHarness {
  handleEvent(event: SimEvent): void;
  syncDrainChannelVisual(id: number, entity: Entity): void;
}

function makeHarness() {
  const drainBeam = vi.fn();
  const demonicDrainBeam = vi.fn();
  const drainLifeTick = vi.fn();
  const renderer = Object.create(Renderer.prototype) as DrainRendererHarness & {
    drainChannelStopLatch: DrainChannelStopLatch;
    snapshotDrainVisualChannels: Set<number>;
    snapshotDemonicDrainVisualChannels: Set<number>;
    vfx: {
      drainBeam: typeof drainBeam;
      demonicDrainBeam: typeof demonicDrainBeam;
      drainLifeTick: typeof drainLifeTick;
    };
    sim: {
      entities: Map<number, Entity>;
    };
    time: number;
    triggerAttack: ReturnType<typeof vi.fn>;
    triggerHit: ReturnType<typeof vi.fn>;
    abilityVfx: {
      handleSpellfx: ReturnType<typeof vi.fn>;
      onDamage: ReturnType<typeof vi.fn>;
    };
  };
  renderer.drainChannelStopLatch = new DrainChannelStopLatch();
  renderer.snapshotDrainVisualChannels = new Set();
  renderer.snapshotDemonicDrainVisualChannels = new Set();
  renderer.vfx = { drainBeam, demonicDrainBeam, drainLifeTick };
  renderer.sim = {
    entities: new Map<number, Entity>([[7, { auras: [] } as unknown as Entity]]),
  };
  renderer.time = 1;
  renderer.triggerAttack = vi.fn();
  renderer.triggerHit = vi.fn();
  renderer.abilityVfx = { handleSpellfx: vi.fn(() => false), onDamage: vi.fn() };
  return { renderer, drainBeam, demonicDrainBeam, drainLifeTick };
}

describe('Drain Life renderer routing', () => {
  it('wires snapshot channel reconstruction into the real per-view render loop', () => {
    expect(Renderer.prototype.sync.toString()).toContain('this.syncDrainChannelVisual(id, e)');
  });

  it('starts and stops the existing pooled channel from its spellfx events', () => {
    const h = makeHarness();
    h.renderer.handleEvent({
      type: 'spellfx',
      sourceId: 7,
      targetId: 41,
      school: 'shadow',
      fx: 'drainBeam',
      duration: 5,
      ability: 'drain_life',
    });
    expect(h.drainBeam).toHaveBeenLastCalledWith(7, 41, 5);

    h.renderer.handleEvent({
      type: 'spellfx',
      sourceId: 7,
      targetId: 41,
      school: 'shadow',
      fx: 'drainBeam',
      duration: 0,
      ability: 'drain_life',
    });
    expect(h.drainBeam).toHaveBeenLastCalledWith(7, 41, 0);
    expect(h.demonicDrainBeam).toHaveBeenLastCalledWith(7, 41, 0);
    expect(h.renderer.drainChannelStopLatch.allowsSnapshot(7, 41, 1.1)).toBe(false);
  });

  it('uses the real Drain Life damage event as the exact per-tick pulse cue', () => {
    const h = makeHarness();
    h.renderer.handleEvent({
      type: 'damage',
      sourceId: 7,
      targetId: 41,
      amount: 12,
      crit: false,
      school: 'shadow',
      ability: 'Drain Life',
      kind: 'hit',
    });

    expect(h.drainLifeTick).toHaveBeenCalledWith(7);
  });

  it('starts the possessed Eye drain alongside the main beam before snapshot reconciliation', () => {
    const h = makeHarness();
    const source = h.renderer.sim.entities.get(7);
    if (!source) throw new Error('missing source');
    source.auras = [{ kind: 'affliction_possession', remaining: 6 }] as Entity['auras'];

    h.renderer.handleEvent({
      type: 'spellfx',
      sourceId: 7,
      targetId: 41,
      school: 'shadow',
      fx: 'drainBeam',
      duration: 5,
      ability: 'drain_life',
    });
    expect(h.drainBeam).toHaveBeenLastCalledWith(7, 41, 5);
    expect(h.demonicDrainBeam).toHaveBeenLastCalledWith(7, 41, 5);

    h.demonicDrainBeam.mockClear();
    h.renderer.syncDrainChannelVisual(7, {
      ...source,
      id: 7,
      castingAbility: 'drain_life',
      channeling: true,
      castTargetId: 41,
      castRemaining: 4.9,
      dead: false,
    });
    expect(h.demonicDrainBeam).not.toHaveBeenCalled();
  });

  it('blocks a stale snapshot after stop, then accepts idle and a later channel', () => {
    const h = makeHarness();
    const live = {
      id: 7,
      castingAbility: 'drain_life',
      channeling: true,
      castTargetId: 41,
      castRemaining: 3,
      dead: false,
      auras: [],
    } as unknown as Entity;

    h.renderer.syncDrainChannelVisual(7, live);
    expect(h.drainBeam).toHaveBeenLastCalledWith(7, 41, 3);

    h.renderer.handleEvent({
      type: 'spellfx',
      sourceId: 7,
      targetId: 41,
      school: 'shadow',
      fx: 'drainBeam',
      duration: 0,
    });
    h.drainBeam.mockClear();
    h.renderer.syncDrainChannelVisual(7, live);
    expect(h.drainBeam).not.toHaveBeenCalled();

    h.renderer.syncDrainChannelVisual(7, { ...live, channeling: false });
    h.renderer.syncDrainChannelVisual(7, live);
    expect(h.drainBeam).toHaveBeenLastCalledWith(7, 41, 3);
  });

  it('starts, removes, restores, and finally stops the demonic second drain from snapshots', () => {
    const h = makeHarness();
    const demonic = {
      id: 7,
      castingAbility: 'drain_life',
      channeling: true,
      castTargetId: 41,
      castRemaining: 3,
      dead: false,
      auras: [{ kind: 'affliction_possession', remaining: 6 }],
    } as unknown as Entity;

    h.renderer.syncDrainChannelVisual(7, demonic);
    expect(h.drainBeam).toHaveBeenLastCalledWith(7, 41, 3);
    expect(h.demonicDrainBeam).toHaveBeenLastCalledWith(7, 41, 3);

    h.demonicDrainBeam.mockClear();
    h.renderer.syncDrainChannelVisual(7, { ...demonic, castRemaining: 2, auras: [] });
    expect(h.drainBeam).toHaveBeenLastCalledWith(7, 41, 2);
    expect(h.demonicDrainBeam).toHaveBeenLastCalledWith(7, 41, 0);

    h.renderer.syncDrainChannelVisual(7, { ...demonic, castRemaining: 1 });
    expect(h.demonicDrainBeam).toHaveBeenLastCalledWith(7, 41, 1);

    h.drainBeam.mockClear();
    h.demonicDrainBeam.mockClear();
    h.renderer.syncDrainChannelVisual(7, { ...demonic, channeling: false });
    expect(h.drainBeam).toHaveBeenLastCalledWith(7, 41, 0);
    expect(h.demonicDrainBeam).toHaveBeenLastCalledWith(7, 41, 0);
  });

  it('does not orphan a stop latch for a completely unknown source', () => {
    const h = makeHarness();
    h.renderer.sim.entities.clear();

    h.renderer.handleEvent({
      type: 'spellfx',
      sourceId: 99,
      targetId: 41,
      school: 'shadow',
      fx: 'drainBeam',
      duration: 0,
    });

    expect(h.renderer.drainChannelStopLatch.allowsSnapshot(99, 41, 1)).toBe(true);
  });
});
