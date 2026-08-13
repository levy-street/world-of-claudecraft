import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { Renderer } from '../src/render/renderer';
import type { SentenceVfx } from '../src/render/sentence_vfx';
import type { SimEvent } from '../src/sim/types';

const TEST_TEXTURES = {
  noise: new THREE.Texture(),
  ribbon: new THREE.Texture(),
  rune: new THREE.Texture(),
  ember: new THREE.Texture(),
  rime: new THREE.Texture(),
  crack: new THREE.Texture(),
  char: new THREE.Texture(),
  overlay: new THREE.Texture(),
} as unknown as AbilityVfxTextures;

interface SentenceRendererHarness {
  createSentenceVfx(injectedTextures?: AbilityVfxTextures): SentenceVfx;
  handleEvent(event: SimEvent): void;
  sentenceImpactFeedback(sourceId: number, targetId: number, condemnation: number): void;
}

function makeHarness(playerId = 11, triggerResult = true) {
  const trigger = vi.fn(() => triggerResult);
  const pulseAt = vi.fn();
  const addShake = vi.fn();
  const punchFov = vi.fn();
  const renderer = Object.create(Renderer.prototype) as unknown as SentenceRendererHarness & {
    sentenceVfx: { trigger: typeof trigger };
    pulseAt: typeof pulseAt;
    addShake: typeof addShake;
    punchFov: typeof punchFov;
    vfx: Record<string, never>;
    sim: {
      playerId: number;
      entities: Map<number, { pos: THREE.Vector3; scale: number; dead?: boolean }>;
    };
    scene: THREE.Scene;
    camera: THREE.Camera;
    lowGfx: boolean;
    views: Map<number, { group: THREE.Group; height: number }>;
    triggerAttack: ReturnType<typeof vi.fn>;
  };
  renderer.sentenceVfx = { trigger };
  renderer.pulseAt = pulseAt;
  renderer.addShake = addShake;
  renderer.punchFov = punchFov;
  renderer.vfx = {};
  renderer.sim = { playerId, entities: new Map() };
  renderer.scene = new THREE.Scene();
  renderer.camera = new THREE.PerspectiveCamera();
  renderer.lowGfx = false;
  renderer.views = new Map();
  renderer.triggerAttack = vi.fn();
  return { renderer, trigger, pulseAt, addShake, punchFov };
}

describe('Sentence renderer routing', () => {
  it('wires the painter payoff back into renderer feedback at the marked impact moment', () => {
    const harness = makeHarness();
    const targetGroup = new THREE.Group();
    targetGroup.position.set(12, 0, -4);
    harness.renderer.views.set(22, { group: targetGroup, height: 2 });
    const painter = harness.renderer.createSentenceVfx(TEST_TEXTURES);

    expect(painter.trigger(11, 22, 100)).toBe(true);
    painter.update(0.239);
    expect(harness.pulseAt).not.toHaveBeenCalled();
    expect(harness.addShake).not.toHaveBeenCalled();
    painter.update(0.002);

    expect(harness.pulseAt).toHaveBeenCalledWith(22, 'shadow', 11.5, 0.72);
    expect(harness.addShake).toHaveBeenCalledWith(0.9);
    expect(harness.punchFov).toHaveBeenCalledWith(4);
  });

  it('routes the authoritative caster, target, and verdict without changing gameplay timing', () => {
    const harness = makeHarness();

    harness.renderer.handleEvent({
      type: 'spellfx',
      sourceId: 11,
      targetId: 22,
      school: 'shadow',
      fx: 'sentenceBurst',
      level: 100,
    });

    expect(harness.trigger).toHaveBeenCalledWith(11, 22, 100);
    expect(harness.pulseAt).not.toHaveBeenCalled();
    expect(harness.addShake).not.toHaveBeenCalled();
    expect(harness.punchFov).not.toHaveBeenCalled();

    harness.renderer.sentenceImpactFeedback(11, 22, 100);
    expect(harness.pulseAt).toHaveBeenCalledWith(22, 'shadow', 11.5, 0.72);
    expect(harness.addShake).toHaveBeenCalledWith(0.9);
    expect(harness.punchFov).toHaveBeenCalledWith(4);
  });

  it('passes retained Fate Threads into the premium verdict painter', () => {
    const harness = makeHarness();

    harness.renderer.handleEvent({
      type: 'spellfx',
      sourceId: 11,
      targetId: 22,
      school: 'shadow',
      fx: 'sentenceBurst',
      level: 50,
      threads: 3,
    });

    expect(harness.trigger).toHaveBeenCalledWith(11, 22, 50, 3);
  });

  it('renders remote verdicts without moving the local camera', () => {
    const tiers = [
      { condemnation: 20, light: 7.5, duration: 0.52 },
      { condemnation: 50, light: 9, duration: 0.6 },
      { condemnation: 80, light: 10.5, duration: 0.68 },
      { condemnation: 100, light: 11.5, duration: 0.72 },
    ];

    for (const tier of tiers) {
      const harness = makeHarness();
      harness.renderer.sentenceImpactFeedback(33, 22, tier.condemnation);

      expect(harness.pulseAt).toHaveBeenCalledWith(22, 'shadow', tier.light, tier.duration);
      expect(harness.addShake).not.toHaveBeenCalled();
      expect(harness.punchFov).not.toHaveBeenCalled();
    }
  });

  it('keeps local sub-maximum verdict feedback forceful but below the maximum', () => {
    const harness = makeHarness();

    harness.renderer.sentenceImpactFeedback(11, 22, 80);

    expect(harness.addShake).toHaveBeenCalledWith(0.48);
    expect(harness.punchFov).toHaveBeenCalledWith(1.6);
  });

  it('does not flash or move the camera when no render anchor can accept the verdict', () => {
    const harness = makeHarness(11, false);

    harness.renderer.handleEvent({
      type: 'spellfx',
      sourceId: 11,
      targetId: 999,
      school: 'shadow',
      fx: 'sentenceBurst',
      level: 100,
    });

    expect(harness.trigger).toHaveBeenCalledWith(11, 999, 100);
    expect(harness.pulseAt).not.toHaveBeenCalled();
    expect(harness.addShake).not.toHaveBeenCalled();
    expect(harness.punchFov).not.toHaveBeenCalled();
  });
});
