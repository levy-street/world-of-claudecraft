// Rogue v0.29 spec engines (docs/design/rogue-v029-spec-engines.md), behind
// the SimContext seam: Knifework's Venom Ritual stages, Thuggery's Redline
// window with offhand echoes, and Skulduggery's Gloam bank. Every state is a
// visible aura on the player (the authoritative owner), spec-gated, cleared on
// respec or spec change, and deterministic: this module draws NO rng.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random or
// Date.now (enforced by tests/architecture.test.ts).

import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { AuraKind, Entity } from '../types';
import { DUSK_ECONOMY_AURA_ID, DUSK_ECONOMY_LINGER_SEC } from './rogue_talents';

// The veil-coupled Dusk Economy window. The discount DURING the veil comes
// from duskCostMultiplier reading the veil aura directly; this marker covers
// the veil span only. A 6+6 tail made the discount near-permanent at the
// veil cadence (measured 217 dps), so the post-veil rebuild pays full price.
function duskLingerAfterVeil(ctx: SimContext, p: Entity): void {
  const meta = p.kind === 'player' ? ctx.players.get(p.id) : undefined;
  if (!meta || ctx.playerMods(meta).global.duskEconomyPct <= 0) return;
  const span = 6;
  const existing = p.auras.find((a) => a.id === DUSK_ECONOMY_AURA_ID);
  if (existing) {
    existing.remaining = Math.max(existing.remaining, span);
    existing.duration = Math.max(existing.duration, span);
    return;
  }
  ctx.applyAura(p, {
    id: DUSK_ECONOMY_AURA_ID,
    name: 'Dusk Economy',
    kind: 'dusk_economy',
    remaining: span,
    duration: span,
    value: 0.5,
    sourceId: p.id,
    school: 'shadow',
  });
}

export const VENOM_RITUAL_ID = 'venom_ritual';
export const REDLINE_ID = 'redline';
export const GLOAM_ID = 'gloam';
export const VEILSTRIKE_ID = 'veilstrike';

export const GLOAM_STAGES = 3;
// Engines feel pass (owner playtest, 2026-07-23): stages must build at the
// cadence of the button the player presses constantly (the class-directions
// contract: Ferocity builds per Pack Command), not per rare full finisher.
//
// Two-beat pass (owner playtest, 2026-07-23 round two): at 3 stages the ritual
// armed before the FIRST full finisher of every cycle, so Dirt Nap never got
// pressed in Knifework at all and the transform read as a permanent state. Six
// stages against a five-thrust combo cycle makes the finisher alternate:
// Dirt Nap (5 stages banked), then Venomrend (armed on the next thrust).
export const VENOM_RITUAL_STAGES = 6;
const VENOM_RITUAL_DURATION = 30;
const GLOAM_DURATION = 60;
const REDLINE_DURATION = 8;
// Combo-chain pass (owner playtest, 2026-07-23 round four): passive echoes
// and refunds read as NOTHING on screen, so Redline is now a button chain.
// A full-combo Dirt Nap opens the fixed 8 sec window; inside it Wicked Slash
// transforms into Haymaker (2 combo points, each landing adds a pip, max 4)
// and Dirt Nap transforms into Lights Out, which hits harder per pip and
// ENDS the window. Cash out early and safe, or squeeze pips against the
// clock: a window that expires forfeits the Knockout entirely.
export const REDLINE_MAX_DEPTH = 4;
export const KNOCKOUT_PER_PIP = 0.25;
export const BODY_BLOW_ID = 'body_blow';
export const KNOCKOUT_ID = 'knockout_blow';
// Veilstrike arms one Veiled Edge: the first Lurker's Strike thrown from
// inside the veil strikes for double (consumed at the weaponStrike case).
export const VEILED_EDGE_ID = 'veiled_edge';
export const VEILED_EDGE_BONUS = 1;
// Every second Red Ribbon banks a Gloam stage (true-stealth openers bank one
// each; veil-window openers never do, see rogueEngineOnCast).
const GLOAM_RHYTHM_KEY = 'rog_gloam_rhythm';
const GLOAM_RHYTHM_EVERY = 2;
// Each Venom Ritual stage refunds this much energy (Knifework's builder is
// the most expensive in the class).
const VENOM_STAGE_REFUND = 15;
// Venom Dart extends the Venomrend wound (never past its fresh duration), so
// tending the wound is a button, not a race.
export const VENOM_DART_EXTEND = 6;
export const VENOM_WOUND_CAP = 20;

