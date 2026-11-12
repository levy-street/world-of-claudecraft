// The Hammer Council's death sockets: empty points hung on the bones of each
// member's model (council_death_core.ts GUARDIAN_POINTS, SINGER_POINTS: every
// rock of the Guardian and every crystal of the Seam Singer rides one bone),
// so the death scene (council_death_fx.ts) reads where each rock or crystal
// is THIS frame, through the Death clip, at whatever scale the view draws it:
// the Guardian's cracks blaze on its own rocks and its slabs break off where
// they hang; the Singer's light leaks and her shards burst from her own body.
//
// Attached once per character view by ../template_model_vfx.ts (the seam the
// renderer calls when it builds or re-takes a view from its pool); the latest
// live set per member is what the scene reads (one council lives at a time in
// view; a view retired from the scene, or hidden, reads as none). The sockets
// ride the view's bones, carry no geometry and no material, and leave
// nothing for the GPU to prepare.

import * as THREE from 'three';
import { COUNCIL_TEMPLATES, type CouncilRole } from '../../sim/encounters/smith_heart/council_ids';
import { COUNCIL_DEATH_POINTS } from './council_death_core';

const SOCKETS_KEY = 'smithHeartCouncilSockets';

/** One view's sockets, in its role's points order (null where a bone is
 *  missing). */
export interface CouncilBodySocketSet {
  readonly role: CouncilRole;
  readonly root: THREE.Object3D;
  readonly points: readonly (THREE.Object3D | null)[];
}

const latest: Record<CouncilRole, CouncilBodySocketSet | null> = { guardian: null, singer: null };
const pending: Record<CouncilRole, THREE.Object3D | null> = { guardian: null, singer: null };

/** The member a template id is (null for any other). */
export function councilSocketRole(templateId: string): CouncilRole | null {
  if (templateId === COUNCIL_TEMPLATES.guardian) return 'guardian';
  if (templateId === COUNCIL_TEMPLATES.singer) return 'singer';
  return null;
}

/** Hang `role`'s sockets on the model under `root` (idempotent per root). A
 *  view whose model is still loading is remembered and hung on the next
 *  retry. */
export function attachCouncilBodySockets(role: CouncilRole, root: THREE.Object3D): void {
  const existing = root.userData[SOCKETS_KEY] as CouncilBodySocketSet | undefined;
  if (existing) {
    latest[role] = existing;
    pending[role] = null;
    return;
  }
  let skinned = false;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  });
  if (!skinned) {
    pending[role] = root;
    latest[role] = null;
    return;
  }
  pending[role] = null;
  const points: (THREE.Object3D | null)[] = [];
  for (const p of COUNCIL_DEATH_POINTS[role]) {
    const name = THREE.PropertyBinding.sanitizeNodeName(p.bone);
    const bone = root.getObjectByName(name) ?? root.getObjectByName(p.bone);
    if (!bone) {
      points.push(null);
      continue;
    }
    const socket = new THREE.Object3D();
    socket.name = `smithHeartCouncilSocket_${role}_${p.bone}`;
    bone.add(socket);
    points.push(socket);
  }
  const set: CouncilBodySocketSet = { role, root, points };
  root.userData[SOCKETS_KEY] = set;
  latest[role] = set;
}

/** `role`'s live sockets (the latest view's, while it is in the scene). */
export function councilBodySockets(role: CouncilRole): CouncilBodySocketSet | null {
  const s = latest[role];
  if (s && (!s.root.parent || !s.root.visible)) return null;
  return s;
}

/** Hang the sockets on a view whose model was still loading when it was
 *  attached (called on the scene's scan tick, never every frame). */
export function retryCouncilBodySockets(): void {
  for (const role of ['guardian', 'singer'] as const) {
    const p = pending[role];
    if (!latest[role] && p?.parent) attachCouncilBodySockets(role, p);
  }
}

/** Forget the sockets (the scene's dispose; tests). */
export function clearCouncilBodySockets(): void {
  latest.guardian = null;
  latest.singer = null;
  pending.guardian = null;
  pending.singer = null;
}
