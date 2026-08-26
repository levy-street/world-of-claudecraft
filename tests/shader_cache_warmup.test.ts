// The host of the self-warming shader cache (src/game/shader_cache_warmup.ts).
//
// No browser here: the WebGL context, the storage and the frame clock are the
// module's injectable seams, so the parts that decide anything are exercised in
// plain Node. What is pinned: the gzip round trip a corpus survives between
// sessions, the skip reasons (a warm-up must cost nothing when it cannot apply),
// the pacing (one program per frame, never a block), and the three wiring points
// in src/main.ts, which is where the whole feature is either armed or dead.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryStore,
  decodeCorpus,
  encodeCorpus,
  finishShaderWarmup,
  recordShaderCorpus,
  releaseShaderWarmup,
  type ShaderCorpusRenderer,
  shaderWarmupInternalsForTest,
  shaderWarmupStats,
  startShaderWarmup,
  stopShaderWarmup,
  type WarmupContext,
  type WarmupGl,
} from '../src/game/shader_cache_warmup';
import {
  createShaderCorpusRecord,
  type ShaderCorpusRecord,
  shaderCorpusIdentity,
} from '../src/render/shader_warmup_core';
import { stripComments } from './helpers/strip_comments';

const BUILD = 'testbuild001';
const TIER = 'ultra';
const ADAPTER = 'FakeGPU Ultra';
// The intersection of the fake adapter's extensions with
// RENDERER_CONTEXT_EXTENSIONS, in that list's order: the identity is only
// comparable when both contexts enabled the same set in the same order.
const ENABLED = [
  'EXT_color_buffer_float',
  'WEBGL_debug_renderer_info',
  'KHR_parallel_shader_compile',
];
const UNMASKED_RENDERER_WEBGL = 0x9246;

interface FakeShader {
  type: number;
  source: string;
}

interface FakeGl {
  VERTEX_SHADER: number;
  FRAGMENT_SHADER: number;
  RENDERER: number;
  SHADER_TYPE: number;
  linked: { vertex: string; fragment: string }[];
  deletedPrograms: number;
  deletedShaders: number;
  lost: boolean;
  parallelCompile: boolean;
  attached: FakeShader[];
}

function fakeGl(options: { parallelCompile?: boolean } = {}): FakeGl & WarmupGl {
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    RENDERER: 3,
    SHADER_TYPE: 4,
    linked: [] as { vertex: string; fragment: string }[],
    deletedPrograms: 0,
    deletedShaders: 0,
    lost: false,
    parallelCompile: options.parallelCompile ?? true,
    attached: [] as FakeShader[],
    createShader: (type: number) => ({ type, source: '' }),
    shaderSource: (shader: FakeShader, source: string) => {
      shader.source = source;
    },
    compileShader: () => {},
    createProgram: () => ({ shaders: [] as FakeShader[] }),
    attachShader: (program: { shaders: FakeShader[] }, shader: FakeShader) => {
      program.shaders.push(shader);
    },
    linkProgram: (program: { shaders: FakeShader[] }) => {
      const vertex = program.shaders.find((s) => s.type === 1)?.source ?? '';
      const fragment = program.shaders.find((s) => s.type === 2)?.source ?? '';
      gl.linked.push({ vertex, fragment });
    },
    deleteShader: () => {
      gl.deletedShaders += 1;
    },
    deleteProgram: () => {
      gl.deletedPrograms += 1;
    },
    getExtension: (name: string) => {
      if (name === 'KHR_parallel_shader_compile') return gl.parallelCompile ? {} : null;
      if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_RENDERER_WEBGL };
      if (name === 'EXT_color_buffer_float') return {};
      if (name === 'WEBGL_lose_context') {
        return {
          loseContext: () => {
            gl.lost = true;
          },
        };
      }
      return null;
    },
    getParameter: (pname: number) => (pname === UNMASKED_RENDERER_WEBGL ? ADAPTER : 'fallback'),
    getAttachedShaders: () => gl.attached,
    getShaderParameter: (shader: FakeShader) => shader.type,
    getShaderSource: (shader: FakeShader) => shader.source,
    getContextAttributes: () => ({ antialias: false, alpha: true }),
  };
  return gl as unknown as FakeGl & WarmupGl;
}

