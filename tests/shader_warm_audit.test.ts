// The shader warm audit's host (src/render/shader_warm_audit.ts): off without
// the perf flags, announcing through the dry compile, observing every mint
// after the reveal by reading the shader sources back, and riding the
// live-program watch's own readouts.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CompileArmHost,
  linkColorPrograms,
  linkShadowPrograms,
  setCompileArmObserver,
} from '../src/render/compile_arms';
import {
  absorbLivePrograms,
  armLiveProgramWatch,
  recordNewLivePrograms,
  resetLiveProgramWatchForTest,
} from '../src/render/live_program_watch';
import { THREE_PROGRAM_KEY_PARAMETERS } from '../src/render/program_key_ledger_core';
import type { DryProgramSource } from '../src/render/program_sources';
import {
  armShaderWarmAudit,
  disposeShaderWarmAudit,
  expectRootProgramSources,
  type MintedProgramEntry,
  resetShaderWarmAuditForTest,
  SHADER_WARM_AUDIT_SWEEP_QUOTA,
  shaderWarmAuditEnabled,
  shaderWarmAuditSnapshot,
  sweepShaderWarmAudit,
} from '../src/render/shader_warm_audit';

afterEach(() => {
  resetShaderWarmAuditForTest();
  resetLiveProgramWatchForTest();
  // The arm observer slot is module-owned; the audit installs into it.
  setCompileArmObserver(null);
});

interface ArmRig {
  host: CompileArmHost;
  /** The renderer's currently bound target, so a case can prove the audit
   *  left it where it found it. */
  target: () => THREE.WebGLRenderTarget | null;
  liveTarget: THREE.WebGLRenderTarget;
  /** Dry-compile calls the rig served, so "did no work" is checkable. */
  collectCalls: () => number;
  /** The state moving between an announcement and its link. */
  setSources: (next: DryProgramSource[]) => void;
  throwOnCollect: (on: boolean) => void;
}

function armRig(sources: DryProgramSource[], options: { shadowArm?: boolean } = {}): ArmRig {
  const liveTarget = { name: 'live' } as unknown as THREE.WebGLRenderTarget;
  let current: THREE.WebGLRenderTarget | null = liveTarget;
  let served = sources;
  let calls = 0;
  let throwing = false;
  const scene = new THREE.Scene();
  const webgl = {
    getRenderTarget: () => current,
    setRenderTarget: (target: THREE.WebGLRenderTarget | null) => {
      current = target;
    },
    compileAsync: () => Promise.resolve(scene),
    collectProgramSources: (): DryProgramSource[] => {
      calls++;
      if (throwing) throw new Error('dry compile blew up');
      return served;
    },
  };
  return {
    target: () => current,
    liveTarget,
    collectCalls: () => calls,
    setSources: (next) => {
      served = next;
    },
    throwOnCollect: (on) => {
      throwing = on;
    },
    host: {
      webgl: () => webgl,
      camera: () => new THREE.PerspectiveCamera(),
      scene: () => scene,
      shadowCamera: () => new THREE.OrthographicCamera(),
      offscreen: () => false,
      offscreenTarget: () => ({ name: 'offscreen' }) as unknown as THREE.WebGLRenderTarget,
      depthMaterials: () => new Map(),
      // One arm is enough for most cases: the dry compile stub answers the
      // same either way. The shadow arm is opted into where it is the subject.
      shadowArm: () => options.shadowArm ?? false,
    },
  };
}

function armHost(sources: DryProgramSource[]): CompileArmHost {
  return armRig(sources).host;
}

function dry(cacheKey: string, vertex: string, fragment: string): DryProgramSource {
  return {
    cacheKey,
    name: 'physical',
    vertexGlsl: vertex,
    fragmentGlsl: fragment,
    index0Attribute: 'position',
  };
}

/** A minted program whose shader objects carry their source, and a context
 *  that reads it back the way getShaderSource does. */
function minted(
  id: number,
  cacheKey: string,
  vertex: string,
  fragment: string,
): MintedProgramEntry {
  return {
    id,
    cacheKey,
    name: 'physical',
    vertexShader: { source: vertex },
    fragmentShader: { source: fragment },
  };
}

