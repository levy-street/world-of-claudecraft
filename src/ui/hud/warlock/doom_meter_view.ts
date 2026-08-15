import type { Aura } from '../../../sim/types';

const DOOM_MAX = 100;
const FATE_THREAD_MAX = 3;
const WARNING_SECONDS = 5;

export interface AfflictionAuraCarrier {
  auras: readonly Aura[];
}

export interface DoomMeterState {
  visible: boolean;
  value: number;
  fillFrac: number;
  warning: boolean;
  ready: boolean;
  fateThreads: number;
  fateThreadsReady: boolean;
  label: string;
  ariaValueText: string;
  fateThreadsAriaValueText: string;
}

export interface DoomMeterInput {
  affliction: boolean;
  auras: readonly Aura[];
  fateThreads?: number;
}

export function afflictionFateThreadCount(
  entities: Iterable<AfflictionAuraCarrier>,
  sourceId: number,
): number {
  for (const entity of entities) {
    let primaryEye = false;
    let threads = 0;
    for (const aura of entity.auras) {
      if (aura.sourceId !== sourceId) continue;
      if (aura.kind === 'affliction_eye') primaryEye = true;
      if (aura.kind === 'affliction_fate_threads') {
        threads = aura.stacks ?? Math.round(aura.value);
      }
    }
    if (primaryEye) return Math.max(0, Math.min(FATE_THREAD_MAX, Math.round(threads)));
  }
  return 0;
}

export function doomMeterState(
  input: DoomMeterInput,
  formatCount: (value: number) => string,
  formatEmptyStatus: (value: string, max: string) => string,
  formatStatus: (value: string, max: string, seconds: number) => string,
  formatFateThreadsStatus: (value: string, max: string) => string = (value, max) =>
    `${value} / ${max}`,
): DoomMeterState {
  const aura = input.auras.find((candidate) => candidate.kind === 'affliction_doom');
  const value = Math.max(0, Math.min(DOOM_MAX, Math.round(aura?.stacks ?? aura?.value ?? 0)));
  const fateThreads = Math.max(0, Math.min(FATE_THREAD_MAX, Math.round(input.fateThreads ?? 0)));
  const remaining = Math.max(0, aura?.remaining ?? 0);
  const valueLabel = formatCount(value);
  const maxLabel = formatCount(DOOM_MAX);
  const fateThreadsLabel = formatCount(fateThreads);
  const fateThreadMaxLabel = formatCount(FATE_THREAD_MAX);
  return {
    visible: input.affliction,
    value,
    fillFrac: value / DOOM_MAX,
    warning: value > 0 && remaining <= WARNING_SECONDS,
    ready: value >= DOOM_MAX,
    fateThreads,
    fateThreadsReady: fateThreads >= FATE_THREAD_MAX,
    label: `${valueLabel} / ${maxLabel}`,
    ariaValueText:
      value > 0
        ? formatStatus(valueLabel, maxLabel, Math.ceil(remaining))
        : formatEmptyStatus(valueLabel, maxLabel),
    fateThreadsAriaValueText: formatFateThreadsStatus(fateThreadsLabel, fateThreadMaxLabel),
  };
}
