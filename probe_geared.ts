import { HEROIC_DUNGEON_TUNING } from './src/sim/content/dungeon_difficulty';
import { DUNGEONS, ITEMS, MOBS } from './src/sim/data';
import { Sim } from './src/sim/sim';
import { armorReduction, type EquipSlot } from './src/sim/types';

// Gear a level-20 character in the best armor pieces its class can wear from
// the endgame loot tables: for each equip slot pick the wearable item with the
// highest armor+stamina, give it, equip it.
function gearUp(cls: 'warrior' | 'mage' | 'priest'): Sim {
  const sim = new Sim({ seed: 42, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(20);
  const bySlot = new Map<string, { id: string; score: number }>();
  for (const [id, def] of Object.entries(ITEMS)) {
    const d = def as any;
    if (!d.slot || d.kind !== 'armor') continue;
    const armorTypeOk =
      cls === 'warrior'
        ? true
        : cls === 'mage' || cls === 'priest'
          ? d.armorType === 'cloth'
          : true;
    if (!armorTypeOk) continue;
    if (d.requiredClass && d.requiredClass !== { warrior: 'WAR', mage: 'MAG', priest: 'MAG' }[cls])
      continue;
    if ((d.requiredLevel ?? 0) > 20) continue;
    const score = (d.stats?.armor ?? 0) + (d.stats?.sta ?? 0) * 10;
    const cur = bySlot.get(d.slot);
    if (!cur || score > cur.score) bySlot.set(d.slot, { id, score });
  }
  for (const { id } of bySlot.values()) {
    sim.addItem(id, 1);
    sim.equipItem(id);
  }
  return sim;
}

for (const cls of ['warrior', 'mage', 'priest'] as const) {
  const sim = gearUp(cls);
  const p = sim.player;
  const dr = armorReduction(p.stats.armor, 20);
  console.log(
    `${cls} L20 geared: hp=${p.maxHp} armor=${p.stats.armor} DR=${(dr * 100).toFixed(0)}%`,
  );
}

// Final-boss raw swings under CANDIDATE damage multipliers.
const CANDIDATES: Record<string, number[]> = {
  hollow_crypt: [1.8, 2.6, 3.0],
  sunken_bastion: [2.2, 3.0, 3.4],
  drowned_temple: [2.8, 3.6, 4.0],
  gravewyrm_sanctum: [2.7, 3.6, 4.2],
};
const tank = gearUp('warrior').player;
const cloth = gearUp('mage').player;
const tankDR = armorReduction(tank.stats.armor, 20);
const clothDR = armorReduction(cloth.stats.armor, 20);
console.log(`\ntank hp=${tank.maxHp} DR=${(tankDR * 100).toFixed(0)}% | cloth hp=${cloth.maxHp} DR=${(clothDR * 100).toFixed(0)}%`);
for (const [did, tune] of Object.entries(HEROIC_DUNGEON_TUNING)) {
  const boss = MOBS[tune.finalBossId];
  const trashId = DUNGEONS[did].spawns.map((s) => s.mobId).find((m) => m !== tune.finalBossId)!;
  const trash = MOBS[trashId];
  const raw = (t: any, dm: number) =>
    (t.dmgBase * dm + t.dmgPerLevel * dm * 19) * (t.elite ? 1.5 : 1);
  for (const dm of CANDIDATES[did]) {
    const b = raw(boss, dm);
    const tr = raw(trash, dm);
    console.log(
      `${did} d=${dm}: boss->tank ${Math.round(b * (1 - tankDR))} (${((b * (1 - tankDR)) / tank.maxHp * 100).toFixed(0)}%)` +
        ` boss->cloth ${Math.round(b * (1 - clothDR))} (${((b * (1 - clothDR)) / cloth.maxHp * 100).toFixed(0)}%)` +
        ` | trash(${trashId})->cloth ${Math.round(tr * (1 - clothDR))} (${((tr * (1 - clothDR)) / cloth.maxHp * 100).toFixed(0)}%)`,
    );
  }
}
