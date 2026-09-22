// The Shardpike prompt (src/ui/hud/shardpike/shardpike_prompt_view.ts) and the aim reticle's
// state ladder (src/render/eye_ward_marker_core.ts).
//
// Both exist to answer one complaint: the mechanic did not say what it wanted. So what is
// worth pinning is not the wording, it is the PRIORITY. Every one of these states is true at
// the same time in a real fight (pike in hand AND boss in range AND ward up AND beam
// drifting AND a seal ticking), so the only thing separating a prompt that teaches the fight
// from one that adds noise is which of them wins. A reordering is silent: every line still
// renders, still reads correctly, and still describes something true.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EYE_WARD_BURST_SECONDS,
  eyeWardBadgeId,
  eyeWardBurstAt,
  eyeWardMarkerAlpha,
  eyeWardMarkerPlan,
  eyeWardStateOf,
} from '../src/render/eye_ward_marker_core';
import {
  SHARDPIKE_DANGER_BALANCE,
  SHARDPIKE_ITEM_ID,
  shardpikeBarState,
  shardpikePromptSignature,
  shardpikePromptState,
} from '../src/ui/hud/shardpike';
import type { LanceGuidanceView, LanceTrialView } from '../src/world_api';

const guide = (over: Partial<LanceGuidanceView> = {}): LanceGuidanceView => ({
  targetPresent: true,
  targetDistance: 8,
  inRange: true,
  vulnerable: true,
  blinded: false,
  blindRemaining: 0,
  sealRemaining: 0,
  thrusts: 0,
  ...over,
});

const trial = (over: Partial<LanceTrialView> = {}): LanceTrialView => ({
  phase: 'bracing',
  balance: 0,
  setProgress: 0.4,
  windowRemaining: 0,
  ...over,
});

const state = (over: Record<string, unknown> = {}) =>
  shardpikePromptState({
    mainhandItemId: SHARDPIKE_ITEM_ID,
    trial: null,
    guidance: guide(),
    restRemaining: 0,
    dead: false,
    ...over,
  });

describe('the prompt only exists for someone who can act on it', () => {
  it('is hidden without the pike in hand', () => {
    // A ring and a shouted instruction on every player's screen for a mechanic only the
    // pike-carrier can perform is noise for the whole raid.
    expect(state({ mainhandItemId: 'iron_sword' }).visible).toBe(false);
    expect(state({ mainhandItemId: null }).visible).toBe(false);
    expect(state({ mainhandItemId: undefined }).visible).toBe(false);
  });

  it('shows for the wielder even with no boss anywhere near', () => {
    // The resting line carries the pike's PURPOSE, which is the one thing a player wants
    // answered before the fight rather than during it.
    const s = state({ guidance: guide({ targetPresent: false, targetDistance: null }) });
    expect(s.visible).toBe(true);
    expect(s.bodyKey).toBe('hudChrome.shardpike.promptFindBoss');
  });

  it('goes quiet while dead', () => {
    expect(state({ dead: true }).visible).toBe(false);
  });
});

