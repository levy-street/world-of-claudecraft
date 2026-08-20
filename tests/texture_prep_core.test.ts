// The gate's texture-residency decision: which textures under a root are still
// cold, read the way three's WebGLTextures reads them (a property record with
// __webglTexture and a __version matching the texture's), with no GL call.
//
// What these cases protect: a residency check that is too GENEROUS silently
// reinstates the whole defect (the reveal frame pays the uploads and the lane
// looks green because it uploaded nothing), and one that is too STRICT
// re-uploads resident textures every gate, which for a KTX2 atlas whose CPU
// mips were released comes back black.
import { describe, expect, it } from 'vitest';
import {
  collectNonResidentTextures,
  isTexturePrepCandidate,
  isTextureResident,
  type TexturePrepTexture,
  type TexturePropertiesLike,
} from '../src/render/texture_prep_core';

interface Tex extends TexturePrepTexture {
  isTexture: true;
  name: string;
}

// Every stub carries a decoded image unless a case says otherwise: three's
// setTexture2D uploads nothing for a null or still-decoding source, so the
// candidate predicate refuses those before residency is even asked.
const texture = (name: string, extra: Partial<Tex> = {}): Tex => ({
  isTexture: true,
  name,
  version: 1,
  image: { complete: true },
  ...extra,
});

/** A stub of WebGLRenderer.properties: the per-texture record, or nothing. */
const props = (records: Map<object, unknown>): TexturePropertiesLike => ({
  get: (key: object) => records.get(key),
});

describe('isTextureResident', () => {
  it('is resident only with a GPU object AND a version stamp that matches', () => {
    const tex = texture('atlas', { version: 4 });
    const records = new Map<object, unknown>([[tex, { __webglTexture: {}, __version: 4 }]]);
    expect(isTextureResident(props(records), tex)).toBe(true);
  });

  it('is not resident when the stamped version is stale (the texture changed)', () => {
    const tex = texture('atlas', { version: 5 });
    const records = new Map<object, unknown>([[tex, { __webglTexture: {}, __version: 4 }]]);
    expect(isTextureResident(props(records), tex)).toBe(false);
  });

  it('is not resident with a record but no GPU object (__webglInit alone is not enough)', () => {
    const tex = texture('atlas', { version: 1 });
    const records = new Map<object, unknown>([[tex, { __webglInit: true, __version: 1 }]]);
    expect(isTextureResident(props(records), tex)).toBe(false);
  });

  it('is not resident with no record at all', () => {
    const tex = texture('fresh');
    expect(isTextureResident(props(new Map()), tex)).toBe(false);
  });
});

describe('isTexturePrepCandidate', () => {
  it.each([
    ['render target', { isRenderTargetTexture: true }],
    ['external', { isExternalTexture: true }],
    ['video', { isVideoTexture: true }],
    ['version 0', { version: 0 }],
    ['not yet loaded (image null)', { image: null }],
    ['still decoding (image.complete false)', { image: { complete: false } }],
  ])('refuses a %s texture', (_name, extra) => {
    expect(isTexturePrepCandidate(texture('t', extra as Partial<Tex>))).toBe(false);
  });

  it('accepts an ordinary authored texture', () => {
    expect(isTexturePrepCandidate(texture('makeup', { version: 1 }))).toBe(true);
  });

  it('accepts a decoded source that has no complete flag at all (a DataTexture, a KTX2)', () => {
    expect(isTexturePrepCandidate(texture('bones', { image: {} as Tex['image'] }))).toBe(true);
  });
});

describe('collectNonResidentTextures', () => {
  const rootOf = (...materials: unknown[]): { traverse(cb: (o: unknown) => void): void } => ({
    traverse: (cb) => {
      for (const material of materials) cb({ material });
    },
  });

  it('keeps traversal order and dedupes a texture shared by two materials', () => {
    const shared = texture('shared');
    const second = texture('second');
    const root = rootOf({ map: shared }, { map: shared, emissiveMap: second });
    const found = collectNonResidentTextures(props(new Map()), root);
    expect(found.map((t) => (t as Tex).name)).toEqual(['shared', 'second']);
  });

  it('reaches ShaderMaterial uniforms and uniform ARRAYS', () => {
    const single = texture('uniform');
    const first = texture('array0');
    const rest = texture('array1');
    const root = rootOf({
      uniforms: { tex: { value: single }, ramps: { value: [first, rest] } },
    });
    const found = collectNonResidentTextures(props(new Map()), root);
    expect(found.map((t) => (t as Tex).name)).toEqual(['uniform', 'array0', 'array1']);
  });

  it('drops the resident, the non-uploadable, and the in-flight', () => {
    const cold = texture('cold');
    const warm = texture('warm', { version: 2 });
    const target = texture('target', { isRenderTargetTexture: true });
    const video = texture('video', { isVideoTexture: true });
    const external = texture('external', { isExternalTexture: true });
    const unversioned = texture('unversioned', { version: 0 });
    const inFlight = texture('in-flight');
    const records = new Map<object, unknown>([[warm, { __webglTexture: {}, __version: 2 }]]);
    const root = rootOf({
      map: cold,
      normalMap: warm,
      aoMap: target,
      lightMap: video,
      emissiveMap: external,
      roughnessMap: unversioned,
      metalnessMap: inFlight,
    });

    const found = collectNonResidentTextures(props(records), root, (t) => t === inFlight);

    expect(found.map((t) => (t as Tex).name)).toEqual(['cold']);
  });

  it('re-collects a texture whose version moved past its stamp', () => {
    const restamped = texture('restamped', { version: 3 });
    const records = new Map<object, unknown>([[restamped, { __webglTexture: {}, __version: 2 }]]);
    const found = collectNonResidentTextures(props(records), rootOf({ map: restamped }));
    expect(found).toEqual([restamped]);
  });
});
