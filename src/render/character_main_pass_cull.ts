import type * as THREE from 'three';

/** Layer 0 remains the normal world layer. Layer 1 is visible only to the
 * directional-light shadow camera, so off-screen rigs can keep casting the
 * same shadows without submitting their color-pass draws. */
export const CHARACTER_SHADOW_ONLY_LAYER = 1;

function isRenderable(object: THREE.Object3D): boolean {
  const candidate = object as THREE.Object3D & {
    isMesh?: boolean;
    isLine?: boolean;
    isPoints?: boolean;
    isSprite?: boolean;
  };
  return Boolean(candidate.isMesh || candidate.isLine || candidate.isPoints || candidate.isSprite);
}

export class CharacterMainPassCullState {
  private readonly originalMasks = new Map<THREE.Object3D, number>();
  private culled = false;

  get isCulled(): boolean {
    return this.culled;
  }

  /**
   * Moves a character's renderable descendants onto the shadow-only layer.
   * `graphChanged` refreshes the cached descendants after weapon/form/effect
   * attachment changes while the character remains outside the main frustum.
   */
  set(root: THREE.Object3D, culled: boolean, graphChanged = false): void {
    if (culled === this.culled && !(culled && graphChanged)) return;
    this.restore();
    if (!culled) return;
    root.traverse((object) => {
      if (!isRenderable(object)) return;
      this.originalMasks.set(object, object.layers.mask);
      object.layers.set(CHARACTER_SHADOW_ONLY_LAYER);
    });
    this.culled = true;
  }

  restore(): void {
    for (const [object, mask] of this.originalMasks) object.layers.mask = mask;
    this.originalMasks.clear();
    this.culled = false;
  }
}