const DUSK_OPENER_IDS = ['ambush', 'garrote', 'cheap_shot'];

function specOf(ctx: SimContext, p: Entity): string | null {
  if (p.kind !== 'player') return null;
  const meta = ctx.players.get(p.id);
  return meta ? ctx.playerMods(meta).spec : null;
}

function addStage(
  ctx: SimContext,
  p: Entity,
  id: string,
  name: string,
  kind: AuraKind,
  duration: number,
  cap: number,
): void {
  const existing = p.auras.find((aura) => aura.id === id && aura.sourceId === p.id);
  if (existing) {
    existing.stacks = Math.min(cap, (existing.stacks ?? 1) + 1);
    existing.remaining = duration;
    existing.duration = duration;
    return;
  }
  ctx.applyAura(p, {
    id,
    name,
    kind,
    remaining: duration,
    duration,
    value: 0,
    sourceId: p.id,
    school: 'physical',
    stacks: 1,
  });
}

// Called once per resolved cast at the runEffects tail, before combo points
// reset. A full-combo Dirt Nap (the BASE finisher, never the Knockout that
// replaces it) opens Thuggery's Redline window; the Venom Ritual builds from
// Craven Thrust casts in rogueEngineOnCast instead, so a stage lands every
// few seconds, not once per full build cycle.
export function rogueEngineOnFinisher(
  ctx: SimContext,
  p: Entity,
  abilityId: string,
  spentCombo: number,
): void {
  if (spentCombo < 4) return;
  if (abilityId !== 'eviscerate') return;
  const spec = specOf(ctx, p);
  if (spec === 'combat') {
    const existing = p.auras.find((aura) => aura.id === REDLINE_ID && aura.sourceId === p.id);
    if (existing) return; // one run at a time; the window never extends
    ctx.applyAura(p, {
      id: REDLINE_ID,
      name: 'Redline',
      kind: 'redline',
      remaining: REDLINE_DURATION,
      duration: REDLINE_DURATION,
      value: KNOCKOUT_PER_PIP,
      sourceId: p.id,
      school: 'physical',
      stacks: 1,
    });
  }
}

