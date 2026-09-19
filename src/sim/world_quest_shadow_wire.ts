import type { WorldQuestShadowState } from './types';

const QUEST_ID = 'wq_eastbrook_shadow';
const GUARD_IDS = new Set(['2146900041', '2146900042', '2146900043', '2146900044']);

/** Saves retain only distinct authored guards, never client-supplied arbitrary IDs. */
export function sanitizeShadowCreditedObjects(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((id): id is string => typeof id === 'string' && GUARD_IDS.has(id))),
  ];
}

function bounded(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
}

/** Copy owner-only runtime state; an invalid field rejects the whole channel. */
export function decodeShadowState(
  value: unknown,
  questId: string,
): WorldQuestShadowState | undefined {
  if (questId !== QUEST_ID || !value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const state = value as Partial<WorldQuestShadowState>;
  if (
    (state.phase !== 'cloaked' && state.phase !== 'caught') ||
    !bounded(state.suspicion, 1) ||
    !bounded(state.cooldown, 60)
  )
    return undefined;
  let stealing: WorldQuestShadowState['stealing'];
  if (state.stealing !== undefined) {
    const channel = state.stealing;
    if (
      state.phase !== 'cloaked' ||
      !channel ||
      typeof channel !== 'object' ||
      Array.isArray(channel) ||
      !Number.isSafeInteger(channel.targetId) ||
      !GUARD_IDS.has(String(channel.targetId)) ||
      !bounded(channel.remaining, 60) ||
      typeof channel.x !== 'number' ||
      !Number.isFinite(channel.x) ||
      Math.abs(channel.x) > 1_000_000 ||
      typeof channel.z !== 'number' ||
      !Number.isFinite(channel.z) ||
      Math.abs(channel.z) > 1_000_000
    )
      return undefined;
    stealing = {
      targetId: channel.targetId,
      remaining: channel.remaining,
      x: channel.x,
      z: channel.z,
    };
  }
  return {
    phase: state.phase,
    suspicion: state.suspicion,
    cooldown: state.cooldown,
    ...(stealing ? { stealing } : {}),
  };
}
