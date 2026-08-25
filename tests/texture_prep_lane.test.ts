// The gate's upload lane: one budgeted queue unit per cold texture, sequential,
// at the touch lane's priority, and the settle order a gate composes out of it
// (link, then upload:*, then touch:*).
//
// The pins that matter are the ones no behaviour test upstream can see: a lane
// that batches its uploads is unbudgetable again, a lane that rides above the
// link submissions starves them, and a lane whose pieces land AFTER the touch
// tail is simply measured by it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { runLinkedProgramTouchLane } from '../src/render/linked_program_touch_lane';
import {
  PREVIEW_TEXTURE_PREP_LABEL,
  runTexturePrepLane,
  TEXTURE_PREP_LABEL,
  type TexturePrepQueue,
  texturePieceLabel,
  texturePieceSizeClass,
  texturePrepPriority,
} from '../src/render/texture_prep_lane';

interface Unit {
  label?: string;
  priority?: number;
}

interface Harness {
  queue: TexturePrepQueue;
  units: Unit[];
  order: string[];
  host: { initTexture: (texture: { name: string }) => void };
}

/** A queue that records every unit and runs it on a microtask, so a lane that
 *  failed to await its pieces would interleave them visibly. */
function harness(): Harness {
  const units: Unit[] = [];
  const order: string[] = [];
  return {
    units,
    order,
    host: { initTexture: (texture) => order.push(`upload:${texture.name}`) },
    queue: {
      run: async <T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T> => {
        units.push({ label, priority });
        order.push(`start:${label}`);
        const result = await work();
        order.push(`end:${label}`);
        return result;
      },
    },
  };
}

const texture = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  isTexture: true,
  name,
  version: 1,
  image: {},
  ...extra,
});

// biome-ignore lint/suspicious/noExplicitAny: the lane is typed against three; the stubs are structural.
const anyRoot = (materials: unknown[]): any => ({
  traverse: (cb: (o: unknown) => void) => {
    for (const material of materials) cb({ material });
  },
});

// biome-ignore lint/suspicious/noExplicitAny: same reason as anyRoot.
const anyProps = (records: Map<object, unknown>): any => ({
  get: (key: object) => records.get(key),
});

describe('texturePrepPriority', () => {
  it('keeps an actionable gate on the actionable floor', () => {
    expect(texturePrepPriority(GPU_WORK_PRIORITY.ACTIONABLE_VIEW)).toBe(
      GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
    );
  });

  it.each([
    ['a live view', GPU_WORK_PRIORITY.LIVE_VIEW],
    ['a reveal compile', GPU_WORK_PRIORITY.VISIBLE_PREWARM],
    ['a background warmer', GPU_WORK_PRIORITY.BACKGROUND],
  ])('drops %s to TAIL_PIECE, below every link submission', (_name, priority) => {
    expect(texturePrepPriority(priority)).toBe(GPU_WORK_PRIORITY.TAIL_PIECE);
  });
});

