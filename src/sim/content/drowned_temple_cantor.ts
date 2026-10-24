// Laverock, the Last Cantor of the Pale Choir: the Drowned Temple's optional
// lore guide (design: GUIA_NPC.md in the Temple delivery folder). He waits on
// the Moongate Landing every run; if any member of the group takes him along
// he walks behind them, names each creature for who it was before the moon
// changed it, and when Ysolei falls he sings the rite's last verse at the Moon
// Altar so his choir can sleep.
//
// Pure data, read by the dungeon guide system (src/sim/dungeon_guide). The
// sim emits line ids only; the client renders `dungeonGuide.drownedTemple.<key>`
// from the catalog (src/ui/i18n.catalog/dungeon_guides.ts), whose English must
// match `text` here (pinned by tests/drowned_temple_cantor.test.ts). No line
// names a mob's display name, so every line survives a display rename.

import type { DungeonGuideDef, GuideLineDef } from '../dungeon_guide/types';
import { ALL_CLASSES, type NpcDef } from '../types';
import { reflectionTemplateFor } from './drowned_temple';
import { ALTAR_STONE, DROWNED_TEMPLE_ANCHORS, HYDRA_POOL } from './drowned_temple_layout';

export const CANTOR_NPC_ID = 'cantor_laverock';
export const CANTOR_GUIDE_ID = 'drowned_temple_cantor';
/** The song he sings at the Moon Altar: a channel on his cast bar. */
export const CANTOR_LAST_VERSE_CAST = 'cantor_last_verse';
export const CANTOR_DEED_ID = 'dgn_drowned_temple_cantor';
/** Where he waits on the Moongate Landing, facing the lagoon. */
export const CANTOR_SPAWN = { x: 4, z: -226, facing: 0 } as const;

const greetText =
  'I was the youngest voice of the Pale Choir. On the night of the rite I did not drink, and I ran. Every full moon since, I hear them singing under the water. I must see her before I die. Let me walk behind you. I will not fight, and I will not slow you.';

export const CANTOR_NPCS: Record<string, NpcDef> = {
  [CANTOR_NPC_ID]: {
    id: CANTOR_NPC_ID,
    name: 'Laverock',
    title: 'Last Cantor of the Pale Choir',
    pos: { x: 0, z: 0 },
    facing: CANTOR_SPAWN.facing,
    color: 0xe6dcc6,
    questIds: [],
    greeting: greetText,
    // Spawned per Temple claim by the dungeon's npcs list, never in the world.
    dynamic: true,
  },
};

/** The English of the guide's dialog window (the catalog's own English). */
export const CANTOR_DIALOG_TEXT: Readonly<Record<string, string>> = {
  'greet.1': greetText,
  'greet.2':
    'Every full moon I come to this gate, and every full moon my nerve fails me. Not tonight. The Choir is singing, and I am the one who ran. Take me down to her, and I will keep out of your way.',
  'row.join': 'Come with us.',
  'row.decline': 'We go alone.',
  joined: 'Lead on. I am right behind you.',
  singing: 'Let me sing. Go, and go gently.',
};

const A = DROWNED_TEMPLE_ANCHORS;
const SIGHT = 30;
const AREA = 14;

/** Every Tideglass Reflection template (one per class look). */
const REFLECTIONS = ALL_CLASSES.map(reflectionTemplateFor);

