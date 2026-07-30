// Maps real terrain water around the bot camps using the sim's groundHeight (seed 20061), so we can
// see exactly where the river is and stop the party swimming across it. Run: node scripts/terrain_probe.mjs
import { build } from 'esbuild';

const out = '/tmp/woc_world_probe.mjs';
await build({
  entryPoints: ['src/sim/world.ts'],
  bundle: true,
  format: 'esm',
  outfile: out,
  platform: 'node',
  logLevel: 'silent',
});
const { groundHeight, WATER_LEVEL } = await import(`file://${out}?v=${Date.now()}`);
const SEED = 20061;
const SWIM = WATER_LEVEL - 0.75; // body below this = swimming  (-5.25)
const DEEP = WATER_LEVEL - 0.8; // impassable deep water       (-5.3)
const g = (x, z) => groundHeight(x, z, SEED);
const tag = (x, z) => {
  const h = g(x, z);
  return h < DEEP ? 'DEEP' : h < SWIM ? 'swim' : h < WATER_LEVEL ? 'wade' : 'DRY';
};

console.log(`WATER_LEVEL=${WATER_LEVEL}  swim<${SWIM}  deep<${DEEP}\n`);

// L9-10 camps + their giver, and the trickier z~300→z~420 crossings
const legs = [
  ['giver→widows', -8, 296, 70, 300],
  ['giver→drowned', -8, 296, 90, 420],
  ['giver→trolls', 3, 304, -80, 420],
  ['widows→drowned', 70, 300, 90, 420],
];
for (const [name, x0, z0, x1, z1] of legs) {
  let line = `${name.padEnd(16)} `;
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const x = x0 + ((x1 - x0) * i) / N,
      z = z0 + ((z1 - z0) * i) / N;
    const h = g(x, z);
    line += h < DEEP ? '#' : h < SWIM ? '~' : h < WATER_LEVEL ? '-' : '.';
  }
  console.log(line + `   (.=dry -=wade ~=swim #=deep)`);
}

console.log('\nCamp centers:');
for (const [n, x, z] of [
  ['widows', 70, 300],
  ['drowned', 90, 420],
  ['trolls', -80, 420],
  ['cult', 15, 470],
]) {
  console.log(`  ${n.padEnd(8)} (${x},${z})  h=${g(x, z).toFixed(2)}  ${tag(x, z)}`);
}

// for the drowned camp (90,420) scan a grid to find dry land nearby
console.log('\nDrowned camp (90,420) 16-pt ring @ r=20/32:');
for (const r of [20, 32]) {
  let s = `  r=${r}: `;
  for (let a = 0; a < 360; a += 45) {
    const x = 90 + Math.cos((a * Math.PI) / 180) * r,
      z = 420 + Math.sin((a * Math.PI) / 180) * r;
    s += `${a}°:${tag(x, z)} `;
  }
  console.log(s);
}
