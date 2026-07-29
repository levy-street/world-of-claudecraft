// Last Bell dialogue choices, sim side. A choice is a registered prompt
// with options; a scenario stage cues one for a story claim's audience and
// holds until it resolves. Party semantics per the campaign spec: the
// LEADER answers (solo players lead themselves), the selection broadcasts
// to everyone, and a response window with a default choice guarantees a
// scene can never deadlock.
//
// Choices color, never branch: resolving writes the def's flag (the chosen
// option id) into EVERY participant's campaignFlags, which later scenes and
// dialogue read to pick variant lines. No branching quest graphs exist.
// All prompt/option/reply text is stable i18n keys (S3).

import { MAX_SCENE_CHOICE_OPTIONS } from '../../scene_protocol';
import type { SimContext } from '../sim_context';
import type { Entity, SceneChoiceReconnectState } from '../types';

export { MAX_SCENE_CHOICE_OPTIONS } from '../../scene_protocol';

export interface SceneChoiceOptionDef {
  id: string;
  key: string;
  /** Spoken reply to this pick (emitted with the result). */
  replyKey?: string;
  replySpeaker?: string;
}

export interface SceneChoiceDef {
  id: string;
  promptKey: string;
  /** campaignFlags key the chosen option id is written under. */
  flag: string;
  options: readonly SceneChoiceOptionDef[];
  windowSeconds: number;
  defaultOptionId: string;
}

export interface ActiveChoice {
  choiceId: string;
  claimId: number;
  dungeonId: string;
  startedAt: number;
  leaderPid: number;
  /** Personal shared-world prompt (the ferry fare): the audience is exactly
   * this player, keyed -pid so claim choices never collide. Resolution
   * effects run through onResolve; campaignFlags stay untouched (a dock
   * transaction colors no story). */
  audiencePid?: number;
  /** Where the personal prompt opened; drifting off it resolves the default
   * (walking away from the dock is declining). */
  anchorX?: number;
  anchorZ?: number;
  onResolve?: (ctx: SimContext, optionId: string) => void;
  /** Prompt interpolation values retained for reconnect convergence. */
  values?: Record<string, string | number>;
}

/** A personal prompt resolves to its default once the player drifts this far
 * from where it opened (yards). */
const PERSONAL_CHOICE_DRIFT = 10;

const CHOICES: Record<string, SceneChoiceDef> = {};

export function registerChoice(def: SceneChoiceDef): void {
  if (def.options.length === 0 || def.options.length > MAX_SCENE_CHOICE_OPTIONS) {
    throw new Error(`scene choice ${def.id} must define 1..${MAX_SCENE_CHOICE_OPTIONS} options`);
  }
  CHOICES[def.id] = def;
}

export function choiceById(id: string): SceneChoiceDef | undefined {
  return CHOICES[id];
}

export function choiceActiveFor(ctx: SimContext, claimId: number): boolean {
  return ctx.activeChoices.has(claimId);
}

function participants(ctx: SimContext, choice: ActiveChoice): Entity[] {
  if (choice.audiencePid !== undefined) {
    const p = ctx.entities.get(choice.audiencePid);
    return p ? [p] : [];
  }
  const inst = ctx.instances.find(
    (i) => i.dungeonId === choice.dungeonId && i.exitId === choice.claimId,
  );
  if (!inst) return [];
  const origin = ctx.instanceOriginOf(inst);
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p) continue;
    if (Math.abs(p.pos.x - origin.x) < 120 && Math.abs(p.pos.z - origin.z) < 250) out.push(p);
  }
  return out;
}