describe('runTexturePrepLane', () => {
  it('issues one unit per cold texture, sequentially, and skips the resident ones', async () => {
    const { queue, units, order, host } = harness();
    const cold = texture('cold');
    const alsoCold = texture('alsoCold');
    const warm = texture('warm', { version: 7 });
    const records = new Map<object, unknown>([[warm, { __webglTexture: {}, __version: 7 }]]);

    const count = await runTexturePrepLane(
      queue,
      anyProps(records),
      host,
      anyRoot([{ map: cold, normalMap: warm, emissiveMap: alsoCold }]),
      GPU_WORK_PRIORITY.LIVE_VIEW,
    );

    expect(count).toBe(2);
    expect(order).toEqual([
      'start:upload:texture:cold:unsizedu',
      'upload:cold',
      'end:upload:texture:cold:unsizedu',
      'start:upload:texture:alsoCold:unsizedu',
      'upload:alsoCold',
      'end:upload:texture:alsoCold:unsizedu',
    ]);
    expect(units).toEqual([
      { label: 'upload:texture:cold:unsizedu', priority: GPU_WORK_PRIORITY.TAIL_PIECE },
      { label: 'upload:texture:alsoCold:unsizedu', priority: GPU_WORK_PRIORITY.TAIL_PIECE },
    ]);
  });

  it('uploads nothing, and queues nothing, when every texture is resident', async () => {
    const { queue, units, host } = harness();
    const warm = texture('warm');
    const records = new Map<object, unknown>([[warm, { __webglTexture: {}, __version: 1 }]]);

    const count = await runTexturePrepLane(
      queue,
      anyProps(records),
      host,
      anyRoot([{ map: warm }]),
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
    );

    expect(count).toBe(0);
    expect(units).toEqual([]);
  });

  it('carries the actionable floor onto the pieces', async () => {
    const { queue, units, host } = harness();

    await runTexturePrepLane(
      queue,
      anyProps(new Map()),
      host,
      anyRoot([{ map: texture('portrait') }]),
      GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
      { label: PREVIEW_TEXTURE_PREP_LABEL },
    );

    expect(units).toEqual([
      {
        label: `${PREVIEW_TEXTURE_PREP_LABEL}:portrait:unsizedu`,
        priority: GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
      },
    ]);
  });

  it('skips a texture the renderer already has in flight, so the two paths cannot race', async () => {
    const { queue, units, host } = harness();
    const inFlight = texture('sky-dome');

    const count = await runTexturePrepLane(
      queue,
      anyProps(new Map()),
      host,
      anyRoot([{ map: inFlight }]),
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      // biome-ignore lint/suspicious/noExplicitAny: the real one is a WeakMap of three textures.
      { inFlight: { has: (t: any) => t === inFlight } },
    );

    expect(count).toBe(0);
    expect(units).toEqual([]);
  });

  it('sub-chunks a DataTexture into one unit per row batch, the only shape three exposes', async () => {
    const { queue, units, order, host } = harness();
    const ranges: { start: number; count: number }[] = [];
    const data = {
      ...texture('bones'),
      isDataTexture: true,
      updateRanges: ranges,
      clearUpdateRanges: () => ranges.splice(0, ranges.length),
      addUpdateRange: (start: number, count: number) => ranges.push({ start, count }),
      needsUpdate: false,
      // 256 rows of 1024 RGBA bytes: a 4096-byte row, so the 512 KB chunk
      // budget takes 128 rows at a time and the upload is two units.
      image: { data: new Uint8Array(1024 * 256 * 4), width: 1024, height: 256 },
    };

    const count = await runTexturePrepLane(
      queue,
      anyProps(new Map()),
      host,
      anyRoot([{ map: data }]),
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      { label: TEXTURE_PREP_LABEL },
    );

    expect(count).toBe(1);
    expect(units).toEqual([
      { label: 'upload-mid:texture:bones:1024x256u', priority: GPU_WORK_PRIORITY.TAIL_PIECE },
      { label: 'upload-mid:texture:bones:1024x256u', priority: GPU_WORK_PRIORITY.TAIL_PIECE },
    ]);
    expect(order.filter((entry) => entry === 'upload:bones')).toHaveLength(2);
  });

  it('settles a gate in the order link, upload:*, touch:*', async () => {
    const { queue, order, host } = harness();
    const material = { map: texture('atlas') };
    // currentProgram is what the settled compile resolved to, and the only
    // thing that proves a program linked to the touch lane: it never asks the
    // driver (src/render/linked_program_readiness.ts).
    const variant = { getUniforms: () => {}, getAttributes: () => {} };
    const programs = new Map([['variant0', variant]]);
    const records = new Map<object, unknown>([[material, { programs, currentProgram: variant }]]);
    // One root both lanes read: the texture walk reaches `material.map`, the
    // program walk reaches the same material's linked variants.
    const root = anyRoot([]);
    root.traverse = (cb: (o: unknown) => void): void => cb({ isMesh: true, material });

    order.push('link');
    await runTexturePrepLane(
      queue,
      anyProps(records),
      host,
      root,
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
    );
    await runLinkedProgramTouchLane(
      queue,
      anyProps(records),
      root,
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
    );

    expect(order.filter((entry) => !entry.startsWith('end:'))).toEqual([
      'link',
      'start:upload:texture:atlas:unsizedu',
      'upload:atlas',
      'start:touch:program',
    ]);
  });
});

