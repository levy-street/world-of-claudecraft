import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { applyMaterials } from '../src/render/characters/assets';
import type { VisualDef } from '../src/render/characters/manifest';
import { Sim } from '../src/sim/sim';
import type { IWorld } from '../src/world_api';

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(() => new Promise(() => undefined)),
  loadTexture: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn((start: () => unknown) => start()),
}));

const characterAssetsSource = readFileSync(
  new URL('../src/render/characters/assets.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

describe('appearance skin selection', () => {
  it('updates offline player skin through the world contract', () => {
    const sim = new Sim({ seed: 1, playerClass: 'druid', playerName: 'Skintest' });
    const world: IWorld = sim;

    world.changeSkin(3);

    expect(sim.player.skin).toBe(3);
    // persistence is a Sim-concrete concern, not part of the IWorld seam
    expect(sim.serializeCharacter(sim.playerId)?.skin).toBe(3);
  });

  it('sends the online skin change command and mirrors the local player immediately', () => {
    const sent: unknown[] = [];
    // Kept bespoke on purpose (issue #2088): a hand-picked field subset plus a
    // live `ws` mock. tests/helpers/bare_client.ts bareClient() is the default
    // for a new suite that just needs a bare ClientWorld.
    const client: ClientWorld = Object.create(ClientWorld.prototype);
    Object.assign(client, {
      connected: true,
      ws: { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) },
      playerId: 7,
      entities: new Map([[7, { id: 7, skin: 0 }]]),
    });
    (globalThis as any).WebSocket = { OPEN: 1 };

    client.changeSkin(2);

    expect(client.player.skin).toBe(2);
    expect(sent).toEqual([{ t: 'cmd', cmd: 'change_skin', skin: 2, catalog: 'class' }]);
  });

  it('re-resolves the active weapon skin when the BODY changes (offline)', () => {
    // The mech shows a hunter's equipped weapon and the class rig does not, so
    // the applicable skin types differ per body. Switching bodies has to
    // re-resolve, or the skin the new body would show stays dark until some
    // unrelated gear change happens to recompute it.
    const sim = new Sim({ seed: 1, playerClass: 'hunter', playerName: 'Mechhunter' });
    const pid = sim.primaryId;
    const e = sim.entities.get(pid);
    if (!e) throw new Error('no player entity');
    e.mainhandItemId = 'direfang_greatblade';

    // A sword skin is only applicable in the suit, so put it on first.
    sim.setPlayerSkin(pid, 0, 'mech');
    expect(sim.setWeaponSkin(pid, 'ice_fang_sword')).toBe(true);
    expect(e.weaponSkinId).toBe('ice_fang_sword');

    // Back to the hunter rig: that body cannot render a sword skin at all.
    sim.setPlayerSkin(pid, 0, 'class');
    expect(e.weaponSkinId).toBeNull();

    // ...and returning to the suit brings it back, still parked in the loadout.
    sim.setPlayerSkin(pid, 0, 'mech');
    expect(e.weaponSkinId).toBe('ice_fang_sword');
  });

  it('re-resolves the active weapon skin when the BODY changes (online mirror)', async () => {
    // Parity with the offline arm above: both IWorld implementations must swap
    // the displayed skin with the body, or the two hosts disagree about what a
    // mech hunter is holding until the next snapshot lands.
    const { bareClient } = await import('./helpers/bare_client');
    const client = bareClient(7, { playerClass: 'hunter' });
    Object.assign(client, {
      connected: true,
      ws: { readyState: 1, send: () => undefined },
    });
    (globalThis as any).WebSocket = { OPEN: 1 };
    const p = client.entities.get(7) ?? { id: 7 };
    Object.assign(p, {
      id: 7,
      templateId: 'hunter',
      mainhandItemId: 'direfang_greatblade',
      weaponSkinLoadout: { sword: 'ice_fang_sword' },
      skin: 0,
      skinCatalog: 'class',
    });
    client.entities.set(7, p as never);

    client.changeSkin(0, 'mech');
    expect((p as { weaponSkinId?: string | null }).weaponSkinId).toBe('ice_fang_sword');

    client.changeSkin(0, 'class');
    expect((p as { weaponSkinId?: string | null }).weaponSkinId).toBeNull();
  });

  it('re-resolves the active weapon skin when unequipping the mech chroma (online)', async () => {
    // The chroma unequip drops the wearer OFF the mech body, which is a body
    // change like any other: the offline Sim routes it through setPlayerSkin and
    // re-resolves, but ClientWorld writes skinCatalog directly and so kept a
    // sword skin the class rig cannot render until the next authoritative
    // snapshot corrected it. Reported by review on PR 2940.
    const { bareClient } = await import('./helpers/bare_client');
    const client = bareClient(7, { playerClass: 'hunter' });
    Object.assign(client, {
      connected: true,
      ws: { readyState: 1, send: () => undefined },
      accountCosmetics: { completedQuestIds: [], mechChromaIds: ['amber_crimson'] },
      inventory: [],
    });
    (globalThis as any).WebSocket = { OPEN: 1 };
    const { mechChromaSkinIndex } = await import('../src/sim/content/skins');
    const skin = mechChromaSkinIndex('amber_crimson');
    const p = client.entities.get(7) ?? { id: 7 };
    Object.assign(p, {
      id: 7,
      templateId: 'hunter',
      mainhandItemId: 'direfang_greatblade',
      weaponSkinLoadout: { sword: 'ice_fang_sword' },
      weaponSkinId: 'ice_fang_sword',
      skin,
      skinCatalog: 'mech',
    });
    client.entities.set(7, p as never);

    client.unequipMechChroma('amber_crimson');

    expect((p as { skinCatalog?: string }).skinCatalog).toBe('class');
    // The class rig cannot render a sword skin, so it must not stay resolved.
    expect((p as { weaponSkinId?: string | null }).weaponSkinId).toBeNull();
  });

  it('sends the online mech chroma unequip command and mirrors the returned item immediately', () => {
    const sent: unknown[] = [];
    const client: ClientWorld = Object.create(ClientWorld.prototype);
    Object.assign(client, {
      connected: true,
      ws: { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) },
      playerId: 7,
      entities: new Map([[7, { id: 7, skin: 0, skinCatalog: 'mech' }]]),
      accountCosmetics: { completedQuestIds: [], mechChromaIds: ['amber_crimson'] },
      inventory: [],
    });
    (globalThis as any).WebSocket = { OPEN: 1 };

    client.unequipMechChroma('amber_crimson');

    expect(client.accountCosmetics.mechChromaIds).toEqual([]);
    expect(client.player.skinCatalog).toBe('class');
    expect(client.inventory).toEqual([{ itemId: 'amber_crimson_armor_plate', count: 1 }]);
    expect(sent).toEqual([{ t: 'cmd', cmd: 'unequip_mech_chroma', chroma: 'amber_crimson' }]);
  });

  it('loads alternate skin atlases on low graphics so previews keep distinct colours', () => {
    expect(characterAssetsSource).toContain('These load on every tier so skin');
    expect(characterAssetsSource).toContain(
      'for (const url of bootSkinUrls) registerPreload(loadSkinTexInto(url, skinTexByUrl));',
    );
    expect(characterAssetsSource).toContain(
      'for (const url of SKINS.player_mech ?? []) if (url) jobs.push(loadSkinTexInto(url, skinTexByUrl));',
    );
    expect(characterAssetsSource).toContain('if (!GFX.standardMaterials) return skinsReady;');
    expect(characterAssetsSource).not.toContain('Standard tier only — low tier aliases');
    expect(characterAssetsSource).not.toContain(
      'if (GFX.standardMaterials) {\n  // Boot sweep skips lazyPreload keys',
    );
  });

  it('restores the embedded default texture after previewing an alternate skin', () => {
    const defaultTexture = new THREE.Texture();
    const alternateTexture = new THREE.Texture();
    const sourceMaterial = new THREE.MeshStandardMaterial({ map: defaultTexture });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), sourceMaterial);
    mesh.userData.bodyMesh = true;

    applyMaterials(mesh, {} as VisualDef, 0xffffff, alternateTexture);
    expect((mesh.material as THREE.MeshStandardMaterial).map).toBe(alternateTexture);

    applyMaterials(mesh, {} as VisualDef, 0xffffff, null);
    expect((mesh.material as THREE.MeshStandardMaterial).map).toBe(defaultTexture);
  });

  it('restores every embedded default texture on a multi-material mesh', () => {
    const defaultTextures = [new THREE.Texture(), new THREE.Texture()];
    const alternateTexture = new THREE.Texture();
    const sourceMaterials = defaultTextures.map((map) => new THREE.MeshStandardMaterial({ map }));
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), sourceMaterials);
    mesh.userData.bodyMesh = true;

    applyMaterials(mesh, {} as VisualDef, 0xffffff, alternateTexture);
    expect((mesh.material as THREE.MeshStandardMaterial[]).map((material) => material.map)).toEqual(
      [alternateTexture, alternateTexture],
    );

    applyMaterials(mesh, {} as VisualDef, 0xffffff, null);
    expect((mesh.material as THREE.MeshStandardMaterial[]).map((material) => material.map)).toEqual(
      defaultTextures,
    );
  });
});