export function startChoice(ctx: SimContext, claimId: number, choiceId: string): boolean {
  const def = CHOICES[choiceId];
  const inst = ctx.instances.find((i) => i.exitId === claimId && i.partyKey !== null);
  if (!def || !inst || ctx.activeChoices.has(claimId)) return false;
  const choice: ActiveChoice = {
    choiceId,
    claimId,
    dungeonId: inst.dungeonId,
    startedAt: ctx.time,
    leaderPid: -1,
  };
  const audience = participants(ctx, choice);
  if (audience.length === 0) return false;
  // The leader answers: the party leader when one is inside, else the first
  // participant (solo players lead themselves).
  const party = ctx.partyOf(audience[0].id);
  const leader =
    party && audience.some((p) => p.id === party.leader) ? party.leader : audience[0].id;
  choice.leaderPid = leader;
  ctx.activeChoices.set(claimId, choice);
  for (const p of audience) {
    ctx.emit({
      type: 'sceneChoice',
      choiceId: def.id,
      promptKey: def.promptKey,
      options: def.options.map((o) => ({ id: o.id, key: o.key })),
      windowSeconds: def.windowSeconds,
      defaultOptionId: def.defaultOptionId,
      leaderPid: leader,
      pid: p.id,
    });
  }
  return true;
}

// A personal shared-world choice (the ferry fare): audience of one, no claim,
// keyed -pid mirroring playSceneForPlayer. The prompt may carry interpolation
// values (the price); all resolution effects go through onResolve so an
// open-world prompt can charge and act without story-claim flag semantics.
export function startChoiceForPlayer(
  ctx: SimContext,
  pid: number,
  choiceId: string,
  opts?: {
    values?: Record<string, string | number>;
    onResolve?: (ctx: SimContext, optionId: string) => void;
  },
): boolean {
  const def = CHOICES[choiceId];
  const p = ctx.entities.get(pid);
  if (!def || !p) return false;
  const key = -pid;
  if (ctx.activeChoices.has(key)) return false;
  ctx.activeChoices.set(key, {
    choiceId,
    claimId: key,
    dungeonId: '',
    startedAt: ctx.time,
    leaderPid: pid,
    audiencePid: pid,
    anchorX: p.pos.x,
    anchorZ: p.pos.z,
    onResolve: opts?.onResolve,
    values: opts?.values,
  });
  ctx.emit({
    type: 'sceneChoice',
    choiceId: def.id,
    promptKey: def.promptKey,
    options: def.options.map((o) => ({ id: o.id, key: o.key })),
    windowSeconds: def.windowSeconds,
    defaultOptionId: def.defaultOptionId,
    leaderPid: pid,
    values: opts?.values,
    pid,
  });
  return true;
}

export function activeChoiceForPlayer(ctx: SimContext, pid: number): ActiveChoice | null {
  let active: ActiveChoice | null = null;
  for (const choice of ctx.activeChoices.values()) {
    if (!participants(ctx, choice).some((participant) => participant.id === pid)) continue;
    if (active === null || choice.startedAt >= active.startedAt) active = choice;
  }
  return active;
}

export function sceneChoiceReconnectStateFor(
  ctx: SimContext,
  pid: number,
): SceneChoiceReconnectState | null {
  const active = activeChoiceForPlayer(ctx, pid);
  if (active === null) return null;
  const def = CHOICES[active.choiceId];
  if (!def) return null;
  return {
    choiceId: def.id,
    promptKey: def.promptKey,
    options: def.options.map(({ id, key }) => ({ id, key })),
    defaultOptionId: def.defaultOptionId,
    leaderPid: active.leaderPid,
    values: active.values,
    windowSeconds: def.windowSeconds,
    remainingSeconds:
      def.windowSeconds > 0 ? Math.max(0, def.windowSeconds - (ctx.time - active.startedAt)) : null,
  };
}

export function answerActiveSceneChoiceByIndex(
  ctx: SimContext,
  optionIndex: number,
  pid?: number,
): boolean {
  if (
    !Number.isSafeInteger(optionIndex) ||
    optionIndex < 0 ||
    optionIndex >= MAX_SCENE_CHOICE_OPTIONS
  )
    return false;
  const resolved = ctx.resolve(pid);
  if (!resolved) return false;
  const active = activeChoiceForPlayer(ctx, resolved.meta.entityId);
  if (!active || active.leaderPid !== resolved.meta.entityId) return false;
  const option = CHOICES[active.choiceId]?.options[optionIndex];
  return option
    ? answerSceneChoice(ctx, active.choiceId, option.id, resolved.meta.entityId)
    : false;
}

