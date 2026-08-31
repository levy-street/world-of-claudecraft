import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import * as characters from '../src/render/characters';
import { prewarmDepthMaterialKey } from '../src/render/prewarm_depth_material';
import { type EntityView, Renderer } from '../src/render/renderer';

interface CompileGateHarness {
  gateViewOnCompile(
    view: EntityView,
    group: THREE.Group,
    visibilityTarget?: THREE.Object3D,
    requiredForEntry?: boolean,
  ): Promise<void> | null;
  gateSwapOnCompile(target: THREE.Object3D): void;
  gateSwapFlagOnCompile(target: THREE.Object3D, onSettled: () => void): void;
  compileGate(target: THREE.Object3D, requiredForEntry?: boolean): Promise<unknown>;
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
  // the shadow arm's depth-twin cache, read by every gate piece's variant settle
  renderer.prewarmDepthMaterials = new Map();
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

  it('keeps an actionable encounter anchor visible while only its rig compiles', async () => {
    const renderer = harness();
    let release!: () => void;
    renderer.compileGate = () => new Promise<void>((resolve) => (release = resolve));
    const group = new THREE.Group();
    const rig = new THREE.Group();
    const telegraph = new THREE.Group();
    group.add(rig, telegraph);
    const view = { compilePending: false, visualCompilePending: false } as EntityView;

    const ready = renderer.gateViewOnCompile(view, group, rig);

    expect(view.compilePending).toBe(true);
    expect(view.visualCompilePending).toBe(true);
    expect(group.visible).toBe(true);
    expect(rig.visible).toBe(false);
    expect(telegraph.visible).toBe(true);

    release();
    await ready;

    expect(view.compilePending).toBe(false);
    expect(view.visualCompilePending).toBe(false);
    expect(group.visible).toBe(true);
    expect(rig.visible).toBe(true);
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
    // The queue resolves the gate RESULT, which is what tells the tail whether
    // anything was proved linked. The gate hands it one piece per material
    // group of the target (here one), each the colour arm then the shadow arm.
    renderer.liveCompileGates = {
      runPieces: (pieces: Array<() => Promise<unknown>>) =>
        pieces
          .reduce<Promise<unknown>>((chain, piece) => chain.then(piece), Promise.resolve())
          .then(() => ({ failed: false, timedOut: false })),
    };
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
    // the touch tail reads renderer.properties for the target's materials
    const properties = { get: vi.fn(() => ({})) };
    renderer.webgl = { properties };
    const target = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    target.add(mesh);

    await renderer.compileGate(target);

    expect(order).toEqual(['color:false', 'shadow']);
    // Twice for the one material: the piece's variant settle (which finds no
    // program to poll here), then the tail's collect walk. No marking walk:
    // the settle is the only proof (runWorldGateTouchLane). None of them asks
    // the driver anything.
    expect(properties.get).toHaveBeenCalledTimes(2);
    // The arms compile the material carrier itself, in place, never the root:
    // three prepares materials only under the node it is handed, so this is
    // exactly the mesh's programs, and one queue unit per material group.
    expect(renderer.compilePrewarmColorPrograms).toHaveBeenCalledWith(mesh, false);
    expect(renderer.compileShadowPrograms).toHaveBeenCalledWith(mesh);
  });