// Called for every completed cast (beside the proc engine's cast hook):
// Knifework builds a Venom Ritual stage per builder strike; Skulduggery banks
// Gloam from true Duskveil openers and the Red Ribbon rhythm. The detonation
// itself lives in rogueGloamDetonation (pre-effects), and the detonator never
// banks: by the time this hook runs, the veil it raised is already worn.
export function rogueEngineOnCast(
  ctx: SimContext,
  p: Entity,
  abilityId: string,
  target?: Entity | null,
): void {
  const spec = specOf(ctx, p);
  if (spec === 'combat') {
    // Each Haymaker thrown inside the window deepens the run by one pip;
    // the pips are what the Knockout cashes out.
    if (abilityId === BODY_BLOW_ID) {
      const run = p.auras.find((aura) => aura.id === REDLINE_ID && aura.sourceId === p.id);
      if (run) run.stacks = Math.min(REDLINE_MAX_DEPTH, (run.stacks ?? 1) + 1);
    }
    return;
  }
  if (spec === 'assassination') {
    // A stage per knife-work strike (Craven Thrust, or the Wicked Slash
    // fallback when the angle is lost); six stages against a five-thrust
    // combo cycle alternates the finisher between Dirt Nap and Venomrend.
    // Each stage also refunds a sliver of energy: Craven Thrust is the most
    // expensive builder in the class, and the ritual pays its wielder back.
    // Venom Dart tends the wound between detonations: without it the 20 sec
    // wound races the two-cycle rend cadence and real play (Tempo refreshes,
    // target swaps) kept losing the race (owner playtest).
    if (abilityId === 'venom_dart') {
      // The dart is a builder too: it banks a ritual stage (and rides the
      // uniform stage refund), so weaving it never stalls the two-beat.
      addStage(
        ctx,
        p,
        VENOM_RITUAL_ID,
        'Venom Ritual',
        'venom_ritual',
        VENOM_RITUAL_DURATION,
        VENOM_RITUAL_STAGES,
      );
      if (p.resourceType === 'energy') {
        p.resource = Math.min(p.maxResource, p.resource + VENOM_STAGE_REFUND);
      }
      const wound = target?.auras.find((aura) => aura.id === 'venomrend' && aura.sourceId === p.id);
      if (wound) {
        wound.remaining = Math.min(VENOM_WOUND_CAP, wound.remaining + VENOM_DART_EXTEND);
        wound.duration = Math.max(wound.duration, wound.remaining);
      }
      return;
    }
    if (abilityId === 'backstab' || abilityId === 'sinister_strike') {
      addStage(
        ctx,
        p,
        VENOM_RITUAL_ID,
        'Venom Ritual',
        'venom_ritual',
        VENOM_RITUAL_DURATION,
        VENOM_RITUAL_STAGES,
      );
      // The energy refund is the THRUST's reward (Craven Thrust), not the
      // Wicked Slash fallback's. The fallback still banks a ritual stage (so
      // Venomrend keeps working when the angle is lost), but it must not
      // self-fund a spam: a non-dagger build forced onto the fallback would
      // otherwise turn the "lost the angle" button into a near-free primary
      // builder (the Thronebane exploit, docs/design/rogue-v029-spec-engines).
      if (abilityId === 'backstab' && p.resourceType === 'energy') {
        p.resource = Math.min(p.maxResource, p.resource + VENOM_STAGE_REFUND);
      }
    }
    return;
  }
  if (spec !== 'subtlety') return;
  if (DUSK_OPENER_IDS.includes(abilityId)) {
    // Only a TRUE Duskveil opener banks; an opener fired inside the veil
    // window must not seed the next bank, or every veil compounds into a
    // self-accelerating loop (measured 217 dps before this guard).
    if (!veilAllowsStealthAbilities(p)) {
      addStage(ctx, p, GLOAM_ID, 'Gloam', 'gloam', GLOAM_DURATION, GLOAM_STAGES);
    }
    return;
  }
  if (abilityId === 'hemorrhage') {
    if (!p.procState) p.procState = { counters: {}, icds: {} };
    const count = (p.procState.counters[GLOAM_RHYTHM_KEY] ?? 0) + 1;
    if (count >= GLOAM_RHYTHM_EVERY) {
      p.procState.counters[GLOAM_RHYTHM_KEY] = 0;
      addStage(ctx, p, GLOAM_ID, 'Gloam', 'gloam', GLOAM_DURATION, GLOAM_STAGES);
    } else {
      p.procState.counters[GLOAM_RHYTHM_KEY] = count;
    }
  }
}

// A full Gloam bank: what unlocks the Duskveil openers in the open (the
// casting gates read this beside the veil itself).
export function gloamBankArmed(p: Entity): boolean {
  const bank = p.auras.find((aura) => aura.id === GLOAM_ID && aura.sourceId === p.id);
  return (bank?.stacks ?? 0) >= GLOAM_STAGES;
}

// The detonation (owner playtest, round five: no transformed stealth button).
// A Duskveil opener thrown in the OPEN with a full Gloam bank consumes the
// bank and raises the shadow veil around the strike: 6 sec of half-cost
// abilities (Dusk Economy), 10% more damage, openers usable in the open, and
// one Veiled Edge so the first Lurker's Strike of the veil (including the
// detonator itself) hits for double. Called at the head of runEffects, BEFORE
// this cast's effects resolve, so the detonating strike rides its own veil.
// A true-stealth opener banks instead and never detonates.
export function rogueGloamDetonation(ctx: SimContext, p: Entity, abilityId: string): void {
  if (!DUSK_OPENER_IDS.includes(abilityId)) return;
  if (specOf(ctx, p) !== 'subtlety') return;
  if (p.auras.some((aura) => aura.kind === 'stealth')) return;
  if (veilAllowsStealthAbilities(p)) return;
  if (!gloamBankArmed(p)) return;
  const bankIndex = p.auras.findIndex((aura) => aura.id === GLOAM_ID && aura.sourceId === p.id);
  if (bankIndex < 0) return;
  const [bank] = p.auras.splice(bankIndex, 1);
  ctx.emit({ type: 'aura', targetId: p.id, name: bank.name, gained: false });
  ctx.applyAura(p, {
    id: VEILSTRIKE_ID,
    name: 'Shadow Veil',
    kind: 'buff_dmg_done',
    remaining: 6,
    duration: 6,
    value: 0.1,
    sourceId: p.id,
    school: 'shadow',
  });
  ctx.applyAura(p, {
    id: VEILED_EDGE_ID,
    name: 'Veiled Edge',
    kind: 'veiled_edge',
    remaining: 6,
    duration: 6,
    value: VEILED_EDGE_BONUS,
    sourceId: p.id,
    school: 'shadow',
  });
  duskLingerAfterVeil(ctx, p);
}