describe('the priority ladder', () => {
  it('puts STRIKE above everything, because the window is the only thing that expires', () => {
    // Deliberately stacked against it: drifting beam, a seal running, a rest timer, out of
    // range. The set window still wins, because every other rung describes a state that
    // will still be there in a second and this one will not.
    const s = state({
      trial: trial({ phase: 'steadied', balance: 0.9, windowRemaining: 1.2 }),
      guidance: guide({ inRange: false, sealRemaining: 30, blinded: true }),
      restRemaining: 5,
    });
    expect(s.bodyKey).toBe('hudChrome.shardpike.promptStrike');
    expect(s.tone).toBe('urgent');
    expect(s.values.seconds).toBe('2');
  });

  it('warns about the beam before it goes over, and only when it is actually near a rail', () => {
    const calm = state({ trial: trial({ balance: 0 }) });
    expect(calm.bodyKey).toBe('hudChrome.shardpike.promptHoldSteady');
    expect(calm.tone).toBe('active');
    const drifting = state({ trial: trial({ balance: SHARDPIKE_DANGER_BALANCE }) });
    expect(drifting.bodyKey).toBe('hudChrome.shardpike.promptCatchIt');
    expect(drifting.tone).toBe('urgent');
    // Either rail: the beam is symmetric and so is the warning.
    expect(state({ trial: trial({ balance: -SHARDPIKE_DANGER_BALANCE }) }).bodyKey).toBe(
      'hudChrome.shardpike.promptCatchIt',
    );
  });

  it('tells a player to STOP poking once the eye is already out', () => {
    // Above "brace" on purpose: a wielder who keeps re-bracing during the window is wasting
    // the fourteen seconds they just bought the entire raid.
    const s = state({ guidance: guide({ blinded: true, blindRemaining: 9.2 }) });
    expect(s.bodyKey).toBe('hudChrome.shardpike.promptEyeOut');
    expect(s.tone).toBe('success');
    expect(s.values.seconds).toBe('10');
  });

  it('names the seal as the reason the thrust is refusing', () => {
    // Without this rung the mechanic looks broken for forty seconds, which is the single
    // most likely way a player concludes the pike does not work and drops it.
    const s = state({ guidance: guide({ vulnerable: false, sealRemaining: 21.4 }) });
    expect(s.bodyKey).toBe('hudChrome.shardpike.promptSealed');
    expect(s.values.seconds).toBe('22');
  });

  it('sends the player closer before telling them to brace', () => {
    const s = state({ guidance: guide({ inRange: false, targetDistance: 31 }) });
    expect(s.bodyKey).toBe('hudChrome.shardpike.promptCloser');
    expect(s.values.yards).toBe('31');
    expect(s.tone).toBe('directive');
  });

  it('says brace only when bracing is genuinely the next thing to do', () => {
    const s = state();
    expect(s.bodyKey).toBe('hudChrome.shardpike.promptBrace');
    expect(s.tone).toBe('directive');
  });

  it('never counts a live timer down to zero while it is still running', () => {
    // A "0s" on screen while the window is open reads as expired and stops the player
    // pressing, which loses exactly the attempt the line exists to save.
    const s = state({ trial: trial({ phase: 'steadied', windowRemaining: 0.04 }) });
    expect(s.values.seconds).toBe('1');
  });
});

describe('the tally', () => {
  it('is hidden at zero and shown from the first landed thrust', () => {
    // A "0" beside a first-timer's prompt reads as a failure before they have had a chance
    // to do anything.
    expect(state().thrusts).toBeNull();
    expect(state({ guidance: guide({ thrusts: 1 }) }).thrusts).toBe(1);
    expect(state({ guidance: guide({ thrusts: 7 }) }).thrusts).toBe(7);
  });

  it('survives into the hidden-while-dead state, so a death does not read as a reset', () => {
    expect(state({ dead: true, guidance: guide({ thrusts: 3 }) }).thrusts).toBe(3);
  });
});

describe('the signature gate', () => {
  it('changes when the line does and holds when it does not', () => {
    const a = state();
    expect(shardpikePromptSignature(a)).toBe(shardpikePromptSignature(state()));
    expect(shardpikePromptSignature(a)).not.toBe(
      shardpikePromptSignature(state({ guidance: guide({ inRange: false, targetDistance: 20 }) })),
    );
    // ...including on the countdown, which is the whole reason the painter is gated: the
    // seconds value must be part of the key or the clock freezes on screen.
    const one = state({ guidance: guide({ vulnerable: false, sealRemaining: 21 }) });
    const two = state({ guidance: guide({ vulnerable: false, sealRemaining: 20 }) });
    expect(shardpikePromptSignature(one)).not.toBe(shardpikePromptSignature(two));
  });
});

