import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  importWallTexture,
  WALL_TEXTURE_MAX_INPUT_BYTES,
  WALL_TEXTURE_MAX_INPUT_PIXELS,
  WALL_TEXTURE_MAX_INPUT_SIDE,
  WALL_TEXTURE_MAX_OUTPUT_BYTES,
  WALL_TEXTURE_OUTPUT_SIDE,
  wallTextureImageHeader,
} from '../src/editor/wall_texture_import';
import { loadGroundTextureBytes, storeGroundTexture } from '../src/render/assets/ground_textures';

vi.mock('../src/render/assets/ground_textures', () => ({
  storeGroundTexture: vi.fn(),
  loadGroundTextureBytes: vi.fn(),
}));

function png(width = 2048, height = 1024): ArrayBuffer {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  view.setUint32(12, 0x49484452);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes.buffer;
}

function webp(width: number, height: number): ArrayBuffer {
  const bytes = new ArrayBuffer(30);
  const view = new DataView(bytes);
  view.setUint32(0, 0x52494646);
  view.setUint32(4, 22, true);
  view.setUint32(8, 0x57454250);
  view.setUint32(12, 0x56503858);
  view.setUint32(16, 10, true);
  for (let i = 0; i < 3; i++) {
    view.setUint8(24 + i, ((width - 1) >>> (8 * i)) & 255);
    view.setUint8(27 + i, ((height - 1) >>> (8 * i)) & 255);
  }
  return bytes;
}

const file = (bytes = png(), type = 'image/png'): File =>
  new File([bytes], 'castle stone.png', { type });