const LINES: GuideLineDef[] = [
  // ---- The entrance --------------------------------------------------------
  {
    id: 'E05',
    key: 'accept.1',
    text: 'Thank you. I will walk behind you, and keep out of your way.',
    trigger: { kind: 'accept' },
    priority: 'response',
    variant: 'accept',
  },
  {
    id: 'E06',
    key: 'accept.2',
    text: 'Then I go down at last. Walk on. I will keep up.',
    trigger: { kind: 'accept' },
    priority: 'response',
    variant: 'accept',
  },
  {
    id: 'E07',
    key: 'decline',
    text: 'I understand. I will listen from up here, as I always have.',
    trigger: { kind: 'decline' },
    priority: 'response',
  },
  {
    id: 'E08',
    key: 'heroicWater',
    text: 'The water stands high tonight, higher than I have ever seen it. She is close to waking.',
    trigger: { kind: 'follows', lines: ['E05', 'E06'] },
    priority: 'other',
    heroicOnly: true,
  },
  {
    id: 'E09',
    key: 'memory.votaries',
    text: 'The drowned ones on the shore walked in after the gate closed. The moon never took them, only the water.',
    trigger: { kind: 'follows', lines: ['E05', 'E06'] },
    priority: 'other',
    variant: 'memory',
  },
  {
    id: 'E10',
    key: 'memory.rubbing',
    text: "The Tidewatcher read my words on the shore-rock. 'It only sleeps.' I carved them the morning after.",
    trigger: { kind: 'follows', lines: ['E05', 'E06'] },
    priority: 'other',
    variant: 'memory',
  },
  // ---- The Pilgrim Steps and the Reflecting Causeway -----------------------
  {
    id: 'A01',
    key: 'area.steps',
    text: 'The Pilgrim Steps. I ran up these that night, three at a time, and never looked back.',
    trigger: { kind: 'area', x: A.pilgrimLanding.x, z: A.pilgrimLanding.z, r: AREA },
    priority: 'area',
  },
  {
    id: 'C01',
    key: 'sight.pilgrim',
    text: 'The pilgrims of the shore villages. They carried their shrine on their backs every spring. Now they carry it forever.',
    trigger: { kind: 'sight', mobIds: ['drowned_pilgrim'], r: SIGHT },
    priority: 'creature',
  },
  {
    id: 'C02',
    key: 'sight.acolyte',
    text: 'The novices. I learned my letters beside them. They sing in their sleep now, and never wake.',
    trigger: { kind: 'sight', mobIds: ['pale_choir_acolyte'], r: SIGHT },
    priority: 'creature',
  },
  {
    id: 'A02',
    key: 'area.causeway.1',
    text: 'On rite nights the moon lay on this causeway like a second road.',
    trigger: { kind: 'area', x: A.causeway.x, z: A.causeway.z, r: AREA },
    priority: 'area',
    variant: 'causeway',
  },
  {
    id: 'A03',
    key: 'area.causeway.2',
    text: 'Look at the water. It still remembers how to hold the moon.',
    trigger: { kind: 'area', x: A.causeway.x, z: A.causeway.z, r: AREA },
    priority: 'area',
    variant: 'causeway',
  },
  {
    id: 'C03',
    key: 'sight.templeguard',
    text: 'The stair guard. They swore to hold the temple until the moon set. It never set.',
    trigger: { kind: 'sight', mobIds: ['drowned_templeguard'], r: SIGHT },
    priority: 'creature',
  },
  {
    id: 'C04',
    key: 'sight.snapper',
    text: 'We drank the moon-water from shells like those. Mine I dropped on the stair.',
    trigger: { kind: 'sight', mobIds: ['lagoon_snapper'], r: SIGHT },
    priority: 'creature',
  },
  {
    id: 'C05',
    key: 'sight.siren',
    text: 'That voice. She sang beside me in the choir. She still comes in half a beat early.',
    trigger: { kind: 'sight', mobIds: ['moonlit_siren'], r: SIGHT },
    priority: 'creature',
  },
  {
    id: 'C07',
    key: 'sight.lurker',
    text: 'The children netted those in the shallows. They were small as a thumb, and they glowed.',
    trigger: { kind: 'sight', mobIds: ['glimmerscale_lurker'], r: SIGHT },
    priority: 'creature',
  },
  {
    id: 'C06',
    key: 'sight.tidewisp',
    text: 'That is the moon-water itself, the draught we were meant to drink. Do not let it touch you.',
    trigger: { kind: 'mobAlive', mobIds: ['tidewisp'] },
    priority: 'creature',
    inBossCombat: true,
  },
  // ---- The Colonnade of Tides and the Choir Court --------------------------
  {
    id: 'A04',
    key: 'area.colonnade',
    text: 'The Colonnade of Tides. We walked it two by two, singing the rising verse.',
    trigger: { kind: 'area', x: A.colonnade.x, z: A.colonnade.z, r: AREA },
    priority: 'area',
  },
  {
    id: 'C08',
    key: 'sight.sentinel',
    text: 'The moon rays of the gate pools. As novices we fed them pearls at moonrise. Now they keep the doors, and wear our pearls as hearts.',
    trigger: { kind: 'sight', mobIds: ['pearlguard_sentinel'], r: SIGHT },
    priority: 'creature',
  },
  {
    id: 'C09',
    key: 'sight.eel',
    text: 'The lagoon eels. The novices fed them bread at dusk. They grew fat on our hymns.',
    trigger: { kind: 'sight', mobIds: ['ice_wraith'], r: SIGHT },
    priority: 'creature',
  },
  {
    id: 'A05',
    key: 'area.veil',
    text: 'Past that veil is the Choir Court. I have not stood there since I was a boy.',
    trigger: { kind: 'gateOpen', gateId: 'choir_veil' },
    priority: 'area',
  },
  {
    id: 'B01',
    key: 'selthe.pre.1',
    text: 'Mother Selthe. She taught me to breathe from the belly. She taught us all to drown without dying.',
    trigger: { kind: 'bossNear', bossId: 'choirmother_selthe', r: SIGHT },
    priority: 'boss',
    beforeBoss: 'choirmother_selthe',
    variant: 'selthe_pre',
    gesture: 'cry',
  },
  {
    id: 'B02',
    key: 'selthe.pre.2',
    text: 'Choirmother Selthe. Every note I know, she put in me. Forgive me, Mother.',
    trigger: { kind: 'bossNear', bossId: 'choirmother_selthe', r: SIGHT },
    priority: 'boss',
    beforeBoss: 'choirmother_selthe',
    variant: 'selthe_pre',
    gesture: 'cry',
  },
  {
    id: 'B03',
    key: 'selthe.post.1',
    text: 'She is quiet. In all my years in the Choir, she was never once quiet.',
    trigger: { kind: 'bossDead', bossIds: ['choirmother_selthe'] },
    priority: 'boss',
    variant: 'selthe_post',
  },
  {
    id: 'B04',
    key: 'selthe.post.2',
    text: 'Rest now, Mother. You were right about me. I never could hold the long notes.',
    trigger: { kind: 'bossDead', bossIds: ['choirmother_selthe'] },
    priority: 'boss',
    variant: 'selthe_post',
  },
  // ---- The Terraces, the Waterfall Walk and the Hydra Pool -----------------
  {
    id: 'A06',
    key: 'area.terraces',
    text: 'The tidepools. The novices kept them clean and fed the small bright things living in them.',
    trigger: { kind: 'area', x: A.terraceLow.x, z: A.terraceLow.z, r: AREA },
    priority: 'area',
  },
  {
    id: 'A07',
    key: 'area.falls',
    text: 'Behind the falls the water drowns every voice. I hid here when I skipped practice.',
    trigger: { kind: 'area', x: A.ledge.x, z: A.ledge.z, r: AREA },
    priority: 'area',
  },
  {
    id: 'A08',
    key: 'area.pool',
    text: 'The moon pool. They knelt round it and drank from their shells. I could not lift mine.',
    trigger: { kind: 'area', x: A.pool.x, z: A.pool.z, r: HYDRA_POOL.r },
    priority: 'area',
    gesture: 'kneel',
  },
  {
    id: 'B05',
    key: 'hydra.pre',
    text: 'The pool serpent. When I was a boy it had one head, and it ate from our hands.',
    trigger: { kind: 'follows', lines: ['A08'] },
    priority: 'boss',
    beforeBoss: 'mere_hydra_head_center',
    gesture: 'cry',
  },
  {
    id: 'B06',
    key: 'hydra.post',
    text: 'Listen. Under the falls they are still singing. Closer now.',
    trigger: {
      kind: 'bossDead',
      bossIds: ['mere_hydra_head_left', 'mere_hydra_head_center', 'mere_hydra_head_right'],
    },
    priority: 'boss',
  },
  // ---- The Prism Stair and the Colossus ------------------------------------
  {
    id: 'A09',
    key: 'area.prismStair',
    text: 'The Prism Stair. We climbed it at moonrise to wake the great glass.',
    trigger: { kind: 'gateOpen', gateId: 'prism_stair_rise' },
    priority: 'area',
  },
  {
    id: 'B07',
    key: 'colossus.pre',
    text: 'The great prism. We sang into it to catch the moon. I never knew it could stand.',
    trigger: { kind: 'bossNear', bossId: 'tideglass_colossus', r: SIGHT },
    priority: 'boss',
    beforeBoss: 'tideglass_colossus',
    gesture: 'cry',
  },
  {
    id: 'C10',
    key: 'sight.reflection',
    text: 'It shows you what the water would make of you. Break it!',
    trigger: { kind: 'mobAlive', mobIds: REFLECTIONS },
    priority: 'creature',
    inBossCombat: true,
  },
  {
    id: 'B08',
    key: 'colossus.post',
    text: 'The glass is broken. Nothing is left to catch the moon now, but her.',
    trigger: { kind: 'bossDead', bossIds: ['tideglass_colossus'] },
    priority: 'boss',
  },
  // ---- The Moonbridge, the Altar Landing and Ysolei ------------------------
  {
    id: 'A10',
    key: 'area.moonbridge.1',
    text: 'A bridge of moonlight. The elders said only the faithful could cross it.',
    trigger: { kind: 'gateOpen', gateId: 'moonbridge' },
    priority: 'area',
  },
  {
    id: 'A11',
    key: 'area.moonbridge.2',
    text: 'I was never faithful. Well. We shall see if it holds me.',
    trigger: { kind: 'follows', lines: ['A10'] },
    priority: 'area',
  },
  {
    id: 'A12',
    key: 'area.altarLanding',
    text: 'This is where I stood. Right here. This is where I turned and ran.',
    trigger: { kind: 'area', x: A.altarLanding.x, z: A.altarLanding.z, r: 12 },
    priority: 'area',
  },
  {
    id: 'B09',
    key: 'ysolei.pre',
    text: 'There she is. All my life I have asked if she was a goddess or a monster. Show me.',
    trigger: { kind: 'gateOpen', gateId: 'altar_ward' },
    priority: 'boss',
    beforeBoss: 'ysolei',
    gesture: 'cry',
  },
  {
    id: 'B10',
    key: 'ysolei.preHeroic',
    text: 'On a night like this the whole Choir sings with her. Hold fast, all of you.',
    trigger: { kind: 'follows', lines: ['B09'] },
    priority: 'boss',
    beforeBoss: 'ysolei',
    heroicOnly: true,
  },
  {
    id: 'C11',
    key: 'sight.moonspawn',
    text: 'Those were never my people. They are hers, made of nothing but moonlight.',
    trigger: { kind: 'mobAlive', mobIds: ['moonspawn'] },
    priority: 'creature',
    inBossCombat: true,
  },
  // ---- The farewell, at the Moon Altar --------------------------------------
  {
    id: 'F01',
    key: 'farewell.answer',
    text: 'She was neither. She was the moon in the water, and we were the ones who knelt.',
    trigger: { kind: 'finale' },
    priority: 'farewell',
  },
  {
    id: 'F02',
    key: 'farewell.verse',
    text: 'The rite had a last verse, the one that lets the singers sleep. I never sang it.',
    trigger: { kind: 'follows', lines: ['F01'] },
    priority: 'farewell',
  },
  {
    id: 'F03',
    key: 'farewell.stay',
    text: 'They have waited long enough. I will stay, and sing it for them now.',
    trigger: { kind: 'follows', lines: ['F02'] },
    priority: 'farewell',
  },
  {
    id: 'F04',
    key: 'farewell.goodbye.1',
    text: 'Go up into the night. If you hear singing at the full moon, it is only me.',
    trigger: { kind: 'follows', lines: ['F03'] },
    priority: 'farewell',
    variant: 'farewell',
  },
  {
    id: 'F05',
    key: 'farewell.goodbye.2',
    text: 'Thank you for bringing an old coward to the end of his song. Go now.',
    trigger: { kind: 'follows', lines: ['F03'] },
    priority: 'farewell',
    variant: 'farewell',
  },
  {
    id: 'F06',
    key: 'farewell.emote',
    text: '{name} lifts his voice over the altar, and the lagoon falls still.',
    trigger: { kind: 'follows', lines: ['F04', 'F05'] },
    priority: 'farewell',
    emote: true,
  },
  // ---- Loose moments ---------------------------------------------------------
  {
    id: 'O01',
    key: 'wipe',
    text: 'Get up. Please. Do not leave me down here alone again.',
    trigger: { kind: 'wipe' },
    priority: 'response',
    inBossCombat: true,
  },
  {
    id: 'O02',
    key: 'catchUp',
    text: 'My legs are old, but I know every one of these stairs. I am here.',
    trigger: { kind: 'catchUp' },
    priority: 'other',
  },
];

