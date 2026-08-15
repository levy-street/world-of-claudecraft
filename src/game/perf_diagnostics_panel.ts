import type { SceneCensusReport } from '../render/scene_census_core';
import { formatNumber, t, tPlural } from '../ui/i18n';
import type { PerfSnapshot } from './perf';
import {
  diagnosePerfSnapshot,
  formatPerfDiagnosisMarkdown,
  type PerfDiagnosis,
  type PerfDiagnosisFinding,
} from './perf_diagnosis_core';

const SCAN_MS = 15_000;
const MIN_SCAN_FRAMES = 30;
const DEFAULT_STATUS_COLOR = '#bae6fd';
const INTEGER_NUMBER_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };
const ONE_DECIMAL_NUMBER_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 1 };

export function localDiagnosticsCaptureEnabled(search: string, hostname: string): boolean {
  if (new URLSearchParams(search).get('diagnosticsCapture') !== '1') return false;
  const host = hostname.toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
}

export interface PerfDiagnosticsPanelOptions {
  startMeasurement(): void;
  snapshot(): PerfSnapshot;
  runSceneCensus(): SceneCensusReport | null;
  desktopShell: boolean;
}

type ScanState = 'waiting' | 'collecting' | 'complete';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', label);
  node.type = 'button';
  node.style.cssText = [
    'appearance:none',
    'border:1px solid rgba(125,211,252,.45)',
    'border-radius:7px',
    'padding:7px 10px',
    'background:#10243a',
    'color:#e0f2fe',
    'font:600 12px/1.2 system-ui,sans-serif',
    'cursor:pointer',
  ].join(';');
  node.addEventListener('click', onClick);
  return node;
}

function setButtonDisabled(node: HTMLButtonElement, disabled: boolean): void {
  node.disabled = disabled;
  node.setAttribute('aria-disabled', String(disabled));
  node.style.cursor = disabled ? 'not-allowed' : 'pointer';
  node.style.opacity = disabled ? '0.5' : '1';
}

