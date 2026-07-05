// Before/after top-down trajectory of a pet heeling to its owner. BEFORE = old
// greedy straight-line heel (slide-steering wedges against the obstacle and never
// arrives). AFTER = new A* heel route around it. Same seed/world for both.
import { Sim } from '../src/sim/sim.ts';
import { isBlocked } from '../src/sim/colliders.ts';
import { terrainHeight } from '../src/sim/world.ts';
import { RUN_SPEED } from '../src/sim/types.ts';

const SEED = 42;
const PET = { x: -16, z: 10 }, OWN = { x: -30, z: 10 };
const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function newSim() {
  const sim = new Sim({ seed: SEED, playerClass: 'hunter', noPlayer: true });
  const pid = sim.addPlayer('hunter', 'Owner');
  const owner = sim.entities.get(pid);
  const pet = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
  pet.ownerId = pid; pet.hostile = false; pet.hp = pet.maxHp; pet.petMode = 'passive';
  const set = (e, x, z) => { e.pos = { x, y: terrainHeight(x, z, SEED), z }; e.prevPos = { ...e.pos }; };
  set(pet, PET.x, PET.z); set(owner, OWN.x, OWN.z);
  return { sim, owner, pet };
}
function traceAfter() {
  const { sim, owner, pet } = newSim(); const path = [{ ...pet.pos }];
  for (let i = 0; i < 20 * 10 && dist2d(pet.pos, owner.pos) > 3.5; i++) { sim.tick(); path.push({ ...pet.pos }); }
  return path;
}
function traceBefore() {
  const { sim, owner, pet } = newSim(); const path = [{ ...pet.pos }];
  const speed = Math.max(pet.moveSpeed, RUN_SPEED * 1.1);
  for (let i = 0; i < 20 * 10; i++) {
    const d = dist2d(pet.pos, owner.pos); if (d <= 3.5) break;
    if (d > 60) pet.pos = { ...owner.pos }; else sim.moveToward(pet, owner.pos, speed);
    path.push({ ...pet.pos });
  }
  return path;
}
const before = traceBefore(), after = traceAfter();

const VX0 = -34, VX1 = -6, VZ0 = -2, VZ1 = 24, S = 24, PAD = 26;
const W = (VX1 - VX0) * S + PAD * 2, H = (VZ1 - VZ0) * S + PAD * 2;
const sx = (x) => PAD + (x - VX0) * S, sy = (z) => H - PAD - (z - VZ0) * S;
let cells = '';
for (let x = VX0; x < VX1; x += 0.5) for (let z = VZ0; z < VZ1; z += 0.5)
  if (isBlocked(SEED, x, z, 0.5)) cells += `<rect x="${sx(x)}" y="${sy(z + 0.5)}" width="${0.5 * S}" height="${0.5 * S}" fill="#5a4632"/>`;
const poly = (p, c) => `<polyline fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="round" points="${p.map((q) => `${sx(q.x).toFixed(1)},${sy(q.z).toFixed(1)}`).join(' ')}"/>`;
const dot = (p, c, r = 6) => `<circle cx="${sx(p.x)}" cy="${sy(p.z)}" r="${r}" fill="${c}"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif">
<rect width="${W}" height="${H}" fill="#11151c"/>${cells}
${poly(before, '#e0564b')}${poly(after, '#46c97a')}
${dot(before[0], '#ffffff')}${dot(OWN, '#ffd24a', 7)}
<text x="14" y="22" fill="#e0564b" font-size="15">■ before: greedy heel wedges on the obstacle (never arrives)</text>
<text x="14" y="42" fill="#46c97a" font-size="15">■ after: A* route around the obstacle to the owner</text>
<text x="14" y="${H - 12}" fill="#9aa4b2" font-size="13">brown = blocked cells · white = pet start · yellow = owner · seed ${SEED}</text>
</svg>`;
process.stdout.write(svg);
process.stderr.write(`before ends ${dist2d(before.at(-1), OWN).toFixed(1)}yd away; after ends ${dist2d(after.at(-1), OWN).toFixed(1)}yd away\n`);
