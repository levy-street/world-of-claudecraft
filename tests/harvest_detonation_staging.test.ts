import { beforeEach, expect, it, vi } from 'vitest';
import { FURY_AUDIO } from '../src/game/fury_audio_core';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { HarvestDetonations } from '../src/render/ability_vfx/harvest_detonation';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';
import type { AbilityVfxFullSpec } from '../src/render/ability_vfx_core';
import { abilityVfxFullSpec } from '../src/render/ability_vfx_registry';
import { ABILITIES } from '../src/sim/data';

// The sim resolves Red Harvest on the CAST tick: the opening selfCast cue and
// all three damage events land in the same tick, so the client owns the
// contact timing. The detonation is therefore staged to the authored final
// contact of the cast that produced it, on the painter's own frame clock,
// instead of playing on the frame the damage arrives. Two escapes keep
// already-late combat from being pushed further out: a batch whose caster
// opened no cast in its frame window plays at once, and so does one whose
// caster opened MORE than one (a catch-up burst).

const CASTER = 7;
const TARGET = 9;
const FINAL_CONTACT = FURY_AUDIO.red_harvest.times[2];
const FRAME = 1 / 60;

const resolved = abilityVfxFullSpec('red_harvest');
if (!resolved) throw new Error('red_harvest has no full VFX spec');
const spec: AbilityVfxFullSpec = resolved;

function autoMock<T extends object>(seed: Partial<T>): T {
  return new Proxy(seed as T, {
    get(target, key) {
      if (!(key in target)) (target as Record<PropertyKey, unknown>)[key] = vi.fn();
      return Reflect.get(target, key);
    },
  });
}

const anchoring = {
  groundYAt: () => 0,
  facingAt: () => 0,
  anchorOf: (id: number, height: number, out = { x: 0, y: 0, z: 0 }) =>
    Object.assign(out, { x: id, y: height, z: 0 }),
  pathRibbon: () => false,
  bakedAt: () => false,
  crestAt: () => false,
};

let h: SequencerHost;
let det: HarvestDetonations;

beforeEach(() => {
  h = autoMock<SequencerHost>({ ...anchoring } as Partial<SequencerHost>);
  det = new HarvestDetonations();
});

function recordHit(caster = CASTER, target = TARGET): boolean {
  return det.record(caster, target, 1, 0, spec, true, { x: 1, y: 2, z: 3 });
}

/** Advance whole frames, stopping just short of `seconds`. */
function advance(seconds: number): void {
  for (let t = 0; t + FRAME <= seconds + 1e-9; t += FRAME) det.advance(h, FRAME);
}

it('pins the authored final contact the staging reads', () => {
  // A retime of the cue bed must move the detonation with it; the staging
  // must never grow a second literal of its own.
  expect(FURY_AUDIO.red_harvest.times[2]).toBe(0.49);
});

it('holds a recorded batch until the authored final contact, and plays it once', () => {
  det.noteOpening(CASTER);
  expect(recordHit()).toBe(true);

  advance(0.3);
  expect(h.contact).not.toHaveBeenCalled();

  advance(FINAL_CONTACT - 0.3 + FRAME);
  expect(h.contact).toHaveBeenCalledTimes(1);
  expect(h.contact).toHaveBeenCalledWith(
    CASTER,
    TARGET,
    'physical',
    expect.any(Number),
    'red_harvest',
    2,
  );
  expect(h.abilityAudio).toHaveBeenCalledWith(
    'impact',
    'physical',
    1.5,
    expect.any(Number),
    expect.any(Number),
    expect.any(Number),
    expect.objectContaining({ sample: FURY_AUDIO.red_harvest.impacts[2], finisher: true }),
  );

  // the slot is released by the play, so no later frame replays it
  advance(2);
  expect(h.contact).toHaveBeenCalledTimes(1);
});

it('detonates on the next frame when the caster opened no cast in the window', () => {
  expect(recordHit()).toBe(true);

  det.advance(h, FRAME);
  expect(h.contact).toHaveBeenCalledTimes(1);
});

it('detonates on the next frame when a catch-up burst opened two casts at once', () => {
  det.noteOpening(CASTER);
  det.noteOpening(CASTER);
  recordHit();

  det.advance(h, FRAME);
  expect(h.contact).toHaveBeenCalledTimes(1);
});

