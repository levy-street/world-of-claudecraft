// The shader corpus record, as background GPU work. Each program's sources
// are read off the shader handles three keeps on its program entry
// (`vertexShader`, `fragmentShader`) with getShaderSource, plus the attribute
// walk for the location-0 bind: every one of those calls is answered inside
// the page (the browser's WebGL wrappers and the command buffer client's
// cached program tables), so the record never waits on the GPU process.
// History: the first queued version found the stages with getAttachedShaders
// and getShaderParameter(SHADER_TYPE), and that query IS a round trip: it
// waits until the GPU process has executed every command already submitted.
// On an Intel HD 530 whose renderer outran its GPU process (2026-09-26, an
// unpaced display at Low) each read unit paid that whole backlog, about
// 440 ms, 25 times over the record; the handle read costs about 0.1 ms per
// unit there and returns the same sources for every live program. Before
// that, the whole record ran in one idle callback: about 1.1 s of main
// thread on the HD 530. The record stays a client of the renderer's
// background GPU queue (src/render/CLAUDE.md, "GPU work: every new producer
// is a client of the scheduler"): one unit per BATCH of program reads, one
// per JSON chunk encoded, one per chunk fed to the gzip stream, each at the
// BACKGROUND priority under its own label kind, so the budget prices each
// kind on this machine and admits what the frame can carry, behind every
// live gate.
// The bytes stored are exactly the ones the single-shot record produced: the
// same programs in the same order and the same JSON text (pinned byte for
// byte against the single-shot encoder in Node; the gzip stream is the
// compressor's output over those same bytes).
//
// Host-agnostic: the queue is injected (a frame-paced fallback stands in for
// a host with no renderer, and for tests); no DOM, no three.

import { GPU_WORK_PRIORITY } from '../render/background_gpu_queue';
import type { ShaderCorpusRecord, ShaderProgramSources } from '../render/shader_warmup_core';
import type { CorpusGl, StoredCorpus } from './shader_cache_warmup';

/** The queue surface the record needs: the renderer's background GPU queue
 *  (the shape the preview's touch lane also takes). */
export interface CorpusRecordQueue {
  run<T>(
    work: () => T | Promise<T>,
    priority?: number,
    label?: string,
    options?: { releaseTail?: boolean },
  ): Promise<T>;
}

/** Cosmetic, deferred work: below every prewarm debt and every live gate. */
export const CORPUS_RECORD_PRIORITY = GPU_WORK_PRIORITY.BACKGROUND;
/** Programs read per queue unit. No read waits on the GPU process, so the
 *  batch only bounds how many units the record takes. */
export const CORPUS_READ_BATCH = 8;
/** Three label KINDS (the part before the colon), so the budget prices a
 *  source read, a JSON encode and a gzip feed separately; the instance
 *  after the colon names the read batch or the chunk, so the queue's
 *  slowest-unit readouts say which one cost the frame. */
export const CORPUS_READ_KIND = 'corpus-read';
export const CORPUS_ENCODE_KIND = 'corpus-encode';
export const CORPUS_GZIP_KIND = 'corpus-gzip';

/** A queue for a host with no renderer: runs the unit, then resolves on the
 *  next frame `scheduleFrame` provides, so a record still spreads one unit
 *  per frame instead of running whole. */
export function frameFallbackQueue(
  scheduleFrame: (callback: () => void) => unknown,
): CorpusRecordQueue {
  return {
    run: async <T>(work: () => T | Promise<T>): Promise<T> => {
      const result = await work();
      await new Promise<void>((resolve) => {
        scheduleFrame(() => resolve());
      });
      return result;
    },
  };
}

/** The attribute the linked program carries at location 0. three binds
 *  `position` there on every program that has it, and that bind is part of the
 *  program cache key, so the replay has to make the same one. */
function index0AttributeOf(gl: CorpusGl, program: WebGLProgram): string {
  const count = Number(gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) ?? 0);
  for (let i = 0; i < count; i++) {
    const attribute = gl.getActiveAttrib(program, i);
    if (attribute && gl.getAttribLocation(program, attribute.name) === 0) return attribute.name;
  }
  return '';
}

/** What `programSourcesOfEntry` reads off one of three's program entries
 *  (`renderer.info.programs`, three's WebGLProgram wrapper). */
interface ProgramEntryHandles {
  program?: unknown;
  vertexShader?: unknown;
  fragmentShader?: unknown;
}

/** One program's sources off three's own shader handles, or null for an entry
 *  with no linked program, a missing handle, or an empty stage. */
export function programSourcesOfEntry(gl: CorpusGl, entry: unknown): ShaderProgramSources | null {
  const handles = entry as ProgramEntryHandles | null;
  // The walk spans frames; a material disposed meanwhile has had its wrapper's
  // `.program` nulled by three's destroy() right after deleteProgram, and its
  // shaders may have been freed with it, so this check comes before any source
  // read (no isProgram query: that one waits on the GPU process).
  if (!handles?.program || !handles.vertexShader || !handles.fragmentShader) return null;
  const vertex = gl.getShaderSource(handles.vertexShader as WebGLShader) ?? '';
  const fragment = gl.getShaderSource(handles.fragmentShader as WebGLShader) ?? '';
  if (!vertex || !fragment) return null;
  return {
    vertex,
    fragment,
    index0Attribute: index0AttributeOf(gl, handles.program as WebGLProgram),
  };
}