describe('texturePieceLabel', () => {
  it('keeps the budget kind first and names the texture, its size and its source class', () => {
    const named = {
      name: 'skin_atlas',
      uuid: 'abcdef12-3456',
      image: { width: 2048, height: 1024 },
    };
    const compressed = { ...named, isCompressedTexture: true };
    const anonymous = { name: '', uuid: 'abcdef12-3456', image: null };
    // biome-ignore lint/suspicious/noExplicitAny: structural stubs against three's Texture.
    const label = (t: unknown): string => texturePieceLabel(TEXTURE_PREP_LABEL, t as any);
    expect(label(named)).toBe('upload-big:texture:skin_atlas:2048x1024u');
    expect(label(compressed)).toBe('upload-big:texture:skin_atlas:2048x1024c');
    expect(label(anonymous)).toBe('upload:texture:abcdef12:unsizedu');
    expect(label(named).split(':')[0]).toBe('upload-big');
  });

  it.each([
    ['128x128', 128, 128, ''],
    ['511x512', 511, 512, ''],
    ['512x512', 512, 512, '-mid'],
    ['1024x256 (bone table, 512x512 texels)', 1024, 256, '-mid'],
    ['1023x1024', 1023, 1024, '-mid'],
    ['1024x1024', 1024, 1024, '-big'],
    ['4096x4096', 4096, 4096, '-big'],
  ])('sizes %s into its own cost class', (_name, width, height, expected) => {
    // biome-ignore lint/suspicious/noExplicitAny: structural stub against three's Texture.
    expect(texturePieceSizeClass({ image: { width, height } } as any)).toBe(expected);
    const label = texturePieceLabel(TEXTURE_PREP_LABEL, {
      name: 't',
      uuid: 'x',
      image: { width, height },
      // biome-ignore lint/suspicious/noExplicitAny: same reason.
    } as any);
    expect(label.startsWith(`upload${expected}:texture:t:`)).toBe(true);
  });
});

describe('the gates that run the lane (source pins)', () => {
  const read = (path: string): string =>
    readFileSync(new URL(path, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('Renderer.compileGate runs the uploads between the link and the touch tail', () => {
    const source = read('../src/render/renderer.ts');
    const start = source.indexOf('private compileGate(');
    const end = source.indexOf('private recoverRejectedCompileGate(', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const gate = source.slice(start, end);
    const linkAt = gate.indexOf('this.liveCompileGates.runPieces(');
    const uploadAt = gate.indexOf(
      '.then((gate) => this.uploadGateTexturesGated(target, priority).then(() => gate))',
    );
    const touchAt = gate.indexOf(
      '.then((gate) => this.touchLinkedProgramsGated(target, priority, gate))',
    );
    expect(linkAt).toBeGreaterThan(-1);
    expect(uploadAt).toBeGreaterThan(linkAt);
    expect(touchAt).toBeGreaterThan(uploadAt);
    // The lane rides the one arbiter and reads the one in-flight map, or the
    // renderer's chunked sky uploads and these pieces race on a texture.
    expect(gate).toContain('runTexturePrepLane(this.backgroundGpuWork, properties, this.webgl,');
    expect(gate).toContain('inFlight: this.textureUploadTasks,');
  });

  it('the reveal compile host calls deps.upload between deps.gate and deps.touch', () => {
    // Upload and touch ride the SAME priority the link did (imminent or not),
    // so an imminent key's tail cannot fall behind the lane its link overtook.
    const host = read('../src/render/reveal_compile_host.ts');
    const gateAt = host.indexOf('const linked = deps.gate(');
    const uploadAt = host.indexOf(
      '.then((gate) => deps.upload(target, priority).then(() => gate))',
    );
    const touchAt = host.indexOf('.then((gate) => deps.touch(target, priority, gate))');
    expect(gateAt).toBeGreaterThan(-1);
    expect(uploadAt).toBeGreaterThan(gateAt);
    expect(touchAt).toBeGreaterThan(uploadAt);
  });

  it('hands the host exactly the two upload call sites, and nothing else', () => {
    const lane = read('../src/render/texture_prep_lane.ts');
    // The positive half: the chunk path and the whole-texture path, no third
    // way in. Without it the negatives below say nothing, since a lane that
    // uploaded nothing at all would satisfy every one of them.
    expect(lane.split('host.initTexture(').length - 1).toBe(2);
    expect(lane).toContain('uploadChunk: (chunk) => queue.run(() => host.initTexture(chunk)');
    expect(lane).toContain('await queue.run(() => host.initTexture(texture), priority, label);');
  });

  it('never wraps the uploads in the colour-target dance, and never re-arms needsUpdate', () => {
    const lane = read('../src/render/texture_prep_lane.ts');
    // Each negative carries the control that proves the token is what a scan
    // of this shape finds: a live user of it elsewhere in the tree.
    // initTexture dispatches on the texture's own flags and unbinds itself, so
    // there is no bound target to restore.
    expect(read('../src/render/renderer.ts')).toContain('setRenderTarget');
    expect(lane).not.toContain('setRenderTarget');
    // A KTX2 texture whose CPU mips were released comes back black if anything
    // forces a re-upload.
    expect(read('../src/render/texture_upload.ts')).toContain('needsUpdate');
    expect(lane).not.toContain('needsUpdate');
    // Uploads are main-thread driver work with no off-thread arm to release to.
    expect(read('../src/render/preview_prewarm_lane.ts')).toContain('releaseTail');
    expect(lane).not.toContain('releaseTail');
  });
});
