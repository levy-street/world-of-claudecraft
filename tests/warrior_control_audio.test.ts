import { expect, it, vi } from 'vitest';
import { furyAudioClaimed } from '../src/fury_audio_core';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import type { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';
import { launchWarriorHammer } from '../src/render/ability_vfx/warrior_hammer';
import { ABILITIES } from '../src/sim/data';
import type { SimEvent } from '../src/sim/types';
import { impactCueForDamage, playerSwingCueForDamage, spellFxCue } from '../src/ui/combat_sfx';
import { StudioCombatAudio } from '../src/vfx_studio/combat_audio';
import { DEFAULT_STUDIO_CONFIG, StudioSession } from '../src/vfx_studio/session';
import { WARRIOR_CONTROL_AUDIO } from '../src/warrior_control_audio';

// Minimal SequencerHost for drawWarriorHammerContact: fills anchor scratch
// and returns it, satisfying the !at early-exit guards. Exposes named vi.fn()
// stubs so callers can assert on flipbookAt, abilityAudio, etc. directly.
function makeContactFx(sound: ReturnType<typeof vi.fn>) {
  return {
    setDelegates: vi.fn(),
    setQuality: vi.fn(),
    cancelWarriorHammer: vi.fn(),
    anchorOf(id: number, frac: number, out?: { x: number; y: number; z: number }) {
      if (!out) return null;
      out.x = id;
      out.y = frac;
      out.z = 0;
      return out;
    },
    flipbookAt: vi.fn(),
    burstAt: vi.fn(),
    pulseLight: vi.fn(),
    countPrimitive: vi.fn(),
    bakedAt: vi.fn(),
    fragmentsAt: vi.fn(),
    contact: vi.fn(),
    abilityAudio: sound,
  };
}

// Keep the real bolt entry point and launch helper in the ownership test.
function makeProjectileFx(sequenceBolt: ReturnType<typeof vi.fn>) {
  sequenceBolt.mockImplementation(AbilityVfxFx.prototype.sequenceBolt);
  return {
    ...makeContactFx(vi.fn()),
    disposed: false,
    ribbons: { spawnTrailStyled: vi.fn() },
    sequenceBolt,
  };
}

it('storm_bolt projectile with ready source claims original event and suppresses melee_bow', () => {
  const session = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, cls: 'warrior', spec: 'arms' });
  const source = session.sim.player;
  const target = session.sim.entities.get(session.targetIds[0]);
  if (!target) throw new Error('studio target missing');

  const sequenceBolt = vi.fn();
  const fx = makeProjectileFx(sequenceBolt);
  const painter = new AbilityVfx(
    {
      fx,
      vfx: {},
      anchor: (id: number) => ({ x: id, y: 1, z: 0 }),
      audioReady: () => true,
      localPlayerId: () => source.id,
      triggerAttack: vi.fn(),
      spawnAoeRing: vi.fn(),
    } as unknown as AbilityVfxDeps,
    () => 0,
  );

  const event: Extract<SimEvent, { type: 'spellfx' }> = {
    type: 'spellfx',
    sourceId: source.id,
    targetId: target.id,
    school: 'physical',
    fx: 'projectile',
    ability: 'storm_bolt',
  };

  painter.handleSpellfx(event);

  // Painter claims the original event for authored audio.
  expect(furyAudioClaimed(event)).toBe(true);
  // Shared cue function yields null: no melee_bow double-fire.
  expect(spellFxCue(event)).toBeNull();
  // Last arg to sequenceBolt is the hammerAudio flag.
  expect(sequenceBolt.mock.calls[0]?.at(-1)).toBe(true);
  expect(fx.abilityAudio).toHaveBeenCalledExactlyOnceWith(
    'release',
    'physical',
    0.9,
    source.id,
    0.62,
    0,
    expect.objectContaining({ sample: WARRIOR_CONTROL_AUDIO.storm_bolt.release }),
  );

  // Studio consumer: masterworkAudioKey returns null for storm_bolt, cue is
  // null because the event is claimed, so the sink is never touched.
  const sink = { playAt: vi.fn(), loop: vi.fn(), unloop: vi.fn(), preload: vi.fn() };
  new StudioCombatAudio(sink).event(event, session.sim.entities, source.id);
  expect(sink.playAt).not.toHaveBeenCalled();
});

