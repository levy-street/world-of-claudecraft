import { describe, expect, it } from 'vitest';
import {
  GPU_TIMER_PENDING_FRAMES,
  GPU_TIMER_SCENE_AO_BRACKET,
  GPU_TIMER_SCENE_BRACKET,
  GPU_TIMER_STAT_WINDOW,
  GPU_TIMER_UNAVAILABLE,
  GPU_TIMER_UNLABELLED_PASS,
  GpuTimerLedger,
  type GpuTimerQueryBackend,
  gpuTimerBracketDrawsScene,
  gpuTimerOverlayLines,
  gpuTimerPassName,
  labelGpuTimerPass,
} from '../src/render/gpu_timer_probe_core';

// A query backend that records every call and hands results out only when the
// test says so, which is how a real GPU behaves: begin/end are recorded in
// submission order, results arrive frames later, and the disjoint flag is a
// one-shot read.
class FakeBackend implements GpuTimerQueryBackend<number> {
  nextId = 1;
  created: number[] = [];
  deleted: number[] = [];
  active: number | null = null;
  log: string[] = [];
  private readonly results = new Map<number, number>();
  private readonly ready = new Set<number>();
  disjointFlag = false;

  /** Set to model a lost context: createQuery answers null from then on. */
  contextLost = false;
  /** Queries minted before a restore: dead to the live context. */
  readonly dead = new Set<number>();

  queryValid(query: number): boolean {
    return !this.dead.has(query);
  }

  createQuery(): number | null {
    if (this.contextLost) return null;
    const id = this.nextId++;
    this.created.push(id);
    return id;
  }
  deleteQuery(query: number): void {
    this.deleted.push(query);
  }
  beginQuery(query: number): void {
    if (this.active !== null) throw new Error(`backend: query ${this.active} still active`);
    this.active = query;
    this.log.push(`begin ${query}`);
  }
  endQuery(): void {
    this.log.push(`end ${this.active}`);
    this.active = null;
  }
  resultAvailable(query: number): boolean {
    return this.ready.has(query);
  }
  resultNs(query: number): number {
    return this.results.get(query) ?? 0;
  }
  disjoint(): boolean {
    const flag = this.disjointFlag;
    this.disjointFlag = false;
    return flag;
  }
  /** The GPU finished this query with the given elapsed time in ms. */
  complete(query: number, ms: number): void {
    this.results.set(query, ms * 1e6);
    this.ready.add(query);
  }
}

function frame(ledger: GpuTimerLedger<number>, brackets: string[]): void {
  for (const name of brackets) {
    ledger.begin(name);
    ledger.end();
  }
  ledger.endFrame();
}

describe('gpu timer ledger: bracket order and readback', () => {
  it('issues one query per bracket in submission order', () => {
    const backend = new FakeBackend();
    const ledger = new GpuTimerLedger(backend);
    ledger.begin('shadow');
    ledger.end();
    ledger.begin('scene');
    ledger.end();
    expect(backend.log).toEqual(['begin 1', 'end 1', 'begin 2', 'end 2']);
    expect(ledger.open).toBeNull();
  });

  it('never reads a frame back on the endFrame that submitted it, even when the backend is ready', () => {
    const backend = new FakeBackend();
    const ledger = new GpuTimerLedger(backend);
    ledger.begin('scene');
    ledger.end();
    backend.complete(1, 4);
    ledger.endFrame();
    expect(ledger.snapshot().framesResolved).toBe(0);
    expect(ledger.snapshot().pendingFrames).toBe(1);
    ledger.endFrame();
    const snap = ledger.snapshot();
    expect(snap.framesResolved).toBe(1);
    expect(snap.pendingFrames).toBe(0);
    expect(snap.brackets.scene).toEqual({ count: 1, avg: 4, p95: 4, max: 4 });
  });

  it('waits for every query of a frame and resolves oldest first', () => {
    const backend = new FakeBackend();
    const ledger = new GpuTimerLedger(backend);
    frame(ledger, ['shadow', 'scene']);
    frame(ledger, ['shadow', 'scene']);
    backend.complete(1, 1);
    backend.complete(3, 1);
    backend.complete(4, 1);
    ledger.endFrame();
    // Frame 0's scene query (2) is still out, so neither frame resolves: the
    // ring is ordered and frame 1 may not overtake frame 0.
    expect(ledger.snapshot().framesResolved).toBe(0);
    backend.complete(2, 3);
    ledger.endFrame();
    const snap = ledger.snapshot();
    expect(snap.framesResolved).toBe(2);
    expect(snap.brackets.shadow.count).toBe(2);
    expect(snap.brackets.scene).toEqual({ count: 2, avg: 2, p95: 3, max: 3 });
    expect(snap.frameSumMs).toBe(3);
  });

  it('recycles query objects once their frame resolves', () => {
    const backend = new FakeBackend();
    const ledger = new GpuTimerLedger(backend);
    frame(ledger, ['scene']);
    backend.complete(1, 1);
    ledger.endFrame();
    expect(backend.created).toEqual([1]);
    frame(ledger, ['scene']);
    expect(backend.created).toEqual([1]);
    expect(backend.log.at(-2)).toBe('begin 1');
  });

  it('closes a bracket left open at endFrame', () => {
    const backend = new FakeBackend();
    const ledger = new GpuTimerLedger(backend);
    ledger.begin('scene');
    ledger.endFrame();
    expect(backend.log).toEqual(['begin 1', 'end 1']);
    expect(ledger.open).toBeNull();
  });
});

