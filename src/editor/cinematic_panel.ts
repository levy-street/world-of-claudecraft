// Thin DOM panel for deterministic scene seeking in the real editor viewport.
// The viewport owns evaluation, camera application, and capture I/O. Wall time
// enters only through advance(), where it moves the authored scrub position.

import '../sim/content/last_bell_campaign';
import type { SceneDef } from '../sim/scenes/registry';
import { registeredSceneIds, sceneById } from '../sim/scenes/registry';
import { formatNumber, t } from '../ui/i18n';
import {
  type CinematicCameraCapture,
  formatGeneratedCinematicCaptureFile,
} from './cinematic_capture_core';
import {
  advanceCinematicPlayhead,
  type CinematicScrubFrame,
  cinematicSceneOptions,
  sampleCinematicTime,
} from './cinematic_scrub_core';
import { button, el } from './dom';

export interface CinematicPanelDeps {
  evaluate(scene: SceneDef, timeSec: number): CinematicScrubFrame | null;
  setAuthoredCamera(on: boolean): void;
  capture(scene: SceneDef, timeSec: number, capturedAt: string): CinematicCameraCapture | null;
  saveCapture(capture: CinematicCameraCapture): Promise<void>;
}

export class CinematicPanel {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly collapseButton: HTMLButtonElement;
  private readonly sceneSelect: HTMLSelectElement;
  private readonly playButton: HTMLButtonElement;
  private readonly timeInput: HTMLInputElement;
  private readonly timeLabel: HTMLElement;
  private readonly authoredCameraInput: HTMLInputElement;
  private readonly fadeReadout: HTMLElement;
  private readonly letterboxReadout: HTMLElement;
  private readonly captureButton: HTMLButtonElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly output: HTMLTextAreaElement;
  private readonly status: HTMLElement;
  private readonly fadeOverlay: HTMLElement;
  private readonly options = cinematicSceneOptions(registeredSceneIds(), sceneById);
  private ready = false;
  private expanded = true;
  private playing = false;
  private playheadSec = 0;
  private sampledSec = 0;
  private source = '';

  constructor(
    parent: HTMLElement,
    private readonly deps: CinematicPanelDeps,
  ) {
    this.fadeOverlay = el('div', 'ed-cinematic-fade');
    this.fadeOverlay.setAttribute('aria-hidden', 'true');
    this.fadeOverlay.style.display = 'none';
    parent.appendChild(this.fadeOverlay);

    this.root = el('section', 'ed-cinematic');
    this.root.setAttribute('aria-label', t('editor.cinematic.title'));
    this.root.addEventListener('keydown', (event) => event.stopPropagation());
    const header = el('div', 'ed-cinematic-head');
    header.appendChild(el('h2', 'ed-cinematic-title', t('editor.cinematic.title')));
    this.collapseButton = button(t('editor.cinematic.hide'), () => this.toggleExpanded(), 'small');
    this.collapseButton.setAttribute('aria-expanded', 'true');
    header.appendChild(this.collapseButton);
    this.root.appendChild(header);

    this.body = el('div', 'ed-cinematic-body');
    const sceneLabel = el('label', 'ed-cinematic-field');
    sceneLabel.appendChild(el('span', undefined, t('editor.cinematic.scene')));
    this.sceneSelect = document.createElement('select');
    this.sceneSelect.setAttribute('aria-label', t('editor.cinematic.scene'));
    for (const option of this.options) {
      const node = document.createElement('option');
      node.value = option.id;
      node.textContent = t('editor.cinematic.sceneOption', {
        id: option.id,
        seconds: formatNumber(option.duration, {
          useGrouping: false,
          maximumFractionDigits: 2,
        }),
      });
      this.sceneSelect.appendChild(node);
    }
    this.sceneSelect.addEventListener('change', () => this.selectScene());
    sceneLabel.appendChild(this.sceneSelect);
    this.body.appendChild(sceneLabel);

    const transport = el('div', 'ed-cinematic-transport');
    this.playButton = button(t('editor.cinematic.play'), () => this.togglePlaying());
    transport.appendChild(this.playButton);
    this.timeLabel = el('span', 'ed-cinematic-time');
    transport.appendChild(this.timeLabel);
    this.body.appendChild(transport);

    this.timeInput = document.createElement('input');
    this.timeInput.type = 'range';
    this.timeInput.min = '0';
    this.timeInput.step = '0.05';
    this.timeInput.setAttribute('aria-label', t('editor.cinematic.time'));
    this.timeInput.addEventListener('input', () => {
      this.pause();
      this.playheadSec = Number(this.timeInput.value);
      this.sampledSec = sampleCinematicTime(this.playheadSec, this.scene()?.duration ?? 0);
      this.evaluate();
    });
    this.body.appendChild(this.timeInput);

    const cameraLabel = el('label', 'ed-check');
    this.authoredCameraInput = document.createElement('input');
    this.authoredCameraInput.type = 'checkbox';
    this.authoredCameraInput.checked = true;
    this.authoredCameraInput.addEventListener('change', () => {
      this.deps.setAuthoredCamera(this.authoredCameraInput.checked);
      this.evaluate();
    });
    cameraLabel.append(
      this.authoredCameraInput,
      el('span', undefined, t('editor.cinematic.authoredCamera')),
    );
    this.body.appendChild(cameraLabel);

    const readouts = el('div', 'ed-cinematic-readouts');
    this.fadeReadout = el('span');
    this.letterboxReadout = el('span');
    readouts.append(this.fadeReadout, this.letterboxReadout);
    this.body.appendChild(readouts);

    const captureRow = el('div', 'ed-row');
    this.captureButton = button(
      t('editor.cinematic.capture'),
      () => void this.capture(),
      'primary',
      t('editor.cinematic.capture'),
    );
    this.copyButton = button(t('editor.cinematic.copy'), () => void this.copySource());
    this.copyButton.disabled = true;
    captureRow.append(this.captureButton, this.copyButton);
    this.body.appendChild(captureRow);

    this.status = el('p', 'ed-cinematic-status', t('editor.cinematic.unavailable'));
    this.status.setAttribute('role', 'status');
    this.body.appendChild(this.status);
    this.output = document.createElement('textarea');
    this.output.className = 'ed-cinematic-output';
    this.output.readOnly = true;
    this.output.setAttribute('aria-label', t('editor.cinematic.output'));
    this.output.style.display = 'none';
    this.body.appendChild(this.output);
    this.root.appendChild(this.body);
    parent.appendChild(this.root);

    this.selectScene();
    this.setReady(false);
  }

