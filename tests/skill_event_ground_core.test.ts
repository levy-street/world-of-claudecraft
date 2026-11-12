// The skill event ground plans (src/render/skill_event_ground_core.ts): the
// arena ring the hill builder draws, the footprint fade steps, and the breath
// plume's pose.

import { describe, expect, it } from 'vitest';
import {
  SKILL_EVENT_MARK_DRAW_LIFETIME,
  SKILL_EVENT_STEP_FADE_BUCKETS,
  skillEventMarkPose,
  skillEventRingInput,
  skillEventStepBucket,
  skillEventStepNormalInto,
} from '../src/render/skill_event_ground_core';
import { SKILL_EVENT_MARK_LIFETIME } from '../src/sim/pvp/skill_event_footprints';
import type { SkillEventInfo } from '../src/world_api/world_pvp';

const info = (over: Partial<SkillEventInfo>): SkillEventInfo => ({
  kind: 'footprints',
  phase: 'running',
  zoneId: 'z',
  x: 10,
  z: 20,
  radius: 25,
  fieldRadius: 18.4,
  minutesLeft: 5,
  joined: true,
  canJoin: false,
  participants: 2,
  yourKills: 0,
  score: null,
  hearts: 4,
  maxHearts: 4,
  kit: null,
  stones: null,
  hand: null,
  ...over,
});

describe('skillEventRingInput', () => {
  it('draws no ring between events', () => {
    expect(skillEventRingInput(null)).toBeNull();
  });
  it('draws a running event red at its field radius, rounded to the yard', () => {
    expect(skillEventRingInput(info({}))).toEqual({
      x: 10,
      z: 20,
      radius: 18,
      phase: 'active',
      holder: 'other',
      challenger: 'none',
    });
  });
  it('draws the warning as the faint outline', () => {
    expect(skillEventRingInput(info({ phase: 'warning', fieldRadius: 25 }))?.phase).toBe('warning');
  });
});

describe('the footprint fade steps', () => {
  it('match the sim lifetime', () => {
    expect(SKILL_EVENT_MARK_DRAW_LIFETIME).toBe(SKILL_EVENT_MARK_LIFETIME);
  });
  it('run newest to oldest and stop at the lifetime', () => {
    expect(skillEventStepBucket(0)).toBe(0);
    expect(skillEventStepBucket(SKILL_EVENT_MARK_DRAW_LIFETIME * 0.99)).toBe(
      SKILL_EVENT_STEP_FADE_BUCKETS - 1,
    );
    expect(skillEventStepBucket(SKILL_EVENT_MARK_DRAW_LIFETIME)).toBe(-1);
  });
  it('the dent is flat at the centre and outside, tilted on the slope', () => {
    const n = { x: 0, y: 0, z: 0 };
    expect(skillEventStepNormalInto(n, 0, 0)).toEqual({ x: 0, y: 1, z: 0 });
    expect(skillEventStepNormalInto(n, 1.2, 0)).toEqual({ x: 0, y: 1, z: 0 });
    skillEventStepNormalInto(n, 0.5, 0);
    expect(n.y).toBeLessThan(1);
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 6);
  });
});

describe('skillEventMarkPose', () => {
  const out = { alpha: 0, lift: 0, scale: 1 };
  it('a breath plume rises, swells, and is a half-strength trace', () => {
    const fresh = { ...skillEventMarkPose('breath', 0, out) };
    expect(fresh.alpha).toBeCloseTo(0.425, 6);
    const later = { ...skillEventMarkPose('breath', 2, out) };
    expect(later.lift).toBeGreaterThan(fresh.lift);
    expect(later.scale).toBeGreaterThan(fresh.scale);
    expect(later.alpha).toBeLessThan(fresh.alpha);
    expect(skillEventMarkPose('breath', SKILL_EVENT_MARK_DRAW_LIFETIME, out).alpha).toBe(0);
  });
});