  it('submits one gate piece per material group of the target, one representative compile each', async () => {
    const renderer = harness();
    renderer.sim = { player: { targetId: null } };
    const submitted: Array<{ pieces: number; label?: string }> = [];
    renderer.liveCompileGates = {
      runPieces: (
        pieces: Array<() => Promise<unknown>>,
        _timeoutMs: number,
        options: { label?: string },
      ) => {
        submitted.push({ pieces: pieces.length, label: options.label });
        return pieces
          .reduce<Promise<unknown>>((chain, piece) => chain.then(piece), Promise.resolve())
          .then(() => ({ failed: false, timedOut: false }));
      },
    };
    const compiled: THREE.Object3D[] = [];
    renderer.compilePrewarmColorPrograms = (node: THREE.Object3D) => {
      compiled.push(node);
      return Promise.resolve();
    };
    renderer.compileShadowPrograms = () => Promise.resolve();
    renderer.webgl = { properties: { get: () => ({}) } };
    // A composed body: two skinned parts share the tinted skin material, the
    // eyes wear their own, the hair another. Three groups, four carriers.
    const target = new THREE.Group();
    target.name = 'Group';
    const skin = new THREE.MeshStandardMaterial();
    const torso = new THREE.Mesh(new THREE.BufferGeometry(), skin);
    const eyes = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    const legs = new THREE.Mesh(new THREE.BufferGeometry(), skin);
    const hair = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    target.add(torso, eyes, legs, hair);

    await renderer.compileGate(target);

    expect(submitted).toEqual([{ pieces: 3, label: 'live-gate:Group' }]);
    // one compile per group: legs shares torso's programs (same material,
    // same static variant), so only the group's first carrier is compiled
    expect(compiled).toEqual([torso, eyes, hair]);
  });

