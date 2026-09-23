/** Shaman-only open liquid surfaces in the existing twelve-instance pool.
 * Profiles: 1 receiving sheet, 2 rising cascade, 3 falling cascade, 4 full river. Legacy
 * streams/poisons retain profile zero. No textures or additional draw calls. */
export type ShamanWaterFlow = 0 | 1 | 2 | 3 | 4;

/** Shared authoring curve for the river body and its foam rails. The late crest
 * produces a long gathering rise and a steep receiving waterfall. */
export function shamanCascadeLift(horizontal: number): number {
  return Math.min(3.7, 0.95 + horizontal * 0.35);
}
export function shamanCascadeArch(u: number): number {
  return Math.sin(u * Math.PI) * (0.65 + u * 0.7);
}

const SHAMAN_WATER_TRANSPORT = `
  float shamanWaterU(float u,float age,float flow,float motion) {
    return flow < 1.5 ? mix(u,1.0,smoothstep(.1,.78,age)*.78*motion) : u;
  }
`;

export const SHAMAN_WATER_VERTEX = `
  ${SHAMAN_WATER_TRANSPORT}
  attribute float aFlow;
  varying float vFlow;
  vec3 shamanWaterPoint(float u, float across, float age) {
    // Transport the receiving crest toward its low endpoint, then collapse
    // into runoff. A stationary fully raised curtain cannot read as liquid.
    u = shamanWaterU(u,age,aFlow,uMotion);
    vec3 delta = aTo - aFrom;
    float horizontal = length(delta.xz);
    vec3 forward = horizontal > 0.001 ? vec3(delta.x, 0.0, delta.z) / horizontal : vec3(0.0,0.0,1.0);
    vec3 side = vec3(forward.z, 0.0, -forward.x);
    vec3 center;
    if (aFlow > 3.5) {
      float arch = sin(u*PI)*(.65+u*.7);
      center = mix(aFrom,aTo,u);
      float drain = 1.0-smoothstep(.34,.96,age)*.75*uMotion;
      center.y += min(3.7,.95+horizontal*.35)*arch*drain;
      center += side*sin(u*PI)*sin(u*3.7)*.14;
    } else if (aFlow > 1.5) {
      // Both halves share a horizontal tangent at the crest. There is no
      // second automatic arch superimposed on the authored waterfall.
      vec3 m0 = aFlow < 2.5 ? delta * 0.9 : forward * max(0.2, horizontal * 0.9);
      vec3 m1 = aFlow < 2.5 ? forward * max(0.2, horizontal * 0.65) : delta * 1.3;
      float u2 = u*u, u3 = u2*u;
      center = (2.0*u3-3.0*u2+1.0)*aFrom + (u3-2.0*u2+u)*m0
             + (-2.0*u3+3.0*u2)*aTo + (u3-u2)*m1;
    } else {
      center = mix(aFrom, aTo, u);
      center += forward * sin(u*PI) * (0.22 + abs(delta.y)*0.09);
      center += side * sin(u*PI) * horizontal * .24;
    }
    vec3 tangent = delta / max(0.0001,length(delta));
    vec3 normal = normalize(cross(side, tangent));
    float clock = age * uMotion;
    float wave = sin(u*7.0-clock*6.0+across*1.1);
    float envelope = pow(max(0.0,sin(clamp(u,0.0,1.0)*PI)),0.3);
    float rootWidth = aFlow > 3.5 ? aLife.z : aFlow > 1.5 ? mix(aLife.z,0.35,aFlow < 2.5 ? u : 1.0-u) : aLife.z;
    float width = rootWidth * (aFlow > 3.5 ? 2.7 : aFlow > 1.5 ? 1.65 : 3.2);
    float fan = aFlow < 1.5 ? .28+.94*pow(max(0.,sin(u*PI)),.75) : 0.65 + 0.35*envelope;
    // A partial curling wave has actual depth. Its thick moving crest rolls
    // across an open, transparent film instead of flapping like woven cloth.
    float front = .12 + clock*.88;
    float crest = exp(-pow(abs((u-front)/.18),2.));
    float roll = across*(1.05+crest*.65) + wave*.11*envelope;
    if (aFlow < 3.5) center += side * sin(u*PI) * sin(u*3.7-clock*2.2) * .14;
    center += normal * width * crest * envelope * .38;
    return center + side * sin(roll) * width * fan
      + normal * envelope * width * ((1.0-cos(roll))*.82 + wave*.075);

  }
`;