describe('the reticle on his eye', () => {
  it('reads the ward off the aura list, and reports nothing for an unwarded creature', () => {
    expect(eyeWardStateOf([{ id: 'eye_ward' }])).toBe('up');
    expect(eyeWardStateOf([{ id: 'eye_ward_blinded' }])).toBe('down');
    // Blinded wins even while the ward aura is still listed: the two overlap for a tick
    // during the reconcile, and showing "aim here" at a socket that is already out is the
    // wrong half of that pair.
    expect(eyeWardStateOf([{ id: 'eye_ward' }, { id: 'eye_ward_blinded' }])).toBe('down');
    expect(eyeWardStateOf([{ id: 'stoneskin' }])).toBeNull();
    expect(eyeWardStateOf([])).toBeNull();
    expect(eyeWardStateOf(undefined)).toBeNull();
  });

  it('stays visible out of range, and opens up as you approach', () => {
    // The teaching move: a marker that vanishes when you step back says nothing about where
    // to stand, while one that tightens as you close says it without a word.
    const far = eyeWardMarkerPlan('aim', 'up', false, false);
    const near = eyeWardMarkerPlan('aim', 'up', false, true);
    expect(far.state).toBe('open');
    expect(near.state).toBe('open');
    expect(near.radiusScale).toBeLessThan(far.radiusScale);
    expect(near.alpha).toBeGreaterThan(far.alpha);
    expect(near.pulseHz).toBeGreaterThan(far.pulseHz);
  });

  it('gives each state its own colour, so the ring is never ambiguous', () => {
    const open = eyeWardMarkerPlan('aim', 'up', false, true);
    const shut = eyeWardMarkerPlan('aim', 'up', true, true);
    const blind = eyeWardMarkerPlan('aim', 'down', false, true);
    expect(new Set([open.color, shut.color, blind.color]).size).toBe(3);
    // A sealed eye must not invite a press: dimmer and slower than the open one.
    expect(shut.alpha).toBeLessThan(open.alpha);
    expect(shut.pulseHz).toBeLessThan(open.pulseHz);
  });

  it('breathes, and holds still under reduced motion', () => {
    const p = eyeWardMarkerPlan('aim', 'up', false, true);
    // A QUARTER period apart: a half period from zero samples the sine's two zero
    // crossings, which are identical and would pass over a completely static ring.
    const a = eyeWardMarkerAlpha(p, 0);
    const b = eyeWardMarkerAlpha(p, 1 / (p.pulseHz * 4));
    expect(a).not.toBeCloseTo(b, 3);
    expect(eyeWardMarkerAlpha(p, 0, true)).toBe(p.alpha);
    expect(eyeWardMarkerAlpha(p, 9.9, true)).toBe(p.alpha);
  });

  it('never drives the ring negative or opaque anywhere in its cycle', () => {
    for (const p of [
      eyeWardMarkerPlan('aim', 'up', false, true),
      eyeWardMarkerPlan('aim', 'up', true, false),
      eyeWardMarkerPlan('aim', 'down', false, true),
    ]) {
      for (let t = 0; t < 4; t += 0.017) {
        const a = eyeWardMarkerAlpha(p, t);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('the landed-thrust burst', () => {
  it('expands while it fades, and is gone at the end of its life', () => {
    const start = eyeWardBurstAt(0);
    const mid = eyeWardBurstAt(EYE_WARD_BURST_SECONDS / 2);
    expect(start).not.toBeNull();
    expect(mid).not.toBeNull();
    if (!start || !mid) return;
    expect(mid.radiusScale).toBeGreaterThan(start.radiusScale);
    expect(mid.alpha).toBeLessThan(start.alpha);
    expect(eyeWardBurstAt(EYE_WARD_BURST_SECONDS)).toBeNull();
    expect(eyeWardBurstAt(-0.1)).toBeNull();
  });

  it('thins out rather than ending as a big bright disc', () => {
    // Alpha falling faster than the radius grows is what makes this read as an impact
    // rather than as a growing bubble.
    const late = eyeWardBurstAt(EYE_WARD_BURST_SECONDS * 0.9);
    expect(late).not.toBeNull();
    if (!late) return;
    expect(late.radiusScale).toBeGreaterThan(5);
    expect(late.alpha).toBeLessThan(0.05);
  });

  it('is short enough to mark an instant rather than become a state', () => {
    expect(EYE_WARD_BURST_SECONDS).toBeLessThan(1.5);
  });
});

describe('the ward state every player can read', () => {
  // The reported bug this closes: the ring and badge used to require the pike in hand, so
  // the twenty players doing the damage were never told the ward was down. They are exactly
  // the people the window exists for.
  it('shows the state to a viewer with no pike, and only aims for the wielder', () => {
    for (const ward of ['up', 'down'] as const) {
      expect(eyeWardMarkerPlan('state', ward, false, false).role).toBe('state');
      expect(eyeWardMarkerPlan('aim', ward, false, false).role).toBe('aim');
    }
  });

  it('is loud about the blind window in BOTH roles', () => {
    // Equally visible with and without a pike: this is not an instruction, it is the fight's
    // damage window, and a non-wielder must not get a quieter version of it.
    const asState = eyeWardMarkerPlan('state', 'down', false, false);
    const asAim = eyeWardMarkerPlan('aim', 'down', false, true);
    expect(asState.state).toBe('blinded');
    expect(asAim.state).toBe('blinded');
    expect(asState.alpha).toBe(asAim.alpha);
    expect(asState.pulseHz).toBe(asAim.pulseHz);
    // ...and louder than the merely-warded state a non-wielder sees the rest of the time.
    expect(asState.alpha).toBeGreaterThan(eyeWardMarkerPlan('state', 'up', false, false).alpha);
  });

  it('keeps the non-wielder ring quiet while he is merely shielded', () => {
    // A permanent bright ring for the minutes he is simply warded would train people to
    // ignore it, which would cost them the window it exists to announce.
    const state = eyeWardMarkerPlan('state', 'up', false, false);
    const aimInReach = eyeWardMarkerPlan('aim', 'up', false, true);
    expect(state.alpha).toBeLessThan(aimInReach.alpha);
    expect(state.pulseHz).toBeLessThan(aimInReach.pulseHz);
  });

  it('picks a badge that answers "can I hurt him yet"', () => {
    expect(eyeWardBadgeId(eyeWardMarkerPlan('state', 'down', false, false))).toBe(
      'eye_ward_blinded',
    );
    expect(eyeWardBadgeId(eyeWardMarkerPlan('state', 'up', false, false))).toBe('eye_ward_open');
    // Sealed is a WIELDER-only badge: to everyone else sealed and pryable both mean "still
    // shielded", so a badge that flips between them would be noise they cannot act on.
    expect(eyeWardBadgeId(eyeWardMarkerPlan('state', 'up', true, false))).toBeNull();
    expect(eyeWardBadgeId(eyeWardMarkerPlan('aim', 'up', true, true))).toBe('eye_ward_sealed');
  });

  it('ships art for every badge it can name', () => {
    // A badge id with no file is a silent blank over the boss at the moment it matters most.
    for (const role of ['state', 'aim'] as const) {
      for (const ward of ['up', 'down'] as const) {
        for (const sealed of [false, true]) {
          const id = eyeWardBadgeId(eyeWardMarkerPlan(role, ward, sealed, true));
          if (!id) continue;
          expect(existsSync(`public/ui/status/${id}.webp`), id).toBe(true);
        }
      }
    }
  });
});

describe('a window is not a cooldown', () => {
  // The reported bug: the thrust's five-second window rendered through the COOLDOWN field, so
  // the one moment the fight wants a press showed a number counting down on a dark tile,
  // which in this genre means "you cannot press this". Players let the window expire.
  const bar = (over: Record<string, unknown> = {}) =>
    shardpikeBarState({
      mainhandItemId: SHARDPIKE_ITEM_ID,
      trial: null,
      restRemaining: 0,
      dead: false,
      ...over,
    });
  const btn = (state: ReturnType<typeof bar>, action: string) =>
    state.buttons.find((b) => b.action === action);

  it('never puts a cooldown on the thrust, in any state', () => {
    for (const t of [null, trial(), trial({ phase: 'steadied', windowRemaining: 3 })]) {
      expect(btn(bar({ trial: t }), 'thrust')?.cooldownSeconds).toBeNull();
    }
  });

  it('gives the live window a draining fraction and the seconds beside it', () => {
    const b = btn(bar({ trial: trial({ phase: 'steadied', windowRemaining: 3 }) }), 'thrust');
    expect(b?.enabled).toBe(true);
    expect(b?.primed).toBe(true);
    expect(b?.windowFrac).toBeGreaterThan(0);
    expect(b?.windowFrac).toBeLessThanOrEqual(1);
    expect(b?.windowSeconds).toBe(3);
  });

  it('drains from full to empty as the window runs out', () => {
    const at = (remaining: number) =>
      btn(bar({ trial: trial({ phase: 'steadied', windowRemaining: remaining }) }), 'thrust')
        ?.windowFrac ?? -1;
    expect(at(999)).toBe(1);
    expect(at(0)).toBe(0);
    expect(at(2)).toBeGreaterThan(at(1));
  });

  it('carries no window when there is nothing to spend', () => {
    expect(btn(bar(), 'thrust')?.windowFrac).toBeNull();
    expect(btn(bar({ trial: trial() }), 'thrust')?.windowFrac).toBeNull();
  });

  it('keeps the REST timer a real cooldown, on the brace', () => {
    // The distinction has to cut both ways: the rest wait genuinely is a cooldown and must
    // keep looking like one, or the two states become indistinguishable in the other
    // direction.
    const b = btn(bar({ restRemaining: 4.2 }), 'brace');
    expect(b?.enabled).toBe(false);
    expect(b?.cooldownSeconds).toBe(5);
    expect(b?.windowFrac).toBeNull();
  });
});