it('storm_bolt projectile cold (audioReady false) stays unclaimed and preserves melee_bow fallback', () => {
  const session = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, cls: 'warrior', spec: 'arms' });
  const source = session.sim.player;
  const target = session.sim.entities.get(session.targetIds[0]);
  if (!target) throw new Error('studio target missing');

  const sequenceBolt = vi.fn();
  const fx = makeProjectileFx(sequenceBolt);
  const painter = new AbilityVfx(
    {
      fx,
      vfx: {},
      anchor: (id: number) => ({ x: id, y: 1, z: 0 }),
      audioReady: () => false,
      localPlayerId: () => source.id,
      triggerAttack: vi.fn(),
      spawnAoeRing: vi.fn(),
    } as unknown as AbilityVfxDeps,
    () => 0,
  );

  const event: Extract<SimEvent, { type: 'spellfx' }> = {
    type: 'spellfx',
    sourceId: source.id,
    targetId: target.id,
    school: 'physical',
    fx: 'projectile',
    ability: 'storm_bolt',
  };

  painter.handleSpellfx(event);

  expect(furyAudioClaimed(event)).toBe(false);
  // Generic projectile cue is preserved when authored audio is unavailable.
  expect(spellFxCue(event)).toEqual({ key: 'melee_bow', anchorId: source.id });
  expect(sequenceBolt.mock.calls[0]?.at(-1)).toBe(false);
  expect(fx.abilityAudio).not.toHaveBeenCalled();

  const sink = { playAt: vi.fn(), loop: vi.fn(), unloop: vi.fn(), preload: vi.fn() };
  new StudioCombatAudio(sink).event(event, session.sim.entities, source.id);
  expect(sink.playAt.mock.calls.some(([key]) => key === 'melee_bow')).toBe(true);
});

it('storm_bolt projectile missing source anchor stays unclaimed and preserves melee_bow fallback', () => {
  const session = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, cls: 'warrior', spec: 'arms' });
  const source = session.sim.player;
  const target = session.sim.entities.get(session.targetIds[0]);
  if (!target) throw new Error('studio target missing');

  const sequenceBolt = vi.fn();
  const fx = makeProjectileFx(sequenceBolt);
  const painter = new AbilityVfx(
    {
      fx,
      vfx: {},
      anchor: () => null,
      audioReady: () => true,
      localPlayerId: () => source.id,
      triggerAttack: vi.fn(),
      spawnAoeRing: vi.fn(),
    } as unknown as AbilityVfxDeps,
    () => 0,
  );

  const event: Extract<SimEvent, { type: 'spellfx' }> = {
    type: 'spellfx',
    sourceId: source.id,
    targetId: target.id,
    school: 'physical',
    fx: 'projectile',
    ability: 'storm_bolt',
  };

  painter.handleSpellfx(event);

  expect(furyAudioClaimed(event)).toBe(false);
  expect(spellFxCue(event)).toEqual({ key: 'melee_bow', anchorId: source.id });
  expect(sequenceBolt.mock.calls[0]?.at(-1)).toBe(false);
  expect(fx.abilityAudio).not.toHaveBeenCalled();
});

it('launchWarriorHammer with playAudio=false spawns styled ribbon but never calls abilityAudio', () => {
  const sound = vi.fn();
  const spawnTrailStyled = vi.fn();
  // host.anchorOf must fill the module-level scratch buffer and return it so
  // the early-exit guard passes and the ribbon spawn proceeds.
  const host = {
    anchorOf(id: number, frac: number, out?: { x: number; y: number; z: number }) {
      if (!out) return { x: id, y: frac, z: 0 };
      out.x = id;
      out.y = frac;
      out.z = 0;
      return out;
    },
    abilityAudio: sound,
  } as unknown as SequencerHost;

  launchWarriorHammer(host, { spawnTrailStyled } as unknown as AbilityVfxRibbons, 1, 2, 0, false);

  expect(spawnTrailStyled).toHaveBeenCalledOnce();
  expect(sound).not.toHaveBeenCalled();
});

it('storm_bolt positive damage: ready anchors claim event and play authored impact exactly once', () => {
  const session = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, cls: 'warrior', spec: 'arms' });
  const source = session.sim.player;
  const target = session.sim.entities.get(session.targetIds[0]);
  if (!target) throw new Error('studio target missing');

  const sound = vi.fn();
  const fx = makeContactFx(sound);
  const painter = new AbilityVfx(
    {
      fx,
      vfx: {},
      anchor: (id: number) => ({ x: id, y: 1, z: 0 }),
      audioReady: () => true,
      localPlayerId: () => source.id,
      triggerAttack: vi.fn(),
      spawnAoeRing: vi.fn(),
    } as unknown as AbilityVfxDeps,
    () => 0,
  );

  const event: Extract<SimEvent, { type: 'damage' }> = {
    type: 'damage',
    abilityId: 'storm_bolt',
    ability: ABILITIES.storm_bolt.name,
    sourceId: source.id,
    targetId: target.id,
    school: 'physical',
    kind: 'hit',
    amount: 100,
    crit: false,
  };

  painter.onDamage(event);

  expect(furyAudioClaimed(event)).toBe(true);
  // Both shared cue functions short-circuit on the claim.
  expect(impactCueForDamage(event, target)).toBeNull();
  expect(playerSwingCueForDamage(event, source)).toBeNull();
  // Authored impact fires exactly once with the correct sample.
  const impactCalls = sound.mock.calls.filter(([kind]) => kind === 'impact');
  expect(impactCalls).toHaveLength(1);
  expect(impactCalls[0][6].sample).toBe(WARRIOR_CONTROL_AUDIO.storm_bolt.impacts[0]);

  // Studio consumer: all cue functions return null for the claimed event.
  const sink = { playAt: vi.fn(), loop: vi.fn(), unloop: vi.fn(), preload: vi.fn() };
  new StudioCombatAudio(sink).event(event, session.sim.entities, source.id);
  expect(sink.playAt).not.toHaveBeenCalled();
});

