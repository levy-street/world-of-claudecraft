import {
  clearEntryProbe,
  type EntryCheckpoint,
  type EntryDiagnostics,
  stampEntryCheckpoint,
  stampEntryProbe,
} from './entry_crash_guard';

const RENDER_CHECKPOINT_INTERVAL_MS = 2_000;

const STICKY_CHECKPOINTS = new Set<EntryCheckpoint>([
  'webgl-context-lost',
  'window-error',
  'unhandled-rejection',
  'mobile-more-open',
  'settings-open',
  'character-open',
  'quest-dialog-open',
]);

const STICKY_RESETS = new Map<EntryCheckpoint, EntryCheckpoint>([
  ['webgl-context-restored', 'webgl-context-lost'],
  ['connection-restored', 'connection-lost'],
  ['mobile-more-closed', 'mobile-more-open'],
  ['settings-closed', 'settings-open'],
  ['character-closed', 'character-open'],
  ['quest-dialog-closed', 'quest-dialog-open'],
]);

export interface EntryDiagnosticPersistence {
  start: (preset: number, now: number) => void;
  checkpoint: (checkpoint: EntryCheckpoint, now: number, diagnostics: EntryDiagnostics) => void;
  clear: () => void;
}

export interface EntryDiagnosticsController {
  start: (preset: number) => void;
  checkpoint: (checkpoint: EntryCheckpoint, diagnostics?: EntryDiagnostics) => void;
  renderedFrame: (now: number) => void;
  markStable: (message?: string) => void;
  stop: (message?: string) => void;
}

const defaultPersistence: EntryDiagnosticPersistence = {
  start: stampEntryProbe,
  checkpoint: stampEntryCheckpoint,
  clear: clearEntryProbe,
};

let activeController: EntryDiagnosticsController | null = null;

export function createEntryDiagnosticsController(options: {
  baseSnapshot: () => EntryDiagnostics;
  renderSnapshot: () => EntryDiagnostics;
  persistence?: EntryDiagnosticPersistence;
  wallNow?: () => number;
  log?: (message: string, diagnostics?: EntryDiagnostics) => void;
}): EntryDiagnosticsController {
  const persistence = options.persistence ?? defaultPersistence;
  const wallNow = options.wallNow ?? Date.now;
  const log = options.log ?? ((message, diagnostics) => console.info(message, diagnostics ?? ''));
  let armed = false;
  let frame = 0;
  let nextRenderCheckpointAt = 0;
  let stickyCheckpoint: EntryCheckpoint | null = null;
  let stable = false;

  const checkpoint = (
    nextCheckpoint: EntryCheckpoint,
    diagnostics: EntryDiagnostics = options.renderSnapshot(),
  ): void => {
    if (!armed) return;
    const resetTarget = STICKY_RESETS.get(nextCheckpoint);
    if (stickyCheckpoint && STICKY_CHECKPOINTS.has(nextCheckpoint)) return;
    if (
      stickyCheckpoint &&
      resetTarget !== stickyCheckpoint &&
      !STICKY_CHECKPOINTS.has(nextCheckpoint)
    ) {
      return;
    }
    if (STICKY_CHECKPOINTS.has(nextCheckpoint)) stickyCheckpoint = nextCheckpoint;
    if (resetTarget === stickyCheckpoint) stickyCheckpoint = null;
    persistence.checkpoint(nextCheckpoint, wallNow(), diagnostics);
    log(`[entry-diag] checkpoint=${nextCheckpoint}`, diagnostics);
  };

  const controller: EntryDiagnosticsController = {
    start(preset): void {
      armed = true;
      frame = 0;
      nextRenderCheckpointAt = 0;
      stickyCheckpoint = null;
      stable = false;
      activeController = controller;
      persistence.start(preset, wallNow());
      checkpoint('scene-build-start', options.baseSnapshot());
    },
    checkpoint,
    renderedFrame(now): void {
      if (!armed || stable) return;
      frame++;
      if (frame !== 1 && now < nextRenderCheckpointAt) return;
      checkpoint(frame === 1 ? 'first-frame' : 'rendering', {
        ...options.renderSnapshot(),
        frame,
      });
      nextRenderCheckpointAt = now + RENDER_CHECKPOINT_INTERVAL_MS;
    },
    markStable(message): void {
      if (!armed || stable) return;
      checkpoint('runtime-stable');
      stable = true;
      if (message) log(message);
    },
    stop(message): void {
      if (!armed) return;
      armed = false;
      stickyCheckpoint = null;
      stable = false;
      if (activeController === controller) activeController = null;
      persistence.clear();
      if (message) log(message);
    },
  };
  return controller;
}

export function checkpointActiveEntryDiagnostics(
  checkpoint: EntryCheckpoint,
  diagnostics?: EntryDiagnostics,
): void {
  activeController?.checkpoint(checkpoint, diagnostics);
}

export function stopActiveEntryDiagnostics(message?: string): void {
  activeController?.stop(message);
}
