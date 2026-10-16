import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import type { CharacterVisual } from '../src/render/characters/visual';
import { ShardpikeThrowFx } from '../src/render/shardpike_throw_fx';
import type { IWorld } from '../src/world_api';

function setup(ready = true) {
  const entities = new Map([
    [1, { pos: { x: 0, y: 0, z: 0 }, dead: false }],
    [2, { pos: { x: 0, y: 0, z: 12 }, dead: false }],
  ]);
  const segments: THREE.Vector3[][] = [];
  const props: {
    root: THREE.Group;
    sampleTip: (out: THREE.Vector3) => THREE.Vector3;
    moveTip: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }[] = [];
  const fx = {
    flipbookAt: vi.fn(),
    burstAt: vi.fn(),
    abilityAudio: vi.fn(),
    bodyGlow: vi.fn(),
    ringAt: vi.fn(),
    worldLightAt: vi.fn(),
    shakeAt: vi.fn(),
    pathRibbon: vi.fn((_color, _width, _life, fill) => {
      const points = [new THREE.Vector3(), new THREE.Vector3()];
      fill(points);
      segments.push(points);
    }),
  };
  const visual = {
    playAttack: vi.fn(),
    sampleEyeAnchor: (out: THREE.Vector3) => {
      out.set(0, 6, 12);
      return true;
    },
    releaseShardpikeProp: () => {
      const prop = {
        root: new THREE.Group(),
        sampleTip: (out: THREE.Vector3) => out.set(0, 1.5, 0),
        moveTip: vi.fn(),
        isUsable: () => true,
        dispose: vi.fn(),
      };
      props.push(prop);
      return prop;
    },
  };
  const gate = { ready };
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 6, 0);
  const painter = new ShardpikeThrowFx(
    new THREE.Scene(),
    () => ({ entities }) as unknown as IWorld,
    () => visual as unknown as CharacterVisual,
    fx as unknown as AbilityVfxFx,
    () => gate.ready,
    camera,
  );
  const cue = (kind: string) =>
    painter.handleEvent({ ability: 'lance_thrust', sourceId: 1, targetId: 2, fx: kind });
  return { painter, cue, fx, props, segments, entities, visual, gate };
}

describe('Shardpike throw presentation', () => {
  it.each([30, 60, 120])(
    'draws a contiguous wake at %i fps and waits for authoritative impact',
    (fps) => {
      const h = setup();
      h.cue('windup');
      h.cue('projectile');
      for (let i = 0; i < fps / 3; i++) h.painter.update(1 / fps, false);
      expect(h.segments.length).toBeGreaterThan(5);
      for (let i = 1; i < h.segments.length; i++)
        expect(h.segments[i][0].distanceTo(h.segments[i - 1][1])).toBeLessThan(1e-6);
      expect(h.fx.ringAt).not.toHaveBeenCalled();
      h.cue('ccImpact');
      expect(h.fx.ringAt).toHaveBeenCalledTimes(1);
      expect(h.fx.ringAt.mock.calls[0].slice(0, 3)).toEqual([0, 6, 11.3]);
      expect(h.props[0].dispose).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['death', 'despawn', 'timeout'])(
    'restores the held weapon on %s without a phantom impact',
    (reason) => {
      const h = setup();
      h.cue('projectile');
      if (reason === 'death') {
        const target = h.entities.get(2);
        if (target) target.dead = true;
      }
      if (reason === 'despawn') h.entities.delete(1);
      h.painter.update(reason === 'timeout' ? 4 : 0.05, false);
      expect(h.props[0].dispose).toHaveBeenCalledTimes(1);
      expect(h.fx.ringAt).not.toHaveBeenCalled();
    },
  );
  it('retires a repeated cast and clears every live prop on world teardown', () => {
    const h = setup();
    h.cue('projectile');
    h.cue('windup');
    h.cue('projectile');
    expect(h.props[0].dispose).toHaveBeenCalledTimes(1);
    h.painter.dispose();
    h.painter.dispose();
    expect(h.props[1].dispose).toHaveBeenCalledTimes(1);
    expect(h.visual.playAttack).toHaveBeenCalledWith('lance_thrust');
  });
  it('keeps the physical spear when shaders are unavailable and reduces decorative trail motion', () => {
    const h = setup(false);
    h.cue('projectile');
    h.painter.update(0.05, true);
    expect(h.props[0].moveTip).toHaveBeenCalled();
    expect(h.fx.flipbookAt).not.toHaveBeenCalled();
    expect(h.fx.pathRibbon).not.toHaveBeenCalled();
    h.gate.ready = true;
    h.painter.update(0.05, true);
    expect(h.fx.pathRibbon).toHaveBeenCalledWith(
      expect.any(Number),
      0.035,
      0.18,
      expect.any(Function),
    );
    expect(h.fx.burstAt).not.toHaveBeenCalled();
  });
});