it('storm_bolt damage cold: visible contact preserved, authored impact suppressed, generic impact survives', () => {
  const session = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, cls: 'warrior', spec: 'arms' });
  const source = session.sim.player;
  const target = session.sim.entities.get(session.targetIds[0]);
  if (!target) throw new Error('studio target missing');

  const sound = vi.fn();
  const fx = makeContactFx(sound);
  const painter = new AbilityVfx(
    {
      fx,
      vfx: {},
      anchor: (id: number) => ({ x: id, y: 1, z: 0 }),
      audioReady: () => false,
      localPlayerId: () => source.id,
      triggerAttack: vi.fn(),
      spawnAoeRing: vi.fn(),
    } as unknown as AbilityVfxDeps,
    () => 0,
  );

  const event: Extract<SimEvent, { type: 'damage' }> = {
    type: 'damage',
    abilityId: 'storm_bolt',
    ability: ABILITIES.storm_bolt.name,
    sourceId: source.id,
    targetId: target.id,
    school: 'physical',
    kind: 'hit',
    amount: 100,
    crit: false,
  };

  painter.onDamage(event);

  expect(furyAudioClaimed(event)).toBe(false);
  // drawWarriorHammerContact still ran: flipbook marks the visual contact.
  expect(fx.flipbookAt).toHaveBeenCalled();
  // playAudio=false path: the authored impact abilityAudio call is skipped.
  expect(sound.mock.calls.filter(([kind]) => kind === 'impact')).toHaveLength(0);
  // The shared cue is non-null, so the generic impact is available.
  expect(impactCueForDamage(event, target)).not.toBeNull();

  // Studio consumer plays the generic material impact.
  const sink = { playAt: vi.fn(), loop: vi.fn(), unloop: vi.fn(), preload: vi.fn() };
  new StudioCombatAudio(sink).event(event, session.sim.entities, source.id);
  expect(sink.playAt.mock.calls.some(([key]) => key.startsWith('impact_'))).toBe(true);
});

it('storm_bolt absorb and miss do not claim injury audio', () => {
  const session = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, cls: 'warrior', spec: 'arms' });
  const source = session.sim.player;
  const target = session.sim.entities.get(session.targetIds[0]);
  if (!target) throw new Error('studio target missing');

  const sound = vi.fn();
  const fx = makeContactFx(sound);
  const painter = new AbilityVfx(
    {
      fx,
      vfx: {},
      anchor: (id: number) => ({ x: id, y: 1, z: 0 }),
      audioReady: () => true,
      localPlayerId: () => source.id,
      triggerAttack: vi.fn(),
      spawnAoeRing: vi.fn(),
    } as unknown as AbilityVfxDeps,
    () => 0,
  );

  // outcome === 2 (absorb): hammerAudio condition requires outcome === 1.
  const absorb: Extract<SimEvent, { type: 'damage' }> = {
    type: 'damage',
    abilityId: 'storm_bolt',
    ability: ABILITIES.storm_bolt.name,
    sourceId: source.id,
    targetId: target.id,
    school: 'physical',
    kind: 'hit',
    amount: 0,
    absorbed: 100,
    crit: false,
  };
  painter.onDamage(absorb);
  expect(furyAudioClaimed(absorb)).toBe(false);
  expect(sound.mock.calls.filter(([kind]) => kind === 'impact')).toHaveLength(0);

  // outcome === 0 (miss): drawWarriorHammerContact returns immediately at the
  // !outcome guard, so no visual or audio runs.
  const miss: Extract<SimEvent, { type: 'damage' }> = {
    type: 'damage',
    abilityId: 'storm_bolt',
    ability: ABILITIES.storm_bolt.name,
    sourceId: source.id,
    targetId: target.id,
    school: 'physical',
    kind: 'miss',
    amount: 0,
    crit: false,
  };
  painter.onDamage(miss);
  expect(furyAudioClaimed(miss)).toBe(false);
});
