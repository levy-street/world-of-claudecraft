import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { convertJob } from '../scripts/assets/compress_sky_hdr.mjs';

const roots: string[] = [];

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-sky-hdr-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('compress_sky_hdr script conversion', () => {
  const job = {
    stem: 'test_sky',
    variant: '2k',
    source: 'test_sky_2k.hdr',
    target: 'test_sky_2k.ktx2',
    resample: null,
  };

  it('does not accept a stale destination when basisu exits 0 without writing output', async () => {
    const dir = makeRoot();
    const dstPath = path.join(dir, job.target);
    fs.writeFileSync(path.join(dir, job.source), 'fresh hdr source');
    fs.writeFileSync(dstPath, 'old ktx2 bytes');

    const result = await convertJob(job, {
      dir,
      dryRun: false,
      runBasisuCommand: async () => ({
        code: 0,
        stdout: 'Error: HDR encode failed\n',
        stderr: '',
      }),
    });

    expect(result).toMatchObject({
      job,
      status: 'failed',
      reason: 'Error: HDR encode failed',
    });
    expect(fs.readFileSync(dstPath, 'utf8')).toBe('old ktx2 bytes');
  });

  it('renames a freshly written temp output over the destination on success', async () => {
    const dir = makeRoot();
    const dstPath = path.join(dir, job.target);
    fs.writeFileSync(path.join(dir, job.source), 'fresh hdr source');
    fs.writeFileSync(dstPath, 'old ktx2 bytes');

    const result = await convertJob(job, {
      dir,
      dryRun: false,
      runBasisuCommand: async (args: string[]) => {
        const output = args[args.indexOf('-output_file') + 1];
        expect(output).not.toBe(dstPath);
        expect(path.dirname(path.dirname(output))).toBe(dir);
        fs.writeFileSync(output, 'new ktx2 bytes');
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    expect(result).toMatchObject({ job, status: 'converted' });
    expect(fs.readFileSync(dstPath, 'utf8')).toBe('new ktx2 bytes');
  });
});
