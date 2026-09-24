/** Rolling, torn combustion sheets. Fixed authored lobes and smooth advected density, no grain texture
 * and no extra material or sampler. Shared helpers precede this shader fragment. */
export const SHAMAN_FIRE_GLSL = `
float shamanFlow(vec2 p) {
  vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  float a=shamanHash(dot(i,vec2(17.,113.)));
  float b=shamanHash(dot(i+vec2(1.,0.),vec2(17.,113.)));
  float c=shamanHash(dot(i+vec2(0.,1.),vec2(17.,113.)));
  float d=shamanHash(dot(i+1.,vec2(17.,113.)));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
vec3 shamanFire(vec2 p,float t,float release,float contact,float variant) {
  bool forge=variant>1.5&&variant<2.5;
  bool cleave=variant>2.5&&variant<3.5;
  bool blast=variant>3.5&&variant<4.5;
  bool ascend=variant>4.5;
  vec2 q=p;
  if(cleave) q=shamanLocal(p,shamanAxis(.12));
  if(blast||cleave) q=vec2(q.y,q.x);
  if(forge) q*=vec2(2.4,1.35);
  // A single expanding plume owns the silhouette. Overlapping pressure folds
  // sculpt its crown; no independent radial leaves or upright flame rods.
  float age=clamp(t,0.,1.);
  float front=.08+release*.35;
  float v=clamp((q.y+.12)/(front+.12),0.,1.);
  float bend=sin(v*4.5-age*2.2)*v*(ascend?.12:blast?.11:.085);
  q.x-=bend;
  // A rolling contact pocket pushes sideways around the wound. The luminous
  // crest curls into its own dark interior instead of forming a vertical rod.
  vec2 rollCentre=vec2(blast?-.025:.035,.12+age*.055);
  vec2 rollDelta=q-rollCentre;
  float rolling=exp(-dot(rollDelta,rollDelta)*26.0)*(forge?.12:.48)*release;
  q+=vec2(-rollDelta.y,rollDelta.x)*rolling;
  vec2 flow=vec2(q.x*11.,q.y*8.-age*2.8);
  float large=shamanFlow(flow);
  vec2 advected=flow+vec2(large,-large)*1.8;
  float folds=shamanFlow(advected*2.0+vec2(age*.7,-age*.8));
  float threads=shamanFlow(advected*4.15+vec2(folds,-age));
  float width=(blast?.23:ascend?.15:forge?.115:.19)+sin(v*3.14159)*.115;
  width*=.7+release*.3;
  float spine=1.-abs(q.x)/(width*(.7+large*.5));
  spine*=smoothstep(-.13,-.065,q.y)*(1.-smoothstep(front-.06,front+.045,q.y));
  float density=max(0.,spine);
  for(int j=0;j<7;j++) {
    float i=float(j),h=shamanHash(i+23.);
    float level=.04+i*.045;
    float side=sin(i*2.4+.3)*(.075+level*.3)*release;
    vec2 centre=vec2(side,level*release-.03+age*.025);
    vec2 size=vec2(.1+h*.06,.085+h*.06)*(1.-age*.3);
    float roll=max(0.,1.-dot((q-centre)/size,(q-centre)/size));
    density=1.-(1.-density)*(1.-roll*.8);
  }
  // Two unequal rolling voids reveal a dark interior and leave a compressed
  // hot lip. The voids move with the same carrier rather than boiling in place.
  vec2 cavityA=(q-vec2(-.042+sin(age*3.)*.035,.14+age*.075))/vec2(.07,.092);
  vec2 cavityB=(q-vec2(.07,.27+age*.045))/vec2(.052,.073);
  float cavity=max(exp(-dot(cavityA,cavityA)*2.2),exp(-dot(cavityB,cavityB)*2.8)*.85);
  density*=1.-cavity*.6*smoothstep(.04,.3,age);
  density*=.52+folds*.32+threads*.26;
  // Keep the hot pressure body connected. Fine erosion belongs at the edge;
  // a high threshold through the entire body cuts it into floating teardrops.
  float breakup=.23+(1.-large)*.08+(1.-folds)*.14+(1.-threads)*.07;
  float fuel=max(0.,density-breakup);
  float coverage=smoothstep(.012,.12,fuel);
  float cooling=1.-smoothstep(.25,.98,age)*.7;
  float temperature=clamp(fuel*1.4*(.36+folds*.72)*cooling,0.,1.);
  vec3 fire=mix(vec3(.16,.003,.0005),vec3(.95,.052,.001),smoothstep(.02,.25,temperature));
  fire=mix(fire,vec3(1.25,.32,.014),smoothstep(.2,.56,temperature));
  fire=mix(fire,vec3(1.55,.85,.2),smoothstep(.52,.9,temperature));
  fire*=coverage*(1.-smoothstep(.48,1.,age));
  float filament=shamanLine(folds+threads*.18-.64,.008)*coverage;
  float rolledLip=shamanLine(density-breakup-.11,.015)*coverage;
  fire+=vec3(.58,.2,.018)*(filament*.65+rolledLip*.34)*cooling;
  fire+=vec3(.8,.38,.07)*pow(max(0.,threads-.58),3.)*coverage*cooling;
  fire+=vec3(1.2,.8,.3)*shamanSliver(p,shamanAxis(.12),.14,.011)*contact;
  return fire;
}
`;
