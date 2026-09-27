import * as THREE from 'three';
import { expect, it } from 'vitest';
import { WarriorActionProps } from '../src/render/characters/warrior_action_props';

it('borrows only the throwing hand and restores original visibility at the next action', () => {
  const model = new THREE.Group();
  const main = new THREE.Group(),
    offhand = new THREE.Group();
  main.userData = { heldPropHolder: true, heldSlot: 0 };
  offhand.userData = { heldPropHolder: true, heldSlot: 1 };
  model.add(main, offhand);
  const props = new WarriorActionProps(model);
  props.action('Signature_storm_bolt');
  expect(main.visible).toBe(false);
  expect(offhand.visible).toBe(true);
  props.action('Signature_pummel');
  expect(main.visible).toBe(true);
  expect(offhand.visible).toBe(true);
  main.visible = false;
  props.action('Warrior_Storm_Bolt');
  props.restore();
  expect(main.visible).toBe(false);
});

it('applies the current borrowing rule to equipment attached during a throw', () => {
  const model = new THREE.Group();
  const props = new WarriorActionProps(model);
  props.action('Signature_storm_bolt');
  const replacement = new THREE.Group();
  replacement.userData = { heldPropHolder: true, heldSlot: 0 };
  model.add(replacement);
  props.refresh();
  expect(replacement.visible).toBe(false);
  props.action('Idle');
  expect(replacement.visible).toBe(true);
});
