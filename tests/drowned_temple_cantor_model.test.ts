// Laverock's own body (public/models/creatures/temple_laverock.glb, built by the
// Blender builder adapted from the Velkhar kit): every clip the game asks for
// ships in the file, and the manifest row maps the guide's gestures (the
// overhead emotes his lines set) and his song (the cantor_last_verse channel)
// onto them.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type AnimState,
  desiredBaseState,
  locomotionTimeScale,
} from '../src/render/characters/anim_state';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { newLocoState, newLocoTrack, updateLocomotionInto } from '../src/render/locomotion';
import {
  CANTOR_GUIDE,
  CANTOR_LAST_VERSE_CAST,
  CANTOR_NPC_ID,
} from '../src/sim/content/drowned_temple_cantor';
import { recordTrail, stepAlongTrail } from '../src/sim/dungeon_guide/follow';
import { freshGuideRun } from '../src/sim/dungeon_guide/guide';
import { GUIDE_TALK_GESTURE } from '../src/sim/dungeon_guide/speech';
import { DT } from '../src/sim/types';

function clipsOf(path: string): string[] {
  const buf = readFileSync(path);
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
    animations?: { name: string }[];
  };
  return (json.animations ?? []).map((a) => a.name);
}

describe('Laverock: his own model', () => {
  const key = visualKeyFor({ kind: 'npc', templateId: CANTOR_NPC_ID } as never);
  const v = VISUALS[key];

  it('ships the six clips he plays', () => {
    expect(key).toBe('npc_laverock');
    expect(v.url).toBe('models/creatures/temple_laverock.glb');
    expect(clipsOf('public/models/creatures/temple_laverock.glb').sort()).toEqual(
      ['Idle', 'Kneel', 'Sing', 'Startle', 'Talk', 'Walk'].sort(),
    );
  });

  it('maps every gesture a line can set, and the song, to a clip in the file', () => {
    const shipped = new Set([
      ...clipsOf('public/models/creatures/temple_laverock.glb'),
      ...clipsOf('public/models/creatures/temple_laverock_locomotion.glb'),
    ]);
    const gestures = new Set<string>([GUIDE_TALK_GESTURE]);
    for (const line of CANTOR_GUIDE.lines) if (line.gesture) gestures.add(line.gesture);
    for (const g of gestures) {
      const spec = v.clips.emote?.[g as keyof NonNullable<typeof v.clips.emote>];
      expect(spec, g).toBeDefined();
      for (const c of spec?.clips ?? []) expect(shipped.has(c), `${g} -> ${c}`).toBe(true);
    }
    expect(v.clips.castByAbility?.[CANTOR_LAST_VERSE_CAST]).toBe('Sing');
    for (const c of [v.clips.idle, v.clips.walk, v.clips.run, v.clips.death, ...v.clips.attack]) {
      expect(shipped.has(c), c).toBe(true);
    }
  });

  it('keeps his feet planted at the follow walk, and stands a head over the player', () => {
    // The Walk clip covers walkRef yd/s at 1x; the guide follows at walkSpeed,
    // so the clip must be allowed to play at least that fast or he slides.
    const walkRef = v.walkRef ?? 0;
    expect(walkRef * (v.walkTimeScaleMax ?? 0)).toBeGreaterThanOrEqual(
      CANTOR_GUIDE.follow.walkSpeed,
    );
    // A catch-up run must cover the whole movement too, without skating.
    expect((v.runRef ?? 0) * (v.runTimeScaleMax ?? 0)).toBeGreaterThanOrEqual(
      CANTOR_GUIDE.follow.runSpeed,
    );
    // Normalized on the idle bounds with the staff's moon on top: the body
    // (about 0.8 of that) stands taller than the 2.6 yd player.
    expect(v.height * 0.8).toBeGreaterThan(2.6);
  });

  it.each([
    { distance: 8, gait: 'walk', ceiling: 1.8 },
    { distance: 30, gait: 'run', ceiling: 1.6 },
  ] as const)(
    'matches the trail movement with a bounded $gait cadence',
    ({ distance, gait, ceiling }) => {
      const track = newLocoTrack();
      const loco = newLocoState();
      let speed = 0;
      // Sample the actual follow geometry, then feed its displacements through
      // the renderer's smoothing and gait selection until the cadence settles.
      for (let i = 0; i < 60; i++) {
        const run = freshGuideRun(CANTOR_GUIDE, 9);
        for (let z = 1; z <= distance; z++) recordTrail(run, { x: 0, y: 2, z });
        const step = stepAlongTrail(
          run,
          { x: 0, y: 2, z: 0 },
          0,
          { x: 0, y: 2, z: distance },
          CANTOR_GUIDE.follow,
          DT,
        );
        speed = step.pos.z / DT;
        updateLocomotionInto(loco, track, step.pos.x, step.pos.z, step.facing, DT, v.gait);
      }
      const state: AnimState = {
        ...loco,
        airborne: false,
        dead: false,
        casting: false,
        swimming: false,
        submerged: false,
        swimPitch: 0,
        wading: false,
        sitting: false,
      };
      const base = desiredBaseState(state, false);
      expect(base).toBe(gait);
      const cadence = locomotionTimeScale(
        base,
        state,
        v.walkRef,
        v.runRef,
        undefined,
        undefined,
        undefined,
        v.walkTimeScaleMax,
        v.runTimeScaleMax,
      );
      expect(cadence).not.toBeNull();
      expect(cadence).toBeLessThanOrEqual(ceiling);
      const reference = (base === 'run' ? v.runRef : v.walkRef) ?? 0;
      expect((cadence ?? 0) * reference).toBeCloseTo(speed, 5);
    },
  );

  it('keeps the hurried gait through small speed dips and turns, then stops and resumes walking', () => {
    const track = newLocoTrack();
    const loco = newLocoState();
    const sample = (speed: number, facing = 0) =>
      updateLocomotionInto(
        loco,
        track,
        Math.sin(facing) * speed * DT,
        Math.cos(facing) * speed * DT,
        facing,
        DT,
        v.gait,
      );
    for (let i = 0; i < 60; i++) sample(CANTOR_GUIDE.follow.runSpeed);
    expect(loco.running).toBe(true);
    for (let i = 0; i < 20; i++) {
      sample(i % 2 === 0 ? 4.2 : 4.4, Math.PI / 2);
      expect(loco.running).toBe(true);
      expect(loco.backwards).toBe(false);
    }
    // One stalled frame retains the travel state, rather than restarting Walk.
    sample(0);
    expect(loco.moving).toBe(true);
    for (let i = 0; i < 20; i++) sample(0);
    expect(loco.moving).toBe(false);
    expect(loco.running).toBe(false);
    for (let i = 0; i < 60; i++) sample(CANTOR_GUIDE.follow.walkSpeed);
    expect(loco.moving).toBe(true);
    expect(loco.running).toBe(false);
  });
});
