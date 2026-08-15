// The 'selfCast' spellfx cue is renderer-only: the sim emits it for a cast
// that announces nothing itself (no damage, no projectile, no castFx), purely
// so the per-ability VFX layer can stage a ceremony. It therefore has NO
// legacy meaning, and an ability the painter declines (no spec, or an
// archetype it does not claim) must draw NOTHING. Without the guard the event
// walks the whole generic chain in handleEvent and lands on the terminal
// `this.vfx.nova(...)`, popping a school-colored burst on a cast that drew
// nothing before this subsystem existed (sport_second_wind is the reachable
// case: requiresTarget false, a lone selfBuff effect, no castFx, no spec).
import { describe, expect, it, vi } from 'vitest';
import { ABILITY_VFX_SPECS } from '../src/render/ability_vfx_specs';
import { Renderer } from '../src/render/renderer';
import type { SimEvent } from '../src/sim/types';

interface EventHarness {
  handleEvent(ev: SimEvent): void;
}

type SpellfxCalls = {
  nova: ReturnType<typeof vi.fn>;
  tick: ReturnType<typeof vi.fn>;
  lightningProjectile: ReturnType<typeof vi.fn>;
};

/** A renderer stripped to just what the spellfx arm of handleEvent touches. */
function spellfxHarness(painterClaims: boolean): {
  harness: EventHarness;
  calls: SpellfxCalls;
  showChatBubble: ReturnType<typeof vi.fn>;
} {
  const calls: SpellfxCalls = {
    nova: vi.fn(),
    tick: vi.fn(),
    lightningProjectile: vi.fn(),
  };
  const showChatBubble = vi.fn();
  const renderer = Object.create(Renderer.prototype) as EventHarness & Record<string, unknown>;
  renderer.abilityVfx = { handleSpellfx: vi.fn().mockReturnValue(painterClaims) };
  renderer.vfx = calls;
  renderer.showChatBubble = showChatBubble;
  renderer.sim = { player: { id: 1 }, entities: new Map() };
  renderer.views = new Map();
  return { harness: renderer, calls, showChatBubble };
}

function selfCast(ability: string, sourceId = 1, targetId = 1): SimEvent {
  return {
    type: 'spellfx',
    sourceId,
    targetId,
    school: 'nature',
    fx: 'selfCast',
    ability,
  } as SimEvent;
}

describe('unclaimed selfCast cues draw nothing', () => {
  it('never falls through to the generic school nova when the painter declines', () => {
    const { harness, calls } = spellfxHarness(false);

    harness.handleEvent(selfCast('sport_second_wind'));

    expect(calls.nova).not.toHaveBeenCalled();
    expect(calls.tick).not.toHaveBeenCalled();
    expect(calls.lightningProjectile).not.toHaveBeenCalled();
  });

  it('leaves a claimed selfCast entirely to the painter', () => {
    const { harness, calls } = spellfxHarness(true);

    harness.handleEvent(selfCast('sport_second_wind'));

    expect(calls.nova).not.toHaveBeenCalled();
  });

  it('still barks the Goad grawlix, which is emitted before the claim', () => {
    const { harness, showChatBubble } = spellfxHarness(false);

    harness.handleEvent(selfCast('taunt', 4, 9));

    expect(showChatBubble).toHaveBeenCalledOnce();
    expect(showChatBubble.mock.calls[0]?.[0]).toBe(4);
  });

  it('keeps sport_second_wind specless, so the guard stays the reachable path', () => {
    // A later change may well author a spec for it. This is not a demand that
    // it stay specless forever: it pins the premise of the first case, so the
    // test above cannot silently stop covering the fallthrough it guards.
    expect(ABILITY_VFX_SPECS.sport_second_wind).toBeUndefined();
  });
});
