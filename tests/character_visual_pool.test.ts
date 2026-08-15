// The character-visual reuse pool (src/render/characters/visual_pool.ts): the
// normalized pool key (rift per-instance color/scale jitter must never
// partition it), the bounded least-recently-released eviction with real
// disposal, eviction transparency (an evicted key misses and rebuilds), and
// the acquire-time re-tint seam (CharacterVisual.setEntityColor).
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CharacterVisualPool, characterVisualPoolKey } from '../src/render/characters/visual_pool';
import { gfxInternalsForTest } from '../src/render/gfx';

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(() => new Promise(() => undefined)),
  loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
  loadTexture: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn((start: () => unknown) => start()),
}));

import { CharacterVisual } from '../src/render/characters/visual';

interface StubVisual {
  dispose: ReturnType<typeof vi.fn<() => void>>;
}

const stubVisual = (): StubVisual => ({ dispose: vi.fn<() => void>() });

describe('characterVisualPoolKey normalization', () => {
  it('gives two rift-jittered mobs of one template THE SAME per-template key', () => {
    // Per-instance color/scale exactly as rift/runs.ts re-grades them:
    // deterministic sim-rng jitter stored on the entity. The exact-literal
    // assertions are the mutant proof: restoring `:${e.color}:${e.scale}` to
    // the key re-introduces the dead-entry leak and turns this red.
    const a = {
      kind: 'mob' as const,
      templateId: 'ashen_wolf',
      skin: 0,
      color: 0x8a3c2f,
      scale: 1.0733,
    };
    const b = {
      kind: 'mob' as const,
      templateId: 'ashen_wolf',
      skin: 0,
      color: 0x93452a,
      scale: 0.9481,
    };
    expect(characterVisualPoolKey(a)).toBe('mob:ashen_wolf');
    expect(characterVisualPoolKey(b)).toBe('mob:ashen_wolf');
    expect(characterVisualPoolKey(a)).toBe(characterVisualPoolKey(b));
  });

  it('keeps npc skin in the key (atlas identity) but drops color and scale', () => {
    const npc = {
      kind: 'npc' as const,
      templateId: 'npc_innkeeper',
      skin: 2,
      color: 0x123456,
      scale: 1.21,
    };
    expect(characterVisualPoolKey(npc)).toBe('npc:npc_innkeeper:2');
    const otherSkin = { ...npc, skin: 3 };
    expect(characterVisualPoolKey(otherSkin)).toBe('npc:npc_innkeeper:3');
  });

  it('never pools players (A6 exclusion) or non-character kinds', () => {
    expect(
      characterVisualPoolKey({ kind: 'player' as const, templateId: 'warrior', skin: 1 }),
    ).toBeNull();
    expect(
      characterVisualPoolKey({ kind: 'object' as const, templateId: 'ore_node', skin: 0 }),
    ).toBeNull();
  });
});