function corpusRecord(
  programs: { vertex: string; fragment: string }[],
  extensions: string[] = ENABLED,
): ShaderCorpusRecord {
  return createShaderCorpusRecord({
    identity: shaderCorpusIdentity({
      buildId: BUILD,
      tier: TIER,
      adapter: ADAPTER,
      extensions,
    }),
    savedAt: 1_700_000_000_000,
    contextAttributes: { antialias: false },
    sources: programs,
  });
}

const program = (n: number) => ({ vertex: `void vertex${n}(){}`, fragment: `void frag${n}(){}` });

async function storeWith(
  record: ShaderCorpusRecord | null,
): Promise<ReturnType<typeof createMemoryStore>> {
  const values = new Map<string, unknown>();
  if (record) values.set(shaderWarmupInternalsForTest.corpusKey, await encodeCorpus(record));
  return createMemoryStore(values);
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The corpus travels through the gzip streams, which settle over several
 *  turns of the loop, so every wait here polls rather than counting turns. */
async function waitFor(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ready(); i++) await flush();
}

async function waitForStored(values: Map<string, unknown>): Promise<unknown> {
  await waitFor(() => values.has(shaderWarmupInternalsForTest.corpusKey));
  return values.get(shaderWarmupInternalsForTest.corpusKey);
}

describe('the corpus round trip', () => {
  it('survives gzip and comes back identical', async () => {
    const record = corpusRecord([program(1), program(2)]);
    const stored = await encodeCorpus(record);
    expect(stored.gzip).toBe(true);
    expect(await decodeCorpus(stored)).toEqual(record);
  });

  it('compresses the repetitive GLSL a real corpus is made of', async () => {
    const bulky = corpusRecord(
      Array.from({ length: 50 }, (_, i) => ({
        vertex: `#version 300 es\n${'precision highp float;\n'.repeat(40)}// ${i}`,
        fragment: `#version 300 es\n${'precision highp float;\n'.repeat(40)}// f${i}`,
      })),
    );
    const raw = new TextEncoder().encode(JSON.stringify(bulky)).byteLength;
    const stored = await encodeCorpus(bulky);
    expect(stored.bytes.byteLength).toBeLessThan(raw / 4);
  });

  it('reads anything unusable as no corpus rather than throwing', async () => {
    expect(await decodeCorpus(undefined)).toBeNull();
    expect(await decodeCorpus({ gzip: false, bytes: 'not bytes' })).toBeNull();
    expect(
      await decodeCorpus({ gzip: false, bytes: new TextEncoder().encode('{oops') }),
    ).toBeNull();
    expect(await decodeCorpus({ gzip: true, bytes: new Uint8Array([1, 2, 3]) })).toBeNull();
    const foreign = { ...corpusRecord([program(1)]), version: 99 };
    expect(
      await decodeCorpus({ gzip: false, bytes: new TextEncoder().encode(JSON.stringify(foreign)) }),
    ).toBeNull();
  });
});

