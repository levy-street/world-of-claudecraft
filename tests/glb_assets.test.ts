// parseGlbInfo (server/http_util.ts): the hand-rolled GLB container validator
// behind POST /api/assets, exercised on byte buffers built in this file, plus
// the UserAssetsService rules (sha256 dedupe, caps, moderation block) against
// an in-memory fake db, and the scoped upload rate-limit bucket.

import { createHash } from 'node:crypto';
import type * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  contentLengthExceeds,
  GLB_MAX_ACCESSORS,
  GLB_MAX_MESHES,
  GLB_MAX_NODES,
  MAX_GLB_JSON_BYTES,
  parseGlbInfo,
} from '../server/http_util';
import {
  ASSET_UPLOAD_MAX_PER_MINUTE,
  assetUploadRateLimited,
  resetAssetUploadRateLimits,
} from '../server/ratelimit';
import {
  MAX_ASSET_NAME_LENGTH,
  MAX_ASSET_TOTAL_BYTES,
  MAX_ASSETS_PER_ACCOUNT,
  type UserAssetRecord,
  type UserAssetsDb,
  UserAssetsService,
  userAssetJson,
  userAssetsErrorStatus,
  userAssetUrl,
} from '../server/user_assets';

// ---------------------------------------------------------------------------
// GLB builder: construct spec-shaped binary glTF buffers byte by byte.
// ---------------------------------------------------------------------------

const GLB_MAGIC = 0x46546c67;
const JSON_TYPE = 0x4e4f534a;
const BIN_TYPE = 0x004e4942;

function chunk(type: number, data: Buffer, padByte: number): Buffer {
  const padLen = (4 - (data.length % 4)) % 4;
  const padded = padLen > 0 ? Buffer.concat([data, Buffer.alloc(padLen, padByte)]) : data;
  const header = Buffer.alloc(8);
  header.writeUInt32LE(padded.length, 0);
  header.writeUInt32LE(type, 4);
  return Buffer.concat([header, padded]);
}

function glbFromChunks(chunks: Buffer[]): Buffer {
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([header, body]);
}

function glb(json: unknown, bin?: Buffer): Buffer {
  const chunks = [chunk(JSON_TYPE, Buffer.from(JSON.stringify(json)), 0x20)];
  if (bin) chunks.push(chunk(BIN_TYPE, bin, 0));
  return glbFromChunks(chunks);
}