export const CANTOR_GUIDE: DungeonGuideDef = {
  id: CANTOR_GUIDE_ID,
  npcId: CANTOR_NPC_ID,
  dungeonId: 'drowned_temple',
  i18nPrefix: 'dungeonGuide.drownedTemple',
  dialog: {
    greet: ['greet.1', 'greet.2'],
    joined: 'joined',
    singing: 'singing',
    rowJoin: 'row.join',
    rowDecline: 'row.decline',
  },
  offerClosesOn: 'choirmother_selthe',
  bossIds: [
    'choirmother_selthe',
    'mere_hydra_head_left',
    'mere_hydra_head_center',
    'mere_hydra_head_right',
    'tideglass_colossus',
    'ysolei',
  ],
  follow: {
    gap: 5,
    catchUpDistance: 40,
    snapBehind: 6,
    bandHeight: 6,
    walkSpeed: 3.2,
    runSpeed: 7,
    hurryBeyond: 9,
  },
  speech: { spacing: 6, staleAfter: 20 },
  finale: {
    bossIds: ['ysolei'],
    // Off the Altar Landing over the causeway, round the north of the island
    // (clear of Ysolei's coil and the altar stone), to the stone's west face.
    path: [
      { x: 8, z: 206 },
      { x: -10, z: 207 },
      { x: -22, z: 220 },
      { x: -37, z: 216 },
      { x: ALTAR_STONE.x - 7, z: ALTAR_STONE.z + 1 },
    ],
    face: { x: ALTAR_STONE.x, z: ALTAR_STONE.z },
    castId: CANTOR_LAST_VERSE_CAST,
    castSeconds: 24,
    // The Choir's own people: the pilgrims, the novices, the stair guard, the
    // singers and their Choirmother. Her creatures (the Moonspawn, the
    // Tidewisps) and the beasts of the lagoon do not rise.
    dissolveMobIds: [
      'drowned_pilgrim',
      'pale_choir_acolyte',
      'drowned_templeguard',
      'moonlit_siren',
      'choirmother_selthe',
    ],
    deedId: CANTOR_DEED_ID,
  },
  lines: LINES,
};