const close = vi.fn();
const drawImage = vi.fn();
const decode = vi.fn();
const encode = vi.fn();
const canvasContext = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  decode.mockResolvedValue({ width: 2048, height: 1024, close });
  encode.mockImplementation((done: (value: Blob | null) => void) =>
    done(new Blob([webp(1024, 512)], { type: 'image/webp' })),
  );
  canvasContext.mockReturnValue({ drawImage });
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: canvasContext,
      toBlob: encode,
    }),
  });
  vi.mocked(storeGroundTexture).mockResolvedValue();
  vi.mocked(loadGroundTextureBytes).mockImplementation(
    async () => vi.mocked(storeGroundTexture).mock.calls.at(-1)?.[0] ?? null,
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('wall texture image intake', () => {
  it('pins the input, decoded image and encoded image resource limits', () => {
    expect(WALL_TEXTURE_MAX_INPUT_BYTES).toBe(8388608);
    expect(WALL_TEXTURE_MAX_OUTPUT_BYTES).toBe(4194304);
    expect(WALL_TEXTURE_MAX_INPUT_SIDE).toBe(8192);
    expect(WALL_TEXTURE_MAX_INPUT_PIXELS).toBe(33554432);
    expect(WALL_TEXTURE_OUTPUT_SIDE).toBe(1024);
  });

  it('normalizes to a bounded image and confirms shared storage before returning', async () => {
    const result = await importWallTexture(file());
    expect(result).toMatchObject({
      name: 'castle stone',
      width: 1024,
      height: 512,
      mimeType: 'image/webp',
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1024, 512);
    expect(close).toHaveBeenCalledOnce();
    expect(storeGroundTexture).toHaveBeenCalledWith(
      expect.objectContaining({ sha256: result.sha256, mime: 'image/webp' }),
    );
    expect(loadGroundTextureBytes).toHaveBeenCalledWith(result.sha256);
  });

  it.each([
    [png(), 'image/svg+xml', 'type'],
    [png(), 'image/jpeg', 'type'],
    [new ArrayBuffer(32), 'image/png', 'type'],
    [png(8193, 1), 'image/png', 'dimensions'],
    [png(8192, 8192), 'image/png', 'dimensions'],
    [png(0, 1), 'image/png', 'dimensions'],
    [png(1, 0), 'image/png', 'dimensions'],
    [png(1, 8193), 'image/png', 'dimensions'],
    [png(8192, 4097), 'image/png', 'dimensions'],
  ] as const)(
    'rejects malformed or excessive input before decoding %#',
    async (bytes, mime, code) => {
      await expect(importWallTexture(file(bytes, mime))).rejects.toMatchObject({ code });
      expect(decode).not.toHaveBeenCalled();
      expect(storeGroundTexture).not.toHaveBeenCalled();
    },
  );

  it('rejects byte-heavy input before reading it', async () => {
    const large = {
      type: 'image/png',
      size: 8388609,
      arrayBuffer: vi.fn(),
    };
    await expect(importWallTexture(large as unknown as File)).rejects.toMatchObject({
      code: 'size',
    });
    expect(large.arrayBuffer).not.toHaveBeenCalled();
  });

  it('accepts the 8 MiB input-size boundary and rejects extra bytes returned by the reader', async () => {
    const boundary = {
      type: 'image/png',
      name: 'wall.png',
      size: 8388608,
      arrayBuffer: vi.fn().mockResolvedValue(png()),
    };
    await expect(importWallTexture(boundary as unknown as File)).resolves.toMatchObject({
      width: 1024,
    });
    const oversized = {
      ...boundary,
      size: 24,
      arrayBuffer: vi.fn().mockResolvedValue({ byteLength: 8388609 }),
    };
    decode.mockClear();
    await expect(importWallTexture(oversized as unknown as File)).rejects.toMatchObject({
      code: 'size',
    });
    expect(decode).not.toHaveBeenCalled();
  });

  it('accepts exactly 8192 by 4096 pixels and reduces the longest side to 1024', async () => {
    decode.mockResolvedValue({ width: 8192, height: 4096, close });
    await expect(importWallTexture(file(png(8192, 4096)))).resolves.toMatchObject({
      width: 1024,
      height: 512,
    });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1024, 512);
  });

  it('reports decode failures without persisting undecodable art', async () => {
    decode.mockRejectedValue(new Error('decoder failure'));
    await expect(importWallTexture(file())).rejects.toMatchObject({ code: 'decode' });
    expect(storeGroundTexture).not.toHaveBeenCalled();
  });

  it('closes an unexpectedly large decoded bitmap without storing it', async () => {
    decode.mockResolvedValue({ width: 9000, height: 100, close });
    await expect(importWallTexture(file())).rejects.toMatchObject({ code: 'dimensions' });
    expect(close).toHaveBeenCalledOnce();
    expect(storeGroundTexture).not.toHaveBeenCalled();
  });

  it.each([0, 8193, 1.5])(
    'rejects decoded image height %s and closes its bitmap',
    async (height) => {
      decode.mockResolvedValue({ width: 1024, height, close });
      await expect(importWallTexture(file())).rejects.toMatchObject({ code: 'dimensions' });
      expect(close).toHaveBeenCalledOnce();
      expect(encode).not.toHaveBeenCalled();
      expect(storeGroundTexture).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    new Blob([webp(1024, 512)], { type: 'image/jpeg' }),
    new Blob([new Uint8Array(8)], { type: 'image/webp' }),
    new Blob([webp(1023, 512)], { type: 'image/webp' }),
    new Blob([webp(1024, 511)], { type: 'image/webp' }),
    new Blob([png(1024, 512)], { type: 'image/webp' }),
  ])('refuses a failed or invalid encoder result %#', async (encoded) => {
    encode.mockImplementation((done: (value: Blob | null) => void) => done(encoded));
    await expect(importWallTexture(file())).rejects.toMatchObject({ code: 'encode' });
    expect(close).toHaveBeenCalledOnce();
    expect(storeGroundTexture).not.toHaveBeenCalled();
  });

  it('fails encoding cleanly when the canvas context is unavailable', async () => {
    canvasContext.mockReturnValue(null);
    await expect(importWallTexture(file())).rejects.toMatchObject({ code: 'encode' });
    expect(close).toHaveBeenCalledOnce();
    expect(encode).not.toHaveBeenCalled();
    expect(storeGroundTexture).not.toHaveBeenCalled();
  });

  it('rejects output above 4 MiB without reading or storing it', async () => {
    const oversized = { type: 'image/webp', size: 4194305, arrayBuffer: vi.fn() };
    encode.mockImplementation((done: (value: Blob) => void) => done(oversized as unknown as Blob));
    await expect(importWallTexture(file())).rejects.toMatchObject({ code: 'size' });
    expect(oversized.arrayBuffer).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(storeGroundTexture).not.toHaveBeenCalled();
  });

  it('allows PNG fallback without enlarging a small image', async () => {
    decode.mockResolvedValue({ width: 400, height: 200, close });
    encode.mockImplementation((done: (value: Blob) => void) =>
      done(new Blob([png(400, 200)], { type: 'image/png' })),
    );
    await expect(importWallTexture(file(png(400, 200)))).resolves.toMatchObject({
      width: 400,
      height: 200,
      mimeType: 'image/png',
    });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 400, 200);
  });

  it('refuses a silent IndexedDB failure and a corrupt persisted record', async () => {
    vi.mocked(loadGroundTextureBytes).mockResolvedValueOnce(null);
    await expect(importWallTexture(file())).rejects.toMatchObject({ code: 'storage' });
    vi.mocked(loadGroundTextureBytes).mockResolvedValueOnce({
      sha256: 'a'.repeat(64),
      name: '',
      mime: 'image/webp',
      bytes: new ArrayBuffer(4),
    });
    await expect(importWallTexture(file())).rejects.toMatchObject({ code: 'storage' });
  });

  it('rejects a persisted MIME mismatch even when image bytes match', async () => {
    vi.mocked(loadGroundTextureBytes).mockImplementation(async () => {
      const saved = vi.mocked(storeGroundTexture).mock.calls.at(-1)?.[0];
      return saved ? { ...saved, mime: 'image/png' } : null;
    });
    await expect(importWallTexture(file())).rejects.toMatchObject({ code: 'storage' });
  });

  it('inspects JPEG dimensions and rejects truncated marker segments', () => {
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc2, 0, 8, 8, 2, 0, 4, 0, 3,
    ]);
    expect(wallTextureImageHeader(bytes.buffer)).toEqual({
      mime: 'image/jpeg',
      width: 1024,
      height: 512,
    });
    expect(wallTextureImageHeader(bytes.slice(0, -1).buffer)).toBeNull();
    expect(wallTextureImageHeader(webp(72, 35))).toEqual({
      mime: 'image/webp',
      width: 72,
      height: 35,
    });
  });

  it('reads VP8 dimensions, masks scaling bits and rejects corrupt frame signatures', () => {
    const bytes = webp(1, 1);
    const view = new DataView(bytes);
    view.setUint32(12, 0x56503820);
    view.setUint8(23, 0x9d);
    view.setUint8(24, 1);
    view.setUint8(25, 0x2a);
    view.setUint16(26, 0xc000 | 1024, true);
    view.setUint16(28, 0x8000 | 513, true);
    expect(wallTextureImageHeader(bytes)).toEqual({ mime: 'image/webp', width: 1024, height: 513 });
    view.setUint8(25, 0);
    expect(wallTextureImageHeader(bytes)).toBeNull();
  });

  it('reads VP8L packed dimensions and rejects missing lossless signatures or truncated chunks', () => {
    const bytes = new ArrayBuffer(26);
    const view = new DataView(bytes);
    view.setUint32(0, 0x52494646);
    view.setUint32(4, 18, true);
    view.setUint32(8, 0x57454250);
    view.setUint32(12, 0x5650384c);
    view.setUint32(16, 5, true);
    view.setUint8(20, 0x2f);
    view.setUint32(21, (777 - 1) | ((333 - 1) << 14), true);
    expect(wallTextureImageHeader(bytes)).toEqual({ mime: 'image/webp', width: 777, height: 333 });
    view.setUint8(20, 0);
    expect(wallTextureImageHeader(bytes)).toBeNull();
    view.setUint8(20, 0x2f);
    view.setUint32(16, 7, true);
    expect(wallTextureImageHeader(bytes)).toBeNull();
    view.setUint32(16, 5, true);
    view.setUint32(4, 17, true);
    expect(wallTextureImageHeader(bytes)).toBeNull();
  });
});
