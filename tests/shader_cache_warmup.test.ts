// The host of the self-warming shader cache (src/game/shader_cache_warmup.ts).
//
// No browser here: the WebGL context, the storage and the frame clock are the
// module's injectable seams, so the parts that decide anything are exercised in
// plain Node. What is pinned: the gzip round trip a corpus survives between
// sessions, the skip reasons (a warm-up must cost nothing when it cannot apply),
// the pacing (one program per frame, never a block), the two calls that decide
// whether the browser's cache is filled with the keys the game will ask for
// (the location-0 attribute bind, replayed from the record, and the LINK_STATUS
// read that resolves a completed parallel link), and the three wiring points
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
import { releaseTrackedWebGLContexts } from '../src/render/context_release';
import { setShaderWarmStoredSettingSource } from '../src/render/shader_warm_client';
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
  LINK_STATUS: number;
  ACTIVE_ATTRIBUTES: number;
  linked: { vertex: string; fragment: string; index0Attribute: string }[];
  linkStatusReads: number;
  deletedPrograms: number;
  deletedShaders: number;
  lost: boolean;
  parallelCompile: boolean;
  missingExtensions: string[];
  attributes: string[];
  attached: FakeShader[];
}

function fakeGl(
  options: { parallelCompile?: boolean; missingExtensions?: string[] } = {},
): FakeGl & WarmupGl {
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    RENDERER: 3,
    SHADER_TYPE: 4,
    LINK_STATUS: 5,
    ACTIVE_ATTRIBUTES: 6,
    linked: [] as { vertex: string; fragment: string; index0Attribute: string }[],
    linkStatusReads: 0,
    deletedPrograms: 0,
    deletedShaders: 0,
    lost: false,
    parallelCompile: options.parallelCompile ?? true,
    missingExtensions: options.missingExtensions ?? [],
    // The active attributes of every recorded program, `position` at index 0.
    attributes: ['position', 'uv'],
    attached: [] as FakeShader[],
    createShader: (type: number) => ({ type, source: '' }),
    shaderSource: (shader: FakeShader, source: string) => {
      shader.source = source;
    },
    compileShader: () => {},
    createProgram: () => ({ shaders: [] as FakeShader[], bound: '' }),
    attachShader: (program: { shaders: FakeShader[] }, shader: FakeShader) => {
      program.shaders.push(shader);
    },
    bindAttribLocation: (program: { bound: string }, index: number, name: string) => {
      if (index === 0) program.bound = name;
    },
    getProgramParameter: (program: { polls?: number }, pname: number) => {
      if (pname === gl.ACTIVE_ATTRIBUTES) return gl.attributes.length;
      if (pname === gl.LINK_STATUS) {
        gl.linkStatusReads += 1;
        return true;
      }
      // Complete on the second poll, so a test can see a pending link survive one frame.
      program.polls = (program.polls ?? 0) + 1;
      return program.polls >= 2;
    },
    getActiveAttrib: (_program: unknown, index: number) =>
      index < gl.attributes.length ? { name: gl.attributes[index] } : null,
    getAttribLocation: (_program: unknown, name: string) => gl.attributes.indexOf(name),
    linkProgram: (program: { shaders: FakeShader[]; bound: string }) => {
      const vertex = program.shaders.find((s) => s.type === 1)?.source ?? '';
      const fragment = program.shaders.find((s) => s.type === 2)?.source ?? '';
      gl.linked.push({ vertex, fragment, index0Attribute: program.bound });
    },
    deleteShader: () => {
      gl.deletedShaders += 1;
    },
    deleteProgram: () => {
      gl.deletedPrograms += 1;
    },
    getExtension: (name: string) => {
      if (gl.missingExtensions.includes(name)) return null;
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
  programs: { vertex: string; fragment: string; index0Attribute: string }[],
  extensions: string[] = ENABLED,
): ShaderCorpusRecord {
  return createShaderCorpusRecord({
    identity: shaderCorpusIdentity({
      buildId: BUILD,
      tier: TIER,
      adapter: ADAPTER,
      extensions,
    }),
    extensions,
    savedAt: 1_700_000_000_000,
    contextAttributes: { antialias: false },
    sources: programs,
  });
}

const program = (n: number) => ({
  vertex: `void vertex${n}(){}`,
  fragment: `void frag${n}(){}`,
  index0Attribute: 'position',
});

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
        index0Attribute: 'position',
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

  it('refuses a stored value past the byte ceiling before and during inflation', async () => {
    // The store is same-origin writable: a value too large as stored, and one
    // that inflates past the ceiling, must each read as no corpus without
    // being materialized. (A record whose GLSL alone sums past the ceiling is
    // the validator's arm, pinned in tests/shader_warmup_core.test.ts.)
    const record = corpusRecord([program(1), program(2)]);
    const stored = await encodeCorpus(record);
    const raw = new TextEncoder().encode(JSON.stringify(record));
    // One ceiling for both forms: the inflated bytes are what the page holds.
    expect(await decodeCorpus(stored, raw.byteLength)).toEqual(record);
    expect(await decodeCorpus(stored, stored.bytes.byteLength - 1)).toBeNull();
    // Compressed under the cap, inflated over it.
    expect(stored.bytes.byteLength).toBeLessThan(raw.byteLength);
    expect(await decodeCorpus(stored, raw.byteLength - 1)).toBeNull();
    expect(await decodeCorpus({ gzip: false, bytes: raw }, raw.byteLength)).toEqual(record);
    expect(await decodeCorpus({ gzip: false, bytes: raw }, raw.byteLength - 1)).toBeNull();
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
    stored?: string | null;
    platform?: 'ios' | 'android' | 'other';
    tier?: string;
    parallelCompile?: boolean;
    missingExtensions?: string[];
  }) => {
    const gl = fakeGl({
      parallelCompile: options.parallelCompile,
      missingExtensions: options.missingExtensions,
    });
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
      stored: options.stored ?? null,
      platform: options.platform ?? 'other',
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
    ctx.runFrames(1);
    expect(ctx.gl.linked).toHaveLength(3);
    expect(shaderWarmupStats()).toMatchObject({ corpusPrograms: 3, submitted: 3, skipped: null });
    // Submission done: the loop now polls each pending link's completion, one
    // frame per round, without blocking. The fake completes on the second poll,
    // so one round leaves every link pending and the next resolves all three;
    // the frame that finds nothing pending schedules nothing more.
    ctx.runFrames(1);
    expect(shaderWarmupStats().resolved).toBe(0);
    expect(ctx.frames).toHaveLength(1);
    ctx.runFrames(1);
    expect(shaderWarmupStats().resolved).toBe(3);
    ctx.runFrames(1);
    expect(shaderWarmupStats().resolved).toBe(3);
    expect(ctx.frames).toHaveLength(0);
  });

  it('replays the attribute bind the game linked its own programs with', async () => {
    // three binds location 0 to `position` on every program that has it, and
    // that bind is part of the browser's program cache key: a warm-up that
    // links the same GLSL without it fills the cache with keys the world entry
    // never asks for (measured on an RTX 3090: 143 programs linked at the
    // reveal, the count of a cold entry, against 157 to 164 with the bind).
    const ctx = await run({ record: corpusRecord([program(1), program(2)]) });
    ctx.runFrames(2);
    expect(ctx.gl.linked.map((entry) => entry.index0Attribute)).toEqual(['position', 'position']);
  });

  it('binds nothing for a program recorded without an attribute at location 0', async () => {
    const unbound = { vertex: 'void v(){}', fragment: 'void f(){}', index0Attribute: '' };
    const ctx = await run({ record: corpusRecord([unbound]) });
    ctx.runFrames(1);
    expect(ctx.gl.linked).toEqual([unbound]);
  });

  it('resolves a completed link with a LINK_STATUS read, and not before', async () => {
    // The completion query answers without resolving the link, and an
    // unresolved link never reaches the browser's cache.
    const ctx = await run({ record: corpusRecord([program(1), program(2)]) });
    ctx.runFrames(2);
    expect(ctx.gl.linkStatusReads).toBe(0);
    // The fake completes on the second poll: one round leaves both pending.
    ctx.runFrames(1);
    expect(ctx.gl.linkStatusReads).toBe(0);
    ctx.runFrames(1);
    expect(shaderWarmupStats().resolved).toBe(2);
    expect(ctx.gl.linkStatusReads).toBe(2);
  });

  it('skips a corpus whose extension set the warm-up context cannot reproduce', async () => {
    // The world context enabled one name this context refuses: every shader
    // would translate differently, so the corpus describes keys this session
    // will not ask for. The reason names the extensions, not the identity the
    // same list is folded into.
    const ctx = await run({
      record: corpusRecord([program(1)], [...ENABLED, 'WEBGL_multisampled_render_to_texture']),
    });
    expect(shaderWarmupStats().skipped).toBe('extension-mismatch');
    expect(ctx.gl.linked).toHaveLength(0);
    expect(ctx.disposed()).toBe(1);
  });

  it('skips when the warm-up context refuses an extension the corpus recorded', async () => {
    const ctx = await run({
      record: corpusRecord([program(1)]),
      missingExtensions: ['EXT_color_buffer_float'],
    });
    expect(shaderWarmupStats().skipped).toBe('extension-mismatch');
    expect(ctx.gl.linked).toHaveLength(0);
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

  it('is off under the worker grammar too: ?shaderwarm=off silences both arms', async () => {
    const ctx = await run({ record: corpusRecord([program(1)]), search: '?shaderwarm=off' });
    expect(shaderWarmupStats().skipped).toBe('disabled');
    expect(ctx.contexts()).toBe(0);
    expect(ctx.storeGets()).toBe(0);
  });

  it('honours the stored Off of the Shader Warm-up option, storage unread', async () => {
    const ctx = await run({ record: corpusRecord([program(1)]), stored: 'off' });
    expect(shaderWarmupStats().skipped).toBe('disabled');
    expect(ctx.contexts()).toBe(0);
    expect(ctx.storeGets()).toBe(0);
  });

  it('warms under the stored Auto and On alike, and under a pin over a stored Off', async () => {
    for (const stored of ['auto', 'all']) {
      shaderWarmupInternalsForTest.reset();
      const ctx = await run({ record: corpusRecord([program(1)]), stored });
      ctx.runFrames(1);
      expect(shaderWarmupStats().skipped).toBeNull();
      expect(ctx.gl.linked).toEqual([program(1)]);
    }
    shaderWarmupInternalsForTest.reset();
    const pinned = await run({
      record: corpusRecord([program(1)]),
      stored: 'off',
      search: '?shaderwarm=all',
    });
    pinned.runFrames(1);
    expect(shaderWarmupStats().skipped).toBeNull();
    expect(pinned.gl.linked).toEqual([program(1)]);
  });

  it('reads the registered option and the page navigator when the host passes none', async () => {
    // src/main.ts calls startShaderWarmup() bare: the stored Off and the iOS
    // refusal must reach this arm through the registered source and the
    // navigator, not only through the test seams.
    const bare = async (record: ShaderCorpusRecord) => {
      const gl = fakeGl();
      let contexts = 0;
      const values = new Map<string, unknown>();
      values.set(shaderWarmupInternalsForTest.corpusKey, await encodeCorpus(record));
      let storeGets = 0;
      const store = {
        get: (key: string) => {
          storeGets += 1;
          return Promise.resolve(values.get(key));
        },
        set: () => Promise.resolve(),
      };
      startShaderWarmup({
        search: '',
        store,
        buildId: BUILD,
        tier: TIER,
        createContext: () => {
          contexts += 1;
          return { gl, dispose: () => {} };
        },
        scheduleFrame: () => 0,
      });
      await waitFor(() => shaderWarmupStats().skipped !== null || contexts > 0);
      return { contexts: () => contexts, storeGets: () => storeGets };
    };
    try {
      setShaderWarmStoredSettingSource(() => 'off');
      const off = await bare(corpusRecord([program(1)]));
      expect(shaderWarmupStats().skipped).toBe('disabled');
      expect(off.storeGets()).toBe(0);
      expect(off.contexts()).toBe(0);

      shaderWarmupInternalsForTest.reset();
      setShaderWarmStoredSettingSource(() => 'all');
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (iPhone)',
        platform: 'iPhone',
        maxTouchPoints: 5,
      });
      const ios = await bare(corpusRecord([program(1)]));
      expect(shaderWarmupStats().skipped).toBe('ios-webkit');
      expect(ios.storeGets()).toBe(0);
      expect(ios.contexts()).toBe(0);

      shaderWarmupInternalsForTest.reset();
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (X11; Linux)',
        platform: 'Linux',
        maxTouchPoints: 0,
      });
      const desktop = await bare(corpusRecord([program(1)]));
      expect(shaderWarmupStats().skipped).toBeNull();
      expect(desktop.contexts()).toBe(1);
    } finally {
      setShaderWarmStoredSettingSource(() => null);
      vi.unstubAllGlobals();
    }
  });

  it('is released with the page: the hidden context rides the teardown release list', async () => {
    const ctx = await run({ record: corpusRecord([program(1), program(2)]) });
    ctx.runFrames(1);
    expect(ctx.gl.lost).toBe(false);
    releaseTrackedWebGLContexts();
    expect(ctx.gl.lost).toBe(true);
    expect(shaderWarmupStats().released).toBe(true);
    // Released once: a second sweep finds nothing of it.
    releaseTrackedWebGLContexts();
    expect(ctx.disposed()).toBe(1);
  });

  it('never mints the hidden context on iOS, whatever the setting or the pin', async () => {
    // The same refusal as the worker's (shaderWarmModeFor): a second WebGL2
    // context beside the world's is a per-process ceiling risk on phone-class
    // WebKit, so nothing is read and nothing is created.
    const ctx = await run({
      record: corpusRecord([program(1)]),
      platform: 'ios',
      stored: 'all',
      search: '?shaderwarm=all',
    });
    expect(shaderWarmupStats().skipped).toBe('ios-webkit');
    expect(ctx.contexts()).toBe(0);
    expect(ctx.storeGets()).toBe(0);
    shaderWarmupInternalsForTest.reset();
    const android = await run({ record: corpusRecord([program(1)]), platform: 'android' });
    android.runFrames(1);
    expect(shaderWarmupStats().skipped).toBeNull();
    expect(android.gl.linked).toEqual([program(1)]);
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
    // Including the attribute the linked program carries at location 0, which
    // the replay has to bind again for the program key to match.
    expect(decoded?.programs).toEqual([program(1)]);
    expect(decoded?.extensions).toEqual(ENABLED);
    expect(decoded?.savedAt).toBe(42);
    expect(decoded?.contextAttributes).toEqual({ antialias: false, alpha: true });
    expect(decoded?.identity).toBe(
      shaderCorpusIdentity({ buildId: BUILD, tier: TIER, adapter: ADAPTER, extensions: ENABLED }),
    );
  });

  it('records an empty bind when the program has no attribute at location 0', async () => {
    const gl = fakeGl();
    gl.attributes = ['uv', 'position'];
    gl.attached = [
      { type: gl.VERTEX_SHADER, source: 'void vertex1(){}' },
      { type: gl.FRAGMENT_SHADER, source: 'void frag1(){}' },
    ];
    const values = new Map<string, unknown>();
    await recordShaderCorpus(renderer(gl, [{ program: {} }]), {
      store: createMemoryStore(values),
      buildId: BUILD,
      tier: TIER,
    });
    const decoded = await decodeCorpus(values.get(shaderWarmupInternalsForTest.corpusKey));
    expect(decoded?.programs[0]?.index0Attribute).toBe('uv');
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

  it('records nothing on a host whose next boot would never replay it', async () => {
    // Recording walks every program's source on the main thread and writes a
    // few MB to IndexedDB. Under a stored Off, and on iOS, the replay side
    // skips before it reads any of that, so the record side asks the same two
    // questions first and pays neither cost.
    const gl = fakeGl();
    gl.attached = [
      { type: gl.VERTEX_SHADER, source: 'void vertex1(){}' },
      { type: gl.FRAGMENT_SHADER, source: 'void frag1(){}' },
    ];
    let contextReads = 0;
    const counted = (): ShaderCorpusRenderer => ({
      info: { programs: [{ program: {} }] },
      getContext: () => {
        contextReads += 1;
        return gl;
      },
    });
    const sets: string[] = [];
    const store = {
      get: () => Promise.resolve(undefined),
      set: (key: string) => {
        sets.push(key);
        return Promise.resolve();
      },
    };
    const common = { store, search: '', buildId: BUILD, tier: TIER } as const;

    expect(
      await recordShaderCorpus(counted(), { ...common, stored: 'off', platform: 'other' }),
    ).toBe(0);
    expect(await recordShaderCorpus(counted(), { ...common, stored: 'all', platform: 'ios' })).toBe(
      0,
    );
    // Neither the walk nor the write happened, and the readout says nothing was
    // recorded rather than reporting a corpus.
    expect(contextReads).toBe(0);
    expect(sets).toEqual([]);
    expect(shaderWarmupStats().recorded).toBeNull();

    // Auto and On on a desktop are the arms that pay for themselves.
    for (const stored of ['auto', 'all'] as const) {
      expect(await recordShaderCorpus(counted(), { ...common, stored, platform: 'other' })).toBe(1);
    }
    expect(contextReads).toBe(2);
    expect(sets).toEqual([
      shaderWarmupInternalsForTest.corpusKey,
      shaderWarmupInternalsForTest.corpusKey,
    ]);
    expect(shaderWarmupStats().recorded).toBe(1);
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

  it('registers the stored option source before the warm-up can start', () => {
    // The corpus reads the option through the registered source at start;
    // registered later, a stored Off would read as no option, which is ON.
    const registered = mainSource.indexOf('registerShaderWarmSetting(');
    const start = mainSource.indexOf('startShaderWarmup();');
    expect(registered).toBeGreaterThan(0);
    expect(registered).toBeLessThan(start);
  });

  it('starts the warm-up on the character-select screen', () => {
    expect(mainSource).toContain("if (el === '#charselect-panel') {\n    startShaderWarmup();");
  });

  it('stops it as the first thing EVERY world entry does, online and offline', () => {
    // Both entries build the renderer through startGame; a corpus still
    // paying out one program per frame there would share the main thread
    // with the world build, which is the one thing this arm must never do.
    expect(mainSource).toMatch(
      /async function enterWorld\([^)]*\): Promise<void> \{\n {2}stopShaderWarmup\(\);/,
    );
    expect(mainSource).toMatch(
      /async function startOffline\([^)]*\): Promise<void> \{\n {2}stopShaderWarmup\(\);/,
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
    // One start, one stop per world entry, one finish: the wiring is a fixed
    // set of points, not a pattern sprayed around.
    expect(mainSource.split('startShaderWarmup();')).toHaveLength(2);
    expect(mainSource.split('stopShaderWarmup();')).toHaveLength(3);
    expect(mainSource.split('finishShaderWarmup(renderer.webgl);')).toHaveLength(2);
  });
});
