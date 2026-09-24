import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { HoardBossGestures } from '../src/render/hoard_boss_gestures';
import {
  EMBER_FRONTAL_RELEASE_SEC,
  FROST_GUST_RELEASE_SEC,
  HOARD_GESTURE_CALL_HAMMER,
  HOARD_GESTURE_CALL_STORM,
  HOARD_GESTURE_EMBER_FRONTAL,
  HOARD_GESTURE_FROST_GUST,
  HOARD_GESTURE_GRACE_SEC,
  HOARD_GESTURE_ICE_AGE_RELEASE,
  hoardBossGesture,
  hoardGestureDue,
} from '../src/render/hoard_boss_gestures_core';
import { HOARD_FROST_GUST } from '../src/sim/rift/hoard_boss_kits';
import {
  HOARD_CAST_ICE_AGE,
  HOARD_CAST_PULSAR_OVERLOAD,
} from '../src/sim/rift/hoard_control_cast_ids';
import { iceAgeTimeline, iceAgeTotalSec } from '../src/sim/rift/hoard_ice_age_core';
import type { IWorld } from '../src/world_api';
import type { HoardBossCueView } from '../src/world_api/dungeons';

function cue(variant: HoardBossCueView['variant'], total: number, elapsed: number, cueId = 1) {
  return {
    instanceId: 7,
    cueId,
    kind: 'sweep',
    variant,
    phase: 'warning',
    x: 0,
    z: 0,
    radius: 20,
    remaining: total - elapsed,
    total,
  } satisfies HoardBossCueView;
}

function worldWith(entities: { id: number; templateId: string; dead?: boolean; x?: number }[]) {
  const map = new Map(
    entities.map((e) => [
      e.id,
      {
        id: e.id,
        templateId: e.templateId,
        dead: e.dead ?? false,
        pos: { x: e.x ?? 0, y: 0, z: 0 },
      },
    ]),
  );
  return { entities: map } as unknown as IWorld;
}

describe('hoard boss gestures core', () => {
  it('starts the frontal so its release frame meets the end of the telegraph', () => {
    const gesture = hoardBossGesture('frost-gust');
    expect(gesture?.gesture).toBe(HOARD_GESTURE_FROST_GUST);
    const total = HOARD_FROST_GUST.windup;
    expect(gesture?.startAt(total)).toBeCloseTo(total - FROST_GUST_RELEASE_SEC, 6);
    expect(FROST_GUST_RELEASE_SEC).toBe(0.72);
  });

  it('throws the Ice Age arms down on the blast, at every cast speed', () => {
    const gesture = hoardBossGesture('frost-iceage');
    expect(gesture?.gesture).toBe(HOARD_GESTURE_ICE_AGE_RELEASE);
    for (const speed of [1, 1.2, 2]) {
      const total = iceAgeTotalSec(speed);
      expect(gesture?.startAt(total)).toBeCloseTo(iceAgeTimeline(total).blastAt, 6);
    }
  });

  it("opens a called mechanic on the carrier cue's first moment", () => {
    const hammer = hoardBossGesture('ember-hammer');
    expect(hammer?.template).toBe('rift_boss_ember');
    expect(hammer?.gesture).toBe(HOARD_GESTURE_CALL_HAMMER);
    expect(hammer?.startAt(12)).toBe(0);
    const storm = hoardBossGesture('storm-orbital');
    expect(storm?.template).toBe('rift_boss_storm');
    expect(storm?.gesture).toBe(HOARD_GESTURE_CALL_STORM);
    expect(storm?.startAt(9)).toBe(0);
    // A strike of the hammer is not a call: only the carrier gestures.
    expect(hoardBossGesture('ember-hammer-strike')).toBeUndefined();
    expect(hoardBossGesture('storm-orbital-impact')).toBeUndefined();
  });

  it("brings the Tyrant's maul down as his frontal lands", () => {
    const gesture = hoardBossGesture('ember-frontal');
    expect(gesture?.gesture).toBe(HOARD_GESTURE_EMBER_FRONTAL);
    expect(gesture?.startAt(2)).toBeCloseTo(2 - EMBER_FRONTAL_RELEASE_SEC, 6);
    // A telegraph shorter than the swing starts it at once, never before the cue.
    expect(gesture?.startAt(0.3)).toBe(0);
  });

  it('has no gesture for a cue nobody authored one for', () => {
    expect(hoardBossGesture('tide-wave')).toBeUndefined();
    expect(hoardBossGesture(undefined)).toBeUndefined();
  });

  it('is due only inside the grace window after its start', () => {
    const gesture = hoardBossGesture('frost-gust');
    if (!gesture) throw new Error('no frost-gust gesture');
    const total = 2.4;
    const start = gesture.startAt(total);
    expect(hoardGestureDue(gesture, total, total - (start - 0.05))).toBe(false);
    expect(hoardGestureDue(gesture, total, total - start)).toBe(true);
    expect(hoardGestureDue(gesture, total, total - (start + HOARD_GESTURE_GRACE_SEC))).toBe(true);
    expect(hoardGestureDue(gesture, total, total - (start + HOARD_GESTURE_GRACE_SEC + 0.05))).toBe(
      false,
    );
  });
});

