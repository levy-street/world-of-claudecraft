import * as THREE from 'three';
import type { PriestMarkerState } from '../sim/combat/priest/presentation';

const RELATION_Y_OFFSET = 0.46;
const GLOOM_Y_OFFSET = 0.9;
const GOLD = new THREE.MeshBasicMaterial({ color: 0xffd76a, depthWrite: false });
const IVORY = new THREE.MeshBasicMaterial({ color: 0xfff4c2, depthWrite: false });
const VIOLET = new THREE.MeshBasicMaterial({ color: 0x9f63ff, depthWrite: false });
const DIRGE = new THREE.MeshBasicMaterial({ color: 0x6d4a91, depthWrite: false });
const GLOOM_LIT = new THREE.MeshBasicMaterial({ color: 0xb779ff, depthWrite: false });
const GLOOM_DARK = new THREE.MeshBasicMaterial({ color: 0x28153d, depthWrite: false });
const RING = new THREE.TorusGeometry(0.24, 0.025, 6, 32);
const SMALL_RING = new THREE.TorusGeometry(0.15, 0.018, 5, 24);
const WING = new THREE.ConeGeometry(0.12, 0.42, 3);
const DOLL = new THREE.OctahedronGeometry(0.15, 0);
const PIN = new THREE.ConeGeometry(0.045, 0.3, 4);
const PIP = new THREE.OctahedronGeometry(0.055, 0);

function ring(material: THREE.Material, radiusScale = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(RING, material);
  mesh.rotation.x = Math.PI / 2;
  mesh.scale.setScalar(radiusScale);
  mesh.frustumCulled = false;
  return mesh;
}

/** Static, graphics-tier-independent cues; motion settings cannot erase gameplay state. */
export class PriestMarkersVisual {
  readonly group = new THREE.Group();
  private readonly doctrine = new THREE.Group();
  private readonly vigil = new THREE.Group();
  private readonly dirge = new THREE.Group();
  private readonly effigy = new THREE.Group();
  private readonly gloom = new THREE.Group();
  private readonly gloomPips: THREE.Mesh[] = [];

  constructor(characterHeight: number) {
    this.group.name = 'priest-markers-visual';

    const doctrineOuter = ring(GOLD);
    const doctrineInner = new THREE.Mesh(SMALL_RING, GOLD);
    doctrineInner.rotation.x = Math.PI / 2;
    doctrineInner.position.y = 0.08;
    this.doctrine.add(doctrineOuter, doctrineInner);
    this.doctrine.name = 'priest-doctrine-marker';

    const vigilHalo = ring(IVORY, 1.12);
    const leftWing = new THREE.Mesh(WING, IVORY);
    const rightWing = new THREE.Mesh(WING, IVORY);
    leftWing.position.set(-0.28, -0.17, 0);
    rightWing.position.set(0.28, -0.17, 0);
    leftWing.rotation.z = -0.72;
    rightWing.rotation.z = 0.72;
    this.vigil.add(vigilHalo, leftWing, rightWing);
    this.vigil.name = 'priest-vigil-marker';

    const dirgeSigil = new THREE.Mesh(SMALL_RING, DIRGE);
    dirgeSigil.rotation.x = Math.PI / 2;
    dirgeSigil.rotation.z = Math.PI / 4;
    const dirgePin = new THREE.Mesh(PIN, DIRGE);
    dirgePin.position.y = -0.14;
    dirgePin.rotation.z = Math.PI;
    this.dirge.add(dirgeSigil, dirgePin);
    this.dirge.name = 'priest-dirge-link-marker';

    const doll = new THREE.Mesh(DOLL, VIOLET);
    doll.scale.set(0.72, 1.45, 0.72);
    const binding = ring(VIOLET, 0.82);
    binding.rotation.z = Math.PI / 4;
    this.effigy.add(doll, binding);
    this.effigy.name = 'priest-effigy-marker';

    this.doctrine.position.set(-0.32, characterHeight + RELATION_Y_OFFSET, 0);
    this.vigil.position.set(0.32, characterHeight + RELATION_Y_OFFSET, 0);
    this.dirge.position.set(0, characterHeight + RELATION_Y_OFFSET - 0.2, 0);
    this.effigy.position.set(0, characterHeight + RELATION_Y_OFFSET, 0);
    this.group.add(this.doctrine, this.vigil, this.dirge, this.effigy);

    this.gloom.name = 'priest-gloomtithe-marker';
    this.gloom.position.y = characterHeight + GLOOM_Y_OFFSET;
    for (let index = 0; index < 5; index++) {
      const pip = new THREE.Mesh(PIP, GLOOM_DARK);
      pip.position.x = (index - 2) * 0.14;
      pip.frustumCulled = false;
      this.gloom.add(pip);
      this.gloomPips.push(pip);
    }
    this.group.add(this.gloom);
    this.update({
      doctrine: false,
      vigil: false,
      dirge: false,
      effigy: false,
      gloomtitheStacks: 0,
      summonReady: false,
    });
  }

  update(state: PriestMarkerState): void {
    this.doctrine.visible = state.doctrine;
    this.vigil.visible = state.vigil;
    this.dirge.visible = state.dirge && !state.effigy;
    this.effigy.visible = state.effigy;
    this.gloom.visible = state.gloomtitheStacks > 0;
    for (let index = 0; index < this.gloomPips.length; index++) {
      const pip = this.gloomPips[index];
      pip.material = index < state.gloomtitheStacks ? GLOOM_LIT : GLOOM_DARK;
      pip.scale.setScalar(state.summonReady ? 1.3 : 1);
    }
    this.group.visible =
      state.doctrine || state.vigil || state.dirge || state.effigy || state.gloomtitheStacks > 0;
  }
}

export function syncPriestMarkersVisual(
  current: PriestMarkersVisual | null,
  parent: THREE.Group,
  characterHeight: number,
  state: PriestMarkerState,
): PriestMarkersVisual | null {
  const active =
    state.doctrine || state.vigil || state.dirge || state.effigy || state.gloomtitheStacks > 0;
  if (!current && !active) return null;
  const visual = current ?? new PriestMarkersVisual(characterHeight);
  if (!current) parent.add(visual.group);
  visual.update(state);
  return visual;
}
