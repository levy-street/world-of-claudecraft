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

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

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
}

const CHOICES: Record<string, SceneChoiceDef> = {};

export function registerChoice(def: SceneChoiceDef): void {
  CHOICES[def.id] = def;
}

export function choiceById(id: string): SceneChoiceDef | undefined {
  return CHOICES[id];
}

export function choiceActiveFor(ctx: SimContext, claimId: number): boolean {
  return ctx.activeChoices.has(claimId);
}

function participants(ctx: SimContext, choice: ActiveChoice): Entity[] {
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
  for (const choice of ctx.activeChoices.values()) {
    if (choice.choiceId !== choiceId) continue;
    if (choice.leaderPid !== r.meta.entityId) return false;
    const def = CHOICES[choiceId];
    if (!def?.options.some((o) => o.id === optionId)) return false;
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
    const claimAlive = ctx.instances.some(
      (i) => i.dungeonId === choice.dungeonId && i.exitId === choice.claimId,
    );
    if (!claimAlive) {
      ctx.activeChoices.delete(choice.claimId);
      continue;
    }
    if (def.windowSeconds > 0 && ctx.time - choice.startedAt >= def.windowSeconds) {
      resolveChoice(ctx, choice, def.defaultOptionId);
    }
  }
}
