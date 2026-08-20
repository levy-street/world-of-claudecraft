import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  buildIgnivarForgeChainVisual,
  disposeIgnivarForgeChainVisual,
  IGNIVAR_FORGE_CHAIN_VISUAL_NAME,
  syncIgnivarForgeChainVisual,
} from '../src/render/ignivar_forge_chains';
import { IGNIVAR_FORGE_CHAINS_AURA_ID } from '../src/sim/ignivar_forge_chains';

function linkedPlayers() {
  const first = {
    id: 10,
    kind: 'player',
    auras: [{ id: IGNIVAR_FORGE_CHAINS_AURA_ID, value2: 20 }],
  };
  const second = {
    id: 20,
    kind: 'player',
    auras: [{ id: IGNIVAR_FORGE_CHAINS_AURA_ID, value2: 10 }],
  };
  const firstGroup = new THREE.Group();
  firstGroup.position.set(40, 2, 60);
  const secondGroup = new THREE.Group();
  secondGroup.position.set(46, 2, 68);
  return {
    first,
    second,
    firstGroup,
    secondGroup,
    views: new Map([
      [first.id, { group: firstGroup }],
      [second.id, { group: secondGroup }],
    ]),
  };
}

describe('Ignivar Forge Chains rendering', () => {
  it('builds a fiery interlocking chain between the rendered pair', () => {
    const { first, firstGroup: owner, views } = linkedPlayers();

    syncIgnivarForgeChainVisual(owner, first, views, 0.25);

    const chain = owner.getObjectByName(IGNIVAR_FORGE_CHAIN_VISUAL_NAME) as THREE.Group;
    expect(chain.visible).toBe(true);
    expect(chain.userData.chainLength).toBeCloseTo(10, 5);
    expect(chain.userData.visibleLinks).toBeGreaterThanOrEqual(10);
    expect(chain.children.some((child) => child.userData.forgeChainLink === true)).toBe(true);
  });

  it('draws the pair once and hides it as soon as the aura disappears', () => {
    const {
      first,
      second,
      firstGroup: firstOwner,
      secondGroup: secondOwner,
      views,
    } = linkedPlayers();

    syncIgnivarForgeChainVisual(firstOwner, first, views, 0.1);
    syncIgnivarForgeChainVisual(secondOwner, second, views, 0.1);
    expect(firstOwner.getObjectByName(IGNIVAR_FORGE_CHAIN_VISUAL_NAME)?.visible).toBe(true);
    expect(secondOwner.getObjectByName(IGNIVAR_FORGE_CHAIN_VISUAL_NAME)).toBeUndefined();

    first.auras.length = 0;
    syncIgnivarForgeChainVisual(firstOwner, first, views, 0.1);
    expect(firstOwner.getObjectByName(IGNIVAR_FORGE_CHAIN_VISUAL_NAME)?.visible).toBe(false);
  });

  it('uses authoritative positions while the partner render view is still loading', () => {
    const { first, firstGroup, secondGroup } = linkedPlayers();
    const views = new Map([[first.id, { group: firstGroup }]]);
    const entities = new Map([[20, { pos: secondGroup.position }]]);

    syncIgnivarForgeChainVisual(firstGroup, first, views, 0.1, entities);

    const chain = firstGroup.getObjectByName(IGNIVAR_FORGE_CHAIN_VISUAL_NAME) as THREE.Group;
    expect(chain.visible).toBe(true);
    expect(chain.userData.chainLength).toBeCloseTo(10, 5);
  });

  it('visually marks a tether stretched beyond the safe distance as strained', () => {
    const { first, firstGroup, secondGroup, views } = linkedPlayers();
    secondGroup.position.set(
      firstGroup.position.x + 16,
      firstGroup.position.y,
      firstGroup.position.z,
    );

    syncIgnivarForgeChainVisual(firstGroup, first, views, 0.1);

    const chain = firstGroup.getObjectByName(IGNIVAR_FORGE_CHAIN_VISUAL_NAME) as THREE.Group;
    expect(chain.userData.strained).toBe(true);
  });

  it('matches the horizontal damage check when the partner has a vertical offset', () => {
    const { first, firstGroup, secondGroup, views } = linkedPlayers();
    secondGroup.position.set(
      firstGroup.position.x + 6,
      firstGroup.position.y + 14,
      firstGroup.position.z + 6,
    );

    syncIgnivarForgeChainVisual(firstGroup, first, views, 0.1);

    const chain = firstGroup.getObjectByName(IGNIVAR_FORGE_CHAIN_VISUAL_NAME) as THREE.Group;
    expect(chain.userData.chainLength).toBeGreaterThan(10);
    expect(chain.userData.strained).toBe(false);
  });

  it('lands on the partner with a rotated, scaled, presentation-offset owner', () => {
    const { first, firstGroup, secondGroup, views } = linkedPlayers();
    firstGroup.rotation.y = 0.73;
    firstGroup.scale.setScalar(2);

    syncIgnivarForgeChainVisual(firstGroup, { ...first, scale: 2 }, views, 0.1);
    firstGroup.updateMatrixWorld(true);
    const chain = firstGroup.getObjectByName(IGNIVAR_FORGE_CHAIN_VISUAL_NAME) as THREE.Group;
    const endpoint = chain.localToWorld(new THREE.Vector3(0, 0, chain.userData.chainLength));

    expect(endpoint.x).toBeCloseTo(secondGroup.position.x, 5);
    expect(endpoint.y).toBeCloseTo(secondGroup.position.y + 1.25, 5);
    expect(endpoint.z).toBeCloseTo(secondGroup.position.z, 5);
  });

  it('marks the chain as actionable and owns disposable geometry and materials', () => {
    const chain = buildIgnivarForgeChainVisual();
    const mesh = chain.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    if (!mesh) throw new Error('Forge Chain visual did not create a mesh');
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose');
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const materialDispose = vi.spyOn(material, 'dispose');
    expect(chain.name).toBe(IGNIVAR_FORGE_CHAIN_VISUAL_NAME);
    expect(chain.userData.renderCategory).toBe('ui3d');
    expect(chain.visible).toBe(false);
    expect(chain.children.length).toBeGreaterThan(12);

    disposeIgnivarForgeChainVisual(chain);

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  it('keeps the actionable tether static under reduced motion', () => {
    const { first, firstGroup, views } = linkedPlayers();

    syncIgnivarForgeChainVisual(firstGroup, first, views, 0.5, undefined, true);
    const chain = firstGroup.getObjectByName(IGNIVAR_FORGE_CHAIN_VISUAL_NAME) as THREE.Group;
    const link = chain.children.find((child) => child.userData.forgeChainLink === true);
    const before = link?.rotation.z;
    syncIgnivarForgeChainVisual(firstGroup, first, views, 0.5, undefined, true);

    expect(chain.visible).toBe(true);
    expect(before).toBe(0);
    expect(link?.rotation.z).toBe(before);
  });
});
