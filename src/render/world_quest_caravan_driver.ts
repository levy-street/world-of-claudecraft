import * as THREE from 'three';
import { EASTBROOK_FREIGHT_CARAVAN_MOB_ID, WORLD_QUEST_MOBS } from '../sim/content/world_quests';
import { worldQuestCaravanForMob } from '../sim/world_quest_caravans';
import { type AnimState, CharacterVisual } from './characters';
import { logAssetMissOnce } from './characters/asset_miss_log';

const SEATED: AnimState = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: true,
};

export interface CaravanDriverVisual {
  root: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

/** A passenger of the wagon, not a second gameplay entity. The existing
 * character lifecycle owns the passenger's materials, mixer and skeleton. */
export function buildCaravanDriver(
  templateId = EASTBROOK_FREIGHT_CARAVAN_MOB_ID,
): CaravanDriverVisual | null {
  const caravan = worldQuestCaravanForMob(templateId);
  if (!caravan?.story) return null;
  const willowfen = templateId === 'willowfen_remedy_caravan';
  const color =
    templateId === EASTBROOK_FREIGHT_CARAVAN_MOB_ID ? 0x9b794f : WORLD_QUEST_MOBS[templateId].color;
  let visual: CharacterVisual;
  try {
    visual = new CharacterVisual(
      willowfen ? 'npc_villager_robed' : 'npc_villager',
      color,
      0,
      null,
      null,
    );
  } catch (err) {
    logAssetMissOnce(`${templateId}-driver`, 'Caravan driver asset unavailable:', err);
    return null;
  }
  visual.root.name = `${templateId}-driver`;
  visual.root.userData.caravanSpeaker = caravan.story.speaker;
  visual.root.scale.setScalar(0.82);
  visual.setRidePose({ spread: 0.1, thigh: Math.PI / 2, knee: Math.PI / 2, hips: 0, lean: 0 });
  // Finish the sit-down before the instance enters the scene. Ride overrides
  // unfold the floor-sit clip into knees forward and feet hanging off the seat.
  // Stay below CharacterVisual's 0.3s mixer step cap: the 1s sit-down
  // plus its 0.25s handoff must finish even when reduced motion freezes updates.
  for (let i = 0; i < 6; i++) visual.update(0.25, SEATED, true);
  visual.root.updateMatrixWorld(true);
  const hips = visual.root.getObjectByName('hips');
  const anchor = hips?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  visual.root.position.set(-anchor.x, 1.28 - anchor.y, -0.1 - anchor.z);
  let disposed = false;
  return {
    root: visual.root,
    update(dt) {
      if (!disposed) visual.update(dt, SEATED, true);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      visual.root.removeFromParent();
      visual.dispose();
    },
  };
}
