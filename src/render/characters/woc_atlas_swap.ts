// A newly resident body atlas is still cold GPU work. Compile/upload the
// material on the same mesh kind through the renderer's existing far gate,
// keeping the current body atlas active until that proof settles. The scratch
// owns material claims only; geometry and skeletons belong to the live rig.
//
// The twins wear what the body will: the host wraps them with the body's own
// layer over their tier materials (AtlasHost.wrap), so the gate links the
// program that draws after the swap, never the unwrapped one no body mounts,
// and the swap mounts the very materials the gate prepared (for the colour
// and skin the body wore when the swap was staged).
//
// A settle only RECORDS the gate's answer (`settled`). The swap itself is a
// full material sweep and is taken by `commit` from the visual's per-frame
// path, like an effect swap, never inside the gate callback (which lands
// between frames). A settle that could not vouch for the twins keeps the
// current atlas and asks again, MAX_UNPREPARED_SETTLES times at most; then the
// swap is taken all the same. The atlas standing in is the WRONG cloth
// (another set's under-armor, or the bare suit under a worn chest), never a
// less sharp version of the right one, so a gate that keeps giving up, or one
// that can prove nothing on this host, must not keep a body in it for good.
// A gate that stops ANSWERING is that gate's own call: a preview never commits
// an atlas its context refused to warm (preview_material_gate.ts), so there
// the current one stays until the next pick.
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
  /** Wrap the scratch twins as the body's own meshes are wrapped over their tier
   *  materials (the WOC tint layer); absent on a body that wears no wrap. */
  wrap?(scratch: THREE.Object3D): void;
  commit(): void;
}

/** How many settles of one swap may come back unprepared (the gate gave up, or cannot
 *  prove anything) and be asked again, the current atlas drawing meanwhile, before the
 *  swap is taken all the same (the count a replacement armor file is asked again:
 *  woc_armor_dressing.ts). */
const MAX_UNPREPARED_SETTLES = 2;

export class WocAtlasSwap {
  currentUrl: string | null = null;
  /** The gate answered for the staged atlas: `commit` on the per-frame path. */
  settled = false;
  private requested: string | null = null;
  private generation = 0;
  private disposed = false;
  private scratch: THREE.Group | null = null;
  private claims: TintedMaterialClaims | null = null;
  private host: (() => AtlasHost) | null = null;
  private retryAt: number | null = null;
  /** The atlas the scratch stages (null: back to the body's own). */
  private stagedUrl: string | null = null;
  /** Whether the settle recorded in `settled` vouched for the twins. */
  private prepared = false;
  /** Settles of this scratch that came back unprepared and were asked again. */
  private unprepared = 0;
  /** Which ask of the gate is out: a settle of an earlier one is not its answer. */
  private asked = 0;

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
      this.stage(url);
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

  /**
   * Take the swap the gate settled, from the visual's per-frame path. A settle that
   * vouched for the twins commits; one that could not keeps the current atlas and asks
   * the gate again for the same twins, until the re-asks run out.
   */
  commit(): void {
    this.settled = false;
    const scratch = this.scratch;
    const host = this.host?.();
    if (this.disposed || !scratch || !host) return;
    if (!this.prepared && host.gate && this.unprepared < MAX_UNPREPARED_SETTLES) {
      this.unprepared++;
      this.ask(host.gate, scratch);
      return;
    }
    this.currentUrl = this.stagedUrl;
    // Acquire the live claims before releasing this scratch's claims.
    host.commit();
    this.drop();
  }

  private stage(url: string | null): void {
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
    this.stagedUrl = url;
    this.unprepared = 0;
    applyMaterials(
      scratch,
      host.def,
      host.color,
      url ? atlasTextureByUrl(url) : host.fallback,
      host.emissive,
      claims,
    );
    // ...then the wrap the live meshes wear over those tier materials: the program the
    // body draws is the wrapped one, and that is the one the gate has to link
    host.wrap?.(scratch);
    host.parent.add(scratch);
    this.ask(host.gate, scratch);
  }

  /** Ask the gate to prepare the twins. Its settle records the answer and nothing else. */
  private ask(gate: FarBakeGate, scratch: THREE.Group): void {
    const asked = ++this.asked;
    try {
      gate(scratch, (ready) => {
        if (this.disposed || this.scratch !== scratch || asked !== this.asked) return;
        this.prepared = ready?.() !== false;
        this.settled = true;
      });
    } catch (err) {
      this.drop();
      this.retryAt = performance.now() + 1000;
      console.warn('WOC body atlas compile gate rejected', err);
    }
  }

  private drop(): void {
    this.generation++;
    this.settled = false;
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
