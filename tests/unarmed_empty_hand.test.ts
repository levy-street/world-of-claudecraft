// A player with nothing in the weapon slot holds nothing.
//
// A class body's weapon slot (VisualDef.weaponSlots) names a BASE model, the class's stock
// kit weapon. It used to draw whenever the slot had no item, so a character who unequipped
// their weapon still walked about with the stock sword, staff or dagger in hand (owner
// report). A body that follows real equipment (AssembleOptions.bareWhenUnarmed: the world's
// players, and the character previews) now leaves that hand empty, and leaves off the class's
// own hand props with it (the hunter's crossbow, the warlock's book): unarmed is both hands
// empty, for every class.
//
// The base stays for everything that equips nothing and is simply drawn on a class body: the
// Nythraxis court's visions are mobs on the knight, mage and rogue bodies, and the weapon in
// their hand is their look. It also stays as the stand-in for an equipped weapon whose id
// names no model (a client older than the item).
//
// Driven through the real attach path (assets.ts setWeaponsStowed -> attachAllProps, and the
// live swap setHeldWeapon) with only the loader stubbed.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '../src/sim/types';

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn((start: () => unknown) => start()),
}));

/** One box per model, named after its file, so a test can read what a hand holds. */
function stubScene(url: string): THREE.Group {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 1, 0.1),
    new THREE.MeshStandardMaterial({ map: new THREE.Texture() }),
  );
  mesh.name = url.slice(url.lastIndexOf('/') + 1).replace(/\.glb$/, '');
  scene.add(mesh);
  return scene;
}

function mockLoader(): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn((url: string) => Promise.resolve({ scene: stubScene(url), animations: [] })),
    loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    releaseGltf: vi.fn(),
  }));
}

async function loadAssets() {
  vi.resetModules();
  mockLoader();
  const assets = await import('../src/render/characters/assets');
  const { VISUALS } = await import('../src/render/characters/manifest');
  await assets.charactersReady();
  /** The three bones the attach path asks a rig for: both hand slots and the carry bone. */
  const rig = (): THREE.Group => {
    const root = new THREE.Group();
    for (const name of ['handslotl', 'handslotr', 'chest']) {
      const bone = new THREE.Object3D();
      bone.name = name;
      root.add(bone);
    }
    return root;
  };
  /** What a rig holds, one `bone:model` per mounted prop. */
  const held = (root: THREE.Object3D): string[] =>
    assets
      .heldPropHolders(root)
      .map((holder) => {
        let model = '';
        holder.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && !model) model = o.name;
        });
        return `${holder.parent?.name}:${model}`;
      })
      .sort();
  return { assets, VISUALS, rig, held };
}

afterEach(() => {
  vi.doUnmock('../src/render/assets/loader');
  vi.doUnmock('../src/render/characters/visual');
  vi.resetModules();
});

/** The hand that follows real equipment. */
const BARE = true;

describe('a body that follows real equipment', () => {
  it('holds nothing with no weapon equipped, drawn or sheathed', async () => {
    const { assets, VISUALS, rig, held } = await loadAssets();
    const def = VISUALS.player_warrior;
    for (const stowed of [false, true]) {
      const root = rig();
      // every prop the body draws: the assemble and the sheathe toggle both run this
      expect(assets.setWeaponsStowed(root, def, null, null, stowed, null, BARE)).toEqual([]);
      expect(held(root), stowed ? 'sheathed' : 'drawn').toEqual([]);
    }
  });

  it('drops the weapon from the hand when it is unequipped', async () => {
    const { assets, VISUALS, rig, held } = await loadAssets();
    const def = VISUALS.player_warrior;
    const root = rig();
    assets.setHeldWeapon(root, def, 'worn_sword', null, false, BARE);
    expect(held(root)).toEqual(['handslotr:sword_starter']);
    // the live swap an unequip takes
    expect(assets.setHeldWeapon(root, def, null, null, false, BARE)).toEqual([]);
    expect(held(root)).toEqual([]);
    // ...and back again
    assets.setHeldWeapon(root, def, 'worn_sword', null, false, BARE);
    expect(held(root)).toEqual(['handslotr:sword_starter']);
  });

  it('never draws the stock kit weapon of any class body', async () => {
    const { assets, VISUALS, rig, held } = await loadAssets();
    const slotted = Object.entries(VISUALS).filter(
      ([key, def]) => key.startsWith('player_') && (def.weaponSlots?.length ?? 0) > 0,
    );
    // every class but the hunter, male and female, and the Combat Mech
    expect(slotted.length).toBeGreaterThan(16);
    for (const [key, def] of slotted) {
      const root = rig();
      assets.setWeaponsStowed(root, def, null, null, false, null, BARE);
      const bases = (def.weaponSlots ?? []).map((slot) => def.attach?.[slot].url ?? '');
      for (const url of bases) {
        const model = url.slice(url.lastIndexOf('/') + 1).replace(/\.glb$/, '');
        expect(held(root), key).not.toContain(`handslotr:${model}`);
      }
      // nothing at all in the weapon hand
      expect(
        held(root).filter((prop) => prop.startsWith('handslotr:')),
        key,
      ).toEqual([]);
    }
  });

  it('still shows an equipped off hand beside the empty weapon hand', async () => {
    const { assets, VISUALS, rig, held } = await loadAssets();
    const warrior = rig();
    assets.setWeaponsStowed(
      warrior,
      VISUALS.player_warrior,
      null,
      null,
      false,
      'eastbrook_buckler',
      BARE,
    );
    expect(held(warrior)).toEqual(['handslotl:shield_starter']);
  });

  // Unarmed is both hands empty, for every class. The hunter's crossbow and the warlock's
  // book are the class's own props: no item replaces them, so no unequip used to reach them.
  it("leaves off the class's own hand props too while unarmed", async () => {
    const { assets, VISUALS, rig, held } = await loadAssets();
    for (const [key, weapon, armed] of [
      ['player_hunter', 'rusty_hatchet', ['handslotr:crossbow_starter']],
      [
        'player_warlock',
        'gnarled_staff',
        ['handslotl:spellbook_starter', 'handslotr:staff_starter'],
      ],
    ] as const) {
      const def = VISUALS[key];
      for (const stowed of [false, true]) {
        const root = rig();
        assets.setWeaponsStowed(root, def, null, null, stowed, null, BARE);
        expect(held(root), `${key} unarmed`).toEqual([]);
      }
      // with a weapon equipped they are back (the hunter's hand shows the crossbow, never
      // the equipped melee weapon)
      const root = rig();
      assets.setWeaponsStowed(root, def, weapon, null, false, null, BARE);
      expect(held(root), `${key} armed`).toEqual([...armed]);
      // the live swap re-attaches a hunter's crossbow, and takes it off again
      if (key === 'player_hunter') {
        expect(assets.setHeldWeapon(root, def, null, null, false, BARE)).toEqual([]);
        expect(held(root)).toEqual([]);
        assets.setHeldWeapon(root, def, weapon, null, false, BARE);
        expect(held(root)).toEqual([...armed]);
      }
    }
  });

  it('draws them whatever is equipped on a body that does not follow equipment', async () => {
    const { assets, VISUALS, rig, held } = await loadAssets();
    const hunter = rig();
    assets.setWeaponsStowed(hunter, VISUALS.player_hunter, null, null, false, null);
    expect(held(hunter)).toEqual(['handslotr:crossbow_starter']);
    const warlock = rig();
    assets.setWeaponsStowed(warlock, VISUALS.player_warlock, null, null, false, null);
    expect(held(warlock)).toEqual(['handslotl:spellbook_starter', 'handslotr:wand']);
  });

  it('keeps the stock weapon as the stand-in for an equipped weapon with no model', async () => {
    const { assets, VISUALS, rig, held } = await loadAssets();
    const root = rig();
    assets.setHeldWeapon(
      root,
      VISUALS.player_warrior,
      'a_weapon_this_client_never_heard_of',
      null,
      false,
      BARE,
    );
    expect(held(root)).toEqual(['handslotr:sword_1handed']);
  });
});