function contextLost(gl: CorpusGl): boolean {
  const probe = (gl as { isContextLost?: () => boolean }).isContextLost;
  return typeof probe === 'function' && probe.call(gl) === true;
}

/** Every program's sources, in entry order, one queue unit per batch of
 *  CORPUS_READ_BATCH entries. The entry list is snapshotted first: three
 *  swap-removes from its live `programs` array when a material is disposed,
 *  which would move an unvisited entry into a slot the cursor already passed.
 *  A context lost mid-walk ends the walk with what was read (the caller
 *  refuses to store such a record). */
export async function readProgramSourcesQueued(
  gl: CorpusGl,
  entries: readonly unknown[],
  queue: CorpusRecordQueue,
): Promise<ShaderProgramSources[]> {
  const snapshot = [...entries];
  const sources: ShaderProgramSources[] = [];
  for (let start = 0, batch = 0; start < snapshot.length; start += CORPUS_READ_BATCH, batch++) {
    if (contextLost(gl)) break;
    const end = Math.min(snapshot.length, start + CORPUS_READ_BATCH);
    const read = await queue.run(
      () => {
        const batchSources: ShaderProgramSources[] = [];
        for (let i = start; i < end; i++) {
          const one = programSourcesOfEntry(gl, snapshot[i]);
          if (one) batchSources.push(one);
        }
        return batchSources;
      },
      CORPUS_RECORD_PRIORITY,
      `${CORPUS_READ_KIND}:${batch}`,
    );
    sources.push(...read);
  }
  return sources;
}

/** Whether the context the walk read from is gone: a record read off a lost
 *  context is partial at best and must not replace a stored one. */
export function recordContextLost(gl: CorpusGl): boolean {
  return contextLost(gl);
}

/** The record's JSON as `programs.length + 2` chunks whose concatenation is
 *  JSON.stringify(record): the envelope up to and including the programs
 *  array's opening bracket, then each program (comma-separated), then the
 *  closing. The programs key is the record's last key
 *  (createShaderCorpusRecord), which is what makes the split a plain string
 *  cut; a record shaped otherwise is emitted whole as its single chunk. */
export function corpusJsonChunkCount(record: ShaderCorpusRecord): number {
  return envelopeCut(record) < 0 ? 1 : record.programs.length + 2;
}

function envelopeCut(record: ShaderCorpusRecord): number {
  const envelope = JSON.stringify({ ...record, programs: [] });
  const cut = envelope.lastIndexOf('[]}');
  return cut >= 0 && cut + 3 === envelope.length ? cut : -1;
}

/** Chunk `index` of the record's JSON, computed on its own so a unit
 *  stringifies one program, never the corpus. */
export function corpusJsonChunk(record: ShaderCorpusRecord, index: number): string {
  const cut = envelopeCut(record);
  if (cut < 0) return JSON.stringify(record);
  if (index === 0) return JSON.stringify({ ...record, programs: [] }).slice(0, cut + 1);
  const programIndex = index - 1;
  if (programIndex < record.programs.length) {
    return (programIndex > 0 ? ',' : '') + JSON.stringify(record.programs[programIndex]);
  }
  return ']}';
}

/** Every chunk at once: the reference the byte-identity tests compare the
 *  queued encoder against. */
export function corpusJsonChunks(record: ShaderCorpusRecord): string[] {
  const count = corpusJsonChunkCount(record);
  const chunks: string[] = [];
  for (let i = 0; i < count; i++) chunks.push(corpusJsonChunk(record, i));
  return chunks;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** encodeCorpus(record), as queue units: each unit stringifies and encodes
 *  one chunk and, where the platform has CompressionStream, writes it into
 *  the gzip stream and waits for the compressor to take it. That wait is
 *  NOT released: Chromium deflates the chunk synchronously on the main
 *  thread inside the stream's transform, after write() has returned its
 *  promise, so the deflate is the costliest part of the unit and belongs in
 *  its held window where the budget prices it and no other lane runs next
 *  to it. Raw bytes with the flag down on a platform without
 *  CompressionStream. A unit that rejects (the queue shut down under a
 *  renderer rebuild) aborts the writer so no stream is left locked. */
export async function encodeCorpusQueued(
  record: ShaderCorpusRecord,
  queue: CorpusRecordQueue,
): Promise<StoredCorpus> {
  const count = corpusJsonChunkCount(record);
  const encoder = new TextEncoder();
  if (typeof CompressionStream === 'undefined') {
    const parts: Uint8Array[] = [];
    for (let i = 0; i < count; i++) {
      parts.push(
        await queue.run(
          () => encoder.encode(corpusJsonChunk(record, i)),
          CORPUS_RECORD_PRIORITY,
          `${CORPUS_ENCODE_KIND}:${i}`,
        ),
      );
    }
    return { gzip: false, bytes: concatBytes(parts) };
  }
  const compressor = new CompressionStream('gzip');
  const writer = compressor.writable.getWriter();
  const collected = new Response(compressor.readable).arrayBuffer();
  // An aborted writer rejects the collector too; the throw below is the one report.
  collected.catch(() => {});
  try {
    for (let i = 0; i < count; i++) {
      await queue.run(
        () => writer.write(encoder.encode(corpusJsonChunk(record, i)) as BufferSource),
        CORPUS_RECORD_PRIORITY,
        `${CORPUS_GZIP_KIND}:${i}`,
      );
    }
  } catch (error) {
    await writer.abort(error).catch(() => {});
    throw error;
  }
  await writer.close();
  return { gzip: true, bytes: new Uint8Array(await collected) };
}
