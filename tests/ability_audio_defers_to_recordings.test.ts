// End-to-end pin for the fix: the procedural ability layer (sfx.abilityAudio)
// must schedule NOTHING for a moment a hand-recorded studio cue already sounds,
// and must still speak for the moments no recording covers.
//
// The unit rules live in tests/ability_sfx_coverage.test.ts; this file proves
// sfx.ts actually consults them, resolving the ability's school and projectile
// flag from ABILITIES. Without it the coverage module could be correct and
// completely unwired, which is exactly the bug being fixed: the recorded cues
// were never unwired either, they were just buried under a synthetic double.
//
// The assertion is createGain() call count. abilityAudio allocates its output
// gain node before dispatching to any recipe, so "no new gain node" is a
// decisive read of "returned before scheduling", independent of how far the
// synthesis primitives get against a stub context.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sfx } from '../src/game/sfx';
import { AbilityVfx } from '../src/render/ability_vfx';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';

let gainNodes = 0;
let nowT = 0;

function installAudioStub(): void {
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
    cancelScheduledValues() {},
  });
  const node = () => ({
    connect(n: unknown) {
      return n;
    },
    disconnect() {},
    start() {},
    stop() {},
  });
  class FakeCtx {
    get currentTime() {
      return nowT;
    }
    destination = {};
    listener = {} as Record<string, unknown>;
    sampleRate = 44100;
    createGain() {
      gainNodes++;
      return { ...node(), gain: param() };
    }
    createPanner() {
      return {
        ...node(),
        panningModel: '',
        distanceModel: '',
        refDistance: 0,
        maxDistance: 0,
        rolloffFactor: 0,
        setPosition() {},
        positionX: param(),
        positionY: param(),
        positionZ: param(),
      };
    }
    createOscillator() {
      return { ...node(), type: '', frequency: param(), detune: param() };
    }
    createBufferSource() {
      return { ...node(), buffer: null, loop: false, playbackRate: param() };
    }
    createBiquadFilter() {
      return { ...node(), type: '', frequency: param(), Q: param(), gain: param() };
    }
    createWaveShaper() {
      return { ...node(), curve: null, oversample: '' };
    }
    createBuffer(channels: number, length: number, rate: number) {
      return {
        numberOfChannels: channels,
        length,
        sampleRate: rate,
        duration: length / rate,
        getChannelData: () => new Float32Array(length),
      };
    }
    resume() {
      return Promise.resolve();
    }
  }
  (globalThis as never as { AudioContext: unknown }).AudioContext = FakeCtx;
}

/** Gain nodes allocated by one abilityAudio call. 0 means it deferred. */
function nodesFor(fn: () => void): number {
  nowT += 10; // clear the per-(kind, palette) cooldown between probes
  const before = gainNodes;
  fn();
  return gainNodes - before;
}

beforeEach(() => {
  installAudioStub();
  sfx.init();
});

describe('moments a recording already sounds are skipped, not doubled', () => {
  it('stays silent on the release of a magic-school projectile (proj_<school> plays)', () => {
    // Fireball: school fire, projectile by convention. combat_sfx.ts fires
    // proj_fire at the caster on the same spellfx event.
    expect(
      nodesFor(() =>
        sfx.abilityAudio('release', 'fire', 1, 0, 0, 0, {
          archetype: 'bolt',
          abilityId: 'fireball',
        }),
      ),
    ).toBe(0);
  });

  it('stays silent on a damage impact (impact_<school> plays)', () => {
    expect(
      nodesFor(() =>
        sfx.abilityAudio('impact', 'frost', 1, 0, 0, 0, {
          archetype: 'bolt',
          abilityId: 'frostbolt',
        }),
      ),
    ).toBe(0);
  });

  it('stays silent on a physical impact too (the material impacts are recorded)', () => {
    expect(
      nodesFor(() =>
        sfx.abilityAudio('impact', 'physical', 1, 0, 0, 0, {
          archetype: 'strike',
          abilityId: 'mortal_strike',
        }),
      ),
    ).toBe(0);
  });

  it('stays silent on a crit (combat_crit is recorded)', () => {
    expect(nodesFor(() => sfx.abilityAudio('crit', 'shadow', 1, 0, 0, 0, {}))).toBe(0);
  });

  it('stays silent on the Meteor zone pulse (the meteor recording plays instead)', () => {
    // The painter's zoneRehit threads ev.ability through to abilityAudio so
    // PULSE_IMPACT_ABILITIES (ability_sfx_coverage.ts) can silence this one
    // ground-zone pulse specifically: fx.ts's fx:'tick' handler (hud.ts) plays
    // the dedicated 'meteor' recording instead. Without abilityId threaded
    // through, this would fall back to the generic uncovered 'pulse' case
    // below and double the recording with a synthetic thud.
    expect(
      nodesFor(() =>
        sfx.abilityAudio('pulse', 'fire', 1, 0, 0, 0, { archetype: 'nova', abilityId: 'meteor' }),
      ),
    ).toBe(0);
  });
});