describe('a body that equips nothing', () => {
  // The Nythraxis phase-2 court: mobs drawn on the warrior, the mage and the rogue bodies.
  // A mob has no weapon slot item, ever, and the class weapon in its hand is its look.
  it('keeps the class weapon it is drawn with', async () => {
    const { assets, VISUALS, rig, held } = await loadAssets();
    for (const [key, weapon] of [
      ['player_warrior', 'sword_1handed'],
      ['player_mage', 'staff'],
      ['player_rogue', 'dagger'],
    ] as const) {
      const root = rig();
      assets.setWeaponsStowed(root, VISUALS[key], null, null, false, null);
      expect(held(root), key).toEqual([`handslotr:${weapon}`]);
      // the swap path too, should anything ever call it on such a body
      assets.setHeldWeapon(root, VISUALS[key], null, null, false);
      expect(held(root), key).toEqual([`handslotr:${weapon}`]);
    }
  });
});

describe('who follows real equipment in the world', () => {
  /** createCharacterVisual with the visual class swapped for a recorder of what it is built
   *  with. */
  async function factory() {
    vi.resetModules();
    mockLoader();
    const built: { key: string; opts: { bareWhenUnarmed?: boolean } | undefined }[] = [];
    vi.doMock('../src/render/characters/visual', () => ({
      setWeaponVfxViewportHeight: vi.fn(),
      CharacterVisual: class {
        constructor(key: string, ...rest: unknown[]) {
          built.push({ key, opts: rest[6] as { bareWhenUnarmed?: boolean } | undefined });
          // every dressing call the factory makes on a fresh body is a no-op here
          // biome-ignore lint/correctness/noConstructorReturn: a recorder standing in for the rig
          return new Proxy(this, {
            get: (target, prop) =>
              prop in target ? (target as Record<PropertyKey, unknown>)[prop] : () => undefined,
            set: () => true,
          });
        }
      },
    }));
    const { createCharacterVisual } = await import('../src/render/characters/index');
    return { createCharacterVisual, built };
  }

  const entity = (kind: Entity['kind'], templateId: string): Entity =>
    ({
      kind,
      id: 9,
      templateId,
      color: 0xffffff,
      skin: 0,
      mainhandItemId: null,
      offhandItemId: null,
      auras: [],
      modularAppearance: null,
    }) as unknown as Entity;

  it('a player does: an empty weapon slot is an empty hand', async () => {
    const { createCharacterVisual, built } = await factory();
    expect(createCharacterVisual(entity('player', 'warrior'))).not.toBeNull();
    expect(
      createCharacterVisual(entity('player', 'mage'), undefined, undefined, true),
    ).not.toBeNull();
    expect(built.map((b) => [b.key, b.opts?.bareWhenUnarmed])).toEqual([
      ['player_warrior', true],
      ['player_mage', true],
    ]);
  });

  it('a mob on a class body does not: it keeps the weapon it is drawn with', async () => {
    const { createCharacterVisual, built } = await factory();
    for (const id of ['vision_aldren_warrior', 'vision_malric_mage', 'vision_deathstalker_voss']) {
      expect(createCharacterVisual(entity('mob', id)), id).not.toBeNull();
    }
    expect(built.map((b) => [b.key, b.opts?.bareWhenUnarmed ?? false])).toEqual([
      ['player_warrior', false],
      ['player_mage', false],
      ['player_rogue', false],
    ]);
  });
});
