// The painted (LDR) sky encoder's I/O (scripts/assets/compress_sky_ldr.mjs):
// the resize and pre-process feed the staged PNG `ktx` reads, and a failed
// encode can never leave a stale or half-written file standing in for a fresh
// one. `ktx` itself is faked; the pure core is pinned in
// tests/sky_ldr_compression_core.test.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { convertJob } from '../scripts/assets/compress_sky_ldr.mjs';
import { skyLdrJobs } from '../scripts/assets/lib/sky_ldr_compression_core.mjs';

const roots: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-sky-ldr-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A small 3:2 (deliberately not 2:1) painted source: a left-to-right ramp, so
 *  its raw edges do not meet, over a top-to-bottom ramp. */
async function writeSource(dir: string, stem: string): Promise<void> {
  const width = 96;
  const height = 64;
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      rgb[i] = Math.round((255 * x) / (width - 1));
      rgb[i + 1] = Math.round((255 * y) / (height - 1));
      rgb[i + 2] = 128;
    }
  }
  await sharp(rgb, { raw: { width, height, channels: 3 } })
    .png()
    .toFile(path.join(dir, `${stem}.png`));
}

describe('compress_sky_ldr script conversion', () => {
  const job = skyLdrJobs(['vale_painted_env']).find((j) => j.variant === '512');
  if (!job) throw new Error('expected a 512 job for the painted env sky');

  it('stages the pre-processed 2:1 pixels and renames the fresh output over the destination', async () => {
    const srcDir = makeRoot();
    const outDir = makeRoot();
    await writeSource(srcDir, job.stem);
    const dstPath = path.join(outDir, job.target);
    fs.writeFileSync(dstPath, 'old ktx2 bytes');
    let staged: { width: number; height: number; seamEqual: boolean } | null = null;

    const result = await convertJob(job, {
      srcDir,
      outDir,
      dryRun: false,
      runKtxCommand: async (args: string[]) => {
        const [input, output] = args.slice(-2);
        // Both the staged input and the encoder's output live in a private
        // directory under outDir, never the destination itself.
        expect(output).not.toBe(dstPath);
        expect(path.dirname(path.dirname(output))).toBe(outDir);
        const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true });
        const row = info.width * info.channels;
        let seamEqual = true;
        for (let y = 0; y < info.height; y++) {
          for (let c = 0; c < 3; c++) {
            if (data[y * row + c] !== data[y * row + row - 3 + c]) seamEqual = false;
          }
        }
        staged = { width: info.width, height: info.height, seamEqual };
        fs.writeFileSync(output, 'new ktx2 bytes');
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    expect(result).toMatchObject({ job, status: 'converted' });
    // The 3:2 source was stretched to the exact 2:1 variant, and reported.
    expect(result.aspectError).toBeCloseTo(1.5 / 2 - 1, 12);
    expect(staged).toEqual({ width: 512, height: 256, seamEqual: true });
    expect(fs.readFileSync(dstPath, 'utf8')).toBe('new ktx2 bytes');
    // The staging directory is gone.
    expect(fs.readdirSync(outDir)).toEqual([job.target]);
  });

  it('stages the night as RGBA, its star density in alpha, and asks ktx for RGBA', async () => {
    const srcDir = makeRoot();
    const outDir = makeRoot();
    // A night job at the 512 size, so the test stays quick; the stages are the same.
    const night = {
      stem: 'vale_painted_night',
      variant: '512' as const,
      removeStars: true,
      sharpen: true,
      source: 'vale_painted_night.png',
      target: 'vale_painted_night_512.ktx2',
      width: 512,
      height: 256,
    };
    await writeSource(srcDir, night.stem);
    let staged: { channels: number; format: string } | null = null;
    const result = await convertJob(night, {
      srcDir,
      outDir,
      dryRun: false,
      runKtxCommand: async (args: string[]) => {
        const [input, output] = args.slice(-2);
        const meta = await sharp(input).metadata();
        staged = { channels: meta.channels ?? 0, format: args[args.indexOf('--format') + 1] };
        fs.writeFileSync(output, 'night bytes');
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    expect(result.status).toBe('converted');
    expect(staged).toEqual({ channels: 4, format: 'R8G8B8A8_SRGB' });
  });

  it('keeps the old destination when ktx exits 0 without writing its output', async () => {
    const srcDir = makeRoot();
    const outDir = makeRoot();
    await writeSource(srcDir, job.stem);
    const dstPath = path.join(outDir, job.target);
    fs.writeFileSync(dstPath, 'old ktx2 bytes');

    const result = await convertJob(job, {
      srcDir,
      outDir,
      dryRun: false,
      runKtxCommand: async () => ({ code: 0, stdout: '', stderr: 'ktx create fatal: bad input\n' }),
    });

    expect(result).toMatchObject({ job, status: 'failed', reason: 'ktx create fatal: bad input' });
    expect(fs.readFileSync(dstPath, 'utf8')).toBe('old ktx2 bytes');
    expect(fs.readdirSync(outDir)).toEqual([job.target]);
  });

  it('reports a missing source and writes nothing on a dry run', async () => {
    const srcDir = makeRoot();
    const outDir = makeRoot();
    const never = async (): Promise<never> => {
      throw new Error('ktx must not run');
    };
    const missing = await convertJob(job, { srcDir, outDir, dryRun: false, runKtxCommand: never });
    expect(missing).toMatchObject({ status: 'failed', reason: `missing source ${job.source}` });

    await writeSource(srcDir, job.stem);
    const dry = await convertJob(job, { srcDir, outDir, dryRun: true, runKtxCommand: never });
    expect(dry.status).toBe('would-convert');
    expect(fs.readdirSync(outDir)).toEqual([]);
  });
});
