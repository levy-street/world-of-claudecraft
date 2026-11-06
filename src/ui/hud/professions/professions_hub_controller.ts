// The Professions hub's controller: the shared window-hub tab group
// (../hub/window_hub_controller.ts) bound to the Professions spec.

import {
  WindowHubController,
  type WindowHubDeps,
  type WindowHubMember,
  type WindowHubStrip,
} from '../hub/window_hub_controller';
import { PROFESSIONS_HUB, type ProfessionsHubTab } from './professions_hub_view';

export type ProfessionsHubMember = WindowHubMember;
export type ProfessionsHubStrip = WindowHubStrip;
export type ProfessionsHubDeps = WindowHubDeps<ProfessionsHubTab>;

export class ProfessionsHubController extends WindowHubController<ProfessionsHubTab> {
  constructor(deps: ProfessionsHubDeps) {
    super(PROFESSIONS_HUB, deps);
  }
}
