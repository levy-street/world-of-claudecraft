import { afterEach, describe, expect, it } from 'vitest';
import { placementsToRenderAssets } from '../src/editor/custom_map';
import {
  clearUserAssets,
  isUserAssetId,
  listUserAssets,
  registerUserAssets,
  removeUserAsset,
  userAssetIdFor,
  userAssetLabel,
  userAssetPath,
} from '../src/editor/user_assets';

// The 'user/<sha256>' uploaded-asset id scheme: pure resolution to the
// content-addressed server URL, the session registry behind the Uploaded tab,
// and the placementsToRenderAssets integration.

const SHA = 'a'.repeat(64);
const SHA2 = `${'b'.repeat(63)}0`;

afterEach(() => clearUserAssets());

describe('user asset ids', () => {
  it('round-trips sha -> id -> path', () => {
    const id = userAssetIdFor(SHA);
    expect(id).toBe(`user/${SHA}`);
    expect(isUserAssetId(id)).toBe(true);
    expect(userAssetPath(id)).toBe(`/api/assets/${SHA}.glb`);
  });

  it('rejects non-user ids and malformed hashes', () => {
    expect(isUserAssetId('props/well')).toBe(false);
    expect(userAssetPath('props/well')).toBeNull();
    expect(userAssetPath('user/short')).toBeNull();
    expect(userAssetPath(`user/${'Z'.repeat(64)}`)).toBeNull(); // not lowercase hex
    expect(userAssetPath(`user/${SHA}extra`)).toBeNull();
  });

  it('resolution needs NO registry entry (any viewer can render a public upload)', () => {
    expect(listUserAssets()).toEqual([]);
    expect(userAssetPath(userAssetIdFor(SHA2))).toBe(`/api/assets/${SHA2}.glb`);
  });
});

describe('user asset registry (Uploaded tab)', () => {
  it('registers, lists, labels, and removes entries', () => {
    registerUserAssets([
      { id: 7, sha256: SHA, name: 'My Statue', byteSize: 1234 },
      { id: 8, sha256: SHA2, name: null, byteSize: 99 },
    ]);
    expect(listUserAssets()).toHaveLength(2);
    expect(userAssetLabel(userAssetIdFor(SHA))).toBe('My Statue');
    // No name: falls back to a short hash prefix.
    expect(userAssetLabel(userAssetIdFor(SHA2))).toBe(SHA2.slice(0, 8));
    removeUserAsset(SHA);
    expect(listUserAssets()).toHaveLength(1);
  });
});

describe('placementsToRenderAssets with user assets', () => {
  it('resolves user placements to the content-addressed GLB URL', () => {
    const out = placementsToRenderAssets([
      { assetId: userAssetIdFor(SHA), x: 1, z: 2, rotY: 0.5, scale: 2, collide: true },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.path).toBe(`/api/assets/${SHA}.glb`);
    expect(out[0]?.collideRadius).toBeGreaterThan(0);
  });

  it('keeps unknown ids as index-aligned null holes', () => {
    const out = placementsToRenderAssets([
      { assetId: 'no/such-asset', x: 0, z: 0, rotY: 0, scale: 1, collide: false },
      {
        assetId: `user/${'not-hex'.padEnd(64, 'x')}`,
        x: 0,
        z: 0,
        rotY: 0,
        scale: 1,
        collide: false,
      },
    ]);
    expect(out).toEqual([null, null]);
  });
});
