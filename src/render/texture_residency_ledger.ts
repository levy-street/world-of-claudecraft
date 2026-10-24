// Which textures the renderer has uploaded to its live WebGL context, and the
// chunked uploads still in flight. Lifted out of renderer.ts with its one
// context-restore duty: after a restore the context holds none of them, so the
// ledger forgets them (a sky or kit sheet re-uploads through its own paced
// lane instead of binding cold in a live frame), and an upload whose chunks
// straddled the loss is not recorded as resident.

import type * as THREE from 'three';
import { type BackgroundGpuQueue, GPU_WORK_PRIORITY } from './background_gpu_queue';
import { registerContextRestoreReset } from './context_restore_registry';
import { uploadDataTextureInChunks } from './texture_upload';

export interface TextureResidencyHost {
  webgl(): THREE.WebGLRenderer;
  queue: Pick<BackgroundGpuQueue, 'run'>;
  /** The idle slot a chunked upload waits for between its chunks. */
  idleSlot(): Promise<void>;
}

export class TextureResidencyLedger {
  private ready = new WeakSet<THREE.Texture>();
  /** Chunked uploads in flight, per texture (the texture prep lane joins
   *  them rather than uploading twice). */
  readonly inFlight = new WeakMap<THREE.Texture, Promise<void>>();
  /** The same tasks, enumerable, for a shutdown that must await them. */
  readonly tasks = new Set<Promise<void>>();
  private context = 0;

  constructor(private readonly host: TextureResidencyHost) {
    registerContextRestoreReset('texture-residency', this, (owner) => owner.forgetContext());
  }

  has(texture: THREE.Texture): boolean {
    return this.ready.has(texture);
  }

  /** One synchronous upload, recorded as resident. */
  prewarm(texture: THREE.Texture | null | undefined): void {
    if (!texture) return;
    this.host.webgl().initTexture(texture);
    this.ready.add(texture);
  }

  /** A paced upload in chunks, one queue unit per chunk at `priority` (a lane
   *  whose stated intent is lowest-priority must not have its expensive
   *  steps outrank its cheap ones). An upload already pending keeps the
   *  priority it entered the queue with. */
  prewarmInIdle(
    texture: THREE.Texture | null | undefined,
    priority: number = GPU_WORK_PRIORITY.VISIBLE_PREWARM,
  ): Promise<void> {
    if (!texture || this.ready.has(texture)) return Promise.resolve();
    const pending = this.inFlight.get(texture);
    if (pending) return pending;
    const context = this.context;
    const task = uploadDataTextureInChunks(this.host.webgl(), texture, {
      beforeChunk: () => this.host.idleSlot(),
      uploadChunk: (chunkTexture) =>
        this.host.queue.run(
          () => this.host.webgl().initTexture(chunkTexture),
          priority,
          'texture-chunk-upload',
        ),
    })
      .then(() => {
        if (context === this.context) this.ready.add(texture);
      })
      .finally(() => {
        this.inFlight.delete(texture);
        this.tasks.delete(task);
      });
    this.inFlight.set(texture, task);
    this.tasks.add(task);
    return task;
  }

  /** A WebGL context restore: nothing the ledger recorded is resident any
   *  more, and an upload still in flight finishes for the lost context. */
  forgetContext(): void {
    this.ready = new WeakSet();
    this.context++;
  }
}
