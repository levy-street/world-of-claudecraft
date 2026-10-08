// The loader's start queue: how many loads of one kind run at once, and which waiting load
// starts next (loader.ts is the thin consumer).
//
// Two classes share the slots. A DEMAND load is a file somebody needs now, which is every
// caller unless it says otherwise: a body about to be built, an armor set a visible character
// wears, a hairstyle, a mount. A BACKGROUND load is speculative bulk: the post-entry stream of
// every creature body on the iOS memory profile, the crowd prefetch after first paint. A
// waiting demand load always starts before any waiting background load, first come first
// served inside each class, so a file needed now never waits out a stream of files nobody
// has asked for yet (that stream is every creature body in the game, two at a time on a
// phone). A background load still waiting when its file is demanded is PROMOTED: it joins the
// demand line. A load that has started is never interrupted, so the limit holds whatever the
// mix. That is why background loads never hold every slot of a queue that has more than one:
// one slot stays free for a demand, which would otherwise wait out a download nobody asked
// for (and its retries, when that download is failing).
//
// Pure (no Three, no DOM, no timers): the loader hands in how a start is launched.

/** When a waiting load may start relative to the others on its queue. */
export type LoadPriority = 'demand' | 'background';

/** A load's start. `background`: the class it was STARTED in (a promoted load starts as a
 *  demand), which it hands back to `release` when it ends. */
export type LoadStart = (background: boolean) => void;

export class LoadQueue {
  private active = 0;
  /** How many of the running loads started as background work. */
  private activeBackground = 0;
  /** The most background loads that run at once: every slot but one, and the one slot of a
   *  single-slot queue. */
  private readonly backgroundLimit: number;
  private readonly demand: LoadStart[] = [];
  /** Waiting background starts in arrival order, each under the key of its file. */
  private readonly background: { key: string; start: LoadStart }[] = [];

  /**
   * `limit`: how many loads run at once. `launch`: how a start is run once it has a slot
   * (the loader defers it a task, so a burst of starts never runs in one callback chain).
   */
  constructor(
    private readonly limit: number,
    private readonly launch: (start: () => void) => void,
  ) {
    this.backgroundLimit = Math.max(1, limit - 1);
  }

  /** Queue one load. `start` runs once, when a slot is free and nothing ahead of it waits;
   *  the load calls `release` when it ends, with the class `start` was told. `key` names a
   *  background load (its file), so a later demand for the same file can promote it. */
  push(start: LoadStart, priority: LoadPriority = 'demand', key = ''): void {
    if (priority === 'background') this.background.push({ key, start });
    else this.demand.push(start);
    this.pump();
  }

  /** A file somebody now needs stops being background work: every load still waiting under
   *  `key` joins the tail of the demand line, in the order it was queued, and starts at once
   *  when the slot kept for a demand is free. Nothing to do once it has started. */
  promote(key: string): void {
    if (this.background.length === 0) return;
    let kept = 0;
    for (const waiting of this.background) {
      if (waiting.key === key) this.demand.push(waiting.start);
      else this.background[kept++] = waiting;
    }
    if (kept === this.background.length) return;
    this.background.length = kept;
    this.pump();
  }

  /** One started load ended: its slot goes to the next waiting load. `background`: the class
   *  its start was told. */
  release(background = false): void {
    this.active = Math.max(0, this.active - 1);
    if (background) this.activeBackground = Math.max(0, this.activeBackground - 1);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.limit) {
      const demand = this.demand.shift();
      if (demand) {
        this.active++;
        this.launch(() => demand(false));
        continue;
      }
      // the slot kept for a demand: background work waits for one of its own to end
      if (this.activeBackground >= this.backgroundLimit) return;
      const waiting = this.background.shift();
      if (!waiting) return;
      this.active++;
      this.activeBackground++;
      this.launch(() => waiting.start(true));
    }
  }
}
