// Otherworldly skybox for the Vale Cup PRIVATE practice pitch (the pitch spawns
// far out in an instance band where the overworld sky dome is hidden).
//
// A camera-centred inverted sphere textured with a real, premium, open-licensed
// deep-space panorama: the ESO Milky Way 360 equirectangular (S. Brunier / ESO,
// CC BY 4.0), a pure celestial sphere (no terrestrial ground), its colourful
// galactic core running along the horizon where the chase camera looks. Each
// practice bout picks a variant: the sphere is rotated so a different stretch of
// the galaxy faces the pitch and colour-graded to a different alien hue, so it
// reads as a fresh otherworldly sky every time. The renderer reads each variant's
// fog colour so the pitch is lit to match its sky.

import * as THREE from 'three';
import { loadTexture } from './assets/loader';

// A variant = how we orient + colour-grade the one galaxy panorama, plus the
// fog colour the renderer applies so the pitch reads lit under it.
interface SkyVariant {
  rotation: number; // radians: which stretch of the galaxy faces the pitch
  tint: number; // multiplies the panorama -> an alien colour cast
  fog: number; // scene fog colour on the pitch
}

const VARIANTS: SkyVariant[] = [
  // The galaxy as photographed (crisp, cool white), core to the fore.
  { rotation: 0.0, tint: 0xe8ecff, fog: 0x0a0c1a },
  // Teal aurora nebula.
  { rotation: 1.25, tint: 0x9fe6d6, fog: 0x08181c },
  // Violet deep-space.
  { rotation: 2.5, tint: 0xd6a6ff, fog: 0x140a22 },
  // Ember / amber galactic dawn.
  { rotation: 3.75, tint: 0xffd2a0, fog: 0x1a1206 },
  // Electric cyan rift.
  { rotation: 5.0, tint: 0x9fd6ff, fog: 0x08141e },
];

const SKY_RADIUS = 520; // just inside the overworld dome (560); camera-centred

/** The one-texel white stand-in the sphere wears until the panorama decodes. */
function placeholderSky(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export class ValeCupPracticeSky {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private requested = false;
  private current = -1;

  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false, // the pitch fog must not wash out the deep-space backdrop
      color: 0xffffff,
      // A one-texel white stand-in, so the slot is POPULATED from the start.
      // Map presence is a program-cache-key input and this mesh is visible
      // mid-bout, so a null-to-texture swap when the panorama decoded linked a
      // new program inside a live practice frame. Swapping one texture for
      // another in a populated slot changes no key. White multiplies the
      // variant tint to exactly the colour the empty slot used to show.
      map: placeholderSky(),
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 40, 24), this.material);
    this.mesh.renderOrder = -10; // behind everything, like the overworld dome
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  get variantCount(): number {
    return VARIANTS.length;
  }

  /** Orient + colour-grade to variant `i` (wrapped), loading the panorama on
   *  first use. Called per frame while practicing; allocates nothing. */
  setVariant(i: number): void {
    const idx = ((i % VARIANTS.length) + VARIANTS.length) % VARIANTS.length;
    if (!this.requested) {
      // Lazy load (only once a player actually practices) through the shared
      // manifest-aware loader (content-hashed URL + the texture load queue);
      // the sphere shows the deep-space colour (the white stand-in under the
      // variant tint) until the panorama decodes, then pops in.
      this.requested = true;
      loadTexture('/env/space_galaxy.jpg', { srgb: true })
        .then((t) => {
          const placeholder = this.material.map;
          this.material.map = t;
          // No needsUpdate: the slot was already populated, so the program is
          // unchanged and three re-binds the new texture on its own.
          if (placeholder !== t) placeholder?.dispose();
        })
        .catch(() => undefined);
    }
    if (idx !== this.current) {
      const v = VARIANTS[idx];
      this.mesh.rotation.y = v.rotation;
      this.material.color.setHex(v.tint);
      this.current = idx;
    }
  }

  /** Fog colour for variant `i` (wrapped), so the renderer tints the pitch. */
  fogFor(i: number): number {
    return VARIANTS[((i % VARIANTS.length) + VARIANTS.length) % VARIANTS.length].fog;
  }
}
