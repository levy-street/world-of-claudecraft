// Builds the Last Bell concept book: docs/design/last-bell-concept-art.html
//
// Reads the per-figure manifests that scripts/assets/last_bell_crew/plates.py
// wrote next to its renders, converts the plates to WebP, and emits one
// self-contained page. The copy, palette chips and plate captions all come from
// crew.CREW via those manifests, so the page can never drift from the models.
//
// Usage:
//   node scripts/assets/last_bell_crew/build_concept_book.mjs <plates-dir>
//
// Run by hand, like everything under scripts/assets/. Deterministic: same
// manifests in, same page out.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import sharp from 'sharp';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const PLATES_IN = resolve(process.argv[2] ?? join(REPO, 'tmp', 'crew_plates'));
const DOC = join(REPO, 'docs', 'design', 'last-bell-concept-art.html');
const IMG_DIR = join(REPO, 'docs', 'design', 'last-bell-concept-art');

// Page order is story order: you meet the ferryman, land, meet the squad, then
// the things that come through the breaks.
const ORDER = [
  'ewald',
  'marsh',
  'coalfast',
  'coalfast_helm',
  'ollun',
  'edda',
  'saul',
  'tam',
  'nell',
  'riftspawn',
  'breach_wretch',
  'void_stalker',
  'tidemill_stalker',
  'sundered_horror',
];

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

async function toWebp(src, outName, width) {
  const out = join(IMG_DIR, outName);
  let pipe = sharp(src);
  if (width) pipe = pipe.resize({ width, withoutEnlargement: true });
  await pipe.webp({ quality: 78, alphaQuality: 85, effort: 6 }).toFile(out);
  return outName;
}

function loadManifests() {
  if (!existsSync(PLATES_IN)) throw new Error(`no plates directory: ${PLATES_IN}`);
  const found = readdirSync(PLATES_IN)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(PLATES_IN, f), 'utf8')));
  const rank = (id) => (ORDER.indexOf(id) < 0 ? ORDER.length : ORDER.indexOf(id));
  return found.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

// A figure's in-world height in yards: VisualDef.height times a mob's scale. The
// GLB is authored at the source kit's scale and normalised at runtime, so the
// honest number for a concept book is the RUNTIME one, not the source bbox.
const HUMANOID_YD = 2.6;

function heightYards(entry) {
  return entry.height_yards ?? HUMANOID_YD;
}

function materialsLine(stats) {
  const body = stats.materials?.length ?? 0;
  const props = stats.prop_materials?.length ?? 0;
  if (!body) return 'n/a';
  const head = body === 1 ? '1 body (one draw)' : `${body} body`;
  return props ? `${head} + ${props} held` : head;
}

function weaponList(weapons = []) {
  if (!weapons.length) return '';
  const rows = weapons
    .map(
      (w) => `
      <li>
        <b>${esc(
          w.url
            .split('/')
            .pop()
            .replace(/\.glb$/, '')
            .replace(/_/g, ' '),
        )}</b>
        <code>${esc(w.bone)}</code>
        <em>${esc(w.why)}</em>
      </li>`,
    )
    .join('');
  return `<h3>What they carry</h3><ul class="weapons">${rows}</ul>`;
}

function paletteRow(palette = []) {
  if (!palette.length) return '';
  const chips = palette
    .map(
      ([label, hex, why]) => `
        <li class="chip">
          <span class="swatch" style="--c:${esc(hex)}"></span>
          <span class="chip-text">
            <b>${esc(label)}</b> <code>${esc(hex)}</code>
            <em>${esc(why)}</em>
          </span>
        </li>`,
    )
    .join('');
  return `<ul class="palette">${chips}</ul>`;
}