// One triangle-less mesh over a 24-byte BIN chunk: 2 VEC3 floats.
const BIN_BYTES = 24;
function baseJson(): Record<string, unknown> {
  return {
    asset: { version: '2.0' },
    buffers: [{ byteLength: BIN_BYTES }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: BIN_BYTES }],
    accessors: [{ bufferView: 0, byteOffset: 0, componentType: 5126, count: 2, type: 'VEC3' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
  };
}
const bin = () => Buffer.alloc(BIN_BYTES);
const validGlb = () => glb(baseJson(), bin());

describe('parseGlbInfo accepts', () => {
  it('a minimal valid GLB with a BIN chunk', () => {
    const buf = validGlb();
    const info = parseGlbInfo(buf);
    expect(info).not.toBeNull();
    expect(info).toMatchObject({
      byteLength: buf.length,
      binByteLength: BIN_BYTES,
      meshCount: 1,
      nodeCount: 1,
      accessorCount: 1,
    });
  });

  it('a JSON-only GLB with no buffer data', () => {
    expect(parseGlbInfo(glb({ asset: { version: '2.0' }, meshes: [], nodes: [] }))).not.toBeNull();
  });

  it('an unpadded BIN chunk within the 3-byte padding allowance', () => {
    const json = baseJson();
    (json.buffers as { byteLength: number }[])[0].byteLength = 22;
    (json.bufferViews as { byteLength: number }[])[0].byteLength = 22;
    (json.accessors as { count: number }[])[0].count = 1; // 12 bytes fits 22
    // chunk() pads the 22-byte payload to 24, so binLength(24) - byteLength(22) = 2
    expect(parseGlbInfo(glb(json, Buffer.alloc(22)))).not.toBeNull();
  });

  it('images with data: URIs or bufferView references', () => {
    const json = baseJson();
    json.images = [{ uri: 'data:image/png;base64,AAAA' }, { bufferView: 0, mimeType: 'image/png' }];
    expect(parseGlbInfo(glb(json, bin()))).not.toBeNull();
  });

  it('a strided vertex bufferView whose accessor run fits', () => {
    const json = baseJson();
    (json.bufferViews as Record<string, number>[])[0].byteStride = 12;
    expect(parseGlbInfo(glb(json, bin()))).not.toBeNull();
  });
});

describe('parseGlbInfo rejects', () => {
  it('a bad magic word', () => {
    const buf = validGlb();
    buf.writeUInt32LE(0xdeadbeef, 0);
    expect(parseGlbInfo(buf)).toBeNull();
  });

  it('container version 1', () => {
    const buf = validGlb();
    buf.writeUInt32LE(1, 4);
    expect(parseGlbInfo(buf)).toBeNull();
  });

  it('a truncated buffer and a lying declared length', () => {
    const buf = validGlb();
    expect(parseGlbInfo(buf.subarray(0, buf.length - 4))).toBeNull();
    const lying = validGlb();
    lying.writeUInt32LE(lying.length - 4, 8);
    expect(parseGlbInfo(lying)).toBeNull();
    expect(parseGlbInfo(Buffer.concat([validGlb(), Buffer.alloc(4)]))).toBeNull();
    expect(parseGlbInfo(Buffer.alloc(8))).toBeNull();
  });

  it('any buffer uri, external or data: (buffers must use the BIN chunk)', () => {
    const external = baseJson();
    (external.buffers as Record<string, unknown>[])[0].uri = 'https://evil.example/x.bin';
    expect(parseGlbInfo(glb(external, bin()))).toBeNull();
    const dataUri = baseJson();
    (dataUri.buffers as Record<string, unknown>[])[0].uri =
      'data:application/octet-stream;base64,AA==';
    expect(parseGlbInfo(glb(dataUri, bin()))).toBeNull();
  });

  it('a declared buffer without a BIN chunk, and a BIN chunk without a buffer', () => {
    expect(parseGlbInfo(glb(baseJson()))).toBeNull();
    expect(parseGlbInfo(glb({ asset: { version: '2.0' } }, bin()))).toBeNull();
  });

  it('a BIN chunk more than 3 bytes longer than the declared buffer', () => {
    const json = baseJson();
    (json.buffers as { byteLength: number }[])[0].byteLength = 12;
    (json.bufferViews as { byteLength: number }[])[0].byteLength = 12;
    (json.accessors as { count: number }[])[0].count = 1;
    expect(parseGlbInfo(glb(json, bin()))).toBeNull(); // 24-byte BIN vs 12 declared
  });

  it('an external image uri', () => {
    const json = baseJson();
    json.images = [{ uri: 'https://evil.example/tracking.png' }];
    expect(parseGlbInfo(glb(json, bin()))).toBeNull();
  });

  it('an oversized JSON chunk', () => {
    const json = baseJson();
    json.extras = 'x'.repeat(MAX_GLB_JSON_BYTES);
    expect(parseGlbInfo(glb(json, bin()))).toBeNull();
  });

  it('an accessor that runs past its bufferView / the BIN chunk', () => {
    const tooMany = baseJson();
    (tooMany.accessors as { count: number }[])[0].count = 3; // 36 > 24
    expect(parseGlbInfo(glb(tooMany, bin()))).toBeNull();
    const offset = baseJson();
    (offset.accessors as Record<string, number>[])[0].byteOffset = 4; // 4 + 24 > 24
    expect(parseGlbInfo(glb(offset, bin()))).toBeNull();
  });

  it('a bufferView outside the BIN chunk', () => {
    const tooLong = baseJson();
    (tooLong.bufferViews as { byteLength: number }[])[0].byteLength = 32;
    expect(parseGlbInfo(glb(tooLong, bin()))).toBeNull();
    const shifted = baseJson();
    (shifted.bufferViews as Record<string, number>[])[0].byteOffset = 8; // 8 + 24 > 24
    expect(parseGlbInfo(glb(shifted, bin()))).toBeNull();
  });

  it('unknown accessor component or element types', () => {
    const badComponent = baseJson();
    (badComponent.accessors as Record<string, unknown>[])[0].componentType = 9999;
    expect(parseGlbInfo(glb(badComponent, bin()))).toBeNull();
    const badType = baseJson();
    (badType.accessors as Record<string, unknown>[])[0].type = 'VEC9';
    expect(parseGlbInfo(glb(badType, bin()))).toBeNull();
  });

  it('a stride smaller than the element size', () => {
    const json = baseJson();
    (json.bufferViews as Record<string, number>[])[0].byteStride = 4; // VEC3 float needs 12
    expect(parseGlbInfo(glb(json, bin()))).toBeNull();
  });

  it('mesh / node / accessor counts over the caps', () => {
    const manyMeshes = baseJson();
    manyMeshes.meshes = Array.from({ length: GLB_MAX_MESHES + 1 }, () => ({ primitives: [] }));
    expect(parseGlbInfo(glb(manyMeshes, bin()))).toBeNull();
    const manyNodes = baseJson();
    manyNodes.nodes = Array.from({ length: GLB_MAX_NODES + 1 }, () => ({}));
    expect(parseGlbInfo(glb(manyNodes, bin()))).toBeNull();
    const manyAccessors = baseJson();
    manyAccessors.accessors = Array.from({ length: GLB_MAX_ACCESSORS + 1 }, () => ({
      bufferView: 0,
      componentType: 5121,
      count: 1,
      type: 'SCALAR',
    }));
    expect(parseGlbInfo(glb(manyAccessors, bin()))).toBeNull();
  });

  it('an unknown second chunk, a BIN-first chunk order, and a third chunk', () => {
    const jsonChunk = chunk(JSON_TYPE, Buffer.from(JSON.stringify(baseJson())), 0x20);
    const binChunk = chunk(BIN_TYPE, bin(), 0);
    expect(parseGlbInfo(glbFromChunks([jsonChunk, chunk(0x12345678, bin(), 0)]))).toBeNull();
    expect(parseGlbInfo(glbFromChunks([binChunk, jsonChunk]))).toBeNull();
    expect(parseGlbInfo(glbFromChunks([jsonChunk, binChunk, binChunk]))).toBeNull();
  });

  it('garbage JSON, a non-object root, and a wrong asset version', () => {
    expect(
      parseGlbInfo(glbFromChunks([chunk(JSON_TYPE, Buffer.from('not json {{'), 0x20)])),
    ).toBeNull();
    expect(parseGlbInfo(glb([1, 2, 3]))).toBeNull();
    expect(parseGlbInfo(glb({ asset: { version: '1.0' } }))).toBeNull();
    expect(parseGlbInfo(glb({ meshes: [] }))).toBeNull();
  });

  it('a malformed sparse accessor', () => {
    const json = baseJson();
    (json.accessors as Record<string, unknown>[])[0].sparse = {
      count: 2,
      indices: { bufferView: 0, componentType: 5125 }, // 2 * 4 = 8 <= 24 fine
      values: { bufferView: 0, byteOffset: 16 }, // 16 + 2 * 12 = 40 > 24
    };
    expect(parseGlbInfo(glb(json, bin()))).toBeNull();
    const badIndexType = baseJson();
    (badIndexType.accessors as Record<string, unknown>[])[0].sparse = {
      count: 1,
      indices: { bufferView: 0, componentType: 5126 }, // float indices are illegal
      values: { bufferView: 0 },
    };
    expect(parseGlbInfo(glb(badIndexType, bin()))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// UserAssetsService against an in-memory fake db (SocialService/FakeDb idiom).
// ---------------------------------------------------------------------------

type StoredAsset = UserAssetRecord & { bytes: Buffer };

function stripBytes(row: StoredAsset): UserAssetRecord {
  const { bytes: _bytes, ...rest } = row;
  return { ...rest };
}

class FakeUserAssetsDb implements UserAssetsDb {
  rows = new Map<number, StoredAsset>();
  nextId = 1;

  seed(row: Omit<StoredAsset, 'id' | 'createdAt'>): StoredAsset {
    const stored: StoredAsset = { ...row, id: this.nextId++, createdAt: new Date().toISOString() };
    this.rows.set(stored.id, stored);
    return stored;
  }

  async findBySha(sha256: string): Promise<UserAssetRecord | null> {
    const row = [...this.rows.values()].find((r) => r.sha256 === sha256);
    return row ? stripBytes(row) : null;
  }

  async insertAssetCapped(
    input: { accountId: number; sha256: string; bytes: Buffer; name: string | null },
    maxCount: number,
    maxTotalBytes: number,
  ): Promise<UserAssetRecord | 'cap_count' | 'cap_bytes'> {
    const mine = [...this.rows.values()].filter((r) => r.accountId === input.accountId);
    if (mine.length >= maxCount) return 'cap_count';
    if (mine.reduce((sum, r) => sum + r.byteSize, 0) + input.bytes.length > maxTotalBytes) {
      return 'cap_bytes';
    }
    if ([...this.rows.values()].some((r) => r.sha256 === input.sha256)) {
      const err = new Error('duplicate key value violates unique constraint');
      (err as Error & { code: string }).code = '23505';
      throw err;
    }
    return stripBytes(
      this.seed({
        accountId: input.accountId,
        sha256: input.sha256,
        byteSize: input.bytes.length,
        name: input.name,
        status: 'active',
        bytes: input.bytes,
      }),
    );
  }

  async getActiveBytes(sha256: string): Promise<Buffer | null> {
    const row = [...this.rows.values()].find((r) => r.sha256 === sha256 && r.status === 'active');
    return row ? row.bytes : null;
  }

  async listForAccount(accountId: number): Promise<UserAssetRecord[]> {
    return [...this.rows.values()].filter((r) => r.accountId === accountId).map(stripBytes);
  }

  async deleteAsset(id: number, accountId: number): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.accountId !== accountId) return false;
    this.rows.delete(id);
    return true;
  }
}

// Distinct valid GLBs: vary an ignored extras field so the sha256 changes.
function distinctGlb(tag: string): Buffer {
  const json = baseJson();
  json.extras = tag;
  return glb(json, bin());
}

describe('UserAssetsService', () => {
  it('stores a valid GLB keyed by its sha256 and serves the bytes back', async () => {
    const db = new FakeUserAssetsDb();
    const service = new UserAssetsService(db);
    const bytes = validGlb();
    const result = await service.upload(1, bytes, 'well.glb');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.existing).toBe(false);
    expect(result.asset.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(result.asset.byteSize).toBe(bytes.length);
    expect(result.asset.name).toBe('well.glb');
    expect(await service.bytesForSha(result.asset.sha256)).toEqual(bytes);
  });

  it('strips markup and control characters from the display name', async () => {
    const db = new FakeUserAssetsDb();
    const service = new UserAssetsService(db);
    const result = await service.upload(
      1,
      validGlb(),
      "<script>alert('x')</script> my  rock_1.glb ",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset.name).toBe("scriptalert'x'script my rock_1.glb");
    const stripped = await service.upload(2, distinctGlb('all-symbols'), '<<>>&&');
    expect(stripped.ok).toBe(true);
    if (!stripped.ok) return;
    expect(stripped.asset.name).toBe(null);
  });

  it('rejects invalid bytes before touching storage', async () => {
    const db = new FakeUserAssetsDb();
    const service = new UserAssetsService(db);
    expect(await service.upload(1, Buffer.from('not a glb'), null)).toEqual({
      ok: false,
      error: 'invalid_glb',
    });
    expect(await service.upload(1, Buffer.alloc(0), null)).toEqual({
      ok: false,
      error: 'invalid_glb',
    });
    expect(db.rows.size).toBe(0);
  });

  it('dedupes an identical upload onto the existing row (any uploader)', async () => {
    const db = new FakeUserAssetsDb();
    const service = new UserAssetsService(db);
    const bytes = validGlb();
    const first = await service.upload(1, bytes, null);
    const second = await service.upload(2, bytes, null);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.existing).toBe(true);
    expect(second.asset.id).toBe(first.asset.id);
    expect(db.rows.size).toBe(1);
  });

  it('resolves a concurrent duplicate insert (unique violation) to the winner row', async () => {
    const db = new FakeUserAssetsDb();
    const service = new UserAssetsService(db);
    const bytes = validGlb();
    // The pre-insert lookup misses, then the insert collides: the service must
    // re-read and answer with the row the racing upload created.
    const winner = db.seed({
      accountId: 2,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteSize: bytes.length,
      name: null,
      status: 'active',
      bytes,
    });
    vi.spyOn(db, 'findBySha').mockResolvedValueOnce(null);
    const result = await service.upload(1, bytes, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.existing).toBe(true);
    expect(result.asset.id).toBe(winner.id);
  });

  it('a blocked hash rejects re-uploads and 404s the public byte read', async () => {
    const db = new FakeUserAssetsDb();
    const service = new UserAssetsService(db);
    const bytes = validGlb();
    const uploaded = await service.upload(1, bytes, null);
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;
    const row = db.rows.get(uploaded.asset.id);
    if (row) row.status = 'blocked';
    expect(await service.upload(2, bytes, null)).toEqual({ ok: false, error: 'asset_blocked' });
    expect(await service.bytesForSha(uploaded.asset.sha256)).toBeNull();
  });

  it('enforces the per-account asset count cap', async () => {
    const db = new FakeUserAssetsDb();
    const service = new UserAssetsService(db);
    for (let i = 0; i < MAX_ASSETS_PER_ACCOUNT; i++) {
      const result = await service.upload(1, distinctGlb(`asset-${i}`), null);
      expect(result.ok).toBe(true);
    }
    expect(await service.upload(1, distinctGlb('one too many'), null)).toEqual({
      ok: false,
      error: 'asset_limit_reached',
    });
    // another account is unaffected
    expect((await service.upload(2, distinctGlb('other account'), null)).ok).toBe(true);
  });

  it('enforces the per-account total byte cap', async () => {
    const db = new FakeUserAssetsDb();
    const service = new UserAssetsService(db);
    db.seed({
      accountId: 1,
      sha256: 'f'.repeat(64),
      byteSize: MAX_ASSET_TOTAL_BYTES - 10,
      name: null,
      status: 'active',
      bytes: Buffer.alloc(0),
    });
    expect(await service.upload(1, validGlb(), null)).toEqual({
      ok: false,
      error: 'asset_storage_limit_reached',
    });
  });

  it('clips the display name and ignores non-strings', async () => {
    const db = new FakeUserAssetsDb();
    const service = new UserAssetsService(db);
    const long = await service.upload(1, distinctGlb('long name'), 'n'.repeat(200));
    expect(long.ok && long.asset.name === 'n'.repeat(MAX_ASSET_NAME_LENGTH)).toBe(true);
    const none = await service.upload(1, distinctGlb('no name'), 42);
    expect(none.ok && none.asset.name === null).toBe(true);
  });

  it('deletion is owner-only', async () => {
    const db = new FakeUserAssetsDb();
    const service = new UserAssetsService(db);
    const uploaded = await service.upload(1, validGlb(), null);
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;
    expect(await service.deleteAsset(2, uploaded.asset.id)).toBe(false);
    expect(await service.deleteAsset(1, uploaded.asset.id)).toBe(true);
    expect(db.rows.size).toBe(0);
  });

  it('wire helpers expose the content-addressed URL and the status mapping', () => {
    expect(userAssetUrl('ab'.repeat(32))).toBe(`/api/assets/${'ab'.repeat(32)}.glb`);
    const asset: UserAssetRecord = {
      id: 3,
      accountId: 9,
      sha256: 'cd'.repeat(32),
      byteSize: 5,
      name: 'x',
      status: 'active',
      createdAt: 'now',
    };
    expect(userAssetJson(asset)).toMatchObject({ url: `/api/assets/${'cd'.repeat(32)}.glb` });
    expect(userAssetsErrorStatus('asset_blocked')).toBe(403);
    expect(userAssetsErrorStatus('invalid_glb')).toBe(400);
    expect(userAssetsErrorStatus('asset_limit_reached')).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// The upload lane guards: Content-Length precheck and the scoped rate bucket.
// ---------------------------------------------------------------------------

function fakeReq(headers: Record<string, string | string[]> = {}): http.IncomingMessage {
  return {
    headers,
    socket: { remoteAddress: '203.0.113.5' },
  } as unknown as http.IncomingMessage;
}

describe('upload lane guards', () => {
  afterEach(() => resetAssetUploadRateLimits());

  it('contentLengthExceeds prechecks the declared size without reading a body', () => {
    expect(contentLengthExceeds(fakeReq({ 'content-length': '100' }), 99)).toBe(true);
    expect(contentLengthExceeds(fakeReq({ 'content-length': '99' }), 99)).toBe(false);
    expect(contentLengthExceeds(fakeReq({}), 99)).toBe(false);
    expect(contentLengthExceeds(fakeReq({ 'content-length': 'abc' }), 99)).toBe(false);
    expect(contentLengthExceeds(fakeReq({ 'content-length': ['150', '1'] }), 99)).toBe(true);
  });

  it('assetUploadRateLimited caps per account on its own bucket', () => {
    for (let i = 0; i < ASSET_UPLOAD_MAX_PER_MINUTE; i++) {
      expect(assetUploadRateLimited(fakeReq(), 42)).toBe(false);
    }
    expect(assetUploadRateLimited(fakeReq(), 42)).toBe(true);
  });
});
