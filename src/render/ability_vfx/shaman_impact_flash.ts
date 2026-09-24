import { SHAMAN_FIRE_GLSL } from './shaman_fire_material';

/** Analytic Shaman contact art carried by the existing prepared impact quads.
 * Large silhouettes, cut faces and moving splinters remain independent of atlas
 * resolution. No texture reads, extra objects or per-cast programs. */
export type ShamanImpactStyle =
  | 'shaman_earth_cleave'
  | 'shaman_earth_ram'
  | 'shaman_earth_fault'
  | 'shaman_ward_charge'
  | 'shaman_chorus_crest'
  | 'shaman_storm_echo'
  | 'shaman_storm_cleave'
  | 'shaman_skybranch'
  | 'shaman_fire_forge'
  | 'shaman_fire_cleave'
  | 'shaman_fire_detonation'
  | 'shaman_fire_ascension';

export function shamanImpactVariant(style: string): number {
  switch (style) {
    case 'shaman_ward_charge':
      return 8;
    case 'shaman_chorus_crest':
      return 9;
    case 'shaman_storm_echo':
      return 6;
    case 'shaman_storm_cleave':
      return 7;
    case 'shaman_skybranch':
      return 5;
    case 'shaman_fire_ascension':
      return 5;
    case 'shaman_fire_forge':
      return 2;
    case 'shaman_fire_cleave':
      return 3;
    case 'shaman_fire_detonation':
      return 4;
    case 'shaman_earth_cleave':
      return 2;
    case 'shaman_earth_ram':
      return 3;
    case 'shaman_earth_fault':
      return 4;
    default:
      return 1;
  }
}

export function shamanImpactStyle(style: string): number {
  switch (style) {
    case 'shaman_ward_charge':
    case 'shaman_chorus_crest':
    case 'shaman_storm':
    case 'shaman_storm_echo':
    case 'shaman_storm_cleave':
    case 'shaman_skybranch':
      return 1;
    case 'shaman_dust':
    case 'shaman_earth_cleave':
    case 'shaman_earth_ram':
    case 'shaman_earth_fault':
      return 2;
    case 'shaman_ember':
    case 'shaman_fire_forge':
    case 'shaman_fire_cleave':
    case 'shaman_fire_detonation':
    case 'shaman_fire_ascension':
      return 3;
    case 'shaman_rime':
      return 4;
    case 'shaman_gale':
      return 5;
    default:
      return 0;
  }
}

/** Straight linear RGB and coverage: the host owns premultiplication, tone
 * mapping and output conversion. Variant 1/2/3/4 means uppercut/cleave/ram/fault.
 * Every loop is fixed and small; hashes only arrange discrete authored pieces. */