function figureSection(entry, images) {
  const turn = images.turntable.map((f) => `${esc(f)}`);
  const plates = (entry.plates ?? [])
    .map(
      (p, i) => `
      <figure class="plate">
        <img src="last-bell-concept-art/${esc(images.plates[i])}" alt="${esc(entry.name)}, ${esc(p.label)}" loading="lazy">
        <figcaption><b>${esc(p.label)}</b><span>${esc(p.clip)}</span></figcaption>
      </figure>`,
    )
    .join('');
  const notes = (entry.notes ?? []).map((n) => `<li>${esc(n)}</li>`).join('');

  return `
<section class="figure" id="${esc(entry.id)}">
  <header class="figure-head">
    <div class="ident">
      <h2>${esc(entry.name)}</h2>
      <p class="title">${esc(entry.title)}</p>
      <p class="post">${esc(entry.post)}</p>
    </div>
    <dl class="spec">
      <div><dt>Role</dt><dd>${esc(entry.role)}</dd></div>
      <div><dt>Height</dt><dd>${heightYards(entry).toFixed(2)} yd</dd></div>
      <div><dt>Triangles</dt><dd>${entry.stats.tris.toLocaleString('en-US')}</dd></div>
      <div><dt>Clips</dt><dd>${entry.stats.clips || 'none'}</dd></div>
      <div><dt>Materials</dt><dd>${esc(materialsLine(entry.stats))}</dd></div>
      <div><dt>Base</dt><dd><code>${esc(entry.base)}</code></dd></div>
      ${entry.family ? `<div><dt>Family</dt><dd>${esc(entry.family)}</dd></div>` : ''}
      ${entry.levels ? `<div><dt>Levels</dt><dd>${esc(entry.levels)}</dd></div>` : ''}
    </dl>
  </header>

  <div class="figure-body">
    <div class="turn-wrap">
      <div class="turn" data-frames="${turn.join(',')}" data-dir="last-bell-concept-art">
        <img class="turn-img" src="last-bell-concept-art/${turn[0]}" alt="${esc(entry.name)}, rotating turnaround">
      </div>
      <div class="turn-ctl">
        <button class="btn spin" type="button" aria-pressed="true">Pause</button>
        <input class="scrub" type="range" min="0" max="${turn.length - 1}" value="0"
               aria-label="${esc(entry.name)} turnaround angle">
      </div>
    </div>

    <div class="prose">
      <p>${esc(entry.blurb)}</p>
      <div class="signature">
        <h3>The authored detail</h3>
        <p>${esc(entry.signature)}</p>
      </div>
      ${paletteRow(entry.palette)}
      ${weaponList(entry.weapons)}
      ${notes ? `<h3>Design notes</h3><ul class="notes">${notes}</ul>` : ''}
    </div>
  </div>

  ${plates ? `<div class="plates">${plates}</div>` : ''}
</section>`;
}

function scaleChart(entries) {
  const tallest = Math.max(...entries.map(heightYards));
  const bars = entries
    .map((e) => {
      const h = heightYards(e);
      return `
      <li>
        <span class="bar" style="--h:${((h / tallest) * 100).toFixed(1)}%"></span>
        <span class="bar-label"><b>${esc(e.name)}</b><span>${h.toFixed(2)} yd</span></span>
      </li>`;
    })
    .join('');
  return `
<section class="figure" id="scale">
  <header class="figure-head"><div class="ident"><h2>Scale</h2>
    <p class="title">Every figure against the player's eye line</p>
    <p class="post">Runtime height in yards, the number <code>VisualDef.height</code> normalises each rig to</p>
  </div></header>
  <ul class="scale">${bars}</ul>
</section>`;
}

const CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{
  --ink-1000:#04090d; --ink-950:#071117; --ink-900:#0b171e; --ink-850:#10212a; --ink-800:#172b35;
  --gold-700:#926321; --gold-600:#bc8732; --gold-500:#d8a645; --gold-400:#f0c86d; --gold-300:#ffe5a3;
  --parch:#e8ddc6; --text:#cfd8dc; --faint:#8b9aa3;
  --rule:color-mix(in srgb, var(--gold-700) 45%, transparent);
}
html{scroll-behavior:smooth}
body{margin:0;background:
    radial-gradient(1200px 700px at 20% -10%, #12242e 0%, transparent 60%),
    radial-gradient(900px 600px at 90% 10%, #16202c 0%, transparent 55%),
    var(--ink-1000);
  color:var(--text);
  font:16px/1.62 "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:clamp(20px,4vw,56px)}
header.book{border-bottom:1px solid var(--rule);padding-bottom:28px;margin-bottom:8px}
.kicker{font:600 12px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;
  color:var(--gold-500);margin:0 0 14px}
h1{font-size:clamp(30px,5.2vw,52px);line-height:1.06;margin:0 0 12px;color:var(--parch);
  font-weight:600;letter-spacing:-.01em}
h1 small{display:block;font-size:clamp(14px,1.7vw,19px);color:var(--faint);font-weight:400;
  letter-spacing:0;margin-top:12px;font-style:italic}
.lede{max-width:76ch;color:#b8c4cb;margin:18px 0 0}
.toc{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:26px 0 0}
.toc a{display:inline-block;padding:6px 13px;border:1px solid var(--rule);border-radius:2px;
  color:var(--gold-300);text-decoration:none;font:500 12px/1.3 ui-sans-serif,system-ui,sans-serif;
  letter-spacing:.06em;text-transform:uppercase;background:rgba(255,229,163,.03)}
.toc a:hover{border-color:var(--gold-500);background:rgba(255,229,163,.09);color:var(--gold-400)}

.figure{margin:56px 0 0;padding:28px clamp(16px,2.4vw,32px) 32px;
  background:linear-gradient(180deg,rgba(23,43,53,.55),rgba(7,17,23,.5));
  border:1px solid var(--rule);border-radius:3px;
  box-shadow:0 1px 0 rgba(255,229,163,.07) inset, 0 18px 40px -28px #000}
.figure-head{display:flex;flex-wrap:wrap;gap:22px 34px;align-items:flex-start;
  justify-content:space-between;border-bottom:1px solid rgba(146,99,33,.28);padding-bottom:18px}
.ident h2{margin:0;font-size:clamp(23px,3vw,33px);color:var(--parch);font-weight:600;letter-spacing:-.005em}
.ident .title{margin:5px 0 0;color:var(--gold-500);font:600 12.5px/1.4 ui-sans-serif,system-ui,sans-serif;
  letter-spacing:.15em;text-transform:uppercase}
.ident .post{margin:5px 0 0;color:var(--faint);font-size:14px;font-style:italic}
.spec{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:12px 20px;margin:0;
  font:400 13px/1.4 ui-sans-serif,system-ui,sans-serif;min-width:min(100%,440px)}
.spec dt{color:var(--faint);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:3px}
.spec dd{margin:0;color:var(--parch)}
.spec code,.post code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--gold-300)}

.figure-body{display:grid;grid-template-columns:minmax(240px,340px) 1fr;gap:clamp(20px,3vw,40px);
  align-items:start;margin-top:26px}
.turn-wrap{position:sticky;top:20px}
.turn{background:
    radial-gradient(120% 80% at 50% 8%, rgba(216,166,69,.09), transparent 62%),
    linear-gradient(180deg,#0d1c24,#060f14);
  border:1px solid var(--rule);border-radius:3px;overflow:hidden;position:relative}
.turn::after{content:"";position:absolute;inset:auto 8% 5% 8%;height:14px;border-radius:50%;
  background:radial-gradient(50% 100% at 50% 50%, rgba(0,0,0,.6), transparent 70%)}
.turn-img{display:block;width:100%;height:auto;image-rendering:auto}
.turn-ctl{display:flex;gap:10px;align-items:center;margin-top:10px}
.btn{background:rgba(255,229,163,.06);border:1px solid var(--rule);color:var(--gold-300);
  border-radius:2px;padding:5px 12px;cursor:pointer;
  font:500 11.5px/1.3 ui-sans-serif,system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase}
.btn:hover{border-color:var(--gold-500);color:var(--gold-400)}
.scrub{flex:1;accent-color:var(--gold-500);min-width:0}

.prose h3{margin:24px 0 7px;font:600 11.5px/1.3 ui-sans-serif,system-ui,sans-serif;letter-spacing:.16em;
  text-transform:uppercase;color:var(--gold-500)}
.prose p{margin:0 0 12px;max-width:70ch}
.signature{margin:22px 0 4px;padding:16px 18px;border-left:2px solid var(--gold-600);
  background:linear-gradient(90deg,rgba(216,166,69,.09),transparent 85%)}
.signature h3{margin-top:0}
.signature p{margin:0;color:var(--parch)}
.notes{margin:0;padding-left:20px}
.notes li{margin:0 0 7px;color:#b8c4cb;max-width:72ch}

.palette{list-style:none;padding:0;margin:8px 0 0;display:grid;
  grid-template-columns:repeat(auto-fit,minmax(232px,1fr));gap:10px}
.chip{display:flex;gap:11px;align-items:flex-start;padding:9px 11px;border:1px solid rgba(146,99,33,.26);
  border-radius:2px;background:rgba(7,17,23,.5)}
.swatch{flex:0 0 auto;width:26px;height:38px;border-radius:2px;border:1px solid rgba(0,0,0,.55);
  background:linear-gradient(180deg,var(--c),color-mix(in srgb,var(--c) 48%,#000))}
.chip-text{font:400 12.5px/1.45 ui-sans-serif,system-ui,sans-serif;min-width:0}
.chip-text b{color:var(--parch);font-weight:600}
.chip-text code{display:inline-block;color:var(--gold-300);font-family:ui-monospace,Menlo,monospace;font-size:11px}
.chip-text em{display:block;color:var(--faint);font-style:normal;margin-top:2px}

.weapons{list-style:none;padding:0;margin:6px 0 0;display:grid;gap:8px}
.weapons li{padding:9px 12px;border:1px solid rgba(146,99,33,.26);border-radius:2px;
  background:rgba(7,17,23,.5);font:400 12.5px/1.45 ui-sans-serif,system-ui,sans-serif}
.weapons b{color:var(--parch);font-weight:600;text-transform:capitalize}
.weapons code{color:var(--gold-300);font-family:ui-monospace,Menlo,monospace;font-size:11px;
  margin-left:7px}
.weapons em{display:block;color:var(--faint);font-style:normal;margin-top:2px}
.plates{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:14px;margin-top:30px;
  border-top:1px solid rgba(146,99,33,.28);padding-top:24px}
.plate{margin:0;background:linear-gradient(180deg,#0d1c24,#060f14);border:1px solid rgba(146,99,33,.3);
  border-radius:3px;overflow:hidden}
.plate img{display:block;width:100%;height:auto}
.plate figcaption{padding:8px 11px 10px;border-top:1px solid rgba(146,99,33,.24);
  font:400 11.5px/1.35 ui-sans-serif,system-ui,sans-serif;display:flex;flex-direction:column;gap:2px}
.plate figcaption b{color:var(--parch);font-weight:600}
.plate figcaption span{color:var(--faint);font-family:ui-monospace,Menlo,monospace;font-size:10.5px}

.scale{list-style:none;padding:0;margin:26px 0 0;display:flex;align-items:flex-end;gap:clamp(8px,2vw,26px);
  min-height:230px;overflow-x:auto;padding-bottom:6px}
.scale li{flex:1 1 0;min-width:82px;display:flex;flex-direction:column;justify-content:flex-end;
  align-items:center;gap:10px;height:230px}
.bar{width:100%;max-width:64px;height:var(--h);border-radius:2px 2px 0 0;
  background:linear-gradient(180deg,var(--gold-500),var(--gold-700));
  border:1px solid rgba(0,0,0,.4);box-shadow:0 0 0 1px rgba(255,229,163,.14) inset}
.bar-label{text-align:center;font:400 11.5px/1.35 ui-sans-serif,system-ui,sans-serif;display:flex;
  flex-direction:column;gap:1px}
.bar-label b{color:var(--parch);font-weight:600}
.bar-label span{color:var(--faint)}

footer.book{margin:60px 0 0;padding-top:24px;border-top:1px solid var(--rule);color:var(--faint);
  font:400 13px/1.6 ui-sans-serif,system-ui,sans-serif}
footer.book code{color:var(--gold-300);font-family:ui-monospace,Menlo,monospace;font-size:12px}
footer.book ul{padding-left:20px;margin:8px 0 0}

@media (max-width:820px){
  .figure-body{grid-template-columns:1fr}
  .turn-wrap{position:static;max-width:340px}
}
@media (prefers-reduced-motion:reduce){.turn-img{transition:none}}
`;

const JS = `
// Turntables: cycle the pre-rendered stations, and let the reader scrub or drag.
// Honours prefers-reduced-motion by starting paused.
(function () {
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('.turn-wrap').forEach(function (wrap) {
    var stage = wrap.querySelector('.turn');
    var img = wrap.querySelector('.turn-img');
    var btn = wrap.querySelector('.spin');
    var scrub = wrap.querySelector('.scrub');
    var frames = stage.dataset.frames.split(',');
    var dir = stage.dataset.dir;
    var i = 0, timer = null;

    frames.forEach(function (f) { var p = new Image(); p.src = dir + '/' + f; });

    function show(n) {
      i = ((n % frames.length) + frames.length) % frames.length;
      img.src = dir + '/' + frames[i];
      scrub.value = String(i);
    }
    function play() {
      if (timer) return;
      timer = setInterval(function () { show(i + 1); }, 110);
      btn.textContent = 'Pause';
      btn.setAttribute('aria-pressed', 'true');
    }
    function stop() {
      clearInterval(timer); timer = null;
      btn.textContent = 'Spin';
      btn.setAttribute('aria-pressed', 'false');
    }
    btn.addEventListener('click', function () { timer ? stop() : play(); });
    scrub.addEventListener('input', function () { stop(); show(Number(scrub.value)); });

    var dragging = false, startX = 0, startI = 0;
    stage.addEventListener('pointerdown', function (e) {
      dragging = true; startX = e.clientX; startI = i; stop();
      stage.setPointerCapture(e.pointerId); stage.style.cursor = 'grabbing';
    });
    stage.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      show(startI + Math.round((e.clientX - startX) / 14));
    });
    stage.addEventListener('pointerup', function (e) {
      dragging = false; stage.releasePointerCapture(e.pointerId); stage.style.cursor = 'grab';
    });
    stage.style.cursor = 'grab';

    // only spin what the reader can actually see
    var io = new IntersectionObserver(function (rows) {
      rows.forEach(function (r) {
        if (r.isIntersecting && !calm && !dragging) play(); else stop();
      });
    }, { threshold: 0.25 });
    io.observe(wrap);
    if (calm) stop();
  });
})();
`;

async function main() {
  mkdirSync(IMG_DIR, { recursive: true });
  const entries = loadManifests();
  if (!entries.length) throw new Error(`no manifests in ${PLATES_IN}`);

  const sections = [];
  for (const entry of entries) {
    const images = { turntable: [], plates: [] };
    for (const f of entry.turntable) {
      images.turntable.push(await toWebp(join(PLATES_IN, f), f.replace(/\.png$/, '.webp'), 440));
    }
    for (const p of entry.plates) {
      images.plates.push(
        await toWebp(join(PLATES_IN, p.file), p.file.replace(/\.png$/, '.webp'), 560),
      );
    }
    if (entry.bust) {
      await toWebp(join(PLATES_IN, entry.bust), entry.bust.replace(/\.png$/, '.webp'), 420);
    }
    sections.push(figureSection(entry, images));
    process.stdout.write(
      `  ${entry.id}: ${images.turntable.length} turntable, ${images.plates.length} plates\n`,
    );
  }

  const toc = entries
    .map(
      (e) =>
        `<li><a href="#${esc(e.id)}">${esc(e.name.replace(/^(Warden|Riftwatch|Quartermaster|Mender|Bellkeeper|Ferryman|Sergeant) /, ''))}</a></li>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Last Bell of Gullhaven: Concept Book</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header class="book">
  <p class="kicker">World of ClaudeCraft &middot; The Farshore</p>
  <h1>The Last Bell of Gullhaven
    <small>Concept book: the watch, the island, and the things that come through the breaks.</small></h1>
  <p class="lede">Every figure here is the shipping model, not a painting of one. Each is built
    onto a KayKit Adventurers rig by a deterministic Blender factory
    (<code>scripts/assets/last_bell_crew/</code>): a repainted palette atlas, bespoke geometry
    rigidly skinned to single bones, and all 22 of the rig's shipped clips carried through
    untouched. One material each, so a crew member still costs one draw call. The turnarounds
    and pose plates below are renders of those exact GLBs, and every pose is a frame of a clip
    the game really plays.</p>
  <ul class="toc">${toc}<li><a href="#scale">Scale</a></li></ul>
</header>

${sections.join('\n')}

${scaleChart(entries)}

<footer class="book">
  <p><b>Lore anchors.</b> Story, cast and timeline come from the campaign's source of truth
    and its spec; nothing here invents a fact about the island.</p>
  <ul>
    <li><code>docs/design/last-bell-campaign.html</code>, the working source of truth</li>
    <li><code>docs/design/farshore-last-bell-spec.md</code> sections 4 (lore foundation) and 5 (principal cast)</li>
    <li><code>src/sim/content/farshore.ts</code> and <code>src/sim/content/last_bell_campaign.ts</code>,
      for posts, titles, greetings and the entity colours used as each figure's cloth</li>
    <li><code>scripts/assets/warden_hale_statue/model.py</code>, whose crest motif the living watch wears</li>
  </ul>
  <p>Regenerate: <code>blender --background --python scripts/assets/last_bell_crew/model.py</code>
    with <code>CREW_PLATES</code> set, then
    <code>node scripts/assets/last_bell_crew/build_concept_book.mjs &lt;plates-dir&gt;</code>.</p>
</footer>
</div>
<script>${JS}</script>
</body>
</html>
`;

  writeFileSync(DOC, html);
  process.stdout.write(`\nwrote ${DOC}\n`);
}

await main();