describe('CharacterVisualPool bounded LRU', () => {
  it('respects the bound: storing bound+1 evicts the least-recently-released and disposes it', () => {
    const pool = new CharacterVisualPool<StubVisual>();
    const visuals = [stubVisual(), stubVisual(), stubVisual(), stubVisual()];
    pool.store('a', visuals[0], 3);
    pool.store('b', visuals[1], 3);
    pool.store('c', visuals[2], 3);
    expect(pool.size).toBe(3);

    const disposed = pool.store('d', visuals[3], 3);

    expect(disposed).toBe(1);
    expect(pool.size).toBe(3);
    expect(visuals[0].dispose).toHaveBeenCalledTimes(1);
    expect(visuals[1].dispose).not.toHaveBeenCalled();
    expect(visuals[2].dispose).not.toHaveBeenCalled();
    expect(visuals[3].dispose).not.toHaveBeenCalled();
  });

  it('evicts in RELEASE order across keys, not key insertion order', () => {
    const pool = new CharacterVisualPool<StubVisual>();
    const a1 = stubVisual();
    const b1 = stubVisual();
    const a2 = stubVisual();
    pool.store('a', a1, 3);
    pool.store('b', b1, 3);
    pool.store('a', a2, 3);

    pool.store('c', stubVisual(), 3);

    // a1 was released first, so it goes first even though key 'a' also holds
    // the most recent release.
    expect(a1.dispose).toHaveBeenCalledTimes(1);
    expect(b1.dispose).not.toHaveBeenCalled();
    expect(a2.dispose).not.toHaveBeenCalled();
    expect(pool.take('a')).toBe(a2);
    expect(pool.take('b')).toBe(b1);
  });

  it('take returns the most-recently-released visual for the key and removes it', () => {
    const pool = new CharacterVisualPool<StubVisual>();
    const v1 = stubVisual();
    const v2 = stubVisual();
    pool.store('k', v1, 10);
    pool.store('k', v2, 10);

    expect(pool.take('k')).toBe(v2);
    expect(pool.size).toBe(1);
    expect(pool.take('k')).toBe(v1);
    expect(pool.size).toBe(0);
    expect(pool.take('k')).toBeNull();
    expect(v1.dispose).not.toHaveBeenCalled();
    expect(v2.dispose).not.toHaveBeenCalled();
  });

  it('an evicted key simply misses, so the caller transparently rebuilds and can re-pool', () => {
    const pool = new CharacterVisualPool<StubVisual>();
    const evicted = stubVisual();
    pool.store('rift', evicted, 2);
    pool.store('x', stubVisual(), 2);
    pool.store('y', stubVisual(), 2); // evicts 'rift'
    expect(evicted.dispose).toHaveBeenCalledTimes(1);

    // Miss: the renderer falls through to a fresh createCharacterVisual from
    // the live entity (identical construction inputs), then releases it back.
    expect(pool.take('rift')).toBeNull();
    const rebuilt = stubVisual();
    pool.store('rift', rebuilt, 2);
    expect(pool.take('rift')).toBe(rebuilt);
  });

  it('reads the cap live per store: a shrunken profile cap drains overflow immediately', () => {
    const pool = new CharacterVisualPool<StubVisual>();
    const visuals = [stubVisual(), stubVisual(), stubVisual(), stubVisual(), stubVisual()];
    for (const v of visuals) pool.store('k', v, 8);
    expect(pool.size).toBe(5);

    const disposed = pool.store('k', stubVisual(), 3);

    expect(disposed).toBe(3);
    expect(pool.size).toBe(3);
    expect(visuals[0].dispose).toHaveBeenCalledTimes(1);
    expect(visuals[1].dispose).toHaveBeenCalledTimes(1);
    expect(visuals[2].dispose).toHaveBeenCalledTimes(1);
    expect(visuals[3].dispose).not.toHaveBeenCalled();
  });

  it('fails closed on a disabled or invalid cap: the incoming visual is disposed, never pooled', () => {
    const pool = new CharacterVisualPool<StubVisual>();
    const zero = stubVisual();
    expect(pool.store('k', zero, 0)).toBe(1);
    expect(zero.dispose).toHaveBeenCalledTimes(1);
    const nan = stubVisual();
    expect(pool.store('k', nan, Number.NaN)).toBe(1);
    expect(nan.dispose).toHaveBeenCalledTimes(1);
    expect(pool.size).toBe(0);
  });

  it('supports an unbounded cap without evicting (the Infinity arm stays valid)', () => {
    const pool = new CharacterVisualPool<StubVisual>();
    const visuals = Array.from({ length: 300 }, stubVisual);
    for (const v of visuals) pool.store('k', v, Number.POSITIVE_INFINITY);
    expect(pool.size).toBe(300);
    for (const v of visuals) expect(v.dispose).not.toHaveBeenCalled();
  });

  it('drain empties the pool and hands visuals back UNdisposed (the caller owns teardown)', () => {
    const pool = new CharacterVisualPool<StubVisual>();
    const v1 = stubVisual();
    const v2 = stubVisual();
    pool.store('a', v1, 10);
    pool.store('b', v2, 10);

    const drained = pool.drain();

    expect(drained).toEqual([v1, v2]);
    expect(pool.size).toBe(0);
    expect(pool.take('a')).toBeNull();
    expect(v1.dispose).not.toHaveBeenCalled();
    expect(v2.dispose).not.toHaveBeenCalled();
  });
});

describe('per-profile pool bound (GFX.maxPooledCharacterVisuals)', () => {
  it('bounds EVERY profile: desktop 128, constrained 24, iOS 6, tight-memory 4', () => {
    const { settingsFor } = gfxInternalsForTest;
    expect(settingsFor('high').maxPooledCharacterVisuals).toBe(128);
    expect(settingsFor('ultra').maxPooledCharacterVisuals).toBe(128);
    expect(settingsFor('medium', { deviceMemory: 4 }).maxPooledCharacterVisuals).toBe(24);
    expect(settingsFor('medium', { platform: 'ios' }).maxPooledCharacterVisuals).toBe(6);
    expect(
      settingsFor('medium', { platform: 'ios', tightMemory: true }).maxPooledCharacterVisuals,
    ).toBe(4);
    // The C1 ratchet fix: no profile keeps the historical unbounded pool.
    for (const tier of ['low', 'medium', 'high', 'ultra', 'insane'] as const) {
      expect(Number.isFinite(settingsFor(tier).maxPooledCharacterVisuals)).toBe(true);
    }
  });
});

