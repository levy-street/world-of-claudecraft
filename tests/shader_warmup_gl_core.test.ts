// The GL discipline every warm-up context shares
// (src/render/shader_warmup_gl_core.ts): how a program is submitted so its
// browser cache key matches the game's own link, and how a link is resolved
// so it enters that cache at all. The two rules the measurements settled are
// what the cases below pin: the location-0 bind is part of the key, and a
// LINK_STATUS read is what RESOLVES a parallel link (so the submission must
// not do one, and the poll must do exactly one, once).

import { describe, expect, it } from 'vitest';
import {
  COMPLETION_STATUS_KHR,
  deleteWarmProgram,
  pollWarmProgram,
  releaseWarmShaders,
  resolveWarmProgram,
  submitWarmProgram,
  type WarmProgramHandle,
  type WarmupGl,
} from '../src/render/shader_warmup_gl_core';

const VERTEX_SHADER = 0x8b31;
const FRAGMENT_SHADER = 0x8b30;
const LINK_STATUS = 0x8b82;
const RENDERER = 0x1f01;

interface GlRigOptions {
  /** Answer null for this stage, the way a context out of objects does. */
  refuseShader?: 'vertex' | 'fragment';
  refuseProgram?: boolean;
  throwOnDelete?: boolean;
}

interface GlRig {
  gl: WarmupGl;
  /** Every call the module made, in order, with its arguments. */
  calls: string[];
  /** The pnames handed to getProgramParameter, in order. */
  queried: number[];
  setCompletion(value: unknown): void;
  setLinkStatus(value: unknown): void;
  throwOnQuery(on: boolean): void;
}

function named(object: unknown): string {
  return (object as { name?: string }).name ?? '?';
}

function glRig(options: GlRigOptions = {}): GlRig {
  const calls: string[] = [];
  const queried: number[] = [];
  let completion: unknown = false;
  let linkStatus: unknown = true;
  let throwing = false;
  const gl: WarmupGl = {
    VERTEX_SHADER,
    FRAGMENT_SHADER,
    RENDERER,
    LINK_STATUS,
    createShader(type) {
      const stage = type === VERTEX_SHADER ? 'vertex' : 'fragment';
      calls.push(`createShader:${stage}`);
      if (options.refuseShader === stage) return null;
      return { name: stage } as unknown as WebGLShader;
    },
    shaderSource(shader, source) {
      calls.push(`shaderSource:${named(shader)}:${source}`);
    },
    compileShader(shader) {
      calls.push(`compileShader:${named(shader)}`);
    },
    createProgram() {
      calls.push('createProgram');
      return options.refuseProgram ? null : ({ name: 'program' } as unknown as WebGLProgram);
    },
    attachShader(program, shader) {
      calls.push(`attachShader:${named(program)}:${named(shader)}`);
    },
    bindAttribLocation(program, index, name) {
      calls.push(`bindAttribLocation:${named(program)}:${index}:${name}`);
    },
    linkProgram(program) {
      calls.push(`linkProgram:${named(program)}`);
    },
    deleteShader(shader) {
      calls.push(`deleteShader:${named(shader)}`);
      if (options.throwOnDelete) throw new Error('context lost');
    },
    deleteProgram(program) {
      calls.push(`deleteProgram:${named(program)}`);
      if (options.throwOnDelete) throw new Error('context lost');
    },
    getExtension(name) {
      calls.push(`getExtension:${name}`);
      return null;
    },
    getParameter(pname) {
      calls.push(`getParameter:${pname}`);
      return 'adapter';
    },
    getProgramParameter(program, pname) {
      calls.push(`getProgramParameter:${named(program)}:${pname}`);
      queried.push(pname);
      if (throwing) throw new Error('context lost');
      return pname === COMPLETION_STATUS_KHR ? completion : linkStatus;
    },
  };
  return {
    gl,
    calls,
    queried,
    setCompletion(value) {
      completion = value;
    },
    setLinkStatus(value) {
      linkStatus = value;
    },
    throwOnQuery(on) {
      throwing = on;
    },
  };
}

const SOURCES = { vertex: 'void main() {}', fragment: 'precision highp float;' };

function handleOf(rig: GlRig, index0Attribute = 'position'): WarmProgramHandle {
  const handle = submitWarmProgram(rig.gl, { ...SOURCES, index0Attribute });
  if (!handle) throw new Error('the rig refused the program');
  rig.calls.length = 0;
  rig.queried.length = 0;
  return handle;
}

describe('the completion query the warm-up polls with', () => {
  it('is KHR_parallel_shader_compile own COMPLETION_STATUS_KHR literal', () => {
    // The enum is the extension's, not three's: a wrong value reads as an
    // unknown pname, which every driver answers null to, so the poll would
    // report pending forever and no program would ever resolve.
    expect(COMPLETION_STATUS_KHR).toBe(0x91b1);
  });
});

