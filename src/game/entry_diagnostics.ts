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

// Checkpoints that REPEAT during an ordinary session: the 2-second render
// heartbeat, and the window open/close pairs a player toggles all game long.
// They still stamp the crash probe (that is what actually diagnoses a failed
// entry after the fact) but they do not echo to the console, where they were
// the bulk of the client's log volume and drowned out the one-shot entry
// breadcrumbs that a load-failure report is actually read for.
const QUIET_CHECKPOINTS = new Set<EntryCheckpoint>([
  'rendering',
  'mobile-more-open',
  'mobile-more-closed',
  'settings-open',
  'settings-closed',
  'character-open',
  'character-closed',
  'quest-dialog-open',
  'quest-dialog-closed',
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
  suspend: () => void;
  resume: () => void;
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
  let suspended = false;
  let activePreset = 0;
  let lastCheckpoint: EntryCheckpoint | null = null;
  let lastDiagnostics: EntryDiagnostics = {};
  let stableOnResume = false;
  let stableOnResumeMessage: string | undefined;

  const checkpoint = (
    nextCheckpoint: EntryCheckpoint,
    diagnostics: EntryDiagnostics = options.renderSnapshot(),
  ): void => {
    if (!armed || suspended) return;
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
    // Tracked for every checkpoint, quiet or not: the foreground resume path
    // below re-stamps the last one, so skipping this for quiet checkpoints
    // would silently drop the most recent breadcrumb from a resumed session.
    lastCheckpoint = nextCheckpoint;
    lastDiagnostics = diagnostics;
    if (!QUIET_CHECKPOINTS.has(nextCheckpoint)) {
      log(`[entry-diag] checkpoint=${nextCheckpoint}`, diagnostics);
    }
  };

  const controller: EntryDiagnosticsController = {
    start(preset): void {
      armed = true;
      suspended = false;
      activePreset = preset;
      frame = 0;
      nextRenderCheckpointAt = 0;
      stickyCheckpoint = null;
      stable = false;
      lastCheckpoint = null;
      lastDiagnostics = {};
      stableOnResume = false;
      stableOnResumeMessage = undefined;
      activeController = controller;
      persistence.start(preset, wallNow());
      checkpoint('scene-build-start', options.baseSnapshot());
    },
    checkpoint,
    renderedFrame(now): void {
      if (!armed || suspended || stable) return;
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
      if (suspended) {
        stableOnResume = true;
        stableOnResumeMessage = message;
        return;
      }
      checkpoint('runtime-stable');
      stable = true;
      if (message) log(message);
    },
    suspend(): void {
      if (!armed || suspended) return;
      suspended = true;
      persistence.clear();
    },
    resume(): void {
      if (!armed || !suspended) return;
      suspended = false;
      persistence.start(activePreset, wallNow());
      if (lastCheckpoint) {
        persistence.checkpoint(lastCheckpoint, wallNow(), lastDiagnostics);
      }
      if (stableOnResume) {
        const message = stableOnResumeMessage;
        stableOnResume = false;
        stableOnResumeMessage = undefined;
        controller.markStable(message);
      }
    },
    stop(message): void {
      if (!armed) return;
      armed = false;
      suspended = false;
      stickyCheckpoint = null;
      stable = false;
      lastCheckpoint = null;
      lastDiagnostics = {};
      stableOnResume = false;
      stableOnResumeMessage = undefined;
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

export function suspendActiveEntryDiagnostics(): void {
  activeController?.suspend();
}

export function resumeActiveEntryDiagnostics(): void {
  activeController?.resume();
}