  it('holds an ordinary live gate until the initial-paint barrier settles', async () => {
    const renderer = harness();
    let release!: () => void;
    renderer.initialGpuWorkStart = new Promise<void>((resolve) => (release = resolve));
    renderer.sim = { player: { id: 1, targetId: null }, entities: new Map() };
    const runPieces = vi.fn(() => Promise.resolve({ failed: false, timedOut: false }));
    renderer.liveCompileGates = { runPieces };
    renderer.compilePrewarmColorPrograms = vi.fn(() => Promise.resolve());
    renderer.compileShadowPrograms = vi.fn(() => Promise.resolve());
    renderer.webgl = { properties: { get: () => ({}) } };
    renderer.uploadGateTexturesGated = vi.fn(() => Promise.resolve(0));
    renderer.touchLinkedProgramsGated = vi.fn(() => Promise.resolve(0));
    const target = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());

    const pending = renderer.compileGate(target);
    expect(runPieces).not.toHaveBeenCalled();
    release();
    await pending;
    expect(runPieces).toHaveBeenCalledOnce();
  });

  it('starts a targeted live gate immediately despite the initial-paint barrier', async () => {
    const renderer = harness();
    renderer.initialGpuWorkStart = new Promise<void>(() => undefined);
    renderer.sim = { player: { id: 1, targetId: 7 }, entities: new Map() };
    const runPieces = vi.fn(() => Promise.resolve({ failed: false, timedOut: false }));
    renderer.liveCompileGates = { runPieces };
    renderer.compilePrewarmColorPrograms = vi.fn(() => Promise.resolve());
    renderer.compileShadowPrograms = vi.fn(() => Promise.resolve());
    renderer.webgl = { properties: { get: () => ({}) } };
    renderer.uploadGateTexturesGated = vi.fn(() => Promise.resolve(0));
    renderer.touchLinkedProgramsGated = vi.fn(() => Promise.resolve(0));
    const target = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    target.userData.entityId = 7;

    await renderer.compileGate(target);
    expect(runPieces).toHaveBeenCalledOnce();
  });

  it('starts an entry-required live gate before the initial-paint barrier', async () => {
    const renderer = harness();
    let release!: () => void;
    renderer.initialGpuWorkStart = new Promise<void>((resolve) => (release = resolve));
    renderer.sim = { player: { id: 1, targetId: null }, entities: new Map() };
    const runPieces = vi.fn(() => Promise.resolve({ failed: false, timedOut: false }));
    renderer.liveCompileGates = { runPieces };
    renderer.compilePrewarmColorPrograms = vi.fn(() => Promise.resolve());
    renderer.compileShadowPrograms = vi.fn(() => Promise.resolve());
    renderer.webgl = { properties: { get: () => ({}) } };
    renderer.uploadGateTexturesGated = vi.fn(() => Promise.resolve(0));
    renderer.touchLinkedProgramsGated = vi.fn(() => Promise.resolve(0));
    const target = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());

    const pending = renderer.compileGate(target, true);
    await flushGate();
    expect(runPieces).toHaveBeenCalledOnce();
    release();
    await pending;
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
    // linear one: route through the same variant pair the boot prewarm uses,
    // per material-group piece of the target (compile_gate_pieces.ts), never
    // the whole target in one queue unit.
    expect(gateMethod).toContain('this.compilePrewarmColorPrograms(node, false)');
    expect(gateMethod).toContain('this.compileShadowPrograms(node)');
    expect(gateMethod).toContain('this.liveCompileGates.runPieces(');
    expect(gateMethod).toContain('compileMayStartBeforeInitialPaint(priority, requiredForEntry)');
    expect(gateMethod).toContain('this.initialGpuWorkStart');
    expect(gateMethod).toContain('linkPieceWork(target, color, shadow, settle),');
    expect(gateMethod).not.toContain('this.liveCompileGates.run(');
    expect(gateMethod).toContain('this.uploadGateTexturesGated(target, priority)');
    // The tail carries the GATE's result: a timed-out or failed link proved
    // nothing, and readiness in the walk comes from a settle, never from a
    // synchronous COMPLETION_STATUS query (linked_program_readiness.ts).
    expect(gateMethod).toContain('this.touchLinkedProgramsGated(target, priority, gate)');
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
    expect(dungeonSource).toMatch(
      /await attachSceneGroupGated\(\s*this\.scene,\s*group,\s*this\.compileGate,\s*\(\) => registry\.isRetired/,
    );
  });

  it('gates every buildInterior return path except the caldera light rig', () => {
    // The authored room-graph floors (Last Keep, Dawnhold, the Infernal
    // Citadel) returned early through a bare this.scene.add(group), so those
    // interiors linked their programs on their first visible frame. The
    // Wildheart caldera arm stays a bare add on purpose: its rig adds a
    // hemisphere and a directional light, which relinks every lit material in
    // the scene at the reveal whatever the group's own gate compiled (a gate
    // compiles the group at the OLD light census, so it would only add a hidden
    // window); pre-linking a scene-wide light census is a backlog item.
    const dungeonSource = readFileSync(
      new URL('../src/render/dungeon.ts', import.meta.url),
      'utf8',
    );
    const start = dungeonSource.indexOf('  async buildInterior(');
    expect(start).toBeGreaterThan(-1);
    const body = dungeonSource.slice(start, dungeonSource.indexOf('\n  }', start));
    const returns = body.split('return group;').length - 1;
    const gated = body.split('await attachSceneGroupGated(').length - 1;
    const bareAdds = body.split('this.scene.add(group);').length - 1;
    expect(returns).toBeGreaterThanOrEqual(3);
    expect(bareAdds).toBe(1);
    expect(gated).toBe(returns - 1);
    const wildheart = body.indexOf("if (interior === 'wildheart')");
    expect(wildheart).toBeGreaterThan(-1);
    const wildheartArm = body.slice(wildheart, body.indexOf('return group;', wildheart));
    expect(wildheartArm).toContain('this.scene.add(group);');
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

// The gate's tail used to be ONE call that warmed every linked program under
// the target in a single synchronous burst. It is now one queue unit per
// program, which is what the per-frame admission can pace; the gate still
// settles only after the last piece, so a gated reveal is no earlier.
describe('the compile gate touch tail, per program', () => {
  function touchHarness(
    programs: number,
  ): CompileGateHarness &
    Record<string, unknown> & { queued: { label?: string; priority?: number }[]; order: string[] } {
    const renderer = harness();
    const order: string[] = [];
    const queued: { label?: string; priority?: number }[] = [];
    renderer.sim = { player: { targetId: null } };
    // The queue resolves the gate RESULT, which is what tells the tail whether
    // anything was proved linked. One piece per material (each mesh below
    // wears its own), run serially here like the local fallback, each handed
    // a live deadline the way runPieces does.
    renderer.liveCompileGates = {
      runPieces: (pieces: Array<(deadline: { fired: boolean }) => Promise<unknown>>) =>
        pieces
          .reduce<Promise<unknown>>(
            (chain, piece) => chain.then(() => piece({ fired: false })),
            Promise.resolve(),
          )
          .then(() => ({ failed: false, timedOut: false })),
    };
    renderer.compilePrewarmColorPrograms = () => {
      order.push('color');
      return Promise.resolve();
    };
    renderer.compileShadowPrograms = () => {
      order.push('shadow');
      return Promise.resolve();
    };
    // The driver is asked ONLY by the piece's variant settle, inside the gate
    // (program_variant_settle.ts); from the first touch unit on, readiness is
    // the record (src/render/linked_program_readiness.ts), so a query issued
    // once the tail has started is the 5.6 s production freeze coming back and
    // fails the harness outright.
    let touching = false;
    renderer.backgroundGpuWork = {
      run: (work: () => unknown, priority?: number, label?: string) => {
        touching = true;
        queued.push({ label, priority });
        order.push(`unit:${queued.length}`);
        work();
        return Promise.resolve();
      },
    };
    // One material per program, each with the variant a settled compile
    // resolved to.
    const linked = new Map<unknown, { programs: Map<string, unknown>; currentProgram: unknown }>();
    const target = new THREE.Group();
    for (let index = 0; index < programs; index++) {
      const material = new THREE.MeshStandardMaterial();
      const variant = {
        isReady: () => {
          if (touching) throw new Error('the touch tail must never query the driver for readiness');
          order.push('poll');
          return true;
        },
        getUniforms: vi.fn(),
        getAttributes: vi.fn(),
      };
      linked.set(material, {
        programs: new Map([[`variant${index}`, variant]]),
        currentProgram: variant,
      });
      target.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
    }
    renderer.webgl = { properties: { get: (queried: unknown) => linked.get(queried) } };
    renderer.touchTarget = target;
    renderer.queued = queued;
    renderer.order = order;
    return renderer as CompileGateHarness &
      Record<string, unknown> & {
        queued: { label?: string; priority?: number }[];
        order: string[];
      };
  }

  it('issues one touch:program unit per linked program, after the compiles, in order', async () => {
    const renderer = touchHarness(3);

    await renderer.compileGate(renderer.touchTarget as THREE.Object3D);

    // Each piece: its two compiles, then its settle's poll (one query per
    // variant, all ready at once here); the touch units come after every
    // piece settled and issue no query of their own.
    expect(renderer.order).toEqual([
      'color',
      'shadow',
      'poll',
      'color',
      'shadow',
      'poll',
      'color',
      'shadow',
      'poll',
      'unit:1',
      'unit:2',
      'unit:3',
    ]);
    // A LIVE_VIEW gate's pieces ride at TAIL_PIECE, below every link submission.
    expect(renderer.queued).toEqual([
      { label: 'touch:program', priority: GPU_WORK_PRIORITY.TAIL_PIECE },
      { label: 'touch:program', priority: GPU_WORK_PRIORITY.TAIL_PIECE },
      { label: 'touch:program', priority: GPU_WORK_PRIORITY.TAIL_PIECE },
    ]);
  });

  it('carries the gate priority onto the pieces, so a targeted tail outranks a bystander', async () => {
    const renderer = touchHarness(1);
    const target = renderer.touchTarget as THREE.Object3D;
    target.userData.entityId = 42;
    renderer.sim = { player: { targetId: 42 } };

    await renderer.compileGate(target);

    expect(renderer.queued).toEqual([
      { label: 'touch:program', priority: GPU_WORK_PRIORITY.ACTIONABLE_VIEW },
    ]);
  });

  it('is the same tail on the reveal host, and neither gate keeps the one-shot burst (source pins)', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    // The reveal host is its own module now; the renderer binds the tail into
    // it, and the module composes it after the link.
    const host = readFileSync(
      new URL('../src/render/reveal_compile_host.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain(
      'touch: (target, priority, gate) => this.touchLinkedProgramsGated(target, priority, gate),',
    );
    // The same host also pays the cold textures, between the link and the tail.
    expect(source).toContain(
      'upload: (target, priority) => this.uploadGateTexturesGated(target, priority),',
    );
    // Both ride the key's own priority, the imminent one included, so an
    // arrival's tail cannot fall behind the lane its link overtook.
    expect(host).toContain('.then((gate) => deps.upload(target, priority).then(() => gate))');
    // Streamed decor paid the uniform-table round trip on its reveal DRAW
    // (40 to 390 ms on the Intel iGPU) because the reveal host's chain ended at
    // the shadow arm: it now pays the same tail the live gates do.
    expect(host).toContain('.then((gate) => deps.touch(target, priority, gate))');
    // The one-shot burst is gone from the renderer entirely: it cannot be paced,
    // and a call left behind would silently reinstate the whole cost in one frame.
    expect(source).not.toContain('touchLinkedPrograms(');
    // The world tail: no walk mark ever (the pieces' settle is the only
    // proof), and the unproven programs the walk skips recorded as evidence
    // (runWorldGateTouchLane); the bare lane with its marking arm stays with
    // the preview context, whose awaited compileAsync IS its proof.
    expect(source).toContain(
      'runWorldGateTouchLane(this.backgroundGpuWork, properties, target, priority, gate)',
    );
    expect(source).not.toContain('runLinkedProgramTouchLane(');
    expect(source).not.toContain('settled: !gate.failed && !gate.timedOut,');
  });

  it('opens both GPU-preparation frame clocks in the same unconditional sync prologue', () => {
    // The queue's frame clock kept arming and aging while the budget's frame
    // never opened: its noteFrame sat behind the present/dt guards, so a
    // hidden tab left spentThisFrameMs charged and both per-frame slots
    // latched. One prologue, both clocks, every frame.
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const syncStart = source.indexOf('    const totalStart = performance.now();');
    expect(syncStart).toBeGreaterThan(-1);
    const prologue = source.slice(syncStart, source.indexOf('if (present)', syncStart));
    expect(prologue).toContain('this.backgroundGpuWork.noteFrame(totalStart);');
    expect(prologue).toContain('this.gpuPrepBudget.noteFrame(');
    // The tier's live drop-frame threshold rides along: GFX is reassigned on a
    // tier change, so a target captured at construction goes stale.
    expect(prologue).toContain('GFX.budget.dropFrameMs');
    // And nowhere else: a second, conditional frame boundary is the defect.
    expect(source.split('this.gpuPrepBudget.noteFrame(').length - 1).toBe(1);
  });
});

describe('the shadow arm compiles a depth twin for every mesh, caster or not', () => {
  // castShadow is a runtime toggle (entity views flip it with the shadow
  // band, zone features with the shadow volume, gather nodes likewise) and
  // the gate runs frames after a group appeared, so a rig created beyond the
  // band would have its depth arm skipped and link cold at its first shadow
  // draw as the player rides closer (eleven unnamed depth programs of 20 to
  // 41 ms in 0.3 s on the 3090 ride, ten at first draw through Eastbrook in
  // production). Depth twins are cached per (material inputs x mesh shape),
  // so a mesh that never casts costs a cache hit, never a wasted colour link.
  function shadowHarness() {
    const renderer = harness();
    renderer.sun = { shadow: { camera: new THREE.PerspectiveCamera() } };
    renderer.scene = { fog: { name: 'fog' } };
    // The real src/render/prewarm_depth_material.ts factory fills this cache:
    // the twins' derivation is pinned by tests/prewarm_depth_material.test.ts
    // and tests/renderer_shadow_prewarm.test.ts, so these cases only assert
    // WHICH meshes wear a twin and when the originals come back.
    renderer.prewarmDepthMaterials = new Map<string, THREE.MeshDepthMaterial>();
    return renderer as typeof renderer & {
      prewarmDepthMaterials: Map<string, THREE.MeshDepthMaterial>;
      compileShadowPrograms(root: THREE.Object3D): Promise<void>;
    };
  }

  it('swaps every mesh to its depth twin for the prologue, castShadow false included, restoring all BEFORE the awaited link', async () => {
    const renderer = shadowHarness();
    const seen: string[] = [];
    let compiledRoot: THREE.Object3D | null = null;
    let resolveLink!: (root: THREE.Object3D) => void;
    renderer.webgl = {
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      compileAsync: (root: THREE.Object3D) => {
        compiledRoot = root;
        root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const material = mesh.material as THREE.Material | THREE.Material[] | null;
          const kind = (one: THREE.Material): string =>
            (one as THREE.MeshDepthMaterial).isMeshDepthMaterial ? 'depth' : one.name;
          seen.push(
            `${mesh.name}:${material === null ? 'null' : Array.isArray(material) ? material.map(kind).join('|') : kind(material)}`,
          );
        });
        return new Promise<THREE.Object3D>((resolve) => {
          resolveLink = resolve;
        });
      },
    };
    const wrap = new THREE.Group();
    // A rig created beyond the shadow band: castShadow false at gate time,
    // flipped true by the band a few hundred yards later.
    const farRig = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    farRig.name = 'far';
    (farRig.material as THREE.Material).name = 'far_body';
    farRig.castShadow = false;
    const proxy = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    proxy.name = 'proxy';
    (proxy.material as THREE.Material).name = 'shadow_only';
    proxy.castShadow = true;
    const multi = new THREE.Mesh(new THREE.BufferGeometry(), [
      new THREE.MeshStandardMaterial({ name: 'a' }),
      new THREE.MeshStandardMaterial({ name: 'b' }),
    ]);
    multi.name = 'multi';
    multi.castShadow = true;
    wrap.add(farRig, proxy, multi);
    const farMaterial = farRig.material;
    const proxyMaterial = proxy.material;
    const multiMaterial = multi.material;

    const pending = renderer.compileShadowPrograms(wrap);

    expect(compiledRoot).toBe(wrap);
    // during the prologue: every mesh wears its depth twin (each material of a
    // multi-material mesh), the non-caster too: never null, never its colour
    // material (which would relink as a fog-less twin the scene never draws)
    expect(seen.sort()).toEqual(['far:depth', 'multi:depth|depth', 'proxy:depth']);
    // and those twins came from the shared factory cache, not a hand-built
    // MeshDepthMaterial in the renderer (the depth-packing regression).
    expect(renderer.prewarmDepthMaterials.size).toBeGreaterThan(0);
    for (const twin of renderer.prewarmDepthMaterials.values()) {
      expect(twin.isMeshDepthMaterial).toBe(true);
      expect(twin.name.startsWith('prewarm-depth:')).toBe(true);
    }
    // The non-caster's twin is the SAME cached instance a caster of the same
    // shape and material inputs gets: a cache hit, not a new variant.
    expect(prewarmDepthMaterialKey(farRig.material as THREE.Material, farRig)).toBe(
      prewarmDepthMaterialKey((multi.material as THREE.Material[])[0], multi),
    );
    // and every material is back on its mesh while the link is still pending
    // (a late restore would draw a visible mesh as depth noise for the link)
    expect(farRig.material).toBe(farMaterial);
    expect(proxy.material).toBe(proxyMaterial);
    expect(multi.material).toBe(multiMaterial);
    resolveLink(wrap);
    await pending;
  });

  it('restores every swap when the walk throws part-way', async () => {
    const renderer = shadowHarness();
    const compileAsync = vi.fn();
    renderer.webgl = { getRenderTarget: () => null, setRenderTarget: () => {}, compileAsync };
    const first = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    first.castShadow = false;
    const second = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    second.castShadow = true;
    // A third mesh the walk reaches only after both swaps are in place, whose
    // material slot explodes: the swaps still have to come back.
    const boom = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    boom.castShadow = true;
    Object.defineProperty(boom, 'material', {
      configurable: true,
      get: () => {
        throw new Error('walk exploded mid-traverse');
      },
    });
    const root = new THREE.Group();
    root.add(first, second, boom);
    const firstMaterial = first.material;
    const secondMaterial = second.material;
    await expect(renderer.compileShadowPrograms(root)).rejects.toThrow(
      'walk exploded mid-traverse',
    );
    expect(first.material).toBe(firstMaterial);
    expect(second.material).toBe(secondMaterial);
    expect(compileAsync).not.toHaveBeenCalled();
  });

  it('compiles the depth twin of a root whose only mesh is a non-caster (the rig beyond the band)', async () => {
    const renderer = shadowHarness();
    const compileAsync = vi.fn(() => Promise.resolve());
    renderer.webgl = { getRenderTarget: () => null, setRenderTarget: () => {}, compileAsync };
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    mesh.castShadow = false;
    const material = mesh.material;
    const root = new THREE.Group();
    root.add(mesh);

    await renderer.compileShadowPrograms(root);

    expect(compileAsync).toHaveBeenCalledTimes(1);
    expect(renderer.prewarmDepthMaterials.size).toBe(1);
    expect(mesh.material).toBe(material);
  });

  it('compiles nothing for a root without meshes, or whose meshes carry no material', async () => {
    const renderer = shadowHarness();
    const compileAsync = vi.fn(() => Promise.resolve());
    renderer.webgl = { getRenderTarget: () => null, setRenderTarget: () => {}, compileAsync };
    const bare = new THREE.Mesh(new THREE.BufferGeometry());
    bare.material = null as unknown as THREE.Material;
    const root = new THREE.Group();
    root.add(new THREE.Group(), bare);

    await renderer.compileShadowPrograms(root);

    expect(compileAsync).not.toHaveBeenCalled();
    expect(renderer.prewarmDepthMaterials.size).toBe(0);
    expect(bare.material).toBeNull();
  });
});

