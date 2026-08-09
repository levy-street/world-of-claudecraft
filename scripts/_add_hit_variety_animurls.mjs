import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MANIFEST = resolve('src/render/characters/manifest.ts');
const BT = '`';

// key: the VisualDef's object key in manifest.ts.
// file: the ${PLAYERS}/... or ${ENEMIES}/... template-literal text to inject
//   (written as a plain string here so it is NOT interpolated by this
//   script; PLAYERS/ENEMIES are manifest.ts-local consts, not defined here).
// append: true when the block already has an animUrls: [...] line (append
//   into it) instead of adding a new one.
const INSERTS = [
  { key: 'player_warrior', file: '${PLAYERS}/knight_hit_variety_anims.glb' },
  { key: 'player_paladin', file: '${PLAYERS}/paladin_hit_variety_anims.glb' },
  { key: 'player_hunter', file: '${PLAYERS}/ranger_hit_variety_anims.glb', append: true },
  { key: 'player_rogue', file: '${PLAYERS}/rogue_hit_variety_anims.glb' },
  { key: 'player_priest', file: '${PLAYERS}/mage_hit_variety_anims.glb' },
  { key: 'player_shaman', file: '${PLAYERS}/barbarian_hit_variety_anims.glb' },
  { key: 'player_mage', file: '${PLAYERS}/mage_hit_variety_anims.glb', append: true },
  { key: 'player_warlock', file: '${PLAYERS}/mage_hit_variety_anims.glb' },
  { key: 'player_druid', file: '${PLAYERS}/druid_hit_variety_anims.glb' },
  { key: 'player_mech', file: '${PLAYERS}/Mech/characters/CombatMech_hit_variety_anims.glb' },
  { key: 'delve_skel_wraith', file: '${ENEMIES}/skeleton_minion_hit_variety_anims.glb' },
  { key: 'delve_skel_ringer', file: '${ENEMIES}/skeleton_rogue_hit_variety_anims.glb' },
  { key: 'delve_mob_acolyte', file: '${PLAYERS}/mage_hit_variety_anims.glb' },
  { key: 'delve_skel_effigy', file: '${ENEMIES}/skeleton_warrior_hit_variety_anims.glb' },
  { key: 'delve_skel_varric', file: '${ENEMIES}/skeleton_mage_hit_variety_anims.glb' },
  { key: 'skel_minion', file: '${ENEMIES}/skeleton_minion_hit_variety_anims.glb' },
  { key: 'skel_warrior', file: '${ENEMIES}/skeleton_warrior_hit_variety_anims.glb' },
  { key: 'skel_rogue', file: '${ENEMIES}/skeleton_rogue_hit_variety_anims.glb' },
  { key: 'skel_mage', file: '${ENEMIES}/skeleton_mage_hit_variety_anims.glb' },
  { key: 'skel_boss', file: '${ENEMIES}/skeleton_mage_hit_variety_anims.glb' },
  { key: 'skel_necromancer', file: '${ENEMIES}/necromancer_hit_variety_anims.glb' },
  { key: 'rift_ritualist', file: '${ENEMIES}/necromancer_hit_variety_anims.glb' },
  { key: 'mob_bandit', file: '${PLAYERS}/rogue_hooded_hit_variety_anims.glb' },
  { key: 'mob_dark_caster', file: '${PLAYERS}/mage_hit_variety_anims.glb' },
  { key: 'mob_bruiser', file: '${PLAYERS}/barbarian_hit_variety_anims.glb' },
  { key: 'npc_knight', file: '${PLAYERS}/knight_hit_variety_anims.glb' },
  { key: 'npc_mage', file: '${PLAYERS}/mage_hit_variety_anims.glb' },
  { key: 'npc_aldric', file: '${PLAYERS}/mage_classic_hit_variety_anims.glb' },
  { key: 'npc_smith', file: '${PLAYERS}/barbarian_hit_variety_anims.glb' },
  { key: 'npc_scout', file: '${PLAYERS}/rogue_hit_variety_anims.glb' },
  { key: 'npc_villager', file: '${PLAYERS}/rogue_hit_variety_anims.glb' },
  { key: 'npc_villager_robed', file: '${PLAYERS}/mage_hit_variety_anims.glb' },
  { key: 'npc_fernando', file: '${PLAYERS}/rogue_hit_variety_anims.glb' },
  { key: 'npc_reliquary_keeper', file: '${PLAYERS}/paladin_hit_variety_anims.glb' },
  { key: 'npc_edda_reedhand', file: '${PLAYERS}/druid_hit_variety_anims.glb' },
  { key: 'npc_chronicler', file: '${PLAYERS}/mage_hit_variety_anims.glb' },
];

const lines = readFileSync(MANIFEST, 'utf8').split('\n');

for (const { key, file, append } of INSERTS) {
  const startMarker = `  ${key}: {`;
  const start = lines.indexOf(startMarker);
  if (start === -1) throw new Error(`key not found: ${key}`);
  let end = start + 1;
  while (lines[end] !== '  },') {
    end++;
    if (end > lines.length) throw new Error(`no closing brace for ${key}`);
  }
  if (append) {
    const idx = lines.findIndex(
      (l, i) => i > start && i < end && l.trim().startsWith('animUrls: ['),
    );
    if (idx === -1) throw new Error(`expected existing animUrls in ${key}`);
    lines[idx] = lines[idx].replace('],', `, ${BT}${file}${BT}],`);
  } else {
    const urlIdx = lines.findIndex((l, i) => i > start && i < end && l.trim().startsWith('url:'));
    if (urlIdx === -1) throw new Error(`no url line in ${key}`);
    lines.splice(urlIdx + 1, 0, `    animUrls: [${BT}${file}${BT}],`);
  }
}

writeFileSync(MANIFEST, lines.join('\n'));
console.log(`wired animUrls for ${INSERTS.length} VisualDef entries`);
