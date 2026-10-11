import type { WorldQuestLeyOutcome } from './world_quest_ley_view';

export interface WorldQuestLeyEffect {
  kind: 'pulse' | 'ring' | 'star' | 'ray' | 'ember';
  x: number;
  y: number;
  dx: number;
  dy: number;
  angle: number;
  duration: number;
  delay: number;
  size: number;
}
export const WORLD_QUEST_LEY_FX_LIMIT = 96;

/** Deliberate, finite sequences, independent of the gameplay and render host. */
export function worldQuestLeyOutcomeEffects(outcome: WorldQuestLeyOutcome): WorldQuestLeyEffect[] {
  if (outcome === 'playing') return [];
  const won = outcome === 'won';
  const effects: WorldQuestLeyEffect[] = [];
  const add = (effect: WorldQuestLeyEffect) => effects.push(effect);
  for (let ring = 0; ring < (won ? 3 : 1); ring++)
    add({
      kind: 'ring',
      x: 50,
      y: 48,
      dx: 0,
      dy: 0,
      angle: ring * 30,
      duration: won ? 2300 : 1600,
      delay: ring * 850,
      size: 130 + ring * 24,
    });
  for (let ray = 0; ray < (won ? 12 : 0); ray++)
    add({
      kind: 'ray',
      x: 50,
      y: 48,
      dx: 0,
      dy: 0,
      angle: ray * 30,
      duration: 3000,
      delay: 220 + (ray % 3) * 100,
      size: 130,
    });
  const count = won ? 54 : 20;
  for (let i = 0; i < count; i++) {
    const angle = (i * 137.5 * Math.PI) / 180;
    const distance = won ? 56 + (i % 7) * 17 : 18 + (i % 4) * 6;
    add({
      kind: won ? 'star' : 'ember',
      x: won ? 22 + ((i * 13) % 56) : 12 + ((i * 23) % 76),
      y: won ? 65 + ((i * 7) % 22) : 20 + ((i * 17) % 60),
      dx: Math.cos(angle) * distance,
      dy: won ? -90 - (i % 6) * 22 : 25 + (i % 4) * 8,
      angle: (i * 37) % 180,
      duration: won ? 2000 : 1100,
      delay: won ? Math.floor(i / 18) * 1400 + (i % 6) * 90 : (i % 6) * 90,
      size: won ? 5 + (i % 4) * 2 : 3 + (i % 3),
    });
  }
  return effects.slice(0, WORLD_QUEST_LEY_FX_LIMIT);
}
