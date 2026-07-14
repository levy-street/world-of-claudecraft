import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// scripts/convert_item_icons_webp.mjs is the pre-commit tool that turns hand-authored item art
// into the committed 128px WebP (npm run assets:items). It DELETES the source after a
// successful encode and no lossless original is kept, so its refusal path is the one branch
// whose failure mode is unrecoverable data loss: two foreign sources sharing a basename
// (foo.png + foo.jpg) both map to foo.webp, and a naive run would overwrite the first encode
// and unlink BOTH originals. It must refuse the whole batch before touching disk.
//
// The script resolves public/ui/items from process.cwd(), so each case runs it in a temp cwd.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'scripts/convert_item_icons_webp.mjs');

// A tiny valid PNG (1x1) and JPEG, so sharp has something real to decode.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/2gAMAwEAAhEDEQA/AP7+KKKKAP/Z',
  'base64',
);

let cwd = '';
const makeCase = (files: Record<string, Buffer>): string => {
  cwd = mkdtempSync(path.join(tmpdir(), 'woc-item-icons-'));
  const items = path.join(cwd, 'public/ui/items');
  mkdirSync(items, { recursive: true });
  for (const [name, buf] of Object.entries(files)) writeFileSync(path.join(items, name), buf);
  return items;
};
const run = (): { status: number | null; stderr: string } => {
  const r = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr };
};

afterEach(() => {
  if (cwd) rmSync(cwd, { recursive: true, force: true });
  cwd = '';
});

describe('convert_item_icons_webp', () => {
  it('refuses the whole batch on a destination collision, destroying nothing', () => {
    const items = makeCase({ 'linen_pouch.png': PNG_1X1, 'linen_pouch.jpg': JPEG_1X1 });

    const { status, stderr } = run();

    expect(status, 'a colliding batch must exit non-zero').toBe(1);
    expect(stderr).toContain('multiple sources map to the same .webp');
    // The point of the refusal: BOTH originals survive and nothing was encoded, so the art is
    // still recoverable. (A converted-then-clobbered run would leave one .webp and no sources.)
    expect(existsSync(path.join(items, 'linen_pouch.png'))).toBe(true);
    expect(existsSync(path.join(items, 'linen_pouch.jpg'))).toBe(true);
    expect(existsSync(path.join(items, 'linen_pouch.webp'))).toBe(false);
  });

  it('encodes a source to webp and deletes the original', () => {
    const items = makeCase({ 'linen_pouch.png': PNG_1X1 });

    expect(run().status).toBe(0);

    expect(readdirSync(items)).toEqual(['linen_pouch.webp']);
  });

  it('is a no-op over an already-webp tree (safe to re-run)', () => {
    const items = makeCase({});
    // A committed .webp must never be re-encoded (generation loss) or deleted.
    writeFileSync(path.join(items, 'linen_pouch.webp'), Buffer.from('RIFF____WEBPVP8 '));

    expect(run().status).toBe(0);

    expect(readdirSync(items)).toEqual(['linen_pouch.webp']);
  });
});
