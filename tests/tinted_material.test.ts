import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  applyMaterials,
  recolorMesh,
  tintedFarMaterials,
  tintedMaterial,
} from '../src/render/characters/assets';
import type { VisualDef } from '../src/render/characters/manifest';
import { type ModularLook, normalizeAppearance } from '../src/render/characters/modular';
import { gfxInternalsForTest } from '../src/render/gfx';
import { createWeaponVfx, type WeaponVfxSpec } from '../src/render/weapon_vfx';

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(() => new Promise(() => undefined)),
  loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
  loadTexture: vi.fn(() => new Promise(() => undefined)),
}));

function luminance(hex: number): number {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn((start: () => unknown) => start()),
}));

describe('tinted character materials', () => {
  it('gives the far mesh its own clone objects, never the rig clone (the compileAsync currentProgram trap)', () => {
    // three's compileAsync waits on a material's currentProgram, the variant
    // its LAST draw or compile picked; a clone shared between the skinned rig
    // and the rigid far mesh flips that slot to the rig's variant one frame
    // later, and the far bake's gate settled before its own variant linked.
    const src = new THREE.MeshStandardMaterial({ name: 'mod_cloth' });
    const rigClaims = new Set<string>();
    const farClaims = new Set<string>();
    const rig = tintedMaterial(src, 0x336699, 0.5, null, null, 'body', rigClaims, 'rig', '');
    const rigAgain = tintedMaterial(src, 0x336699, 0.5, null, null, 'body', rigClaims, 'rig', '');
    const far = tintedMaterial(src, 0x336699, 0.5, null, null, 'body', farClaims, 'far', '');
    // same inputs: the rig clone is memoized, the far clone is a distinct object...
    expect(rigAgain).toBe(rig);
    expect(far).not.toBe(rig);
    // ...with the same tint (only the object identity, and so the polled slot, differs)
    expect((far as THREE.MeshStandardMaterial).color.getHex()).toBe(
      (rig as THREE.MeshStandardMaterial).color.getHex(),
    );
    // and separate leases
    expect(rigClaims.size).toBe(1);
    expect(farClaims.size).toBe(1);
    expect([...farClaims][0]).not.toBe([...rigClaims][0]);
    // tintedFarMaterials is the far mount
    const def = { tint: 'entity', tintStrength: 0.5 } as unknown as VisualDef;
    const [viaFar] = tintedFarMaterials(def, 0x336699, [src], [true], null, null, farClaims);
    expect(viaFar).toBe(far);
    expect(viaFar).not.toBe(rig);
  });

  it('derives a fully diffuse clone for a matte def without mutating the source', () => {
    const restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    try {
      // A glossy authored source, the Ignivar shape: metallic factor 1 plus
      // metallic-roughness response maps that would re-gloss a scalar-only fix.
      const mrTex = new THREE.Texture();
      const src = new THREE.MeshStandardMaterial({
        color: 0x996644,
        metalness: 1,
        roughness: 0.3,
        metalnessMap: mrTex,
        roughnessMap: mrTex,
      });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), src);
      const root = new THREE.Group();
      root.add(mesh);
      const def = { matte: true } as VisualDef;
      applyMaterials(root, def, 0xffffff);

      const matte = mesh.material as THREE.MeshStandardMaterial;
      expect(matte).not.toBe(src);
      expect(matte.metalness).toBe(0);
      expect(matte.roughness).toBe(1);
      expect(matte.metalnessMap).toBeNull();
      expect(matte.roughnessMap).toBeNull();
      // the source stays authored: other defs sharing the GLB keep their look
      expect(src.metalness).toBe(1);
      expect(src.roughness).toBe(0.3);
      expect(src.metalnessMap).toBe(mrTex);
      expect(src.roughnessMap).toBe(mrTex);

      // matte is part of the cache identity: the same source without the flag
      // is a DIFFERENT clone that keeps the clamped glossy band.
      const glossy = tintedMaterial(
        src,
        null,
        0,
        null,
        null,
        'body',
        null,
        'rig',
        '',
      ) as THREE.MeshStandardMaterial;
      expect(glossy).not.toBe(matte);
      expect(glossy.metalness).toBe(1);
      expect(glossy.roughness).toBeCloseTo(0.55, 5);
      expect(glossy.metalnessMap).toBe(mrTex);

      // and the far mount derives the same matte response for its own clone
      const [far] = tintedFarMaterials(def, 0xffffff, [src], [true]) as [
        THREE.MeshStandardMaterial,
      ];
      expect(far).not.toBe(matte);
      expect(far.metalness).toBe(0);
      expect(far.roughness).toBe(1);
      expect(far.metalnessMap).toBeNull();
    } finally {
      restoreGfx();
    }

    // Low tier: the Lambert rebuild has no metalness/roughness to zero, so
    // matte must be a clean no-op that still carries the map across.
    const restoreLow = gfxInternalsForTest.overrideSettings({ standardMaterials: false });
    try {
      const map = new THREE.Texture();
      const lowSrc = new THREE.MeshStandardMaterial({ color: 0x996644, map });
      const low = tintedMaterial(
        lowSrc,
        null,
        0,
        null,
        null,
        'body',
        null,
        'rig',
        '',
        0,
        undefined,
        true,
      );
      expect((low as THREE.MeshLambertMaterial).isMeshLambertMaterial).toBe(true);
      expect((low as THREE.MeshLambertMaterial).map).toBe(map);
    } finally {
      restoreLow();
    }
  });

  it('lifts a tinted body in its tinted colour, and an untinted one in white', () => {
    const restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    try {
      // The Bone Spike shape: a white-based authored atlas recoloured by a
      // strong tint and lifted by selfIllumination so it reads in a dark hall.
      const map = new THREE.Texture();
      const src = new THREE.MeshStandardMaterial({ color: 0xffffff, map });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), src);
      const root = new THREE.Group();
      root.add(mesh);
      applyMaterials(
        root,
        { tint: 0xff7a1a, tintStrength: 1, selfIllumination: 0.35 } as VisualDef,
        0xffffff,
      );
      const lit = mesh.material as THREE.MeshStandardMaterial;
      expect(lit).not.toBe(src);
      expect(lit.emissiveMap).toBe(map);
      expect(lit.emissiveIntensity).toBe(0.35);
      // The glow is the tinted albedo, not the atlas's own (white) colour:
      // otherwise the lift would wash the recolour back toward the texture.
      expect(lit.color.getHex()).toBe(0xff7a1a);
      expect(lit.emissive.getHex()).toBe(0xff7a1a);
      // The source stays untouched for other defs sharing the GLB.
      expect(src.color.getHex()).toBe(0xffffff);
      expect(src.emissiveMap).toBeNull();

      // An untinted self-illuminated def keeps the white, atlas-scaled lift.
      const plain = tintedMaterial(
        src,
        null,
        0,
        null,
        null,
        'body',
        null,
        'rig',
        '',
        0.2,
      ) as THREE.MeshStandardMaterial;
      expect(plain.emissiveMap).toBe(map);
      expect(plain.emissive.getHex()).toBe(0xffffff);
      expect(plain.emissiveIntensity).toBe(0.2);
    } finally {
      restoreGfx();
    }

    // Low tier: the recolour is the actionable part (a spike must read as
    // the thing to kill on every preset), so the Lambert rebuild carries the
    // same ember hue; only the emissive lift is standard-tier polish.
    const restoreLow = gfxInternalsForTest.overrideSettings({ standardMaterials: false });
    try {
      const map = new THREE.Texture();
      const src = new THREE.MeshStandardMaterial({ color: 0xffffff, map });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), src);
      const root = new THREE.Group();
      root.add(mesh);
      applyMaterials(
        root,
        { tint: 0xff7a1a, tintStrength: 1, selfIllumination: 0.35 } as VisualDef,
        0xffffff,
      );
      const low = mesh.material as unknown as THREE.MeshLambertMaterial;
      expect(low.isMeshLambertMaterial).toBe(true);
      expect(low.map).toBe(map);
      // Still unmistakably ember after the low-tier readability lift (a
      // small pull toward white): in sRGB terms red stays saturated, green
      // stays in the orange band, blue stays near zero.
      const hex = low.color.getHex();
      const red = (hex >> 16) & 0xff;
      const green = (hex >> 8) & 0xff;
      const blue = hex & 0xff;
      expect(red).toBe(0xff);
      expect(green).toBeGreaterThanOrEqual(0x7a);
      expect(green).toBeLessThanOrEqual(0x9a);
      expect(blue).toBeLessThanOrEqual(0x60);
      expect(src.color.getHex()).toBe(0xffffff);
    } finally {
      restoreLow();
    }
  });

  it('keeps an authored held model as shipped and still polishes every other weapon', () => {
    const restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    try {
      const derive = (authoredSurface: boolean): THREE.MeshStandardMaterial => {
        // The Varkhul Forgebreaker shape: an authored atlas, matte, no metal.
        const src = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.9,
          metalness: 0,
          map: new THREE.Texture(),
        });
        src.name = 'Material.001';
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), src);
        mesh.userData.weaponMesh = true;
        // the tag attachProp sets for an AUTHORED_HELD_MODELS prop
        if (authoredSurface) mesh.userData.authoredSurface = true;
        const root = new THREE.Group();
        root.add(mesh);
        applyMaterials(root, {} as VisualDef, 0xffffff);
        const out = mesh.material as THREE.MeshStandardMaterial;
        expect(out).not.toBe(src);
        return out;
      };

      // Untagged: the whole polish, exactly as before (cream lift, gloss
      // clamp, metalness floor, emissive floor). Every other held model,
      // KayKit or not, stays on this arm.
      const polished = derive(false);
      expect(polished.roughness).toBeCloseTo(0.55, 5);
      expect(polished.metalness).toBeCloseTo(0.12, 5);
      expect(polished.emissive.getHex()).not.toBe(0x000000);
      expect(polished.color.getHex()).not.toBe(0xffffff);

      // Tagged: the shipped response, untouched. The polish's emissive floor
      // and gloss are the grey film over a dark baked atlas.
      const authored = derive(true);
      expect(authored.roughness).toBeCloseTo(0.9, 5);
      expect(authored.metalness).toBe(0);
      expect(authored.emissive.getHex()).toBe(0x000000);
      expect(authored.color.getHex()).toBe(0xffffff);
      // and the two never share a cache entry
      expect(authored).not.toBe(polished);
    } finally {
      restoreGfx();
    }
  });

  it('scales the low-tier readability floor by the atlas only for an authoredAtlas def', () => {
    const restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: false });
    try {
      const derive = (def: VisualDef, tag: 'body' | 'authoredWeapon' | 'weapon') => {
        const atlas = new THREE.Texture();
        const src = new THREE.MeshStandardMaterial({ color: 0xffffff, map: atlas });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), src);
        if (tag !== 'body') mesh.userData.weaponMesh = true;
        if (tag === 'authoredWeapon') mesh.userData.authoredSurface = true;
        const root = new THREE.Group();
        root.add(mesh);
        applyMaterials(root, def, 0xffffff);
        const out = mesh.material as unknown as THREE.MeshLambertMaterial;
        expect(out.isMeshLambertMaterial).toBe(true);
        expect(out.map).toBe(atlas);
        return { out, atlas };
      };

      // An authored creature atlas: the floor rides the map, so a black texel
      // stays black instead of lifting to the same grey as every other one,
      // and the lift amount itself is unchanged (lifted colour x body factor).
      const creature = derive({ authoredAtlas: true } as VisualDef, 'body');
      expect(creature.out.emissiveMap).toBe(creature.atlas);
      const expected = creature.out.color.clone().multiplyScalar(0.045);
      expect(creature.out.emissive.r).toBeCloseTo(expected.r, 6);
      expect(creature.out.emissive.g).toBeCloseTo(expected.g, 6);
      expect(creature.out.emissive.b).toBeCloseTo(expected.b, 6);

      // A player body or any other rig: the uniform floor it always had.
      const player = derive({} as VisualDef, 'body');
      expect(player.out.emissiveMap).toBeNull();
      expect(player.out.emissive.getHex()).not.toBe(0x000000);

      // Held props follow their own tag, never the body def.
      const drop = derive({} as VisualDef, 'authoredWeapon');
      expect(drop.out.emissiveMap).toBe(drop.atlas);
      const dropExpected = drop.out.color.clone().multiplyScalar(0.075);
      expect(drop.out.emissive.r).toBeCloseTo(dropExpected.r, 6);
      const kitWeapon = derive({ authoredAtlas: true } as VisualDef, 'weapon');
      expect(kitWeapon.out.emissiveMap).toBeNull();
    } finally {
      restoreGfx();
    }
  });

  it('partitions the cache so a flagged def never hands its clone to a player form on the same GLB', () => {
    // mob_wolf (authoredAtlas) and the druid form_cat share wolf_basic.glb, so
    // both reach tintedMaterial with the SAME source material. The flag must
    // partition the cache key: the flagged clone carries the atlas-scaled
    // floor, the form keeps the uniform one, and neither borrows the other.
    const restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: false });
    try {
      const atlas = new THREE.Texture();
      const shared = new THREE.MeshStandardMaterial({ color: 0xffffff, map: atlas });
      const derive = (def: VisualDef) => {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), shared);
        const root = new THREE.Group();
        root.add(mesh);
        applyMaterials(root, def, 0xffffff);
        return mesh.material as unknown as THREE.MeshLambertMaterial;
      };
      const wolf = derive({ authoredAtlas: true } as VisualDef);
      const form = derive({} as VisualDef);
      const wolfAgain = derive({ authoredAtlas: true } as VisualDef);
      expect(wolf).not.toBe(form);
      expect(wolfAgain).toBe(wolf); // same inputs still share one clone
      expect(wolf.emissiveMap).toBe(atlas);
      expect(form.emissiveMap).toBeNull();
      expect(form.emissive.getHex()).not.toBe(0x000000);
    } finally {
      restoreGfx();
    }
  });

  it('returns a colorless shader material as-is and continues the material traversal', () => {
    const restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    try {
      const shader = new THREE.ShaderMaterial();
      expect((shader as THREE.ShaderMaterial & { color?: THREE.Color }).color).toBeUndefined();
      const colored = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const shaderMesh = new THREE.Mesh(new THREE.BufferGeometry(), shader);
      const coloredMesh = new THREE.Mesh(new THREE.BufferGeometry(), colored);
      const root = new THREE.Group();
      root.add(shaderMesh, coloredMesh);

      // tintStrength is pinned in the def so the 0.4 handed to tintedMaterial
      // below is coupled locally, not to DEFAULT_TINT_STRENGTH in assets.ts.
      const def = { tint: 0x336699, tintStrength: 0.4 } as VisualDef;
      expect(() => applyMaterials(root, def, 0xffffff)).not.toThrow();

      // The colorless source comes back unchanged: no clone (a clone detaches
      // live uniform handles) and no cache entry (repeat calls keep returning
      // the source itself, never a stored copy).
      expect(shaderMesh.material).toBe(shader);
      expect(tintedMaterial(shader, 0x336699, 0.4, null, null, 'body', null, 'rig', '')).toBe(
        shader,
      );
      expect(tintedMaterial(shader, 0x336699, 0.4, null, null, 'body', null, 'rig', '')).toBe(
        shader,
      );
      // The colored sibling still takes the shared tinted clone.
      expect(coloredMesh.material).not.toBe(colored);
      expect((coloredMesh.material as THREE.MeshStandardMaterial).color.getHex()).not.toBe(
        0xffffff,
      );
    } finally {
      restoreGfx();
    }
  });

  it('leaves a weapon-skin fresnel shell material untouched through a full pass', () => {
    const restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    try {
      const weapon = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 1, 0.1),
        new THREE.MeshStandardMaterial({ color: 0xffffff }),
      );
      weapon.userData.weaponMesh = true;
      const root = new THREE.Group();
      root.add(weapon);
      const spec: WeaponVfxSpec = {
        tier: 'epic',
        name: 'test blade',
        type: 'sword',
        lore: '',
        fx: [],
      };
      const handle = createWeaponVfx(weapon, spec, { grounded: false });
      const shell = weapon.children.find((o) => o.userData.__vfx) as THREE.Mesh;
      expect(shell).toBeTruthy();
      expect(shell.userData.weaponVfxMesh).toBe(true);
      const shellMat = shell.material as THREE.ShaderMaterial;

      applyMaterials(root, { tint: 0x336699, tintStrength: 0.4 } as VisualDef, 0xffffff);

      // The sweep must not re-own the shell: the rig's per-frame uniform
      // writes go to this exact material instance, and a clone would render
      // frozen while the original absorbs every uTime/uStr write.
      expect(shell.material).toBe(shellMat);
      handle.update(0.25);
      expect(shellMat.uniforms.uTime.value).toBe(0.25);
      handle.dispose();
    } finally {
      restoreGfx();
    }
  });

  it('keeps a tagged fresnel shell out of the shadow-caster rebuild after an offhand swap', async () => {
    // Full-construction pin on the real rebuildCasters sweep (visual.ts): the
    // shell is a frustumCulled=false duplicate at 1.015 scale, so joining the
    // caster list after a weapon-graph change would put it in the shadow pass.
    // Mocked loader serves a minimal rig for every URL (the halo suite's
    // pattern), so the warrior def resolves without assets.
    vi.resetModules();
    const stubGltf = () => {
      const scene = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
      mesh.name = 'body';
      scene.add(mesh);
      return { scene, animations: [new THREE.AnimationClip('Idle', 1, [])] };
    };
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
      loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      releaseGltf: vi.fn(),
    }));
    try {
      const { charactersReady } = await import('../src/render/characters/assets');
      await charactersReady();
      const { CharacterVisual } = await import('../src/render/characters/visual');
      // player_warrior: the offhandSlot def, so setOffhand takes the lean path
      // that ends in rebuildCasters (visual.ts setOffhand).
      const visual = new CharacterVisual('player_warrior', 0xffffff, 0);
      const body = visual.root.getObjectByName('body') as THREE.Mesh;
      expect(body).toBeDefined();

      // A held-weapon host inside the model graph, carrying a real VFX rig:
      // makeShell parents the shell to the host mesh itself.
      const host = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 1, 0.1),
        new THREE.MeshStandardMaterial({ color: 0xffffff }),
      );
      host.name = 'held_test_weapon';
      host.userData.weaponMesh = true;
      body.add(host);
      const spec: WeaponVfxSpec = {
        tier: 'epic',
        name: 'test blade',
        type: 'sword',
        lore: '',
        fx: [],
      };
      const handle = createWeaponVfx(host, spec, { grounded: false });
      const shell = host.children.find((o) => o.userData.__vfx) as THREE.Mesh;
      expect(shell.userData.weaponVfxMesh).toBe(true);
      expect(shell.castShadow).toBe(false);

      // The offhand swap re-lists the casters over the whole model graph.
      visual.setOffhand('shield_round');
      const casters = (visual as unknown as { casters: THREE.Mesh[] }).casters;
      expect(casters).toContain(body);
      expect(casters).toContain(host);
      expect(casters).not.toContain(shell);
      // shadowOn defaults true, so the sweep turned the host on while the
      // tagged shell stayed out of the shadow pass.
      expect(host.castShadow).toBe(true);
      expect(shell.castShadow).toBe(false);

      handle.dispose();
      visual.dispose();
    } finally {
      vi.doUnmock('../src/render/assets/loader');
      vi.resetModules();
    }
  });

  it('falls back to a flat colour so an outfit colorway still shows on low graphics', () => {
    // Low tier rebuilds every rig material as Lambert from scratch, which has
    // no onBeforeCompile and so never runs the armour dye shader (see
    // recolored's armorDyeFallbackHex comment in assets.ts): without the
    // fallback this mesh would stay whatever colour the atlas ships, whichever
    // colorway the player picked. Compares two colorways against the classic
    // (undyed) baseline rather than pinning an exact hex, so the readability
    // lift buildTintedClone always applies on low tier (a separate, unrelated
    // accessibility pass) cannot make this test brittle.
    const restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: false });
    try {
      const lowTierColor = (outfit: 'classic' | 'obsidian' | 'crimson'): number => {
        const src = new THREE.MeshStandardMaterial({ color: 0xffffff });
        src.name = 'mage';
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), src);
        mesh.name = 'Armor_mage_Chest';
        const root = new THREE.Group();
        root.add(mesh);
        const look: ModularLook = { app: normalizeAppearance({ outfit }), worn: {} };
        recolorMesh(mesh, look);
        applyMaterials(root, {} as VisualDef, 0xffffff);
        const finalMat = mesh.material as unknown as THREE.MeshLambertMaterial;
        expect(finalMat.isMeshLambertMaterial).toBe(true);
        return finalMat.color.getHex();
      };
      const classic = lowTierColor('classic');
      const obsidian = lowTierColor('obsidian');
      const crimson = lowTierColor('crimson');
      // classic never carries a dye (outfitDye returns null for it), so it
      // stays the atlas's own white multiplier; a real colorway must differ
      // from that AND from every other colorway.
      expect(obsidian).not.toBe(classic);
      expect(crimson).not.toBe(classic);
      expect(obsidian).not.toBe(crimson);
      // outfitDyeFallbackHex value-normalizes before it lands here (see its
      // own comment): a naive multiply of the swatch chip's own half-bright
      // hex would crush the whole armour toward black, which is nearly as
      // invisible as the bug this fix exists to solve.
      expect(luminance(obsidian)).toBeGreaterThan(0.4);
      expect(luminance(crimson)).toBeGreaterThan(0.4);
    } finally {
      restoreGfx();
    }
  });

  it('never touches a non-armour material: skin/hair keep their own colour path on low graphics', () => {
    const restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: false });
    try {
      const src = new THREE.MeshStandardMaterial({ color: 0xffffff });
      src.name = 'mod_skin';
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), src);
      mesh.name = 'Head';
      const root = new THREE.Group();
      root.add(mesh);
      // An outfit colorway is active, but this mesh is skin, not armour:
      // outfitDye (and so armorDyeFallbackHex) must never apply to it. Skin's
      // own hex path is pre-existing behaviour (recolored's `hex !== null`
      // arm), not this fix; the decisive check here is that the fallback
      // metadata never leaks onto a mesh outfitDye was never meant to touch.
      const look: ModularLook = { app: normalizeAppearance({ outfit: 'obsidian' }), worn: {} };
      recolorMesh(mesh, look);
      expect((mesh.material as THREE.Material).userData.armorDyeFallbackHex).toBeUndefined();
      applyMaterials(root, {} as VisualDef, 0xffffff);
      const finalMat = mesh.material as unknown as THREE.MeshLambertMaterial;
      expect(finalMat.isMeshLambertMaterial).toBe(true);
      expect(finalMat.color.getHex()).not.toBe(0xffffff);
    } finally {
      restoreGfx();
    }
  });

  it('leaves the standard-tier dyed material color untouched (the shader carries the dye, not .color)', () => {
    const restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    try {
      const src = new THREE.MeshStandardMaterial({ color: 0xffffff });
      src.name = 'mage';
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), src);
      mesh.name = 'Armor_mage_Chest';
      const root = new THREE.Group();
      root.add(mesh);
      const look: ModularLook = { app: normalizeAppearance({ outfit: 'obsidian' }), worn: {} };
      recolorMesh(mesh, look);
      applyMaterials(root, {} as VisualDef, 0xffffff);
      const finalMat = mesh.material as THREE.MeshStandardMaterial;
      expect(finalMat.isMeshStandardMaterial).toBe(true);
      expect(finalMat.color.getHex()).toBe(0xffffff);
      expect(finalMat.userData.armorDye).toBeTruthy();
    } finally {
      restoreGfx();
    }
  });
});
