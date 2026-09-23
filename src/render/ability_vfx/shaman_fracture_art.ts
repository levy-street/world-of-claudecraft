// One prepared cel: large broken mineral faces, a hot contact seam, then many
// smaller ballistic splinters. Detail is authored above one texel so it survives
// the existing 128px atlas at gameplay distance without larger GPU textures.
const noise = (n: number) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const ink = (rgb: string, alpha: number) => `rgba(${rgb},${Math.max(0, Math.min(1, alpha))})`;

export function paintShamanFractureBurst(g: CanvasRenderingContext2D, t: number): void {
  const open = 0.48 + 0.52 * (1 - (1 - t) ** 5);
  const body = (1 - t) ** 1.35;
  const hit = Math.exp(-((t / 0.37) ** 3));
  g.lineJoin = 'miter';
  g.lineCap = 'butt';
  // Five unequal sheared planes. The dark recessed side and pale fresh edge are
  // painted together, not a uniform cloud of equally weighted pebbles.
  for (let k = 0; k < 5; k++) {
    const angle = [-2.95, -2.26, -1.48, -0.58, 0.13][k];
    const reach = (k === 2 ? 56 : 38 + noise(k + 91) * 17) * open;
    const width = (k === 2 ? 9 : 5 + noise(k + 21) * 4) * (1 - t * 0.55);
    g.save();
    g.rotate(angle);
    g.translate(3 + t * 5, 0);
    const face = g.createLinearGradient(0, 0, reach, 0);
    face.addColorStop(0, ink('219,244,197', body * 0.78));
    face.addColorStop(0.19, ink('124,161,115', body * 0.7));
    face.addColorStop(0.48, ink('69,101,86', body * 0.6));
    face.addColorStop(1, ink('58,85,80', body * 0.08));
    g.fillStyle = face;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(reach * 0.24, -width * 0.75);
    g.lineTo(reach * 0.48, -width);
    g.lineTo(reach * 0.63, -width * 0.52);
    g.lineTo(reach, -width * 0.22);
    g.lineTo(reach * 0.71, width * 0.23);
    g.lineTo(reach * 0.47, width * 0.62);
    g.lineTo(reach * 0.17, width * 0.3);
    g.closePath();
    g.fill();
    // Hard broken edge, with staggered transverse cleavage lines and bright
    // fragments separating from the same edge as the sheet opens.
    g.strokeStyle = ink('245,255,216', hit * 0.92 + body * 0.18);
    g.lineWidth = k === 2 ? 1.8 : 1.25;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(reach * 0.24, -width * 0.75);
    g.lineTo(reach * 0.48, -width);
    g.lineTo(reach * 0.63, -width * 0.52);
    g.lineTo(reach, -width * 0.22);
    g.stroke();
    for (let j = 0; j < 5; j++) {
      const u = 0.19 + j * 0.135;
      g.strokeStyle = ink(j % 2 ? '51,80,71' : '201,235,185', body * 0.82);
      g.lineWidth = j % 2 ? 1.5 : 0.95;
      g.beginPath();
      g.moveTo(reach * u, -width * (0.3 + noise(k * 19 + j) * 0.4));
      g.lineTo(reach * (u + 0.065), width * 0.2);
      g.lineTo(reach * (u + 0.09), width * 0.34);
      g.stroke();
    }
    g.restore();
  }
  // A broken compression seam at the point of contact. No expanding disc.
  g.strokeStyle = ink('255,255,235', hit);
  g.lineWidth = 2.8 * (1 - t * 0.65);
  g.beginPath();
  g.moveTo(-24 * open, 4);
  g.lineTo(-11 * open, 1);
  g.lineTo(-4, -2);
  g.lineTo(2, 1);
  g.lineTo(12 * open, -1);
  g.lineTo(31 * open, 5);
  g.stroke();
  // Mixed-size chips: three lit faces and a hard rim make them read as mineral,
  // while the thin trails link each shard visibly to the originating impact.
  for (let k = 0; k < 66; k++) {
    const angle = -Math.PI + noise(k + 241) * (Math.PI + 0.65);
    const travel = 0.24 + 0.76 * (1 - (1 - t) ** 3);
    const radius = (9 + noise(k + 671) * 44) * travel;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * 0.83 + t * t * 13;
    const size = k < 9 ? 2.5 + noise(k + 14) * 2.8 : 0.8 + noise(k + 14) * 1.6;
    const fade = body * (0.48 + noise(k + 80) * 0.5);
    g.strokeStyle = ink('185,221,172', fade * 0.45);
    g.lineWidth = k < 9 ? 1.15 : 0.8;
    g.beginPath();
    g.moveTo(x * 0.73, y * 0.73);
    g.lineTo(x, y);
    g.stroke();
    g.save();
    g.translate(x, y);
    g.rotate(angle + t * (noise(k + 6) - 0.5) * 3);
    g.fillStyle = ink('91,128,109', fade);
    g.beginPath();
    g.moveTo(-size, -size * 0.35);
    g.lineTo(size * 0.6, -size * 0.8);
    g.lineTo(size, size * 0.25);
    g.lineTo(-size * 0.35, size * 0.6);
    g.closePath();
    g.fill();
    g.fillStyle = ink('209,235,179', fade);
    g.beginPath();
    g.moveTo(-size, -size * 0.35);
    g.lineTo(size * 0.6, -size * 0.8);
    g.lineTo(size * 0.18, size * 0.05);
    g.closePath();
    g.fill();
    g.strokeStyle = ink('249,255,224', fade);
    g.lineWidth = k < 9 ? 1.2 : 0.8;
    g.beginPath();
    g.moveTo(-size, -size * 0.35);
    g.lineTo(size * 0.6, -size * 0.8);
    g.stroke();
    g.restore();
  }
  // Fine late fallout fills the spaces BETWEEN hero planes instead of hiding
  // them with a uniform fog layer. Stable seed means continuous trajectories.
  for (let k = 0; k < 105; k++) {
    const a = noise(k + 993) * Math.PI * 2;
    const radius = (6 + noise(k + 404) * 48) * open;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius * 0.5 + t * t * 11;
    g.fillStyle = ink(k % 4 ? '155,190,151' : '240,254,213', body * (0.28 + noise(k + 8) * 0.5));
    g.beginPath();
    g.ellipse(x, y, 0.55 + noise(k + 18) * 0.65, 0.45, a, 0, Math.PI * 2);
    g.fill();
  }
}
