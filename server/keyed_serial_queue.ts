/** Serializes asynchronous work per key without coupling unrelated keys. */
export class KeyedSerialQueue<Key> {
  private readonly tails = new Map<Key, Promise<void>>();

  async run<Result>(key: Key, task: () => Promise<Result>): Promise<Result> {
    const previous = this.tails.get(key);
    const run = (previous ? previous.catch(() => {}) : Promise.resolve()).then(task);
    const tail = run.then(
      () => {},
      () => {},
    );
    this.tails.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
