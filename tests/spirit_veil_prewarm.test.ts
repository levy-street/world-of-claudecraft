// The boot entry that links the spirit veil's family before the curtain
// (src/render/spirit_veil_prewarm.ts): one resident stand-in per pinned tuple
// wearing the live factory's own material, the ledger it fills, its place in
// the manifest, what a deadline and a phone do with it, and the late link of a
// tuple outside the family.

import { readFileSync } from 'node:fs';
import type * as THREE from 'three';
import { MeshBasicMaterial } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundGpuQueue, GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import {
  createSpiritVeilMaterial,
  installSpiritVeil,
  noteSpiritVeilMiss,
  resetSpiritVeilLedger,
  setSpiritVeilLateLink,
  spiritVeilDepthMaterial,
  spiritVeilKeysFor,
  spiritVeilLedgerOwnedBy,
  spiritVeilLedgerSize,
  spiritVeilPassOf,
  spiritVeilShapeKey,
  spiritVeilTuplesLinked,
} from '../src/render/characters/ghost_veil';
import {
  createSpiritVeilSortUnit,
  SPIRIT_VEIL_FAMILY,
  SPIRIT_VEIL_FAMILY_KEYS,
  SPIRIT_VEIL_PASS_KEY,
  SPIRIT_VEIL_UNIT_KEY,
  spiritVeilKeyOfTuple,
} from '../src/render/characters/spirit_veil_family_core';
import type { CompileArmHost } from '../src/render/compile_arms';
import { sharedUniforms } from '../src/render/gfx';
import { gpuPrepKindOfLabel } from '../src/render/gpu_prep_budget_core';
import { isProgramKnownReady } from '../src/render/linked_program_readiness';
import { LINKED_PROGRAM_TOUCH_LABEL } from '../src/render/linked_program_touch_lane';
import {
  BLOCKING_PREWARM_ENTRIES_WITHOUT_PARALLEL_COMPILE,
  CONSTRAINED_PREWARM_KEEP,
  orderPrewarmResumeEntries,
  type PrewarmPolicyInput,
  prewarmEntryRuns,
  prewarmEntryShouldDefer,
  prewarmResumeIsDebt,
  resolvePrewarmPolicy,
} from '../src/render/prewarm_policy';
import { runResumeUnit } from '../src/render/prewarm_resume_runner';
import {
  buildSpiritVeilStandIn,
  SPIRIT_VEIL_PREWARM_ENTRY_ID,
  spiritVeilFamilyPrewarmEntry,
} from '../src/render/spirit_veil_prewarm';
import { stripComments } from './helpers/strip_comments';

const BASE: PrewarmPolicyInput = {
  constrainedMemory: false,
  asyncCompileSupported: true,
  lowGfx: false,
  finishFullManifestBeforeReveal: false,
  defaultMaxMs: 3000,
  constrainedMaxMs: 3000,
  defaultCompileMaxMs: 1500,
  constrainedCompileMaxMs: 1500,
  maxViewsLow: 12,
  maxViewsHigh: 16,
  maxViewsConstrained: 2,
};

function host() {
  const linked: THREE.Object3D[] = [];
  const properties = {
    get: (_material: THREE.Material) => ({ currentProgram: { id: linked.length } }),
  };
  const queued: { priority?: number; label?: string; releaseTail?: boolean }[] = [];
  const queue = {
    run<T>(
      work: () => T | Promise<T>,
      priority?: number,
      label?: string,
      options?: { releaseTail?: boolean },
    ): Promise<T> {
      queued.push({ priority, label, releaseTail: options?.releaseTail });
      return Promise.resolve().then(work);
    },
  };
  const link = vi.fn((root: THREE.Object3D) => {
    linked.push(root);
    return Promise.resolve();
  });
  return { linked, properties, queue, queued, link, arms: {} as CompileArmHost };
}

