// The far-LOD compile gate (src/render/characters/visual.ts +
// far_lod_reveal_core.ts): a composed body bakes its far mesh on its first far
// crossing, AFTER the view's creation gate walked the rig, and its materials
// are brand-new programs (the near body's minus the skinning bit, plus the
// shadow proxy's depth arm). Before this gate, `setFar` minted the mesh and
// flipped it visible in the same call, so its first draw linked those programs
// synchronously: the prod 100-160 ms frames on every far crossing of a peer
// in a not-yet-seen outfit, and on every peer streaming in already far.
//
// The visual now owns a "far bake linking" flag: while it is set the far mesh
// counts as absent (the articulated rig keeps drawing, the far mesh and its
// shadow proxy stay hidden), and the renderer's gate reports back through it.
//
// `setFar`/`buildComposedFar` are exercised on a minimal object whose
// prototype IS CharacterVisual's (the pattern of tests/modular_far_lod.test.ts:
// the class needs a parsed modular GLB to construct for real), with only the
// module-level bake collaborators stubbed. The skin swap-on-settle path drives
// the REAL construction of a fixed rig (mocked GLTF/texture loader only), as
// tests/character_far_mesh_skin.test.ts does.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as assets from '../src/render/characters/assets';
import { CharacterVisual, type FarBakeGate } from '../src/render/characters/visual';

