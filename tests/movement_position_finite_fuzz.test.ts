// Position-finiteness fuzz: drive every class through its whole ability kit
// against a mob and against another player while walking around the Eastbrook
// spawn with jittery opposed inputs, and fail the instant any entity position
// or facing stops being finite. Written to reproduce the v0.43.0 dev incident
// (a NaN server position empties the interest scope, so the world "freezes"
// for that player while chat still flows, and unstuck later lands on an
// arbitrary graveyard); it found the cancelled-pair input bug within 21 ticks
// and stays as a guard against the next NaN source. On a failure the dump line
// names the entity, the tick, its last finite pose and the input that moved it.
import { describe, expect, it } from 'vitest';
import { CLASSES, ZONES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function firstNonFinite(sim: Sim): string | null {
  for (const e of sim.entities.values()) {
    const p = e.pos;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      return `${e.kind} ${e.id} ${e.name} pos=(${p.x}, ${p.y}, ${p.z})`;
    }
    if (typeof e.facing === 'number' && !Number.isFinite(e.facing)) {
      return `${e.kind} ${e.id} ${e.name} facing=${e.facing}`;
    }
  }
  return null;
}

const CLASS_IDS = Object.keys(CLASSES) as PlayerClass[];

describe('NaN position fuzz (v0.43.0 dev freeze reproduction)', () => {
  for (const cls of CLASS_IDS) {
    it(`${cls}: whole kit against a mob and a player while moving stays finite`, () => {
      const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true }) as AnySim;
      const pid = sim.addPlayer(cls, `Fuzz_${cls}`) as number;
      const other = sim.addPlayer(cls === 'druid' ? 'shaman' : 'druid', 'Sparring') as number;
      sim.setPlayerLevel(20, pid);
      sim.setPlayerLevel(20, other);
      const me = sim.entities.get(pid) as AnyEntity;
      const foe = sim.entities.get(other) as AnyEntity;
      const meta = sim.meta(pid)!;
      const foeMeta = sim.meta(other)!;
      foe.pos = { x: me.pos.x + 4, y: me.pos.y, z: me.pos.z };
      foe.prevPos = { ...foe.pos };
      sim.rebucket(foe);
      const abilities: string[] = [...(CLASSES[cls].abilities as readonly string[])];
      const rand = lcg(11 + CLASS_IDS.indexOf(cls));
      let step = 0;
      // Both axes, so opposed pairs (forward with back, strafe-left with
      // strafe-right) come up regularly: that is the cancelled-vector case.
      const dirs = ['forward', 'back', 'strafeLeft', 'strafeRight'] as const;
      const drive = (ticks: number, label: string) => {
        for (let i = 0; i < ticks; i++) {
          // Jittery movement for both players: a fresh direction every few ticks.
          if (step % 5 === 0) {
            if (!process.env.FUZZ_NO_MOVE) {
              for (const d of dirs) {
                meta.moveInput[d] = rand() < 0.35;
                foeMeta.moveInput[d] = rand() < 0.35;
              }
            }
            if (!process.env.FUZZ_NO_JUMP) meta.moveInput.jump = rand() < 0.15;
            if (!process.env.FUZZ_NO_FACING) {
              me.facing = rand() * Math.PI * 2;
              foe.facing = rand() * Math.PI * 2;
            }
          }
          const before = {
            me: { ...me.pos },
            foe: { ...foe.pos },
            meIn: { ...meta.moveInput },
            foeIn: { ...foeMeta.moveInput },
          };
          sim.tick();
          step++;
          const bad = firstNonFinite(sim);
          if (bad) {
            const who = bad.includes('Sparring') ? foe : me;
            const dump = {
              before: bad.includes('Sparring') ? before.foe : before.me,
              input: bad.includes('Sparring') ? before.foeIn : before.meIn,
              facing: who.facing,
              prevPos: who.prevPos,
              vy: who.vy,
              auras: who.auras.map((a: { kind: string; value?: number }) => `${a.kind}=${a.value}`),
              mountKey: who.mountKey,
              ghost: who.ghost,
              dead: who.dead,
              stance: who.stance,
              casting: who.castingAbility,
              level: who.level,
              stats: who.stats,
            };
            // eslint-disable-next-line no-console
            console.log(`NAN DUMP ${cls} ${label} step ${step}: ${bad}\n${JSON.stringify(dump)}`);
          }
          expect(bad, `${cls}: ${label} at step ${step}`).toBeNull();
        }
      };
      // Nearest living hostile mob within 40 yd, if any (the Eastbrook spawn
      // has wolves and boars around it).
      const mob = () =>
        [...sim.entities.values()].find(
          (e: AnyEntity) =>
            e.kind === 'mob' &&
            !e.dead &&
            e.hostile &&
            Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) < 40,
        ) as AnyEntity | undefined;
      drive(40, 'warm-up');
      for (const id of abilities) {
        const m = mob();
        if (m) {
          me.targetId = m.id;
          sim.castAbilityOn(id, m.id, pid);
          drive(12, `cast ${id} on mob`);
        }
        me.targetId = foe.id;
        sim.castAbilityOn(id, foe.id, pid);
        drive(12, `cast ${id} on player`);
        // Ground-aimed form of the same ability at a point beside, on and far from the caster.
        for (const aim of [
          { x: me.pos.x, z: me.pos.z },
          { x: me.pos.x + 3, z: me.pos.z - 3 },
          { x: me.pos.x + 60, z: me.pos.z + 60 },
        ]) {
          sim.castAbility(id, pid, aim);
          drive(6, `cast ${id} at ground`);
        }
        // Self-cast with no target at all.
        me.targetId = null;
        sim.castAbility(id, pid);
        drive(12, `cast ${id} self`);
      }
      // The sparring partner fires its own kit back while the subject keeps moving.
      const foeCls = cls === 'druid' ? 'shaman' : 'druid';
      for (const id of CLASSES[foeCls].abilities as readonly string[]) {
        foe.targetId = me.id;
        sim.castAbilityOn(id, me.id, other);
        drive(10, `partner cast ${id}`);
      }
      drive(200, 'cool-down');
      expect(ZONES.length).toBeGreaterThan(0);
    });
  }
});
