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
    pos: { x: 40, y: 2, z: 60 },
    auras: [{ id: IGNIVAR_FORGE_CHAINS_AURA_ID, value2: 20, duration: 8, remaining: 5 }],
  };
  const second = {
    id: 20,
    kind: 'player',
    pos: { x: 46, y: 2, z: 68 },
    auras: [{ id: IGNIVAR_FORGE_CHAINS_AURA_ID, value2: 10, duration: 8, remaining: 5 }],
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

  it('warns before the tether reaches its break distance', () => {
    const { first, firstGroup, secondGroup, views } = linkedPlayers();
    secondGroup.position.set(
      firstGroup.position.x + 8.5,
      firstGroup.position.y,
      firstGroup.position.z,
    );

    syncIgnivarForgeChainVisual(firstGroup, first, views, 0.1);

    const chain = firstGroup.getObjectByName(IGNIVAR_FORGE_CHAIN_VISUAL_NAME) as THREE.Group;
    expect(chain.userData.warning).toBe(true);
    expect(chain.userData.strained).toBe(false);
    expect(
      chain.children.filter((child) => child.userData.forgeChainWarningAnchor === true),
    ).toHaveLength(2);
    expect(
      chain.children
        .filter((child) => child.userData.forgeChainWarningAnchor === true)
        .every((child) => child.visible),
    ).toBe(true);
  });

  it('keeps warning anchors hidden below eight yards and during attachment grace', () => {
    const { first, firstGroup, secondGroup, views } = linkedPlayers();
    secondGroup.position.set(
      firstGroup.position.x + 7.9,
      firstGroup.position.y,
      firstGroup.position.z,
    );
    syncIgnivarForgeChainVisual(firstGroup, first, views, 0.1);
    const chain = firstGroup.getObjectByName(IGNIVAR_FORGE_CHAIN_VISUAL_NAME) as THREE.Group;
    expect(chain.userData.warning).toBe(false);
    expect(
      chain.children
        .filter((child) => child.userData.forgeChainWarningAnchor === true)
        .every((child) => !child.visible),
    ).toBe(true);

    secondGroup.position.x = firstGroup.position.x + 8.5;
    first.auras[0].remaining = 6;
    syncIgnivarForgeChainVisual(firstGroup, first, views, 0.1);
    expect(chain.userData.warning).toBe(false);
    expect(
      chain.children
        .filter((child) => child.userData.forgeChainWarningAnchor === true)
        .every((child) => !child.visible),
    ).toBe(true);

    first.auras[0].remaining = 5.5;
    syncIgnivarForgeChainVisual(firstGroup, first, views, 0.1);
    expect(chain.userData.warning).toBe(true);
    expect(
      chain.children
        .filter((child) => child.userData.forgeChainWarningAnchor === true)
        .every((child) => child.visible),
    ).toBe(true);
  });

  it('uses authoritative entity distance for warning state while views interpolate', () => {
    const { first, firstGroup, secondGroup, views } = linkedPlayers();
    const authoritative = new Map([
      [first.id, { pos: first.pos }],
      [20, { pos: { x: first.pos.x + 7.5, y: 2, z: first.pos.z } }],
    ]);
    secondGroup.position.set(firstGroup.position.x + 8.5, 2, firstGroup.position.z);

    syncIgnivarForgeChainVisual(firstGroup, first, views, 0.1, authoritative);
    const chain = firstGroup.getObjectByName(IGNIVAR_FORGE_CHAIN_VISUAL_NAME) as THREE.Group;
    expect(chain.userData.warning).toBe(false);
    expect(
      chain.children
        .filter((child) => child.userData.forgeChainWarningAnchor === true)
        .every((child) => !child.visible),
    ).toBe(true);

    authoritative.set(20, { pos: { x: first.pos.x + 8.5, y: 2, z: first.pos.z } });
    secondGroup.position.x = firstGroup.position.x + 7.5;
    syncIgnivarForgeChainVisual(firstGroup, first, views, 0.1, authoritative);
    expect(chain.userData.warning).toBe(true);
    expect(
      chain.children
        .filter((child) => child.userData.forgeChainWarningAnchor === true)
        .every((child) => child.visible),
    ).toBe(true);
  });

  it('switches warning and strain exactly at the authoritative eight and ten yard limits', () => {
    const { first, firstGroup, views } = linkedPlayers();
    const authoritative = new Map([
      [first.id, { pos: first.pos }],
      [20, { pos: { x: first.pos.x + 8, y: 2, z: first.pos.z } }],
    ]);
    syncIgnivarForgeChainVisual(firstGroup, first, views, 0.1, authoritative);
    const chain = firstGroup.getObjectByName(IGNIVAR_FORGE_CHAIN_VISUAL_NAME) as THREE.Group;
    expect(chain.userData.warning).toBe(true);
    expect(chain.userData.strained).toBe(false);
    const anchors = chain.children.filter(
      (child) => child.userData.forgeChainWarningAnchor === true,
    );
    expect(anchors).toHaveLength(2);
    expect(anchors.every((anchor) => anchor.visible)).toBe(true);
    const warningScale = anchors[0].scale.x;
    const warningColor = (
      chain.userData.warningAnchorMaterial as THREE.MeshBasicMaterial
    ).color.clone();

    authoritative.set(20, { pos: { x: first.pos.x + 10, y: 2, z: first.pos.z } });
    syncIgnivarForgeChainVisual(firstGroup, first, views, 0.1, authoritative);
    expect(chain.userData.warning).toBe(true);
    expect(chain.userData.strained).toBe(true);
    expect(anchors.every((anchor) => anchor.visible)).toBe(true);
    expect(anchors[0].scale.x).toBeGreaterThan(warningScale);
    expect(
      (chain.userData.warningAnchorMaterial as THREE.MeshBasicMaterial).color.r,
    ).toBeGreaterThan(warningColor.r);
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
