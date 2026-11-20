// The Smith's Heart's own trash and add bodies moved by their fight's cues
// (src/render/smith_heart_fx/trash_gestures_core.ts, trash_gestures.ts): a rise cue at a spot
// brings up every body of its templates in reach the first frame each exists, within a short
// window and never after it; a claimed cue a body sends plays that body's gesture; nothing else
// moves anybody. Every cue id is the sim's own, so a renamed cue fails here.

import { describe, expect, it } from 'vitest';
import { SmithHeartTrashGestures } from '../src/render/smith_heart_fx/trash_gestures';
import {
  SMITH_HEART_TRASH_RISE,
  TRASH_RISE_CUES,
  TRASH_RISE_SLACK,
  TRASH_RISE_WINDOW_SECONDS,
  TRASH_SOURCE_GESTURES,
  trashRiseMatches,
  trashRiseOffer,
  trashSourceGesture,
} from '../src/render/smith_heart_fx/trash_gestures_core';
import { ISLE_CUES } from '../src/sim/encounters/smith_heart/breath_isle_ids';
import { FINAL_PHASE_CUES } from '../src/sim/encounters/smith_heart/final_phase_ids';
import { HEAT_CUES } from '../src/sim/encounters/smith_heart/heat_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const at = (ability: string, x: number, z: number, radius: number): SimEvent =>
  ({ type: 'spellfxAt', x, z, school: 'fire', fx: 'burst', radius, ability }) as SimEvent;
const from = (sourceId: number, ability: string): SimEvent =>
  ({ type: 'spellfx', sourceId, targetId: 1, school: 'fire', fx: 'beam', ability }) as SimEvent;

function mob(id: number, templateId: string, x: number, z: number, dead = false): Entity {
  return { id, kind: 'mob', templateId, dead, pos: { x, y: 0, z } } as unknown as Entity;
}

function world(...entities: Entity[]): IWorld {
  return { entities: new Map(entities.map((e) => [e.id, e])) } as unknown as IWorld;
}

describe('the rise cues', () => {
  it("are the sim's own spawn cues, each bringing up its own bodies", () => {
    expect(TRASH_RISE_CUES[FINAL_PHASE_CUES.rise]).toEqual([
      'heart_final_splinter_heat',
      'heart_final_splinter_quench',
      'heart_final_splinter_breath',
      'heart_final_splinter_hammer',
    ]);
    expect(TRASH_RISE_CUES[HEAT_CUES.spawn]).toEqual([
      'heart_heat_wellspawn',
      'heart_heat_wellkeeper',
    ]);
    expect(TRASH_RISE_CUES[HEAT_CUES.hatch]).toEqual(['heart_heat_seedflame']);
    expect(TRASH_RISE_CUES[ISLE_CUES.isleWake]).toEqual([
      'heart_gale_sentinel',
      'heart_gale_mender',
    ]);
  });

  it('open a window at the cue, reaching its radius plus a little slack', () => {
    const offer = trashRiseOffer(at(HEAT_CUES.spawn, 10, 20, 2.5), 4);
    expect(offer).toEqual({
      x: 10,
      z: 20,
      reach: 2.5 + TRASH_RISE_SLACK,
      templates: TRASH_RISE_CUES[HEAT_CUES.spawn],
      until: 4 + TRASH_RISE_WINDOW_SECONDS,
    });
    if (!offer) return;
    expect(trashRiseMatches(offer, 'heart_heat_wellkeeper', 12, 21)).toBe(true);
    expect(trashRiseMatches(offer, 'heart_heat_wellkeeper', 16, 20)).toBe(false);
    // Another template beside the spot is not this cue's.
    expect(trashRiseMatches(offer, 'heart_heat_warder', 10, 20)).toBe(false);
  });

  it('never open on a cue that is not a rise, or not at a spot', () => {
    expect(trashRiseOffer(at(HEAT_CUES.feed, 0, 0, 3), 0)).toBeNull();
    expect(trashRiseOffer(from(5, HEAT_CUES.spawn), 0)).toBeNull();
  });
});

