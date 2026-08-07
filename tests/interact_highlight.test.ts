// The hover outline's scene-graph behavior (src/render/interact_highlight.ts).
// No WebGL here: everything asserted below is object-graph work Three does in
// plain Node, which is exactly the half that can strand meshes or leak.

import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { InteractHighlight } from '../src/render/interact_highlight';

const OUTLINE = 'interactOutline';

function shellsUnder(root: THREE.Object3D): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name === OUTLINE) found.push(o);
  });
  return found;
}

function prop(): THREE.Group {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  group.add(mesh);
  return group;
}

/** A one-bone skinned rig, the shape a character view holds. */
function rig(): { group: THREE.Group; skinned: THREE.SkinnedMesh } {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const position = geometry.getAttribute('position');
  const count = position.count;
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
  );
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const bone = new THREE.Bone();
  const skinned = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  skinned.add(bone);
  skinned.bind(new THREE.Skeleton([bone]));
  skinned.frustumCulled = false;
  group.add(skinned);
  return { group, skinned };
}

describe('InteractHighlight', () => {
  let highlight: InteractHighlight;
  beforeEach(() => {
    highlight = new InteractHighlight();
  });

  it('hangs one shell per mesh inside the target and takes them all back', () => {
    const group = prop();
    highlight.setTarget(group);
    expect(shellsUnder(group)).toHaveLength(1);
    highlight.setTarget(null);
    expect(shellsUnder(group)).toHaveLength(0);
  });

  it('moves the shells when the target changes, leaving nothing behind', () => {
    const first = prop();
    const second = prop();
    highlight.setTarget(first);
    highlight.setTarget(second);
    expect(shellsUnder(first)).toHaveLength(0);
    expect(shellsUnder(second)).toHaveLength(1);
  });

  it('BORROWS geometry rather than copying it, so a hover uploads nothing', () => {
    const group = prop();
    const source = group.children[0] as THREE.Mesh;
    highlight.setTarget(group);
    const shell = shellsUnder(group)[0] as THREE.Mesh;
    expect(shell.geometry).toBe(source.geometry);
  });

  it('binds a skinned shell to the SOURCE skeleton so the rim tracks the pose', () => {
    const { group, skinned } = rig();
    highlight.setTarget(group);
    const shell = shellsUnder(group)[0] as THREE.SkinnedMesh;
    expect(shell.isSkinnedMesh).toBe(true);
    expect(shell.skeleton).toBe(skinned.skeleton);
    // Skinned sources disable frustum culling (their bounds are the bind pose);
    // a culled shell would pop its rim off at the screen edge.
    expect(shell.frustumCulled).toBe(false);
  });

  it('parents each shell to its source, so a hidden source draws no rim', () => {
    const group = prop();
    const source = group.children[0] as THREE.Mesh;
    highlight.setTarget(group);
    expect((shellsUnder(group)[0] as THREE.Mesh).parent).toBe(source);
  });

  it('skips a mesh with no normals (there is no direction to expand along)', () => {
    const group = new THREE.Group();
    const bare = new THREE.BufferGeometry();
    bare.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    group.add(new THREE.Mesh(bare, new THREE.MeshBasicMaterial()));
    highlight.setTarget(group);
    expect(shellsUnder(group)).toHaveLength(0);
  });

  it('caps the shell count so a pathological subtree cannot flood the scene', () => {
    const group = new THREE.Group();
    for (let i = 0; i < 40; i++) {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    }
    highlight.setTarget(group);
    expect(shellsUnder(group).length).toBeLessThanOrEqual(24);
    expect(shellsUnder(group).length).toBeGreaterThan(0);
  });

  it('clearIfTarget releases only the subtree the renderer is tearing down', () => {
    const held = prop();
    const other = prop();
    highlight.setTarget(held);
    highlight.clearIfTarget(other);
    expect(shellsUnder(held)).toHaveLength(1);
    highlight.clearIfTarget(held);
    expect(shellsUnder(held)).toHaveLength(0);
  });

  it('rebuilds after a gear/skin swap detaches the meshes it was hanging on', () => {
    // The renderer swaps a CharacterVisual in place: same view group, brand new
    // meshes. setTarget's identity check cannot see that, so update() must.
    const group = new THREE.Group();
    const before = prop();
    group.add(before);
    highlight.setTarget(group);
    expect(shellsUnder(group)).toHaveLength(1);

    before.removeFromParent();
    const after = prop();
    group.add(after);
    const camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 100);
    camera.updateProjectionMatrix();
    // Coarse cadence: the check is not every frame, so drive it a few times.
    for (let i = 0; i < 20; i++) highlight.update(camera, 800);
    expect(shellsUnder(group)).toHaveLength(1);
    expect(shellsUnder(after)).toHaveLength(1);
  });

  it('scales the rim by view depth so its screen thickness is FOV-independent', () => {
    const group = prop();
    highlight.setTarget(group);
    const shell = shellsUnder(group)[0] as THREE.Mesh;
    const uniforms = (shell.material as THREE.ShaderMaterial).uniforms;

    const wide = new THREE.PerspectiveCamera(90, 1.5, 0.1, 100);
    wide.updateProjectionMatrix();
    highlight.update(wide, 800);
    const wideWidth = uniforms.uWidth.value as number;

    const narrow = new THREE.PerspectiveCamera(45, 1.5, 0.1, 100);
    narrow.updateProjectionMatrix();
    highlight.update(narrow, 800);
    const narrowWidth = uniforms.uWidth.value as number;

    // A wider FOV fits more world per pixel, so the same pixel rim is a bigger
    // world offset. Equal values would mean the rim thins as the camera kicks.
    expect(wideWidth).toBeGreaterThan(narrowWidth);
    expect(narrowWidth).toBeGreaterThan(0);

    // Half the viewport height, twice the world offset for the same pixels.
    highlight.update(narrow, 400);
    expect(uniforms.uWidth.value as number).toBeCloseTo(narrowWidth * 2, 10);
  });

  it('tracks a MATRIX-FROZEN source, which is how gather nodes are built', () => {
    // src/render/gather_nodes.ts runs freezeStaticMatrices over the node group:
    // matrixAutoUpdate goes false and the parent is never marked dirty again, so
    // scene.updateMatrixWorld() reaches the shell with force=false. The shell has
    // to establish its own world matrix from that stationary parent, or a node
    // rim would render at the origin instead of on the node.
    const scene = new THREE.Scene();
    const group = prop();
    group.position.set(12, 3, -40);
    scene.add(group);
    scene.updateMatrixWorld(true);
    group.traverse((o) => {
      o.matrixAutoUpdate = false;
    });

    highlight.setTarget(group);
    scene.updateMatrixWorld();

    const source = group.children[0] as THREE.Mesh;
    const shell = shellsUnder(group)[0] as THREE.Mesh;
    expect(shell.matrixWorld.elements).toEqual(source.matrixWorld.elements);
    // Not the identity: an unwritten matrixWorld would sit at the world origin.
    expect(shell.matrixWorld.elements.slice(12, 15)).toEqual([12, 3, -40]);
  });

  it('draws back faces only, behind the source, and never writes depth', () => {
    const group = prop();
    highlight.setTarget(group);
    const material = (shellsUnder(group)[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(material.side).toBe(THREE.BackSide);
    expect(material.depthWrite).toBe(false);
    // Depth TEST stays on: the world must occlude the rim, or it reads as x-ray.
    expect(material.depthTest).toBe(true);
    expect(material.transparent).toBe(true);
  });

  it('never casts or receives shadows', () => {
    const group = prop();
    highlight.setTarget(group);
    const shell = shellsUnder(group)[0];
    expect(shell.castShadow).toBe(false);
    expect(shell.receiveShadow).toBe(false);
  });
});
