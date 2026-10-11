// Every hand-keyed clip, with the intent the authoring and checks read: its
// family, whether it loops, and for attacks the weapon, the striking side and
// the dual-wield role. `SHIPPED_CLIPS` are the ones the game plays and the
// shipped libraries carry; the rest stay buildable for when they are wired.
const entries = {};
function add(name, family, options = {}) {
  entries[name] = { family, loop: false, ...options };
}

add('Woc_Idle', 'idle', { loop: true });
add('Woc_Walk', 'gait', { loop: true, gait: 'walk' });
add('Woc_Walk_Back', 'gait', { loop: true, gait: 'walk' });
add('Woc_Run', 'gait', { loop: true, gait: 'run' });
add('Woc_Run_Back', 'gait', { loop: true, gait: 'run' });
add('Woc_Jump', 'jump');
add('Woc_Death', 'death');
add('Woc_Swim', 'swim', { loop: true });
add('Woc_Swim_Back', 'swim', { loop: true });
add('Woc_Swim_Left', 'swim', { loop: true });
add('Woc_Swim_Right', 'swim', { loop: true });
add('Woc_Swim_Idle', 'tread', { loop: true });
add('Woc_Sit', 'sit', { loop: true });
add('Woc_Talk', 'chat', { loop: true });
add('Woc_Crouch_Idle', 'crouch', { loop: true });
for (const direction of [
  'Forward',
  'Back',
  'Left',
  'Right',
  'Forward_Left',
  'Forward_Right',
  'Back_Left',
  'Back_Right',
])
  add(`Woc_Crouch_${direction}`, 'gait', { loop: true, gait: 'crouch' });
add('Woc_Hover', 'hover', { loop: true });
for (const direction of ['Forward', 'Back', 'Left', 'Right'])
  add(`Woc_Fly_${direction}`, 'hover', { loop: true });
for (const [name, family] of Object.entries({
  Wave: 'wave',
  Laugh: 'laugh',
  Flex: 'flex',
  Bow: 'bow',
  Nod: 'nod',
  Shake_Head: 'shake',
  Beckon: 'beckon',
  Point: 'point',
}))
  add(`Woc_Emote_${name}`, family);
for (const [name, options] of Object.entries({
  Unarmed_0: { weapon: 'fist' },
  Unarmed_1: { weapon: 'fist', side: 'l' },
  Rifle: { weapon: 'rifle' },
  Thrown: { weapon: 'thrown' },
  Bow: { weapon: 'bow' },
  '1H_0': { weapon: 'blade' },
  '1H_1': { weapon: 'blade' },
  Offhand: { weapon: 'blade', side: 'l' },
  Offhand_Stab: { weapon: 'pierce', side: 'l' },
  '1H_Stab': { weapon: 'pierce' },
  '2H_0': { weapon: 'twohand' },
  '2H_1': { weapon: 'twohand' },
  Polearm_0: { weapon: 'long' },
  Polearm_1: { weapon: 'long' },
  Polearm_2: { weapon: 'long' },
  'Dual#main': { weapon: 'blade', dual: 'main' },
  'Dual#off': { weapon: 'blade', side: 'l', dual: 'off' },
  Dual: { weapon: 'blade', dual: 'pair' },
}))
  add(`Woc_Attack_${name}`, 'attack', { side: 'r', ...options });

export const CATALOG = Object.freeze(entries);

/** The clips the game plays (src/render/characters/woc_keyed_animations.ts and
 * woc_autoattack_core.ts), in the order the shipped libraries hold them. */
export const SHIPPED_CLIPS = Object.freeze([
  'Woc_Idle',
  'Woc_Walk',
  'Woc_Walk_Back',
  'Woc_Run',
  'Woc_Jump',
  'Woc_Death',
  'Woc_Swim',
  'Woc_Swim_Idle',
  'Woc_Emote_Wave',
  'Woc_Emote_Laugh',
  'Woc_Emote_Flex',
  'Woc_Emote_Bow',
  'Woc_Attack_1H_0',
  'Woc_Attack_1H_1',
  'Woc_Attack_2H_0',
  'Woc_Attack_2H_1',
  'Woc_Attack_Unarmed_0',
  'Woc_Attack_Unarmed_1',
  'Woc_Attack_Rifle',
  'Woc_Attack_Bow',
  'Woc_Attack_Dual',
  'Woc_Attack_Dual#main',
  'Woc_Attack_Dual#off',
]);
