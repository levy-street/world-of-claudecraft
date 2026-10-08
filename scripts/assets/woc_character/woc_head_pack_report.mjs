// Merge the per-type head pack build reports (woc_head_pack.py --report) with what actually
// shipped into scripts/assets/woc_character/woc_head_pack.report.json:
//   - texture stats per material, measured on the RAW (pre-compression, PNG) export exactly as
//     tmp/woc_heads/hairlum.mjs measures them (opaque texels, linear RGB, luminance
//     0.2126/0.7152/0.0722, near-black atlas padding below 0.0005 skipped), plus the tint-table
//     row each tinted material implies (hair / brow: the median luminance; skin / eye: the
//     median linear RGB), so the runtime's WOC_HEAD_TINT_TABLE can be re-pinned per material;
//   - the shipped GLB (served from public/<catalog url>): bytes, required extensions, every
//     texture's size and bytes and the materials sampling it, every node's shipped morph names;
//   - a catalog check: every wocHeadAllNodes(type) node present as a child of `head`, mesh
//     named like its node, no skins or animations, one target name per morph target.
//
//   node scripts/assets/woc_character/woc_head_pack_report.mjs \
//     --a-report <report_a.json> --a-raw <raw_a.glb> [--a-compress <log>] \
//     --b-report <report_b.json> --b-raw <raw_b.glb> [--b-compress <log>] \
//     [--previous <the replaced pack's report.json>] \
//     [--out scripts/assets/woc_character/woc_head_pack.report.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CATALOG = path.join(ROOT, 'src/render/characters/woc_head_catalog.ts');

function parseArgs(argv) {
  const o = { out: path.join(ROOT, 'scripts/assets/woc_character/woc_head_pack.report.json') };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(a|b)-(report|raw|compress)$/.exec(argv[i]);
    if (m) {
      if (!o[m[1]]) o[m[1]] = {};
      o[m[1]][m[2]] = argv[++i];
    } else if (argv[i] === '--out') o.out = argv[++i];
    else if (argv[i] === '--previous') o.previous = argv[++i];
  }
  for (const t of ['a', 'b']) {
    if (!o[t]?.report || !o[t]?.raw) throw new Error(`--${t}-report and --${t}-raw are required`);
  }
  return o;
}

const toLin = (c) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const r4 = (x) => +x.toFixed(4);

/** hairlum.mjs's statistics over one texture's opaque texels. */
async function textureStats(png) {
  const { data, info } = await sharp(Buffer.from(png))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const lums = [];
  const rs = [];
  const gs = [];
  const bs = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = toLin(data[i]);
    const g = toLin(data[i + 1]);
    const b = toLin(data[i + 2]);
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (l < 0.0005) continue;
    lums.push(l);
    rs.push(r);
    gs.push(g);
    bs.push(b);
  }
  const sorted = (a) => Float64Array.from(a).sort();
  const at = (s, q) => s[Math.floor(s.length * q)] ?? 0;
  const L = sorted(lums);
  return {
    size: [info.width, info.height],
    medLumLinear: r4(at(L, 0.5)),
    p10: r4(at(L, 0.1)),
    p90: r4(at(L, 0.9)),
    medRGBLinear: [rs, gs, bs].map((c) => r4(at(sorted(c), 0.5))),
    n: lums.length,
  };
}

const ROLES = ['skin', 'eye', 'hair', 'brow', 'liner', 'metal'];
const roleOf = (name) => ROLES.find((r) => name.toLowerCase().startsWith(`${r}_`)) ?? null;

async function rawStats(file) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(file);
  const cache = new Map();
  const out = {};
  for (const m of doc.getRoot().listMaterials()) {
    const name = m.getName();
    const role = roleOf(name);
    const tex = m.getBaseColorTexture();
    if (!tex) {
      out[name] = { role, flatBaseColorFactor: m.getBaseColorFactor().map(r4) };
      continue;
    }
    let st = cache.get(tex);
    if (!st) {
      st = await textureStats(tex.getImage());
      cache.set(tex, st);
    }
    out[name] = { role, image: tex.getName(), ...st };
  }
  return out;
}

function tintRows(stats) {
  const rows = {};
  for (const [name, s] of Object.entries(stats)) {
    if (s.medLumLinear === undefined) continue;
    if (s.role === 'hair' || s.role === 'brow')
      rows[name] = { role: s.role, refLum: s.medLumLinear };
    else if (s.role === 'skin' || s.role === 'eye')
      rows[name] = { role: s.role, ref: s.medRGBLinear };
  }
  return rows;
}

