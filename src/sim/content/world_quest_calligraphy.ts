import type { NpcDef, WorldQuestDef, WorldQuestTraceDef } from '../types';

export const WORLD_QUEST_CALLIGRAPHY_ID = 'wq_eastbrook_calligraphy';

/** All variants use the same tested clearing and one continuous closed stroke. */
export const WORLD_QUEST_CALLIGRAPHY_ADVANCED: readonly WorldQuestTraceDef[] = [
  {
    kind: 'star',
    points: [
      { x: 172, z: -20 },
      { x: 175.5267115138, z: -30.8541019662 },
      { x: 166.2936609022, z: -24.1458980338 },
      { x: 177.7063390978, z: -24.1458980338 },
      { x: 168.4732884862, z: -30.8541019662 },
      { x: 172, z: -20 },
    ],
  },
  {
    kind: 'hourglass',
    points: [
      { x: 168, z: -31 },
      { x: 176, z: -23 },
      { x: 168, z: -23 },
      { x: 176, z: -31 },
      { x: 168, z: -31 },
    ],
  },
  {
    kind: 'lightning',
    points: [
      { x: 174, z: -31 },
      { x: 168, z: -26 },
      { x: 172, z: -26 },
      { x: 170, z: -21 },
      { x: 177, z: -28 },
      { x: 173, z: -28 },
      { x: 174, z: -31 },
    ],
  },
  {
    kind: 'spiral',
    points: [
      { x: 168, z: -31 },
      { x: 177, z: -31 },
      { x: 177, z: -22 },
      { x: 168, z: -22 },
      { x: 168, z: -27 },
      { x: 173, z: -27 },
      { x: 173, z: -24 },
      { x: 168, z: -31 },
    ],
  },
  {
    kind: 'double-triangle',
    points: [
      { x: 172, z: -27 },
      { x: 166, z: -31 },
      { x: 166, z: -23 },
      { x: 172, z: -27 },
      { x: 178, z: -23 },
      { x: 178, z: -31 },
      { x: 172, z: -27 },
    ],
  },
  // Round-two additions (append-only, see WORLD_QUEST_TRACE_VARIANTS): five more
  // closed single strokes in the same clearing, every edge longer than twice the
  // 1.25 yd tolerance so no two corners blur together.
  {
    kind: 'diamond',
    points: [
      { x: 172, z: -20 },
      { x: 178, z: -26.5 },
      { x: 172, z: -32 },
      { x: 166, z: -26.5 },
      { x: 172, z: -20 },
    ],
  },
  {
    kind: 'pentagon',
    points: [
      { x: 172, z: -20 },
      { x: 177.7, z: -24.1 },
      { x: 175.5, z: -30.9 },
      { x: 168.5, z: -30.9 },
      { x: 166.3, z: -24.1 },
      { x: 172, z: -20 },
    ],
  },
  {
    kind: 'arrow',
    points: [
      { x: 172, z: -20 },
      { x: 178, z: -26 },
      { x: 174.5, z: -26 },
      { x: 174.5, z: -32 },
      { x: 169.5, z: -32 },
      { x: 169.5, z: -26 },
      { x: 166, z: -26 },
      { x: 172, z: -20 },
    ],
  },
  {
    // Kept south of z -21: the clearing's north-west corner rises past the
    // walking-slope limit there (tests/world_quest_tracing.test.ts).
    kind: 'zigzag',
    points: [
      { x: 167, z: -22 },
      { x: 177, z: -22 },
      { x: 169, z: -26 },
      { x: 177, z: -30 },
      { x: 167, z: -30 },
      { x: 175, z: -26 },
      { x: 167, z: -22 },
    ],
  },
  {
    kind: 'cross',
    points: [
      { x: 169.5, z: -21 },
      { x: 174.5, z: -21 },
      { x: 174.5, z: -24.5 },
      { x: 178, z: -24.5 },
      { x: 178, z: -29.5 },
      { x: 174.5, z: -29.5 },
      { x: 174.5, z: -33 },
      { x: 169.5, z: -33 },
      { x: 169.5, z: -29.5 },
      { x: 166, z: -29.5 },
      { x: 166, z: -24.5 },
      { x: 169.5, z: -24.5 },
      { x: 169.5, z: -21 },
    ],
  },
];

/** A dry, gently sloped clearing. No terrain stamps or calm pads are added. */
export const WORLD_QUEST_CALLIGRAPHY_QUEST: WorldQuestDef = {
  id: WORLD_QUEST_CALLIGRAPHY_ID,
  zoneId: 'eastbrook_vale',
  minLevel: 5,
  area: { x: 172, z: -28, radius: 24 },
  objective: {
    type: 'tracing',
    instructorNpcId: 'calligraphy_instructor',
    advancedShapes: WORLD_QUEST_CALLIGRAPHY_ADVANCED,
    shapes: [
      {
        kind: 'triangle',
        points: [
          { x: 166, z: -31 },
          { x: 178, z: -31 },
          { x: 172, z: -20.6076951546 },
          { x: 166, z: -31 },
        ],
      },
      {
        kind: 'square',
        points: [
          { x: 168, z: -31 },
          { x: 176, z: -31 },
          { x: 176, z: -23 },
          { x: 168, z: -23 },
          { x: 168, z: -31 },
        ],
      },
      WORLD_QUEST_CALLIGRAPHY_ADVANCED[0],
    ],
  },
  count: 3,
  reward: { type: 'xp', rate: 0.12 },
};

/** Session-spawned teachers leave the legacy roster and terrain unchanged. */
export const WORLD_QUEST_CALLIGRAPHY_NPCS: Record<string, NpcDef> = {
  calligraphy_instructor: {
    id: 'calligraphy_instructor',
    name: 'Instructor Elian',
    title: 'Arcane Calligraphy',
    pos: { x: 172, z: -35 },
    facing: 0,
    color: 0x9475c4,
    questIds: [],
    dynamic: true,
    greeting:
      'A steady step makes a steady line. Teach my apprentices a triangle, a square, and an advanced rune.',
  },
  calligraphy_apprentice_1: {
    id: 'calligraphy_apprentice_1',
    name: 'Apprentice Tessa',
    title: 'Student of Calligraphy',
    pos: { x: 168, z: -35.5 },
    facing: 0,
    color: 0x79a6bd,
    questIds: [],
    dynamic: true,
    greeting: 'I keep turning too soon. Will you show me where the corners belong?',
  },
  calligraphy_apprentice_2: {
    id: 'calligraphy_apprentice_2',
    name: 'Apprentice Pip',
    title: 'Student of Calligraphy',
    pos: { x: 175, z: -35.5 },
    facing: 0,
    color: 0xb5a064,
    questIds: [],
    dynamic: true,
    greeting: 'A triangle first, then a square, then a rune. One steady step at a time!',
  },
};

/** Reserved below the stable ground-object band; never consumes nextId. */
export const WORLD_QUEST_CALLIGRAPHY_NPC_IDS: Readonly<Record<string, number>> = {
  calligraphy_instructor: 2_146_800_001,
  calligraphy_apprentice_1: 2_146_800_002,
  calligraphy_apprentice_2: 2_146_800_003,
};
