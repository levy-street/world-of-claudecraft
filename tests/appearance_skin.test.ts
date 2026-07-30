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
