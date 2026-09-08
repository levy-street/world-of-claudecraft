/** One complete, asymmetric bedrock fracture drawing. All branches share one
 * ground-decal owner, so attack-ribbon pressure cannot tear the drawing apart. */
export function paintWarriorFracture(g: CanvasRenderingContext2D, size: number): void {
  const unit = size / 12;
  g.save();
  g.translate(size / 2, size / 2);
  g.lineJoin = 'bevel';
  g.lineCap = 'butt';
  for (let branch = 0; branch < 8; branch++) {
    const angle = (branch * Math.PI) / 4 + Math.sin(branch * 3.7) * 0.065;
    const dx = Math.sin(angle),
      dy = Math.cos(angle);
    const points: [number, number][] = [];
    for (let j = 0; j < 13; j++) {
      const u = j / 12,
        radius = 1.45 + 4.5 * u;
      const jag = Math.sin(u * 24 + branch) * Math.sin(u * Math.PI) * 0.17;
      points.push([(dx * radius + dy * jag) * unit, (dy * radius - dx * jag) * unit]);
    }
    // Broad dark fissure and a thin illuminated broken lip. The texture holds
    // its own value hierarchy instead of inheriting a generic white glow.
    for (let layer = 0; layer < 3; layer++) {
      g.strokeStyle = ['#332e29', '#c4b9a0', '#665e52'][layer];
      g.lineWidth = [0.23, 0.075, 0.1][layer] * unit;
      g.beginPath();
      for (let j = 0; j < points.length; j++) {
        const offset = layer === 1 ? 0.09 * unit : 0;
        const x = points[j][0] + dy * offset,
          y = points[j][1] - dx * offset;
        if (j === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // Unequal forklets leave open rock between the large faults.
    for (const j of [5, 8]) {
      const p = points[j],
        side = (branch + j) % 2 ? 1 : -1;
      g.strokeStyle = '#8a806d';
      g.lineWidth = 0.065 * unit;
      g.beginPath();
      g.moveTo(p[0], p[1]);
      g.lineTo(
        p[0] + (dx * 0.22 + dy * side * 0.32) * unit,
        p[1] + (dy * 0.22 - dx * side * 0.32) * unit,
      );
      g.lineTo(
        p[0] + (dx * 0.62 + dy * side * 0.5) * unit,
        p[1] + (dy * 0.62 - dx * side * 0.5) * unit,
      );
      g.stroke();
    }
  }
  g.restore();
}