describe('hoard boss gestures adapter', () => {
  it('plays the gesture once, on the living boss that owns the cue', () => {
    const play = vi.fn();
    const world = worldWith([
      { id: 3, templateId: 'rift_boss_frost', dead: true },
      { id: 4, templateId: 'rift_boss_frost', x: 2 },
      { id: 5, templateId: 'rift_boss_ember' },
    ]);
    const gestures = new HoardBossGestures(world, play);
    gestures.sync([cue('frost-gust', 2.4, 0.5)]);
    expect(play).not.toHaveBeenCalled();
    gestures.sync([cue('frost-gust', 2.4, 1.7)]);
    gestures.sync([cue('frost-gust', 2.4, 1.75)]);
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith(4, HOARD_GESTURE_FROST_GUST);
  });

  it('skips a cue first seen after its moment, and plays the next one', () => {
    const play = vi.fn();
    const gestures = new HoardBossGestures(
      worldWith([{ id: 4, templateId: 'rift_boss_frost' }]),
      play,
    );
    gestures.sync([cue('frost-gust', 2.4, 2.3)]);
    expect(play).not.toHaveBeenCalled();
    gestures.sync([]);
    gestures.sync([cue('frost-gust', 2.4, 1.7, 2)]);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a world or a player of gestures', () => {
    expect(() =>
      new HoardBossGestures(undefined, undefined).sync([cue('frost-gust', 2.4, 1.7)]),
    ).not.toThrow();
  });
});

/** Animation names in a shipped GLB, read from its JSON chunk. */
function clipNames(path: string): string[] {
  const bytes = readFileSync(path);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as {
    animations?: { name?: string }[];
  };
  return (json.animations ?? []).map((animation) => animation.name ?? '');
}

describe('locally rigged hoard bosses: authored gestures', () => {
  const CREATURES = 'public/models/creatures';

  it('maps every gesture and cast to a clip the shipped GLB really has', () => {
    const cases = [
      ['mob_hoard_emberforge_tyrant', 'hoard_emberforge_tyrant', 'CallHammer'],
      ['mob_hoard_tempest_vharok', 'hoard_tempest_vharok', 'CallStorm'],
      ['mob_hoard_archon_nyxaris', 'hoard_archon_nyxaris', 'PulsarChannel'],
    ] as const;
    for (const [visual, file, authored] of cases) {
      const shipped = clipNames(`${CREATURES}/${file}.glb`);
      expect(shipped, file).toContain(authored);
      const clips = VISUALS[visual].clips;
      const mapped = [
        ...Object.values(clips.attackByAbility ?? {}),
        ...Object.values(clips.castByAbility ?? {}),
      ];
      expect(mapped, visual).toContain(authored);
      // A name that is not in the GLB would render as a T-pose.
      for (const name of mapped) expect(shipped, `${visual} ${name}`).toContain(name);
    }
  });

  it('wires each boss to his own gesture ids at the authored speed', () => {
    const ember = VISUALS.mob_hoard_emberforge_tyrant.clips;
    expect(ember.attackByAbility?.[HOARD_GESTURE_CALL_HAMMER]).toBe('CallHammer');
    expect(ember.attackByAbility?.[HOARD_GESTURE_EMBER_FRONTAL]).toBe('2H_Melee_Attack_Chop');
    expect(ember.attackTimeScaleByAbility?.[HOARD_GESTURE_CALL_HAMMER]).toBe(1);
    expect(ember.attackTimeScaleByAbility?.[HOARD_GESTURE_EMBER_FRONTAL]).toBe(1);
    const storm = VISUALS.mob_hoard_tempest_vharok.clips;
    expect(storm.attackByAbility?.[HOARD_GESTURE_CALL_STORM]).toBe('CallStorm');
    expect(storm.attackTimeScaleByAbility?.[HOARD_GESTURE_CALL_STORM]).toBe(1);
    const nyx = VISUALS.mob_hoard_archon_nyxaris.clips;
    expect(nyx.castByAbility?.[HOARD_CAST_PULSAR_OVERLOAD]).toBe('PulsarChannel');
    expect(nyx.castTimeScaleByAbility?.[HOARD_CAST_PULSAR_OVERLOAD]).toBe(1);
  });
});

describe('Hoarfrost Warden clip wiring', () => {
  it('maps the cast and both gestures to clips of his own', () => {
    const clips = VISUALS.mob_hoard_hoarfrost_warden.clips;
    expect(clips.castByAbility?.[HOARD_CAST_ICE_AGE]).toBe('IceAge');
    expect(clips.attackByAbility?.[HOARD_GESTURE_FROST_GUST]).toBe('FrostFrontal');
    expect(clips.attackByAbility?.[HOARD_GESTURE_ICE_AGE_RELEASE]).toBe('IceAgeRelease');
    // Authored speed: the release frame is timed against the cue clock.
    expect(clips.attackTimeScaleByAbility?.[HOARD_GESTURE_FROST_GUST]).toBe(1);
    expect(clips.attackTimeScaleByAbility?.[HOARD_GESTURE_ICE_AGE_RELEASE]).toBe(1);
  });
});
