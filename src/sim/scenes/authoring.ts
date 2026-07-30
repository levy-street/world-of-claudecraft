import { DT } from '../types';
import { MIN_PERCEPTUAL_FADE_SECONDS } from './fade_timing';
import type { SceneDef, SceneOpDef } from './registry';

export { MIN_PERCEPTUAL_FADE_SECONDS } from './fade_timing';
// Mirrors resolveAndApply's authored-line fallback without importing the runtime.
export const SCENE_DEFAULT_LINE_SECONDS = 4;
export const DEFAULT_SCENE_RELEASE_MARGIN_SECONDS = 1;

export interface SceneBeatOffset<Beat extends string = string> {
  readonly beat: Beat;
  readonly offset: number;
}

export type SceneBeatAt<Beat extends string = string> = Beat | SceneBeatOffset<Beat> | number;

type SceneOpAt<Op, Beat extends string> = Op extends { at: number }
  ? Omit<Op, 'at'> & { at: SceneBeatAt<Beat> }
  : never;

export type SceneTimelineOpDef<Beat extends string = string> = SceneOpAt<SceneOpDef, Beat>;
export type SceneCameraShotDef = Extract<SceneOpDef, { kind: 'camera' }>['shot'];

export interface CoveredCutDef<Beat extends string = string> {
  readonly helper: 'coveredCut';
  readonly at: SceneBeatAt<Beat>;
  readonly shot: SceneCameraShotDef;
}

export interface FadeInTailDef<Beat extends string = string> {
  readonly helper: 'fadeInTail';
  readonly at: SceneBeatAt<Beat>;
  readonly dur: number;
}

export type SceneTimelineEntry<Beat extends string = string> =
  | SceneTimelineOpDef<Beat>
  | CoveredCutDef<Beat>
  | FadeInTailDef<Beat>;

type SceneBeatMap = Readonly<Record<string, number>>;

export interface SceneAuthoringDef<Beats extends SceneBeatMap> {
  readonly id: string;
  readonly beats: Beats;
  readonly timeline: readonly SceneTimelineEntry<Extract<keyof Beats, string>>[];
  readonly releaseMargin?: number;
}

export function beat<const Beat extends string>(beatName: Beat, offset = 0): SceneBeatOffset<Beat> {
  return { beat: beatName, offset };
}

export function coveredCut<const Beat extends string>(
  at: SceneBeatAt<Beat>,
  shot: SceneCameraShotDef,
): CoveredCutDef<Beat> {
  return { helper: 'coveredCut', at, shot };
}

export function fadeInTail<const Beat extends string>(
  at: SceneBeatAt<Beat>,
  dur = MIN_PERCEPTUAL_FADE_SECONDS,
): FadeInTailDef<Beat> {
  return { helper: 'fadeInTail', at, dur };
}

function assertFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite nonnegative number`);
  }
}

function validateBeats(beats: SceneBeatMap): void {
  for (const [name, at] of Object.entries(beats)) {
    assertFiniteNonnegative(at, `Scene beat "${name}"`);
  }
}

function resolveAt<Beat extends string>(at: SceneBeatAt<Beat>, beats: SceneBeatMap): number {
  if (typeof at === 'number') {
    assertFiniteNonnegative(at, 'Scene op time');
    return at;
  }

  const beatName = typeof at === 'string' ? at : at.beat;
  if (!Object.hasOwn(beats, beatName)) {
    throw new Error(`Unknown scene beat "${beatName}"`);
  }

  const offset = typeof at === 'string' ? 0 : at.offset;
  if (!Number.isFinite(offset)) {
    throw new Error(`Offset for scene beat "${beatName}" must be finite`);
  }
  const resolved = beats[beatName] + offset;
  assertFiniteNonnegative(resolved, `Resolved time for scene beat "${beatName}"`);
  return resolved;
}

function expandCoveredCut<Beat extends string>(
  entry: CoveredCutDef<Beat>,
  beats: SceneBeatMap,
): SceneOpDef[] {
  const cutAt = resolveAt(entry.at, beats);
  const requiredLeadSeconds = MIN_PERCEPTUAL_FADE_SECONDS + DT;
  if (cutAt < requiredLeadSeconds) {
    throw new Error(
      `coveredCut at ${cutAt}s requires at least ${requiredLeadSeconds}s for the fade floor`,
    );
  }
  const fadeLeadAt = cutAt - requiredLeadSeconds;
  const fadeClearAt = cutAt + DT;

  return [
    {
      at: fadeLeadAt,
      kind: 'fade',
      to: 'black',
      dur: MIN_PERCEPTUAL_FADE_SECONDS,
    },
    { at: cutAt, kind: 'fade', to: 'black', dur: 0 },
    { at: cutAt, kind: 'camera', shot: entry.shot },
    {
      at: fadeClearAt,
      kind: 'fade',
      to: 'clear',
      dur: MIN_PERCEPTUAL_FADE_SECONDS,
    },
  ];
}

function resolveTimelineOp<Beat extends string>(
  entry: SceneTimelineOpDef<Beat>,
  beats: SceneBeatMap,
): SceneOpDef {
  return { ...entry, at: resolveAt(entry.at, beats) } as SceneOpDef;
}

function opDuration(op: SceneOpDef): number {
  let duration = 0;
  if (op.kind === 'line') {
    duration = op.dur ?? SCENE_DEFAULT_LINE_SECONDS;
  } else if (op.kind === 'fade') {
    duration = op.dur;
  } else if (op.kind === 'camera' && (op.shot.kind === 'focus' || op.shot.kind === 'dolly')) {
    duration = op.shot.dur;
  }
  assertFiniteNonnegative(duration, `${op.kind} duration`);
  return duration;
}

export function buildScene<const Beats extends SceneBeatMap>(
  def: SceneAuthoringDef<Beats>,
): SceneDef {
  validateBeats(def.beats);
  const releaseMargin = def.releaseMargin ?? DEFAULT_SCENE_RELEASE_MARGIN_SECONDS;
  assertFiniteNonnegative(releaseMargin, 'Scene release margin');

  const expanded: Array<{ op: SceneOpDef; order: number; tailClear: boolean }> = [];
  let order = 0;
  for (const entry of def.timeline) {
    if ('helper' in entry && entry.helper === 'coveredCut') {
      for (const op of expandCoveredCut(entry, def.beats)) {
        expanded.push({ op, order: order++, tailClear: false });
      }
      continue;
    }
    if ('helper' in entry && entry.helper === 'fadeInTail') {
      if (!Number.isFinite(entry.dur) || entry.dur < MIN_PERCEPTUAL_FADE_SECONDS) {
        throw new Error(`fadeInTail duration must be at least ${MIN_PERCEPTUAL_FADE_SECONDS}s`);
      }
      expanded.push({
        op: {
          at: resolveAt(entry.at, def.beats),
          kind: 'fade',
          to: 'clear',
          dur: entry.dur,
        },
        order: order++,
        tailClear: true,
      });
      continue;
    }
    expanded.push({
      op: resolveTimelineOp(entry, def.beats),
      order: order++,
      tailClear: false,
    });
  }

  if (expanded.length === 0) {
    throw new Error(`Scene "${def.id}" must contain at least one op`);
  }

  expanded.sort((a, b) => a.op.at - b.op.at || a.order - b.order);
  let finalFade: (typeof expanded)[number] | undefined;
  for (const resolved of expanded) {
    if (resolved.op.kind === 'fade') finalFade = resolved;
  }
  if (
    expanded.some(({ tailClear }) => tailClear) &&
    (finalFade?.op.kind !== 'fade' || finalFade.op.to !== 'clear')
  ) {
    throw new Error(`Scene "${def.id}" has a fade after fadeInTail`);
  }

  const ops = expanded.map(({ op }) => op);
  const lastOpEnd = Math.max(...ops.map((op) => op.at + opDuration(op)));
  return {
    id: def.id,
    duration: lastOpEnd + releaseMargin,
    ops,
  };
}
