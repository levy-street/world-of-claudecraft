// bitmap_sheet_release.ts: an ImageBitmap-backed sheet frees its decoded
// pixels once three uploaded it, and never hands three a closed bitmap. A
// released sheet holds a full-shape stub that uploads as allocated storage
// with nothing written, and it is decoded again before a deliberate upload
// or right after an accidental one (a restored WebGL context).
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  armBitmapSheetRelease,
  bitmapSheetReleased,
  restoreBitmapSheet,
} from '../src/render/assets/bitmap_sheet_release';

function bitmap(width = 8, height = 4) {
  const image = { width, height, close: vi.fn() };
  image.close.mockImplementation(() => {
    image.width = 0;
    image.height = 0;
  });
  return image;
}

function sheet() {
  const first = bitmap();
  const texture = new THREE.Texture(first as unknown as ImageBitmap);
  texture.flipY = false;
  texture.needsUpdate = true;
  const decoded: ReturnType<typeof bitmap>[] = [];
  const decode = vi.fn(async () => {
    const image = bitmap();
    decoded.push(image);
    const fresh = new THREE.Texture(image as unknown as ImageBitmap);
    fresh.flipY = false;
    return fresh;
  });
  armBitmapSheetRelease(texture, decode);
  /** What three does once an upload completed. */
  const uploaded = () => texture.onUpdate?.(texture);
  return { texture, first, decode, decoded, uploaded };
}

describe('a released bitmap sheet', () => {
  it('closes its bitmap after the upload and keeps a full-shape stub that writes nothing', () => {
    const s = sheet();
    expect(bitmapSheetReleased(s.texture)).toBe(false);
    s.uploaded();
    expect(s.first.close).toHaveBeenCalledTimes(1);
    expect(s.texture.image).not.toBe(s.first);
    expect(s.texture.image).toMatchObject({ width: 8, height: 4 });
    expect(s.texture.source.dataReady).toBe(false);
    expect(bitmapSheetReleased(s.texture)).toBe(true);
  });

  it('decodes again before a deliberate upload, with its pixels written and a new version', async () => {
    const s = sheet();
    s.uploaded();
    const version = s.texture.version;
    await restoreBitmapSheet(s.texture);
    expect(s.decode).toHaveBeenCalledTimes(1);
    expect(s.texture.image).toBe(s.decoded[0]);
    expect(s.texture.source.dataReady).toBe(true);
    expect(s.texture.flipY).toBe(false);
    expect(s.texture.version).toBeGreaterThan(version);
    // Released again after that upload, so the pixels never stay pinned.
    s.uploaded();
    expect(s.decoded[0].close).toHaveBeenCalledTimes(1);
    expect(bitmapSheetReleased(s.texture)).toBe(true);
  });

  it('starts its own restore when a stub was uploaded (a restored context)', async () => {
    const s = sheet();
    s.uploaded();
    s.uploaded();
    await vi.waitFor(() => expect(s.texture.image).toBe(s.decoded[0]));
    expect(s.texture.source.dataReady).toBe(true);
  });

  it('decodes once for concurrent restores, and not at all while it holds its pixels', async () => {
    const s = sheet();
    await restoreBitmapSheet(s.texture);
    expect(s.decode).not.toHaveBeenCalled();
    s.uploaded();
    await Promise.all([restoreBitmapSheet(s.texture), restoreBitmapSheet(s.texture)]);
    expect(s.decode).toHaveBeenCalledTimes(1);
  });

  it('takes the image path back when the new decode falls back to it', async () => {
    const s = sheet();
    s.uploaded();
    const image = { width: 8, height: 4 };
    s.decode.mockImplementationOnce(async () => new THREE.Texture(image as never));
    await restoreBitmapSheet(s.texture);
    expect(s.texture.image).toBe(image);
    expect(s.texture.flipY).toBe(true);
    expect(s.texture.onUpdate).toBeNull();
  });

  it('leaves a texture with no bitmap alone', () => {
    const texture = new THREE.Texture({ width: 8, height: 4 } as never);
    armBitmapSheetRelease(texture, vi.fn());
    expect(texture.onUpdate).toBeNull();
  });
});