function readGlb(file) {
  const buf = fs.readFileSync(file);
  const jlen = buf.readUInt32LE(12);
  const js = JSON.parse(buf.subarray(20, 20 + jlen).toString('utf8'));
  return { buf, js, bin: 20 + jlen + 8 };
}

function shippedFacts(file, want) {
  const { buf, js, bin } = readGlb(file);
  const nodes = js.nodes ?? [];
  const byName = new Map(nodes.map((n, i) => [n.name, i]));
  const head = byName.get('head');
  const kids = new Set(head === undefined ? [] : (nodes[head].children ?? []));
  const problems = [];
  const morphs = {};
  for (const nm of want) {
    const i = byName.get(nm);
    if (i === undefined) {
      problems.push(`missing ${nm}`);
      continue;
    }
    const n = nodes[i];
    if (!kids.has(i)) problems.push(`${nm} not a child of head`);
    if (n.skin !== undefined) problems.push(`${nm} has a skin`);
    const m = js.meshes[n.mesh];
    if (!m || m.name !== nm) problems.push(`${nm} mesh named ${m?.name}`);
    const names = m?.extras?.targetNames ?? [];
    if (names.length !== (m?.primitives?.[0]?.targets?.length ?? 0))
      problems.push(`${nm} target names out of step`);
    morphs[nm] = names;
  }
  const extra = [...kids].map((i) => nodes[i].name).filter((n) => !want.includes(n));
  if (extra.length) problems.push(`extra head children ${extra.join(',')}`);
  if ((js.skins ?? []).length) problems.push('skins shipped');
  if ((js.animations ?? []).length) problems.push('animations shipped');
  const users = {};
  for (const m of js.materials ?? []) {
    const t = m.pbrMetallicRoughness?.baseColorTexture?.index;
    if (t === undefined) continue;
    const tx = js.textures[t];
    const src = tx.extensions?.KHR_texture_basisu?.source ?? tx.source;
    if (!users[src]) users[src] = [];
    users[src].push(m.name);
  }
  const textures = (js.images ?? []).map((im, i) => {
    const bv = js.bufferViews[im.bufferView];
    const b = buf.subarray(bin + (bv.byteOffset ?? 0), bin + (bv.byteOffset ?? 0) + bv.byteLength);
    const size = im.mimeType === 'image/ktx2' ? [b.readUInt32LE(20), b.readUInt32LE(24)] : null;
    return {
      image: im.name,
      mime: im.mimeType,
      size,
      bytes: bv.byteLength,
      materials: users[i] ?? [],
    };
  });
  return {
    bytes: buf.length,
    skins: (js.skins ?? []).length,
    animations: (js.animations ?? []).length,
    extensionsRequired: js.extensionsRequired ?? [],
    textures,
    textureBytes: textures.reduce((a, t) => a + t.bytes, 0),
    morphs,
    catalogCheck: { nodes: want.length, headChildren: kids.size, problems },
  };
}

