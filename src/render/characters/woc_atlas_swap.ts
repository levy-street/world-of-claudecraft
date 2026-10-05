// A newly resident body atlas is still cold GPU work. Compile/upload the
// material on the same mesh kind through the renderer's existing far gate,
// keeping the current body atlas active until that proof settles. The scratch
// owns material claims only; geometry and skeletons belong to the live rig.
import * as THREE from 'three';
import {
  applyMaterials,
  atlasTextureByUrl,
  characterSourceMaterials,
  ensureAtlasByUrl,
  releaseTintedMaterials,
  type TintedMaterialClaims,
} from './assets';
import type { VisualDef } from './manifest';
import type { FarBakeGate } from './visual';

interface AtlasHost {
  model: THREE.Object3D;
  parent: THREE.Object3D;
  def: VisualDef;
  color: number;
  fallback: THREE.Texture | null;
  emissive: THREE.Texture | null;
  gate: FarBakeGate | null;
  commit(): void;
}

export class WocAtlasSwap {
  currentUrl: string | null = null;
  private requested: string | null = null;
  private generation = 0;
  private disposed = false;
  private scratch: THREE.Group | null = null;
  private claims: TintedMaterialClaims | null = null;
  private host: (() => AtlasHost) | null = null;
  private retryAt: number | null = null;

  request(url: string | null, host: () => AtlasHost): void {
    this.host = host;
    if (this.disposed) return;
    if (url === this.requested) {
      this.retryFailed();
      return;
    }
    this.requested = url;
    this.restart();
  }

  /** A renderer generation change invalidates the old gate's callback. */
  restart(): void {
    this.drop();
    this.retryAt = null;
    if (this.disposed || !this.host || this.requested === this.currentUrl) return;
    const generation = this.generation;
    const url = this.requested;
    const ready = () => {
      if (this.disposed || generation !== this.generation) return;
      this.stage(url, generation);
    };
    const pending = url ? ensureAtlasByUrl(url) : null;
    if (pending)
      void pending.then(ready).catch((err) => {
        if (this.disposed || generation !== this.generation) return;
        this.retryAt = performance.now() + 1000;
        console.warn('failed to load WOC body atlas:', err);
      });
    else ready();
  }

  /** Repeated frame-level equipment sync heals a failed load without issuing
   *  one request per frame while the connection remains unavailable. */
  retryFailed(): void {
    if (this.retryAt !== null && performance.now() >= this.retryAt) this.restart();
  }

  private stage(url: string | null, generation: number): void {
    const host = this.host?.();
    if (!host) return;
    if (!host.gate) {
      this.currentUrl = url;
      host.commit();
      return;
    }
    const scratch = new THREE.Group();
    scratch.name = 'character_body_atlas_scratch';
    scratch.visible = false;
    host.model.traverse((o) => {
      const source = o as THREE.Mesh;
      if (!source.isMesh || !source.userData.skinAtlasTarget) return;
      const twin = source.clone(false);
      // clone keeps geometry/skeleton identity and the real mesh's program
      // shape. Derive from the original source, never an earlier atlas tint.
      twin.material = characterSourceMaterials(source);
      twin.visible = false;
      twin.frustumCulled = false;
      scratch.add(twin);
    });
    const claims: TintedMaterialClaims = new Set();
    this.scratch = scratch;
    this.claims = claims;
    applyMaterials(
      scratch,
      host.def,
      host.color,
      url ? atlasTextureByUrl(url) : host.fallback,
      host.emissive,
      claims,
    );
    host.parent.add(scratch);
    try {
      host.gate(scratch, () => {
        if (this.disposed || generation !== this.generation || this.scratch !== scratch) return;
        const current = this.host?.();
        if (!current) return;
        this.currentUrl = url;
        // Acquire the live claims before releasing this scratch's claims.
        current.commit();
        this.drop();
      });
    } catch (err) {
      this.drop();
      this.retryAt = performance.now() + 1000;
      console.warn('WOC body atlas compile gate rejected', err);
    }
  }

  private drop(): void {
    this.generation++;
    this.scratch?.removeFromParent();
    this.scratch = null;
    if (this.claims) releaseTintedMaterials(this.claims);
    this.claims = null;
  }

  dispose(): void {
    this.disposed = true;
    this.drop();
    this.host = null;
  }
}
