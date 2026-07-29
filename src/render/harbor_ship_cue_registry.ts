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

  constructor(private readonly options: HarborShipCueRegistryOptions<TSegment, THandle>) {}

  get(target: string): THandle | undefined {
    return this.handles.get(target);
  }

  values(): IterableIterator<THandle> {
    return this.handles.values();
  }

  register(target: string, handle: THandle): void {
    this.handles.set(target, handle);
    const pending = this.pending.get(target);
    if (!pending) return;
    this.pending.delete(target);
    this.apply(target, handle, pending.cue, pending.startSec);
  }

  cue(target: string, cue: string): void {
    const handle = this.handles.get(target);
    const startSec = this.options.nowSec();
    if (!handle) {
      this.pending.set(target, { cue, startSec });
      return;
    }
    this.pending.delete(target);
    this.apply(target, handle, cue, startSec);
  }

  resetAll(): void {
    this.pending.clear();
    for (const handle of this.handles.values()) this.options.reset(handle);
  }

  /** Rebuilding render geometry replaces handles but must preserve pre-build cues. */
  clearHandles(): void {
    this.handles.clear();
  }

  private apply(target: string, handle: THandle, cue: string, startSec: number): void {
    const segment = this.options.segmentForCue(cue);
    if (!segment) {
      this.options.reset(handle);
      return;
    }
    for (const [otherTarget, other] of this.handles) {
      if (otherTarget !== target && other.cueStartSec !== null && other.segment !== null) {
        this.options.reset(other);
      }
    }
    this.options.activate(handle, segment, startSec);
  }
}