describe('renderer integration (source pins)', () => {
  const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

  it('keys the pool through the normalized helper, never a jittered inline key', () => {
    const keyStart = renderer.indexOf('private visualPoolKeyFor(');
    const keyEnd = renderer.indexOf('\n  private ', keyStart + 1);
    expect(keyStart).toBeGreaterThan(-1);
    const keyFor = renderer.slice(keyStart, keyEnd);
    expect(keyFor).toContain('return characterVisualPoolKey(e);');
    // Mutant proof at the renderer layer: re-inlining the per-instance
    // color/scale key re-creates the dead-entry leak and turns this red.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a deliberate plain-string scan for template-literal SOURCE TEXT in renderer.ts
    expect(renderer).not.toContain(':${e.color}:${e.scale}');
  });

  it('applies the per-instance jitter at acquire time and rebuilds on a miss from the live entity', () => {
    const takeStart = renderer.indexOf('private takePooledVisual(');
    const takeEnd = renderer.indexOf('\n  private ', takeStart + 1);
    expect(takeStart).toBeGreaterThan(-1);
    const take = renderer.slice(takeStart, takeEnd);
    // color is an acquire-time instance attribute now that the key is
    // per-template (rift mobs jitter it per instance)
    expect(take).toContain('visual.setEntityColor(entityColor)');
    // ... and the caller hands the live entity's color in
    const acquire = 'this.takePooledVisual(visualPoolKey, e.color)';
    const acquireIdx = renderer.indexOf(acquire);
    expect(acquireIdx).toBeGreaterThan(-1);
    // scale rides the view group for pooled and fresh visuals alike
    expect(renderer).toContain('group.scale.setScalar(e.scale)');
    // a pool miss falls through to a fresh build from the SAME entity the
    // evicted visual was built from: eviction is invisible on screen
    const missWindow = renderer.slice(acquireIdx, acquireIdx + 1200);
    expect(missWindow).toContain("this.createCharacterVisualWithRetry(e, 'view')");
  });
});

describe('CharacterVisual.setEntityColor', () => {
  type RetintFake = {
    entityColor: number;
    def: { tint?: number | 'entity' };
    skinIndex: number;
    applySkinMaterials: ReturnType<typeof vi.fn>;
  };
  const callSetEntityColor = (fake: RetintFake, color: number): void => {
    (
      CharacterVisual.prototype.setEntityColor as unknown as (
        this: RetintFake,
        color: number,
      ) => void
    ).call(fake, color);
  };

  it('re-runs the shared material sweep only for an entity-tinted def with a new color', () => {
    const fake: RetintFake = {
      entityColor: 0x112233,
      def: { tint: 'entity' },
      skinIndex: 3,
      applySkinMaterials: vi.fn(),
    };
    callSetEntityColor(fake, 0x112233);
    expect(fake.applySkinMaterials).not.toHaveBeenCalled();

    callSetEntityColor(fake, 0xaabbcc);
    expect(fake.entityColor).toBe(0xaabbcc);
    // the sweep runs against the CURRENT skin, exactly like setSkin's heal path
    expect(fake.applySkinMaterials).toHaveBeenCalledTimes(1);
    expect(fake.applySkinMaterials).toHaveBeenCalledWith(3);
  });

  it('records but never sweeps for a def that ignores entity color (fixed or absent tint)', () => {
    const fixed: RetintFake = {
      entityColor: 0x111111,
      def: { tint: 0x336699 },
      skinIndex: 0,
      applySkinMaterials: vi.fn(),
    };
    callSetEntityColor(fixed, 0x222222);
    expect(fixed.entityColor).toBe(0x222222);
    expect(fixed.applySkinMaterials).not.toHaveBeenCalled();

    const untinted: RetintFake = {
      entityColor: 0x111111,
      def: {},
      skinIndex: 0,
      applySkinMaterials: vi.fn(),
    };
    callSetEntityColor(untinted, 0x222222);
    expect(untinted.entityColor).toBe(0x222222);
    expect(untinted.applySkinMaterials).not.toHaveBeenCalled();
  });
});
