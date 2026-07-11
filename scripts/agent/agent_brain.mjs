// Agentic executor — a drop-in tick(ctx) for multibox.mjs.
//
//   reactive rules (reuse the proven rule-based brain)  ← runs every tick, 20 Hz
//   + apply the LLM planner's latest INTENT as overrides ← cheap, in-memory
//   + kick the planner ASYNC on a cadence/event          ← never blocks the tick
//
// Fail-safe: the planner call is fire-and-forget; if it's slow, errors, or
// disabled (AGENT_PLAN unset) the bot keeps following the last intent (or the
// pure reactive brain). A bad plan can never freeze or crash the control loop.
//
// Wire it in by pointing multibox.mjs's loadBrain() at this file (or set
// BRAIN_PATH=scripts/agent/agent_brain.mjs once that 1-line read is added).
import * as base from '../multibox_brain.mjs';
import { intentToOverrides, DEFAULT_INTENT } from './intents.mjs';
import { plan, lastIntent } from './planner.mjs';
import { summarize } from './observe.mjs';
import { collectInbound, hasUnhandled, markHandled, chatSnapshot, applySpeech, applyActions, driveTick } from './converse.mjs';

const PLAN_ENABLED = process.env.AGENT_PLAN === '1';
let currentIntent = null;
let lastPlanAt = 0;
let planning = false;

// Conversational state, persisted across ticks (single agentic bot).
const inbox = [];           // rolling buffer of chat / trade requests TO us
const sentEffects = new Set(); // dedup one-shot speech/actions within one plan
const cstate = {};          // follow / come / tradeAuto persistent flags

function planCadenceMs(ctx) { return Math.max(3000, (ctx.combat?.planEverySec ?? 8) * 1000); }

// Replan now on big state changes, not just the timer, so the agent reacts to
// deaths / fresh adds / danger / someone TALKING TO IT without waiting out the cadence.
function shouldReplan(ctx, now) {
  if (hasUnhandled(inbox)) return true;                 // a whisper/trade can't wait 8s
  if (now - lastPlanAt >= planCadenceMs(ctx)) return true;
  const lead = ctx.leader ?? ctx.bots?.[0];
  if (lead?.self?.dead && !lead.__wasDeadForPlan) { lead.__wasDeadForPlan = true; return true; }
  if (lead && !lead.self?.dead) lead.__wasDeadForPlan = false;
  return false;
}

function maybePlan(ctx, now, lead) {
  if (!PLAN_ENABLED || planning) return;
  if (!shouldReplan(ctx, now)) return;
  planning = true; lastPlanAt = now;
  const snapshot = { ...summarize(ctx), ...chatSnapshot(lead, inbox) };
  markHandled(inbox);                                   // we've shown these to the planner
  Promise.resolve(plan(snapshot))
    .then((i) => {
      if (!i) return;
      currentIntent = i;
      // a fresh plan is a fresh decision — let it speak/act again
      sentEffects.clear();
      applySpeech(lead, i, sentEffects);
      applyActions(lead, i, sentEffects, cstate);
    })
    .catch(() => {})
    .finally(() => { planning = false; });
}

export function tick(ctx) {
  const now = ctx.now ?? Date.now();
  const lead = ctx.leader ?? ctx.bots?.[0];
  if (!currentIntent) currentIntent = lastIntent() ?? DEFAULT_INTENT;

  // 0) buffer anything said/offered to us this tick (events clear every tick)
  collectInbound(lead, inbox);

  // 1) translate the current intent into the brain's override surface
  const ov = intentToOverrides(currentIntent);
  ctx.combat = { ...(ctx.combat ?? {}), ...ov };

  // 2) honour an explicit focus-target directive from the planner
  if (ov.__forceTarget && lead?.cmd && lead.self?.target !== ov.__forceTarget) {
    try { lead.cmd({ cmd: 'target', id: ov.__forceTarget }); } catch {}
  }

  // 3) persistent conversational behaviour — finish trades, and steer the grind
  //    anchor onto a player when following / coming. The grind ladder is inherited
  //    from world.json, so override ctx.grind (the brain reads it first) for THIS
  //    tick only; ctx is rebuilt each tick so cfg.grind is never mutated.
  const hint = driveTick(lead, cstate);
  if (hint.home) {
    ctx.grind = { ...(ctx.grind ?? {}), goHome: true, home: hint.home, homeRadius: hint.homeRadius ?? 6, ladder: undefined };
  }

  // 4) fire the planner async (off the hot path); speech/actions run on its resolve
  maybePlan(ctx, now, lead);

  // 5) reactive execution — the rule-based brain grinds + autoattacks every tick
  if (typeof base.tick === 'function') return base.tick(ctx);
}

// expose for the dashboard / debugging
export function _intent() { return currentIntent; }
export function _convState() { return { inbox: inbox.length, ...cstate }; }
export const TUNABLES = base.TUNABLES ?? {};
