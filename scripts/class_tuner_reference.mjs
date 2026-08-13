// Generates the Class Power Tuner reference document: the feature documentation
// plus the COMPLETE tunable surface (every class, every spec, every ability with
// the channels it exposes, and every weapon's white-swing profile), as one
// self-contained HTML file that a headless browser prints to PDF.
//
// The tables are derived from the SAME catalog the dashboard renders
// (src/sim/tuning/catalog.ts), so the document cannot drift from the tool: a
// reworked class shows up here the moment its content lands.
//
// Dev-only, not wired into any npm script or CI gate.
//
// Usage:
//   node scripts/class_tuner_reference.mjs                     # HTML only
//   node scripts/class_tuner_reference.mjs --pdf               # HTML + PDF
//   OUT_DIR=docs/balance SHOTS_DIR=docs/screenshots/class-power-tuner \
//     node scripts/class_tuner_reference.mjs --pdf
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT_DIR = process.env.OUT_DIR ?? 'docs/balance';
const SHOTS_DIR = process.env.SHOTS_DIR ?? 'docs/screenshots/class-power-tuner';
const WANT_PDF = process.argv.includes('--pdf');
const HTML_PATH = path.join(OUT_DIR, 'class-power-tuner.html');
const PDF_PATH = path.join(OUT_DIR, 'class-power-tuner.pdf');