beforeEach(() => resetSpiritVeilLedger());
afterEach(() => {
  setSpiritVeilLateLink(null);
  vi.restoreAllMocks();
});

describe('the family stand-ins', () => {
  it('carries each tuple on the live factory output, so the linked key cannot drift', () => {
    for (const tuple of SPIRIT_VEIL_FAMILY) {
      const key = spiritVeilKeyOfTuple(tuple);
      const mesh = buildSpiritVeilStandIn(tuple);
      const material = mesh.material as THREE.Material;
      expect(mesh.visible).toBe(false);
      expect((mesh as THREE.SkinnedMesh).isSkinnedMesh === true, key).toBe(tuple.skinned);
      expect(mesh.geometry.morphAttributes.position?.length ?? 0, key).toBe(tuple.morphTargets);
      expect(mesh.geometry.getAttribute('normal'), key).toBeDefined();
      expect(spiritVeilPassOf(material), key).toBe(tuple.pass);
      if (tuple.pass === 'depth') {
        // the very material every live sibling of that shape wears
        expect(material).toBe(spiritVeilDepthMaterial(spiritVeilShapeKey(mesh)));
        expect(spiritVeilShapeKey(mesh)).toBe(key);
      } else {
        expect(spiritVeilKeysFor(material, mesh)?.[0], key).toBe(key);
      }
    }
  });
});

