import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { headOptions, SKINS, skinCount, VISUALS } from '../src/render/characters/manifest';
import { SKIN_COUNTS } from '../src/sim/content/skins';
import { Sim } from '../src/sim/sim';

const assetsSource = readFileSync(
  new URL('../src/render/characters/assets.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

const visualSource = readFileSync(
  new URL('../src/render/characters/visual.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

function glbNodeNames(url: string): Set<string> {
  const glb = readFileSync(new URL(`../public/${url.replace(/^\/+/, '')}`, import.meta.url));
  expect(glb.readUInt32LE(0), `${url} GLB magic`).toBe(0x46546c67);
  const jsonLength = glb.readUInt32LE(12);
  expect(glb.readUInt32LE(16), `${url} first chunk`).toBe(0x4e4f534a);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as {
    nodes?: { name?: string }[];
  };
  return new Set(json.nodes?.flatMap((node) => (node.name ? [node.name] : [])) ?? []);
}

describe('head cosmetics: sim carry', () => {
  it('setPlayerHead stores hairStyle + beard on the entity (offline appearance)', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', playerName: 'HeadTest' });
    // default: not set until chosen
    expect(sim.player.hairStyle).toBeUndefined();
    expect(sim.player.beard).toBeUndefined();

    expect(sim.setPlayerHead(sim.playerId, 1, false)).toBe(true);
    expect(sim.player.hairStyle).toBe(1);
    expect(sim.player.beard).toBe(false);

    expect(sim.setPlayerHead(sim.playerId, 0, true)).toBe(true);
    expect(sim.player.hairStyle).toBe(0);
    expect(sim.player.beard).toBe(true);
  });

  it('stores optional hair + face colour tints', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', playerName: 'HeadTest' });
    sim.setPlayerHead(sim.playerId, 0, true, 0x223344, 0xd8a878);
    expect(sim.player.hairColor).toBe(0x223344);
    expect(sim.player.faceColor).toBe(0xd8a878);
    // omitted colours clear back to the model default
    sim.setPlayerHead(sim.playerId, 0, true);
    expect(sim.player.hairColor).toBeUndefined();
    expect(sim.player.faceColor).toBeUndefined();
  });

  it('persists the chosen head into CharacterState and reloads it (offline + online path)', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', playerName: 'Aldric' });
    sim.setPlayerHead(sim.playerId, 3, true, 0x112233, 0x445566, 1);
    const state = sim.serializeCharacter(sim.playerId);
    expect(state).not.toBeNull();
    expect(state?.hairStyle).toBe(3);
    expect(state?.beard).toBe(true);
    expect(state?.face).toBe(1);
    expect(state?.hairColor).toBe(0x112233);
    expect(state?.faceColor).toBe(0x445566);

    // reload the saved state into a fresh Sim (the server join path)
    const sim2 = new Sim({ seed: 1, playerClass: 'warrior', playerName: 'x', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Aldric', { state: state ?? undefined });
    const e = sim2.entities.get(pid);
    expect(e?.hairStyle).toBe(3);
    expect(e?.beard).toBe(true);
    expect(e?.face).toBe(1);
    expect(e?.hairColor).toBe(0x112233);
    expect(e?.faceColor).toBe(0x445566);
  });

  it('a default (unpicked) head persists nothing so old saves load as the model default', () => {
    const sim = new Sim({ seed: 1, playerClass: 'mage', playerName: 'Plain' });
    const state = sim.serializeCharacter(sim.playerId);
    expect(state?.hairStyle).toBeUndefined();
    expect(state?.beard).toBeUndefined();
    expect(state?.face).toBeUndefined();
    expect(state?.hairColor).toBeUndefined();
    expect(state?.faceColor).toBeUndefined();
  });

  it('keeps an explicitly submitted default head sparse', () => {
    const sim = new Sim({ seed: 1, playerClass: 'mage', playerName: 'Plain' });
    sim.setPlayerHead(sim.playerId, 0, false, undefined, undefined, 0);
    const state = sim.serializeCharacter(sim.playerId);
    expect(state?.hairStyle).toBeUndefined();
    expect(state?.beard).toBeUndefined();
    expect(state?.face).toBeUndefined();
  });

  it('clamps hairStyle to a non-negative integer and rejects an unknown player', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', playerName: 'HeadTest' });
    sim.setPlayerHead(sim.playerId, -5, true);
    expect(sim.player.hairStyle).toBe(0);
    sim.setPlayerHead(sim.playerId, 2.9, true);
    expect(sim.player.hairStyle).toBe(2);
    expect(sim.setPlayerHead(999999, 1, true)).toBe(false);
  });

  it('is cosmetic-only: choosing a head look does not change the sim event stream', () => {
    const run = (setHead: boolean): string => {
      const sim = new Sim({ seed: 7, playerClass: 'warrior', playerName: 'Det' });
      if (setHead) sim.setPlayerHead(sim.playerId, 1, false);
      const events: string[] = [];
      for (let i = 0; i < 20 * 10; i++) {
        for (const e of sim.tick()) events.push(e.type);
      }
      return events.join(',');
    };
    expect(run(true)).toBe(run(false));
  });
});

describe('head cosmetics: manifest options', () => {
  it('exposes the shared male + female head options for every player class', () => {
    // the shared V02_HEAD_COSMETICS set is grafted onto every class body
    const expected = {
      faces: [
        { hairCount: 5, hasBeard: true, hasBald: true }, // male: 4 hairs + bald + beard
        { hairCount: 3, hasBeard: false, hasBald: false }, // female: 3 hairs, no bald/beard
      ],
      hasHairColor: true,
      hasFaceColor: true,
    };
    for (const cls of [
      'warrior',
      'paladin',
      'hunter',
      'rogue',
      'priest',
      'shaman',
      'mage',
      'warlock',
      'druid',
    ]) {
      expect(headOptions(`player_${cls}`), `${cls} head options`).toEqual(expected);
    }
    // a visual with no cosmetics descriptor offers no head options
    expect(headOptions('mob_wolf')).toBeNull();
  });

  it('shared head cosmetics: male face (4 hairs + bald + beard) and female face (3 hairs)', () => {
    const cos = VISUALS.player_warrior.cosmetics;
    expect(cos).toBeDefined();
    const [male, female] = cos?.faces ?? [];
    expect(male.face).toEqual(['Head', 'Head_Brow']);
    // Hair_04 leads: it is the male default look (index 0, the "1" chip); the
    // other styles follow and bald stays last.
    expect(male.hair).toEqual([
      ['Head_Male_Hair_04'],
      ['Head_Male_Hair_01'],
      ['Head_Male_Hair_02'],
      ['Head_Male_Hair_03'],
      [],
    ]);
    expect(male.hair[0]).toEqual(['Head_Male_Hair_04']); // default = variant 4
    expect(male.hair[male.hair.length - 1]).toEqual([]); // last = bald
    expect(male.beard).toEqual(['Head_Beard']);
    expect(female.face).toEqual(['Head_Female_Head']);
    expect(female.hair).toEqual([
      ['Head_Female_Hair_01'],
      ['Head_Female_Hair_02'],
      ['Head_Female_Hair_03'],
    ]);
    expect(female.beard).toBeUndefined(); // no beard for the female face
    expect(cos?.faceMeshes).toEqual(['Head', 'Head_Female_Head']);
  });

  it('a body chroma never targets a toggleable head mesh', () => {
    // skinMeshNames (chroma-recolored armor) must be disjoint from the cosmetic
    // hair/beard meshes, so a chroma swap can never remap a hidden head mesh.
    const def = VISUALS.player_warrior;
    const skinMeshes = new Set(def.skinMeshNames ?? []);
    const headMeshes = (def.cosmetics?.faces ?? []).flatMap((f) => [
      ...f.hair.flat(),
      ...(f.beard ?? []),
    ]);
    for (const name of headMeshes) expect(skinMeshes.has(name)).toBe(false);
    expect(def.skinMeshNames).toEqual(['Pants', 'Arms', 'Shoulders', 'Torso']);
  });

  it('every cosmetic mesh referenced by the manifest exists in every player GLB', () => {
    for (const cls of [
      'warrior',
      'paladin',
      'hunter',
      'rogue',
      'priest',
      'shaman',
      'mage',
      'warlock',
      'druid',
    ]) {
      const def = VISUALS[`player_${cls}`];
      const cosmetics = def.cosmetics;
      expect(cosmetics, cls).toBeDefined();
      const referenced = new Set([
        ...(cosmetics?.hairMeshes ?? []),
        ...(cosmetics?.faceMeshes ?? []),
        ...(cosmetics?.faces ?? []).flatMap((face) => [
          ...face.face,
          ...face.hair.flat(),
          ...(face.beard ?? []),
        ]),
      ]);
      const nodes = glbNodeNames(def.url);
      for (const name of referenced) {
        expect(nodes.has(name), `${cls} GLB is missing cosmetic node ${name}`).toBe(true);
      }
    }
  });
});

describe('warrior chromas', () => {
  it('fills the three non-default skin slots with body-atlas chromas (SKIN_COUNTS lockstep)', () => {
    const skins = SKINS.player_warrior;
    expect(skins).toHaveLength(4);
    expect(skins[0]).toBeNull(); // embedded default
    expect(skins[1]).toBe('textures/skins/warrior/crimson.webp');
    expect(skins[2]).toBe('textures/skins/warrior/azure.webp');
    expect(skins[3]).toBe('textures/skins/warrior/gold.webp');
    // the render skin count and the sim/server validator must agree
    expect(skinCount('player_warrior')).toBe(SKIN_COUNTS.warrior);
  });
});

describe('warrior shield attach', () => {
  it('flips + halves the shield via a per-attach grip modifier (not the shared grip)', () => {
    const shield = VISUALS.player_warrior.attach?.find((a) => a.url.includes('shield_round'));
    expect(shield).toBeDefined();
    expect(shield?.bone).toBe('handslot.l');
    expect(shield?.flipY).toBe(false);
    expect(shield?.scaleMul).toBe(0.5);
    // seats the shield ON the hand slot (cancels the family grip's +0.38 forward
    // lift) instead of floating it in front of the forearm
    expect(shield?.gripOffset).toEqual([0, -0.38, 0]);
    // source contract: applyHandGrip stacks the modifiers on the resolved family grip
    expect(assetsSource).toContain(
      'if (att.flipY) payload.quaternion.multiply(new THREE.Quaternion(0, 1, 0, 0));',
    );
    expect(assetsSource).toContain(
      'if (att.scaleMul !== undefined) payload.scale.multiplyScalar(att.scaleMul);',
    );
  });
});

describe('cosmetic tint revert (source contract)', () => {
  it('an undefined tint RESTORES the untinted base rather than no-oping', () => {
    // Regression: selecting the default (undefined) skin shade after a darker one
    // used to early-return, leaving the last tint stuck on until the head changed.
    expect(visualSource).not.toContain('if (!names || color === undefined) return;');
    expect(visualSource).toContain('if (!names) return;');
    // the pristine untinted material is stamped once and restored on revert
    expect(visualSource).toContain('mesh.userData.cosmeticBase = mesh.material;');
    expect(visualSource).toContain('mesh.material = cosmeticBase;');
    expect(visualSource).toContain('this.originalMaterials.set(mesh, cosmeticBase);');
  });

  it('a skin or weapon swap re-applies cosmetics so the hair/face tints survive', () => {
    // applyMaterials rebuilds every mesh from its embedded base, dropping the
    // cosmetic tints; both reset paths must re-stamp + re-tint. invalidateCosmeticBase
    // is defined once and CALLED from applySkinMaterials and setWeapons.
    const calls = visualSource.split('this.invalidateCosmeticBase();').length - 1;
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(visualSource).toContain('private invalidateCosmeticBase(): void {');
  });
});

describe('render targeting (source contract)', () => {
  it('the skin/chroma override is gated on a per-mesh skinnable flag, not all body meshes', () => {
    // assembleModel stamps skinnable from def.skinMeshNames; applyMaterials reads it
    expect(assetsSource).toContain(
      'o.userData.skinnable = !skinNames || skinNames.includes(o.name)',
    );
    // the skin atlas targets body meshes that are not explicitly non-skinnable
    // (bodyMesh excludes weapons; skinnable !== false drops the dual-atlas head)
    expect(assetsSource).toContain(
      'const skinTarget = mesh.userData.bodyMesh && mesh.userData.skinnable !== false;',
    );
    expect(assetsSource).toContain('const sk = skinTex && skinTarget ? skinTex : null;');
    expect(assetsSource).toContain('const em = emisTex && skinTarget ? emisTex : null;');
  });
});
