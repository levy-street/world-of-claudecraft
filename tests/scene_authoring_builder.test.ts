import { describe, expect, it } from 'vitest';
import {
  LAST_BELL_VOYAGE_SEGMENT_IDS,
  LB_PROP_CUE_PARK,
} from '../src/sim/content/last_bell_cinematics';
import {
  beat,
  buildScene,
  coveredCut,
  fadeInTail,
  type SceneCameraShotDef,
  type SceneTimelineOpDef,
} from '../src/sim/scenes/authoring';
import { registeredSceneIds, type SceneOpDef } from '../src/sim/scenes/registry';

type BuilderPropOp = Extract<SceneTimelineOpDef<'start'>, { kind: 'prop' }>;
type BuilderMusicOp = Extract<SceneTimelineOpDef<'start'>, { kind: 'music' }>;

const registeredPropCue: BuilderPropOp['cue'] = LAST_BELL_VOYAGE_SEGMENT_IDS.out.castOff;
const registeredMusic: BuilderMusicOp['directive'] = 'lb_harbor_ambience';
const builderKindsAreComplete: Exclude<
  SceneOpDef['kind'],
  SceneTimelineOpDef<'start'>['kind']
> extends never
  ? true
  : never = true;

// @ts-expect-error builder prop cues stay restricted to registered cue ids
const misspelledPropCue: BuilderPropOp['cue'] = 'lb_voyage_out_cast_of';

// @ts-expect-error builder music stays restricted to registered directives
const unregisteredMusic: BuilderMusicOp['directive'] = 'lb_no_such_directive';

void misspelledPropCue;
void unregisteredMusic;
void builderKindsAreComplete;

function rejectMistypedBuilderReferences(): void {
  buildScene<{ readonly start: 0 }>({
    id: 'scn_test_bad_prop_type',
    beats: { start: 0 },
    timeline: [
      // @ts-expect-error buildScene rejects misspelled prop cue ids
      {
        at: 'start',
        kind: 'prop',
        target: 'harbor_ship_mainland',
        cue: 'lb_voyage_out_cast_of',
      },
    ],
  });
  buildScene<{ readonly start: 0 }>({
    id: 'scn_test_bad_music_type',
    beats: { start: 0 },
    timeline: [
      // @ts-expect-error buildScene rejects unregistered music directives
      {
        at: 'start',
        kind: 'music',
        directive: 'lb_no_such_directive',
      },
    ],
  });
}

void rejectMistypedBuilderReferences;

const FOCUS_SHOT = {
  kind: 'focus',
  actorId: 'tam',
  dist: 6,
  dur: 1.5,
} satisfies SceneCameraShotDef;

const DOLLY_SHOT = {
  kind: 'dolly',
  points: [
    { x: 1, z: 2, height: 3 },
    { x: 4, z: 5, height: 6 },
  ],
  lookAt: {
    kind: 'point',
    point: { x: 7, z: 8, height: 9 },
  },
  dur: 2,
} satisfies SceneCameraShotDef;