export const SHAMAN_IMPACT_GLSL = `
float shamanPixel;
float shamanHash(float n) { return fract(sin(n*127.1+31.7)*43758.5453); }
vec2 shamanAxis(float a) { return vec2(cos(a),sin(a)); }
vec2 shamanLocal(vec2 p,vec2 axis) {
  return vec2(dot(p,axis),dot(p,vec2(-axis.y,axis.x)));
}
float shamanFill(float d) {
  float aa=shamanPixel*.65;
  return 1.-smoothstep(-aa,aa,d);
}
float shamanLine(float d,float width) {
  float aa=shamanPixel*.65;
  // Integrated narrow-line coverage prevents distant edges becoming fat rods.
  return clamp((width+aa-abs(d))/(2.*aa),0.,min(1.,width/aa));
}
float shamanSegment(vec2 p,vec2 a,vec2 b,float width) {
  vec2 ab=b-a;
  float h=clamp(dot(p-a,ab)/max(.00001,dot(ab,ab)),0.,1.);
  return shamanLine(length(p-a-ab*h),width);
}
float shamanSliver(vec2 p,vec2 axis,float reach,float width) {
  vec2 q=shamanLocal(p,axis);
  float x=abs(q.x),tip=max(0.,1.-x/max(.0001,reach));
  float ends=1.-smoothstep(reach-shamanPixel,reach+shamanPixel,x);
  return shamanLine(q.y,width*tip)*ends;
}
// A deliberately unequal six-corner outline, not a stretched triangle or orb.
float shamanStoneDistance(vec2 q,vec2 size,float seed) {
  vec2 p=q/size;
  float h=shamanHash(seed+8.);
  float d=max(p.y-.57-h*.2,-p.y-.62);
  d=max(d,p.x-.64-h*.26);
  d=max(d,-p.x-.46-h*.2);
  d=max(d,dot(p,vec2(.81,.59))-.56-h*.27);
  d=max(d,dot(p,vec2(-.68,.73))-.7+h*.12);
  d=max(d,dot(p,vec2(-.81,-.59))-.6-h*.24);
  // An open V-shaped cleft removes one corner, not a hole through a pane.
  d=max(d,.14-abs(p.x-.12)-abs(p.y-.61));
  return d*min(size.x,size.y);
}
float shamanBoltU(float k) {
  return k<.5?0.:k<1.5?.07:k<2.5?.19:k<3.5?.23:k<4.5?.4:
    k<5.5?.46:k<6.5?.62:k<7.5?.7:k<8.5?.76:k<9.5?.94:1.;
}
vec2 shamanBoltPoint(float k,float seed,float reach) {
  float u=shamanBoltU(k);
  float y=(shamanHash(floor(k/3.)+seed)-.5)*.085;
  y+=(shamanHash(k+seed*1.7)-.5)*.026;
  return vec2(u*reach,y*sin(u*3.14159));
}
vec2 shamanBolt(vec2 p,float angle,float reach,float seed,float width) {
  vec2 q=shamanLocal(p,shamanAxis(angle));
  // The leader is monotone along x: evaluate its current segment directly,
  // rather than six distance/derivative walks for every pixel of every fork.
  float u=clamp(q.x/reach,0.,1.);
  float cell=u<.07?0.:u<.19?1.:u<.23?2.:u<.4?3.:u<.46?4.:
    u<.62?5.:u<.7?6.:u<.76?7.:u<.94?8.:9.;
  vec2 a=shamanBoltPoint(cell,seed,reach);
  vec2 b=shamanBoltPoint(cell+1.,seed,reach);
  float bend=mix(a.y,b.y,clamp((u-shamanBoltU(cell))/(shamanBoltU(cell+1.)-shamanBoltU(cell)),0.,1.));
  float normal=sqrt(1.+pow(abs((b.y-a.y)/max(.0001,b.x-a.x)),2.));
  float d=(q.y-bend)/normal;
  float taper=width*pow(abs(max(.04,1.-u)),.6);
  taper*=.8+.2*sin(u*19.+seed);
  float ends=shamanFill(max(-q.x,q.x-reach));
  // A diffuse ion corona, never a hard blue outline around a white rod.
  float corona=exp(-abs(d)/max(shamanPixel*.8,taper*5.5));
  corona*=min(1.,taper/max(shamanPixel*.18,.0001));
  return vec2(shamanLine(d,taper),corona)*ends;
}
${SHAMAN_FIRE_GLSL}
vec4 shamanImpact(vec2 uv,float phase,float style,float variant,vec3 tint,float hdr) {
  vec2 p=uv-.5;
  shamanPixel=max(.00025,length(fwidth(p)));
  float t=clamp(phase,0.,1.);
  float edge=1.-smoothstep(.455,.48,max(abs(p.x),abs(p.y)));
  // Phase is uniform; UV coverage is not. Keep derivative evaluation outside
  // nonuniform early exits so edge antialiasing remains defined on all GPUs.
  if(t>=1.) return vec4(0.);
  float release=1.-exp(-t*13.);
  float alive=1.-smoothstep(.48,1.,t);
  float contact=1.-smoothstep(.075,.26,t);
  vec3 colour=vec3(0.);
  vec3 stoneColour=vec3(0.);
  vec3 material=vec3(.14,.48,.68);
  vec3 edgeColour=vec3(.64,.91,1.);
  float primary=0.,secondary=0.,fine=0.;
  float stoneOpacity=0.;
  float particleAngle=0.;
  if(style<1.5) {
    if(variant>7.5) {
      bool ward=variant<8.5;
      // Protective bowed charges and a rally crest have their own silhouettes.
      // Both use the same prepared sheet, never Arc Bolt's radial strike tree.
      for(int j=0;j<3;j++) {
        if(!ward&&j==2) continue;
        float i=float(j);
        vec2 q=ward?shamanLocal(p,shamanAxis(i*2.094+.18)):p;
        float u=clamp((q.y+.16)/.53,0.,1.);
        float side=j==0?-1.:1.;
        float bow=ward?.105+sin(u*3.14159)*.1:side*(.065+u*.3);
        float segment=u*13.,cell=floor(segment);
        float kink=mix(sin(cell*3.7+i),sin((cell+1.)*3.7+i),fract(segment))*sin(u*3.14159)*.008;
        float d=q.x-bow-kink;
        float ends=smoothstep(0.,.06,u)*(1.-smoothstep(.9,1.,u));
        float voltage=(1.-smoothstep(.2,.85,t))*ends;
        primary+=shamanLine(d,.0024)*voltage;
        secondary+=shamanLine(d,.016)*voltage*.48;
        float returnPulse=exp(-pow(abs((u-fract(t*1.8+i*.27))/.12),2.));
        fine+=shamanLine(d,.004)*returnPulse*voltage;
        if(!ward) {
          vec2 fork=shamanBolt(p-vec2(side*.22,.11),side<0.?2.6:.54,.18,113.+i*17.,.0018);
          fine+=fork.x*voltage*.7;secondary+=fork.y*voltage*.08;
        }
      }
    } else {
    bool canopy=variant>4.5&&variant<5.5;
    bool echo=variant>5.5&&variant<6.5,cleave=variant>6.5;
    // Connected lightning teeth fork from actual elbows. Broad blue channels
    // surround thin white conductors, with a short second discharge.
    float snap=1.-smoothstep(.12,.49,t);
    float restrike=exp(-pow(abs((t-.42)/.065),2.))*.74;
    float voltage=max(snap,restrike);
    float epoch=step(.32,t)*41.;
    float reach=.32+release*.115;
    float angleA=canopy?1.54:echo?.62:cleave?.09:-.12;
    float angleB=canopy?2.02:echo?3.72:cleave?3.23:2.88;
    vec2 a=shamanBolt(p,angleA,reach,4.+epoch,canopy?.0048:.0032);
    vec2 b=shamanBolt(p,angleB,reach*(canopy?.67:.87),19.+epoch,canopy?.0017:.0026);
    vec2 root=shamanBoltPoint(5.,4.+epoch,reach);
    vec2 axis=shamanAxis(angleA);
    root=axis*root.x+vec2(-axis.y,axis.x)*root.y;
    vec2 c=shamanBolt(p-root,canopy?.64:cleave?.42:.96,cleave?.11:.19,37.+epoch,.0025);
    vec2 rootB=shamanBoltPoint(3.,19.+epoch,reach*(canopy?.67:.87));
    axis=shamanAxis(angleB);
    rootB=axis*rootB.x+vec2(-axis.y,axis.x)*rootB.y;
    vec2 d=shamanBolt(p-rootB,canopy?2.45:cleave?3.57:4.12,cleave?.09:.18,53.+epoch,.0021);
    primary=(a.x+b.x+c.x*(echo?.3:.85)+d.x*(echo?.2:.65))*voltage;
    secondary=(a.y+b.y+c.y*.7+d.y*.5)*voltage*.38;
    // Fine rooted channels lace around the dominant pair. Unequal lengths
    // and delayed voltage leave air between the large flash and its filaments.
    vec2 e=shamanBolt(p,canopy?-.82:1.34,.29,67.,.0022);
    vec2 f=shamanBolt(p,canopy?3.9:4.91,.25,83.,.0018);
    primary+=(e.x*.38+f.x*.22)*voltage*(echo||cleave||canopy?.12:1.);
    secondary+=(e.y+f.y)*voltage*(echo||cleave||canopy?.02:.12);
    for(int j=0;j<6;j++) {
      if((echo&&j>1)||(cleave&&j>2)||(canopy&&j>3)) continue;
      float i=float(j),angle=j<3?angleA:angleB;
      float seed=(j<3?4.:19.)+epoch,span=j<3?reach:reach*(canopy?.67:.87);
      float elbow=j==0?2.:j==1?5.:j==2?8.:j==3?3.:j==4?6.:8.;
      vec2 r=shamanBoltPoint(elbow,seed,span),ax=shamanAxis(angle);
      r=ax*r.x+vec2(-ax.y,ax.x)*r.y;
      float turn=j==0?-.68:j==1?.81:j==2?1.04:-.9;
      vec2 fork=shamanBolt(p-r,angle+turn,.105+i*.007,101.+i*9.+epoch,.0012);
      fine+=fork.x*voltage*(.85+i*.06);
      secondary+=fork.y*voltage*.055;
    }
    fine+=shamanSliver(p,shamanAxis(.94),.105,.006)*contact;
    fine+=shamanSliver(p,shamanAxis(-.17),.17,.006)*contact;
    material=vec3(.055,.28,.95);
    edgeColour=vec3(.68,.86,1.);
    }
  } else if(style<2.5) {
    // A mineral collision splits thick planes, not green antlers. Their short
    // angular faces have recessed halves and a separate broken edge hierarchy.
    float base=variant<1.5?1.2:variant<2.5?-.18:variant<3.5?.08:.05;
    particleAngle=base;
    material=vec3(.14,.15,.11);
    edgeColour=vec3(.78,.84,.63);
    for(int j=0;j<15;j++) {
      float i=float(j),h=shamanHash(i+11.),h2=shamanHash(i+34.);
      float angle=base+(h-.5)*2.05;
      if(variant>2.5&&variant<3.5) angle=3.14159+(h-.5)*1.8;
      if(variant>3.5) angle=(j<4?.08:3.25)+(h-.5)*1.45;
      vec2 axis=shamanAxis(angle);
      float travel=.025+release*(j<3?.04+h*.15:.15+h2*.19);
      vec2 centre=axis*travel+vec2((h2-.5)*.08,(h-.5)*.04);
      centre.y-=t*t*.06;
      // Heavy mineral shoulders stay grounded; only fine chips climb the jet.
      if(variant<1.5&&j<8) {
        centre.x=(j<3?(i-1.)*.095:(h-.5)*.26)*(.45+release*.55);
        centre.y=j<3?-.035+release*.025:-.025+release*(.018+h*.065);
        centre.y-=t*t*.045;
      }
      float rockAngle=j<3?-.15+(h2-.5)*.38:h2*5.+t*(h-.5)*1.3;
      vec2 q=shamanLocal(p-centre,shamanAxis(rockAngle));
      float group=j<3?.62:j<8?.25+h*.13:.09+h*.12;
      vec2 size=vec2(.075+h*.055,.045+h2*.035)*group*(1.-t*.2);
      float dist=shamanStoneDistance(q,size,i+11.);
      float face=shamanFill(dist);
      stoneOpacity=max(stoneOpacity,face);
      float ridge=q.y+q.x*(.1+h*.65);
      float facet=smoothstep(-.004,.004,q.x-q.y*(.5+h));
      float lit=mix(.34,1.25,smoothstep(-.001,.001,ridge));
      float strata=.76+.16*sin((q.x+q.y*.37)*145.+i*2.);
      strata+=.06*sin((q.x*.42-q.y)*310.+i*1.3);
      float bevel=1.-smoothstep(.001,.009,-dist);
      float facing=smoothstep(-.025,.025,q.y-q.x*.6);
      vec3 faceColour=material*lit*strata*mix(.66,1.18,facet)*mix(1.,.48+facing*.76,bevel);
      // Treat the bevel as lit stone, not emissive wire. Composite each rock
      // front-to-back so buried edges cannot shine through the nearer face.
      faceColour+=vec3(.19,.17,.115)*bevel*facing*.34;
      // Two short stepped fractures, with no pixel noise on the planes.
      float crack=q.x+.016+step(0.,q.y)*.013;
      float fissure=shamanLine(crack,.002)*face;
      float crossCleft=shamanLine(q.y-q.x*.55+size.y*.15,.0012)*face;
      fissure=max(fissure,crossCleft*.65);
      faceColour*=1.-fissure*.52;
      float chipped=shamanLine(crack-.002,.0008)*.09;
      chipped+=shamanLine(q.x-q.y*.42-.031,.0009)*.045;
      faceColour+=vec3(.44,.39,.25)*chipped;
      stoneColour=mix(stoneColour,faceColour,face);
    }
    // Coarse crushing powder trails the hard splinters. Four uneven pressure
    // pockets share one smooth advected density, leaving air between their wakes.
    float powder=0.;
    float billow=shamanFlow(p*18.-vec2(t*.8,t*1.3));
    float powderDetail=shamanFlow(p*39.+vec2(billow*2.,-t*2.));
    for(int j=0;j<4;j++) {
      float i=float(j),h=shamanHash(i+153.);
      float angle=variant>3.5?(j<2?.12:3.03):variant<1.5?(j<2?.18:2.98):base+(h-.5)*1.2;
      vec2 axis=shamanAxis(angle);
      vec2 centre=axis*(.05+release*(.09+h*.15));
      if(variant>3.5) centre.y-=.055;
      vec2 dq=shamanLocal(p-centre,axis);
      vec2 size=vec2(.14+release*.105,.035+h*.035+release*.025);
      float shape=max(0.,1.-dot(dq/size,dq/size));
      powder=max(powder,smoothstep(.12,.58,shape*(.48+billow*.52)-powderDetail*.24));
    }
    float streaks=.72+.28*sin(p.x*91.+p.y*37.-t*4.+billow*3.);
    float powderAlpha=powder*.43*streaks*smoothstep(.025,.22,t)*(1.-smoothstep(.55,1.,t));
    vec3 powderColour=mix(vec3(.095,.087,.065),vec3(.36,.34,.27),billow);
    stoneColour+=powderColour*powderAlpha*(1.-stoneOpacity);
    stoneOpacity+=powderAlpha*(1.-stoneOpacity);
    // The pressure front is broken into two jagged lips, never a full circle.
    vec2 q=shamanLocal(p,shamanAxis(base));
    float span=.2+release*.19;
    float u=clamp(abs(q.x)/span,0.,1.);
    float lip=.028+u*u*.1+abs(sin(u*11.))*.018;
    float ends=1.-smoothstep(.74,1.,u);
    secondary+=shamanLine(q.y-lip,.002)*ends*contact*.36;
    secondary+=shamanLine(q.y+lip*.63,.0015)*ends*contact*.3;
    primary+=shamanSliver(p,shamanAxis(base),.19,.012)*contact;
  } else if(style<3.5) {
    material=vec3(.95,.105,.008);
    edgeColour=vec3(1.,.64,.13);
    colour+=shamanFire(p,t,release,contact,variant);
  } else if(style<4.5) {
    // Three unequal pressure faces break apart through the wound. Short deep
    // facets and dark cross-sections replace giant flat strips of blue paper.
    material=vec3(.026,.19,.33);
    edgeColour=vec3(.58,.93,1.);
    for(int j=0;j<12;j++) {
      float i=float(j),h=shamanHash(i+44.),h2=shamanHash(i+63.);
      float angle=j==0?.88:j==1?-.38:j==2?2.02:h*6.28318;
      vec2 axis=shamanAxis(angle);
      vec2 centre=j<3?axis*(.025+release*.075):axis*(.02+release*(.17+h2*.16));
      vec2 q=shamanLocal(p-centre,shamanAxis(angle+(h2-.5)*t*.9));
      float group=j==0?1.25:j<3?.9:.22+h2*.25;
      float reach=(.10+h*.055)*group,width=(.045+h2*.043)*group;
      float u=q.x/reach;
      float taper=j<3?max(.12,1.-abs(u)*.8):max(0.,1.-u);
      float chips=shamanFlow(q*vec2(95.,63.)+i)*.004;
      float upper=q.y-width*taper*.6+chips;
      float lower=-q.y-width*taper*(.24+h*.36)+chips*.7;
      float base=-q.x-reach*(j<3?.85:.32+h2*.2)+q.y*(h-.5)*.8;
      float dist=max(max(upper,lower),max(base,q.x-reach));
      dist=max(dist,-q.x-reach*(j<3?.8:.28)-q.y*.7);
      float face=shamanFill(dist);
      float split=shamanLine(q.x+q.y*.7-reach*.13,.002);
      split=max(split,shamanLine(q.x-q.y*1.1+reach*.42,.0014));
      face*=1.-split*.85;
      float ridge=q.y+width*taper*.08;
      float bevel=smoothstep(-.002,.002,ridge);
      float thickness=.09+.3*bevel;
      float innerVein=shamanLine(q.y+q.x*.29-width*.2,.0011)*face;
      float facet=smoothstep(-.004,.004,q.x+q.y*.4);
      vec3 iceColour=material*thickness*mix(.32,1.35,facet)+vec3(.04,.19,.28)*innerVein;
      // A refracted-looking split in the shaded face preserves crystalline depth.
      iceColour+=vec3(.12,.35,.42)*pow(max(0.,1.-abs(q.y)/max(.003,width)),5.)*.3;
      // Only the forward bevel is bright. Dark blue bases supply depth.
      primary+=shamanLine(upper,.0015)*face*(.36+h*.2);
      secondary+=shamanLine(ridge,.0013)*face*.34;
      fine+=shamanLine(q.x-q.y*.75+sin(q.y*58.+i)*.006,.0008)*face*.3;
      fine+=shamanLine(q.x+q.y*.5-reach*.38,.0008)*face*.19;
      float inner=shamanLine(q.y-width*taper*.31,.003)*face;
      iceColour+=vec3(.065,.26,.38)*inner*.18;
      stoneColour=mix(stoneColour,iceColour,face);
      stoneOpacity=max(stoneOpacity,face*.88);
    }
    vec2 q=p;
    float x=abs(q.x),curve=.022+x*x*1.3;
    float end=1.-smoothstep(.23,.38,x);
    secondary+=shamanLine(q.y+curve,.002)*end*contact*.3;
    primary+=shamanSliver(p,shamanAxis(.08),.13,.015)*contact;
  } else {
    // One broad pressure bow, followed by two unequal rolling vortices.
    // The clear body carries force while condensed edges carry detail.
    material=vec3(.035,.36,.38);
    edgeColour=vec3(.67,1.,.94);
    particleAngle=.13;
    vec2 wind=shamanLocal(p,shamanAxis(.13));
    float span=.27+release*.14;
    float along=clamp((wind.x+span)/(2.*span),0.,1.);
    float bow=sin(along*3.14159)*.13-.055;
    float envelope=sin(along*3.14159);
    float width=.009+envelope*.037;
    float d=wind.y-bow;
    float front=shamanFill(abs(d)-width)*envelope;
    float pressure=shamanFlow(wind*vec2(17.,34.)+vec2(-t*2.,t));
    colour+=material*front*(.09+.3*smoothstep(-width,width,d))*(.65+pressure*.35);
    primary+=shamanLine(d-width,.0018)*envelope*(.4+.6*contact)*(.6+pressure*.4);
    secondary+=shamanLine(d+width*.55,.0012)*envelope*.24;
    for(int j=0;j<6;j++) {
      float i=float(j),bank=j<3?0.:1.;
      vec2 centre=vec2(bank<.5?-.13:.17,bank<.5?-.025:-.075);
      centre+=vec2((bank<.5?-1.:1.)*release*.045,-release*.035);
      vec2 q=wind-centre;
      float a=atan(q.y,q.x)+3.14159;
      float radius=.018+a*(bank<.5?.009:.006)+(i-bank*3.)*.007;
      radius+=sin(a*2.2+i+t*3.)*.005;
      radius*=.8+release*.3;
      float curl=length(q)-radius;
      float gate=smoothstep(.15,.9,a)*(1.-smoothstep(3.5+i*.22,5.1+i*.13,a));
      gate*=smoothstep(-.45,.35,sin(a*1.8+i*1.7-t*2.5));
      gate*=.5+.5*shamanFlow(q*34.+vec2(t*1.4,-t));
      float density=exp(-abs(curl)/.008)*gate;
      colour+=material*density*.14;
      secondary+=shamanLine(curl,.0012)*gate*.18;
      fine+=shamanLine(curl+.003,.0007)*gate*.12;
    }
    primary+=shamanSliver(p,shamanAxis(.16),.15,.009)*contact;
  }
  // Eighteen individually moving fragments in three size bands. Hashes pick
  // fixed trajectories; they never texture or flicker across a surface.
  float particles=0.,trails=0.;
  for(int j=0;j<18;j++) {
    float i=float(j),h=shamanHash(i+71.),h2=shamanHash(i+109.);
    float angle=particleAngle+(j<11?0.:3.14159)+(h-.5)*2.7;
    if(style<1.5) angle=h*6.28318;
    if(style>2.5&&style<4.5) angle=h*5.8+.2;
    vec2 axis=shamanAxis(angle);
    float depart=max(0.,t-h2*.055);
    float travel=.035+(.16+h*.25)*(1.-exp(-depart*(5.+h2*5.)));
    vec2 centre=axis*travel;
    if(style>1.5&&style<2.5) centre.y-=depart*depart*.18;
    if(style>2.5&&style<3.5) centre.y+=depart*depart*.11;
    if(style>3.5&&style<4.5) centre.y-=depart*depart*.13;
    if(style>4.5) centre.x+=depart*.09;
    float reach=(j<4?.018:j<10?.01:.005)*(1.-t*.3);
    float width=j<4?.0045:j<10?.0028:.0018;
    if(style<1.5) { reach*=1.7; width*=.62; }
    float life=(1.-smoothstep(.42+h2*.2,.95,t));
    particles+=shamanSliver(p-centre,axis,reach,width)*life;
    trails+=shamanSliver(p-centre+axis*reach*1.8,axis,reach*2.,width*.34)*life*.18;
  }
  // Pigmented broad shapes stay below bloom; only narrow contact edges and
  // hot fragments receive the strong exposure. Never turn the whole hit white.
  if(style<1.5) {
    colour+=vec3(.035,.26,1.25)*(secondary*1.65+trails);
    float ionCloud=exp(-dot(p*vec2(1.,1.4),p*vec2(1.,1.4))*170.);
    colour+=vec3(.025,.14,.42)*ionCloud*contact;
    colour+=vec3(.76,.94,1.)*primary*.95;
    colour+=vec3(.22,.66,1.)*(fine*.65+particles*.8);
  } else colour+=edgeColour*(primary*.82+secondary*.46+fine*.32+particles*.66+trails);
  colour+=mix(edgeColour,vec3(1.),.8)*exp(-dot(p,p)*1900.)*contact*.72;
  colour*=mix(vec3(1.),max(tint,vec3(.35)),.14)*max(0.,hdr);
  if((style>1.5&&style<2.5)||(style>3.5&&style<4.5)) {
    // The mineral body is reflected rock, so increased impact exposure lifts
    // its broken edges without bleaching every stone face into luminous glass.
    colour+=stoneColour;
    // Coverage is confined to solid mineral faces and fine luminous strokes.
    // No transparent rectangle or broad dust veil can darken the battlefield.
    float strokes=clamp(primary+secondary+fine+particles+trails,0.,1.);
    float alpha=max(stoneOpacity,strokes);
    return vec4(colour/max(.0001,alpha),alpha*edge*alive);
  }
  return vec4(colour,edge*alive);
}
`;
