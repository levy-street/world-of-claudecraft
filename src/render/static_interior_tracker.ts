import { instanceOrigin, instanceSlotForZ } from '../sim/data';
import { BuildRetryGate } from './build_retry_gate';

/** Own the asynchronous dungeon/arena build keys beside the renderer's cache. */
export class StaticInteriorTracker {
  private readonly retry = new BuildRetryGate(15000);
  private readonly settled = new Set<string>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly built: Set<string>,
    private readonly build: (interior: string, x: number, z: number) => Promise<unknown>,
    private readonly now: () => number,
    private readonly failed: (error: unknown) => void,
  ) {}

  isDungeonSettled(dungeon: { id: string }, z: number): boolean {
    const key = `${dungeon.id}:${instanceSlotForZ(z)}`;
    return this.settled.has(key) && this.built.has(key);
  }

  ensure(key: string, interior: string, x: number, z: number): Promise<unknown> {
    if (!this.built.has(key)) this.settled.delete(key);
    if (this.settled.has(key)) return Promise.resolve();
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    this.built.add(key);
    const task = Promise.resolve()
      .then(() => this.build(interior, x, z))
      .then((result) => {
        this.inFlight.delete(key);
        this.settled.add(key);
        return result;
      })
      .catch((error) => {
        this.inFlight.delete(key);
        this.built.delete(key);
        this.settled.delete(key);
        this.retry.markFailed(key, this.now());
        this.failed(error);
        throw error;
      });
    this.inFlight.set(key, task);
    return task;
  }

  prepareDungeon(
    dungeon: { id: string; index: number; interior: string },
    z: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    const slot = instanceSlotForZ(z);
    const origin = instanceOrigin(dungeon.index, slot);
    const key = `${dungeon.id}:${slot}`;
    onProgress?.(0, 1);
    return this.ensure(key, dungeon.interior, origin.x, origin.z).then(() => {
      onProgress?.(1, 1);
    });
  }

  schedule(key: string, interior: string, x: number, z: number): void {
    if (this.built.has(key) || !this.retry.shouldAttempt(key, this.now())) return;
    void this.ensure(key, interior, x, z).catch(() => undefined);
  }
}
