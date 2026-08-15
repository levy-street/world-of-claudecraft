import { MovableFrame, type MovableFrameConfig } from '../../movable_frame';
import type { PainterHostWriters } from '../../painter_host';
import { DoomMeterPainter } from './doom_meter_painter';
import { type DoomMeterInput, doomMeterState } from './doom_meter_view';

export const WARLOCK_DOOM_FRAME_POS_KEY = 'woc_warlock_doom_frame_pos';

export interface DoomMeter {
  paint(input: DoomMeterInput): void;
  relocalize(): void;
  reapplyPosition(): void;
  resetPosition(): void;
}

export interface DoomMeterStrings {
  label(): string;
  formatCount(value: number): string;
  formatEmptyStatus(value: string, max: string): string;
  formatStatus(value: string, max: string, seconds: number): string;
  fateThreadsLabel(): string;
  formatFateThreadsStatus(value: string, max: string): string;
}

interface DoomMeterMover {
  relocalize(): void;
  reapplyPosition(): void;
  reset(): void;
}

export interface DoomMeterMovement {
  detachedParent: HTMLElement;
  isMobileLayout(): boolean;
  createMover?(config: MovableFrameConfig): DoomMeterMover;
}

export function createDoomMeter(
  doc: Document,
  parent: HTMLElement,
  before: HTMLElement,
  writers: PainterHostWriters,
  strings: DoomMeterStrings,
  movement?: DoomMeterMovement,
): DoomMeter {
  const frame = doc.createElement('div');
  frame.id = 'warlock-doom-frame';
  frame.className = 'warlock-doom-frame';

  const root = doc.createElement('div');
  root.id = 'warlock-doom';
  root.className = 'warlock-doom';
  root.setAttribute('role', 'meter');
  root.setAttribute('aria-label', strings.label());
  root.setAttribute('aria-valuemin', '0');
  root.setAttribute('aria-valuemax', '100');

  const fill = doc.createElement('div');
  fill.className = 'warlock-doom-fill';
  fill.setAttribute('aria-hidden', 'true');

  const label = doc.createElement('span');
  label.className = 'warlock-doom-label';

  const fateThreadsRoot = doc.createElement('div');
  fateThreadsRoot.className = 'warlock-fate-threads';
  fateThreadsRoot.setAttribute('role', 'meter');
  fateThreadsRoot.setAttribute('aria-label', strings.fateThreadsLabel());
  fateThreadsRoot.setAttribute('aria-valuemin', '0');
  fateThreadsRoot.setAttribute('aria-valuemax', '3');

  const fateThreadRail = doc.createElement('span');
  fateThreadRail.className = 'warlock-fate-thread-rail';
  fateThreadRail.setAttribute('aria-hidden', 'true');
  const fateThreadEye = doc.createElement('span');
  fateThreadEye.className = 'warlock-fate-thread-eye';
  fateThreadEye.setAttribute('aria-hidden', 'true');
  const fateThreadPips = Array.from({ length: 3 }, (_, index) => {
    const pip = doc.createElement('span');
    pip.className = `warlock-fate-thread fate-${index + 1}`;
    pip.setAttribute('aria-hidden', 'true');
    return pip;
  });

  root.append(fill, label);
  fateThreadsRoot.append(fateThreadRail, fateThreadEye, ...fateThreadPips);
  frame.append(root, fateThreadsRoot);
  parent.insertBefore(frame, before);

  const createMover = movement?.createMover ?? ((config) => new MovableFrame(config));
  const mover = movement
    ? createMover({
        frame,
        storageKey: WARLOCK_DOOM_FRAME_POS_KEY,
        unlockLabelKey: 'hudChrome.warlock.doomMeterUnlock',
        lockLabelKey: 'hudChrome.warlock.doomMeterLock',
        draggingBodyClass: 'warlock-doom-frame-dragging',
        fallbackSize: { w: 300, h: 48 },
        isMobileLayout: movement.isMobileLayout,
        onPositioned(active): void {
          frame.classList.toggle('doom-detached', active);
          if (active) {
            if (frame.parentElement !== movement.detachedParent) {
              movement.detachedParent.appendChild(frame);
            }
          } else if (frame.parentElement !== parent || frame.nextElementSibling !== before) {
            parent.insertBefore(frame, before);
          }
        },
      })
    : null;

  const painter = new DoomMeterPainter(
    writers,
    frame,
    root,
    fill,
    label,
    fateThreadsRoot,
    fateThreadPips,
  );
  return {
    paint(input): void {
      if (!input.affliction) {
        painter.hide();
        return;
      }
      painter.paint(
        doomMeterState(
          input,
          strings.formatCount,
          strings.formatEmptyStatus,
          strings.formatStatus,
          strings.formatFateThreadsStatus,
        ),
      );
    },
    relocalize(): void {
      writers.setAttr(root, 'aria-label', strings.label());
      writers.setAttr(fateThreadsRoot, 'aria-label', strings.fateThreadsLabel());
      mover?.relocalize();
    },
    reapplyPosition(): void {
      mover?.reapplyPosition();
    },
    resetPosition(): void {
      mover?.reset();
    },
  };
}