describe('startShaderWarmup', () => {
  beforeEach(() => {
    shaderWarmupInternalsForTest.reset();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const run = async (options: {
    record?: ShaderCorpusRecord | null;
    search?: string;
    tier?: string;
    parallelCompile?: boolean;
  }) => {
    const gl = fakeGl({ parallelCompile: options.parallelCompile });
    const frames: (() => void)[] = [];
    const cancelled: number[] = [];
    let contexts = 0;
    let disposed = 0;
    const inner = await storeWith(options.record ?? null);
    let storeGets = 0;
    const store = {
      get: (key: string) => {
        storeGets += 1;
        return inner.get(key);
      },
      set: inner.set,
    };
    startShaderWarmup({
      search: options.search ?? '',
      store,
      buildId: BUILD,
      tier: options.tier ?? TIER,
      now: () => 1000 + frames.length,
      createContext: (): WarmupContext | null => {
        contexts += 1;
        return {
          gl,
          dispose: () => {
            disposed += 1;
            gl.getExtension('WEBGL_lose_context');
            gl.lost = true;
          },
        };
      },
      scheduleFrame: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      cancelFrame: (handle) => cancelled.push(handle),
    });
    // Settled: either the warm-up refused, or its first frame is scheduled.
    await waitFor(() => shaderWarmupStats().skipped !== null || frames.length > 0);
    const runFrames = (count: number) => {
      for (let i = 0; i < count; i++) {
        const next = frames.shift();
        if (!next) return;
        next();
      }
    };
    return {
      gl,
      frames,
      cancelled,
      runFrames,
      contexts: () => contexts,
      disposed: () => disposed,
      storeGets: () => storeGets,
    };
  };

  it('links one program per frame and never a block', async () => {
    const ctx = await run({ record: corpusRecord([program(1), program(2), program(3)]) });
    expect(ctx.gl.linked).toHaveLength(0);
    ctx.runFrames(1);
    expect(ctx.gl.linked).toEqual([program(1)]);
    ctx.runFrames(1);
    expect(ctx.gl.linked).toEqual([program(1), program(2)]);
    ctx.runFrames(2);
    expect(ctx.gl.linked).toHaveLength(3);
    expect(shaderWarmupStats()).toMatchObject({ corpusPrograms: 3, submitted: 3, skipped: null });
    // The last frame found the plan exhausted and scheduled nothing more.
    expect(ctx.frames).toHaveLength(0);
  });

  it('skips with no corpus stored, and creates no context at all', async () => {
    const ctx = await run({ record: null });
    expect(ctx.contexts()).toBe(0);
    expect(ctx.storeGets()).toBe(1);
    expect(shaderWarmupStats().skipped).toBe('no-corpus');
  });

  it('skips a corpus recorded under another tier', async () => {
    const ctx = await run({ record: corpusRecord([program(1)]), tier: 'high' });
    expect(shaderWarmupStats().skipped).toBe('identity-mismatch');
    expect(ctx.gl.linked).toHaveLength(0);
    // The hidden context it opened to read the adapter is handed back.
    expect(ctx.disposed()).toBe(1);
  });

  it('skips when the adapter has no parallel compile', async () => {
    // The corpus of an adapter that never had the extension: the identity
    // matches (same set, same order), so the parallel-compile arm is what
    // decides, not the extension list.
    const withoutParallel = ENABLED.filter((name) => name !== 'KHR_parallel_shader_compile');
    const ctx = await run({
      record: corpusRecord([program(1)], withoutParallel),
      parallelCompile: false,
    });
    expect(shaderWarmupStats().skipped).toBe('no-parallel-compile');
    expect(ctx.gl.linked).toHaveLength(0);
    expect(ctx.disposed()).toBe(1);
  });

  it('hands the perf probes a global accessor', async () => {
    await run({ record: null });
    const probe = (globalThis as { __shaderWarmup?: () => unknown }).__shaderWarmup;
    expect(typeof probe).toBe('function');
    expect(probe?.()).toEqual(shaderWarmupStats());
  });

  it('is off under ?shaderwarm=0 and reads neither storage nor GL', async () => {
    const ctx = await run({ record: corpusRecord([program(1)]), search: '?shaderwarm=0' });
    expect(shaderWarmupStats().skipped).toBe('disabled');
    expect(ctx.contexts()).toBe(0);
    expect(ctx.storeGets()).toBe(0);
  });

  it('stops paying out the moment the player enters the world', async () => {
    const ctx = await run({ record: corpusRecord([program(1), program(2), program(3)]) });
    ctx.runFrames(1);
    stopShaderWarmup();
    expect(ctx.cancelled).toHaveLength(1);
    ctx.runFrames(3);
    expect(ctx.gl.linked).toEqual([program(1)]);
    expect(shaderWarmupStats().submitted).toBe(1);
  });

  it('keeps the hidden context alive at stop and drops it only at release', async () => {
    const ctx = await run({ record: corpusRecord([program(1), program(2)]) });
    ctx.runFrames(1);
    stopShaderWarmup();
    expect(ctx.gl.lost).toBe(false);
    releaseShaderWarmup();
    expect(ctx.gl.lost).toBe(true);
    expect(ctx.gl.deletedPrograms).toBe(1);
    expect(ctx.gl.deletedShaders).toBe(2);
    expect(shaderWarmupStats().released).toBe(true);
  });

  it('does not restart when the character-select screen is shown again', async () => {
    const ctx = await run({ record: corpusRecord([program(1), program(2)]) });
    ctx.runFrames(1);
    startShaderWarmup({ store: await storeWith(null), search: '' });
    await flush();
    ctx.runFrames(1);
    expect(ctx.frames).toHaveLength(1);
    expect(ctx.gl.linked).toEqual([program(1), program(2)]);
    expect(shaderWarmupStats().skipped).toBeNull();
  });
});

describe('recordShaderCorpus', () => {
  beforeEach(() => {
    shaderWarmupInternalsForTest.reset();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderer = (gl: WarmupGl, programs: unknown[]): ShaderCorpusRenderer => ({
    info: { programs },
    getContext: () => gl,
  });

  it('stores this session program set under the identity a warm-up will look for', async () => {
    const gl = fakeGl();
    gl.attached = [
      { type: gl.VERTEX_SHADER, source: 'void vertex1(){}' },
      { type: gl.FRAGMENT_SHADER, source: 'void frag1(){}' },
    ];
    const values = new Map<string, unknown>();
    const store = createMemoryStore(values);
    const count = await recordShaderCorpus(renderer(gl, [{ program: {} }, { program: {} }]), {
      store,
      buildId: BUILD,
      tier: TIER,
      now: () => 42,
    });
    // Both entries carry the same sources: the corpus keeps one.
    expect(count).toBe(1);
    const decoded = await decodeCorpus(values.get(shaderWarmupInternalsForTest.corpusKey));
    expect(decoded?.programs).toEqual([program(1)]);
    expect(decoded?.savedAt).toBe(42);
    expect(decoded?.contextAttributes).toEqual({ antialias: false, alpha: true });
    expect(decoded?.identity).toBe(
      shaderCorpusIdentity({ buildId: BUILD, tier: TIER, adapter: ADAPTER, extensions: ENABLED }),
    );
  });

  it('never throws at its caller when the context refuses', async () => {
    const broken = {
      info: { programs: [{ program: {} }] },
      getContext: () => {
        throw new Error('context lost');
      },
    };
    await expect(recordShaderCorpus(broken)).resolves.toBe(0);
  });

  it('is what finishShaderWarmup schedules, after releasing the hidden context', async () => {
    const gl = fakeGl();
    gl.attached = [
      { type: gl.VERTEX_SHADER, source: 'void vertex1(){}' },
      { type: gl.FRAGMENT_SHADER, source: 'void frag1(){}' },
    ];
    const values = new Map<string, unknown>();
    let scheduledDelay = 0;
    finishShaderWarmup(renderer(gl, [{ program: {} }]), {
      store: createMemoryStore(values),
      buildId: BUILD,
      tier: TIER,
      scheduleIdle: (callback, delayMs) => {
        scheduledDelay = delayMs;
        callback();
      },
    });
    // Well after the reveal, so reading every program source costs the player
    // nothing, and the corpus covers the first minutes of play.
    expect(scheduledDelay).toBeGreaterThanOrEqual(20_000);
    expect(shaderWarmupStats().released).toBe(true);
    expect(await decodeCorpus(await waitForStored(values))).not.toBeNull();
  });
});

describe('the src/main.ts wiring', () => {
  const mainSource = stripComments(
    readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'),
  );

  it('imports the host', () => {
    expect(mainSource).toContain("from './game/shader_cache_warmup'");
  });

  it('starts the warm-up on the character-select screen', () => {
    expect(mainSource).toContain("if (el === '#charselect-panel') {\n    startShaderWarmup();");
  });

  it('stops it as the first thing world entry does', () => {
    expect(mainSource).toMatch(
      /async function enterWorld\([^)]*\): Promise<void> \{\n {2}stopShaderWarmup\(\);/,
    );
  });

  it('records and releases at the world reveal, not before', () => {
    expect(mainSource).toContain(
      'renderer.markGpuHitchReveal();\n        finishShaderWarmup(renderer.webgl);',
    );
    const reveal = mainSource.indexOf('finishShaderWarmup(renderer.webgl);');
    const stop = mainSource.indexOf('stopShaderWarmup();');
    const start = mainSource.indexOf('startShaderWarmup();');
    expect(start).toBeGreaterThan(0);
    expect(stop).toBeGreaterThan(0);
    expect(reveal).toBeGreaterThan(0);
    // One call each: the wiring is three points, not a pattern sprayed around.
    expect(mainSource.split('startShaderWarmup();')).toHaveLength(2);
    expect(mainSource.split('stopShaderWarmup();')).toHaveLength(2);
    expect(mainSource.split('finishShaderWarmup(renderer.webgl);')).toHaveLength(2);
  });
});