// The detonator is FREE (owner review: pooling before it was dead air). The
// armed bank pays the opener's cost; the billing sites fold this beside the
// dusk and empower-cheap multipliers. Self-limiting: the cast consumes the
// bank at runEffects, so exactly one opener per bank rides free.
export function detonatorFreeMultiplier(
  ctx: SimContext,
  p: Entity,
  abilityId: string,
): number | null {
  if (!DUSK_OPENER_IDS.includes(abilityId)) return null;
  if (specOf(ctx, p) !== 'subtlety') return null;
  if (p.auras.some((aura) => aura.kind === 'stealth')) return null;
  if (veilAllowsStealthAbilities(p)) return null;
  return gloamBankArmed(p) ? 0 : null;
}

// The Knockout cash-out: consumes the whole Redline window and returns the
// damage multiplier its pips earned (1 at a fresh window, up to 1.75 at max
// depth). Read at the finisherDamage case; ending the run here is what makes
// the window a decision instead of a passive buff. Draws no rng.
export function knockoutRedlineMult(ctx: SimContext, p: Entity, abilityId: string): number {
  if (abilityId !== KNOCKOUT_ID) return 1;
  const index = p.auras.findIndex((aura) => aura.id === REDLINE_ID && aura.sourceId === p.id);
  if (index < 0) return 1;
  const [run] = p.auras.splice(index, 1);
  ctx.emit({ type: 'aura', targetId: p.id, name: run.name, gained: false });
  return 1 + run.value * ((run.stacks ?? 1) - 1);
}

// Veiled Edge: the one-shot spike Veilstrike arms. The first Lurker's Strike
// thrown from inside the veil consumes it and strikes for double; anything
// else leaves it standing (it expires with the veil). Returns the weapon
// damage multiplier for the current cast. Draws no rng.
export function consumeVeiledEdge(ctx: SimContext, p: Entity, abilityId: string): number {
  if (abilityId !== 'ambush') return 1;
  const index = p.auras.findIndex((aura) => aura.id === VEILED_EDGE_ID && aura.sourceId === p.id);
  if (index < 0) return 1;
  const [edge] = p.auras.splice(index, 1);
  ctx.emit({ type: 'aura', targetId: p.id, name: edge.name, gained: false });
  return 1 + edge.value;
}

// Veilstrike: while the shadow-wreathed window is worn, Duskveil-only openers
// are castable in the open (the buff_dmg_done fold in damage.ts carries the
// damage side). Read at the casting_lifecycle stealth gate.
export function veilAllowsStealthAbilities(p: Entity): boolean {
  return p.auras.some((aura) => aura.id === VEILSTRIKE_ID && aura.sourceId === p.id);
}

// Respec/spec-change cleanup at the recompute choke point: engine state never
// survives leaving the spec that built it.
export function cleanRogueEngineState(
  ctx: SimContext,
  p: Entity,
  previousSpec: string | null,
  nextSpec: string | null,
): void {
  if (previousSpec === nextSpec) return;
  const engineIds = new Set([VENOM_RITUAL_ID, REDLINE_ID, GLOAM_ID, VEILSTRIKE_ID, VEILED_EDGE_ID]);
  for (let index = p.auras.length - 1; index >= 0; index--) {
    const aura = p.auras[index];
    if (aura.sourceId !== p.id || !engineIds.has(aura.id)) continue;
    p.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
  }
  if (p.procState) delete p.procState.counters[GLOAM_RHYTHM_KEY];
}

// Meta is unused today but pins the seam: engine reads stay keyed to the
// authoritative player record, never to render-side state.
export type RogueEngineMeta = PlayerMeta;
