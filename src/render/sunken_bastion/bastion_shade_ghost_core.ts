// Whether a body the renderer draws is a Fog Shade the Fogbeacon's beam is
// pouring through: the sim puts the Hollow Shade tell on a shade while the
// beam touches it and a breath after (encounters/sunken_bastion/vael.ts), and
// the renderer turns that shade's whole body see-through (the character ghost
// treatment, through its gated swap), so the real Vael, who never ghosts,
// stands out. Pure: renderer.ts asks it per body.

import { FOG_SHADE_ID, VAEL_SHADE_HOLLOW } from '../../sim/encounters/sunken_bastion/ids';

export function bastionShadeGhosted(e: {
  templateId: string;
  auras: readonly { id: string }[];
}): boolean {
  if (e.templateId !== FOG_SHADE_ID) return false;
  for (const a of e.auras) if (a.id === VAEL_SHADE_HOLLOW) return true;
  return false;
}