describe('submitWarmProgram', () => {
  it('compiles both stages, binds location 0, links, and never queries the link', () => {
    // The LINK_STATUS read is the resolve: doing one here would make the
    // off-thread link synchronous, which is the whole cost the worker exists
    // to move off the main thread.
    const rig = glRig();
    const handle = submitWarmProgram(rig.gl, { ...SOURCES, index0Attribute: 'position' });

    expect(handle).not.toBeNull();
    expect(rig.calls).toEqual([
      'createShader:vertex',
      'createShader:fragment',
      'createProgram',
      'shaderSource:vertex:void main() {}',
      'compileShader:vertex',
      'shaderSource:fragment:precision highp float;',
      'compileShader:fragment',
      'attachShader:program:vertex',
      'attachShader:program:fragment',
      'bindAttribLocation:program:0:position',
      'linkProgram:program',
    ]);
    expect(rig.queried).toEqual([]);
    expect(named(handle?.program)).toBe('program');
    expect(named(handle?.vertex)).toBe('vertex');
    expect(named(handle?.fragment)).toBe('fragment');
  });

  it('binds nothing at location 0 when the program has no attribute there', () => {
    // Empty is not "bind an empty name": the browser keys the cache on the
    // bind, so an invented one writes a key the game never asks for.
    const rig = glRig();
    submitWarmProgram(rig.gl, { ...SOURCES, index0Attribute: '' });

    expect(rig.calls.some((call) => call.startsWith('bindAttribLocation'))).toBe(false);
    expect(rig.calls.at(-1)).toBe('linkProgram:program');
  });

  it('returns null and deletes both shaders when the context refuses the program', () => {
    const rig = glRig({ refuseProgram: true });

    expect(submitWarmProgram(rig.gl, { ...SOURCES, index0Attribute: 'position' })).toBeNull();
    expect(rig.calls).toEqual([
      'createShader:vertex',
      'createShader:fragment',
      'createProgram',
      'deleteShader:vertex',
      'deleteShader:fragment',
    ]);
  });

  it('returns null and deletes what it did get when a stage is refused', () => {
    // The vertex shader and the program are both live here; leaking either
    // one per refused program is how a warm-up outlives its own context.
    const rig = glRig({ refuseShader: 'fragment' });

    expect(submitWarmProgram(rig.gl, { ...SOURCES, index0Attribute: 'position' })).toBeNull();
    expect(rig.calls).toEqual([
      'createShader:vertex',
      'createShader:fragment',
      'createProgram',
      'deleteShader:vertex',
      'deleteProgram:program',
    ]);
  });
});

describe('pollWarmProgram', () => {
  it('answers pending until the completion query is true, without reading LINK_STATUS', () => {
    const rig = glRig();
    const handle = handleOf(rig);

    expect(pollWarmProgram(rig.gl, handle)).toBe('pending');
    expect(pollWarmProgram(rig.gl, handle)).toBe('pending');
    expect(rig.queried).toEqual([COMPLETION_STATUS_KHR, COMPLETION_STATUS_KHR]);
  });

  it('reads LINK_STATUS exactly once on the poll that completes, and answers linked', () => {
    // Exactly once because that read is what resolves the link into the
    // browser cache: a poll that skipped it would report a program the cache
    // never received, and a second one would pay the resolve twice.
    const rig = glRig();
    const handle = handleOf(rig);
    rig.setCompletion(true);
    rig.setLinkStatus(true);

    expect(pollWarmProgram(rig.gl, handle)).toBe('linked');
    expect(rig.queried).toEqual([COMPLETION_STATUS_KHR, LINK_STATUS]);
  });

  it('answers failed for a link the driver rejected', () => {
    const rig = glRig();
    const handle = handleOf(rig);
    rig.setCompletion(true);
    rig.setLinkStatus(false);

    expect(pollWarmProgram(rig.gl, handle)).toBe('failed');
    expect(rig.queried).toEqual([COMPLETION_STATUS_KHR, LINK_STATUS]);
  });

  it('answers failed when the query throws, rather than escaping to the tick', () => {
    // A context on its way out throws here; the worker's tick must keep
    // draining, so the poll owns the throw.
    const rig = glRig();
    const handle = handleOf(rig);
    rig.throwOnQuery(true);

    expect(pollWarmProgram(rig.gl, handle)).toBe('failed');
  });
});

describe('resolveWarmProgram', () => {
  it('resolves with one LINK_STATUS read and no completion query', () => {
    const rig = glRig();
    const handle = handleOf(rig);
    rig.setLinkStatus(true);

    expect(resolveWarmProgram(rig.gl, handle)).toBe('linked');
    expect(rig.queried).toEqual([LINK_STATUS]);

    rig.setLinkStatus(false);
    expect(resolveWarmProgram(rig.gl, handle)).toBe('failed');
  });

  it('answers failed when the read throws', () => {
    const rig = glRig();
    const handle = handleOf(rig);
    rig.throwOnQuery(true);

    expect(resolveWarmProgram(rig.gl, handle)).toBe('failed');
  });
});

describe('releasing a warmed program', () => {
  it('frees both shaders and swallows a lost context', () => {
    const rig = glRig();
    const handle = handleOf(rig);

    expect(() => releaseWarmShaders(rig.gl, handle)).not.toThrow();
    expect(rig.calls).toEqual(['deleteShader:vertex', 'deleteShader:fragment']);

    const lost = glRig({ throwOnDelete: true });
    const lostHandle = handleOf(lost);
    expect(() => releaseWarmShaders(lost.gl, lostHandle)).not.toThrow();
    expect(lost.calls).toEqual(['deleteShader:vertex']);
  });

  it('deletes the program and swallows a lost context', () => {
    const rig = glRig();
    const handle = handleOf(rig);

    expect(() => deleteWarmProgram(rig.gl, handle)).not.toThrow();
    expect(rig.calls).toEqual(['deleteProgram:program']);

    const lost = glRig({ throwOnDelete: true });
    const lostHandle = handleOf(lost);
    expect(() => deleteWarmProgram(lost.gl, lostHandle)).not.toThrow();
    expect(lost.calls).toEqual(['deleteProgram:program']);
  });
});
