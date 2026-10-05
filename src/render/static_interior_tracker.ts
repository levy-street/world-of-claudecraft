import { BuildRetryGate } from './build_retry_gate';

/** Own the asynchronous dungeon/arena build keys beside the renderer's cache. */
export class StaticInteriorTracker {
  private readonly retry = new BuildRetryGate(15000);

  constructor(
    private readonly built: Set<string>,
    private readonly build: (interior: string, x: number, z: number) => Promise<unknown>,
    private readonly now: () => number,
    private readonly failed: (error: unknown) => void,
  ) {}

  schedule(key: string, interior: string, x: number, z: number): void {
    if (this.built.has(key) || !this.retry.shouldAttempt(key, this.now())) return;
    this.built.add(key);
    void Promise.resolve()
      .then(() => this.build(interior, x, z))
      .catch((error) => {
        this.built.delete(key);
        this.retry.markFailed(key, this.now());
        this.failed(error);
      });
  }
}
