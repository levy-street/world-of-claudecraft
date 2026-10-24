// Editor skybox override, moved out of renderer.ts: an equirect image drawn as
// the scene background (null restores the procedural HDRI dome). The dome
// hides while a skybox is active; scene.background needs no mesh and fills the
// below-horizon void.

import * as THREE from 'three';
import { loadEditorHdr } from './editor_hdr_loader';

export class EditorSkybox {
  private url: string | null = null;
  private tex: THREE.Texture | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  set(url: string | null): void {
    // Crossing authored zone boundaries often resolves to the SAME map-wide
    // skybox. Reloading and re-uploading that texture on every crossing caused
    // a visible main-thread/GPU hitch while flying around the editor.
    if (url === this.url) return;
    this.url = url;
    if (!url) {
      this.scene.background = null;
      this.tex?.dispose();
      this.tex = null;
      return;
    }
    const load = url.toLowerCase().endsWith('.hdr')
      ? loadEditorHdr(url).then((source) => source.clone())
      : new THREE.TextureLoader().loadAsync(url);
    void load
      .then((tex) => {
        // A stale load (the user picked another skybox meanwhile) must not win.
        if (this.url !== url) {
          tex.dispose();
          return;
        }
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = url.toLowerCase().endsWith('.hdr')
          ? THREE.LinearSRGBColorSpace
          : THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        this.tex?.dispose();
        this.tex = tex;
        this.scene.background = tex;
      })
      .catch(() => {
        // Permit an explicit retry after a failed fetch without allowing stale
        // requests to clear a newer selection.
        if (this.url === url) this.url = null;
      });
  }

  dispose(): void {
    this.tex?.dispose();
    this.tex = null;
  }
}
