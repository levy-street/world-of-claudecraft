/** Approved Dawnreaver spear-and-halo outline shared by shield and ground effects. */
export const DAWNREAVER_EMBLEM_GLSL = `
        float stroke(vec2 p, vec2 a, vec2 b) {
          vec2 edge=b-a;
          return length(p-a-edge*clamp(dot(p-a,edge)/dot(edge,edge),0.0,1.0));
        }
        // Detailed mood-board spear, inner blade, flared wings and sun halo.
        float dawnreaverOutline(vec2 p) {
          p.x=abs(p.x);
          float d=stroke(p,vec2(0.0,-0.94),vec2(0.045,-0.64));
          d=min(d,stroke(p,vec2(0.045,-0.64),vec2(0.105,0.16)));
          d=min(d,stroke(p,vec2(0.105,0.16),vec2(0.0,0.91)));
          d=min(d,stroke(p,vec2(0.0,-0.72),vec2(0.032,0.14)));
          d=min(d,stroke(p,vec2(0.032,0.14),vec2(0.0,0.58)));
          d=min(d,stroke(p,vec2(0.0,0.91),vec2(0.19,0.51)));
          d=min(d,stroke(p,vec2(0.19,0.51),vec2(0.35,0.35)));
          d=min(d,stroke(p,vec2(0.35,0.35),vec2(0.59,0.27)));
          d=min(d,stroke(p,vec2(0.59,0.27),vec2(0.33,0.30)));
          d=min(d,stroke(p,vec2(0.33,0.30),vec2(0.17,0.46)));
          d=min(d,stroke(p,vec2(0.17,0.46),vec2(0.30,0.09)));
          d=min(d,stroke(p,vec2(0.30,0.09),vec2(0.16,0.32)));
          d=min(d,stroke(p,vec2(0.16,0.32),vec2(0.0,0.91)));
          float halo=abs(length(p-vec2(0.0,-0.10))-0.51);
          return min(d,halo);
        }
`;

/** Filled blade and wings; the surrounding sun halo retains its open centre. */
export const DAWNREAVER_SOLID_GLSL = `
  ${DAWNREAVER_EMBLEM_GLSL}
  float emblemCrossing(vec2 p, vec2 a, vec2 b) {
    if ((a.y>p.y)==(b.y>p.y)) return 0.0;
    return p.x<a.x+(p.y-a.y)*(b.x-a.x)/(b.y-a.y)?1.0:0.0;
  }
  float dawnreaverSolid(vec2 p) {
    p.x=abs(p.x);
    float width;
    if(p.y< -0.64) width=mix(0.0,0.045,clamp((p.y+0.94)/0.30,0.0,1.0));
    else if(p.y<0.16) width=mix(0.045,0.105,(p.y+0.64)/0.80);
    else width=mix(0.105,0.0,clamp((p.y-0.16)/0.75,0.0,1.0));
    float blade=(1.0-smoothstep(width,width+0.012,p.x))*step(-0.94,p.y)*step(p.y,0.91);
    float crossings=emblemCrossing(p,vec2(0.0,0.91),vec2(0.19,0.51));
    crossings+=emblemCrossing(p,vec2(0.19,0.51),vec2(0.35,0.35));
    crossings+=emblemCrossing(p,vec2(0.35,0.35),vec2(0.59,0.27));
    crossings+=emblemCrossing(p,vec2(0.59,0.27),vec2(0.33,0.30));
    crossings+=emblemCrossing(p,vec2(0.33,0.30),vec2(0.17,0.46));
    crossings+=emblemCrossing(p,vec2(0.17,0.46),vec2(0.30,0.09));
    crossings+=emblemCrossing(p,vec2(0.30,0.09),vec2(0.16,0.32));
    crossings+=emblemCrossing(p,vec2(0.16,0.32),vec2(0.0,0.91));
    float wings=mod(crossings,2.0);
    float edge=1.0-smoothstep(0.008,0.018,dawnreaverOutline(p));
    return max(max(blade,wings),edge);
  }
`;
