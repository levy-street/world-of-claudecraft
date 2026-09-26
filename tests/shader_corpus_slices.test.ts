// The queued shader corpus record (shader_corpus_slices.ts): one background
// queue unit per batch of program reads, per chunk encoded and per chunk fed to
// the compressor, reads that never wait on the GPU process, and stored bytes
// identical to the single-shot record.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CorpusGl, encodeCorpus } from '../src/game/shader_cache_warmup';
import {
  CORPUS_ENCODE_KIND,
  CORPUS_GZIP_KIND,
  CORPUS_READ_BATCH,
  CORPUS_READ_KIND,
  CORPUS_RECORD_PRIORITY,
  type CorpusRecordQueue,
  corpusJsonChunk,
  corpusJsonChunkCount,
  corpusJsonChunks,
  encodeCorpusQueued,
  frameFallbackQueue,
  programSourcesOfEntry,
  readProgramSourcesQueued,
} from '../src/game/shader_corpus_slices';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import {
  createShaderCorpusRecord,
  type ShaderCorpusRecord,
  shaderCorpusIdentity,
} from '../src/render/shader_warmup_core';

interface Unit {
  priority: number;
  label: string;
  releaseTail: boolean;
}

/** A queue that runs each unit on its own microtask and records what it was asked. */
function recordingQueue(): CorpusRecordQueue & { units: Unit[] } {
  const q = {
    units: [] as Unit[],
    run: async <T>(
      work: () => T | Promise<T>,
      priority = -1,
      label = '',
      options?: { releaseTail?: boolean },
    ): Promise<T> => {
      q.units.push({ priority, label, releaseTail: options?.releaseTail === true });
      await Promise.resolve();
      return work();
    },
  };
  return q;
}

interface FakeShader {
  source: string;
  /** Freed with its program by three's destroy(): the browser refuses to read it. */
  deleted?: boolean;
}

interface FakeEntry {
  program: { id: number } | null | undefined;
  vertexShader?: FakeShader;
  fragmentShader?: FakeShader;
}

/** The calls the record may make: the browser answers them inside the page
 *  (its WebGL wrappers and the command buffer client's cached program tables).
 *  Any other GL call goes to the GPU process and waits for every command
 *  already submitted, which is what the fake refuses. */
const PAGE_SERVED = new Set([
  'getShaderSource',
  'getProgramParameter',
  'getActiveAttrib',
  'getAttribLocation',
  'isContextLost',
]);

type FakeGl = CorpusGl & { lost: boolean; calls: string[]; sourceReads: () => number };

function fakeGl(): FakeGl {
  const target = {
    lost: false,
    calls: [] as string[],
    sourceReads: () => target.calls.filter((name) => name === 'getShaderSource').length,
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    SHADER_TYPE: 4,
    ACTIVE_ATTRIBUTES: 6,
    isContextLost: () => target.lost,
    getProgramParameter: (_p: unknown, pname: number) => {
      if (pname !== target.ACTIVE_ATTRIBUTES) throw new Error(`program parameter ${pname}`);
      return 2;
    },
    getActiveAttrib: (_p: unknown, index: number) => ({ name: index === 0 ? 'uv' : 'position' }),
    getAttribLocation: (_p: unknown, name: string) => (name === 'position' ? 0 : 1),
    getShaderSource: (shader: FakeShader | undefined) => {
      if (!shader || shader.deleted) throw new Error('INVALID_VALUE: a deleted or missing shader');
      return shader.source;
    },
    // The old stage walk, answered correctly so only the guard below can fail it.
    getAttachedShaders: () => [],
    getShaderParameter: () => 1,
    getError: () => 0,
  };
  return new Proxy(target, {
    get(t, key, receiver) {
      const value = Reflect.get(t, key, receiver);
      if (typeof key !== 'string' || typeof value !== 'function' || key === 'sourceReads') {
        return value;
      }
      t.calls.push(key);
      if (!PAGE_SERVED.has(key)) throw new Error(`${key} waits on the GPU process`);
      return value;
    },
  }) as unknown as FakeGl;
}

function linkedEntries(count: number): FakeEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    program: { id: i },
    vertexShader: { source: `void v${i}(){ float a = ${i}.0; }\n"quoted" µ é\n` },
    fragmentShader: { source: `void f${i}(){ /* ${'x'.repeat(i * 3)} */ }` },
  }));
}