// The sim is TypeScript, and scripts here never import TS sources raw
// (scripts/CLAUDE.md): bundle the catalog builder with esbuild first, exactly
// as export_loot_spreadsheet.mjs does.
function loadCatalog() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-tuner-ref-'));
  const entry = path.join(tmp, 'entry.mjs');
  const bundle = path.join(tmp, 'bundle.mjs');
  // The entry sits in a temp dir, so import by absolute repo path.
  fs.writeFileSync(
    entry,
    [
      `export { buildClassTuningCatalog } from ${JSON.stringify(path.resolve('src/sim/tuning/catalog.ts'))};`,
      `export { TUNING_CHANNELS } from ${JSON.stringify(path.resolve('src/sim/tuning/channels.ts'))};`,
    ].join('\n'),
  );
  execFileSync(
    'npx',
    ['esbuild', entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${bundle}`],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  return import(bundle);
}

const CHANNEL_LABELS = {
  damage_direct: 'Direct damage',
  damage_dot: 'Damage over time',
  damage_aoe: 'Area damage',
  damage_finisher: 'Finisher damage',
  damage_reflect: 'Reflect damage per hit',
  heal_direct: 'Direct healing',
  heal_hot: 'Healing over time',
  absorb: 'Absorb shielding',
  threat: 'Threat',
  spell_power: 'Spell power scaling',
  resource_cost: 'Resource cost',
  resource_gain: 'Resource generated',
  cooldown: 'Cooldown',
  cast_time: 'Cast time',
  effect_magnitude: 'Aura and modifier strength',
  duration_effect: 'Effect duration',
  duration_control: 'Control duration',
  radius: 'Radius',
  range: 'Range',
  distance: 'Distance',
  targets: 'Targets and charges',
  swing_damage: 'White swing damage',
  swing_speed: 'Swing timer',
};

const SOURCE_LABELS = {
  base: 'Shared kit',
  spec: 'Spec kit',
  signature: 'Signature',
  row: 'Talent row',
  unspecced: 'No specialization',
};

const esc = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const num = (value) =>
  Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);

/** The shipped numbers behind one channel, deduped and capped for the table cell. */
function siteSummary(channel, maxValues = 6) {
  const seen = [];
  for (const site of channel.sites) {
    if (seen.includes(site.value)) continue;
    seen.push(site.value);
    if (seen.length >= maxValues) break;
  }
  const more = new Set(channel.sites.map((site) => site.value)).size > seen.length ? ', ...' : '';
  return seen.map(num).join(' / ') + more;
}

function dataUriFor(file) {
  const bytes = fs.readFileSync(file);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/** Every capture in SHOTS_DIR, in filename order, with its documented caption. */
const SHOT_CAPTIONS = {
  '01-overview-shaman':
    'The tuner as an operator opens it: one window per class, plus the Weapons window at the end of the row. Shaman is selected, the first of the three redesigned classes.',
  '02-shaman-spiritmend-cascading-mend':
    'Spiritmend (Restoration) Cascading Mend, the spec signature, at the shipped numbers. One spell, seven independent sliders: its healing, how many allies it chains to, the chain radius, its cost, cast time, range and spell power scaling.',
  '03-shaman-cascading-mend-tuned':
    'The same spell with healing pulled to 0.75x and its chain widened to 1.50x. Each aspect moves on its own, so throughput can be traded for reach rather than both moving together.',
  '04-shaman-thundercall-cinder-jolt':
    'Thundercall (Elemental) Cinder Jolt. A shock that lands a hit and leaves a burn gets a separate slider for the direct damage and for the damage over time, so the burst and the sustained portion are tuned apart.',
  '05-shaman-warspirit-spec-filter':
    'Warspirit (Enhancement), the dual-wield melee spec. The class window filtered to one specialization lists every ability that spec can actually cast, including its spec-gated and signature kit.',
  '06-hunter-coldsight-long-draw':
    'Hunter, Coldsight (Marksmanship): Long Draw. A cast ranged shot, with its cast time and its ranged-attack-power scaling as separate levers from its damage.',
  '07-hunter-rattling-shot':
    'Rattling Shot. A control shot carries its snare strength and its control duration as their own channels, so the shot can be made to hit harder without also holding a target longer.',
  '08-hunter-packlord-signature':
    'Packlord (Beast Mastery) and its signature cooldown, Howling Rage. A spec signature is marked as such and scoped to the one spec that has it.',
  '09-priest-doctrine-psalm-of-warding':
    'Priest, Doctrine (Discipline): Psalm of Warding. Absorb shielding is its own channel, separate from healing, so a shield can be trimmed without touching a heal.',
  '10-priest-vespers-mindfracture':
    'Vespers (Shadow) Mindfracture, the damage side of the same class. The same six-slider shape a healer card has, pointed at damage instead.',
  '11-saved-pending-restart':
    'After saving. The badge reports the change as pending a restart rather than implying it is already live, because tuning is installed once per boot.',
  '12-change-history':
    'The append-only change history: who saved what, when, and the note they left.',
  '13-weapons-overview':
    'The Weapons window. Auto-attack ("white") damage and swing timer, per weapon, filterable by weapon type.',
  '14-weapon-shipped':
    'One weapon at its shipped numbers, with its damage range, swing timer and the resulting damage per second.',
  '15-weapon-tuned':
    'The same weapon with swing damage raised and the swing timer slowed. The recomputed damage per second shows the net effect of both sliders together.',
  '16-weapon-hunter-ranged':
    "A class's own ranged profile. A hunter's Auto Shot swings off these numbers with no item involved, so it is tuned as class kit rather than loot.",
  '17-mobile-overview': 'The tuner on a phone viewport.',
  '18-mobile-ability-card': 'An ability card on a phone: the sliders stack to one column.',
};

function shotSection() {
  if (!fs.existsSync(SHOTS_DIR)) return '<p class="note">No screenshots captured.</p>';
  const files = fs
    .readdirSync(SHOTS_DIR)
    .filter((name) => name.endsWith('.png'))
    .sort();
  if (files.length === 0) return '<p class="note">No screenshots captured.</p>';
  return files
    .map((file) => {
      const key = file.replace(/\.png$/, '');
      const caption = SHOT_CAPTIONS[key] ?? '';
      // The two phone captures are portrait; letting them keep more height
      // stops them rendering as a thin strip beside a page of whitespace.
      const tall = key.includes('mobile');
      return [
        `<figure class="shot${tall ? ' tall' : ''}">`,
        `<img src="${dataUriFor(path.join(SHOTS_DIR, file))}" alt="${esc(caption || key)}">`,
        `<figcaption><b>${esc(key)}</b>${caption ? ` &mdash; ${esc(caption)}` : ''}</figcaption>`,
        '</figure>',
      ].join('\n');
    })
    .join('\n');
}

function abilityRows(classInfo, specId) {
  const abilities = classInfo.abilities.filter((ability) =>
    specId === null ? ability.specs.length === 0 : ability.specs.includes(specId),
  );
  if (abilities.length === 0) return '';
  return abilities
    .map((ability) => {
      const channels =
        ability.channels.length === 0
          ? '<span class="none">no tunable numbers (power lives in talent modifiers)</span>'
          : ability.channels
              .map(
                (channel) =>
                  `<span class="chan"><b>${esc(CHANNEL_LABELS[channel.channel] ?? channel.channel)}</b> <span class="vals">${esc(siteSummary(channel))}</span></span>`,
              )
              .join(' ');
      return [
        '<tr>',
        `<td class="name">${esc(ability.name)}<div class="id">${esc(ability.id)}</div></td>`,
        `<td class="lvl">${ability.learnLevel}</td>`,
        `<td class="lvl">${ability.ranks}</td>`,
        `<td class="src">${esc(SOURCE_LABELS[ability.source] ?? ability.source)}</td>`,
        `<td class="chans">${channels}</td>`,
        '</tr>',
      ].join('');
    })
    .join('\n');
}

function classSection(classInfo) {
  const groups = [
    ...classInfo.specs.map((spec) => ({ id: spec.id, name: spec.name, role: spec.role })),
    // The uncommitted bucket: abilities every spec excludes (warrior Heroic Strike).
    { id: null, name: 'No specialization', role: '' },
  ];
  const blocks = groups
    .map((group) => {
      const rows = abilityRows(classInfo, group.id);
      if (!rows) return '';
      return [
        `<h3>${esc(classInfo.name)} &mdash; ${esc(group.name)}${group.role ? ` <span class="role">(${esc(group.role)})</span>` : ''}</h3>`,
        '<table class="abilities">',
        '<thead><tr><th>Ability</th><th>Lvl</th><th>Ranks</th><th>Source</th><th>Tunable channels (shipped values)</th></tr></thead>',
        `<tbody>${rows}</tbody>`,
        '</table>',
      ].join('\n');
    })
    .filter(Boolean)
    .join('\n');
  return [
    `<section class="class-block"><h2>${esc(classInfo.name)}</h2>`,
    `<p class="note">${classInfo.abilities.length} abilities, ${classInfo.specs.length} specializations. An ability appears under every specialization that can cast it, so a shared-kit spell is listed once per spec.</p>`,
    blocks,
    '</section>',
  ].join('\n');
}

function weaponSection(weapons) {
  const rows = weapons
    .map((weapon) =>
      [
        '<tr>',
        `<td class="name">${esc(weapon.name)}<div class="id">${esc(weapon.id)}</div></td>`,
        `<td class="src">${esc(weapon.hand)}${weapon.dagger ? ' (dagger)' : ''}</td>`,
        `<td class="lvl">${num(weapon.min)} to ${num(weapon.max)}</td>`,
        `<td class="lvl">${num(weapon.speed)}s</td>`,
        `<td class="lvl">${num(weapon.dps)}</td>`,
        `<td class="src">${weapon.kind === 'classRanged' ? 'Class kit' : 'Item'}</td>`,
        '</tr>',
      ].join(''),
    )
    .join('\n');
  return [
    '<section class="class-block"><h2>Weapons: white swing damage and timer</h2>',
    `<p class="note">${weapons.length} auto-attack profiles. Every one exposes the same two channels, <b>White swing damage</b> (the min and max of the swing roll) and <b>Swing timer</b> (seconds between swings). A swing-timer factor above 1 makes the weapon slower, so it is a damage-per-second nerf; the tuner never lets the timer fall below one simulation tick.</p>`,
    '<table class="abilities">',
    '<thead><tr><th>Weapon</th><th>Type</th><th>Damage</th><th>Swing</th><th>DPS</th><th>Source</th></tr></thead>',
    `<tbody>${rows}</tbody>`,
    '</table>',
    '</section>',
  ].join('\n');
}

function channelGlossary(channels) {
  const rows = channels
    .map(
      (channel) =>
        `<tr><td class="name">${esc(CHANNEL_LABELS[channel] ?? channel)}<div class="id">${esc(channel)}</div></td><td>${esc(CHANNEL_NOTES[channel] ?? '')}</td></tr>`,
    )
    .join('\n');
  return [
    '<h2>The channel vocabulary</h2>',
    '<p class="note">A channel is one aspect of an ability. The set is closed: every tunable number in the game is classified into exactly one of these, and a guard test fails the build if a class rework adds a number that fits none of them.</p>',
    '<table class="abilities"><thead><tr><th>Channel</th><th>What it moves</th></tr></thead>',
    `<tbody>${rows}</tbody></table>`,
  ].join('\n');
}

const CHANNEL_NOTES = {
  damage_direct:
    'Instant and cast damage: direct rolls, weapon-strike bonuses, weapon multipliers, imbue and judgement damage.',
  damage_dot: 'The total of a damage-over-time effect, and channelled drain ticks.',
  damage_aoe: 'Area, chain, ground-zone, cone and orb damage.',
  damage_finisher: 'Combo-point finisher damage: the base, the per-point scaling and its variance.',
  damage_reflect: 'Damage a thorns-style aura deals back per melee hit taken.',
  heal_direct:
    'Direct, area and chain healing, plus percentage-of-health heals, leech shares and resurrect health fractions.',
  heal_hot: 'The total of a healing-over-time effect.',
  absorb: 'Shield amounts, including per-resource absorb rates.',
  threat: 'Flat bonus threat and the threat multiplier on an ability, per rank.',
  spell_power:
    'A multiplier on the ability spell power / attack power coefficient. Offered only where something on the ability actually scales with power.',
  resource_cost: 'Rage, mana or energy cost per rank, spend caps, and self-damage costs.',
  resource_gain:
    'Resource an ability grants: rage on interrupt or on area hits, mana from life tap, combo points awarded.',
  cooldown: 'The ability cooldown, and the internal cooldown of a charge-limited aura.',
  cast_time: 'Cast time per rank and the total duration of a channel.',
  effect_magnitude:
    'Aura, buff and debuff strength: attack power drains, damage-done percentages, haste and speed multipliers, snare strength, proc chances.',
  duration_effect:
    'How long a beneficial or damage-over-time effect lasts: buffs, shields, zones, DoTs and HoTs.',
  duration_control:
    'How long an impairment lasts: stun, root, silence, fear, polymorph, incapacitate, snare, interrupt lockout.',
  radius: 'Area of effect radius, and cone angle.',
  range: 'Cast range, including the minimum range of a ranged shot.',
  distance: 'Travel and displacement distances: blink, knockback, dash, and the boarball kicks.',
  targets:
    'Target counts and stack limits: chain jumps, maximum targets, dispel counts, sunder stacks, ability charges.',
  swing_damage: 'The minimum and maximum of a weapon auto-attack ("white") damage roll.',
  swing_speed:
    'Seconds between auto-attack swings. Above 1 is slower, which lowers damage per second.',
};

async function main() {
  const { buildClassTuningCatalog, TUNING_CHANNELS } = await loadCatalog();
  const catalog = buildClassTuningCatalog();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const abilityTotal = catalog.classes.reduce((sum, entry) => sum + entry.abilities.length, 0);
  const sliderTotal = catalog.classes.reduce(
    (sum, entry) =>
      sum + entry.abilities.reduce((inner, ability) => inner + ability.channels.length, 0),
    0,
  );
  const weaponSliderTotal = catalog.weapons.reduce(
    (sum, weapon) => sum + weapon.channels.length,
    0,
  );

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Class Power Tuner by Furyogen (WIP)</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  html, body { max-width: 100%; overflow-x: hidden; }
  body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; font-size: 10pt; line-height: 1.45; margin: 0; }
  h1 { font-size: 26pt; margin: 0 0 4pt; }
  h1 .by { font-size: 15pt; color: #6b5518; font-style: italic; font-weight: normal; white-space: nowrap; }
  h2 { font-size: 15pt; margin: 20pt 0 6pt; border-bottom: 1.5pt solid #8a6f2d; padding-bottom: 3pt; page-break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 12pt 0 4pt; color: #6b5518; page-break-after: avoid; }
  .sub { color: #555; font-size: 11pt; margin: 0 0 14pt; }
  .note { color: #444; font-size: 9pt; margin: 4pt 0 8pt; }
  h1 .wip-tag { font-size: 11pt; font-weight: bold; color: #6b5518; border: 1.2pt solid #8a6f2d;
                border-radius: 3pt; padding: 1pt 5pt; vertical-align: middle; letter-spacing: 0.5pt; }
  .wip { background: #fbf5e2; border-left: 3pt solid #8a6f2d; padding: 6pt 9pt; margin: 10pt 0;
         font-size: 9.2pt; color: #3a3227; page-break-inside: avoid; }
  .role { color: #777; font-weight: normal; font-size: 9pt; }
  table.abilities { width: 100%; border-collapse: collapse; margin-bottom: 8pt; font-size: 8.4pt; }
  table.abilities th { background: #efe9d8; border: 0.5pt solid #c9bd9a; padding: 3pt 4pt; text-align: left; font-size: 8.4pt; }
  table.abilities td { border: 0.5pt solid #ddd5bd; padding: 3pt 4pt; vertical-align: top; }
  td.name { width: 21%; font-weight: bold; }
  td.name .id { font-weight: normal; color: #888; font-size: 7.4pt; font-family: "Courier New", monospace; }
  td.lvl { width: 6%; text-align: center; }
  td.src { width: 11%; }
  td.chans { font-size: 8pt; }
  .chan { display: inline-block; margin: 0 6pt 2pt 0; }
  .chan .vals { color: #6b5518; font-family: "Courier New", monospace; font-size: 7.6pt; }
  .none { color: #999; font-style: italic; }
  .class-block { page-break-before: always; }
  figure.shot { margin: 0 0 14pt; page-break-inside: avoid; }
  /* Cap the height so two captures fit a page instead of one per page. */
  figure.shot img { width: 100%; max-height: 118mm; object-fit: contain; object-position: top; border: 0.75pt solid #bbb; }
  figure.shot.tall img { max-height: 150mm; }
  figure.shot figcaption { font-size: 8.4pt; color: #444; margin-top: 3pt; }
  ul, ol { margin: 4pt 0 8pt 16pt; padding: 0; }
  li { margin-bottom: 3pt; }
  code { font-family: "Courier New", monospace; font-size: 8.6pt; background: #f4f0e4; padding: 0 2pt; }
  .kpi { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8pt; margin: 10pt 0 14pt; }
  .kpi div { border: 0.75pt solid #c9bd9a; background: #faf7ee; padding: 6pt 8pt; min-width: 0; }
  .kpi b { display: block; font-size: 17pt; color: #6b5518; }
  .kpi span { font-size: 8pt; color: #555; }
</style></head><body>

<h1>Class Power Tuner <span class="by">by Furyogen</span> <span class="wip-tag">WIP</span></h1>
<p class="sub">World of ClaudeCraft: operator reference and complete tunable surface.<br>
Generated ${new Date().toISOString().slice(0, 10)} from the live content tables.</p>

<div class="kpi">
  <div><b>9</b><span>classes, 27 specializations</span></div>
  <div><b>${abilityTotal}</b><span>abilities</span></div>
  <div><b>${catalog.weapons.length}</b><span>weapon swing profiles</span></div>
  <div><b>${sliderTotal + weaponSliderTotal}</b><span>individual sliders</span></div>
</div>

<h2>What this is</h2>
<p>The Class Power Tuner is an operator-facing balance lever in the admin dashboard. It exposes
every aspect of every ability of every class as a multiplier slider, plus the white-swing damage
and swing timer of every weapon. Saved changes are stored per realm and applied to the world at
the next server restart.</p>
<p>It exists because two of the nine classes have been reworked and now outperform the other
seven. Closing that gap previously meant editing content source and shipping a build; with the
tuner it is a slider and a restart.</p>
<p>This edition follows <b>Shaman</b>, <b>Hunter</b> and <b>Priest</b> through the dashboard.
Their owned-classes redesign has landed on this base, so every screenshot and every number in
the tables at the back is the redesigned kit rather than the one it replaced.</p>
<p class="wip"><b>Work in progress.</b> The tool is complete and the mechanism below is stable;
what moves under it is the CONTENT. The tables at the back and the screenshots are a snapshot of
the kit on <code>release/v0.37.0</code>, and the class reworks are still arriving one wave at a
time. No re-engineering is needed when a wave lands: the catalog is derived from the live content
tables, never hand-authored, so a redesigned class appears with the right sliders on its own and
this document is simply regenerated. Read the mechanism as settled and the numbers as of
today.</p>

<h2>Who can use it</h2>
<p>A <b>tuner</b> is someone <b>assigned to the role by Levy Street</b>, the project owner. It is
not something an operator can grant themselves or pick up by holding another staff role: the
designation is handed out deliberately, to the few people trusted to move class balance, and it
is revoked the same way.</p>
<p>Technically it is a dedicated staff role, <code>tuner</code>, carrying exactly two permissions:
<code>tuning.read</code> (see the sliders and the change history) and <code>tuning.write</code>
(save a document). The role carries nothing else: an account holding only <code>tuner</code>
cannot see player accounts, act on players, or read the anti-bot internals, and every other
admin endpoint answers it with 403. The permission is deliberately kept out of the read-only
<code>viewer</code> bundle, so the balance surface reaches named people rather than every
read-only seat.</p>
<p>Levy Street assigns it with the grant script (or the Staff page, for an account that already
holds staff roles). Every save is attributed to the account that made it in the change history
below, so the trail always names which assigned tuner moved a number and why:</p>
<p><code>node scripts/grant_admin.mjs &lt;username&gt; --roles tuner</code></p>

<h2>How a change reaches the world</h2>
<ol>
  <li>A tuner moves sliders in the dashboard and saves, with a note explaining why.</li>
  <li>The document is validated, stored as one row per realm, and appended to an audit trail
      recording the before and after documents, the operator and the note. An unchanged save
      records nothing.</li>
  <li>The page reports the change as <b>pending a restart</b>. The running world is untouched.</li>
  <li>At the next server boot the document is installed onto the ability and item tables once,
      before the world is constructed. The realm then reports the saved and running documents as
      in sync.</li>
</ol>
<p>Tuning is boot-scoped on purpose. Swapping ability values under a running world would change
numbers underneath in-flight casts and cooldowns, and would leave the server and every connected
client disagreeing for as long as the change took to propagate. The realm hands its installed
document to each client in the connection handshake, so client tooltips, cooldown pips and cost
predictions describe the numbers the server actually resolves.</p>

<h2>How a slider works</h2>
<p>Every slider is a multiplier from 0.10x to 3.00x in 0.01 steps, with 1.00x meaning "exactly as
authored". The shipped values are always shown, and once a slider moves, the resulting values are
shown beside them.</p>
<p>The multiplier is applied according to what the underlying number means, which is why the tool
can be trusted with fields that are not plain magnitudes:</p>
<ul>
  <li><b>Magnitudes</b> (damage, healing, seconds, yards, costs) scale directly. A whole number
      stays whole.</li>
  <li><b>Multipliers whose neutral point is 1</b> (a snare's 0.5 speed multiplier, a 2x threat
      multiplier, a 1.4 haste aura) move by their distance from 1. Buffing a 50% snare by 20%
      makes it slow harder, not turn into a speed boost.</li>
  <li><b>Normalized shares</b> (a resurrect health fraction, a proc chance) scale and then clamp
      to at most the whole.</li>
  <li><b>Marker auras</b> (stance flags, one-shot empower tokens, form toggles) are never offered
      a slider: scaling a marker cannot help and can only break a predicate that reads it.</li>
</ul>
<p>A slider that provably cannot change anything (a zero magnitude, a multiplier already at its
neutral 1) is not rendered, so every control on the page does something.</p>

<h2>The classes this is pointed at next</h2>
<p>Warrior and Mage were reworked first and pulled ahead of the rest; the tuner exists to close
that gap without a content release. The next three classes through the same door are
<b>Shaman</b>, <b>Hunter</b> and <b>Priest</b>, whose v0.29 redesigns are integrated in
<b>PR #2218</b> on <code>levy-street/world-of-claudecraft</code>, nine specializations in
total:</p>
<table class="abilities">
<thead><tr><th>Class</th><th>Specialization</th><th>The loop the redesign builds</th></tr></thead>
<tbody>
<tr><td class="name">Shaman</td><td class="src">Thundercall (Elemental)</td><td>Lightning caster: Fulmination banking, spent by shocks</td></tr>
<tr><td class="name"></td><td class="src">Warspirit (Enhancement)</td><td>Dual wield: Galeheart echoes and Flow State</td></tr>
<tr><td class="name"></td><td class="src">Spiritmend (Restoration)</td><td>Healer: Mending Current deposits, consumed by Cascading Mend</td></tr>
<tr><td class="name">Hunter</td><td class="src">Packlord (Beast Mastery)</td><td>Pet focused: Stampede, with Pack Command resets</td></tr>
<tr><td class="name"></td><td class="src">Coldsight (Marksmanship)</td><td>Ranged damage on the Cold Read mastery</td></tr>
<tr><td class="name"></td><td class="src">Fieldcraft (Survival)</td><td>Physical damage, Bloodhook contributions</td></tr>
<tr><td class="name">Priest</td><td class="src">Doctrine (Discipline)</td><td>Covenant loop, hybrid healing and damage</td></tr>
<tr><td class="name"></td><td class="src">Benison (Holy)</td><td>Vigil-based healing loop</td></tr>
<tr><td class="name"></td><td class="src">Vespers (Shadow)</td><td>Effigy loop, damage scaling off it</td></tr>
</tbody></table>
<p>The redesigned spec identities above are already live, and the tables at the back of this
document list every ability each of them can cast today, with the sliders it exposes. What
PR #2218 still changes is the kit behind those identities, and for Hunter the resource itself:
mana is replaced by Focus. <b>Neither needs any work in the tuner.</b> The catalog is derived
from the live content tables and the sliders come from the abilities' own effects, so on the
boot after that PR lands, the redesigned kit appears here with the right sliders, the Focus
costs show up on the resource-cost channel, and any retired ability drops out. The only thing
a rework can require is a row in the classification table, and the guard below is what says so
out loud.</p>

<h2>Why the coverage stays complete</h2>
<p>The tuner does not carry a hand-written list of knobs. One traversal of an ability definition
both lists the sliders and applies them, so the controls offered and the numbers changed cannot
drift apart, and the catalog the dashboard renders is derived from the live content tables. A
reworked or brand-new class therefore appears with the right sliders the moment its content
lands, with no dashboard work.</p>
<p>What keeps that honest is a guard test that walks every shipped ability and fails when it finds
a numeric field the classification table does not account for, plus a second guard requiring every
weapon the simulation reads to be present. A class rework that adds a new kind of number cannot
quietly ship an untunable one: the build goes red until the field is classified.</p>

${channelGlossary(TUNING_CHANNELS)}

<h2>The dashboard</h2>
${shotSection()}

${catalog.classes.map(classSection).join('\n')}

<section class="class-block">
${weaponSection(catalog.weapons)}
</section>

</body></html>`;

  fs.writeFileSync(HTML_PATH, html);
  console.log(`[ref] ${HTML_PATH} (${(html.length / 1024 / 1024).toFixed(1)} MB)`);

  if (WANT_PDF) {
    const puppeteer = (await import('puppeteer-core')).default;
    const { BROWSER_PATH } = await import('./browser_path.mjs');
    const browser = await puppeteer.launch({
      executablePath: BROWSER_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.goto(`file://${path.resolve(HTML_PATH)}`, { waitUntil: 'networkidle0' });
      await page.pdf({
        path: PDF_PATH,
        format: 'A4',
        printBackground: true,
        // The @page rule in the stylesheet owns the margin; setting it here too
        // double-applies it and pushes wide content past the printable area.
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate:
          '<div style="width:100%;font-size:8px;color:#888;text-align:center;font-family:Georgia,serif;">World of ClaudeCraft &mdash; Class Power Tuner by Furyogen (WIP) &mdash; <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      });
      const bytes = fs.statSync(PDF_PATH).size;
      console.log(`[ref] ${PDF_PATH} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
    } finally {
      await browser.close();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
