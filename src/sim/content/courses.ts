// Mount-activity course registry — the ordered checkpoint sets the hoop minigame,
// solo time-trial, and (later) multi-party racing all fly. Data-as-code (no engine
// logic); the sim reads CourseDef.checkpoints for pass-through + timing. Lives in
// sim/ so it carries no DOM/render deps and runs on server, offline, and headless.
//
// Checkpoints are full 3D (x,y,z) — the $WOC flight model maintains a true
// p.pos.y, so rings sit at altitude and a course can climb and dive.
import type { Checkpoint, CourseDef } from '../types';

const TICKS = 20; // sim ticks per second; par times are written in seconds × TICKS

// A closed ring-loop of `count` checkpoints around (cx,cz) at `radius`, with the
// altitude rippling ±waveY around baseY so the line isn't flat. Rounded to 2dp so
// the data is stable and readable (geometry is fixed — no Rng).
function ringLoop(cx: number, cz: number, radius: number, count: number, baseY: number, waveY: number, ringR: number): Checkpoint[] {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const out: Checkpoint[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    out.push({ x: r2(cx + radius * Math.cos(a)), y: r2(baseY + waveY * Math.sin(a * 2)), z: r2(cz + radius * Math.sin(a)), radius: ringR });
  }
  return out;
}

// All mount courses are flyingOnly: they live in the sky over the Vale, so ground
// mounts are simply ineligible (feature 5 is a single isFlyingMount gate).
export const COURSE_LIST: readonly CourseDef[] = [
  {
    id: 'skytrial_vale',
    name: 'Vale Skytrial',
    kind: 'hoop',
    flyingOnly: true,
    laps: 1,
    parTicks: 28 * TICKS,
    checkpoints: ringLoop(38, 138, 30, 8, 18, 5, 4),
  },
  {
    id: 'vale_circuit',
    name: 'Vale Circuit',
    kind: 'trial',
    flyingOnly: true,
    laps: 3,
    parTicks: 70 * TICKS,
    checkpoints: ringLoop(38, 138, 34, 6, 20, 6, 4),
  },
] as const;

export const COURSES: Readonly<Record<string, CourseDef>> = Object.fromEntries(
  COURSE_LIST.map((c) => [c.id, c]),
);

export function courseDef(id: string | null | undefined): CourseDef | undefined {
  return id ? COURSES[id] : undefined;
}

/** Total checkpoint passes for a full run (all laps). */
export function courseTotalGates(c: CourseDef): number {
  return c.checkpoints.length * c.laps;
}
