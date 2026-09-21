// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { renderCraftingWindow } from '../src/ui/hud/professions/crafting_window';
import { renderProfessionIdentityCard } from '../src/ui/hud/professions/profession_identity_card';
import { ProfessionsWindow } from '../src/ui/hud/professions/professions_window';
import { renderTrainWindow } from '../src/ui/hud/vendor/train_window';

// Fail at the dependency boundary, before a portrait loader can start network
// work that outlives the DOM environment. These painters need only labels.
vi.mock('../src/ui/char_window', () => {
  throw new Error('Profession labels must not import the character window');
});
vi.mock('three', () => {
  throw new Error('Profession painters must not initialize the 3D renderer');
});

describe('profession painter label import isolation', () => {
  it('loads all affected painters without the character window or renderer', () => {
    expect(renderProfessionIdentityCard).toBeTypeOf('function');
    expect(ProfessionsWindow).toBeTypeOf('function');
    expect(renderCraftingWindow).toBeTypeOf('function');
    expect(renderTrainWindow).toBeTypeOf('function');
  });
});