function readSource(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

// biome-ignore lint/suspicious/noExplicitAny: private-member access on the prototype fake
type AnyVisual = any;

// A hand-kept mirror of the constructor fields the far-bake paths read (the
// same caveat as the fakeVisual in tests/modular_far_lod.test.ts).
function fakeVisual(overrides: Record<string, unknown> = {}): AnyVisual {
  const fake: AnyVisual = Object.create(CharacterVisual.prototype);
  const modelWrap = new THREE.Group();
  modelWrap.name = 'character_model_wrap';
  Object.assign(fake, {
    far: false,
    farBakeTried: false,
    farBakePending: false,
    farCompilePending: false,
    farBakeGate: null,
    farWrap: null,
    farSkinScratch: null,
    pendingFarClaims: null,
    proxyShadowWanted: false,
    disposed: false,
    look: { app: {}, worn: {} },
    key: 'test_key',
    model: new THREE.Group(),
    modelWrap,
    poseWrap: new THREE.Group(),
    entityColor: 0xffffff,
    skinIndex: 0,
    tintedFarClaims: new Set(),
    shadowProxy: null,
    originalMaterials: new Map(),
    farMesh: null,
    farMaterials: null,
    ghosted: false,
    ghostStyle: 'spirit',
    ghostMaterials: new Map(),
    soulRend: false,
    metamorph: false,
    moonkin: false,
    shadowform: false,
    runeTint: null,
    auraGlowIntensity: 0,
    ...overrides,
  });
  return fake;
}

function stubComposedBake(): void {
  vi.spyOn(assets, 'peekModularFarBake').mockReturnValue(null);
  vi.spyOn(assets, 'takeFarBakeBudget').mockReturnValue(true);
  vi.spyOn(assets, 'modularFarBake').mockReturnValue({
    geo: new THREE.BufferGeometry(),
    isBody: [true],
  } as unknown as ReturnType<typeof assets.modularFarBake>);
  vi.spyOn(assets, 'prepareVisual').mockReturnValue({
    def: {},
  } as unknown as ReturnType<typeof assets.prepareVisual>);
  vi.spyOn(assets, 'farSourceMaterials').mockReturnValue([]);
  vi.spyOn(assets, 'skinTexture').mockReturnValue(null);
  vi.spyOn(assets, 'skinEmissiveTexture').mockReturnValue(null);
  vi.spyOn(assets, 'tintedFarMaterials').mockReturnValue([
    new THREE.MeshStandardMaterial({ name: 'far_body' }),
  ]);
}

/** A gate that records its target and hands the settle back to the test. */
function capturingGate(): {
  gate: FarBakeGate;
  calls: { target: THREE.Object3D; settle: () => void }[];
} {
  const calls: { target: THREE.Object3D; settle: () => void }[] = [];
  return { gate: (target, onSettled) => calls.push({ target, settle: onSettled }), calls };
}

describe('the composed far bake links hidden behind the gate', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the rig visible and the far mesh + shadow proxy hidden until the gate settles', () => {
    stubComposedBake();
    const { gate, calls } = capturingGate();
    const fake = fakeVisual({ farBakeGate: gate });

    fake.setFar(true);

    // The bake happened (the mesh exists) and the gate saw ONE node holding
    // both the far mesh (colour arm) and its shadow proxy (depth arm)...
    const farMesh = fake.farMesh as THREE.Mesh;
    expect(farMesh).not.toBeNull();
    expect(calls).toHaveLength(1);
    const gated = calls[0].target;
    expect(gated.name).toBe('character_far_wrap');
    expect(gated.getObjectByName('character_far_mesh')).toBe(farMesh);
    // (the low tier builds no shadow proxy; the Node default tier is not low,
    // so the proxy arm below is exercised, not skipped)
    expect(fake.shadowProxy).not.toBeNull();
    expect(gated.getObjectByName('character_shadow_proxy')).toBe(fake.shadowProxy);
    expect(gated.parent).toBe(fake.poseWrap);

    // ...but nothing is revealed yet: this is the whole fix. Before it, the
    // rig hid and the far mesh drew (and linked) in this same call.
    expect(fake.isFar).toBe(true);
    expect(fake.modelWrap.visible).toBe(true);
    expect(farMesh.visible).toBe(false);
    // The renderer's shadow plan asking for the proxy meanwhile does not show it
    fake.setProxyShadow(true);
    expect(fake.shadowProxy.visible).toBe(false);
    // Repeated per-frame setFar(true) writes are a no-op (no second gate)
    fake.setFar(true);
    expect(calls).toHaveLength(1);
    expect(fake.modelWrap.visible).toBe(true);

    calls[0].settle();

    // The settle only clears the flag: nothing flips between frames (a rig
    // hidden outside the per-frame pass takes its budgeted weapon lights out
    // of three's counted set behind the light budget's back, and
    // numPointLights is in every program cache key). The next per-frame
    // setFar write does the reveal.
    expect(fake.farCompilePending).toBe(false);
    expect(fake.modelWrap.visible).toBe(true);
    expect(farMesh.visible).toBe(false);
    fake.setFar(true);

    // Revealed: the far mesh stands in, the rig hides, the wanted proxy shows.
    expect(fake.modelWrap.visible).toBe(false);
    expect(farMesh.visible).toBe(true);
    expect(fake.shadowProxy.visible).toBe(true);
    // ...and every later far crossing is free: no gate, immediate handoff
    fake.setFar(false);
    expect(fake.modelWrap.visible).toBe(true);
    expect(farMesh.visible).toBe(false);
    fake.setFar(true);
    expect(calls).toHaveLength(1);
    expect(fake.modelWrap.visible).toBe(false);
    expect(farMesh.visible).toBe(true);
  });

  it('a settle that lands after the body came back near does not hide the rig', () => {
    stubComposedBake();
    const { gate, calls } = capturingGate();
    const fake = fakeVisual({ farBakeGate: gate });
    fake.setFar(true);
    fake.setFar(false);
    calls[0].settle();
    fake.setFar(false);
    // near: rig visible, far mesh hidden, whatever the gate says
    expect(fake.modelWrap.visible).toBe(true);
    expect((fake.farMesh as THREE.Mesh).visible).toBe(false);
    // and the next far crossing reveals immediately (the bake is linked)
    fake.setFar(true);
    expect(fake.modelWrap.visible).toBe(false);
    expect((fake.farMesh as THREE.Mesh).visible).toBe(true);
  });

  it('a settle for a wrap this visual no longer draws is ignored', () => {
    stubComposedBake();
    const { gate, calls } = capturingGate();
    const fake = fakeVisual({ farBakeGate: gate });
    fake.setFar(true);
    // the guard's other arm: the wrap identity moved (defense in depth, a
    // visual mints at most once today)
    fake.farWrap = new THREE.Group();
    calls[0].settle();
    expect(fake.farCompilePending).toBe(true);
  });

  it('a settle that lands after dispose is ignored', () => {
    stubComposedBake();
    const { gate, calls } = capturingGate();
    const fake = fakeVisual({ farBakeGate: gate });
    fake.setFar(true);
    fake.disposed = true;
    expect(() => calls[0].settle()).not.toThrow();
    expect(fake.farCompilePending).toBe(true);
    expect(fake.modelWrap.visible).toBe(true);
  });

  it('a budget-refused crossing gates on the retry, not before', () => {
    // First crossing: the part set has no bake yet and the frame slot is
    // taken, so the crossing goes pending and the rig keeps drawing.
    stubComposedBake();
    const budget = vi.spyOn(assets, 'takeFarBakeBudget').mockReturnValue(false);
    const { gate, calls } = capturingGate();
    const fake = fakeVisual({ farBakeGate: gate });
    fake.setFar(true);
    expect(fake.farBakePending).toBe(true);
    expect(fake.farMesh).toBeNull();
    expect(calls).toHaveLength(0);
    expect(fake.modelWrap.visible).toBe(true);

    // The per-frame retry (update(): attemptComposedFar then syncFarVisibility)
    // wins a slot: the bake is minted and gated, still not revealed.
    budget.mockReturnValue(true);
    fake.attemptComposedFar();
    fake.syncFarVisibility();
    expect(fake.farMesh).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(fake.modelWrap.visible).toBe(true);
    expect((fake.farMesh as THREE.Mesh).visible).toBe(false);
    calls[0].settle();
    fake.setFar(true);
    expect(fake.modelWrap.visible).toBe(false);
    expect((fake.farMesh as THREE.Mesh).visible).toBe(true);
  });

  it('installing a gate resets a bake left pending by a previous life', () => {
    // pool re-acquire: a settle the old renderer generation dropped must not
    // strand the visual articulated
    stubComposedBake();
    const { gate } = capturingGate();
    const fake = fakeVisual({ farBakeGate: gate });
    fake.setFar(true);
    expect(fake.farCompilePending).toBe(true);
    fake.setFarBakeGate(gate);
    expect(fake.farCompilePending).toBe(false);
  });

  it('reveals immediately without a gate (previews, hosts without one)', () => {
    stubComposedBake();
    const fake = fakeVisual();
    fake.setFar(true);
    expect(fake.farCompilePending).toBe(false);
    expect(fake.modelWrap.visible).toBe(false);
    expect((fake.farMesh as THREE.Mesh).visible).toBe(true);
  });

  it("update()'s retry goes through the same reveal rule (source pin)", () => {
    // The retry lives inside update(), which needs a live mixer to call; pin
    // that it hands the reveal to syncFarVisibility rather than flipping the
    // two .visible flags itself (the pre-gate shape, which bypassed the
    // pending flag).
    const source = readSource('src/render/characters/visual.ts');
    const start = source.indexOf('if (this.farBakePending && this.far && !this.farBakeTried) {');
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf('\n    }', start));
    expect(block).toContain('this.attemptComposedFar();');
    expect(block).toContain('this.syncFarVisibility();');
    expect(block).not.toContain('.visible =');
    // and the gate's settle is flag-only: no visibility write outside the
    // per-frame pass (see setFar for the light-budget reason)
    const mint = source.slice(
      source.indexOf('private gateFarMint(): void {'),
      source.indexOf('\n  }', source.indexOf('private gateFarMint(): void {')),
    );
    expect(mint).toContain('this.farCompilePending = false;');
    expect(mint).not.toContain('syncFarVisibility');
    // and the only writers of the rig/far-mesh handoff are the sync helpers
    const writers = source.match(/this\.(modelWrap|farMesh|shadowProxy)\.visible = /g) ?? [];
    expect(writers.length).toBeGreaterThan(0);
    for (const match of source.matchAll(/this\.(modelWrap|farMesh|shadowProxy)\.visible = /g)) {
      const before = source.lastIndexOf('\n  private ', match.index);
      const owner = source.slice(before, source.indexOf('(', before));
      expect(['syncFarVisibility', 'syncShadowProxyVisibility', 'buildFarMeshes']).toContain(
        owner.replace('\n  private ', ''),
      );
    }
  });
});
