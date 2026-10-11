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
} from '../src/render/characters/woc_autoattack_core';
import { wocEntryBodyUrls } from '../src/render/characters/woc_entry_core';
import { wocKeyedAnimsUrl } from '../src/render/characters/woc_keyed_animations';

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
  expect(pickWocAutoAttack(a)?.clip).toBe('Woc_Attack_1H_0');
  expect(pickWocAutoAttack({ ...a, unarmed: true })?.clip).toBe('Woc_Attack_Unarmed_0');
  expect(pickWocAutoAttack({ ...a, unarmed: true, index: 1 })?.clip).toBe('Woc_Attack_Unarmed_1');
  expect(pickWocAutoAttack({ ...a, index: 1 })?.clip).toBe('Woc_Attack_1H_1');
  expect(pickWocAutoAttack({ ...a, style: 'twohand' })?.clip).toBe('Woc_Attack_2H_0');
  expect(pickWocAutoAttack({ ...a, style: 'twohand', singleSetTwoHander: true })?.clip).toBe(
    'Woc_Attack_1H_0',
  );
  expect(pickWocAutoAttack({ ...a, abilityId: 'mortal_strike' })).toBeNull();
  expect(pickWocAutoAttack({ ...a, kind: 'wand' })).toBeNull();
  expect(pickWocAutoAttack({ ...a, has: () => false })).toBeNull();
  expect(pickWocAutoAttack({ ...a, def: VISUALS.player_mage })?.clip).toBe('Woc_Attack_2H_0');
  expect(pickWocAutoAttack({ ...a, def: VISUALS.player_hunter })?.clip).toBe('Woc_Attack_Rifle');
  expect(pickWocAutoAttack({ ...a, def: VISUALS.player_hunter, bowSkin: true })?.clip).toBe(
    'Woc_Attack_Bow',
  );
  expect(pickWocAutoAttack({ ...a, def: VISUALS.player_hunter, kind: 'melee' })?.clip).toBe(
    'Woc_Attack_1H_0',
  );
  // A body that is not a WOC character keeps its own attack path.
  expect(pickWocAutoAttack({ ...a, def: { ...a.def, wocCharacter: undefined } })).toBeNull();
});

it('alternates hands, combines same-frame swings and keeps a third swing on the pair', () => {
  const a = { ...args(), style: 'dualwield' as const };
  expect(pickWocAutoAttack(a)?.clip).toBe('Woc_Attack_Dual#main');
  expect(pickWocAutoAttack({ ...a, mixerTime: 1 })?.clip).toBe('Woc_Attack_Dual#off');
  expect(pickWocAutoAttack({ ...a, mixerTime: 1 })?.clip).toBe('Woc_Attack_Dual');
  expect(pickWocAutoAttack({ ...a, mixerTime: 1 })).toEqual({
    clip: null,
    delay: contacts.male.Woc_Attack_Dual[1] / (VISUALS.player_warrior.attackTimeScale ?? 1.3),
  });
  expect(pickWocAutoAttack({ ...a, mixerTime: 2 })?.clip).toBe('Woc_Attack_Dual#main');
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
    expect(main.delay).toBeGreaterThan(0);
    expect(off.delay).toBe(main.delay);
    expect(pair.delay).toBe(main.delay);
    const [r, l] = contacts[fit].Woc_Attack_Dual;
    expect(l).toBe(r);
  },
);

// The hand the swing's contact is measured on (the right unless listed).
const SIDES: Record<string, readonly ('r' | 'l')[]> = {
  Woc_Attack_Dual: ['r', 'l'],
  'Woc_Attack_Dual#off': ['l'],
  Woc_Attack_Unarmed_1: ['l'],
};

describe.each(['male', 'female'] as const)('%s shipped hand-keyed library', (fit) => {
  it('ships exactly the clips the bodies bind, loads before entry and lands at the measured contacts', async () => {
    await MeshoptDecoder.ready;
    const defs = Object.values(VISUALS).filter((d) => d.wocCharacter?.fit === fit);
    expect(defs.length).toBeGreaterThan(0);
    const bound = new Set<string>();
    for (const def of defs) {
      expect(def.animUrls).toContain(wocKeyedAnimsUrl(fit));
      expect(clipNamesOf(def)).toEqual(expect.arrayContaining([...WOC_AUTO_ATTACK_NAMES]));
      for (const name of clipNamesOf(def)) if (name.startsWith('Woc_')) bound.add(name);
    }
    expect(wocEntryBodyUrls()).toContain(wocKeyedAnimsUrl(fit));
    const bytes = fs.readFileSync(`public/${wocKeyedAnimsUrl(fit)}`);
    const gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    // Every keyed clip a body binds ships, and nothing it never plays rides along.
    expect(gltf.animations.map((c) => c.name).sort()).toEqual([...bound].sort());
    const table = contacts[fit] as Record<string, number[]>;
    const melee = WOC_AUTO_ATTACK_NAMES.filter((n) => !/Rifle|Bow/.test(n));
    expect(Object.keys(table).sort()).toEqual([...melee].sort());
    const mixer = new AnimationMixer(gltf.scene);
    for (const clip of gltf.animations) {
      expect(clip.validate(), clip.name).toBe(true);
      mixer.stopAllAction();
      const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      const sides = SIDES[clip.name] ?? ['r'];
      const count = Math.round(clip.duration * 60);
      const fps = count / clip.duration;
      const positions: Vector3[][] = sides.map(() => []);
      // The weapon sockets ride their hands and are never animated themselves.
      const sockets = (['r', 'l'] as const).map((side) => {
        const bone = gltf.scene.getObjectByName(`handslot${side}`)!;
        return { bone, position: bone.position.clone(), rotation: bone.quaternion.clone() };
      });
      for (let frame = 0; frame <= count; frame++) {
        mixer.setTime(frame / fps);
        gltf.scene.updateMatrixWorld(true);
        for (const s of sockets) {
          expect(s.bone.position.distanceTo(s.position)).toBeLessThan(1e-5);
          expect(s.bone.quaternion.angleTo(s.rotation)).toBeLessThan(1e-4);
        }
        for (const [i, side] of sides.entries()) {
          const p = gltf.scene
            .getObjectByName(`handslot${side}`)!
            .localToWorld(new Vector3(0, 0.3, 0));
          expect(p.toArray().every(Number.isFinite)).toBe(true);
          positions[i].push(p);
        }
      }
      if (!melee.includes(clip.name as never)) continue;
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
        expect(Math.abs(at - table[clip.name][i]), clip.name).toBeLessThan(1 / 60);
      }
    }
  });
});