it('stops staging once the opening window closes', () => {
  det.noteOpening(CASTER);
  det.advance(h, FRAME); // the window that carried the opening ends here
  recordHit();

  det.advance(h, FRAME);
  expect(h.contact).toHaveBeenCalledTimes(1);
});

it('flushes the pending batch when the caster casts again', () => {
  det.noteOpening(CASTER);
  recordHit();

  advance(0.2);
  expect(h.contact).not.toHaveBeenCalled();

  det.flush(h, CASTER);
  expect(h.contact).toHaveBeenCalledTimes(1);

  det.flush(h, CASTER);
  advance(1);
  expect(h.contact).toHaveBeenCalledTimes(1);
});

it('leaves another caster staged when one caster recasts', () => {
  det.noteOpening(CASTER);
  det.noteOpening(CASTER + 1);
  recordHit();
  recordHit(CASTER + 1, TARGET + 1);

  det.flush(h, CASTER);
  expect(h.contact).toHaveBeenCalledExactlyOnceWith(
    CASTER,
    TARGET,
    'physical',
    expect.any(Number),
    'red_harvest',
    2,
  );

  advance(FINAL_CONTACT + FRAME);
  expect(h.contact).toHaveBeenCalledTimes(2);
});

it('drops staged batches and the open window on clear', () => {
  det.noteOpening(CASTER);
  recordHit();
  det.clear();

  advance(2);
  expect(h.contact).not.toHaveBeenCalled();

  // the cleared window no longer dates a fresh batch: it plays at once
  recordHit();
  det.advance(h, FRAME);
  expect(h.contact).toHaveBeenCalledTimes(1);
});

// ---- the painter wiring: the opening cue, the per-frame advance, the recast -

function painterHarness() {
  const fx = autoMock<AbilityVfxFx>({ ...anchoring } as Partial<AbilityVfxFx>);
  const painter = new AbilityVfx(
    {
      fx,
      vfx: autoMock<AbilityVfxDeps['vfx']>({}),
      anchor: (id: number) => ({ x: id, y: 1, z: 0 }),
      spawnAoeRing: vi.fn(),
      triggerAttack: vi.fn(),
      localPlayerId: () => -1,
      audioReady: () => true,
    } as unknown as AbilityVfxDeps,
    () => 0,
  );
  return { painter, fx };
}

function selfCast(sourceId: number) {
  return {
    sourceId,
    targetId: sourceId,
    school: 'physical',
    fx: 'selfCast',
    ability: 'red_harvest',
  };
}

function harvestHit(sourceId: number, targetId: number) {
  return {
    abilityId: null,
    ability: ABILITIES.red_harvest.name,
    sourceId,
    targetId,
    school: 'physical' as const,
    kind: 'hit' as const,
    amount: 120,
    crit: false,
  };
}

function runFrames(painter: AbilityVfx, seconds: number): void {
  for (let t = 0; t + FRAME <= seconds + 1e-9; t += FRAME) painter.update(FRAME);
}

it('stages the painter detonation from the opening cue, not the damage frame', () => {
  const p = painterHarness();

  expect(p.painter.handleSpellfx(selfCast(CASTER))).toBe(true);
  expect(p.painter.onDamage(harvestHit(CASTER, TARGET))).toBe(true);

  runFrames(p.painter, 0.3);
  expect(p.fx.contact).not.toHaveBeenCalled();

  runFrames(p.painter, FINAL_CONTACT - 0.3 + FRAME);
  expect(p.fx.contact).toHaveBeenCalledTimes(1);

  runFrames(p.painter, 1);
  expect(p.fx.contact).toHaveBeenCalledTimes(1);
});

it('flushes a still-pending painter detonation on the next cast', () => {
  const p = painterHarness();

  p.painter.handleSpellfx(selfCast(CASTER));
  p.painter.onDamage(harvestHit(CASTER, TARGET));
  runFrames(p.painter, 0.2);
  expect(p.fx.contact).not.toHaveBeenCalled();

  p.painter.handleSpellfx(selfCast(CASTER));
  expect(p.fx.contact).toHaveBeenCalledTimes(1);
});

it('detonates a painter batch at once when its opening cue never arrived', () => {
  const p = painterHarness();

  expect(p.painter.onDamage(harvestHit(CASTER, TARGET))).toBe(true);
  p.painter.update(FRAME);

  expect(p.fx.contact).toHaveBeenCalledTimes(1);
});
