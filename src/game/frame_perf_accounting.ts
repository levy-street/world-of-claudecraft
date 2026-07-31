export type FrameMode = 'offline' | 'online';

export interface FramePerfNetworkStats {
  connected: boolean;
  snapInterval: number;
  lastSnapAge: number;
  alpha: number;
}

type FramePerfBucket = 'sim' | 'events' | 'renderer' | 'hud';

/** Narrow subset of PerfMonitor used by animation-frame accounting. */
export interface FramePerfSink {
  startTrace(): number;
  finishTrace(
    name: string,
    start: number,
    detailKey1?: string,
    detailValue1?: unknown,
    detailKey2?: string,
    detailValue2?: unknown,
    detailKey3?: string,
    detailValue3?: unknown,
    detailKey4?: string,
    detailValue4?: unknown,
  ): void;
  startTime(): number;
  finishTime(bucket: FramePerfBucket, start: number): void;
  setNetwork(stats: FramePerfNetworkStats | null): void;
}

/**
 * Reusable timing state for main.ts's online and offline frame paths.
 *
 * The caller keeps the real work inside try/finally blocks. This class owns
 * only timestamps, stable trace metadata, and the reusable network snapshot,
 * so the animation-frame path does not allocate callbacks or detail objects
 * while developer tracing is disabled.
 */
export class FramePerfAccounting {
  private traceStart = 0;
  private timeStart = 0;
  private readonly network: FramePerfNetworkStats = {
    connected: false,
    snapInterval: 0,
    lastSnapAge: -1,
    alpha: 0,
  };

  constructor(private readonly sink: FramePerfSink) {}

  beginTrace(): void {
    this.traceStart = this.sink.startTrace();
  }

  beginTimedTrace(): void {
    this.timeStart = this.sink.startTime();
    this.traceStart = this.sink.startTrace();
  }

  finishTouchLook(frameDtMs: number): void {
    this.sink.finishTrace('input.updateTouchLook', this.traceStart, 'frameDtMs', frameDtMs);
  }

  finishGamepad(frameDtMs: number): void {
    this.sink.finishTrace('input.gamepad', this.traceStart, 'frameDtMs', frameDtMs);
  }

  finishHover(active: boolean): void {
    this.sink.finishTrace('input.hoverCursor', this.traceStart, 'active', active);
  }

  finishSimTick(): void {
    this.sink.finishTrace('sim.tick', this.traceStart, 'mode', 'offline');
    this.sink.finishTime('sim', this.timeStart);
  }

  finishEvents(mode: FrameMode, events: number): void {
    this.sink.finishTrace('hud.handleEvents', this.traceStart, 'mode', mode, 'events', events);
    this.sink.finishTime('events', this.timeStart);
  }

  finishProfanityWords(words: number): void {
    this.sink.finishTrace('hud.setProfanityWords', this.traceStart, 'words', words);
  }

  finishInventoryChanged(): void {
    this.sink.finishTrace('hud.onInventoryChanged', this.traceStart);
  }

  finishCosmeticsChanged(): void {
    this.sink.finishTrace('hud.onCosmeticsChanged', this.traceStart);
  }

  finishCamera(mode: FrameMode, frameDtMs: number, alpha: number, lastSnapAge: number): void {
    if (mode === 'offline') {
      this.sink.finishTrace(
        'camera.follow',
        this.traceStart,
        'mode',
        'offline',
        'frameDtMs',
        frameDtMs,
      );
      return;
    }
    this.sink.finishTrace(
      'camera.follow',
      this.traceStart,
      'mode',
      'online',
      'alpha',
      alpha,
      'frameDtMs',
      frameDtMs,
      'lastSnapAge',
      lastSnapAge,
    );
  }

  finishRenderer(mode: FrameMode, views: number, alpha: number, frameDtMs: number): void {
    if (mode === 'offline') {
      this.sink.finishTrace(
        'renderer.sync',
        this.traceStart,
        'mode',
        'offline',
        'views',
        views,
        'alpha',
        alpha,
      );
    } else {
      this.sink.finishTrace(
        'renderer.sync',
        this.traceStart,
        'mode',
        'online',
        'views',
        views,
        'alpha',
        alpha,
        'frameDtMs',
        frameDtMs,
      );
    }
    this.sink.finishTime('renderer', this.timeStart);
  }

  finishClickMoveMarker(): void {
    this.sink.finishTrace('ui.clickMoveMarker', this.traceStart);
  }

  finishHud(mode: FrameMode): void {
    this.sink.finishTrace('hud.update', this.traceStart, 'mode', mode);
    this.sink.finishTime('hud', this.timeStart);
  }

  publishOnlineNetwork(
    connected: boolean,
    snapInterval: number,
    lastSnapAt: number,
    now: number,
    alpha: number,
  ): void {
    this.network.connected = connected;
    this.network.snapInterval = Math.round(snapInterval);
    this.network.lastSnapAge = lastSnapAt > 0 ? Math.round(now - lastSnapAt) : -1;
    this.network.alpha = Math.round(alpha * 100) / 100;
    this.sink.setNetwork(this.network);
  }

  publishOfflineNetwork(): void {
    this.sink.setNetwork(null);
  }
}
