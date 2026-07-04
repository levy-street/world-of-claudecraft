// Retime the Tripo-generated creature clips to classic game cadence, in place.
// The Tripo preset retargets ship VERY long cycles (Walk 2.38s, Attack 6.63s,
// Death 8.46s) which play at timeScale 1 in the game: legs crawl in slow
// motion under a body moving at full mob speed (the reported "walks weird /
// slides sideways"), swings mush, deaths take nine seconds. Baking the
// retime into the GLB keyframe TIMES fixes every host (game, stills, guide
// viewer) with no runtime knobs and no regeneration credits.
//   node scripts/retime_tripo_clips.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'public/models/creatures';
const BODIES = [
  'mob_ossara_judge',
  'mob_sandmaw_tyrant',
  'mob_dust_elemental',
  'mob_granite_elemental',
  'mob_veykar',
  'mob_commander_vaelis',
  'mob_tombrobber',
  'mob_veth_cutthroat',
  'mob_frost_troll',
  'mob_twilight_revenant',
  'mob_ironhold_burrower',
  'mob_ember_cat',
  'mob_pale_widow',
  'mob_river_skulker',
  'mob_legion_deserter',
  'mob_highland_ogre',
  'mob_fog_horror',
  'valdris_carter',
  'valdris_warden',
];
// Target durations (seconds); a clip already at or under target is left alone.
const TARGETS = {
  Walk: 1.0,
  Run: 0.75,
  Attack: 1.4,
  Hit: 0.7,
  Death: 2.2,
  Cast: 1.6,
  Jump: 0.9,
  Idle: 6.0,
};
const CHECK = process.argv.includes('--check');

for (const body of BODIES) {
  const file = path.join(DIR, `${body}.glb`);
  if (!fs.existsSync(file)) {
    console.log('SKIP (missing)', body);
    continue;
  }
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
  const binStart = 20 + jsonLen + 8;
  const report = [];
  // One input accessor can be shared by several samplers/clips; scale each once
  // with the factor of the clip that owns it first (Tripo exports do not share
  // inputs across clips, verified, but guard anyway).
  const scaled = new Map();
  for (const anim of json.animations ?? []) {
    const target = TARGETS[anim.name];
    if (!target) continue;
    let duration = 0;
    for (const s of anim.samplers)
      duration = Math.max(duration, json.accessors[s.input].max?.[0] ?? 0);
    if (duration <= target + 0.05) continue;
    const k = target / duration;
    for (const s of anim.samplers) {
      if (scaled.has(s.input)) continue;
      scaled.set(s.input, k);
      const acc = json.accessors[s.input];
      const view = json.bufferViews[acc.bufferView];
      const off = binStart + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      for (let i = 0; i < acc.count; i++) {
        buf.writeFloatLE(buf.readFloatLE(off + i * 4) * k, off + i * 4);
      }
      if (acc.max) acc.max = acc.max.map((v) => v * k);
      if (acc.min) acc.min = acc.min.map((v) => v * k);
    }
    report.push(`${anim.name} ${duration.toFixed(2)}s -> ${target}s`);
  }
  if (report.length === 0) {
    console.log('ok (already timed)', body);
    continue;
  }
  if (CHECK) {
    console.log('WOULD RETIME', body, report.join(', '));
    continue;
  }
  // The accessor min/max changed: rewrite the JSON chunk (padded to 4 bytes).
  let jsonText = JSON.stringify(json);
  while (Buffer.byteLength(jsonText) % 4 !== 0) jsonText += ' ';
  const jsonBuf = Buffer.from(jsonText);
  const out = Buffer.alloc(20 + jsonBuf.length + (buf.length - (20 + jsonLen)));
  buf.copy(out, 0, 0, 12); // header (length patched below)
  out.writeUInt32LE(jsonBuf.length, 12);
  out.write('JSON', 16);
  jsonBuf.copy(out, 20);
  buf.copy(out, 20 + jsonBuf.length, 20 + jsonLen); // BIN chunk header + data as-is
  out.writeUInt32LE(out.length, 8);
  fs.writeFileSync(file, out);
  console.log('RETIMED', body, report.join(', '));
}