function compressFacts(logFile) {
  if (!logFile || !fs.existsSync(logFile)) return {};
  const line = fs.readFileSync(logFile, 'utf8').trim().split('\n').pop();
  try {
    const j = JSON.parse(line);
    return {
      codec: j.codec,
      dropped_zero_morph_targets: j.droppedTargets,
      dropped_skins: j.droppedSkins,
    };
  } catch {
    return {};
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const cat = await import(CATALOG);
  // the pack this build replaces (its report), summarised under `previous`
  const prev = o.previous ? JSON.parse(fs.readFileSync(o.previous, 'utf8')) : {};
  const types = {};
  for (const t of ['a', 'b']) {
    const rep = JSON.parse(fs.readFileSync(o[t].report, 'utf8'));
    // the whole compressed pack (the catalog no longer names it: the runtime streams the
    // split files, woc_head_catalog.ts wocHeadAllUrls)
    const shippedPath = path.join('public', 'models/chars/players/woc', `head_type_${t}.glb`);
    const want = cat.wocHeadAllNodes(t);
    const facts = shippedFacts(path.join(ROOT, shippedPath), want);
    const stats = await rawStats(o[t].raw);
    for (const [nm, node] of Object.entries(rep.nodes)) {
      node.morph_targets_shipped = facts.morphs[nm] ?? null;
      node.material_roles = Object.fromEntries(node.materials.map((m) => [m, roleOf(m)]));
    }
    const { morphs: _m, ...shipped } = facts;
    const cf = compressFacts(o[t].compress);
    types[t] = {
      ...rep,
      shipped: { path: shippedPath, ...shipped, ...cf },
      texture_stats: stats,
      tint_table_rows: tintRows(stats),
    };
    if (facts.catalogCheck.problems.length) {
      console.error(`type ${t}: ${facts.catalogCheck.problems.join('; ')}`);
      process.exitCode = 1;
    }
  }
  const report = {
    generated_by:
      'scripts/assets/woc_character/woc_head_pack.py + woc_head_pack_compress.mjs + woc_head_pack_report.mjs',
    notes: [
      'Node L/R: _L is the character left (+X in Blender, the head file FSC_Eye_L side).',
      'All-zero morph targets are dropped per mesh at compress time; look morphs up by name in extras.targetNames.',
      'Shape key values are zeroed in the pack; source_value in morph_meta is the value the head file had saved.',
      "Every tinted material (skin_, eye_, hair_, brow_) ships the head file's UN-RECOLOURED source paint, never " +
        'its last Face Studio live recolour; texture_stats and tint_table_rows are measured on exactly that paint ' +
        '(the raw export, before KTX2), the way tmp/woc_heads/hairlum.mjs measures.',
      'Materials that share one texture (the seven beards cut from one source, byte-identical eyelid sources) ' +
        'share one image in the pack, so their stats are identical.',
      'A hairstyle added on 2026-09-29 carries two materials: hair_<id> (the strands) and hair_<id>_scalp (the ' +
        "fitted scalp cap, procedural grain in the style's hair colour, so it tints as hair).",
      "Piercings are placed with Face Studio's own socket rule on the catalog default look; a slider that moves " +
        'a socket (the lip with FS_Chin_Softness, the brow with the eye and brow sliders) ships as a morph target ' +
        'on that piercing (rigid socket motion), so the runtime drives it by name like every other piece.',
      'cover_pokes lists vertices outside an outward-facing cover surface along the ray from the head centre; a ' +
        'piece hanging below a rim is listed too, so read it with the review renders (hair is hidden under every ' +
        'helm by the catalog).',
      'Normal maps are not shipped (the head files link them only on the three original male hairstyles).',
    ],
    rebuild: {
      blender:
        "/Applications/Blender.app/Contents/MacOS/Blender -b '<WOC Armor Studio>/claude-animation-20260924/WOC_Characters_Anim_v01.blend' --python scripts/assets/woc_character/woc_head_pack.py -- --type <a|b> --out <raw.glb> --report <report.json> [--review <dir>] [--no-render]",
      compress_a:
        'KTX_BIN=<ktx-software/bin> DYLD_FALLBACK_LIBRARY_PATH=<ktx-software/bin> node scripts/assets/woc_character/woc_head_pack_compress.mjs <raw_a.glb> public/models/chars/players/woc/head_type_a.glb --rdo 2',
      compress_b:
        'KTX_BIN=<ktx-software/bin> DYLD_FALLBACK_LIBRARY_PATH=<ktx-software/bin> node scripts/assets/woc_character/woc_head_pack_compress.mjs <raw_b.glb> public/models/chars/players/woc/head_type_b.glb --rdo 4',
      report:
        'node scripts/assets/woc_character/woc_head_pack_report.mjs --a-report <report_a.json> --a-raw <raw_a.glb> --a-compress <log> --b-report <report_b.json> --b-raw <raw_b.glb> --b-compress <log> [--previous <replaced report.json>]',
      manifest: 'node scripts/build_media_manifest.mjs generate',
    },
    previous: prev.types
      ? Object.fromEntries(
          Object.entries(prev.types).map(([t, v]) => [
            t,
            {
              head_blend: v.head_blend,
              shipped_bytes: v.shipped?.bytes,
              fit: v.fit && { scale: v.fit.scale, translation: v.fit.translation },
            },
          ]),
        )
      : undefined,
    types,
  };
  fs.writeFileSync(o.out, `${JSON.stringify(report, null, 1)}\n`);
  for (const t of ['a', 'b']) {
    const s = types[t].shipped;
    console.log(
      `type ${t}: ${s.path} ${s.bytes} bytes, ${s.textures.length} textures (${s.textureBytes} bytes), catalog ${s.catalogCheck.headChildren}/${s.catalogCheck.nodes} nodes, problems ${s.catalogCheck.problems.length}`,
    );
  }
  console.log('wrote', path.relative(ROOT, o.out));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
