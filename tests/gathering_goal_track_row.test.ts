// @vitest-environment happy-dom
//
// Unit coverage for the extracted gathering-goal Track control (Intentional
// Gathering), driven directly rather than through the full crafting window
// (that integration path stays covered by crafting_window_track_goal.test.ts).

import { describe, expect, it, vi } from 'vitest';
import {
  renderGatheringGoalTrackRow,
  type TrackRowDeps,
} from '../src/ui/hud/professions/gathering_goal_track_row';

function fullDeps(overrides: Partial<TrackRowDeps> = {}): TrackRowDeps {
  return {
    goalQty: () => 12,
    onGoalQty: () => {},
    onTrackRecipe: () => {},
    ...overrides,
  };
}

describe('renderGatheringGoalTrackRow: all-or-nothing deps', () => {
  it('appends nothing when no deps are supplied', () => {
    const item = document.createElement('div');
    renderGatheringGoalTrackRow(item, 'recipe_a', 'Widget', {});
    expect(item.querySelector('.crafting-goal-row')).toBeNull();
  });

  it('appends nothing when only some of the three deps are supplied', () => {
    const item = document.createElement('div');
    renderGatheringGoalTrackRow(item, 'recipe_a', 'Widget', { goalQty: () => 5 });
    expect(item.querySelector('.crafting-goal-row')).toBeNull();
  });

  it('appends the row when all three deps are supplied', () => {
    const item = document.createElement('div');
    renderGatheringGoalTrackRow(item, 'recipe_a', 'Widget', fullDeps());
    expect(item.querySelector('.crafting-goal-row')).not.toBeNull();
  });
});

describe('renderGatheringGoalTrackRow: qty stepper', () => {
  it('clamps the displayed quantity to 1..50', () => {
    const item = document.createElement('div');
    renderGatheringGoalTrackRow(item, 'recipe_a', 'Widget', fullDeps({ goalQty: () => 999 }));
    const value = item.querySelector('.crafting-qty-value');
    expect(value?.textContent).toBe('50');
  });

  it('decrementing calls onGoalQty with qty - 1, and never onTrackRecipe', () => {
    const onGoalQty = vi.fn();
    const onTrackRecipe = vi.fn();
    const item = document.createElement('div');
    renderGatheringGoalTrackRow(
      item,
      'recipe_a',
      'Widget',
      fullDeps({ goalQty: () => 12, onGoalQty, onTrackRecipe }),
    );
    const decBtn = item.querySelectorAll<HTMLButtonElement>('.crafting-qty-btn')[0];
    decBtn.click();
    expect(onGoalQty).toHaveBeenCalledTimes(1);
    expect(onGoalQty).toHaveBeenCalledWith('recipe_a', 11);
    expect(onTrackRecipe).not.toHaveBeenCalled();
  });

  it('incrementing calls onGoalQty with qty + 1', () => {
    const onGoalQty = vi.fn();
    const item = document.createElement('div');
    renderGatheringGoalTrackRow(
      item,
      'recipe_a',
      'Widget',
      fullDeps({ goalQty: () => 12, onGoalQty }),
    );
    const incBtn = item.querySelectorAll<HTMLButtonElement>('.crafting-qty-btn')[1];
    incBtn.click();
    expect(onGoalQty).toHaveBeenCalledTimes(1);
    expect(onGoalQty).toHaveBeenCalledWith('recipe_a', 13);
  });
});

describe('renderGatheringGoalTrackRow: Track fires exactly once, only on explicit click', () => {
  it('never calls onTrackRecipe merely by rendering', () => {
    const onTrackRecipe = vi.fn();
    const item = document.createElement('div');
    renderGatheringGoalTrackRow(item, 'recipe_a', 'Widget', fullDeps({ onTrackRecipe }));
    expect(onTrackRecipe).not.toHaveBeenCalled();
  });

  it('clicking Track calls onTrackRecipe once with the recipe id and current goal qty', () => {
    const onTrackRecipe = vi.fn();
    const item = document.createElement('div');
    renderGatheringGoalTrackRow(
      item,
      'recipe_a',
      'Widget',
      fullDeps({ goalQty: () => 12, onTrackRecipe }),
    );
    const trackBtn = item.querySelector<HTMLButtonElement>('.crafting-track-goal-btn');
    trackBtn?.click();
    expect(onTrackRecipe).toHaveBeenCalledTimes(1);
    expect(onTrackRecipe).toHaveBeenCalledWith('recipe_a', 12);
  });

  it('the Track button accessible name carries the result name and current goal quantity', () => {
    const item = document.createElement('div');
    renderGatheringGoalTrackRow(item, 'recipe_a', 'Widget', fullDeps({ goalQty: () => 12 }));
    const trackBtn = item.querySelector<HTMLButtonElement>('.crafting-track-goal-btn');
    expect(trackBtn?.getAttribute('aria-label')).toBe(
      'Track 12 crafts of Widget as your gathering goal',
    );
  });
});