describe('the entities.spirit-veil-family entry', () => {
  it('links every tuple in its own run and fills the ledger for this renderer', async () => {
    const h = host();
    const entry = spiritVeilFamilyPrewarmEntry(h.arms, h, h.queue, h.link);
    const all = [...SPIRIT_VEIL_FAMILY_KEYS];
    expect(spiritVeilTuplesLinked(all)).toBe(false);
    await entry.run();
    expect(h.link).toHaveBeenCalledTimes(SPIRIT_VEIL_FAMILY.length);
    expect(new Set(h.linked).size).toBe(SPIRIT_VEIL_FAMILY.length);
    expect(spiritVeilTuplesLinked(all)).toBe(true);
    // the stand-ins are resident: a second run links the same objects again
    const first = new Set(h.linked);
    await entry.run();
    for (const root of h.linked) expect(first.has(root)).toBe(true);
    // a new renderer (a different program cache) starts empty, and a settle
    // still arriving from the retired one records nothing
    const next = host();
    spiritVeilFamilyPrewarmEntry(next.arms, next, next.queue, next.link);
    expect(spiritVeilTuplesLinked(all)).toBe(false);
    await entry.run();
    expect(spiritVeilTuplesLinked(all)).toBe(false);
  });

  it("touches each stand-in's linked program after its link, one tail unit each, run and resume alike", async () => {
    const h = host();
    const order: string[] = [];
    const programs = new Map<THREE.Material, { getUniforms(): void; getAttributes(): void }>();
    const programOf = (material: THREE.Material) => {
      let program = programs.get(material);
      if (!program) {
        program = {
          getUniforms: vi.fn(() => order.push(`touch:${material.uuid}`)),
          getAttributes: vi.fn(),
        };
        programs.set(material, program);
      }
      return program;
    };
    h.properties.get = ((material: THREE.Material) => {
      const program = programOf(material);
      return { currentProgram: program, programs: new Map([['k', program]]) };
    }) as never;
    h.link.mockImplementation((root: THREE.Object3D) => {
      order.push(`link:${((root as THREE.Mesh).material as THREE.Material).uuid}`);
      return Promise.resolve();
    });
    const entry = spiritVeilFamilyPrewarmEntry(h.arms, h, h.queue, h.link);
    await entry.run();
    expect(programs.size).toBe(SPIRIT_VEIL_FAMILY.length);
    for (const program of programs.values()) {
      expect(program.getUniforms).toHaveBeenCalledTimes(1);
      expect(program.getAttributes).toHaveBeenCalledTimes(1);
    }
    // every touch follows its own link
    for (const [material] of programs) {
      const link = order.indexOf(`link:${material.uuid}`);
      expect(link).toBeGreaterThan(-1);
      expect(order.indexOf(`touch:${material.uuid}`)).toBeGreaterThan(link);
    }
    const touches = h.queued.filter((q) => q.label === LINKED_PROGRAM_TOUCH_LABEL);
    expect(touches).toHaveLength(SPIRIT_VEIL_FAMILY.length);
    for (const q of touches) expect(q.priority).toBe(GPU_WORK_PRIORITY.TAIL_PIECE);
    // a drop's resume units carry the same tail
    for (const program of programs.values()) {
      vi.mocked(program.getUniforms).mockClear();
      vi.mocked(program.getAttributes).mockClear();
    }
    h.queued.length = 0;
    for (const unit of entry.resumeProgramUnits?.() ?? []) await unit.run();
    for (const program of programs.values()) {
      expect(program.getUniforms).toHaveBeenCalledTimes(1);
      expect(program.getAttributes).toHaveBeenCalledTimes(1);
    }
    const resumed = h.queued.filter((q) => q.label === LINKED_PROGRAM_TOUCH_LABEL);
    expect(resumed).toHaveLength(SPIRIT_VEIL_FAMILY.length);
    for (const q of resumed) expect(q.priority).toBe(GPU_WORK_PRIORITY.TAIL_PIECE);
  });

  it('resumes a dropped entry through the real queue and resume runner without holding it', async () => {
    // The resume lane runs a debt unit holding the queue until it settles, so
    // a unit that awaited its own touch on that queue would never settle and
    // would starve every later unit (gates, reveals, uploads) for the session.
    const queue = createBackgroundGpuQueue();
    const touched: string[] = [];
    const state = new Map<THREE.Material, unknown>();
    const properties = {
      get: (material: THREE.Material) => {
        let entry = state.get(material);
        if (!entry) {
          const program = {
            getUniforms: () => touched.push(material.uuid),
            getAttributes: () => undefined,
          };
          entry = { currentProgram: program, programs: new Map([['k', program]]) };
          state.set(material, entry);
        }
        return entry;
      },
    };
    const link = vi.fn(() => Promise.resolve());
    const entry = spiritVeilFamilyPrewarmEntry({} as CompileArmHost, { properties }, queue, link);
    const id = `programs.${SPIRIT_VEIL_PREWARM_ENTRY_ID}`;
    expect(prewarmResumeIsDebt(id)).toBe(true);
    const units = entry.resumeProgramUnits?.() ?? [];
    const deps = {
      queue,
      ledger: { noteStart: () => undefined },
      lifecycle: {} as never,
      arms: null,
    };
    const later = vi.fn(() => 'ran');
    const settled = Promise.all(units.map((unit) => runResumeUnit(unit, { id, units }, deps)));
    const behind = queue.run(later, GPU_WORK_PRIORITY.ACTIONABLE_VIEW, 'later:unit');
    const timeout = new Promise((resolve) => setTimeout(() => resolve('stuck'), 2000));
    expect(await Promise.race([settled.then(() => 'settled'), timeout])).toBe('settled');
    expect(await Promise.race([behind, timeout])).toBe('ran');
    expect(link).toHaveBeenCalledTimes(SPIRIT_VEIL_FAMILY.length);
    // the touches still run, after their held units let go of the queue
    for (let i = 0; i < 200 && touched.length < SPIRIT_VEIL_FAMILY.length; i++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(touched).toHaveLength(SPIRIT_VEIL_FAMILY.length);
  });

  it('is droppable, and a drop hands every tuple to the program-debt lane', async () => {
    const h = host();
    const entry = spiritVeilFamilyPrewarmEntry(h.arms, h, h.queue, h.link);
    expect(entry.required).toBe(false);
    expect(entry.deadlineExempt).toBeUndefined();
    expect(entry.category).toBe('entities');
    // past the soft deadline a droppable entry defers...
    expect(prewarmEntryShouldDefer(3100, 3000, 5000, entry.deadlineExempt ?? false, false)).toBe(
      true,
    );
    // ...and its program units resume under programs.<id>, a debt id, first
    const units = entry.resumeProgramUnits?.() ?? [];
    expect(units.map((unit) => unit.id)).toEqual(
      SPIRIT_VEIL_FAMILY.map((tuple) => `spirit-veil:${spiritVeilKeyOfTuple(tuple)}`),
    );
    for (const unit of units) expect(unit.roots).toHaveLength(1);
    const dropped = `programs.${SPIRIT_VEIL_PREWARM_ENTRY_ID}`;
    expect(prewarmResumeIsDebt(dropped)).toBe(true);
    const ordered = orderPrewarmResumeEntries([
      { id: 'vfx.weapon-skins' },
      { id: 'textures.scene' },
      { id: dropped },
    ]);
    expect(ordered[0].id).toBe(dropped);
    for (const unit of units) await unit.run();
    expect(spiritVeilTuplesLinked([...SPIRIT_VEIL_FAMILY_KEYS])).toBe(true);
  });

  it('runs on phones and without the parallel compile, where boot is the only safe place', () => {
    expect(CONSTRAINED_PREWARM_KEEP).toContain(SPIRIT_VEIL_PREWARM_ENTRY_ID);
    expect(BLOCKING_PREWARM_ENTRIES_WITHOUT_PARALLEL_COMPILE).not.toContain(
      SPIRIT_VEIL_PREWARM_ENTRY_ID,
    );
    for (const input of [
      BASE,
      { ...BASE, constrainedMemory: true },
      { ...BASE, asyncCompileSupported: false },
      { ...BASE, constrainedMemory: true, asyncCompileSupported: false },
    ]) {
      expect(prewarmEntryRuns(SPIRIT_VEIL_PREWARM_ENTRY_ID, resolvePrewarmPolicy(input))).toBe(
        true,
      );
    }
  });

  it('sits right after the ghost-fade variants in the renderer manifest, spread from the factory', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const fades = renderer.indexOf("id: 'props.ghost-fade-variants',");
    const veil = renderer.indexOf(`id: '${SPIRIT_VEIL_PREWARM_ENTRY_ID}',`);
    const next = renderer.indexOf("id: 'foliage.materials',");
    expect(fades).toBeGreaterThan(-1);
    expect(veil).toBeGreaterThan(fades);
    // the lit twin group that used to sit between them is gone for good
    expect(renderer).not.toContain('character-effect-variants');
    expect(next).toBeGreaterThan(veil);
    expect(renderer.slice(veil, next)).toContain('...spiritVeilFamilyPrewarmEntry(');
  });

  it('is wired into the world renderer: the per-rig sort and the reduced-motion freeze', () => {
    // Without it three draws a veiled rig in its default order (colour before
    // the depth pre-pass) and the shimmer ignores reduced motion.
    const renderer = stripComments(
      readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
    );
    const install = 'installSpiritVeil(this.webgl, () => this.reducedMotion());';
    expect(renderer.split(install).length - 1).toBe(1);
    // and nothing in the renderer installs another sort over it
    expect(renderer).not.toMatch(/setTransparentSort\(/);
  });

  it('installs the per-rig sort and freezes the shimmer clock under reduced motion', () => {
    let installed: ((a: unknown, b: unknown) => number) | null = null;
    let reduced = false;
    installSpiritVeil(
      {
        info: { render: { frame: 1 } },
        setTransparentSort: (sort: ((a: unknown, b: unknown) => number) | null) => {
          installed = sort;
        },
      } as unknown as Parameters<typeof installSpiritVeil>[0],
      () => reduced,
    );
    expect(installed).not.toBeNull();
    // The installed comparator draws a unit's depth pass before its body.
    const unit = createSpiritVeilSortUnit();
    const at = (pass: string, id: number) => ({
      id,
      groupOrder: 0,
      renderOrder: 0,
      z: 5,
      object: { userData: { [SPIRIT_VEIL_UNIT_KEY]: unit, [SPIRIT_VEIL_PASS_KEY]: pass } },
    });
    const sort = installed as unknown as (a: unknown, b: unknown) => number;
    expect(sort(at('color', 1), at('depth', 2))).toBeGreaterThan(0);

    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <project_vertex>\n#include <fog_vertex>',
      fragmentShader: '#include <opaque_fragment>',
    };
    const veil = createSpiritVeilMaterial(new MeshBasicMaterial());
    veil.onBeforeCompile(shader as never, {} as never);
    const clock = shader.uniforms.uVeilTime;
    const previous = sharedUniforms.uTime.value;
    try {
      sharedUniforms.uTime.value = 12.5;
      expect(clock.value).toBe(12.5);
      reduced = true;
      expect(clock.value).toBe(0);
    } finally {
      sharedUniforms.uTime.value = previous;
    }
  });
});