describe('moments no recording covers keep their procedural voice', () => {
  it('still sounds the release of a physical strike (no proj_physical take)', () => {
    expect(
      nodesFor(() =>
        sfx.abilityAudio('release', 'physical', 1, 0, 0, 0, {
          archetype: 'strike',
          abilityId: 'mortal_strike',
        }),
      ),
    ).toBeGreaterThan(0);
  });

  it('still sounds the release of a spell that opts out of the projectile convention', () => {
    // Fire Blast (projectile: false) emits no projectile spellfx, so proj_fire
    // never plays for it and the whoosh must survive. This is the case a
    // school-only rule would have wrongly silenced.
    expect(
      nodesFor(() =>
        sfx.abilityAudio('release', 'fire', 1, 0, 0, 0, {
          archetype: 'bolt',
          abilityId: 'fire_blast',
        }),
      ),
    ).toBeGreaterThan(0);
  });

  it('still sounds a cc landing (an enemy debuff plays no recorded cue)', () => {
    expect(
      nodesFor(() =>
        sfx.abilityAudio('impact', 'arcane', 1, 0, 0, 0, {
          archetype: 'cc',
          abilityId: 'polymorph',
        }),
      ),
    ).toBeGreaterThan(0);
  });

  it('still sounds a windup bed and a zone pulse', () => {
    expect(
      nodesFor(() => sfx.abilityAudio('windup', 'nature', 1, 0, 0, 0, { abilityId: 'wrath' })),
    ).toBeGreaterThan(0);
    expect(
      nodesFor(() => sfx.abilityAudio('pulse', 'fire', 1, 0, 0, 0, { archetype: 'nova' })),
    ).toBeGreaterThan(0);
  });
});

// Pins the OTHER half of the anti-doubling path: the painter itself, not just
// sfx.abilityAudio in isolation. zoneRehit (painter.ts) must actually thread
// ev.ability through to deps.abilityAudio's opts.abilityId, or the coverage
// rule above is unreachable in the real event flow and this would silently
// fall back to the generic uncovered 'pulse' case, doubling the meteor
// recording with a synthetic thud (the bug this whole file is pinning).
describe('the painter threads ability id into its zone-pulse audio call', () => {
  function harness() {
    const abilityAudio = vi.fn();
    const fx = {
      setDelegates: vi.fn(),
      setQuality: vi.fn(),
      groundYAt: vi.fn(() => 0),
      ringAt: vi.fn(),
      burstAt: vi.fn(),
    } as unknown as AbilityVfxFx;
    const noop = vi.fn();
    const abilityVfx = new AbilityVfx(
      {
        fx,
        anchor: () => ({ x: 0, y: 0, z: 0 }),
        spawnAoeRing: noop,
        triggerAttack: noop,
        vfx: {
          projectile: noop,
          lightningProjectile: noop,
          burst: noop,
          nova: noop,
          tick: noop,
          shoutwave: noop,
          buffSwirl: noop,
          beam: noop,
        },
        abilityAudio,
      },
      () => 0,
    );
    return { abilityVfx, abilityAudio };
  }

  it('carries abilityId: "meteor" on Meteor\'s ground-zone pulse', () => {
    const { abilityVfx, abilityAudio } = harness();
    const claimed = abilityVfx.handleSpellfxAt({
      x: 0,
      z: 0,
      school: 'fire',
      fx: 'tick',
      ability: 'meteor',
    });
    expect(claimed).toBe(true);
    expect(abilityAudio).toHaveBeenCalledTimes(1);
    const opts = abilityAudio.mock.calls[0][6];
    expect(opts).toMatchObject({ abilityId: 'meteor' });
  });

  // Comparison case: a different ability's zone pulse (Consecration) threads
  // its own id the same way, proving this is the general zoneRehit contract
  // and not a meteor-specific special case.
  it('carries abilityId: "consecration" on Consecration\'s ground-zone pulse', () => {
    const { abilityVfx, abilityAudio } = harness();
    const claimed = abilityVfx.handleSpellfxAt({
      x: 0,
      z: 0,
      school: 'holy',
      fx: 'tick',
      ability: 'consecration',
    });
    expect(claimed).toBe(true);
    expect(abilityAudio).toHaveBeenCalledTimes(1);
    const opts = abilityAudio.mock.calls[0][6];
    expect(opts).toMatchObject({ abilityId: 'consecration' });
  });
});