function resolveChoice(ctx: SimContext, choice: ActiveChoice, optionId: string): void {
  const def = CHOICES[choice.choiceId];
  if (!def) {
    ctx.activeChoices.delete(choice.claimId);
    return;
  }
  const option = def.options.find((o) => o.id === optionId) ?? {
    id: def.defaultOptionId,
    key: '',
  };
  if (choice.audiencePid !== undefined) {
    // Personal arm: no campaignFlags write; the result event closes the
    // window first so the callback's own events (charge, crossing) land
    // after it in the player's stream.
    ctx.emit({
      type: 'sceneChoiceResult',
      choiceId: def.id,
      optionId: option.id,
      replyKey: 'replyKey' in option ? option.replyKey : undefined,
      replySpeaker: 'replySpeaker' in option ? option.replySpeaker : undefined,
      pid: choice.audiencePid,
    });
    ctx.activeChoices.delete(choice.claimId);
    choice.onResolve?.(ctx, option.id);
    return;
  }
  const audience = participants(ctx, choice);
  for (const p of audience) {
    // The record is personal and persistent: every participant carries the
    // outcome (campaign completion and variant lines are per member).
    ctx.players.get(p.id)?.campaignFlags.set(def.flag, option.id);
    ctx.emit({
      type: 'sceneChoiceResult',
      choiceId: def.id,
      optionId: option.id,
      replyKey: 'replyKey' in option ? option.replyKey : undefined,
      replySpeaker: 'replySpeaker' in option ? option.replySpeaker : undefined,
      pid: p.id,
    });
  }
  ctx.activeChoices.delete(choice.claimId);
}

// The wire verb: only the leader's answer counts (everyone else's click is
// ignored, matching the broadcast-with-leader-answer party semantics).
export function answerSceneChoice(
  ctx: SimContext,
  choiceId: string,
  optionId: string,
  pid?: number,
): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const def = CHOICES[choiceId];
  if (!def?.options.some((o) => o.id === optionId)) return false;
  // The answering player's own personal prompt wins first: two riders at the
  // dock share a choiceId but never a playback, so the claim scan below must
  // not see a neighbor's personal prompt and drop the answer.
  const personal = ctx.activeChoices.get(-r.meta.entityId);
  if (personal?.choiceId === choiceId) {
    resolveChoice(ctx, personal, optionId);
    return true;
  }
  for (const choice of ctx.activeChoices.values()) {
    if (choice.audiencePid !== undefined || choice.choiceId !== choiceId) continue;
    if (choice.leaderPid !== r.meta.entityId) continue;
    resolveChoice(ctx, choice, optionId);
    return true;
  }
  return false;
}

// Per-tick driver: the response window closes on the default choice so a
// scene never deadlocks on an absent leader.
export function updateChoices(ctx: SimContext): void {
  for (const choice of [...ctx.activeChoices.values()]) {
    const def = CHOICES[choice.choiceId];
    if (!def) {
      ctx.activeChoices.delete(choice.claimId);
      continue;
    }
    if (choice.audiencePid !== undefined) {
      const p = ctx.entities.get(choice.audiencePid);
      if (!p) {
        ctx.activeChoices.delete(choice.claimId);
        continue;
      }
      // Walking away from the prompt is declining.
      const dx = p.pos.x - (choice.anchorX ?? p.pos.x);
      const dz = p.pos.z - (choice.anchorZ ?? p.pos.z);
      if (dx * dx + dz * dz > PERSONAL_CHOICE_DRIFT * PERSONAL_CHOICE_DRIFT) {
        resolveChoice(ctx, choice, def.defaultOptionId);
        continue;
      }
    } else {
      const claimAlive = ctx.instances.some(
        (i) => i.dungeonId === choice.dungeonId && i.exitId === choice.claimId,
      );
      if (!claimAlive) {
        ctx.activeChoices.delete(choice.claimId);
        continue;
      }
    }
    if (def.windowSeconds > 0 && ctx.time - choice.startedAt >= def.windowSeconds) {
      resolveChoice(ctx, choice, def.defaultOptionId);
    }
  }
}
