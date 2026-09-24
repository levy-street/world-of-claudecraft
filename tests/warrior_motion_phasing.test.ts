import { expect, it } from 'vitest';
import { warriorMotionWeight as weight } from '../scripts/anim/warrior_motion_phasing.mjs';

it('leads with body weight, trails the hands, and preserves exact contacts and recovery endpoints', () => {
  for (const end of [0.075, 0.15, 0.34, 0.74])
    for (const key of [
      'hips|translation',
      'chest|rotation',
      'upper_arm.r|rotation',
      'hand.r|rotation',
      'hand.l|rotation',
    ]) {
      expect(weight('Warrior_Brute_Swing', key, 0, end, 0)).toBe(0);
      expect(weight('Warrior_Brute_Swing', key, 0, end, 1)).toBe(1);
      let previous = 0;
      for (let i = 1; i <= 60; i++) {
        const now = weight('Warrior_Brute_Swing', key, 0, end, i / 60);
        expect(now).toBeGreaterThanOrEqual(previous);
        expect(now).toBeLessThanOrEqual(1);
        previous = now;
      }
    }
  expect(weight('Warrior_Brute_Swing', 'hips|translation', 0.075, 0.15, 0.5)).toBeGreaterThan(
    weight('Warrior_Brute_Swing', 'hand.r|rotation', 0.075, 0.15, 0.5),
  );
  expect(weight('Warrior_Brute_Swing', 'hand.l|rotation', 0.34, 0.74, 0.5)).toBeGreaterThan(
    weight('Warrior_Brute_Swing', 'hand.r|rotation', 0.34, 0.74, 0.5),
  );
});
it('retains continuous spin interpolation without introducing a second stop-start rhythm', () => {
  for (const name of ['Warrior_Bladestorm_Loop', 'Warrior_Bladed_Gyre'])
    for (const key of ['hips|translation', 'hand.r|rotation'])
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        expect(weight(name, key, 0, 0.15, t)).toBe(t * t);
        expect(weight(name, key, 0.15, 0.45, t)).toBe(t * t * (3 - 2 * t));
      }
});
