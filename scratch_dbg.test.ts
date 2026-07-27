import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Sim } from './src/sim/sim';
it('dbg', () => {
  const out: string[] = [];
  const sim = new Sim({ seed: 909, playerClass: 'warrior', playerName: 'Fix', devCommands: true }) as any;
  const ferries = [...sim.entities.values()].filter((e: any) => e.templateId === 'lb_ferry');
  for (const f of ferries) out.push(`ferry pos=${f.pos.x},${f.pos.y.toFixed(2)},${f.pos.z} lootable=${f.lootable}`);
  const pos = sim.groundPos(176, -48);
  sim.player.pos = { ...pos }; sim.player.prevPos = { ...pos }; sim.rebucket(sim.player);
  out.push(`player y=${pos.y.toFixed(2)}`);
  sim.player.targetId = ferries.find((f: any) => f.pos.x === 177)?.id ?? null;
  out.push(`target=${sim.player.targetId}`);
  sim.interact();
  out.push(`after: ${sim.player.pos.x.toFixed(1)},${sim.player.pos.z.toFixed(1)}`);
  writeFileSync('/tmp/dbg.txt', out.join('\n'));
});
