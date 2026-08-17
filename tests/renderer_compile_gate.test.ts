import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type EntityView, Renderer } from '../src/render/renderer';

interface CompileGateHarness {
  gateViewOnCompile(view: EntityView, group: THREE.Group): Promise<void> | null;
  gateSwapOnCompile(target: THREE.Object3D): void;
  gateSwapFlagOnCompile(target: THREE.Object3D, onSettled: () => void): void;
  compileGate(target: THREE.Object3D): Promise<unknown>;
  attachZoneFeature(
    view: { group: THREE.Group; glowLights?: THREE.PointLight[]; cullGroups?: THREE.Group[] },
    freeze?: boolean,
  ): void;
}

function zoneFeatureHarness(): CompileGateHarness & Record<string, unknown> {
  const renderer = harness();
  const added: THREE.Object3D[] = [];
  renderer.scene = { add: (o: THREE.Object3D) => added.push(o) };
  renderer.sceneAdded = added;
  renderer.tmpV = new THREE.Vector3();
  renderer.fireLights = [];
  renderer.lastAttachedFeatureGroups = [];
  renderer.zoneFeatureGroups = [];
  renderer.lightRankDirty = false;
  return renderer;
}

function harness(): CompileGateHarness & Record<string, unknown> {
  const renderer = Object.create(Renderer.prototype) as CompileGateHarness &
    Record<string, unknown>;
  renderer.asyncCompileSupported = true;
  renderer.lifecycleGeneration = 7;
  renderer.shutdownStarted = false;
  return renderer;
}

async function flushGate(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => vi.restoreAllMocks());

