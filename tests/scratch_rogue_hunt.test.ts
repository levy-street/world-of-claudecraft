// SCRATCH: hunt the idle tick count for rogue_engines' detonation pin.
// Deleted before handoff; writes results to the scratchpad.
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { equipBestInSlotForDev } from '../src/sim/dev/bis_gear';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

const OUT =
  '/private/tmp/claude-502/-Users-chrisherrmann-Code-world-of-claudecraft/a9a81c5a-7ddc-4406-a1d1-cd602d8b9583/scratchpad/rogue_hunt.txt';

function runWithIdle(idleTicks: number): string {
  const sim = new Sim({ seed: 23, playerClass: 'rogue', autoEquip: true });
  sim.setPlayerLevel(20);
  if (!sim.applyTalents({ spec: 'subtlety', rows: {} })) return 'talents-failed';
  const p = sim.player;
  p.resource = p.maxResource;

  const mob = createMob(9422, MOBS.training_dummy, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 2,
  });
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  p.facing = 0;
  equipBestInSlotForDev(
    (sim as unknown as { ctx: Parameters<typeof equipBestInSlotForDev>[0] }).ctx,
    p.id,
  );
  p.critChance = 0;
  p.hitBonus = 1;
  const isHit = (e: SimEvent): e is SimEvent & { amount: number; ability: string | null } =>
    e.type === 'damage' &&
    (e as { kind?: string }).kind === 'hit' &&
    !(e as { crit?: boolean }).crit;

  sim.castAbility('stealth');
  for (let i = 0; i < 25; i++) sim.tick();
  p.resource = p.maxResource;
  sim.castAbility('cheap_shot');
  for (let i = 0; i < 40; i++) sim.tick();
  for (let cast = 0; cast < 4; cast++) {
    p.resource = p.maxResource;
    sim.castAbility('hemorrhage');
    for (let i = 0; i < 40; i++) sim.tick();
  }
  const gloam = p.auras.find((a) => a.id === 'gloam');
  if (!gloam || (gloam.stacks ?? 1) !== 3) return 'bank-not-armed';

  mob.facing = Math.PI;

  for (let i = 0; i < idleTicks; i++) sim.tick();

  sim.events.length = 0;
  p.resource = p.maxResource;
  sim.castAbility('ambush');
  const edgedEvents: SimEvent[] = [...sim.events];
  for (let i = 0; i < 30; i++) {
    sim.tick();
    edgedEvents.push(...sim.events);
  }
  const gloamAfter = p.auras.find((a) => a.id === 'gloam');
  if (gloamAfter) return 'gloam-standing';
  if (!p.auras.some((a) => a.id === 'veilstrike')) return 'no-veilstrike';
  if (p.auras.some((a) => a.id === 'veiled_edge')) return 'edge-unconsumed';
  const edged = edgedEvents.filter(isHit).find((e) => e.ability === "Lurker's Strike");
  if (!edged) return 'edged-missing';

  let plain: (SimEvent & { amount: number; ability: string | null }) | undefined;
  for (let attempt = 0; attempt < 3 && !plain; attempt++) {
    sim.events.length = 0;
    p.resource = p.maxResource;
    sim.castAbility('ambush');
    const plainEvents: SimEvent[] = [...sim.events];
    for (let i = 0; i < 25; i++) {
      sim.tick();
      plainEvents.push(...sim.events);
    }
    plain = plainEvents.filter(isHit).find((e) => e.ability === "Lurker's Strike");
  }
  if (!plain) return 'plain-missing';
  if (!((edged.amount ?? 0) > (plain.amount ?? 0) * 1.3)) {
    return `ratio-fail edged=${edged.amount} plain=${plain.amount}`;
  }
  return `PASS edged=${edged.amount} plain=${plain.amount}`;
}

describe('scratch rogue idle hunt', () => {
  it('sweeps idle tick counts', () => {
    const lines: string[] = [];
    for (let idle = 0; idle <= 30; idle++) {
      let result: string;
      try {
        result = runWithIdle(idle);
      } catch (err) {
        result = `threw ${(err as Error).message}`;
      }
      lines.push(`idle=${idle} ${result}`);
    }
    writeFileSync(OUT, `${lines.join('\n')}\n`);
    expect(lines.length).toBeGreaterThan(0);
  }, 300_000);
});
