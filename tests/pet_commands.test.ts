// The shared pet-bar command routing (src/game/pet_commands.ts): the keyboard
// onPet arm and the controller dispatch both go through it.
import { describe, expect, it, vi } from 'vitest';
import { dispatchPetAction, runPetCommand } from '../src/game/pet_commands';

function fakeWorld() {
  return { petAttack: vi.fn(), petTaunt: vi.fn(), setPetMode: vi.fn() };
}

describe('runPetCommand', () => {
  it('maps each command to its exact IWorld call', () => {
    const w = fakeWorld();
    runPetCommand(w, 'attack');
    expect(w.petAttack).toHaveBeenCalledTimes(1);
    runPetCommand(w, 'taunt');
    expect(w.petTaunt).toHaveBeenCalledTimes(1);
    runPetCommand(w, 'stop');
    expect(w.setPetMode).toHaveBeenLastCalledWith('passive');
    runPetCommand(w, 'defensive');
    expect(w.setPetMode).toHaveBeenLastCalledWith('defensive');
    runPetCommand(w, 'aggressive');
    expect(w.setPetMode).toHaveBeenLastCalledWith('aggressive');
    expect(w.setPetMode).toHaveBeenCalledTimes(3);
  });
});

describe('dispatchPetAction', () => {
  it('routes the five pet binds and no other action', () => {
    const w = fakeWorld();
    expect(dispatchPetAction('petAttack', w)).toBe(true);
    expect(w.petAttack).toHaveBeenCalledTimes(1);
    expect(dispatchPetAction('petTaunt', w)).toBe(true);
    expect(w.petTaunt).toHaveBeenCalledTimes(1);
    expect(dispatchPetAction('petStop', w)).toBe(true);
    expect(w.setPetMode).toHaveBeenLastCalledWith('passive');
    expect(dispatchPetAction('petDefensive', w)).toBe(true);
    expect(w.setPetMode).toHaveBeenLastCalledWith('defensive');
    expect(dispatchPetAction('petAggressive', w)).toBe(true);
    expect(w.setPetMode).toHaveBeenLastCalledWith('aggressive');
    // Not a pet bind: nothing runs and the caller keeps dispatching.
    expect(dispatchPetAction('targetPet', w)).toBe(false);
    expect(dispatchPetAction('toString', w)).toBe(false);
    expect(w.petAttack).toHaveBeenCalledTimes(1);
    expect(w.petTaunt).toHaveBeenCalledTimes(1);
    expect(w.setPetMode).toHaveBeenCalledTimes(3);
  });
});
