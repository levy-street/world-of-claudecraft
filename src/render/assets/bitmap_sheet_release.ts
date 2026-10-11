// Releases the decoded pixels of an ImageBitmap-backed texture once three has
// uploaded it, and decodes it again when an upload needs it back.
//
// Written against three's upload contract (WebGLTextures.uploadTexture, r185):
// - `texture.onUpdate(texture)` fires after every upload of the texture.
// - A closed ImageBitmap has no pixels and a zero size, so an upload of it
//   would allocate nothing usable or throw. A released texture therefore
//   holds a full-shape stub ({ width, height }) with `source.dataReady`
//   false: an upload of it allocates the right storage and writes nothing.
// - Setting `needsUpdate` bumps the source version, so every renderer that
//   holds the stub uploads the restored pixels on its next use.
//
// Restore story: a renderer that uploads a sheet on purpose (the Warrior kit
// recipe on a rebuilt renderer) restores it first (restoreBitmapSheet), so it
// uploads real texels. Any other upload of a stub (a restored WebGL context,
// whose re-upload of every texture is three's) lands empty and starts the
// restore itself, whose re-upload then heals the texture on its next use.

import type * as THREE from 'three';

type Decode = () => Promise<THREE.Texture>;
interface Stub {
  width: number;
  height: number;
  released: true;
}

const decoders = new WeakMap<THREE.Texture, Decode>();
const restoring = new WeakMap<THREE.Texture, Promise<void>>();

function isBitmap(image: unknown): image is ImageBitmap {
  return (
    !!image &&
    typeof (image as ImageBitmap).close === 'function' &&
    typeof (image as ImageBitmap).width === 'number'
  );
}

function isStub(image: unknown): image is Stub {
  return !!image && (image as Stub).released === true;
}

/** True while the texture holds no decoded pixels. */
export function bitmapSheetReleased(texture: THREE.Texture): boolean {
  return isStub(texture.image);
}

/** Frees the texture's bitmap after each upload. `decode` loads the sheet
 *  again (a fresh decode, never a cached texture) when it is needed back. A
 *  texture that holds no bitmap (the image path) is left alone. */
export function armBitmapSheetRelease(texture: THREE.Texture, decode: Decode): void {
  if (!isBitmap(texture.image)) return;
  decoders.set(texture, decode);
  texture.onUpdate = onUploaded;
}

function onUploaded(texture: THREE.Texture): void {
  const image = texture.image;
  if (isBitmap(image)) {
    const stub: Stub = { width: image.width, height: image.height, released: true };
    image.close();
    texture.image = stub;
    texture.source.dataReady = false;
    return;
  }
  if (isStub(image)) {
    restoreBitmapSheet(texture).catch((error: unknown) => {
      console.warn('Released sheet could not be decoded again', error);
    });
  }
}

/** Decodes a released texture again and asks for its re-upload. Resolves at
 *  once for a texture that still holds its pixels; joins a restore in flight. */
export function restoreBitmapSheet(texture: THREE.Texture): Promise<void> {
  if (!isStub(texture.image)) return Promise.resolve();
  const inFlight = restoring.get(texture);
  if (inFlight) return inFlight;
  const decode = decoders.get(texture);
  if (!decode) return Promise.reject(new Error('released sheet has no decoder'));
  const task = decode()
    .then((fresh) => {
      if (!isStub(texture.image)) return;
      texture.image = fresh.image;
      texture.flipY = fresh.flipY;
      texture.premultiplyAlpha = fresh.premultiplyAlpha;
      texture.source.dataReady = true;
      texture.needsUpdate = true;
      if (!isBitmap(fresh.image)) texture.onUpdate = null;
    })
    .finally(() => {
      restoring.delete(texture);
    });
  restoring.set(texture, task);
  return task;
}