function glHost(programs: MintedProgramEntry[]) {
  return {
    info: { programs, memory: { textures: 0 } },
    getContext: () => ({
      getShaderSource: (shader: unknown) => (shader as { source: string }).source,
    }),
  };
}

function root(name = 'kit'): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()));
  return group;
}

describe('shader warm audit flag', () => {
  it('is off without the perf flags and on with either', () => {
    resetShaderWarmAuditForTest('');
    expect(shaderWarmAuditEnabled()).toBe(false);
    expect(expectRootProgramSources(armHost([dry('k', 'v', 'f')]), root())).toBe(0);
    expect(sweepShaderWarmAudit(glHost([minted(1, 'k', 'v', 'f')]))).toBe(0);
    expect(shaderWarmAuditSnapshot()).toMatchObject({ enabled: false, expected: 0 });
    resetShaderWarmAuditForTest('?perf');
    expect(shaderWarmAuditEnabled()).toBe(true);
    resetShaderWarmAuditForTest('?perfTrace=1');
    expect(shaderWarmAuditEnabled()).toBe(true);
    // The trace flag is read for its VALUE, not merely its presence: a page
    // that spells the switch off must not pay the audit.
    resetShaderWarmAuditForTest('?perfTrace=0');
    expect(shaderWarmAuditEnabled()).toBe(false);
  });

  it('runs no dry compile and touches no renderer state with the flags off', () => {
    resetShaderWarmAuditForTest('');
    // The shadow arm is on here: with the flags ON this root would be walked,
    // swapped onto depth twins and bound against the offscreen target.
    const rig = armRig([dry('k', 'v', 'f')], { shadowArm: true });
    const group = root();
    const mesh = group.children[0] as THREE.Mesh;
    const material = mesh.material;
    expect(expectRootProgramSources(rig.host, group)).toBe(0);
    expect(sweepShaderWarmAudit(glHost([minted(1, 'k', 'v', 'f')]))).toBe(0);
    expect(rig.collectCalls()).toBe(0);
    expect(rig.target()).toBe(rig.liveTarget);
    expect(mesh.material).toBe(material);
    expect(shaderWarmAuditSnapshot()).toMatchObject({
      enabled: false,
      expected: 0,
      backlog: 0,
      failures: 0,
      selfCostMs: { announceMs: 0, recheckMs: 0, sweepMs: 0 },
    });
  });
});