describe('a tuple outside the family', () => {
  it('is linked late on the background queue by a resident stand-in of its own', async () => {
    const h = host();
    spiritVeilFamilyPrewarmEntry(h.arms, h, h.queue, h.link);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const outside = ['color:s:5', 'depth:s:5'];
    const family = spiritVeilKeyOfTuple(SPIRIT_VEIL_FAMILY[0]);
    noteSpiritVeilMiss([...outside, family, 'color:s:5!morphnormal']);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // one unit per canonical tuple outside the family: the family's own tuple
    // is the boot entry's, and a flag no stand-in reproduces is left to the gate
    expect(h.queued.map((call) => call.label)).toEqual(
      outside.map((key) => `spirit-veil-late:${key}`),
    );
    for (const call of h.queued) {
      expect(call.priority).toBe(GPU_WORK_PRIORITY.BACKGROUND);
      expect(call.releaseTail).toBe(true);
      // The key names the gap in the perf report's unit rows; the budget and
      // the lanes price every late link as one kind, the head before the colon.
      expect(gpuPrepKindOfLabel(call.label ?? '')).toBe('spirit-veil-late');
    }
    expect(spiritVeilTuplesLinked(outside)).toBe(true);
    expect(spiritVeilTuplesLinked([family])).toBe(false);
  });

  it("stops a retired renderer's late link from queueing anything", async () => {
    const old = host();
    spiritVeilFamilyPrewarmEntry(old.arms, old, old.queue, old.link);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // a graphics rebuild resets the ledger before the next manifest binds it
    resetSpiritVeilLedger();
    noteSpiritVeilMiss(['color:s:11']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(old.queued).toHaveLength(0);
    // and a renderer that is no longer the ledger's owner queues nothing either
    const current = host();
    spiritVeilFamilyPrewarmEntry(current.arms, current, current.queue, current.link);
    spiritVeilFamilyPrewarmEntry(old.arms, old, old.queue, old.link);
    const next = host();
    spiritVeilFamilyPrewarmEntry(next.arms, next, next.queue, next.link);
    noteSpiritVeilMiss(['color:s:13']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(old.queued).toHaveLength(0);
    expect(next.queued.map((call) => call.label)).toEqual(['spirit-veil-late:color:s:13']);
  });

  it('names each unlinked tuple once on the dev channel', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    noteSpiritVeilMiss(['color:s:3']);
    noteSpiritVeilMiss(['color:s:3']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('outside the pinned family: color:s:3');
  });
});

describe('a context restore, which gives the renderer new properties', () => {
  function programCache() {
    const programs = new Map<
      THREE.Material,
      { getUniforms: ReturnType<typeof vi.fn>; getAttributes: ReturnType<typeof vi.fn> }
    >();
    const properties = {
      get: (material: THREE.Material) => {
        let program = programs.get(material);
        if (!program) {
          program = { getUniforms: vi.fn(), getAttributes: vi.fn() };
          programs.set(material, program);
        }
        return { currentProgram: program, programs: new Map([['k', program]]) };
      },
    };
    return { programs, properties };
  }

  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it('runs, proves, touches and links late under the live properties, never the dead ones', async () => {
    const h = host();
    const dead = programCache();
    const webgl = { properties: dead.properties };
    const entry = spiritVeilFamilyPrewarmEntry(h.arms, webgl, h.queue, h.link);
    await entry.run();
    const all = [...SPIRIT_VEIL_FAMILY_KEYS];
    expect(spiritVeilTuplesLinked(all)).toBe(true);
    for (const program of dead.programs.values()) program.getUniforms.mockClear();
    const live = programCache();
    webgl.properties = live.properties;
    await entry.run();
    expect(spiritVeilLedgerOwnedBy(live.properties)).toBe(true);
    expect(spiritVeilTuplesLinked(all)).toBe(true);
    expect(live.programs.size).toBe(SPIRIT_VEIL_FAMILY.length);
    for (const program of live.programs.values()) {
      expect(isProgramKnownReady(program as never)).toBe(true);
      expect(program.getUniforms).toHaveBeenCalledTimes(1);
    }
    for (const program of dead.programs.values())
      expect(program.getUniforms).not.toHaveBeenCalled();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.queued.length = 0;
    noteSpiritVeilMiss(['color:s:15']);
    await settle();
    expect(h.queued.map((call) => call.label)).toContain('spirit-veil-late:color:s:15');
    expect(spiritVeilTuplesLinked(['color:s:15'])).toBe(true);
  });

  it('records nothing from a link that settles after the restore', async () => {
    const h = host();
    const dead = programCache();
    const webgl = { properties: dead.properties };
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.link.mockImplementation(() => held);
    const entry = spiritVeilFamilyPrewarmEntry(h.arms, webgl, h.queue, h.link);
    const run = entry.run();
    webgl.properties = programCache().properties;
    release();
    await run;
    expect(spiritVeilLedgerSize()).toBe(0);
    expect(dead.programs.size).toBe(0);
    expect(h.queued.filter((call) => call.label === LINKED_PROGRAM_TOUCH_LABEL)).toHaveLength(0);
  });

  it('never takes the ledger from the renderer that replaced this one', async () => {
    const old = host();
    const webgl = { properties: programCache().properties };
    const entry = spiritVeilFamilyPrewarmEntry(old.arms, webgl, old.queue, old.link);
    const next = host();
    spiritVeilFamilyPrewarmEntry(next.arms, next, next.queue, next.link);
    webgl.properties = programCache().properties;
    await entry.run();
    expect(spiritVeilLedgerOwnedBy(next.properties)).toBe(true);
    expect(spiritVeilLedgerSize()).toBe(0);
  });

  it('rebinds the same properties on the run after a ledger reset', async () => {
    const h = host();
    const entry = spiritVeilFamilyPrewarmEntry(h.arms, h, h.queue, h.link);
    resetSpiritVeilLedger();
    await entry.run();
    expect(spiritVeilLedgerOwnedBy(h.properties)).toBe(true);
    expect(spiritVeilTuplesLinked([...SPIRIT_VEIL_FAMILY_KEYS])).toBe(true);
  });

  it('binds the live properties on the run after a ledger reset', async () => {
    const h = host();
    const webgl = { properties: programCache().properties };
    const entry = spiritVeilFamilyPrewarmEntry(h.arms, webgl, h.queue, h.link);
    resetSpiritVeilLedger();
    const live = programCache();
    webgl.properties = live.properties;
    for (const unit of entry.resumeProgramUnits?.() ?? []) await unit.run();
    expect(spiritVeilLedgerOwnedBy(live.properties)).toBe(true);
    expect(spiritVeilTuplesLinked([...SPIRIT_VEIL_FAMILY_KEYS])).toBe(true);
  });
});
