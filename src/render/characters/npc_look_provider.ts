// The non-player half of the hosts' modular look provider, factored out of
// main.ts so the Studio viewport composes NPCs exactly the way the game does
// (the editor rendered every named NPC as a stock rig because it never
// installed a look provider at all). npc_looks.ts stays free of sim imports
// by contract, so the one branch that needs the sim — Tidehold's role table —
// lives here instead.
import { isTideholdTemplate, tideholdRole } from '../../sim/deepglass/citadel';
import type { Entity } from '../../sim/types';
import type { ModularLook } from './modular';
import {
  DEEPGLASS_MARSHAL_LOOK,
  deepglassCrowdLook,
  isDeepglassCrowdTemplate,
  isDeepglassMarshalTemplate,
  isPortalWizardTemplate,
  npcLookFor,
  PORTAL_WIZARD_LOOK,
  tideholdLook,
} from './npc_looks';

/**
 * The composed look for a non-player entity: the runtime-composed fork looks
 * first (Baldemar the Bald, the Deepglass city-event crowd, Tidehold's
 * residents, the match marshal), then the authored NPC_LOOKS table. Null keeps
 * the fixed legacy rig, the same answer a pre-creator player gets.
 */
export function npcEntityLookFor(e: Entity): ModularLook | null {
  if (e.kind === 'npc') {
    if (isPortalWizardTemplate(e.templateId)) return PORTAL_WIZARD_LOOK;
    if (isDeepglassCrowdTemplate(e.templateId)) return deepglassCrowdLook(e.templateId);
    if (isTideholdTemplate(e.templateId)) {
      return tideholdLook(e.templateId, tideholdRole(e.templateId));
    }
    if (isDeepglassMarshalTemplate(e.templateId)) return DEEPGLASS_MARSHAL_LOOK;
  }
  return npcLookFor(e.templateId, e.kind);
}
