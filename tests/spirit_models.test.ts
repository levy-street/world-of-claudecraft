// The spirit-apparition model registry (src/render/ability_vfx/spirits.ts).
//
// A spirit puppet resolves its clips by INTENT across the creature packs'
// differing naming schemes, and a model that matches none of a list just gets a
// null action: the apparition then slides along its path frozen in bind pose,
// with nothing logged. So every registered model must both exist on disk and
// actually answer the intent lists the puppet builds from.
//
// The registry is also the one place a species name is bound to a file, and
// nothing else checks that binding is honest: `bear` pointed at yetialt.glb (a
// biped yeti) long after the bear had its own quadruped rig, so shifting into
// Bear Form conjured a spectral yeti. The per-species pins below are what make
// that kind of mismatch fail here instead of in front of a player.
import { existsSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  ATTACK_CLIPS,
  IDLE_CLIPS,
  MOVE_CLIPS,
  SPIRIT_URLS,
} from '../src/render/ability_vfx/spirits';

async function glbAnimationNames(path: string): Promise<Set<string>> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(path);
  return new Set(
    doc
      .getRoot()
      .listAnimations()
      .map((a) => a.getName()),
  );
}

describe('spirit apparition models', () => {
  it('binds each species to the model that actually is that species', () => {
    // Not exhaustive on purpose: these are the ones a wrong file would read as
    // the wrong ANIMAL rather than as a missing asset.
    expect(SPIRIT_URLS.bear).toBe('models/creatures/bear_form.glb');
    expect(SPIRIT_URLS.wolf).toBe('models/creatures/wolf.glb');
    expect(SPIRIT_URLS.sheep).toBe('models/creatures/alpaca.glb');
    // the yeti rig stays the yeti's, and is no longer conscripted as a bear
    expect(Object.values(SPIRIT_URLS)).not.toContain('models/creatures/yetialt.glb');
  });

  it('ships every registered spirit model', () => {
    expect(Object.keys(SPIRIT_URLS).length).toBeGreaterThan(10);
    for (const [model, url] of Object.entries(SPIRIT_URLS)) {
      expect(existsSync(`public/${url}`), `${model}: ${url} is missing`).toBe(true);
    }
  });

  it('gives the bear spirit a move, idle and attack clip to match', async () => {
    const names = await glbAnimationNames(`public/${SPIRIT_URLS.bear}`);
    for (const [intent, list] of [
      ['move', MOVE_CLIPS],
      ['idle', IDLE_CLIPS],
      ['attack', ATTACK_CLIPS],
    ] as const) {
      expect(
        list.some((n) => names.has(n)),
        `bear matches no ${intent} clip; it would slide along its path in bind pose. Has: ${[...names].join(', ')}`,
      ).toBe(true);
    }
  });
});