describe('expectRootProgramSources', () => {
  it('announces the offscreen colour variant too when the lane would link it', () => {
    // A bypassed zone prewarm links both colour targets; announcing one of
    // them would leave the other counted as unexpected in the off arm only.
    const rig = armRig([dry('k', 'v', 'f')]);
    resetShaderWarmAuditForTest('?perf');
    expectRootProgramSources(rig.host, root(), 1, true);
    expect(rig.collectCalls()).toBe(2);
    expectRootProgramSources(rig.host, root(), 2);
    expect(rig.collectCalls()).toBe(3);
  });

  it('announces every dry source under the root name, once per key', () => {
    resetShaderWarmAuditForTest('?perf');
    const host = armHost([dry('a', 'va', 'fa'), dry('b', 'vb', 'fb')]);
    expect(expectRootProgramSources(host, root('cull:2'), 5)).toBe(2);
    expect(expectRootProgramSources(host, root('cull:3'), 6)).toBe(0);
    expect(shaderWarmAuditSnapshot()).toMatchObject({ dryCompile: true, expected: 2, pending: 2 });
  });

  it('reports no dry compile when the renderer lacks the patch', () => {
    resetShaderWarmAuditForTest('?perf');
    const host = armHost([]);
    (host.webgl() as { collectProgramSources?: unknown }).collectProgramSources = undefined;
    expect(expectRootProgramSources(host, root())).toBe(0);
    expect(shaderWarmAuditSnapshot().dryCompile).toBe(false);
  });

  it('labels a root nothing names by its type, array materials included', () => {
    // The attribution ladder: the root's name, then the material names it
    // wears, then its bare type. Both fallbacks matter, because an unlabelled
    // announcement is a pending key nobody can trace back to a producer.
    resetShaderWarmAuditForTest('?perf');
    expectRootProgramSources(armHost([dry('bare', 'v', 'f')]), new THREE.Object3D());
    expect(shaderWarmAuditSnapshot().pendingSamples[0]?.label).toBe('Object3D');

    resetShaderWarmAuditForTest('?perf');
    const unnamed = new THREE.Mesh(new THREE.BufferGeometry(), [
      new THREE.MeshStandardMaterial(),
      new THREE.MeshBasicMaterial(),
    ]);
    expectRootProgramSources(armHost([dry('array', 'v', 'f')]), unnamed);
    expect(shaderWarmAuditSnapshot().pendingSamples[0]?.label).toBe('Mesh');

    resetShaderWarmAuditForTest('?perf');
    const named = new THREE.Mesh(new THREE.BufferGeometry(), [
      new THREE.MeshStandardMaterial({ name: 'village:Walls' }),
      new THREE.MeshBasicMaterial({ name: 'village:Glass' }),
    ]);
    expectRootProgramSources(armHost([dry('named', 'v', 'f')]), named);
    expect(shaderWarmAuditSnapshot().pendingSamples[0]?.label).toBe(
      'Mesh(village:Walls|village:Glass)',
    );
  });

  it('counts a throwing dry compile as a failure and never lets it reach the gate', async () => {
    resetShaderWarmAuditForTest('?perf');
    const rig = armRig([dry('k1', 'v', 'f')]);
    const announced = root('cull:2');
    expectRootProgramSources(rig.host, announced);
    expect(shaderWarmAuditSnapshot().failures).toBe(0);

    rig.throwOnCollect(true);
    expect(() => expectRootProgramSources(rig.host, root('cull:3'))).not.toThrow();
    expect(expectRootProgramSources(rig.host, root('cull:4'))).toBe(0);
    expect(shaderWarmAuditSnapshot().failures).toBe(2);

    // The re-check half is fail-soft the same way: the LINK must still
    // resolve, or an audit under the perf flags would break the gate it is
    // only supposed to watch.
    await expect(linkColorPrograms(rig.host, announced, false)).resolves.toBeUndefined();
    expect(shaderWarmAuditSnapshot()).toMatchObject({ failures: 3, keysMovedAtLink: 0 });
  });

  it('accumulates what each half of the audit itself cost', async () => {
    resetShaderWarmAuditForTest('?perf');
    expect(shaderWarmAuditSnapshot().selfCostMs).toEqual({
      announceMs: 0,
      recheckMs: 0,
      sweepMs: 0,
    });
    // Enough real hashing that the accumulated cost is above the clock's
    // resolution, whichever half is measured.
    const glsl = 'void main() { gl_Position = vec4( 0.0 ); }\n'.repeat(400);
    const sources = Array.from({ length: 24 }, (_, i) => dry(`k${i}`, `${glsl}// ${i}`, glsl));
    const rig = armRig(sources);
    const announced = root('cull:2');
    expectRootProgramSources(rig.host, announced);
    for (let i = 0; i < 8; i++) expectRootProgramSources(rig.host, root(`cull:${i}`));
    const afterAnnounce = shaderWarmAuditSnapshot().selfCostMs;
    expect(afterAnnounce.announceMs).toBeGreaterThan(0);
    expect(afterAnnounce.recheckMs).toBe(0);
    expect(afterAnnounce.sweepMs).toBe(0);

    await linkColorPrograms(rig.host, announced, false);
    const afterRecheck = shaderWarmAuditSnapshot().selfCostMs;
    expect(afterRecheck.recheckMs).toBeGreaterThan(0);
    expect(afterRecheck.announceMs).toBe(afterAnnounce.announceMs);

    const programs = sources.map((entry, i) =>
      minted(i + 1, entry.cacheKey, entry.vertexGlsl, entry.fragmentGlsl),
    );
    armShaderWarmAudit(glHost(programs));
    const afterSweep = shaderWarmAuditSnapshot().selfCostMs;
    expect(afterSweep.sweepMs).toBeGreaterThan(0);
    expect(afterSweep.announceMs).toBe(afterAnnounce.announceMs);
    expect(afterSweep.recheckMs).toBe(afterRecheck.recheckMs);
    for (const cost of Object.values(afterSweep)) {
      expect(typeof cost).toBe('number');
      expect(cost).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('sweepShaderWarmAudit', () => {
  it('classes a boot mint apart, and everything after the arm as live', () => {
    resetShaderWarmAuditForTest('?perf');
    expectRootProgramSources(
      armHost([dry('hit', 'v', 'f'), dry('drift', 'v', 'f'), dry('early', 'v', 'f')]),
      root(),
    );
    const programs = [minted(1, 'boot', 'v', 'f'), minted(2, 'early', 'v', 'f')];
    const host = glHost(programs);
    // Before the arm: the boot lane's mint is counted apart, and an entry
    // gate's announcement still settles (it is not pending forever).
    expect(sweepShaderWarmAudit(host)).toBe(2);
    expect(shaderWarmAuditSnapshot()).toMatchObject({
      armed: false,
      matched: 0,
      unexpected: 0,
      matchedBeforeReveal: 1,
      unexpectedBeforeReveal: 1,
      pending: 2,
    });
    armShaderWarmAudit(host);
    programs.push(
      minted(3, 'hit', 'v', 'f'),
      minted(4, 'drift', 'v', 'f-other'),
      minted(5, 'nobody', 'v', 'f'),
    );
    expect(sweepShaderWarmAudit(host)).toBe(3);
    // The same list again: every id is at or below the mark, nothing new.
    expect(sweepShaderWarmAudit(host)).toBe(0);
    expect(shaderWarmAuditSnapshot()).toMatchObject({
      armed: true,
      expected: 3,
      pending: 1,
      matched: 1,
      drifted: 1,
      unexpected: 1,
      unexpectedByName: [{ name: 'physical', count: 1 }],
    });
    expect(shaderWarmAuditSnapshot().drifts[0]).toMatchObject({ cacheKey: 'drift', label: 'kit' });
  });

  it('attributes an unnamed hooked mint from the program alone, name and gate empty', () => {
    // three names a WebGLProgram after `material.name` only, so a procedural
    // pass that never set one arrives with an empty name, and an unexpected
    // mint has no announcing gate either: the readout would otherwise carry a
    // raw key and nothing else (the Windows D3D11 report). The host hands the
    // fragment it already read back to the core, which reads the type, the
    // onBeforeCompile the key carries, the colour space the link ran under,
    // and the pass's own uniforms.
    resetShaderWarmAuditForTest('?perf');
    const hook = 'function (shader) { shader.uniforms.uHaze = h; }';
    const params = THREE_PROGRAM_KEY_PARAMETERS.map((name) => {
      if (name === 'precision') return 'highp';
      if (name === 'outputColorSpace') return 'srgb-linear';
      return name.endsWith('Uv') ? '' : '0';
    });
    const cacheKey = ['861151317', '2113470571', ...params, 0, 0, 'srgb', hook].join(',');
    const fragment = 'uniform vec3 cameraPosition;\nuniform sampler2D tDiffuse;\nvoid main() {}';
    const program: MintedProgramEntry = {
      id: 1,
      cacheKey,
      name: '',
      vertexShader: { source: 'v' },
      fragmentShader: { source: fragment },
    };
    const host = glHost([program]);
    armShaderWarmAudit(host);
    sweepShaderWarmAudit(host);
    const snapshot = shaderWarmAuditSnapshot();
    expect(snapshot.unexpectedBeforeReveal).toBe(1);
    // Armed, the same program read live is the entry the tester sees.
    resetShaderWarmAuditForTest('?perf');
    const live = glHost([]);
    armShaderWarmAudit(live);
    (live.info.programs as MintedProgramEntry[]).push(program);
    sweepShaderWarmAudit(live);
    const sample = shaderWarmAuditSnapshot().unexpectedSamples[0];
    expect(sample).toMatchObject({ name: '', label: '', cacheKey });
    expect(sample.attribution).toMatchObject({
      type: 'ShaderMaterial',
      hooked: true,
      outputColorSpace: 'srgb-linear',
      rendererOutputColorSpace: 'srgb',
      uniforms: ['tDiffuse'],
    });
    expect(sample.attribution?.customKeyHead).toBe(hook);
    // And the tally row names it instead of collapsing on the empty name.
    expect(shaderWarmAuditSnapshot().unexpectedByName[0].name).toContain('uHaze');
  });

  it('sees a mint that landed beside an eviction, when the list length did not move', () => {
    resetShaderWarmAuditForTest('?perf');
    const programs = [minted(1, 'a', 'v', 'f'), minted(2, 'b', 'v', 'f')];
    const host = glHost(programs);
    armShaderWarmAudit(host);
    // three's destroyProgram swaps the last entry into the freed slot: the
    // new program (id 3) takes the evicted one's place, same length.
    programs[0] = minted(3, 'c', 'v', 'f');
    expect(sweepShaderWarmAudit(host)).toBe(1);
    expect(shaderWarmAuditSnapshot().unexpected).toBe(1);
  });

  it('names a bare mesh root by what it wears', () => {
    resetShaderWarmAuditForTest('?perf');
    const bare = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ name: 'village:Windows' }),
    );
    expectRootProgramSources(armHost([dry('k', 'v', 'f')]), bare);
    expect(shaderWarmAuditSnapshot().pendingSamples[0]?.label).toBe('Mesh(village:Windows)');
  });

  it('only advances the mark when the host has no context to read sources from', () => {
    resetShaderWarmAuditForTest('?perf');
    const programs = [minted(1, 'k', 'v', 'f')];
    const host = { info: { programs } };
    armShaderWarmAudit(host);
    programs.push(minted(2, 'k2', 'v', 'f'));
    expect(sweepShaderWarmAudit(host)).toBe(0);
    expect(shaderWarmAuditSnapshot().unexpected).toBe(0);
    // Advancing the mark is what keeps the parked mints from being parked a
    // SECOND time: both are waiting, once each, for a host that can read them
    // back. A sweep through such a host classes exactly those two, and the
    // sweep after it observes nothing left.
    expect(shaderWarmAuditSnapshot().backlog).toBe(2);
    const readable = glHost(programs);
    expect(sweepShaderWarmAudit(readable)).toBe(2);
    expect(sweepShaderWarmAudit(readable)).toBe(0);
    expect(shaderWarmAuditSnapshot()).toMatchObject({ unexpected: 2, backlog: 0 });
  });

  it('spreads a burst over sweeps at the quota, oldest first, and drains the backlog', () => {
    resetShaderWarmAuditForTest('?perf');
    const programs: MintedProgramEntry[] = [];
    const host = glHost(programs);
    armShaderWarmAudit(host);
    const burst = 12;
    // Matchability floor: a quota at or above the burst would class the whole
    // burst in one sweep and make the split below vacuous.
    expect(SHADER_WARM_AUDIT_SWEEP_QUOTA).toBeLessThan(burst);
    for (let i = 0; i < burst; i++) programs.push(minted(i + 1, `k${i}`, 'v', 'f'));

    expect(sweepShaderWarmAudit(host)).toBe(SHADER_WARM_AUDIT_SWEEP_QUOTA);
    expect(shaderWarmAuditSnapshot()).toMatchObject({
      unexpected: SHADER_WARM_AUDIT_SWEEP_QUOTA,
      backlog: burst - SHADER_WARM_AUDIT_SWEEP_QUOTA,
    });
    // Oldest first: the quota is a delay, never a filter, so the mints it
    // classed are the ones the driver minted first.
    expect(shaderWarmAuditSnapshot().unexpectedSamples.map((sample) => sample.cacheKey)).toEqual(
      Array.from({ length: SHADER_WARM_AUDIT_SWEEP_QUOTA }, (_, i) => `k${i}`),
    );

    expect(sweepShaderWarmAudit(host)).toBe(burst - SHADER_WARM_AUDIT_SWEEP_QUOTA);
    expect(shaderWarmAuditSnapshot()).toMatchObject({ unexpected: burst, backlog: 0 });
    expect(sweepShaderWarmAudit(host)).toBe(0);
  });

  it('classes everything parked at the reveal, whatever the quota', () => {
    resetShaderWarmAuditForTest('?perf');
    const programs: MintedProgramEntry[] = [];
    for (let i = 0; i < 12; i++) programs.push(minted(i + 1, `k${i}`, 'v', 'f'));
    // The reveal is the one sweep with no quota: nothing may be left waiting
    // on the far side of the curtain, where the phase counts would move.
    armShaderWarmAudit(glHost(programs));
    expect(shaderWarmAuditSnapshot()).toMatchObject({
      armed: true,
      backlog: 0,
      backlogDropped: 0,
      unexpectedBeforeReveal: 12,
      unexpected: 0,
    });
  });

  it('bounds the backlog and counts what it had to drop', () => {
    resetShaderWarmAuditForTest('?perf');
    const programs: MintedProgramEntry[] = [];
    for (let i = 0; i < 600; i++) programs.push(minted(i + 1, `k${i}`, 'v', 'f'));
    // No context to read sources back, so nothing drains and the bound is
    // the only thing standing between a churning session and an unbounded
    // list of program entries held alive by the audit.
    expect(sweepShaderWarmAudit({ info: { programs } })).toBe(0);
    expect(shaderWarmAuditSnapshot()).toMatchObject({ backlog: 512, backlogDropped: 88 });
  });

  it('rides the live-program watch: armed at the reveal, swept around every draw', () => {
    resetShaderWarmAuditForTest('?perf');
    expectRootProgramSources(armHost([dry('hit', 'v', 'f')]), root());
    const programs = [minted(1, 'boot', 'v', 'f')];
    const host = glHost(programs);
    armLiveProgramWatch(host);
    programs.push(minted(2, 'hit', 'v', 'f'));
    absorbLivePrograms(host);
    programs.push(minted(3, 'escape', 'v', 'f'));
    recordNewLivePrograms(host);
    expect(shaderWarmAuditSnapshot()).toMatchObject({ matched: 1, unexpected: 1, pending: 0 });
  });
});

describe('the link-time re-check', () => {
  it('names the announced roots that linked, and counts the keys that moved since the announcement', async () => {
    resetShaderWarmAuditForTest('?perf');
    const { linkColorPrograms } = await import('../src/render/compile_arms');
    let sources = [dry('k1', 'v', 'f')];
    const scene = new THREE.Scene();
    const webgl = {
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      compileAsync: () => Promise.resolve(scene),
      collectProgramSources: () => sources,
    };
    const host: CompileArmHost = { ...armHost([]), webgl: () => webgl, scene: () => scene };
    const announced = root('cull:2');
    const stranger = root('never-announced');
    expectRootProgramSources(host, announced);
    // The state moved: at link time the same root yields another key.
    sources = [dry('k1-moved', 'v', 'f')];
    await linkColorPrograms(host, announced, false);
    await linkColorPrograms(host, stranger, false);
    expect(shaderWarmAuditSnapshot()).toMatchObject({
      linkedLabels: ['cull:2'],
      keysMovedAtLink: 1,
      movedSamples: [{ name: 'physical', label: 'cull:2', cacheKey: 'k1-moved' }],
    });
    // A link whose keys were all announced moves nothing.
    sources = [dry('k1', 'v', 'f')];
    await linkColorPrograms(host, announced, false);
    expect(shaderWarmAuditSnapshot().keysMovedAtLink).toBe(1);
  });

  it('counts nothing on a shadow link: the twins ride the colour arm dry pass', async () => {
    resetShaderWarmAuditForTest('?perf');
    const rig = armRig([dry('k1', 'v', 'f')], { shadowArm: true });
    const announced = root('cull:2');
    expectRootProgramSources(rig.host, announced);
    rig.setSources([dry('k1-moved', 'v', 'f')]);
    // The shadow arm links real programs, and its own dry pass is already
    // inside the colour re-check: re-checking it again would double every
    // moved key and name the root twice.
    await linkShadowPrograms(rig.host, announced);
    expect(shaderWarmAuditSnapshot()).toMatchObject({ linkedLabels: [], keysMovedAtLink: 0 });
    // The colour arm on the SAME root does count it, so the negative above is
    // about the arm and not about an inert rig.
    await linkColorPrograms(rig.host, announced, false);
    expect(shaderWarmAuditSnapshot()).toMatchObject({
      linkedLabels: ['cull:2'],
      keysMovedAtLink: 1,
    });
  });

  it('re-checks through the arms of the LATEST announcement', async () => {
    // A graphics change rebuilds the renderer, so the arms the re-check runs
    // against must be the ones the newest gate announced through, never the
    // dead renderer's.
    resetShaderWarmAuditForTest('?perf');
    const first = armRig([dry('k1', 'v', 'f')]);
    const second = armRig([dry('k2', 'v', 'f')]);
    const announced = root('cull:2');
    expectRootProgramSources(first.host, announced);
    expectRootProgramSources(second.host, announced);
    first.setSources([dry('first-moved', 'v', 'f')]);
    second.setSources([dry('second-moved', 'v', 'f')]);
    await linkColorPrograms(first.host, announced, false);
    expect(shaderWarmAuditSnapshot().movedSamples).toEqual([
      { name: 'physical', label: 'cull:2', cacheKey: 'second-moved' },
    ]);
  });

  it('stops listening on dispose, and binds again on the next announcement', async () => {
    resetShaderWarmAuditForTest('?perf');
    const rig = armRig([dry('k1', 'v', 'f')]);
    const first = root('cull:2');
    const second = root('cull:3');
    expectRootProgramSources(rig.host, first);
    expectRootProgramSources(rig.host, second);
    rig.setSources([dry('k1-moved', 'v', 'f')]);
    await linkColorPrograms(rig.host, first, false);
    expect(shaderWarmAuditSnapshot()).toMatchObject({
      linkedLabels: ['cull:2'],
      keysMovedAtLink: 1,
    });

    disposeShaderWarmAudit();
    rig.setSources([dry('k2-moved', 'v', 'f')]);
    await linkColorPrograms(rig.host, second, false);
    // The counts survive for the readout; only the listening stops.
    expect(shaderWarmAuditSnapshot()).toMatchObject({
      linkedLabels: ['cull:2'],
      keysMovedAtLink: 1,
    });

    // A later announcement re-arms the observer and re-registers its root.
    rig.setSources([dry('k1', 'v', 'f')]);
    expectRootProgramSources(rig.host, second);
    rig.setSources([dry('k3-moved', 'v', 'f')]);
    await linkColorPrograms(rig.host, second, false);
    expect(shaderWarmAuditSnapshot()).toMatchObject({
      linkedLabels: ['cull:2', 'cull:3'],
      keysMovedAtLink: 2,
    });
  });
});

describe('the SHADER_NAME line', () => {
  it('is what a name-only drift differs by, and stripShaderName removes it', async () => {
    const { stripShaderName } = await import('../src/render/shader_warm_audit');
    expect(stripShaderName('#define SHADER_NAME coach:beam\nvoid main() {}')).toBe(
      '\nvoid main() {}',
    );
    resetShaderWarmAuditForTest('?perf');
    expectRootProgramSources(
      armHost([dry('k', '#define SHADER_NAME coach:beam\nv', 'f')]),
      root('Mesh'),
    );
    const host = glHost([minted(1, 'k', '#define SHADER_NAME coach:ring\nv', 'f')]);
    armShaderWarmAudit(host);
    // Minted before the arm here, which still classes the drift.
    expect(shaderWarmAuditSnapshot()).toMatchObject({ drifted: 1, driftedNameOnly: 1 });
    expect(shaderWarmAuditSnapshot().drifts[0]?.nameOnly).toBe(true);
  });
});