describe('scene authoring builder', () => {
  it('resolves named beats and offsets to sorted absolute times', () => {
    const scene = buildScene({
      id: 'scn_test_beat_math',
      beats: {
        opening: 1.25,
        exchange: 3,
      },
      releaseMargin: 0,
      timeline: [
        {
          at: beat('exchange', -0.25),
          kind: 'line',
          speaker: 'lb.speaker.tam',
          key: 'lb.test.line',
          dur: 1,
        },
        { at: beat('opening', 0.5), kind: 'music', directive: registeredMusic },
      ],
    });

    expect(scene).toEqual({
      id: 'scn_test_beat_math',
      duration: 3.75,
      ops: [
        { at: 1.75, kind: 'music', directive: 'lb_harbor_ambience' },
        {
          at: 2.75,
          kind: 'line',
          speaker: 'lb.speaker.tam',
          key: 'lb.test.line',
          dur: 1,
        },
      ],
    });
  });

  it('covers a camera cut with fade lead, cut black, and fade clear', () => {
    const scene = buildScene({
      id: 'scn_test_covered_cut',
      beats: { cut: 2 },
      releaseMargin: 0,
      timeline: [coveredCut('cut', FOCUS_SHOT)],
    });

    expect(scene.ops).toEqual([
      { at: 1.55, kind: 'fade', to: 'black', dur: 0.4 },
      { at: 2, kind: 'fade', to: 'black', dur: 0 },
      { at: 2, kind: 'camera', shot: FOCUS_SHOT },
      { at: 2.05, kind: 'fade', to: 'clear', dur: 0.4 },
    ]);
    expect(scene.duration).toBe(3.5);
  });

  it('spreads a covered cut with authored fade and hold around the cut', () => {
    const scene = buildScene({
      id: 'scn_test_covered_cut_hold',
      beats: { cut: 3 },
      releaseMargin: 0,
      timeline: [coveredCut('cut', FOCUS_SHOT, { fadeSeconds: 0.8, holdSeconds: 0.5 })],
    });

    expect(scene.ops).toEqual([
      { at: 1.95, kind: 'fade', to: 'black', dur: 0.8 },
      { at: 3, kind: 'fade', to: 'black', dur: 0 },
      { at: 3, kind: 'camera', shot: FOCUS_SHOT },
      { at: 3.25, kind: 'fade', to: 'clear', dur: 0.8 },
    ]);
  });

  it('rejects covered cut fades below the perceptual floor and holds below two ticks', () => {
    expect(() =>
      buildScene({
        id: 'scn_test_covered_cut_thin_fade',
        beats: { cut: 3 },
        releaseMargin: 0,
        timeline: [coveredCut('cut', FOCUS_SHOT, { fadeSeconds: 0.2 })],
      }),
    ).toThrow('coveredCut fadeSeconds must be at least 0.4s');
    expect(() =>
      buildScene({
        id: 'scn_test_covered_cut_thin_hold',
        beats: { cut: 3 },
        releaseMargin: 0,
        timeline: [coveredCut('cut', FOCUS_SHOT, { holdSeconds: 0.01 })],
      }),
    ).toThrow('coveredCut holdSeconds must be at least 0.1s');
  });

  it('rejects a covered cut without enough perceptual fade lead', () => {
    expect(() =>
      buildScene({
        id: 'scn_test_scene_start_cut',
        beats: { opening: 0 },
        releaseMargin: 0,
        timeline: [coveredCut('opening', FOCUS_SHOT)],
      }),
    ).toThrow('coveredCut at 0s requires at least 0.45s for the fade floor');
  });

  it('accepts a covered cut at the exact perceptual fade lead boundary', () => {
    const scene = buildScene({
      id: 'scn_test_boundary_covered_cut',
      beats: { opening: 0.45 },
      releaseMargin: 0,
      timeline: [coveredCut('opening', FOCUS_SHOT)],
    });

    expect(scene.ops[0]).toEqual({
      at: 0,
      kind: 'fade',
      to: 'black',
      dur: 0.4,
    });
  });

  it('keeps a tail clear authored before the derived scene end', () => {
    const scene = buildScene({
      id: 'scn_test_fade_tail',
      beats: { release: 2 },
      releaseMargin: 0.4,
      timeline: [
        { at: beat('release', -0.5), kind: 'fade', to: 'black', dur: 0.4 },
        { at: 'release', kind: 'letterbox', on: false },
        fadeInTail(beat('release', 0.1), 0.4),
      ],
    });

    expect(scene.ops.at(-1)).toEqual({
      at: 2.1,
      kind: 'fade',
      to: 'clear',
      dur: 0.4,
    });
    expect(scene.duration).toBe(2.9);
    expect(scene.ops.at(-1)?.at).toBeLessThan(scene.duration);
  });

  it('derives duration from numeric ops plus the default release margin', () => {
    const before = registeredSceneIds();
    const scene = buildScene({
      id: 'scn_test_numeric_timeline',
      beats: {},
      timeline: [
        { at: 0, kind: 'inputLock', on: true },
        { at: 2, kind: 'fade', to: 'clear', dur: 0.3 },
      ],
    });

    expect(scene.duration).toBe(3.3);
    expect(scene.ops).toEqual([
      { at: 0, kind: 'inputLock', on: true },
      { at: 2, kind: 'fade', to: 'clear', dur: 0.3 },
    ]);
    expect(registeredSceneIds()).toEqual(before);
  });

  it('uses the runtime default when a final line omits its duration', () => {
    const scene = buildScene({
      id: 'scn_test_default_line_duration',
      beats: { line: 1 },
      releaseMargin: 0,
      timeline: [{ at: 'line', kind: 'line', speaker: '', key: 'lb.test.line' }],
    });

    expect(scene.duration).toBe(5);
    expect(scene.ops).toStrictEqual([{ at: 1, kind: 'line', speaker: '', key: 'lb.test.line' }]);
  });

  it('derives duration through a raw dolly camera op', () => {
    const scene = buildScene({
      id: 'scn_test_dolly_duration',
      beats: { shot: 1 },
      releaseMargin: 0.2,
      timeline: [{ at: 'shot', kind: 'camera', shot: DOLLY_SHOT }],
    });

    expect(scene.duration).toBe(3.2);
    expect(scene.ops).toStrictEqual([{ at: 1, kind: 'camera', shot: DOLLY_SHOT }]);
  });

  it('requires fadeInTail to meet the perceptual fade floor', () => {
    expect(() =>
      buildScene({
        id: 'scn_test_instant_fade_tail',
        beats: { tail: 1 },
        releaseMargin: 0,
        timeline: [fadeInTail('tail', 0.3)],
      }),
    ).toThrow('fadeInTail duration must be at least 0.4s');
  });

  it('rejects a fade authored after fadeInTail', () => {
    expect(() =>
      buildScene({
        id: 'scn_test_broken_fade_tail',
        beats: { tail: 1 },
        releaseMargin: 0,
        timeline: [
          fadeInTail('tail'),
          { at: beat('tail', 0.1), kind: 'fade', to: 'black', dur: 0 },
        ],
      }),
    ).toThrow('has a fade after fadeInTail');
  });

  it('emits the exact plain SceneDef golden object', () => {
    const scene = buildScene({
      id: 'scn_test_builder_golden',
      beats: {
        opening: 0,
        reveal: 1,
        release: 2,
      },
      releaseMargin: 0.5,
      timeline: [
        { at: 'opening', kind: 'letterbox', on: true },
        { at: beat('opening', 0.2), kind: 'music', directive: registeredMusic },
        coveredCut('reveal', FOCUS_SHOT),
        {
          at: 'release',
          kind: 'prop',
          target: 'harbor_ship_mainland',
          cue: LB_PROP_CUE_PARK,
        },
        fadeInTail(beat('release', 0.2), 0.4),
      ],
    });

    expect(scene).toStrictEqual({
      id: 'scn_test_builder_golden',
      duration: 3.1,
      ops: [
        { at: 0, kind: 'letterbox', on: true },
        { at: 0.2, kind: 'music', directive: 'lb_harbor_ambience' },
        { at: 0.55, kind: 'fade', to: 'black', dur: 0.4 },
        { at: 1, kind: 'fade', to: 'black', dur: 0 },
        { at: 1, kind: 'camera', shot: FOCUS_SHOT },
        { at: 1.05, kind: 'fade', to: 'clear', dur: 0.4 },
        {
          at: 2,
          kind: 'prop',
          target: 'harbor_ship_mainland',
          cue: 'lb_prop_cue_park',
        },
        { at: 2.2, kind: 'fade', to: 'clear', dur: 0.4 },
      ],
    });
    expect(Object.getPrototypeOf(scene)).toBe(Object.prototype);
    expect(scene.ops.every((op) => Object.getPrototypeOf(op) === Object.prototype)).toBe(true);
    expect(registeredPropCue).toBe('lb_voyage_out_cast_off');
  });
});