describe('the claimed cues a body sends', () => {
  it('play its own gesture, and only for the templates that answer it', () => {
    expect(trashSourceGesture(from(9, HEAT_CUES.kindling), 'heart_heat_wellkeeper')).toBe(
      HEAT_CUES.kindling,
    );
    expect(trashSourceGesture(from(9, FINAL_PHASE_CUES.coal), 'heart_final_splinter_heat')).toBe(
      FINAL_PHASE_CUES.coal,
    );
    expect(trashSourceGesture(from(9, FINAL_PHASE_CUES.shear), 'heart_final_splinter_breath')).toBe(
      FINAL_PHASE_CUES.shear,
    );
    expect(trashSourceGesture(from(9, FINAL_PHASE_CUES.toll), 'heart_final_splinter_quench')).toBe(
      FINAL_PHASE_CUES.toll,
    );
    // The boss's own cues and another body's are never re-sent.
    expect(
      trashSourceGesture(from(9, FINAL_PHASE_CUES.toll), 'heart_final_splinter_heat'),
    ).toBeNull();
    expect(trashSourceGesture(from(9, HEAT_CUES.kindling), 'heart_heat_guardian')).toBeNull();
    expect(trashSourceGesture(from(9, HEAT_CUES.flare), 'heart_heat_wellkeeper')).toBeNull();
    expect(trashSourceGesture(from(9, HEAT_CUES.kindling), undefined)).toBeNull();
  });

  it("are the sim's own cue ids", () => {
    expect(Object.keys(TRASH_SOURCE_GESTURES).sort()).toEqual(
      [
        HEAT_CUES.kindling,
        FINAL_PHASE_CUES.coal,
        FINAL_PHASE_CUES.shear,
        FINAL_PHASE_CUES.toll,
      ].sort(),
    );
  });
});

describe('SmithHeartTrashGestures', () => {
  it('raises every body in reach the frame it exists, within the window and never after', () => {
    const sent: Array<[number, string]> = [];
    const keeper = mob(7, 'heart_heat_wellkeeper', 101, 50);
    const w = world(keeper, mob(8, 'heart_heat_wellspawn', 140, 50));
    const fx = new SmithHeartTrashGestures(w, (id, g) => sent.push([id, g]));
    fx.handleEvent(at(HEAT_CUES.spawn, 100, 50, 2.5));
    expect(sent).toEqual([[7, SMITH_HEART_TRASH_RISE]]);
    // A body built a frame later is still offered its rise.
    (w.entities as Map<number, Entity>).set(9, mob(9, 'heart_heat_wellspawn', 99.5, 51));
    fx.update(0.1);
    expect(sent).toContainEqual([9, SMITH_HEART_TRASH_RISE]);
    // A body first seen past the window stands where it is.
    sent.length = 0;
    fx.update(TRASH_RISE_WINDOW_SECONDS);
    (w.entities as Map<number, Entity>).set(10, mob(10, 'heart_heat_wellspawn', 100, 50));
    fx.update(0.1);
    expect(sent).toEqual([]);
  });

  it('never raises a dead body, and plays a claimed cue on the body that sent it', () => {
    const sent: Array<[number, string]> = [];
    const w = world(
      mob(3, 'heart_final_splinter_quench', 0, 0, true),
      mob(4, 'heart_final_splinter_quench', 0, 0),
    );
    const fx = new SmithHeartTrashGestures(w, (id, g) => sent.push([id, g]));
    fx.handleEvent(at(FINAL_PHASE_CUES.rise, 0, 0, 4));
    expect(sent).toEqual([[4, SMITH_HEART_TRASH_RISE]]);
    sent.length = 0;
    fx.handleEvent(from(4, FINAL_PHASE_CUES.toll));
    expect(sent).toEqual([[4, FINAL_PHASE_CUES.toll]]);
  });

  it('does nothing without a gesture seam or a world', () => {
    const fx = new SmithHeartTrashGestures(undefined, undefined);
    expect(() => {
      fx.handleEvent(at(HEAT_CUES.spawn, 0, 0, 2));
      fx.update(0.1);
    }).not.toThrow();
  });
});
