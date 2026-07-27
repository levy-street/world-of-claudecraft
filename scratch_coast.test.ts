import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { terrainHeight } from './src/sim/world';
it('coast', () => {
  const out: string[] = [];
  // Mainland: fan out from the dock knoll to find the nearest real water.
  for (const [name, dx, dz] of [['E',1,0],['ENE',0.92,0.38],['NE',0.7,0.7],['ESE',0.92,-0.38],['SE',0.7,-0.7],['SSE',0.38,-0.92]] as const) {
    let line = `${name}:`;
    for (let d = 0; d <= 44; d += 4) {
      const h = terrainHeight(152 + dx * d, -48 + dz * d, 1337);
      line += ` ${d}:${h.toFixed(1)}`;
    }
    out.push(line);
  }
  out.push('---gullhaven pier line (west from shore)---');
  for (let x = 806; x >= 762; x -= 3) {
    out.push(`x=${x} z=122 h=${terrainHeight(x, 122, 1337).toFixed(2)}`);
  }
  writeFileSync('/tmp/coast.txt', out.join('\n'));
});
