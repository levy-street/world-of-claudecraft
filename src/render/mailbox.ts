// The Ravenpost pillar: the procedural mailbox prop the renderer builds for
// `kind:'object'` entities with templateId 'mailbox'. A carved stone plinth,
// a timber post carrying the brass letterbox, a small peaked roof, and the
// service's brass raven perched on top. The votive glow under the letterbox is
// the per-viewer "unread mail" beacon: the renderer toggles it from
// IWorld.mailUnread each frame (exposed via group.userData.mailGlow).
//
// Deterministic (entityId drives the only variation, never Math.random);
// materials go through surfaceMat() for dedup, matching delve_props.ts.

import * as THREE from 'three';
import { GFX, surfaceMat } from './gfx';

function stoneMat(color: number): THREE.Material {
  return surfaceMat({
    color,
    roughness: 0.92,
    metalness: 0,
    flatShading: !GFX.standardMaterials,
  });
}

function woodMat(color: number): THREE.Material {
  return surfaceMat({
    color,
    roughness: 0.8,
    metalness: 0,
    flatShading: !GFX.standardMaterials,
  });
}

function brassMat(color: number): THREE.Material {
  return surfaceMat({
    color,
    roughness: 0.45,
    metalness: 0.75,
    flatShading: !GFX.standardMaterials,
  });
}

export function buildMailboxPillar(entityId: number): { group: THREE.Group; height: number } {
  const group = new THREE.Group();
  const stone = stoneMat(0x6f6a61);
  const stoneDark = stoneMat(0x57534b);
  const wood = woodMat(0x5b4226);
  const brass = brassMat(0xc9973f);
  const raven = surfaceMat({
    color: 0x191b22,
    roughness: 0.55,
    metalness: 0.35,
    flatShading: !GFX.standardMaterials,
  });

  // Stone plinth: two stacked octagonal slabs.
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.66, 0.28, 8), stoneDark);
  plinth.position.y = 0.14;
  group.add(plinth);
  const plinthTop = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.22, 8), stone);
  plinthTop.position.y = 0.39;
  group.add(plinthTop);

  // Timber post.
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.35, 0.18), wood);
  post.position.y = 1.15;
  group.add(post);

  // The letterbox: a brass-trimmed chest with a mail slot, facing the road.
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.5), wood);
  box.position.y = 1.85;
  group.add(box);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.08, 0.54), brass);
  trim.position.y = 2.06;
  group.add(trim);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.03), brass);
  slot.position.set(0, 1.9, 0.265);
  group.add(slot);

  // Peaked roof: a low pyramid keeping the letters dry.
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.58, 0.34, 4), stoneDark);
  roof.position.y = 2.28;
  roof.rotation.y = Math.PI / 4;
  group.add(roof);

  // The Ravenpost raven, perched on the roof peak: body, head, beak, tail.
  const ravenGroup = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), raven);
  body.scale.set(1, 0.85, 1.5);
  ravenGroup.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), raven);
  head.position.set(0, 0.11, 0.14);
  ravenGroup.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.11, 6), brass);
  beak.position.set(0, 0.1, 0.24);
  beak.rotation.x = Math.PI / 2;
  ravenGroup.add(beak);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.22), raven);
  tail.position.set(0, 0.02, -0.22);
  tail.rotation.x = -0.35;
  ravenGroup.add(tail);
  ravenGroup.position.y = 2.5;
  // Each pillar's raven watches a slightly different direction (deterministic).
  ravenGroup.rotation.y = (entityId % 5) * 0.9;
  group.add(ravenGroup);

  // The unread-mail votive: a warm ember tucked under the letterbox. Hidden by
  // default; the renderer flips visibility from the viewer's mailUnread.
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 6),
    surfaceMat({
      color: 0xffd27a,
      roughness: 0.3,
      metalness: 0,
      emissive: 0xffb84d,
      emissiveIntensity: 1.6,
      flatShading: !GFX.standardMaterials,
    }),
  );
  glow.position.set(0, 1.56, 0.2);
  glow.visible = false;
  group.add(glow);
  group.userData.mailGlow = glow;

  return { group, height: 2.9 };
}
