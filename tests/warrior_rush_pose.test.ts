import { expect, it } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import { WarriorRushPose } from '../src/render/characters/warrior_rush_pose';

const state = (extra: Partial<AnimState> = {}) =>
  ({
    moving: true,
    speed: 21,
    running: true,
    dead: false,
    airborne: false,
    swimming: false,
    casting: false,
    ...extra,
  }) as AnimState;

it('ordinary movement never starts a rush without its cast, including after expiry', () => {
  const pose = new WarriorRushPose();
  pose.update(0.1, state());
  expect(pose.active).toBe(false);
  pose.begin();
  pose.update(0.1, state());
  expect(pose.active).toBe(true);
  pose.update(3.2, state());
  expect(pose.active).toBe(false);
});

it('waits for displayed motion, returns to locomotion at arrival and cannot restart after a stall', () => {
  const pose = new WarriorRushPose();
  pose.begin();
  pose.update(0, state({ moving: false, speed: 0 }));
  expect(pose.active).toBe(false);
  pose.update(0.1, state());
  expect(pose.active).toBe(true);
  pose.update(0.15, state({ moving: false, speed: 0 }));
  expect(pose.active).toBe(false);
  pose.update(0.1, state());
  expect(pose.active).toBe(false);
});

it('hands back to ordinary running immediately after rush travel, without requiring a stop', () => {
  const pose = new WarriorRushPose();
  pose.begin();
  pose.update(0.15, state());
  expect(pose.active).toBe(true);
  pose.update(0.15, state({ speed: 7 }));
  expect(pose.active).toBe(false);
  pose.update(0.1, state());
  expect(pose.active).toBe(false);
});

it.each(['dead', 'swimming', 'airborne', 'casting'] as const)(
  'cancels on %s and needs another cast',
  (key) => {
    const pose = new WarriorRushPose();
    pose.begin();
    pose.update(0.1, state());
    pose.update(0.05, state({ [key]: true }));
    expect(pose.active).toBe(false);
    pose.update(0.1, state());
    expect(pose.active).toBe(false);
    pose.begin();
    pose.update(0.1, state());
    expect(pose.active).toBe(true);
  },
);