describe('gpu timer ledger: nesting and duplicate opens', () => {
  it('throws when a bracket opens inside another (the extension cannot nest)', () => {
    const ledger = new GpuTimerLedger(new FakeBackend());
    ledger.begin('shadow');
    expect(() => ledger.begin('scene')).toThrow(/'scene' opened while 'shadow' is open/);
  });

  it('ignores a second open of the same name inside one frame, deterministically', () => {
    const backend = new FakeBackend();
    const ledger = new GpuTimerLedger(backend);
    ledger.begin('scene');
    ledger.end();
    ledger.begin('scene');
    expect(ledger.open).toBeNull();
    ledger.end();
    expect(backend.log).toEqual(['begin 1', 'end 1']);
    ledger.endFrame();
    expect(ledger.snapshot().duplicateOpens).toBe(1);
    // The next frame may open it again.
    ledger.begin('scene');
    expect(ledger.open).toBe('scene');
  });

  it('is a no-op to end with nothing open', () => {
    const backend = new FakeBackend();
    const ledger = new GpuTimerLedger(backend);
    ledger.end();
    expect(backend.log).toEqual([]);
  });
});

describe('gpu timer ledger: disjoint and overflow', () => {
  it('discards every pending frame when the GPU clock went disjoint', () => {
    const backend = new FakeBackend();
    const ledger = new GpuTimerLedger(backend);
    frame(ledger, ['scene']);
    frame(ledger, ['scene']);
    backend.complete(1, 1);
    backend.complete(2, 1);
    backend.disjointFlag = true;
    ledger.endFrame();
    const snap = ledger.snapshot();
    expect(snap.framesResolved).toBe(0);
    expect(snap.disjointFrames).toBe(2);
    expect(snap.pendingFrames).toBe(0);
    // Their queries went back to the pool.
    frame(ledger, ['scene']);
    expect(backend.created).toEqual([1, 2]);
  });

  it('drops the oldest frame unresolved when the pending ring overflows', () => {
    const backend = new FakeBackend();
    const ledger = new GpuTimerLedger(backend, GPU_TIMER_STAT_WINDOW, 2);
    frame(ledger, ['scene']);
    frame(ledger, ['scene']);
    frame(ledger, ['scene']);
    const snap = ledger.snapshot();
    expect(snap.droppedFrames).toBe(1);
    expect(snap.pendingFrames).toBe(2);
    // Frame 0's query (1) is back in the pool; the next frame reuses it.
    frame(ledger, ['scene']);
    expect(backend.created).toEqual([1, 2, 3]);
  });

  it('caps the pending ring at the exported default', () => {
    const backend = new FakeBackend();
    const ledger = new GpuTimerLedger(backend);
    for (let i = 0; i <= GPU_TIMER_PENDING_FRAMES; i++) frame(ledger, ['scene']);
    expect(ledger.snapshot().pendingFrames).toBe(GPU_TIMER_PENDING_FRAMES);
    expect(ledger.snapshot().droppedFrames).toBe(1);
  });
});

describe('gpu timer ledger: rolling stats', () => {
  it('keeps the last N frames per bracket with count, avg, p95 and max', () => {
    const backend = new FakeBackend();
    const ledger = new GpuTimerLedger(backend, 4);
    const samples = [1, 2, 3, 4, 5];
    for (const ms of samples) {
      // One bracket per frame, resolved before the next, so the pool hands
      // the same query object (1) back every frame.
      frame(ledger, ['scene']);
      backend.complete(1, ms);
      ledger.endFrame();
    }
    expect(backend.created).toEqual([1]);
    const snap = ledger.snapshot();
    // The oldest sample (1 ms) fell out of the four-frame window.
    expect(snap.brackets.scene).toEqual({ count: 4, avg: 3.5, p95: 5, max: 5 });
    expect(snap.frameSum).toEqual({ count: 4, avg: 3.5, p95: 5, max: 5 });
    expect(snap.frameSumMs).toBe(3.5);
  });

  it('sums every bracket of a frame into frameSum and reports p95 at the window', () => {
    const backend = new FakeBackend();
    const ledger = new GpuTimerLedger(backend, 100);
    for (let f = 0; f < 100; f++) {
      frame(ledger, ['shadow', 'scene']);
      const shadowQuery = backend.log[backend.log.length - 4].split(' ')[1];
      const sceneQuery = backend.log[backend.log.length - 2].split(' ')[1];
      backend.complete(Number(shadowQuery), 1);
      backend.complete(Number(sceneQuery), f < 95 ? 10 : 20);
      ledger.endFrame();
    }
    const snap = ledger.snapshot();
    expect(snap.brackets.scene.count).toBe(100);
    expect(snap.brackets.scene.p95).toBe(10);
    expect(snap.brackets.scene.max).toBe(20);
    expect(snap.frameSum.max).toBe(21);
    expect(snap.available).toBe(true);
  });

  it('reports the exported window as its default', () => {
    expect(GPU_TIMER_STAT_WINDOW).toBe(120);
  });
});