function record(programs: ShaderCorpusRecord['programs']): ShaderCorpusRecord {
  return createShaderCorpusRecord({
    identity: shaderCorpusIdentity({
      buildId: 'b1',
      tier: 'low',
      adapter: 'ANGLE (Intel, Intel(R) HD Graphics 530, D3D11)',
      extensions: ['EXT_color_buffer_float'],
    }),
    extensions: ['EXT_color_buffer_float'],
    savedAt: 1_700_000_000_000,
    contextAttributes: { antialias: false, alpha: true },
    sources: programs,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readProgramSourcesQueued', () => {
  it('reads every program in entry order, one BACKGROUND unit per batch', async () => {
    const gl = fakeGl();
    const q = recordingQueue();
    const sources = await readProgramSourcesQueued(gl, linkedEntries(21), q);
    expect(sources).toHaveLength(21);
    for (const [i, p] of sources.entries()) expect(p.vertex.startsWith(`void v${i}(`)).toBe(true);
    expect(sources[0].index0Attribute).toBe('position');
    expect(gl.sourceReads()).toBe(42);
    // 21 programs in batches of 8: three units, the last one short.
    expect(CORPUS_READ_BATCH).toBe(8);
    expect(q.units).toHaveLength(3);
    for (const [i, unit] of q.units.entries()) {
      expect(unit.priority).toBe(GPU_WORK_PRIORITY.BACKGROUND);
      expect(unit.label).toBe(`${CORPUS_READ_KIND}:${i}`);
      expect(unit.releaseTail).toBe(false);
    }
    expect(CORPUS_RECORD_PRIORITY).toBe(GPU_WORK_PRIORITY.BACKGROUND);
  });

  it('makes only calls the page answers, never one that waits on the GPU process', async () => {
    const gl = fakeGl();
    const sources = await readProgramSourcesQueued(gl, linkedEntries(9), recordingQueue());
    expect(sources).toHaveLength(9);
    expect(gl.calls.length).toBeGreaterThan(0);
    expect(gl.calls.filter((name) => !PAGE_SERVED.has(name))).toEqual([]);
    expect(gl.calls).not.toContain('getShaderParameter');
    expect(gl.calls).not.toContain('getAttachedShaders');
    // The refusal is live: a call outside the set throws at the caller.
    expect(() => (gl as unknown as { getError(): number }).getError()).toThrow(
      'waits on the GPU process',
    );
  });

  it('skips entries with no linked program, no attached shaders, or a missing stage', async () => {
    const gl = fakeGl();
    const [first, second] = linkedEntries(2);
    const entries: FakeEntry[] = [
      { program: null },
      first,
      second,
      { program: { id: 9 }, vertexShader: { source: 'lonely' } },
      { program: { id: 10 }, fragmentShader: { source: 'lonely' } },
      { program: { id: 11 }, vertexShader: { source: 'v' }, fragmentShader: { source: '' } },
    ];
    const sources = await readProgramSourcesQueued(gl, entries, recordingQueue());
    expect(sources.map((p) => p.vertex.slice(0, 7))).toEqual(['void v0', 'void v1']);
  });

  it('walks a snapshot, so a program removed from the live list mid-walk is still read', async () => {
    const gl = fakeGl();
    const live = linkedEntries(20);
    const q = recordingQueue();
    let removed = false;
    const swapRemoving: CorpusRecordQueue = {
      run: async (work, priority, label) => {
        if (!removed && q.units.length === 1) {
          // three's destroyProgram: the last entry moves into slot 0.
          live[0] = live[live.length - 1];
          live.pop();
          removed = true;
        }
        return q.run(work, priority, label);
      },
    };
    const sources = await readProgramSourcesQueued(gl, live, swapRemoving);
    expect(sources).toHaveLength(20);
    for (const [i, p] of sources.entries()) expect(p.vertex.startsWith(`void v${i}(`)).toBe(true);
  });

  it('stops walking once the context is lost, keeping what it read', async () => {
    const gl = fakeGl();
    const q = recordingQueue();
    const losing: CorpusRecordQueue = {
      run: async (work, priority, label) => {
        const result = await q.run(work, priority, label);
        if (q.units.length === 1) gl.lost = true;
        return result;
      },
    };
    const sources = await readProgramSourcesQueued(gl, linkedEntries(20), losing);
    expect(sources).toHaveLength(8);
    expect(gl.sourceReads()).toBe(16);
  });
});

describe('programSourcesOfEntry', () => {
  it("takes each stage from three's own handle, whatever the order they were made in", () => {
    const gl = fakeGl();
    const entry: FakeEntry = {
      program: { id: 1 },
      fragmentShader: { source: 'void fragmentMain(){}' },
      vertexShader: { source: 'void vertexMain(){}' },
    };
    expect(programSourcesOfEntry(gl, entry)).toEqual({
      vertex: 'void vertexMain(){}',
      fragment: 'void fragmentMain(){}',
      index0Attribute: 'position',
    });
  });

  it('skips a disposed entry before touching its freed shaders', () => {
    // three's destroy() deletes the program and nulls `.program` but keeps the
    // shader handles; reading one would be refused by the browser.
    const gl = fakeGl();
    const [disposed] = linkedEntries(1);
    disposed.program = undefined;
    for (const shader of [disposed.vertexShader, disposed.fragmentShader]) {
      if (shader) shader.deleted = true;
    }
    expect(programSourcesOfEntry(gl, disposed)).toBeNull();
    expect(programSourcesOfEntry(gl, null)).toBeNull();
    expect(programSourcesOfEntry(gl, { program: { id: 2 }, vertexShader: undefined })).toBeNull();
    expect(gl.sourceReads()).toBe(0);
  });
});

describe('corpusJsonChunk', () => {
  it('splits the record JSON into an envelope, one chunk per program, and the closing', () => {
    const rec = record([
      { vertex: 'v"1"\n', fragment: 'f1', index0Attribute: 'position' },
      { vertex: 'v2', fragment: 'f2 é', index0Attribute: '' },
    ]);
    expect(corpusJsonChunkCount(rec)).toBe(4);
    const chunks = corpusJsonChunks(rec);
    expect(chunks.join('')).toBe(JSON.stringify(rec));
    expect(chunks[1]).toBe(JSON.stringify(rec.programs[0]));
    expect(chunks[2]).toBe(`,${JSON.stringify(rec.programs[1])}`);
    expect(corpusJsonChunk(rec, 3)).toBe(']}');
    const empty = record([]);
    expect(corpusJsonChunks(empty).join('')).toBe(JSON.stringify(empty));
    // The cut rests on `programs` being the record's last key.
    expect(Object.keys(rec).at(-1)).toBe('programs');
  });
});

describe('encodeCorpusQueued', () => {
  it('stores byte for byte what the single-shot encoder stores, one gzip unit per chunk', async () => {
    const gl = fakeGl();
    const programs = await readProgramSourcesQueued(gl, linkedEntries(12), recordingQueue());
    const rec = record(programs);
    const single = await encodeCorpus(rec);
    const q = recordingQueue();
    const queued = await encodeCorpusQueued(rec, q);
    expect(single.gzip).toBe(true);
    expect(queued.gzip).toBe(true);
    expect(queued.bytes.byteLength).toBe(single.bytes.byteLength);
    expect(Buffer.from(queued.bytes).equals(Buffer.from(single.bytes))).toBe(true);
    expect(q.units).toHaveLength(14);
    for (const [i, unit] of q.units.entries()) {
      // The deflate runs on the main thread inside the write: the tail is held.
      expect(unit.label).toBe(`${CORPUS_GZIP_KIND}:${i}`);
      expect(unit.releaseTail).toBe(false);
    }
  });

  it('stores the raw JSON bytes, one encode unit per chunk, where the platform cannot gzip', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const rec = record([
      { vertex: 'v1 é', fragment: 'f1', index0Attribute: 'position' },
      { vertex: 'v2', fragment: 'f2', index0Attribute: '' },
    ]);
    const q = recordingQueue();
    const stored = await encodeCorpusQueued(rec, q);
    expect(stored.gzip).toBe(false);
    expect(new TextDecoder().decode(stored.bytes)).toBe(JSON.stringify(rec));
    expect(q.units.map((u) => u.label)).toEqual(
      Array.from({ length: 4 }, (_, i) => `${CORPUS_ENCODE_KIND}:${i}`),
    );
  });
});

describe('encodeCorpusQueued under a queue that shuts down', () => {
  it('aborts the compressor writer and rethrows', async () => {
    const rec = record([{ vertex: 'v1', fragment: 'f1', index0Attribute: 'position' }]);
    let units = 0;
    const closing: CorpusRecordQueue = {
      run: async (work) => {
        units++;
        if (units === 2) throw new Error('queue shut down');
        return work();
      },
    };
    await expect(encodeCorpusQueued(rec, closing)).rejects.toThrow('queue shut down');
  });
});

describe('frameFallbackQueue', () => {
  it('runs the unit and resolves on the next frame the host provides', async () => {
    const frames: (() => void)[] = [];
    const q = frameFallbackQueue((cb) => frames.push(cb));
    let done = false;
    const pending = q
      .run(() => 7)
      .then((v) => {
        done = true;
        return v;
      });
    await Promise.resolve();
    await Promise.resolve();
    expect(frames).toHaveLength(1);
    expect(done).toBe(false);
    frames[0]();
    expect(await pending).toBe(7);
    expect(done).toBe(true);
  });
});
