/** Each plate carries its own travel phase in UV.x, so a pressure front raises
 * whole pieces instead of bending their vertices into rubber. The flat full
 * footprint is visible immediately; no actionable area waits for the wave. */
export const WARRIOR_GROUND_VERTEX = `
if((uKind>17.5&&uKind<19.5)||(uKind>22.5&&uKind<23.5)){
  float travel=uKind>22.5?.18:uKind>18.5?.30:.24;
  float plateAge=uAge-uv.x*travel;
  float rise=smoothstep(0.,.105,plateAge);
  float settle=1.-.82*smoothstep(.44,1.,uAge);
  p.y*=mix(1.,(.055+.945*rise)*settle,uMotion);
}`;

export const WARRIOR_GROUND_FRAGMENT = `
if((uKind>17.5&&uKind<19.5)||(uKind>22.5&&uKind<23.5)){
  float travel=uKind>22.5?.18:uKind>18.5?.30:.24;
  float age=uAge-vUv.x*travel;
  float pressure=smoothstep(0.,.045,age)*(1.-smoothstep(.08,.19,age));
  float fresh=1.-smoothstep(.1,.3,vUv.y);
  colour+=uAccent*fresh*pressure*.35*uMotion;
  // Faultline's tall outer wall carries the eruption. Its inner fracture
  // remains full size but translucent, keeping the attacking rig readable.
  if(uKind>18.5&&uKind<19.5)alpha*=mix(.28,1.,smoothstep(.1,.48,vUv.x));
}`;