describe('gpu timer ledger: a context that cannot mint a query', () => {
  it('halts instead of throwing, keeps the table readable, and stays halted', () => {
    const backend = new FakeBackend();
    const ledger = new GpuTimerLedger(backend);
    frame(ledger, ['scene']);
    backend.complete(1, 2);
    ledger.endFrame();
    backend.contextLost = true;
    // The pooled query (1) is reused first; the second bracket needs a new one.
    ledger.begin('shadow');
    ledger.end();
    expect(() => ledger.begin('scene')).not.toThrow();
    expect(ledger.open).toBeNull();
    ledger.endFrame();
    const snap = ledger.snapshot();
    expect(snap.halted).toBe(true);
    expect(snap.brackets.scene.avg).toBe(2);
    backend.contextLost = false;
    ledger.begin('scene');
    expect(ledger.open).toBeNull();
    expect(backend.created).toEqual([1]);
  });
});

describe('gpu timer ledger: a restored context', () => {
  it('releases pooled queries the backend no longer recognises and mints live ones', () => {
    const backend = new FakeBackend();
    const ledger = new GpuTimerLedger(backend);
    frame(ledger, ['shadow', 'scene']);
    backend.complete(1, 1);
    backend.complete(2, 1);
    ledger.endFrame();
    // The context was lost and restored: both pooled queries are dead.
    backend.dead.add(1);
    backend.dead.add(2);
    ledger.begin('scene');
    expect(backend.deleted.sort()).toEqual([1, 2]);
    expect(backend.created).toEqual([1, 2, 3]);
    expect(backend.log.at(-1)).toBe('begin 3');
  });
});

describe('gpu timer ledger: dispose', () => {
  it('returns every query object and goes inert', () => {
    const backend = new FakeBackend();
    const ledger = new GpuTimerLedger(backend);
    frame(ledger, ['shadow', 'scene']);
    ledger.begin('shadow');
    ledger.dispose();
    expect(backend.deleted.sort()).toEqual([1, 2, 3]);
    ledger.begin('scene');
    ledger.end();
    ledger.endFrame();
    expect(backend.created).toEqual([1, 2, 3]);
  });
});

describe('gpu timer: pass labels and the overlay lines', () => {
  it('labels a pass and reads the label back, falling back to the unlabelled name', () => {
    const pass = {};
    expect(gpuTimerPassName(pass)).toBe(GPU_TIMER_UNLABELLED_PASS);
    expect(labelGpuTimerPass(pass, 'bloom')).toBe(pass);
    expect(gpuTimerPassName(pass)).toBe('bloom');
  });

  it('knows which brackets draw the scene and so open as shadow', () => {
    expect(gpuTimerBracketDrawsScene(GPU_TIMER_SCENE_BRACKET)).toBe(true);
    expect(gpuTimerBracketDrawsScene(GPU_TIMER_SCENE_AO_BRACKET)).toBe(true);
    expect(gpuTimerBracketDrawsScene('bloom')).toBe(false);
  });

  it('prints nothing when the probe is off or unavailable', () => {
    expect(gpuTimerOverlayLines(undefined)).toEqual([]);
    expect(gpuTimerOverlayLines(GPU_TIMER_UNAVAILABLE)).toEqual([]);
  });

  it('prints one health line plus one line per bracket', () => {
    const lines = gpuTimerOverlayLines({
      ...GPU_TIMER_UNAVAILABLE,
      available: true,
      framesResolved: 7,
      disjointFrames: 1,
      frameSumMs: 5.5,
      frameSum: { count: 7, avg: 5.5, p95: 6, max: 6.5 },
      brackets: {
        shadow: { count: 7, avg: 1, p95: 1.5, max: 2 },
        scene: { count: 7, avg: 4.5, p95: 5, max: 5.5 },
      },
    });
    expect(lines).toEqual([
      'gpu brackets 5.5/6ms  frames 7  disjoint 1',
      '  shadow 1/1.5ms  max 2  n 7',
      '  scene 4.5/5ms  max 5.5  n 7',
    ]);
  });

  it('flags a missed shadow hand-over and a halted ledger on the health line', () => {
    const lines = gpuTimerOverlayLines({
      ...GPU_TIMER_UNAVAILABLE,
      available: true,
      sceneNoHandover: 3,
      halted: true,
    });
    expect(lines).toEqual(['gpu brackets 0/0ms  frames 0  nohandover 3  HALTED']);
  });
});