describe('Renderer live shader compile rejection recovery', () => {
  it('clears a new view gate and restores its visibility for first-draw fallback', async () => {
    const renderer = harness();
    const failure = new Error('view link rejected');
    renderer.compileGate = () => Promise.reject(failure);
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    const group = new THREE.Group();
    const view = { compilePending: false } as EntityView;

    const ready = renderer.gateViewOnCompile(view, group);
    expect(view.compilePending).toBe(true);
    expect(group.visible).toBe(false);
    await ready;

    expect(view.compilePending).toBe(false);
    expect(group.visible).toBe(true);
    expect(report).toHaveBeenCalledWith('Live shader compile gate failed', failure);
  });

  it('restores a view gate to its prior hidden state after rejection', async () => {
    const renderer = harness();
    renderer.compileGate = () => Promise.reject(new Error('hidden view link rejected'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const group = new THREE.Group();
    group.visible = false;
    const view = { compilePending: false } as EntityView;

    await renderer.gateViewOnCompile(view, group);

    expect(view.compilePending).toBe(false);
    expect(group.visible).toBe(false);
  });

  it('reveals a live material-swap target after successful compilation', async () => {
    const renderer = harness();
    renderer.compileGate = () => Promise.resolve();
    const target = new THREE.Group();

    renderer.gateSwapOnCompile(target);
    expect(target.visible).toBe(false);
    await flushGate();

    expect(target.visible).toBe(true);
  });

  it('settles a caller-owned live-swap flag after successful compilation', async () => {
    const renderer = harness();
    renderer.compileGate = () => Promise.resolve();
    const onSettled = vi.fn();

    renderer.gateSwapFlagOnCompile(new THREE.Group(), onSettled);
    await flushGate();

    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('restores a live material-swap target after rejection', async () => {
    const renderer = harness();
    const failure = new Error('swap link rejected');
    renderer.compileGate = () => Promise.reject(failure);
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    const target = new THREE.Group();

    renderer.gateSwapOnCompile(target);
    expect(target.visible).toBe(false);
    await flushGate();

    expect(target.visible).toBe(true);
    expect(report).toHaveBeenCalledWith('Live shader compile gate failed', failure);
  });

  it('clears the caller-owned live-swap flag after rejection', async () => {
    const renderer = harness();
    const failure = new Error('flagged swap link rejected');
    renderer.compileGate = () => Promise.reject(failure);
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSettled = vi.fn();

    renderer.gateSwapFlagOnCompile(new THREE.Group(), onSettled);
    await flushGate();

    expect(onSettled).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith('Live shader compile gate failed', failure);
  });

  it('ignores a rejection from a stale renderer generation', async () => {
    const renderer = harness();
    let reject!: (error: unknown) => void;
    renderer.compileGate = () => new Promise((_resolve, rejectGate) => (reject = rejectGate));
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    const target = new THREE.Group();

    renderer.gateSwapOnCompile(target);
    renderer.lifecycleGeneration = 8;
    reject(new Error('stale link rejection'));
    await flushGate();

    expect(target.visible).toBe(false);
    expect(report).not.toHaveBeenCalled();
  });

  it('links the tier-correct colour variant then the skinned shadow variant in one gate slot', async () => {
    const renderer = harness();
    const order: string[] = [];
    renderer.sim = { player: { targetId: null } };
    renderer.liveCompileGates = { run: (fn: () => Promise<unknown>) => fn() };
    renderer.compilePrewarmColorPrograms = vi.fn(
      (_root: THREE.Object3D, includeOffscreenVariant: boolean) => {
        order.push(`color:${includeOffscreenVariant}`);
        return Promise.resolve();
      },
    );
    renderer.compileShadowPrograms = vi.fn(() => {
      order.push('shadow');
      return Promise.resolve();
    });
    const target = new THREE.Group();

    await renderer.compileGate(target);

    expect(order).toEqual(['color:false', 'shadow']);
    expect(renderer.compilePrewarmColorPrograms).toHaveBeenCalledWith(target, false);
    expect(renderer.compileShadowPrograms).toHaveBeenCalledWith(target);
  });

  it('never compiles a live gate at the ambient render target (colour-space cache-key trap)', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const gateStart = source.indexOf('private compileGate(');
    const gateEnd = source.indexOf('private recoverRejectedCompileGate(', gateStart);
    expect(gateStart).toBeGreaterThan(-1);
    expect(gateEnd).toBeGreaterThan(gateStart);
    const gateMethod = source.slice(gateStart, gateEnd);
    // Three keys a program on the bound target's output colour space, so a bare
    // compileAsync here links the canvas variant while composer tiers draw the
    // linear one: route through the same variant pair the boot prewarm uses.
    expect(gateMethod).toContain('this.compilePrewarmColorPrograms(target, false)');
    expect(gateMethod).toContain('this.compileShadowPrograms(target)');
    expect(gateMethod).not.toContain('this.webgl.compileAsync');
  });

  it('gates a zone feature attach and defers its distance-cull registration', async () => {
    const renderer = zoneFeatureHarness();
    let release!: () => void;
    renderer.compileGate = () => new Promise<void>((resolve) => (release = resolve));
    const group = new THREE.Group();

    renderer.attachZoneFeature({ group });

    expect(renderer.sceneAdded).toContain(group);
    expect(group.visible).toBe(false);
    // The per-frame fog sweep (updateZoneFeatureVisibility) must not see the
    // group until reveal, or it flips the hidden group visible mid-compile.
    expect(renderer.zoneFeatureGroups).toEqual([]);

    release();
    await flushGate();
    await flushGate();

    expect(group.visible).toBe(true);
    expect((renderer.zoneFeatureGroups as unknown[]).length).toBe(1);
  });

  it('attaches a zone feature directly when async compile is unsupported', () => {
    const renderer = zoneFeatureHarness();
    renderer.asyncCompileSupported = false;
    renderer.compileGate = () => {
      throw new Error('must not gate without async compile support');
    };
    const group = new THREE.Group();

    renderer.attachZoneFeature({ group });

    expect(group.visible).toBe(true);
    expect((renderer.zoneFeatureGroups as unknown[]).length).toBe(1);
  });

  it('routes every dungeon interior build through the gate-injected constructor', () => {
    const rendererSource = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    );
    // One construction point: ensureDungeons injects the live compile gate, so
    // a streamed interior (dungeon approach, delve module, rift floor) never
    // links its programs synchronously on its first visible frame.
    expect(rendererSource.split('new DungeonInteriors(').length - 1).toBe(1);
    const ensureStart = rendererSource.indexOf('private ensureDungeons(');
    expect(ensureStart).toBeGreaterThan(-1);
    const ensureBody = rendererSource.slice(ensureStart, rendererSource.indexOf('}', ensureStart));
    expect(ensureBody).toContain(
      'this.asyncCompileSupported ? (target) => this.compileGate(target) : undefined',
    );
    const dungeonSource = readFileSync(
      new URL('../src/render/dungeon.ts', import.meta.url),
      'utf8',
    );
    expect(dungeonSource).toContain(
      'await attachSceneGroupGated(this.scene, group, this.compileGate)',
    );
  });

  it('ignores a rejection after renderer shutdown starts', async () => {
    const renderer = harness();
    let reject!: (error: unknown) => void;
    renderer.compileGate = () => new Promise((_resolve, rejectGate) => (reject = rejectGate));
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    const target = new THREE.Group();

    renderer.gateSwapOnCompile(target);
    renderer.shutdownStarted = true;
    reject(new Error('shutdown link rejection'));
    await flushGate();

    expect(target.visible).toBe(false);
    expect(report).not.toHaveBeenCalled();
  });
});
