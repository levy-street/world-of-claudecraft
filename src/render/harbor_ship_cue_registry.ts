export interface HarborShipCueHandle<TSegment> {
  cueStartSec: number | null;
  segment: TSegment | null;
}

interface PendingHarborShipCue {
  cue: string;
  startSec: number;
}

export interface HarborShipCueRegistryOptions<
  TSegment,
  THandle extends HarborShipCueHandle<TSegment>,
> {
  nowSec: () => number;
  segmentForCue: (cue: string) => TSegment | undefined;
  activate: (handle: THandle, segment: TSegment, startSec: number) => void;
  reset: (handle: THandle) => void;
}

/**
 * Runtime registry for scene-cued harbor ships. It retains cues received
 * before render construction and keeps at most one registered ship moving.
 */
export class HarborShipCueRegistry<TSegment, THandle extends HarborShipCueHandle<TSegment>> {
  private readonly handles = new Map<string, THandle>();
  private readonly pending = new Map<string, PendingHarborShipCue>();
  private readonly active = new Map<string, PendingHarborShipCue>();

  constructor(private readonly options: HarborShipCueRegistryOptions<TSegment, THandle>) {}

  get(target: string): THandle | undefined {
    return this.handles.get(target);
  }

  values(): IterableIterator<THandle> {
    return this.handles.values();
  }

  /** Cheap renderer guard: avoids scanning the mirrored entity map when no
   * registered ship has a complete, live cue. */
  hasLiveCue(): boolean {
    for (const handle of this.handles.values()) {
      if (handle.cueStartSec !== null && handle.segment !== null) return true;
    }
    return false;
  }

  register(target: string, handle: THandle): void {
    this.handles.set(target, handle);
    const pending = this.pending.get(target);
    if (!pending) return;
    this.pending.delete(target);
    this.apply(target, handle, pending.cue, pending.startSec);
  }

  cue(target: string, cue: string, startSec = this.options.nowSec()): void {
    const handle = this.handles.get(target);
    if (!handle) {
      this.pending.set(target, { cue, startSec });
      return;
    }
    this.pending.delete(target);
    this.apply(target, handle, cue, startSec);
  }

  /** Elapsed authoritative presentation time for one active handle. */
  elapsedSec(handle: THandle): number | null {
    return handle.cueStartSec === null ? null : this.options.nowSec() - handle.cueStartSec;
  }

  resetAll(): void {
    this.pending.clear();
    this.active.clear();
    for (const handle of this.handles.values()) this.options.reset(handle);
  }

  /** Drop renderer-owned handles while retaining the one authoritative live
   * cue so a graphics rebuild can bind it to the replacement ship at the
   * original presentation-clock start time. Unknown pending targets are not
   * retained: every authored harbor registers synchronously during a build. */
  preserveForRebuild(): void {
    this.handles.clear();
    this.pending.clear();
    for (const [target, cue] of this.active) this.pending.set(target, cue);
  }

  /** World rebuilds drop the prior handles AND their recorded cues: a pending
   *  cue kept across a rebuild would fire on the next world's identically
   *  named ship. Ship registration is synchronous within a rebuild, so any
   *  cue still pending here is stale by construction. */
  clear(): void {
    this.handles.clear();
    this.pending.clear();
    this.active.clear();
  }

  private apply(target: string, handle: THandle, cue: string, startSec: number): void {
    const segment = this.options.segmentForCue(cue);
    if (!segment) {
      this.active.delete(target);
      this.options.reset(handle);
      return;
    }
    for (const [otherTarget, other] of this.handles) {
      if (otherTarget !== target && other.cueStartSec !== null && other.segment !== null) {
        this.active.delete(otherTarget);
        this.options.reset(other);
      }
    }
    this.active.set(target, { cue, startSec });
    this.options.activate(handle, segment, startSec);
  }
}
