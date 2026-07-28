export interface SnapshotDecodeToken {
  generation: number;
  sequence: number;
}

export interface DecodedInbound<T> extends SnapshotDecodeToken {
  value: T;
}

interface Pending<T> {
  ready: boolean;
  value?: T;
}

export class SnapshotDecodeQueue<T> {
  private generation = 0;
  private nextSequence = 0;
  private drainSequence = 0;
  private readonly pending = new Map<number, Pending<T>>();

  constructor(private readonly maxPending = 64) {
    if (!Number.isInteger(maxPending) || maxPending < 1) {
      throw new RangeError('maxPending must be a positive integer');
    }
  }

  beginGeneration(): number {
    this.generation++;
    this.nextSequence = 0;
    this.drainSequence = 0;
    this.pending.clear();
    return this.generation;
  }

  enqueue(): SnapshotDecodeToken {
    if (this.pending.size >= this.maxPending) {
      throw new RangeError('snapshot decode queue overflow');
    }
    const sequence = this.nextSequence++;
    this.pending.set(sequence, { ready: false });
    return { generation: this.generation, sequence };
  }

  resolve(token: SnapshotDecodeToken, value: T): boolean {
    if (token.generation !== this.generation) return false;
    const pending = this.pending.get(token.sequence);
    if (!pending || pending.ready) return false;
    pending.ready = true;
    pending.value = value;
    return true;
  }

  drain(consume: (decoded: DecodedInbound<T>) => void): number {
    let count = 0;
    while (true) {
      const pending = this.pending.get(this.drainSequence);
      if (!pending?.ready) break;
      const sequence = this.drainSequence++;
      this.pending.delete(sequence);
      consume({
        generation: this.generation,
        sequence,
        value: pending.value as T,
      });
      count++;
    }
    return count;
  }

  get size(): number {
    return this.pending.size;
  }
}
