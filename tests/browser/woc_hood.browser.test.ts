import type { Object3D } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import * as assets from '../../src/render/characters/assets';
import { VISUALS } from '../../src/render/characters/manifest';
import { CharacterVisual } from '../../src/render/characters/visual';
import * as dressing from '../../src/render/characters/woc_armor_dressing';
import { WOC_HEAD_TYPES, wocHeadTypeForGender } from '../../src/render/characters/woc_head_catalog';
import * as heads from '../../src/render/characters/woc_head_packs';
import { resolveWocPartNodes } from '../../src/render/characters/woc_parts';
import { landWocFiles } from '../helpers/woc_streamed';

function drawn(node: Object3D): boolean {
  for (let current: Object3D | null = node; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

describe('WOC headgear visibility on the shipped models', () => {
  beforeAll(async () => {
    await assets.charactersReady();
    await landWocFiles(assets, dressing, heads);
  }, 90_000);

  const keys = [
    'hunter',
    'rogue',
    'warlock',
    'mage',
    'priest',
    'warrior',
    'paladin',
    'druid',
    'shaman',
  ].flatMap((cls) => [`player_${cls}`, `player_${cls}_female`]);

  it.each(keys)('hides and restores headgear independently on %s', (key) => {
    const manifest = VISUALS[key].wocCharacter;
    if (!manifest) throw new Error(`Missing WOC manifest for ${key}`);
    const visual = new CharacterVisual(key, 0xffffff);
    try {
      // the default look, handed over the way the world view hands a new character its head:
      // its files are resident, so the head is live and the body draws
      visual.setWocHeadLook(null);
      const parts = resolveWocPartNodes(visual.root, manifest);
      const headId = manifest.defaultEquipment.head;
      const chestId = manifest.defaultEquipment.chest;
      if (!headId || !chestId) throw new Error(`Missing default equipment for ${key}`);
      const head = manifest.items[headId].nodes;
      // the hair a helm hides is the modular head's hairstyle (the base has no head)
      const type = wocHeadTypeForGender(manifest.fit);
      const hair = visual.root.getObjectByName(
        `WocHead_${type.toUpperCase()}_hair_${WOC_HEAD_TYPES[type].defaults.hair}`,
      );
      if (!hair) throw new Error(`${key}: the default hairstyle is not hung`);
      const expectHair = (visible: boolean) => expect(drawn(hair), `${key} hair`).toBe(visible);
      const chest = manifest.items[chestId].nodes;
      const expectParts = (names: readonly string[], visible: boolean) => {
        for (const name of names) {
          const nodes = parts.get(name);
          expect(nodes?.length, `${key}: ${name} resolved`).toBeGreaterThan(0);
          for (const node of nodes ?? []) expect(drawn(node), name).toBe(visible);
        }
      };
      // The item itself can belong to any set: WOC headgear comes from the
      // class kit, while the equipped slot and eye preference choose visibility.
      const equipped = { helmet: 'monarch_crown_helm', chest: 'footpad_jerkin' };
      for (const hidden of [false, true, false, true, false]) {
        visual.setWocEquipment(equipped, hidden);
        expectParts(head, !hidden);
        expectHair(hidden);
        expectParts(chest, true);
        expectParts(manifest.baseNodes, true);
      }
      visual.setWocEquipment({ chest: equipped.chest }, false);
      expectParts(head, false);
      expectHair(true);
      expectParts(chest, true);
      visual.setWocDefaultEquipment(false);
      expectParts(head, true);
      expectHair(false);
      visual.setWocDefaultEquipment(true);
      expectParts(head, false);
      expectHair(true);
    } finally {
      visual.dispose();
    }
  });
});
