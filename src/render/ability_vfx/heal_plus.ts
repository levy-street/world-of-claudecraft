/** The healing plus, shared by every heal's visuals: a stylised cross with
 * rounded arms and softly filled inner corners (a smooth union of two bars),
 * so it reads as "health" at a glance without looking like a medical sign.
 *
 * `healPlusDist(p)` is the signed distance in plus space (arms reach ±0.92);
 * `healPlus(p)` shades it: a lit body, a bright rim, a hot heart and a soft
 * outer glow, for additive blending. `healPlusQuad(p)` draws it in a quad
 * (p in [-1, 1]) with room for that glow to fade out before the quad's edge;
 * such quads are HEAL_PLUS_QUAD times the plus's own half-size. */
export const HEAL_PLUS_QUAD = 1.5 / 1.08;
export const HEAL_PLUS_GLSL = `
  float healPlusBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }
  float healPlusDist(vec2 p) {
    float a = healPlusBox(p, vec2(0.86, 0.24));
    float b = healPlusBox(p, vec2(0.24, 0.86));
    float k = 0.28;
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h) - 0.06;
  }
  float healPlus(vec2 p) {
    float d = healPlusDist(p);
    float body = 1.0 - smoothstep(-0.02, 0.02, d);
    float rim = exp(-abs(d) * 22.0);
    float heart = exp(-dot(p, p) * 7.0);
    float glow = exp(-max(d, 0.0) * 7.0) * 0.3;
    return body * (0.45 + 0.45 * heart) + rim * 0.8 + glow;
  }
  float healPlusQuad(vec2 p) {
    return healPlus(p * 1.5) * (1.0 - smoothstep(0.8, 1.0, max(abs(p.x), abs(p.y))));
  }
`;
