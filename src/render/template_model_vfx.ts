// Bespoke effects that ride one mob template's model, attached once when the
// renderer builds (or takes back from the pool) that entity's character
// visual. One seam so renderer.ts keeps a single call however many templates
// carry their own model effects.
import type * as THREE from 'three';
import { buddyTemplateId } from '../sim/content/buddy_mobs';
import { IGNIVAR_BOSS_ID } from '../sim/types';
import { attachIgnivarModelVfx } from './ignivar_model_vfx';
import { BREATH_GUARDIAN } from './smith_heart_fx/breath_body_core';
import { attachBreathBodySockets } from './smith_heart_fx/breath_body_sockets';
import { attachCouncilBodySockets, councilSocketRole } from './smith_heart_fx/council_body_sockets';
import { HEAT_GUARDIAN } from './smith_heart_fx/heat_body_core';
import { attachHeatBodySockets } from './smith_heart_fx/heat_body_sockets';
import { QUENCH_GUARDIAN } from './smith_heart_fx/quench_body_core';
import { attachQuenchBodySockets } from './smith_heart_fx/quench_body_sockets';
import { attachSpritesBuddyFlame } from './sprites_buddy_flame';

const SPRITES_BUDDY_TEMPLATE_ID = buddyTemplateId('sprites');

/** Attach the model effects `templateId` carries to its visual's root (no-op
 *  for every other template). Idempotent per root. */
export function attachTemplateModelVfx(
  templateId: string,
  root: THREE.Object3D,
  reducedMotion: () => boolean,
): void {
  // Ignivar's forge fires (synced by ignivar_encounter.ts).
  if (templateId === IGNIVAR_BOSS_ID) attachIgnivarModelVfx(root);
  // The sprite buddy's live flames, which step themselves as they draw.
  else if (templateId === SPRITES_BUDDY_TEMPLATE_ID) attachSpritesBuddyFlame(root, reducedMotion);
  // The Guardian of the Heat's fire sockets (read by smith_heart_fx/heat_body.ts).
  else if (templateId === HEAT_GUARDIAN) attachHeatBodySockets(root);
  // The Guardian of the Breath's wind sockets (read by smith_heart_fx/breath_body.ts).
  else if (templateId === BREATH_GUARDIAN) attachBreathBodySockets(root);
  // The Guardian of the Quench's cold sockets (read by smith_heart_fx/quench_body.ts).
  else if (templateId === QUENCH_GUARDIAN) attachQuenchBodySockets(root);
  else {
    // The Hammer Council's death sockets (read by smith_heart_fx/council_death_fx.ts).
    const role = councilSocketRole(templateId);
    if (role) attachCouncilBodySockets(role, root);
  }
}
