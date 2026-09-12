// The thin DOM arm of the Hide Interface toggle: the core decides, this sets
// `body.interface-hidden`, and the enumerated hide set in src/styles/hud.css
// does the rest. The class lands on BODY because the nameplate layer, the
// Discord panel, the touch controls, and the pad cursor are siblings of #ui,
// not children. Not a per-frame painter: one class write per state change.

import { INTERFACE_HIDDEN_CLASS, InterfaceVisibility } from './interface_visibility_core';

export interface InterfaceVisibilityHost {
  classList: { toggle(token: string, force?: boolean): boolean };
}

export function createInterfaceVisibility(body: InterfaceVisibilityHost): InterfaceVisibility {
  return new InterfaceVisibility((hidden) => {
    body.classList.toggle(INTERFACE_HIDDEN_CLASS, hidden);
  });
}
