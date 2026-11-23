// Spore Burst presentation (src/render/spore_burst_visual.ts): the growth
// curve (Dragonkin Egg size at placement, at least +50% by the burst), the
// countdown text, the shipped asset, and the ring and timer colouring by the
// viewer's hostility to the caster.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  SporeBurstVisuals,
  sporeBurstScale,
  sporeBurstTimerText,
  sporeBurstVisualPreloadInternalsForTest,
} from '../src/render/spore_burst_visual';
import type { ActiveSporeBurst } from '../src/world_api';

const publicDir = path.join(__dirname, '..', 'public');

function burst(over: Partial<ActiveSporeBurst> = {}): ActiveSporeBurst {
  return {
    id: 'spore_burst:1:20',
    x: 4,
    z: 6,
    radius: 8,
    duration: 5,
    remaining: 5,
    sourceId: 1,
    ...over,
  };
}

function ringColor(scene: THREE.Scene): number {
  const ring = scene.getObjectByName('spore-burst-ring') as THREE.Mesh | undefined;
  if (!ring) throw new Error('no ring');
  return (ring.material as THREE.MeshBasicMaterial).color.getHex();
}

describe('Spore Burst growth', () => {
  it('starts at the authored egg size and is at least 50% bigger at the burst', () => {
    expect(sporeBurstScale(0, 5)).toBe(1);
    expect(sporeBurstScale(5, 5)).toBeGreaterThanOrEqual(1.5);
    // Grows the whole way, never shrinks.
    let last = 0;
    for (let t = 0; t <= 5; t += 0.05) {
      const s = sporeBurstScale(t, 5);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
    // Most of the growth reads early: clearly bigger after one second.
    expect(sporeBurstScale(1, 5)).toBeGreaterThan(1.15);
  });

  it('prints the countdown in tenths and never shows zero while standing', () => {
    expect(sporeBurstTimerText(5)).toBe('5.0');
    expect(sporeBurstTimerText(3.42)).toBe('3.5');
    expect(sporeBurstTimerText(0.01)).toBe('0.1');
    expect(sporeBurstTimerText(0)).toBe('0.1');
  });
});

describe('Spore Burst asset', () => {
  it('ships the spore burster GLB in the media manifest, meshopt-compressed with KTX2 textures', () => {
    const url = sporeBurstVisualPreloadInternalsForTest.modelUrl;
    const rel = url.replace(/^\//, '');
    const file = path.join(publicDir, rel);
    expect(existsSync(file)).toBe(true);
    expect(MEDIA_ASSETS[rel]).toBeDefined();
    // KTX2 (UASTC normal/ORM, ETC1S colour) is bigger on disk than the
    // pipeline's WebP build but a fraction of it in GPU memory.
    expect(statSync(file).size).toBeLessThanOrEqual(512 * 1024);
    const binary = readFileSync(file).toString('latin1');
    expect(binary).toContain('EXT_meshopt_compression');
    expect(binary).toContain('KHR_texture_basisu');
  });
});

describe('Spore Burst visual', () => {
  it('draws the ring green for a friendly caster and red for a hostile one, and retires with the readout', () => {
    const scene = new THREE.Scene();
    let hostile = false;
    const visuals = new SporeBurstVisuals(
      scene,
      () => 0,
      () => hostile,
    );
    visuals.sync([burst()]);
    expect(ringColor(scene)).toBe(0x5fe06a);
    hostile = true;
    visuals.sync([burst({ remaining: 4 })]);
    expect(ringColor(scene)).toBe(0xff4d40);
    visuals.update(0.5);
    visuals.sync([]);
    expect(scene.getObjectByName('spore-burst')).toBeUndefined();
  });
});
