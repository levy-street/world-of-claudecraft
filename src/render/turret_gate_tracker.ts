// A compile gate that knows what it still has in flight. A queued gate piece
// links the materials under its target when it runs, so a material disposed
// before then is registered again with a program reference no later dispose
// releases. A release disposes what a gate links only once that gate settled.
import type * as THREE from 'three';

type CompileGate = (target: THREE.Object3D) => Promise<unknown>;

export class TurretGateTracker {
  private readonly pending = new Set<Promise<unknown>>();
  /** The inner gate, counted; undefined when there is none (attach at once). */
  readonly gate: CompileGate | undefined;

  constructor(inner?: CompileGate) {
    this.gate = inner
      ? (target) => {
          const linked = inner(target);
          this.pending.add(linked);
          const drop = (): void => {
            this.pending.delete(linked);
          };
          linked.then(drop, drop);
          return linked;
        }
      : undefined;
  }

  get inFlight(): number {
    return this.pending.size;
  }

  /** Runs `release` now when nothing is in flight, else once every gate, including any opened meanwhile, has settled. */
  afterSettled(release: () => void): void {
    if (this.pending.size === 0) {
      release();
      return;
    }
    void Promise.allSettled([...this.pending]).then(() => this.afterSettled(release));
  }
}
