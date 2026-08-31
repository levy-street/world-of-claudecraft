// Late-bound queue source for KTX2 restore uploads during graphics rebuilds.
// The context-loss event fires after the old renderer queue is gone but before
// the candidate renderer exists, so restore application can need to wait for
// the next live queue instead of deciding at event time.

export interface Ktx2RestoreUploadQueueCoordinator<Queue> {
  current(): Queue | undefined | Promise<Queue | undefined>;
  publish(queue: Queue | undefined): void;
  setPaused(paused: boolean): void;
}

export function createKtx2RestoreUploadQueueCoordinator<
  Queue,
>(): Ktx2RestoreUploadQueueCoordinator<Queue> {
  let paused = false;
  let currentQueue: Queue | undefined;
  const waiters: Array<(queue: Queue | undefined) => void> = [];

  const flush = (): void => {
    if (currentQueue === undefined && paused) return;
    const pending = waiters.splice(0);
    for (const resolve of pending) resolve(currentQueue);
  };

  return {
    current(): Queue | undefined | Promise<Queue | undefined> {
      if (currentQueue || !paused) return currentQueue;
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
    publish(queue: Queue | undefined): void {
      currentQueue = queue;
      flush();
    },
    setPaused(nextPaused: boolean): void {
      paused = nextPaused;
      flush();
    },
  };
}
