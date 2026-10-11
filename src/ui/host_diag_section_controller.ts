// Options > Performance > System Report: the desktop-shell-only section a
// player with performance trouble uses to produce one host diagnostic file.
// Nothing is uploaded: the shell writes a file the player chooses a folder for,
// and the player sends it on themselves.
//
// Deliberately small (owner decision): one sentence, one button, one status
// line. It used to be its own options row and its own sub-panel, with a
// contents list and a privacy paragraph; that was more room than the feature
// deserves, so it now rides at the foot of the Performance view.
//
// The thin painter half of the pure-core + thin-painter recipe
// (src/ui/CLAUDE.md): every decision about what the section SAYS lives in
// host_diag_view.ts, and everything here is nodes, one click handler, and the
// tone class the model names.
//
// COLD by contract: no requestAnimationFrame, no interval, no forced-reflow
// layout read. The run is a single awaited bridge call, so the busy state is two
// class writes rather than a driver. The button is never rebuilt and never
// natively disabled (aria-disabled plus a click guard), which is what keeps
// keyboard focus on it across a run.

import { audio } from '../game/audio';
import {
  assembleHostDiagGameInfo,
  type HostDiagGameSources,
  hostDiagAvailable,
  runDesktopHostDiag,
} from '../game/desktop_host_diag';
import { frameRateCapRowReading } from '../game/frame_cadence_wiring';
import { perfReportSessionId } from '../game/perf_reporter';
import { activeGpuRendererName, GFX, graphicsPresetLabel } from '../render/gfx';
import { zoneBiomeAt } from '../sim/world';
import { appVersionInfo } from './app_version';
import {
  type HostDiagResultModel,
  type HostDiagState,
  hostDiagIdle,
  hostDiagRunning,
  hostDiagSettled,
} from './host_diag_view';
import { getLanguage, t } from './i18n';
import { settingsCard } from './settings_controls';

/** The settings read this section needs, which the live `Settings` store
 *  satisfies structurally (all three keys are numbers). */
export interface HostDiagSettingsRead {
  get(key: 'graphicsPreset' | 'renderScale' | 'frameRateCap'): number;
}

/** The host seam. The options window's own deps bag satisfies it structurally,
 *  so the Performance panel hands what it already holds over unchanged. */
export interface HostDiagSectionDeps {
  world(): { player: { pos: { x: number; z: number } } };
  options(): { settings: HostDiagSettingsRead } | null;
}

/**
 * The game-side context the shell copies into the saved file. Resolved here
 * rather than in main.ts: every reading is either a module-level accessor or one
 * hop off the host's own deps, so the section needs no new wiring.
 *
 * `sessionId` is the load-bearing field: it is the perf-report session id, which
 * is what joins this file to the automatic performance reports of the same
 * session. `glVendor` is deliberately absent, see the module note in
 * tests/desktop_host_diag.test.ts: the vendor string lives only on the live
 * Renderer instance, which this section has no seam to, while the shell reads
 * the full adapter list from Electron itself, so nothing is lost.
 */
function gameSources(deps: HostDiagSectionDeps): HostDiagGameSources {
  const { version, build } = appVersionInfo();
  const settings = deps.options()?.settings ?? null;
  const reading = settings ? frameRateCapRowReading(settings.get('frameRateCap')) : null;
  const pos = deps.world().player.pos;
  return {
    sessionId: perfReportSessionId(),
    releaseVersion: version,
    buildId: build,
    graphicsPreset: settings ? graphicsPresetLabel(settings.get('graphicsPreset')) : null,
    gfxTier: GFX.tier,
    glRenderer: activeGpuRendererName() ?? null,
    renderScale: settings ? settings.get('renderScale') : null,
    targetFps: reading && 'fps' in reading ? reading.fps : null,
    zone: zoneBiomeAt(pos.x, pos.z),
    locale: getLanguage(),
  };
}

/**
 * Append the section to an already-mounted parent, and only on a shell that can
 * actually produce the file: `runHostDiag` shipped after the login trio, so an
 * older installed shell exposes the bridge WITHOUT it and a player there would
 * otherwise get a button that can never work. The gate lives here rather than at
 * the call site so there is exactly one of it.
 *
 * Returns nothing: the section owns its own run state for as long as its nodes
 * are connected, and a navigation away simply discards them (a settled run whose
 * nodes have gone writes nothing).
 */
export function renderHostDiagSection(parent: HTMLElement, deps: HostDiagSectionDeps): void {
  if (!hostDiagAvailable()) return;

  const card = settingsCard(parent, t('hudChrome.hostDiag.title'));

  const intro = document.createElement('div');
  intro.className = 'set-note';
  intro.textContent = t('hudChrome.hostDiag.intro');
  card.appendChild(intro);

  const action = document.createElement('div');
  action.className = 'hostdiag-action';
  const create = document.createElement('button');
  create.type = 'button';
  create.className = 'btn ui-btn ui-btn--gold';
  create.textContent = t('hudChrome.hostDiag.create');
  action.appendChild(create);
  card.appendChild(action);

  // ONE polite live region carries both the in-flight line and the verdict, so a
  // screen reader hears the run start and the run end from the same place. It is
  // created empty and stays in the DOM for the section's whole life: a region
  // inserted together with its text is not reliably announced.
  const live = document.createElement('div');
  live.className = 'hostdiag-live';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  const message = document.createElement('div');
  message.className = 'hostdiag-message';
  live.appendChild(message);
  card.appendChild(live);

  const TONE_CLASSES = ['is-success', 'is-info', 'is-error'] as const;
  const paintResult = (model: HostDiagResultModel | null): void => {
    for (const cls of TONE_CLASSES) live.classList.remove(cls);
    if (!model) {
      message.textContent = '';
      return;
    }
    live.classList.add(`is-${model.tone}`);
    // textContent, never HTML: the interpolated file name the shell handed
    // back is the one untrusted value this section prints.
    message.textContent = t(model.messageKey, model.messageValues);
  };

  let state: HostDiagState = hostDiagIdle();
  const paint = (): void => {
    const running = state.phase === 'running';
    // aria-disabled, not `disabled`: disabling the focused element drops keyboard
    // focus to the body, so a keyboard player would have to tab back after every
    // run. The click handler's own phase guard is what blocks a second run.
    create.setAttribute('aria-disabled', String(running));
    create.setAttribute('aria-busy', String(running));
    if (running) {
      for (const cls of TONE_CLASSES) live.classList.remove(cls);
      live.classList.add('is-info');
      message.textContent = t('hudChrome.hostDiag.running');
      return;
    }
    paintResult(state.result);
  };
  paint();

  create.addEventListener('click', () => {
    if (state.phase === 'running') return;
    audio.click();
    state = hostDiagRunning();
    paint();
    void runDesktopHostDiag(assembleHostDiagGameInfo(gameSources(deps))).then((result) => {
      // The run outlives a navigation away (the save dialog is the player's to
      // answer), so a settled request whose nodes have gone writes nothing.
      if (!card.isConnected) return;
      state = hostDiagSettled(result);
      paint();
    });
  });
}
