import * as THREE from 'three';
import { expect, it } from 'vitest';
import { ActionProps } from '../src/render/characters/action_props';

it('borrows only required hands and restores them on recovery, interruption and equipment replacement', () => {
  const model = new THREE.Group(),
    main = new THREE.Group(),
    off = new THREE.Group(),
    blade = new THREE.Group();
  main.userData = { heldPropHolder: true, heldSlot: 0 };
  off.userData = { heldPropHolder: true, heldSlot: 1 };
  model.add(main, off, blade);
  const props = new ActionProps(model, blade);
  props.action('Signature_blind');
  expect(main.visible).toBe(true);
  expect(off.visible).toBe(false);
  props.action('Signature_garrote');
  expect(main.visible).toBe(false);
  expect(blade.visible).toBe(false);
  props.action('Death');
  expect(main.visible && off.visible).toBe(true);
  // Jawcrack strikes with the sword guard: neither held weapon disappears.
  props.action('Signature_pummel');
  expect(main.visible && off.visible).toBe(true);
  expect(blade.visible).toBe(false);
  props.action('Warrior_Jawcrack');
  expect(main.visible && off.visible).toBe(true);
  props.action('Signature_mongoose_bite');
  expect(main.visible).toBe(false);
  expect(blade.visible).toBe(true);
  const replacement = new THREE.Group();
  replacement.userData = main.userData;
  model.remove(main);
  model.add(replacement);
  props.refresh();
  expect(replacement.visible).toBe(false);
  props.action('Idle');
  expect(replacement.visible && off.visible).toBe(true);
  expect(blade.visible).toBe(false);
  off.visible = false;
  props.action('Signature_garrote');
  props.restore();
  expect(off.visible).toBe(false);
});
