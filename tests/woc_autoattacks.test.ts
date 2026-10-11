import fs from 'node:fs';
import { MeshoptDecoder } from 'meshoptimizer';
import { AnimationMixer, LoopOnce, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { newDualSwingState } from '../src/render/characters/attack_swing_core';
import { clipNamesOf } from '../src/render/characters/clip_names';
import { VISUALS } from '../src/render/characters/manifest';
import contacts from '../src/render/characters/woc_autoattack_contacts.json';
import {
  pickWocAutoAttack,
  WOC_AUTO_ATTACK_NAMES,
  wocAutoAttacksUrl,
} from '../src/render/characters/woc_autoattack_core';
import { wocEntryBodyUrls } from '../src/render/characters/woc_entry_core';

const args = () => ({
  def: VISUALS.player_warrior,
  abilityId: undefined as string | undefined,
  kind: undefined as 'melee' | 'wand' | undefined,
  style: null as 'twohand' | 'dualwield' | null,
  singleSetTwoHander: false,
  bowSkin: false,
  unarmed: false,
  index: 0,
  mixerTime: 0,
  dual: newDualSwingState(),
  has: (n: string) => WOC_AUTO_ATTACK_NAMES.includes(n as never),
});
it('selects autos independently of named abilities and wand shots', () => {
  const a = args();
  expect(pickWocAutoAttack(a)?.clip).toBe('WoW_Attack1H_0');
  expect(pickWocAutoAttack({ ...a, unarmed: true })?.clip).toBe('WoW_AttackUnarmed_0');
  expect(pickWocAutoAttack({ ...a, index: 1 })?.clip).toBe('WoW_Attack1H_1');
  expect(pickWocAutoAttack({ ...a, style: 'twohand' })?.clip).toBe('WoW_Attack2H_0');
  expect(pickWocAutoAttack({ ...a, style: 'twohand', singleSetTwoHander: true })?.clip).toBe(
    'WoW_Attack1H_0',
  );
  expect(pickWocAutoAttack({ ...a, abilityId: 'mortal_strike' })).toBeNull();
  expect(pickWocAutoAttack({ ...a, kind: 'wand' })).toBeNull();
  expect(pickWocAutoAttack({ ...a, has: () => false })).toBeNull();
  expect(pickWocAutoAttack({ ...a, def: VISUALS.player_mage })?.clip).toBe('WoW_Attack2H_0');
  expect(pickWocAutoAttack({ ...a, def: VISUALS.player_hunter })?.clip).toBe('WoW_AttackRifle_0');
  expect(pickWocAutoAttack({ ...a, def: VISUALS.player_hunter, bowSkin: true })?.clip).toBe(
    'WoW_AttackBow_0',
  );
  expect(pickWocAutoAttack({ ...a, def: VISUALS.player_hunter, kind: 'melee' })?.clip).toBe(
    'WoW_Attack1H_0',
  );
});
it('alternates hands, combines same-frame swings and keeps a third swing on the pair', () => {
  const a = { ...args(), style: 'dualwield' as const };
  expect(pickWocAutoAttack(a)?.clip).toBe('WoW_AutoDual#main');
  expect(pickWocAutoAttack({ ...a, mixerTime: 1 })?.clip).toBe('WoW_AutoDual#off');
  expect(pickWocAutoAttack({ ...a, mixerTime: 1 })?.clip).toBe('WoW_AutoDual');
  expect(pickWocAutoAttack({ ...a, mixerTime: 1 })).toEqual({
    clip: null,
    delay: contacts.male.WoW_AutoDual[1],
  });
  expect(pickWocAutoAttack({ ...a, mixerTime: 2 })?.clip).toBe('WoW_AutoDual#main');
});

it.each(['male', 'female'] as const)(
  'keeps %s queued contacts aligned when a lone offhand upgrades to a pair',
  (fit) => {
    const a = {
      ...args(),
      def: VISUALS[fit === 'male' ? 'player_warrior' : 'player_warrior_female'],
      style: 'dualwield' as const,
    };
    const main = pickWocAutoAttack(a)!;
    const off = pickWocAutoAttack({ ...a, mixerTime: 1 })!;
    const pair = pickWocAutoAttack({ ...a, mixerTime: 1 })!;
    expect(off.delay).toBe(main.delay);
    expect(pair.delay).toBe(main.delay);
    expect(contacts[fit].WoW_AutoDual).toEqual([main.delay, main.delay]);
  },
);

describe.each(['male', 'female'] as const)('%s shipped autoattacks', (fit) => {
  it('binds the sex-specific library before entry and animates the real sockets at measured contact', async () => {
    await MeshoptDecoder.ready;
    const defs = Object.values(VISUALS).filter((d) => d.wocCharacter?.fit === fit);
    for (const def of defs) {
      expect(def.animUrls).toContain(wocAutoAttacksUrl(fit));
      expect(clipNamesOf(def)).toEqual(expect.arrayContaining([...WOC_AUTO_ATTACK_NAMES]));
    }
    expect(wocEntryBodyUrls()).toContain(wocAutoAttacksUrl(fit));
    const bytes = fs.readFileSync(`public/${wocAutoAttacksUrl(fit)}`);
    const gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    expect(gltf.animations).toHaveLength(18);
    const mixer = new AnimationMixer(gltf.scene);
    for (const clip of gltf.animations) {
      expect(clip.validate(), clip.name).toBe(true);
      mixer.stopAllAction();
      const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      const sides =
        clip.name === 'WoW_AutoDual' ? ['r', 'l'] : [/Off|#off/.test(clip.name) ? 'l' : 'r'];
      const count = Math.round(clip.duration * 60);
      const fps = count / clip.duration;
      const positions: Vector3[][] = sides.map(() => []);
      const bone = gltf.scene.getObjectByName('handslotr')!;
      const bindPosition = bone.position.clone();
      const bindRotation = bone.quaternion.clone();
      for (let frame = 0; frame <= count; frame++) {
        mixer.setTime(frame / fps);
        gltf.scene.updateMatrixWorld(true);
        expect(bone.position.distanceTo(bindPosition)).toBeLessThan(1e-5);
        expect(bone.quaternion.angleTo(bindRotation)).toBeLessThan(1e-4);
        for (const [i, side] of sides.entries()) {
          const p = gltf.scene
            .getObjectByName(`handslot${side}`)!
            .localToWorld(new Vector3(0, 0.3, 0));
          expect(p.toArray().every(Number.isFinite)).toBe(true);
          positions[i].push(p);
        }
      }
      if (/Rifle|Bow|Thrown/.test(clip.name)) continue;
      for (const [i, tips] of positions.entries()) {
        let peak = -1,
          at = 0;
        for (let f = 1; f <= count; f++) {
          if (f / count < 0.15 || f / count > 0.7) continue;
          const speed = tips[f].distanceTo(tips[f - 1]);
          if (speed > peak) {
            peak = speed;
            at = (f - 0.5) / fps;
          }
        }
        expect(peak).toBeGreaterThan(0.001);
        expect(
          Math.abs(at - (contacts[fit] as Record<string, number[]>)[clip.name][i]),
          clip.name,
        ).toBeLessThan(1 / 60);
      }
    }
  });
});