describe('the far-bake compile gate handed to character visuals', () => {
  // A composed body bakes its far LOD on its first far crossing, AFTER the
  // view's creation gate walked the rig, and a skin change rebuilds the far
  // set: both are new programs the view gate never saw. The visual owns the
  // reveal (its far/shadow flags are recomputed per frame), so the renderer
  // hands it gateSwapFlagOnCompile as a callback at every live build.

  it('installs the renderer gate on every visual createCharacterVisualWithRetry builds', () => {
    const renderer = harness();
    const sentinel = () => {};
    renderer.farBakeGate = sentinel;
    renderer.viewCreateRetry = {
      canAttempt: () => true,
      markSucceeded: vi.fn(),
      markFailed: vi.fn(),
    };
    const setFarBakeGate = vi.fn();
    vi.spyOn(characters, 'createCharacterVisual').mockReturnValue({
      setFarBakeGate,
    } as unknown as ReturnType<typeof characters.createCharacterVisual>);
    const entity = { id: 7 } as Parameters<typeof characters.createCharacterVisual>[0];

    const built = (
      renderer as unknown as {
        createCharacterVisualWithRetry(e: unknown, slot: string): unknown;
      }
    ).createCharacterVisualWithRetry(entity, 'view');

    expect(built).not.toBeNull();
    expect(setFarBakeGate).toHaveBeenCalledWith(sentinel);
    // and a failed build installs nothing (there is no visual to install on)
    vi.spyOn(characters, 'createCharacterVisual').mockReturnValue(null);
    setFarBakeGate.mockClear();
    (
      renderer as unknown as {
        createCharacterVisualWithRetry(e: unknown, slot: string): unknown;
      }
    ).createCharacterVisualWithRetry(entity, 'view');
    expect(setFarBakeGate).not.toHaveBeenCalled();
  });

  it('is gateSwapFlagOnCompile, bound once (source pin)', () => {
    // The gate is a class field (an arrow bound to the renderer), which an
    // Object.create harness cannot construct; pin its shape here and rely on
    // the gateSwapFlagOnCompile behaviours above for what it does.
    const rendererSource = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    );
    // ...and one crowd bake links at a time: the gate is enqueued on the
    // renderer's SerialGateLane, the caller's settle riding the lane's.
    expect(rendererSource).toContain(
      'private readonly farBakeGate: FarBakeGate = (target, onSettled) =>\n' +
        '    this.farBakeLane.enqueue((settled) => this.gateSwapFlagOnCompile(target, settled), onSettled);',
    );
    expect(rendererSource).toContain('private readonly farBakeLane = new SerialGateLane();');
    // Both live build paths install it: fresh builds and pool re-acquires.
    expect(rendererSource).toContain('visual.setFarBakeGate(this.farBakeGate);');
    expect(rendererSource).toContain('farBakeGate: () => this.farBakeGate,');
  });
});

