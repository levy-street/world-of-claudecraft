'use strict';

// Pure, Node-testable helpers for the auto-updater's renderer-facing events
// (tests/electron_update_events.test.ts). The renderer only ever receives the
// minimal whitelisted payloads built here (never electron-updater's raw info
// objects, which carry URLs and file paths the page has no business seeing).

// Build the payload for one 'desktop-update-event' IPC send. Returns null for
// event types the renderer does not need.
function updateEventPayload(type, raw) {
  if (type === 'available' || type === 'downloaded') {
    const version = typeof raw?.version === 'string' ? raw.version.slice(0, 64) : '';
    return { type, version };
  }
  if (type === 'progress') {
    const percent = Number.isFinite(raw?.percent)
      ? Math.max(0, Math.min(100, Math.round(raw.percent)))
      : 0;
    return { type, percent };
  }
  return null;
}

// Throttle download-progress IPC to meaningful movement: every 10 points, plus
// the arrival at 100. electron-updater emits progress far more often than a
// toast needs.
function shouldNotifyProgress(lastPercent, percent) {
  if (!Number.isFinite(percent)) return false;
  if (lastPercent < 0) return true;
  if (percent >= 100) return lastPercent < 100;
  return percent - lastPercent >= 10;
}

module.exports = { updateEventPayload, shouldNotifyProgress };
