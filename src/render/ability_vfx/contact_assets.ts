import * as THREE from 'three';
import { loadKtx2Texture } from '../assets/loader';
import { registerDeferredPreload } from '../assets/preload';

export const CONTACT_SHEETS = ['contact_cut', 'contact_crush', 'contact_pierce'] as const;
export type ContactSheet = (typeof CONTACT_SHEETS)[number];
export const CONTACT_URLS: Record<ContactSheet, string> = {
  contact_cut: '/textures/vfx/contact/cut.ktx2',
  contact_crush: '/textures/vfx/contact/crush.ktx2',
  contact_pierce: '/textures/vfx/contact/pierce.ktx2',
};
const textures = new Map<ContactSheet, THREE.Texture>();
registerDeferredPreload(async () => {
  await Promise.all(
    CONTACT_SHEETS.map(async (kind) => {
      const texture = (await loadKtx2Texture(CONTACT_URLS[kind], { large: true })).clone();
      texture.generateMipmaps = false;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      textures.set(kind, texture);
    }),
  );
}, true);
export const contactPreloadInternalsForTest = { urls: Object.values(CONTACT_URLS) };
export function isContactSheet(value: string): value is ContactSheet {
  return (CONTACT_SHEETS as readonly string[]).includes(value);
}
export function contactTexture(kind: ContactSheet): THREE.Texture | null {
  return textures.get(kind) ?? null;
}