function list(title: string, items: string[]): HTMLElement {
  const wrap = el('div');
  const heading = el('div', title);
  heading.style.cssText = 'margin-top:8px;color:#bae6fd;font-weight:700';
  wrap.appendChild(heading);
  const ul = el('ul');
  ul.style.cssText = 'margin:4px 0 0;padding-left:18px;color:#dbeafe';
  for (const item of items) {
    const li = el('li', item);
    li.style.margin = '3px 0';
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

function severityColor(finding: PerfDiagnosisFinding): string {
  if (finding.severity === 'critical') return '#fb7185';
  if (finding.severity === 'warning') return '#fbbf24';
  return '#7dd3fc';
}

function severityLabel(severity: PerfDiagnosisFinding['severity']): string {
  if (severity === 'critical') return t('hudChrome.perf.diagnostics.severity.critical');
  if (severity === 'warning') return t('hudChrome.perf.diagnostics.severity.warning');
  return t('hudChrome.perf.diagnostics.severity.info');
}

function confidenceLabel(confidence: PerfDiagnosisFinding['confidence']): string {
  if (confidence === 'high') return t('hudChrome.perf.diagnostics.confidence.high');
  if (confidence === 'medium') return t('hudChrome.perf.diagnostics.confidence.medium');
  return t('hudChrome.perf.diagnostics.confidence.low');
}

export class PerfDiagnosticsPanel {
  private readonly root = el('section');
  private readonly status = el('div');
  private readonly metrics = el('div');
  private readonly progress = el('div');
  private readonly progressFill = el('div');
  private readonly results = el('div');
  private readonly startButton: HTMLButtonElement;
  private readonly censusButton: HTMLButtonElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly downloadButton: HTMLButtonElement;
  private state: ScanState = 'waiting';
  private ready = false;
  private playable = false;
  private autoStartPending = true;

  private activeElapsedMs = 0;
  private activeSegmentStartedAt: number | null = null;
  private scanInterrupted = false;
  private diagnosis: PerfDiagnosis | null = null;
  private finalSnapshot: PerfSnapshot | null = null;
  private completedAt: string | null = null;
  private readonly onVisibilityChange = (): void => {
    if (this.state !== 'collecting') {
      this.activeSegmentStartedAt = null;
      return;
    }
    const now = performance.now();
    if (document.visibilityState !== 'visible') {
      if (this.activeSegmentStartedAt !== null) {
        this.activeElapsedMs += Math.max(0, now - this.activeSegmentStartedAt);
      }
      this.activeSegmentStartedAt = null;
      this.scanInterrupted = true;
      this.status.textContent = t('hudChrome.perf.diagnostics.status.pausedHiddenRestart');
      return;
    }
    if (this.scanInterrupted) {
      this.scanInterrupted = false;
      this.activeElapsedMs = 0;
      this.activeSegmentStartedAt = now;
      this.options.startMeasurement();
      this.startButton.textContent = t('hudChrome.perf.diagnostics.controls.scanning');
      setButtonDisabled(this.startButton, true);
      this.progressFill.style.width = '0';
      this.progress.setAttribute('aria-valuenow', '0');
      this.status.style.color = DEFAULT_STATUS_COLOR;
      this.status.textContent = t('hudChrome.perf.diagnostics.status.restoredRestart');
      return;
    }
    this.activeSegmentStartedAt = now;
  };

  constructor(private readonly options: PerfDiagnosticsPanelOptions) {
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.root.id = 'woc-diagnostics-panel';
    this.root.setAttribute('aria-label', t('hudChrome.perf.diagnostics.panelAria'));
    this.root.style.cssText = [
      'position:fixed',
      'left:14px',
      'top:14px',
      'z-index:2147483646',
      'width:min(470px,calc(100vw - 28px))',
      'max-height:calc(100vh - 28px)',
      'overflow:auto',
      'box-sizing:border-box',
      'padding:14px',
      'border:1px solid rgba(125,211,252,.42)',
      'border-radius:12px',
      'background:rgba(3,12,24,.94)',
      'color:#e0f2fe',
      'box-shadow:0 18px 70px rgba(0,0,0,.55)',
      'font:12px/1.45 system-ui,-apple-system,Segoe UI,sans-serif',
      'pointer-events:auto',
    ].join(';');

    const header = el('div');
    header.style.cssText = 'display:flex;align-items:flex-start;gap:10px';
    const titleWrap = el('div');
    titleWrap.style.flex = '1';
    const title = el('h2', t('hudChrome.perf.diagnostics.title'));
    title.style.cssText = 'margin:0;color:#f8fafc;font:700 17px/1.2 system-ui,sans-serif';
    const subtitle = el('div', t('hudChrome.perf.diagnostics.subtitle'));
    subtitle.style.cssText = 'margin-top:3px;color:#93c5fd';
    titleWrap.append(title, subtitle);
    const collapse = button(t('hudChrome.perf.diagnostics.controls.minimize'), () => {
      const collapsed = collapse.getAttribute('aria-expanded') === 'true';
      for (const child of Array.from(this.root.children).slice(1)) {
        (child as HTMLElement).hidden = collapsed;
      }
      collapse.textContent = collapsed
        ? t('hudChrome.perf.diagnostics.controls.expand')
        : t('hudChrome.perf.diagnostics.controls.minimize');
      collapse.setAttribute('aria-expanded', String(!collapsed));
    });
    collapse.setAttribute('aria-controls', 'woc-diagnostics-panel');
    collapse.setAttribute('aria-expanded', 'true');
    collapse.style.padding = '5px 8px';
    header.append(titleWrap, collapse);
    this.root.appendChild(header);

    this.status.style.cssText = [
      'margin-top:12px',
      'padding:8px 10px',
      'border-radius:8px',
      'background:#0b1f33',
      'color:#bae6fd',
      'font-weight:650',
    ].join(';');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.status);

    this.metrics.style.cssText = [
      'margin-top:8px',
      'padding:8px 10px',
      'border:1px solid rgba(148,163,184,.18)',
      'border-radius:8px',
      'background:rgba(15,23,42,.72)',
      'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'white-space:pre-wrap',
      'color:#cbd5e1',
    ].join(';');
    this.metrics.setAttribute('aria-label', t('hudChrome.perf.diagnostics.aria.liveMeasurements'));
    this.root.appendChild(this.metrics);

    this.progress.style.cssText = [
      'height:5px',
      'margin-top:10px',
      'overflow:hidden',
      'border-radius:999px',
      'background:#172554',
    ].join(';');
    this.progressFill.style.cssText =
      'width:0;height:100%;background:#38bdf8;transition:width .25s';
    this.progress.appendChild(this.progressFill);
    this.progress.setAttribute('role', 'progressbar');
    this.progress.setAttribute('aria-label', t('hudChrome.perf.diagnostics.aria.scanProgress'));
    this.progress.setAttribute('aria-valuemin', '0');
    this.progress.setAttribute('aria-valuemax', '100');
    this.progress.setAttribute('aria-valuenow', '0');
    this.root.appendChild(this.progress);

    const controls = el('div');
    controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:7px;margin-top:10px';
    this.startButton = button(t('hudChrome.perf.diagnostics.controls.start'), () => this.start());
    this.censusButton = button(t('hudChrome.perf.diagnostics.controls.refreshCensus'), () =>
      this.refreshSceneCensus(),
    );
    this.copyButton = button(t('hudChrome.perf.diagnostics.controls.copyReport'), () =>
      this.copy(),
    );
    this.downloadButton = button(t('hudChrome.perf.diagnostics.controls.downloadReport'), () =>
      this.download(),
    );
    setButtonDisabled(this.startButton, true);
    setButtonDisabled(this.censusButton, true);
    setButtonDisabled(this.copyButton, true);
    setButtonDisabled(this.downloadButton, true);
    controls.append(this.startButton, this.censusButton, this.copyButton, this.downloadButton);
    this.root.appendChild(controls);

    const instruction = el('p', t('hudChrome.perf.diagnostics.instruction'));
    instruction.style.cssText = 'margin:10px 0 0;color:#94a3b8';
    this.root.appendChild(instruction);

    this.results.style.marginTop = '12px';
    this.results.setAttribute('aria-label', t('hudChrome.perf.diagnostics.aria.findings'));
    this.root.appendChild(this.results);
    document.body.appendChild(this.root);
    this.renderWaiting();
  }

  setReady(ready: boolean): void {
    this.ready = ready;
    if (!ready) {
      this.playable = false;
      this.autoStartPending = true;
      setButtonDisabled(this.startButton, true);
      this.renderWaiting();
      return;
    }
    setButtonDisabled(this.startButton, !this.playable);
    if (this.state === 'waiting')
      this.status.textContent = t('hudChrome.perf.diagnostics.status.worldLoaded');
  }

  onMonitorReset(): void {
    if (!this.ready) return;
    this.playable = true;
    setButtonDisabled(this.startButton, false);
    if (!this.autoStartPending) return;
    this.autoStartPending = false;
    this.beginCollection();
  }

  update(snapshot: PerfSnapshot): void {
    this.renderMetrics(snapshot);
    if (this.state !== 'collecting') return;
    const now = performance.now();
    const activeMs =
      this.activeElapsedMs +
      (this.activeSegmentStartedAt !== null ? Math.max(0, now - this.activeSegmentStartedAt) : 0);
    const progressPercent = Math.round(Math.min(1, activeMs / SCAN_MS) * 100);
    this.progressFill.style.width = `${progressPercent}%`;
    this.progress.setAttribute('aria-valuenow', String(progressPercent));
    const recent = snapshot.windows.last10s;
    if (snapshot.browser.visibilityState !== 'visible') {
      this.status.textContent = t('hudChrome.perf.diagnostics.status.pausedHiddenContinue');
      return;
    }
    if (activeMs < SCAN_MS) {
      const remainingSeconds = Math.max(0, Math.ceil((SCAN_MS - activeMs) / 1000));
      this.status.textContent = tPlural(
        'hudChrome.perf.diagnostics.status.collectingRemaining',
        remainingSeconds,
        { seconds: formatNumber(remainingSeconds, INTEGER_NUMBER_FORMAT) },
      );
      return;
    }
    if (recent.frames < MIN_SCAN_FRAMES) {
      this.status.textContent = t('hudChrome.perf.diagnostics.status.waitingFrames', {
        current: formatNumber(recent.frames, INTEGER_NUMBER_FORMAT),
        minimum: formatNumber(MIN_SCAN_FRAMES, INTEGER_NUMBER_FORMAT),
      });
      return;
    }
    this.options.runSceneCensus();
    this.complete();
  }

  private start(): void {
    if (!this.ready || !this.playable) {
      this.renderWaiting();
      return;
    }
    this.autoStartPending = false;
    this.options.startMeasurement();
    this.beginCollection();
  }

  private beginCollection(): void {
    this.state = 'collecting';
    const now = performance.now();
    this.activeElapsedMs = 0;
    this.activeSegmentStartedAt = document.visibilityState === 'visible' ? now : null;
    this.scanInterrupted = false;
    this.diagnosis = null;
    this.finalSnapshot = null;
    this.completedAt = null;
    this.startButton.textContent = t('hudChrome.perf.diagnostics.controls.scanning');
    setButtonDisabled(this.startButton, true);
    setButtonDisabled(this.censusButton, true);
    setButtonDisabled(this.copyButton, true);
    setButtonDisabled(this.downloadButton, true);
    this.results.replaceChildren();
    this.progressFill.style.width = '0';
    this.progress.setAttribute('aria-valuenow', '0');
    this.status.style.color = DEFAULT_STATUS_COLOR;
    this.status.textContent = t('hudChrome.perf.diagnostics.status.collectingNow');
  }

  private complete(): void {
    if (!this.ready) return;
    this.state = 'complete';
    this.activeSegmentStartedAt = null;
    this.scanInterrupted = false;
    this.finalSnapshot = this.options.snapshot();
    this.diagnosis = diagnosePerfSnapshot(this.finalSnapshot, location.search, {
      desktopShell: this.options.desktopShell,
    });
    this.completedAt = new Date().toISOString();
    this.progressFill.style.width = '100%';
    this.progress.setAttribute('aria-valuenow', '100');
    this.startButton.textContent = t('hudChrome.perf.diagnostics.controls.scanAnother');
    setButtonDisabled(this.startButton, false);
    setButtonDisabled(this.censusButton, false);
    setButtonDisabled(this.copyButton, false);
    setButtonDisabled(this.downloadButton, false);
    this.renderDiagnosis(this.diagnosis);
    this.postLocalCapture();
  }

  private refreshSceneCensus(): void {
    if (this.state !== 'complete' || !this.finalSnapshot) return;
    const census = this.options.runSceneCensus();
    if (!census) return;
    this.finalSnapshot = { ...this.finalSnapshot, census };
    this.diagnosis = diagnosePerfSnapshot(this.finalSnapshot, location.search, {
      desktopShell: this.options.desktopShell,
    });
    this.renderDiagnosis(this.diagnosis);
  }

  private renderWaiting(): void {
    this.state = 'waiting';
    this.activeSegmentStartedAt = null;
    this.scanInterrupted = false;
    this.diagnosis = null;
    this.finalSnapshot = null;
    this.completedAt = null;
    this.startButton.textContent = t('hudChrome.perf.diagnostics.controls.start');
    setButtonDisabled(this.censusButton, true);
    setButtonDisabled(this.copyButton, true);
    setButtonDisabled(this.downloadButton, true);
    this.status.style.color = DEFAULT_STATUS_COLOR;
    this.status.textContent = this.ready
      ? t('hudChrome.perf.diagnostics.status.ready')
      : t('hudChrome.perf.diagnostics.status.waitingWorld');
    this.metrics.textContent = [
      t('hudChrome.perf.diagnostics.metrics.waitingRenderer'),
      t('hudChrome.perf.diagnostics.metrics.waitingCensus'),
      t('hudChrome.perf.diagnostics.metrics.waitingHitch'),
    ].join('\n');
    this.results.replaceChildren();
    this.progressFill.style.width = '0';
    this.progress.setAttribute('aria-valuenow', '0');
  }

  private renderMetrics(snapshot: PerfSnapshot): void {
    const renderer = snapshot.renderer;
    const hitches = snapshot.hitches;
    this.metrics.textContent = [
      t('hudChrome.perf.diagnostics.metrics.recent', {
        fps: formatNumber(snapshot.windows.last10s.fps, ONE_DECIMAL_NUMBER_FORMAT),
        p95: formatNumber(snapshot.windows.last10s.frameMs.p95, ONE_DECIMAL_NUMBER_FORMAT),
        longFrames: formatNumber(snapshot.windows.last10s.frameMs.long50, INTEGER_NUMBER_FORMAT),
      }),
      t('hudChrome.perf.diagnostics.metrics.render', {
        submit: formatNumber(renderer?.phaseMs.submit.p95 ?? 0, ONE_DECIMAL_NUMBER_FORMAT),
        world: formatNumber(renderer?.phaseMs.world.p95 ?? 0, ONE_DECIMAL_NUMBER_FORMAT),
        entities: formatNumber(renderer?.phaseMs.entities.p95 ?? 0, ONE_DECIMAL_NUMBER_FORMAT),
      }),
      t('hudChrome.perf.diagnostics.metrics.scene', {
        calls: formatNumber(renderer?.calls ?? 0, INTEGER_NUMBER_FORMAT),
        triangles: formatNumber(renderer?.triangles ?? 0, INTEGER_NUMBER_FORMAT),
        views: formatNumber(renderer?.views ?? 0, INTEGER_NUMBER_FORMAT),
      }),
      t('hudChrome.perf.diagnostics.metrics.hitches', {
        hitches: formatNumber(hitches?.hitches ?? 0, INTEGER_NUMBER_FORMAT),
        shaders: formatNumber(hitches?.byCause['shader-compile'] ?? 0, INTEGER_NUMBER_FORMAT),
        uploads: formatNumber(hitches?.byCause['texture-upload'] ?? 0, INTEGER_NUMBER_FORMAT),
        views: formatNumber(hitches?.byCause['view-create'] ?? 0, INTEGER_NUMBER_FORMAT),
      }),
      t('hudChrome.perf.diagnostics.metrics.gpu', {
        renderer:
          renderer?.glRenderer?.slice(0, 74) ??
          t('hudChrome.perf.diagnostics.metrics.waitingValue'),
      }),
    ].join('\n');
  }

  private renderDiagnosis(diagnosis: PerfDiagnosis): void {
    this.results.replaceChildren();
    const statusColor =
      diagnosis.status === 'critical'
        ? '#fb7185'
        : diagnosis.status === 'needs-attention'
          ? '#fbbf24'
          : '#4ade80';
    this.status.textContent = t('hudChrome.perf.diagnostics.scoreHeadline', {
      score: formatNumber(diagnosis.score, INTEGER_NUMBER_FORMAT),
      headline: diagnosis.headline,
    });
    this.status.style.color = statusColor;
    const summary = el('p', diagnosis.summary);
    summary.style.cssText = 'margin:0 0 10px;color:#dbeafe';
    this.results.appendChild(summary);

    if (diagnosis.findings.length === 0) {
      const healthy = el('div', t('hudChrome.perf.diagnostics.healthyNoFindings'));
      healthy.style.cssText = 'padding:10px;border-left:3px solid #4ade80;background:#071d18';
      this.results.appendChild(healthy);
      return;
    }

    diagnosis.findings.forEach((finding, index) => {
      const card = el('article');
      const color = severityColor(finding);
      card.style.cssText = [
        'margin:9px 0',
        'padding:10px 11px',
        `border-left:3px solid ${color}`,
        'border-radius:7px',
        'background:rgba(15,23,42,.86)',
      ].join(';');
      const title = el('h3', `${formatNumber(index + 1, INTEGER_NUMBER_FORMAT)}. ${finding.title}`);
      title.style.cssText = `margin:0;color:${color};font:700 13px/1.3 system-ui,sans-serif`;
      const confidence = el(
        'div',
        t('hudChrome.perf.diagnostics.findingMeta', {
          severity: severityLabel(finding.severity),
          confidence: confidenceLabel(finding.confidence),
        }),
      );
      confidence.style.cssText = 'margin-top:3px;color:#94a3b8;font-size:10px;letter-spacing:.04em';
      const cause = el('p', finding.cause);
      cause.style.cssText = 'margin:7px 0;color:#e2e8f0';
      card.append(title, confidence, cause);
      card.appendChild(list(t('hudChrome.perf.diagnostics.sections.evidence'), finding.evidence));
      card.appendChild(
        list(t('hudChrome.perf.diagnostics.sections.tryNow'), finding.immediateFixes),
      );
      card.appendChild(list(t('hudChrome.perf.diagnostics.sections.codeFix'), finding.codeFixes));
      card.appendChild(list(t('hudChrome.perf.diagnostics.sections.source'), finding.sourceFiles));
      if (finding.action) {
        const action = el('a', t('hudChrome.perf.diagnostics.controls.retestLowGraphics'));
        action.href = finding.action.href;
        action.style.cssText = 'display:inline-block;margin-top:8px;color:#7dd3fc;font-weight:700';
        card.appendChild(action);
      }
      this.results.appendChild(card);
    });
  }

  private reportText(): string | null {
    if (!this.diagnosis || !this.finalSnapshot) return null;
    return formatPerfDiagnosisMarkdown(this.diagnosis, this.finalSnapshot, {
      ...(this.completedAt ? { capturedAt: this.completedAt } : {}),
    });
  }

  private postLocalCapture(): void {
    if (!localDiagnosticsCaptureEnabled(location.search, location.hostname)) return;
    const text = this.reportText();
    if (!text) return;
    void fetch('/__diagnostics/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown;charset=UTF-8' },
      body: text,
    }).catch(() => {
      // The visible panel remains fully usable if the optional dev collector is unavailable.
    });
  }

  private copy(): void {
    const text = this.reportText();
    if (!text) return;
    const write = navigator.clipboard?.writeText(text);
    if (!write) {
      console.info('World of ClaudeCraft diagnosis:', text);
      this.copyButton.textContent = t('hudChrome.perf.diagnostics.controls.reportLogged');
      window.setTimeout(() => {
        this.copyButton.textContent = t('hudChrome.perf.diagnostics.controls.copyReport');
      }, 1400);
      return;
    }
    void write.then(
      () => {
        this.copyButton.textContent = t('hudChrome.perf.diagnostics.controls.copied');
        window.setTimeout(() => {
          this.copyButton.textContent = t('hudChrome.perf.diagnostics.controls.copyReport');
        }, 1400);
      },
      () => {
        console.info('World of ClaudeCraft diagnosis:', text);
        this.copyButton.textContent = t('hudChrome.perf.diagnostics.controls.copyBlocked');
        window.setTimeout(() => {
          this.copyButton.textContent = t('hudChrome.perf.diagnostics.controls.copyReport');
        }, 1400);
      },
    );
  }

  private download(): void {
    const text = this.reportText();
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    const anchor = el('a');
    anchor.href = url;
    anchor.download = `claudecraft-performance-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