  setReady(ready: boolean): void {
    this.ready = ready;
    this.sceneSelect.disabled = !ready || this.options.length === 0;
    this.playButton.disabled = !ready || this.options.length === 0;
    this.timeInput.disabled = !ready || this.options.length === 0;
    this.authoredCameraInput.disabled = !ready;
    this.captureButton.disabled = !ready || this.options.length === 0;
    if (!ready) {
      this.pause();
      this.clearFade();
      this.status.textContent = t('editor.cinematic.unavailable');
      return;
    }
    this.status.textContent = '';
    this.evaluate();
  }

  /** Called by the viewport's existing frame loop. */
  advance(deltaSec: number): void {
    const scene = this.scene();
    if (!this.ready || !this.playing || !scene) return;
    this.playheadSec = advanceCinematicPlayhead(this.playheadSec, deltaSec, scene.duration);
    const sampled = sampleCinematicTime(this.playheadSec, scene.duration);
    if (sampled !== this.sampledSec) {
      this.sampledSec = sampled;
      this.evaluate();
    }
    if (this.playheadSec >= scene.duration) this.pause();
  }

  pause(): void {
    this.playing = false;
    this.playButton.textContent = t('editor.cinematic.play');
  }

  dispose(): void {
    this.pause();
    this.fadeOverlay.remove();
    this.root.remove();
  }

  private scene(): SceneDef | null {
    return sceneById(this.sceneSelect.value) ?? null;
  }

  private selectScene(): void {
    this.pause();
    this.playheadSec = 0;
    this.sampledSec = 0;
    const scene = this.scene();
    this.timeInput.max = String(scene?.duration ?? 0);
    this.timeInput.value = '0';
    this.evaluate();
  }

  private toggleExpanded(): void {
    this.expanded = !this.expanded;
    this.body.style.display = this.expanded ? '' : 'none';
    this.collapseButton.textContent = t(
      this.expanded ? 'editor.cinematic.hide' : 'editor.cinematic.show',
    );
    this.collapseButton.setAttribute('aria-expanded', this.expanded ? 'true' : 'false');
  }

  private togglePlaying(): void {
    if (!this.ready) return;
    const scene = this.scene();
    if (!scene) return;
    if (this.playing) {
      this.pause();
      return;
    }
    if (this.playheadSec >= scene.duration) {
      this.playheadSec = 0;
      this.sampledSec = 0;
      this.evaluate();
    }
    this.playing = true;
    this.playButton.textContent = t('editor.cinematic.pause');
  }

  private evaluate(): void {
    const scene = this.scene();
    this.timeInput.value = String(this.sampledSec);
    this.timeLabel.textContent = t('editor.cinematic.timeReadout', this.formatTime(scene));
    if (!this.ready || !scene) return;
    const frame = this.deps.evaluate(scene, this.sampledSec);
    if (!frame) return;
    const percent = formatNumber(frame.overlay.fadeOpacity * 100, {
      useGrouping: false,
      maximumFractionDigits: 0,
    });
    this.fadeReadout.textContent = t('editor.cinematic.fade', { percent });
    this.letterboxReadout.textContent = t(
      frame.overlay.letterbox ? 'editor.cinematic.letterboxOn' : 'editor.cinematic.letterboxOff',
    );
    if (frame.overlay.fadeOpacity <= 0) {
      this.clearFade();
    } else {
      this.fadeOverlay.style.display = '';
      this.fadeOverlay.style.opacity = String(frame.overlay.fadeOpacity);
    }
  }

  private formatTime(scene: SceneDef | null): { current: string; duration: string } {
    const current = formatNumber(this.sampledSec, {
      useGrouping: false,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const duration = formatNumber(scene?.duration ?? 0, {
      useGrouping: false,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return { current, duration };
  }

  private clearFade(): void {
    this.fadeOverlay.style.display = 'none';
    this.fadeOverlay.style.opacity = '0';
  }

  private async capture(): Promise<void> {
    const scene = this.scene();
    if (!scene || !this.ready) return;
    const capture = this.deps.capture(scene, this.sampledSec, new Date().toISOString());
    if (!capture) {
      this.status.textContent = t('editor.cinematic.seedMismatch');
      return;
    }
    this.source = formatGeneratedCinematicCaptureFile(capture);
    this.output.value = this.source;
    this.output.style.display = '';
    this.copyButton.disabled = false;
    const copied = await this.copySource();
    try {
      await this.deps.saveCapture(capture);
      this.status.textContent = t(
        copied ? 'editor.cinematic.captureSavedCopied' : 'editor.cinematic.captureSaved',
      );
    } catch {
      this.status.textContent = t(
        copied ? 'editor.cinematic.captureCopyOnly' : 'editor.cinematic.captureReady',
      );
    }
  }

  private async copySource(): Promise<boolean> {
    if (!this.source) return false;
    try {
      await navigator.clipboard.writeText(this.source);
      return true;
    } catch {
      this.output.focus();
      this.output.select();
      return false;
    }
  }
}
