import * as THREE from 'three';
import { loadKtx2Texture } from '../assets/loader';

export const CONTACT_SHEETS = ['contact_cut', 'contact_crush', 'contact_pierce'] as const;
export type ContactSheet = (typeof CONTACT_SHEETS)[number];
export const CONTACT_URLS: Record<ContactSheet, string> = {
  contact_cut: '/textures/vfx/contact/cut.ktx2',
  contact_crush: '/textures/vfx/contact/crush.ktx2',
  contact_pierce: '/textures/vfx/contact/pierce.ktx2',
};
const textures = new Map<ContactSheet, THREE.Texture>();
let pending: Promise<void> | null = null;

/** The three contact sheets load with the rest of the Warrior kit, on demand
 *  (production_assets.ts ensureWarriorKitAssets), never on the deferred
 *  preload lane: only the authored Warrior contacts draw them, so a page with
 *  no Warrior in sight never pays for them. One load per page; a failure
 *  resets so the next request can retry. */
export function ensureContactSheets(): Promise<void> {
  if (pending) return pending;
  pending = Promise.all(
    CONTACT_SHEETS.map(async (kind) => {
      const texture = (await loadKtx2Texture(CONTACT_URLS[kind], { large: true })).clone();
      texture.generateMipmaps = false;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      textures.set(kind, texture);
    }),
  ).then(
    () => undefined,
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}
export const contactAssetInternalsForTest = {
  urls: Object.values(CONTACT_URLS),
  reset(): void {
    textures.clear();
    pending = null;
  },
};
export function isContactSheet(value: string): value is ContactSheet {
  return (CONTACT_SHEETS as readonly string[]).includes(value);
}
export function contactTexture(kind: ContactSheet): THREE.Texture | null {
  return textures.get(kind) ?? null;
}
