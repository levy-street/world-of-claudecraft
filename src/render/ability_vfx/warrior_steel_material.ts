/** A cut displaces air along the weapon path. Its cool steel catch belongs to
 * the advancing edge; transparent striations carry the full broad wake. */
export const WARRIOR_STEEL_FRAGMENT = `
if((uKind>14.5&&uKind<15.5)||(uKind>15.5&&uKind<16.5&&uStorm<.5)||(uKind>16.5&&uKind<17.5)){
  float u=uKind>16.5?clamp((atan(vLocal.x,vLocal.z)+2.2)/4.4,0.,1.):vUv.x;
  float v=uKind>16.5?clamp((8.-length(vLocal.xz))/2.2,0.,1.):vUv.y;
  float gain=steelSweepGain(u,uAge);
  float head=clamp((gain-.22)/1.45,0.,1.);
  float flow=u-uAge*.27*uMotion;
  float grain=texture2D(uPressureMap,vec2(fract(flow*.7),.28+v*.36)).r;
  float striation=sin(v*83.+u*9.+grain*9.);
  float strands=smoothstep(.25,.94,striation);
  float edge=1.-smoothstep(.015,.12,v);
  float tail=(1.-smoothstep(.48,1.,v))*smoothstep(.0,.06,u)*(1.-smoothstep(.93,1.,u));
  float movement=mix(.7,.22+head*.98,uMotion);
  float wake=(.075+grain*.15+strands*.26)*tail;
  float score=dot(texture2D(uSteelMap,clamp(vSurface,vec2(0.),vec2(1.))).rgb,vec3(.333333));
  colour=mix(uTint*.5,uAccent,edge*.8+strands*.13)*( .8+score*.35);
  colour+=uAccent*edge*head*.7*uMotion;
  alpha=(edge*.8+wake)*movement*(1.-smoothstep(.48,1.,uAge));
}`;
