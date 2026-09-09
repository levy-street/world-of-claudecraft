// Authored Tripo P2 bodies and Blender clips share the normal character load,
// animation and gated visual-swap lanes. Entity scale stays simulation-owned.
import type { ClipMap, VisualDef } from './manifest';

const creatureClips: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  hit: ['Hit'],
  death: 'Death',
  cast: 'Cast',
  jump: 'Jump',
};

const bossClips: ClipMap = {
  ...creatureClips,
  castOnce: ['Transform'],
  // The exported 17/6 second gesture spans the sim's three-second coronation.
  castTimeScaleByAbility: { rift_asmon_coronation: 17 / 18 },
  castByAbility: {
    rift_asmon_coronation: 'Transform',
    rift_asmon_desk_slam: 'Stomp',
    rift_asmon_tribute: 'Decree',
    rift_asmon_filth: 'Spit',
    rift_asmon_swarm: 'Decree',
  },
  attackByAbility: {
    rift_asmon_desk_slam: 'Stomp',
    rift_asmon_filth: 'Spit',
    rift_asmon_swarm: 'Decree',
  },
};

export const ROACH_KING_VISUALS: Record<string, VisualDef> = {
  mob_asmon_hermit: {
    url: 'models/creatures/asmon_hermit.glb',
    height: 2.1,
    clips: bossClips,
    selfIllumination: 0.15,
    walkRef: 2.5,
    runRef: 5,
  },
  mob_roach_king: {
    url: 'models/creatures/roach_king.glb',
    height: 2.4,
    clips: bossClips,
    selfIllumination: 0.2,
    walkRef: 2.5,
    runRef: 5,
  },
  mob_roachling: {
    url: 'models/creatures/roachling.glb',
    height: 0.65,
    clips: creatureClips,
    selfIllumination: 0.12,
    walkRef: 2.8,
    runRef: 6,
  },
  mob_garbage_beetle: {
    url: 'models/creatures/garbage_beetle.glb',
    height: 1.3,
    clips: creatureClips,
    selfIllumination: 0.15,
    walkRef: 2,
    runRef: 4,
  },
};
