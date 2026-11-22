/** Shared Paladin rune band for ground circles (Dawnfall, Final Edict).
 * `paladinRuneRing(p, inner, outer)` draws two border circles and a ring of
 * upright glyphs between them. Cell count follows the band's circumference
 * and height, so every circle spaces its runes the same way at any size. */
export const PALADIN_RUNE_GLSL = `
  float runeSq(float x) { return x * x; }
  float runeSeg(vec2 p, vec2 a, vec2 b) {
    vec2 e = b - a;
    return length(p - a - e * clamp(dot(p - a, e) / dot(e, e), 0.0, 1.0));
  }
  // Eight staves in glyph space: x across the cell, y from base (0) to top (1).
  float runeGlyph(vec2 g, float id) {
    float d;
    if (id < 0.5) {
      d = min(runeSeg(g, vec2(-0.12, 0.0), vec2(-0.12, 1.0)), runeSeg(g, vec2(-0.12, 0.55), vec2(0.2, 0.85)));
      d = min(d, runeSeg(g, vec2(-0.12, 0.3), vec2(0.2, 0.6)));
    } else if (id < 1.5) {
      d = min(runeSeg(g, vec2(-0.2, 0.0), vec2(-0.2, 1.0)), runeSeg(g, vec2(-0.2, 1.0), vec2(0.2, 0.72)));
      d = min(d, runeSeg(g, vec2(0.2, 0.72), vec2(0.2, 0.0)));
    } else if (id < 2.5) {
      d = min(runeSeg(g, vec2(0.0, 0.0), vec2(0.0, 1.0)), runeSeg(g, vec2(0.0, 1.0), vec2(-0.22, 0.72)));
      d = min(d, runeSeg(g, vec2(0.0, 1.0), vec2(0.22, 0.72)));
    } else if (id < 3.5) {
      d = min(runeSeg(g, vec2(0.0, 0.0), vec2(0.0, 1.0)), runeSeg(g, vec2(0.0, 0.55), vec2(-0.24, 0.92)));
      d = min(d, runeSeg(g, vec2(0.0, 0.55), vec2(0.24, 0.92)));
    } else if (id < 4.5) {
      d = min(runeSeg(g, vec2(-0.14, 0.0), vec2(-0.14, 1.0)), runeSeg(g, vec2(-0.14, 0.75), vec2(0.18, 0.5)));
      d = min(d, runeSeg(g, vec2(0.18, 0.5), vec2(-0.14, 0.25)));
    } else if (id < 5.5) {
      d = min(runeSeg(g, vec2(-0.22, 0.05), vec2(0.22, 0.95)), runeSeg(g, vec2(0.22, 0.05), vec2(-0.22, 0.95)));
    } else if (id < 6.5) {
      d = min(runeSeg(g, vec2(0.16, 1.0), vec2(-0.16, 0.62)), runeSeg(g, vec2(-0.16, 0.62), vec2(0.16, 0.38)));
      d = min(d, runeSeg(g, vec2(0.16, 0.38), vec2(-0.16, 0.0)));
    } else {
      d = min(runeSeg(g, vec2(0.0, 0.0), vec2(0.22, 0.5)), runeSeg(g, vec2(0.22, 0.5), vec2(0.0, 1.0)));
      d = min(d, min(runeSeg(g, vec2(0.0, 1.0), vec2(-0.22, 0.5)), runeSeg(g, vec2(-0.22, 0.5), vec2(0.0, 0.0))));
    }
    return d;
  }
  float paladinRuneRing(vec2 p, float inner, float outer) {
    float r = length(p);
    float height = outer - inner;
    float mid = (inner + outer) * 0.5;
    // Cells about two-thirds as wide as the band is tall.
    float count = floor(6.2831853 * mid / (0.67 * height));
    float cell = (atan(p.y, p.x) / 6.2831853 + 0.5) * count;
    float index = floor(cell);
    float glyphHeight = height * 0.52;
    vec2 g = vec2(
      (fract(cell) - 0.5) * (6.2831853 * mid / count) / glyphHeight,
      (r - inner - height * 0.24) / glyphHeight
    );
    float id = mod(index * 5.0 + floor(index / 8.0) * 3.0, 8.0);
    float glyph = 1.0 - smoothstep(0.045, 0.08, runeGlyph(g, id));
    float border = exp(-runeSq((r - outer) / (height * 0.07)));
    border += exp(-runeSq((r - inner) / (height * 0.05))) * 0.75;
    return border + glyph * 0.9;
  }
`;