describe('Renderer base-visual swap keeps a body on screen', () => {
  // The stand-in invariant (src/render/CLAUDE.md): a race or mech swap builds a
  // COLD rig, so its reveal is gated. Disposing the outgoing rig first left the
  // character completely invisible until that gate settled; it now keeps
  // drawing and is disposed on settle instead.
  interface SwapHarness {
    updateBaseVisual(e: unknown, v: unknown): void;
  }

  function stubVisual(): Record<string, unknown> {
    return {
      root: new THREE.Group(),
      height: 2,
      clickProxy: Object.assign(new THREE.Object3D(), { userData: {} }),
      dispose: vi.fn(),
      setShadow: vi.fn(),
      setFar: vi.fn(),
      setActive: vi.fn(),
    };
  }

  function swapHarness(next: Record<string, unknown>) {
    const renderer = harness() as unknown as SwapHarness & Record<string, unknown>;
    renderer.compileGate = () => Promise.resolve();
    renderer.viewCreateRetry = {
      canAttempt: () => true,
      markSucceeded: () => {},
      markFailed: () => {},
    };
    renderer.createCharacterVisualWithRetry = () => next;
    renderer.reconcileViewLights = () => {};
    renderer.clickTargets = [];
    return renderer;
  }

  function swapView(outgoing: Record<string, unknown>) {
    const group = new THREE.Group();
    group.add(outgoing.root as THREE.Object3D);
    return {
      group,
      visual: outgoing,
      visualKey: 'stale_key',
      clickTarget: new THREE.Object3D(),
      shadowOn: false,
      isFar: false,
      visualCompilePending: false,
      height: 2,
      skin: 0,
      mainhandItemId: null,
      offhandItemId: null,
      weaponSkinId: null,
      weaponStowed: false,
    } as unknown as EntityView;
  }

  const entity = {
    id: 42,
    kind: 'mob',
    templateId: 'wolf',
    skin: 0,
    mainhandItemId: null,
    offhandItemId: null,
  };

  it('keeps the outgoing rig attached and drawing until the new rig links', async () => {
    const outgoing = stubVisual();
    const next = stubVisual();
    const renderer = swapHarness(next);
    const v = swapView(outgoing);

    renderer.updateBaseVisual(entity, v);

    expect(v.visualCompilePending).toBe(true);
    expect(v.visual).toBe(next);
    // the stand-in: still parented, still visible, not disposed
    expect((outgoing.root as THREE.Object3D).parent).toBe(v.group);
    expect((outgoing.root as THREE.Object3D).visible).toBe(true);
    expect(outgoing.dispose).not.toHaveBeenCalled();

    await flushGate();

    expect(v.visualCompilePending).toBe(false);
    expect((outgoing.root as THREE.Object3D).parent).toBeNull();
    expect(outgoing.dispose).toHaveBeenCalledOnce();
  });

  it('refuses a second swap while one is in flight, so exactly one rig stands in', () => {
    const outgoing = stubVisual();
    const next = stubVisual();
    const renderer = swapHarness(next);
    const v = swapView(outgoing);
    v.visualCompilePending = true;

    renderer.updateBaseVisual(entity, v);

    expect(v.visual).toBe(outgoing); // untouched: the key diff retries next frame
    expect(outgoing.dispose).not.toHaveBeenCalled();
  });

  it('still disposes the stand-in when the gate is rejected', async () => {
    const outgoing = stubVisual();
    const next = stubVisual();
    const renderer = swapHarness(next);
    renderer.compileGate = () => Promise.reject(new Error('base swap link rejected'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const v = swapView(outgoing);

    renderer.updateBaseVisual(entity, v);
    await flushGate();

    expect(v.visualCompilePending).toBe(false);
    expect((outgoing.root as THREE.Object3D).parent).toBeNull();
    expect(outgoing.dispose).toHaveBeenCalledOnce();
  });
});
