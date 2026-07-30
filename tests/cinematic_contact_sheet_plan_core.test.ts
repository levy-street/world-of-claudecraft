import { describe, expect, it } from 'vitest';
import {
  contactSheetIntentAt,
  planContactSheet,
} from '../scripts/lib/cinematic_contact_sheet_plan_core.mjs';

describe('cinematic contact sheet sampling plan', () => {
  it('covers every authored camera window including the tail cut', () => {
    const plan = planContactSheet({
      sceneId: 'scn_contact_smoke',
      seed: 734_221,
      duration: 10,
      ops: [
        {
          at: 0,
          kind: 'prop',
          target: 'harbor_ship',
          cue: 'cast_off',
          dur: 4,
        },
        {
          at: 0,
          kind: 'camera',
          shot: { kind: 'attach', target: 'harbor_ship' },
        },
        { at: 1, kind: 'line', key: 'lb.departure', dur: 3 },
        {
          at: 4,
          kind: 'camera',
          shot: { kind: 'focus', actorId: 'captain' },
        },
        { at: 5, kind: 'line', key: 'lb.captain.warning', dur: 2 },
        {
          at: 9,
          kind: 'prop',
          target: 'signal_beacon',
          cue: 'flare',
          dur: 0.8,
        },
        {
          at: 9,
          kind: 'camera',
          shot: {
            kind: 'dolly',
            lookAt: { kind: 'subject', actorId: 'lookout' },
          },
        },
        { at: 9.25, kind: 'line', key: 'lb.landfall', dur: 0.6 },
        { at: 10, kind: 'camera', shot: { kind: 'release' } },
      ],
    });

    expect(
      plan.stills.map((still) => [still.windowStart, still.targetTime, still.windowEnd]),
    ).toEqual([
      [0, 2, 4],
      [4, 6.5, 9],
      [9, 9.5, 10],
    ]);
    expect(plan.stills.map((still) => still.file)).toEqual([
      'frame_0000_target_2s.png',
      'frame_0001_target_6_5s.png',
      'frame_0002_target_9_5s.png',
    ]);
    expect(plan.stills[0].expectedSubjects).toEqual(['harbor_ship']);
    expect(plan.stills[0].expectedTextKeys).toEqual(['lb.departure']);
    expect(plan.stills[1].expectedSubjects).toEqual(['captain']);
    expect(plan.stills[1].expectedTextKeys).toEqual(['lb.captain.warning']);
    expect(plan.stills[2].expectedSubjects).toEqual(['lookout', 'signal_beacon']);
    expect(plan.stills[2].expectedTextKeys).toEqual(['lb.landfall']);
  });

  it('derives active subjects, text, and prop motion at the measured clock', () => {
    const ops = [
      {
        at: 0,
        kind: 'camera',
        shot: { kind: 'attach', target: 'harbor_ship', subjectRef: 'ferrykeeper' },
      },
      { at: 1, kind: 'prop', target: 'signal_beacon', cue: 'flare', dur: 1 },
      {
        at: 1.2,
        kind: 'line',
        key: 'lb.landfall',
        speakerActorId: 'lookout',
        dur: 0.6,
      },
    ];

    expect(contactSheetIntentAt(ops, 1.5)).toEqual({
      expectedSubjects: ['ferrykeeper', 'signal_beacon', 'lookout'],
      expectedTextKeys: ['lb.landfall'],
    });
    expect(contactSheetIntentAt(ops, 2.1)).toEqual({
      expectedSubjects: ['ferrykeeper'],
      expectedTextKeys: [],
    });
  });

  it('treats authored line and prop windows as half-open intervals', () => {
    const ops = [
      { at: 1, kind: 'prop', target: 'signal_beacon', cue: 'flare', dur: 1 },
      { at: 1.25, kind: 'line', key: 'lb.landfall', dur: 1 },
    ];

    expect(contactSheetIntentAt(ops, 1)).toEqual({
      expectedSubjects: ['signal_beacon'],
      expectedTextKeys: [],
    });
    expect(contactSheetIntentAt(ops, 1.25)).toEqual({
      expectedSubjects: ['signal_beacon'],
      expectedTextKeys: ['lb.landfall'],
    });
    expect(contactSheetIntentAt(ops, 2)).toEqual({
      expectedSubjects: [],
      expectedTextKeys: ['lb.landfall'],
    });
    expect(contactSheetIntentAt(ops, 2.25)).toEqual({
      expectedSubjects: [],
      expectedTextKeys: [],
    });
  });
});