export const SHAMAN_WATER_FRAGMENT = `
  ${SHAMAN_WATER_TRANSPORT}
  varying float vFlow;
  vec4 shamanWaterSurface(vec3 normal, vec3 viewDirection, vec3 lightDirection) {
    float across = vUv.y*2.0-1.0;
    float flowU = shamanWaterU(vUv.x,vAge,vFlow,uMotion);
    float phase = flowU*10.0-vAge*8.0*uMotion;
    float bend = sin(phase*.47)*.16;
    float channels = sin((across+bend)*9.0 + sin(phase*.35)*.45);
    float ripples = sin(phase+across*1.4);
    float front = .12+vAge*uMotion*.88;
    float crest = exp(-pow(abs((flowU-front)/.075),2.));
    float edge = 1.0-smoothstep(.76,1.0,abs(across)+ripples*.035);
    float lace = smoothstep(-.82,-.12,channels+sin(phase*.8)*.25);
    float tail = smoothstep(.32,.95,flowU);
    float membrane = mix(1.0,.22+.78*lace,tail*.65);
    float fresnel = pow(max(0.0,1.0-abs(dot(normal,viewDirection))),2.5);
    // Foam collects on the meniscus and converging runnels. No crosshatch
    // across the liquid body: the central channel carries clear dark depth.
    float foam = crest*(.45+.55*pow(max(0.,channels),3.));
    float runnel = pow(max(0.,channels),14.)*(.22+crest*.65);
    float channelDepth = exp(-pow(abs((across-bend)/.46),2.));
    vec3 halfVector = normalize(lightDirection+viewDirection+vec3(0.00001));
    vec3 flowingNormal = normalize(normal + vec3(channels*0.11,ripples*0.07,sin(phase*.73)*0.09));
    float specular = pow(max(0.0,abs(dot(flowingNormal,halfVector))),72.0);
    float glint = pow(max(0.0,sin(phase*1.6+across*5.0)),24.0)*runnel;
    // The signature river has multiple sliding menisci and fine descending
    // rivulets. Most of its surface stays deep jade instead of washing white.
    if (vFlow > 3.5) {
      float current = flowU*24.0-vAge*18.0*uMotion;
      float filaments = pow(max(0.0,sin(across*21.0+sin(current*.27)*.6)),18.0);
      float beads = pow(max(0.0,sin(current+across*7.0)),12.0);
      float lip = exp(-pow(abs((abs(across)-.72)/.075),2.0));
      foam += lip*(.28+beads*.55)+filaments*beads*.38;
      runnel += filaments*smoothstep(.38,.85,flowU)*.65;
      glint += filaments*beads*.38;
    }
    float light = abs(dot(normal,lightDirection));
    vec3 body = vTint*(.8+.65*light)*(1.-channelDepth*.45)*( .88+.12*ripples);
    vec3 colour = body + vAccent*(fresnel*.42+foam*1.25+runnel*.25+specular*.85+glint*.4);
    float entry = smoothstep(0.0,0.085,vAge);
    float recession = 1.0-smoothstep(0.62-vUv.x*0.1,1.0-vUv.x*0.07,vAge);
    float alpha = (.24+channelDepth*.17+fresnel*.24+foam*.3+runnel*.06)*edge*membrane*entry*recession;
    // Individual receiving sheets dissolve into irregular runoff rather than
    // exposing a rectangular mesh edge. Primary cascade joins stay connected.
    if (vFlow < 1.5) {
      float raggedEnd = vUv.x + sin(across*8.0+phase*0.3)*0.045;
      alpha *= smoothstep(0.0,0.07,vUv.x)*(1.0-smoothstep(0.79,1.0,raggedEnd));
    }
    colour = sceneRefract(colour,normal.xy*2.5*uMotion,vView.z,(1.0-fresnel)*0.2*uMotion);
    return vec4(colour,alpha*sceneSoftness(vView.z,0.25));
  }
`;
