import type { PainterHostWriters } from '../../painter_host';
import { DoomMeterPainter } from './doom_meter_painter';
import { type DoomMeterInput, doomMeterState } from './doom_meter_view';

export interface DoomMeter {
  paint(input: DoomMeterInput): void;
  relocalize(): void;
}

export interface DoomMeterStrings {
  label(): string;
  formatCount(value: number): string;
  formatEmptyStatus(value: string, max: string): string;
  formatStatus(value: string, max: string, seconds: number): string;
  fateThreadsLabel(): string;
  formatFateThreadsStatus(value: string, max: string): string;
}

// Movement is deliberately NOT built here any more: the frame is a row in
// HUD_FRAME_SPECS (interface_unlock_core.ts, id 'doomMeter'), so the "Unlock
// interface" registry owns its drag, resize, hide and persistence like every
// other governed frame. The element id below is what that row resolves; the
// registry row keeps the storage key this module's pre-registry mover
// persisted under ('woc_warlock_doom_frame_pos'), so saved spots survive.
export function createDoomMeter(
  doc: Document,
  parent: HTMLElement,
  before: HTMLElement,
  writers: PainterHostWriters,
  strings: DoomMeterStrings,
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
    },
  };
}
