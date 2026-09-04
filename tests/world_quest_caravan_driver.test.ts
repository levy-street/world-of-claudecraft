import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterVisual } from '../src/render/characters';
import { buildCaravanDriver } from '../src/render/world_quest_caravan_driver';
import { WORLD_QUEST_MOBS } from '../src/sim/content/world_quests';

vi.mock('../src/render/characters', () => ({ CharacterVisual: vi.fn() }));

describe('Eastbrook caravan driver', () => {
  const update = vi.fn();
  const dispose = vi.fn();
  const setRidePose = vi.fn();
  let root: THREE.Group;
  let hips: THREE.Bone;
  beforeEach(() => {
    vi.clearAllMocks();
    root = new THREE.Group();
    hips = new THREE.Bone();
    hips.name = 'hips';
    hips.position.set(0, 0.5, 0.1);
    root.add(hips);
    vi.mocked(CharacterVisual).mockImplementation(function (this: CharacterVisual) {
      Object.assign(this, { root, update, dispose, setRidePose });
      return this;
    });
  });

  it('seats the unarmed villager on the front of the wagon and follows its transform', () => {
    const driver = buildCaravanDriver();
    expect(driver).not.toBeNull();
    if (!driver) throw new Error('Expected caravan driver');
    expect(CharacterVisual).toHaveBeenCalledWith('npc_villager', 0x9b794f, 0, null, null);
    // CharacterVisual caps each mixer step at 0.3s. Finish the real rig's
    // 1s sit-down and 0.25s handoff before reduced motion can freeze it.
    expect(update).toHaveBeenCalledTimes(6);
    expect(update.mock.calls.every(([dt]) => dt > 0 && dt <= 0.3)).toBe(true);
    expect(update.mock.calls.reduce((total, [dt]) => total + dt, 0)).toBe(1.5);
    expect(setRidePose).toHaveBeenCalledWith({
      spread: 0.1,
      thigh: Math.PI / 2,
      knee: Math.PI / 2,
      hips: 0,
      lean: 0,
    });
    const seatedHips = hips.getWorldPosition(new THREE.Vector3());
    expect(seatedHips.x).toBeCloseTo(0);
    expect(seatedHips.y).toBeCloseTo(1.28);
    expect(seatedHips.z).toBeCloseTo(-0.1);
    const wagon = new THREE.Group();
    wagon.add(driver.root);
    wagon.position.set(8, 2, -10);
    wagon.rotation.y = Math.PI / 2;
    const position = hips.getWorldPosition(new THREE.Vector3());
    expect(position.x).toBeCloseTo(7.9);
    expect(position.y).toBeCloseTo(3.28);
    expect(position.z).toBeCloseTo(-10);
    update.mockClear();
    driver.update(0.1);
    expect(update).toHaveBeenCalledWith(
      0.1,
      expect.objectContaining({ sitting: true, moving: false }),
      true,
    );
  });

  it('detaches before releasing its owned character and ignores later updates/disposal', () => {
    const driver = buildCaravanDriver();
    if (!driver) throw new Error('Expected caravan driver');
    const wagon = new THREE.Group();
    wagon.add(driver.root);
    dispose.mockImplementation(() => expect(root.parent).toBeNull());
    update.mockClear();
    driver.dispose();
    driver.dispose();
    driver.update(0.1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['willowfen_remedy_caravan', 'npc_villager_robed', 'Mira'],
    ['frostveil_supply_caravan', 'npc_villager', 'Orin'],
  ])('builds %s with its own speaker and appearance', (templateId, visualKey, speaker) => {
    const driver = buildCaravanDriver(templateId);
    expect(driver?.root.userData.caravanSpeaker).toBe(speaker);
    expect(CharacterVisual).toHaveBeenCalledWith(
      visualKey,
      WORLD_QUEST_MOBS[templateId].color,
      0,
      null,
      null,
    );
    expect(driver?.root.name).toBe(`${templateId}-driver`);
    driver?.dispose();
  });

  it('does not build a driver for an unrelated mob', () => {
    expect(buildCaravanDriver('vale_bandit')).toBeNull();
    expect(CharacterVisual).not.toHaveBeenCalled();
  });

  it('keeps the caravan usable if a character asset is unavailable', () => {
    vi.mocked(CharacterVisual).mockImplementationOnce(() => {
      throw new Error('missing rig');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(buildCaravanDriver()).toBeNull();
    } finally {
      error.mockRestore();
    }
  });
});
