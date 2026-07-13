// Authoring-only context descriptors for every sampled cue. These descriptors
// keep prompts, models, animation roles, and environment stages out of the game
// bundle while giving the studio a concrete dubbing target.

const PLAYER = 'public/models/chars/players/knight.glb';
const MAGE = 'public/models/chars/players/mage.glb';

const MOB_MODELS = {
  beast: 'public/models/creatures/wolf_basic.glb',
  boar: 'public/models/creatures/wild_boar.glb',
  spider: 'public/models/creatures/spider.glb',
  mudfin: 'public/models/creatures/crabenemy.glb',
  burrower: 'public/models/creatures/goblin.glb',
  humanoid: 'public/models/chars/enemies/skeleton_warrior.glb',
  undead: 'public/models/chars/enemies/skeleton_warrior.glb',
  troll: 'public/models/creatures/tribal.glb',
  ogre: 'public/models/creatures/giant.glb',
  elemental: 'public/models/creatures/golelingevolved.glb',
  dragonkin: 'public/models/creatures/dragonevolved.glb',
  demon: 'public/models/creatures/demon.glb',
};

const MOB_ATTACK_CLIPS = {
  mudfin: 'Bite_Front|Bite_InPlace',
  troll: 'Headbutt|Punch',
  elemental: 'Punch|Headbutt',
  dragonkin: 'Headbutt|Punch',
  demon: 'Punch|Headbutt',
};

const ENVIRONMENTS = {
  amb_wind_vale: {
    model: 'public/models/foliage/oak_1.glb',
    label: 'Greenvale forest wind and leaves',
    stage: 'vale',
  },
  amb_birds: {
    model: 'public/models/foliage/oak_1.glb',
    label: 'Greenvale daytime forest',
    stage: 'vale',
  },
  amb_wind_marsh: {
    model: 'public/models/props/rowboat.glb',
    label: 'Drowned Fen marsh wind',
    stage: 'marsh',
  },
  amb_wind_peaks: {
    model: 'public/models/foliage/pine_1.glb',
    label: 'Frostpeak mountain wind',
    stage: 'peaks',
  },
  amb_water: {
    model: 'public/models/props/rowboat.glb',
    label: 'Lake shore and nearby water',
    stage: 'water',
  },
  amb_campfire: {
    model: 'public/models/props/bonfire.glb',
    label: 'Campfire point source',
    stage: 'fire',
  },
  amb_forge: {
    model: 'public/models/props/blacksmith.glb',
    label: 'Blacksmith forge point source',
    stage: 'forge',
  },
  amb_dungeon: {
    model: 'public/models/dungeon/crypt.glb',
    label: 'Stone dungeon interior',
    stage: 'dungeon',
  },
  amb_rain: {
    model: 'public/models/props/inn.glb',
    label: 'World precipitation, rain',
    stage: 'rain',
  },
  amb_snow: {
    model: 'public/models/foliage/pine_1.glb',
    label: 'World precipitation, snow',
    stage: 'snow',
  },
};

const UNROUTED = {
  combat_block: 'The authoritative combat model has no block outcome yet.',
};

function animation(model, clip, label, stage = 'neutral') {
  return { kind: 'animation', model, clip, label, stage };
}

function uiContext(key) {
  const event = key.slice('ui_'.length).replaceAll('_', ' ');
  const screen = key.startsWith('ui_bag_')
    ? 'Inventory panel'
    : key.startsWith('ui_quest_')
      ? 'Quest tracker'
      : key.startsWith('ui_duel_')
        ? 'Duel banner'
        : key.startsWith('ui_fiesta_')
          ? 'Fiesta arena HUD'
          : key === 'ui_whisper'
            ? 'Chat notification'
            : key === 'ui_death'
              ? 'Defeat overlay'
              : ['ui_coin', 'ui_loot_item', 'ui_level_up'].includes(key)
                ? 'Reward toast'
                : 'Player interface';
  return {
    kind: 'ui',
    clip: '',
    label: `Personal UI feedback: ${event}`,
    stage: 'ui',
    screen,
  };
}

export function associationsForSfx(key) {
  if (ENVIRONMENTS[key]) {
    const env = ENVIRONMENTS[key];
    return [{ kind: 'environment', clip: '', ...env }];
  }
  if (key.startsWith('foot_')) {
    const surface = key.slice('foot_'.length);
    return [animation(PLAYER, 'Running|Walking', `Player locomotion on ${surface}`, surface)];
  }
  if (key.startsWith('move_')) {
    const action = key.slice('move_'.length);
    const clips = { jump: 'Jump', land: 'Jump|Idle', splash: 'Jump', swim: 'Swimming|Walking' };
    return [animation(PLAYER, clips[action] ?? 'Idle', `Player movement: ${action}`, action)];
  }
  if (key.startsWith('melee_')) {
    const ranged = key === 'melee_bow';
    return [
      animation(
        ranged ? 'public/models/chars/players/ranger.glb' : PLAYER,
        ranged ? 'Ranged|Shoot' : 'Attack|Chop|Slash',
        ranged ? 'Ranged weapon release' : 'Melee attack swing',
        'combat',
      ),
    ];
  }
  if (key.startsWith('combat_') || key.match(/^impact_(flesh|metal|leather|bone)$/)) {
    return [animation(PLAYER, 'Attack|Hit|Block', 'Physical combat resolution', 'combat')];
  }
  if (key.startsWith('player_')) {
    const death = key.endsWith('_death');
    return [animation(PLAYER, death ? 'Death' : 'Hit', death ? 'Player death' : 'Player hurt')];
  }
  if (key.startsWith('mob_')) {
    const match = key.match(/^mob_([a-z]+)_(aggro|attack|death)$/);
    const family = match?.[1] ?? 'beast';
    const action = match?.[2] ?? 'aggro';
    const clips = {
      aggro: 'Idle|Hit',
      attack: MOB_ATTACK_CLIPS[family] ?? 'Attack',
      death: 'Death',
    };
    return [
      animation(
        MOB_MODELS[family] ?? MOB_MODELS.beast,
        clips[action],
        `${family} creature ${action}`,
        'creature',
      ),
    ];
  }
  if (key.startsWith('cast_')) {
    return [animation(MAGE, 'Spellcasting|Cast', 'Spell cast and channel', 'magic')];
  }
  if (key.startsWith('proj_')) {
    return [animation(MAGE, 'Spellcast_Shoot|Shoot', 'Spell projectile release', 'magic')];
  }
  if (key.startsWith('impact_') || key === 'spell_nova') {
    return [animation(MAGE, 'Spellcast_Shoot|Cast', 'Spell impact timing', 'magic')];
  }
  if (key === 'heal_impact' || key.endsWith('_apply')) {
    return [animation(MAGE, 'Spellcasting|Cast', 'Aura or healing application', 'magic')];
  }
  if (key.startsWith('ui_')) {
    return [uiContext(key)];
  }
  return [animation(PLAYER, 'Idle', 'Generic in-game context')];
}

export function integrationForSfx(key) {
  const note = UNROUTED[key] ?? null;
  return {
    routed: note === null,
    note,
    route: key.startsWith('ui_')
      ? 'HUD sampled UI audio facade'
      : key.startsWith('foot_') || key.startsWith('move_') || key.startsWith('amb_')
        ? 'renderer spatial audio sink'
        : 'HUD simulation event audio router',
  };
}

export function missingRuntimeCues() {
  return [];
}
