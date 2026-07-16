// Asset library builder: inventories every shipped and generated asset, cross
// references the game registries (which items/visual keys/skin slots actually
// use each file), inspects each GLB structurally, renders hash-cached
// thumbnails through the headless previewer, and emits a self-contained static
// HTML viewer at tmp/asset_pipeline/library/index.html.
//
// The registry parsers work on SOURCE TEXT (read-only, regex over the pure
// data registries), never by importing TS, per the scripts/ rules.
import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { REPO_ROOT } from './env.mjs';
import { weaponFamilyFor } from './families.mjs';
import { inspectGlb } from './glb.mjs';
import { renderHeldPreviews, renderSkinThumb, renderThumb } from './preview.mjs';

export const LIBRARY_DIR = join(REPO_ROOT, 'tmp/asset_pipeline/library');
const THUMBS_DIR = join(LIBRARY_DIR, 'thumbs');
const CACHE_FILE = join(LIBRARY_DIR, 'cache.json');

// Class -> body model, mirroring the CLASS_MODELS map in pipeline.mjs cmdSkin
// and the VISUALS urls (mage.glb serves priest/mage/warlock).
const SKIN_MODEL_CLASSES = {
  knight: ['warrior'],
  paladin: ['paladin'],
  ranger: ['hunter'],
  rogue: ['rogue'],
  mage: ['priest', 'mage', 'warlock'],
  barbarian: ['shaman'],
  druid: ['druid'],
};

// ---------------------------------------------------------------------------
// Registry parsers (pure text -> data; unit-tested against the real sources)
// ---------------------------------------------------------------------------

/** ITEM_WEAPON_VARIANTS source -> Map variantKey -> [itemIds]. */
export function parseItemVariants(src) {
  const map = new Map();
  const block = src.match(/export const ITEM_WEAPON_VARIANTS[^{]*\{([\s\S]*?)\n\};/);
  if (!block) return map;
  for (const m of block[1].matchAll(/^\s*([a-z0-9_]+):\s*'([a-z0-9_]+)',/gm)) {
    if (!map.has(m[2])) map.set(m[2], []);
    map.get(m[2]).push(m[1]);
  }
  return map;
}

/** KAYKIT_WEAPON_ACCESSORY source -> Map weaponKey -> grip family string. */
export function parseAccessoryMap(src) {
  const map = new Map();
  const block = src.match(/const KAYKIT_WEAPON_ACCESSORY[^{]*\{([\s\S]*?)\n\};/);
  if (!block) return map;
  for (const m of block[1].matchAll(/^\s*([a-z0-9_]+):\s*'([A-Za-z0-9_]+)',/gm)) {
    map.set(m[1], m[2]);
  }
  return map;
}

/** weapon_grip.ts source -> Map weaponKey -> { pos?, rot?, scale? } grip override.
 *  Comments are stripped first so an example line inside the registry block can
 *  never be mis-parsed as a real entry. */
export function parseGripOverrides(src) {
  const map = new Map();
  const block = src.match(/WEAPON_GRIP_OVERRIDES[^{]*\{([\s\S]*?)\};/);
  if (!block) return map;
  const body = block[1].replace(/\/\/[^\n]*/g, '');
  for (const m of body.matchAll(/([a-z0-9_]+):\s*\{([^}]*)\}/gi)) {
    const o = {};
    const pos = m[2].match(/pos:\s*\[([^\]]*)\]/);
    const rot = m[2].match(/rot:\s*\[([^\]]*)\]/);
    const scale = m[2].match(/scale:\s*(-?[\d.]+)/);
    if (pos) o.pos = pos[1].split(',').map((n) => Number(n.trim()));
    if (rot) o.rot = rot[1].split(',').map((n) => Number(n.trim()));
    if (scale) o.scale = Number(scale[1]);
    map.set(m[1], o);
  }
  return map;
}

/** weapon_vfx_tuning.ts source -> Map weaponKey -> flat channel-multiplier
 *  object (the saved inspector slider state). Comments are stripped first so
 *  an example row in a comment can never be mis-parsed as a real entry. */
export function parseVfxTuning(src) {
  const map = new Map();
  const block = src.match(/WEAPON_VFX_TUNING[^{]*\{([\s\S]*?)\n\};/);
  if (!block) return map;
  const body = block[1].replace(/\/\/[^\n]*/g, '');
  for (const m of body.matchAll(/([a-z0-9_]+):\s*\{([^}]*)\}/gi)) {
    const o = {};
    for (const ch of m[2].matchAll(/([a-z]+):\s*(-?[\d.]+)/g)) {
      o[ch[1]] = Number(ch[2]);
    }
    map.set(m[1], o);
  }
  return map;
}

/** characters/manifest.ts source -> Map modelRelPath -> [visualKeys]. Resolves
 *  the PLAYERS/ENEMIES/CREATURES/WEAPONS template constants and collects both
 *  body urls and attach urls. */
export function parseVisualUrls(src) {
  const dirs = {
    PLAYERS: 'models/chars/players',
    ENEMIES: 'models/chars/enemies',
    CREATURES: 'models/creatures',
    WEAPONS: 'models/weapons',
  };
  const byPath = new Map();
  const add = (relPath, key) => {
    if (!byPath.has(relPath)) byPath.set(relPath, []);
    if (!byPath.get(relPath).includes(key)) byPath.get(relPath).push(key);
  };
  // visualKey: { url: `${DIR}/file.glb` ... } blocks, including nested attach
  // urls; attribute each url between this key and the next to the key.
  const keyRe = /^\s{2}([a-z0-9_]+):\s*\{/gm;
  const keys = [...src.matchAll(keyRe)].map((m) => ({ key: m[1], at: m.index }));
  for (let i = 0; i < keys.length; i++) {
    const end = keys[i + 1]?.at ?? src.length;
    const slice = src.slice(keys[i].at, end);
    for (const u of slice.matchAll(/`\$\{(PLAYERS|ENEMIES|CREATURES|WEAPONS)\}\/([^`]+)`/g)) {
      add(`${dirs[u[1]]}/${u[2]}`, keys[i].key);
    }
  }
  return byPath;
}

/** characters/manifest.ts source -> Map atlasRelPath -> [{key, index}] from the
 *  SKINS lists (index 0 is the null embedded default, so file indexes start at
 *  the position within the array). */
export function parseSkinsMap(src) {
  const map = new Map();
  const block = src.match(/export const SKINS[^{]*\{([\s\S]*?)\n\};/);
  if (!block) return map;
  const entryRe = /^\s{2}(player_[a-z0-9_]+):\s*\[([\s\S]*?)\],/gm;
  for (const m of block[1].matchAll(entryRe)) {
    const key = m[1];
    let index = 0;
    for (const raw of m[2].split(',')) {
      const item = raw.trim();
      if (!item) continue;
      const file = item.match(/`\$\{SKINS_DIR\}\/([^`]+)`/);
      if (file) {
        const rel = `textures/skins/${file[1]}`;
        if (!map.has(rel)) map.set(rel, []);
        map.get(rel).push({ key, index });
      }
      index++;
    }
  }
  return map;
}

/** sim/content/skins.ts source -> Map chromaId -> rank (MECH_CHROMAS). */
export function parseMechChromas(src) {
  const map = new Map();
  const block = src.match(/MECH_CHROMAS[^=]*=\s*\[([\s\S]*?)\n\]/);
  if (!block) return map;
  for (const m of block[1].matchAll(/id:\s*'([a-z0-9_]+)',\s*rank:\s*'(uncommon|rare|epic)'/g)) {
    map.set(m[1], m[2]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function sha12(path) {
  return createHash('sha1').update(readFileSync(path)).digest('hex').slice(0, 12);
}

function slugName(s) {
  return s.replace(/[^a-zA-Z0-9_]+/g, '_');
}

/** Every .ts source under src/, concatenated once, for the generic
 *  "is this file referenced anywhere" scan. */
function sourceHaystack() {
  const files = walk(join(REPO_ROOT, 'src')).filter((f) => f.endsWith('.ts'));
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

/** Build the full asset inventory (no rendering yet). */
export function collectInventory() {
  const registries = {
    variants: parseItemVariants(readFileSync(join(REPO_ROOT, 'src/ui/weapon_variants.ts'), 'utf8')),
    accessory: parseAccessoryMap(
      readFileSync(join(REPO_ROOT, 'src/render/characters/assets.ts'), 'utf8'),
    ),
    grip: parseGripOverrides(
      readFileSync(join(REPO_ROOT, 'src/render/characters/weapon_grip.ts'), 'utf8'),
    ),
    vfxTuning: parseVfxTuning(
      readFileSync(join(REPO_ROOT, 'src/render/weapon_vfx_tuning.ts'), 'utf8'),
    ),
    visuals: parseVisualUrls(
      readFileSync(join(REPO_ROOT, 'src/render/characters/manifest.ts'), 'utf8'),
    ),
    skins: parseSkinsMap(
      readFileSync(join(REPO_ROOT, 'src/render/characters/manifest.ts'), 'utf8'),
    ),
    chromas: parseMechChromas(readFileSync(join(REPO_ROOT, 'src/sim/content/skins.ts'), 'utf8')),
  };
  const haystack = sourceHaystack();
  const assets = [];

  // 1. Every GLB under public/models.
  for (const abs of walk(join(REPO_ROOT, 'public/models')).filter((f) => f.endsWith('.glb'))) {
    const rel = relative(join(REPO_ROOT, 'public'), abs); // models/...
    const parts = rel.split('/');
    const category = parts[1] === 'chars' ? `chars/${parts[2]}` : parts[1];
    const name = parts[parts.length - 1].replace(/\.glb$/, '');
    const entry = {
      id: `glb:${rel}`,
      kind: 'model',
      category,
      name,
      path: rel,
      abs,
      bytes: statSync(abs).size,
      registration: { referenced: haystack.includes(`${name}.glb`) },
    };
    if (category === 'weapons') {
      const grip = registries.accessory.get(name) ?? null;
      const items = registries.variants.get(name) ?? [];
      const iconRel = `ui/weapons/${name}.jpg`;
      entry.registration = {
        gripFamily: grip,
        itemIds: items,
        icon: existsSync(join(REPO_ROOT, 'public', iconRel)) ? iconRel : null,
        visualKeys: registries.visuals.get(rel) ?? [],
        gripOverride: registries.grip.get(name) ?? null,
        vfxTuning: registries.vfxTuning.get(name) ?? null,
        referenced: !!grip || items.length > 0 || (registries.visuals.get(rel) ?? []).length > 0,
      };
      entry.family = weaponFamilyFor(name)?.name ?? null;
    } else {
      const visualKeys = registries.visuals.get(rel) ?? [];
      entry.registration.visualKeys = visualKeys;
      if (visualKeys.length) entry.registration.referenced = true;
    }
    assets.push(entry);
  }

  // 2. Class skin atlases (textures/skins/<model>/*.png).
  for (const abs of walk(join(REPO_ROOT, 'public/textures/skins')).filter((f) =>
    f.endsWith('.png'),
  )) {
    const rel = relative(join(REPO_ROOT, 'public'), abs);
    const [, , model, file] = rel.split('/');
    const slots = registries.skins.get(rel) ?? [];
    assets.push({
      id: `skin:${rel}`,
      kind: 'skin',
      category: 'skins',
      name: `${model}/${file.replace(/\.png$/, '')}`,
      path: rel,
      abs,
      bytes: statSync(abs).size,
      model,
      modelGlb: `models/chars/players/${model}.glb`,
      classes: SKIN_MODEL_CLASSES[model] ?? [],
      registration: {
        slots,
        isBase: file === 'base.png',
        referenced: slots.length > 0 || file === 'base.png',
      },
    });
  }

  // 3. Combat Mech chroma textures (skip the *_emis glow maps as entries; note
  //    their presence on the matching chroma instead).
  const mechTexDir = join(REPO_ROOT, 'public/models/chars/players/Mech/textures');
  const mechGlb = 'models/chars/players/Mech/characters/CombatMech.glb';
  for (const abs of walk(mechTexDir).filter((f) => f.endsWith('.png') && !f.includes('_emis'))) {
    const rel = relative(join(REPO_ROOT, 'public'), abs);
    const file = rel
      .split('/')
      .pop()
      .replace(/\.png$/, '');
    const chromaId = file.replace(/^combatmech_(rare_|epic_)?/, '');
    const rank = registries.chromas.get(chromaId) ?? null;
    assets.push({
      id: `chroma:${rel}`,
      kind: 'skin',
      category: 'mech chromas',
      name: file,
      path: rel,
      abs,
      bytes: statSync(abs).size,
      model: 'CombatMech',
      modelGlb: mechGlb,
      chromaId,
      registration: {
        rank,
        hasEmissive: existsSync(abs.replace(/\.png$/, '_emis.png')),
        referenced: rank !== null,
      },
    });
  }

  // 4. Generated pipeline jobs (tmp/asset_pipeline/<job>/job.json).
  const jobsRoot = join(REPO_ROOT, 'tmp/asset_pipeline');
  if (existsSync(jobsRoot)) {
    for (const id of readdirSync(jobsRoot)) {
      const jobFile = join(jobsRoot, id, 'job.json');
      if (!existsSync(jobFile)) continue;
      let state;
      try {
        state = JSON.parse(readFileSync(jobFile, 'utf8'));
      } catch {
        continue;
      }
      const name = state.name ?? id;
      const builtGlb = join(jobsRoot, id, `${name}.glb`);
      const previewDir = join(jobsRoot, id, 'preview');
      const previews = existsSync(previewDir)
        ? readdirSync(previewDir)
            .filter((f) => f.endsWith('.png'))
            .map((f) => `../${id}/preview/${f}`)
        : [];
      // Let a generated weapon be grip-tuned + saved from the viewer. Resolve its
      // VAR_* grip in priority order: the live grip of an already --applied weapon
      // (KAYKIT_WEAPON_ACCESSORY), else the family the job was GENERATED with
      // (job.json `family`, authoritative no matter how the weapon is named, e.g.
      // "..._stave"/"..._knife"), else a last-resort guess from the name. The
      // override is keyed by name and honored once the weapon is --applied as that
      // variant. Anything that resolves to no VAR_* grip stays unsaveable.
      const appliedGrip = state.kind === 'weapon' ? (registries.accessory.get(name) ?? null) : null;
      const gripFamily =
        state.kind === 'weapon'
          ? (appliedGrip ??
            weaponFamilyFor(state.family)?.grip ??
            weaponFamilyFor(name)?.grip ??
            null)
          : null;
      assets.push({
        id: `job:${id}`,
        weaponKey: gripFamily ? name : null,
        kind: 'job',
        category: 'generated',
        name: `${state.kind ?? 'job'}: ${name}`,
        path: `tmp/asset_pipeline/${id}`,
        abs: existsSync(builtGlb) ? builtGlb : null,
        bytes: existsSync(builtGlb) ? statSync(builtGlb).size : 0,
        // Weapon-lane jobs carry their grip family so the live viewer can
        // equip them on characters exactly like applied weapons.
        family: state.kind === 'weapon' ? (weaponFamilyFor(name)?.name ?? null) : null,
        job: {
          id,
          lane: state.kind ?? null,
          steps: Object.fromEntries(
            Object.entries(state.steps ?? {}).map(([k, v]) => [k, v.status]),
          ),
          tasks: state.tasks ?? {},
          validation: state.validation
            ? {
                ok: state.validation.ok,
                errors: state.validation.errors,
                warnings: state.validation.warnings,
              }
            : null,
        },
        previews,
        registration: {
          referenced: false,
          generated: true,
          gripFamily,
          gripOverride: registries.grip.get(name) ?? null,
          vfxTuning: registries.vfxTuning.get(name) ?? null,
        },
      });
    }
  }

  // Mark which assets the viewer may delete: ONLY those backed by a generation
  // job (every shipped/base weapon has none, so it can never be deleted). Attach
  // the job id so the delete call can target it directly.
  const genJobByName = new Map();
  for (const a of assets) {
    if (a.kind === 'job' && a.job?.id) {
      genJobByName.set(a.weaponKey ?? a.name.replace(/^[^:]+:\s*/, ''), a.job.id);
    }
  }
  for (const a of assets) {
    if (a.kind === 'job') {
      a.registration = { ...(a.registration ?? {}), deletable: true };
    } else if (a.category === 'weapons' && genJobByName.has(a.name)) {
      a.registration = { ...a.registration, deletable: true, jobId: genJobByName.get(a.name) };
    }
  }

  return assets;
}

// ---------------------------------------------------------------------------
// Rendering + inspection (hash-cached)
// ---------------------------------------------------------------------------

function loadCache() {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return { inspect: {} };
  }
}

/** Inspect + thumbnail every asset, using the content-hash cache. Mutates the
 *  entries in place (adds thumb/held/inspect/error fields). */
export async function enrichAssets(assets, { full = false, log = console.log } = {}) {
  mkdirSync(THUMBS_DIR, { recursive: true });
  const cache = loadCache();
  let done = 0;
  const total = assets.length;

  for (const asset of assets) {
    done++;
    try {
      if (asset.kind === 'model' || (asset.kind === 'job' && asset.abs)) {
        const hash = sha12(asset.abs);
        asset.hash = hash;
        if (!cache.inspect[hash]) {
          const r = await inspectGlb(asset.abs);
          cache.inspect[hash] = {
            tris: r.tris,
            verts: r.verts,
            meshes: r.meshes,
            materials: r.materials,
            textures: r.textures,
            clips: r.clips,
            skins: r.skins,
            joints: r.joints.length,
            bounds: r.bounds,
          };
        }
        asset.inspect = cache.inspect[hash];
        const thumb = join(THUMBS_DIR, `${slugName(asset.name)}.${hash}.png`);
        if (!existsSync(thumb)) {
          log(`  [${done}/${total}] render ${asset.name}`);
          await renderThumb(asset.abs, thumb);
        }
        asset.thumb = `thumbs/${slugName(asset.name)}.${hash}.png`;
        // Weapons additionally get the in-hand composite (the game-grip proof).
        if (asset.category === 'weapons') {
          const held = join(THUMBS_DIR, `${slugName(asset.name)}.${hash}.held.png`);
          if (!existsSync(held)) {
            const files = await renderHeldPreviews(asset.abs, THUMBS_DIR, {
              lift: weaponFamilyFor(asset.name)?.lift,
              maxHeight: weaponFamilyFor(asset.name)?.maxHeight,
            });
            // renderHeldPreviews writes held_hero/held_right; move to hash names.
            for (const f of files) {
              const base = f.split('/').pop();
              const dest =
                base === 'held_hero.png'
                  ? held
                  : join(THUMBS_DIR, `${slugName(asset.name)}.${hash}.held_right.png`);
              writeFileSync(dest, readFileSync(f));
            }
          }
          asset.held = `thumbs/${slugName(asset.name)}.${hash}.held.png`;
          asset.heldRight = `thumbs/${slugName(asset.name)}.${hash}.held_right.png`;
        }
        // Rigged models: a per-clip pose frame for EVERY animation, so the
        // library shows all animations. (--full is retained as a no-op flag for
        // back-compat; clip frames now always render for rigged models.)
        void full;
        if (asset.inspect.clips?.length && asset.kind === 'model') {
          const clipDir = join(THUMBS_DIR, `${slugName(asset.name)}.${hash}.clips`);
          if (!existsSync(clipDir)) {
            log(
              `  [${done}/${total}] render ${asset.inspect.clips.length} clips for ${asset.name}`,
            );
            const { renderPreviews } = await import('./preview.mjs');
            await renderPreviews(asset.abs, clipDir, { size: 320, views: [] });
          }
          asset.clipFrames = readdirSync(clipDir)
            .filter((f) => f.endsWith('.png'))
            .map((f) => `thumbs/${slugName(asset.name)}.${hash}.clips/${f}`);
        }
      } else if (asset.kind === 'skin') {
        const modelAbs = join(REPO_ROOT, 'public', asset.modelGlb);
        if (!existsSync(modelAbs)) throw new Error(`model missing: ${asset.modelGlb}`);
        const hash = `${sha12(modelAbs)}-${sha12(asset.abs)}`;
        asset.hash = hash;
        const thumb = join(THUMBS_DIR, `${slugName(asset.name)}.${hash}.png`);
        if (!existsSync(thumb)) {
          log(`  [${done}/${total}] render skin ${asset.name}`);
          await renderSkinThumb(modelAbs, asset.abs, thumb);
        }
        asset.thumb = `thumbs/${slugName(asset.name)}.${hash}.png`;
        asset.atlas = `../../../public/${asset.path}`;
      } else if (asset.kind === 'job') {
        // No built GLB (failed/incomplete job): use its hero preview if present.
        const hero = asset.previews.find((p) => p.endsWith('/hero.png'));
        if (hero) asset.thumb = hero;
      }
    } catch (err) {
      asset.error = String(err.message ?? err).slice(0, 200);
    }
  }
  writeFileSync(CACHE_FILE, JSON.stringify(cache));
  return assets;
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

export function emitViewer(assets) {
  const template = readFileSync(
    join(REPO_ROOT, 'scripts/asset_pipeline/viewer_template.html'),
    'utf8',
  );
  const data = {
    generatedAt: new Date().toISOString(),
    repoRoot: REPO_ROOT,
    // repoGlb / repoAtlas are repo-relative paths the live viewer fetches from
    // the --serve /repo/* route; abs is dropped from the shipped data.
    assets: assets.map(({ abs, ...rest }) => {
      const a = rest;
      let repoGlb;
      let repoAtlas;
      if (a.kind === 'model') {
        repoGlb = `public/${a.path}`;
      } else if (a.kind === 'skin') {
        repoGlb = `public/${a.modelGlb}`;
        repoAtlas = `public/${a.path}`;
      } else if (a.kind === 'job' && abs) {
        repoGlb = relative(REPO_ROOT, abs);
      }
      return { ...a, repoGlb, repoAtlas };
    }),
  };
  // </script>-safe JSON embedding.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = template.replace('__ASSET_DATA__', json);
  const out = join(LIBRARY_DIR, 'index.html');
  mkdirSync(LIBRARY_DIR, { recursive: true });
  writeFileSync(out, html);
  return out;
}

// ---------------------------------------------------------------------------
// Live server (--serve): serves the viewer with live 3D rendering. Static file
// open still works (thumbnail strip); serving adds real GLB rendering by
// exposing three.js, the viewer_live module, and a guarded /repo/* file route.
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Build the three.js browser bundle (ESM) once and return its source. */
async function buildThreeBundle() {
  const esbuild = await import('esbuild');
  const result = await esbuild.build({
    entryPoints: [join(REPO_ROOT, 'scripts/asset_pipeline/three_bundle_entry.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

/** Start the live viewer http server. Returns { server, url }.
 *  `refresh` (optional): an async fn that re-inventories and re-emits index.html;
 *  when provided it runs on each page load so newly generated/applied assets
 *  appear on reload without restarting the command. */
export async function serveLibrary({ port = 5180, refresh = null } = {}) {
  const http = await import('node:http');
  const { readFileSync: rf, existsSync: ex, statSync: st } = await import('node:fs');
  const { extname, join: pjoin, normalize: pnorm } = await import('node:path');
  const wiz = await import('./wizard.mjs');
  const threeBundle = await buildThreeBundle();
  // Viewer page modules are read per request (not cached) so edits to the live
  // viewer / wizard / VFX layer show up on a plain page reload.
  const pageModule = (name) => rf(join(REPO_ROOT, `scripts/asset_pipeline/${name}`), 'utf8');

  // Only these repo subtrees are reachable via /repo/* (never .env, src, etc.).
  const ALLOWED = ['public/', 'tmp/asset_pipeline/'];
  const send = (res, code, type, body) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  const sendJson = (res, code, obj) => send(res, code, MIME['.json'], JSON.stringify(obj));
  const readBody = (req) =>
    new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
        if (data.length > 1e6) req.destroy();
      });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
      req.on('error', () => resolve({}));
    });

  // The wizard action layer: POST endpoints spawn a pipeline step (the browser
  // polls status), GET /api/wizard/status reports progress + preview artifacts.
  async function handleApi(req, res, url) {
    if (req.method === 'GET' && url === '/api/wizard/status') {
      const q = new URL(req.url, 'http://x').searchParams;
      return sendJson(res, 200, wiz.wizardStatus(q.get('job') || ''));
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
    const body = await readBody(req);
    try {
      if (url === '/api/grip/save') {
        const integrate = await import('./integrate.mjs');
        return sendJson(res, 200, { actions: integrate.saveGripOverride(body) });
      }
      if (url === '/api/vfx/save') {
        const integrate = await import('./integrate.mjs');
        return sendJson(res, 200, { actions: integrate.saveVfxTuning(body) });
      }
      if (url === '/api/wizard/model') return sendJson(res, 200, wiz.startModel(body));
      if (url === '/api/wizard/texture') return sendJson(res, 200, wiz.textureAsset(body));
      if (url === '/api/wizard/finish') return sendJson(res, 200, wiz.finishAsset(body));
      if (url === '/api/wizard/import') return sendJson(res, 200, wiz.importModel(body));
      if (url === '/api/wizard/apply') return sendJson(res, 200, wiz.applyAsset(body));
      if (url === '/api/asset/delete') return sendJson(res, 200, wiz.deleteAsset(body));
      if (url === '/api/asset/reveal') return sendJson(res, 200, await wiz.revealAsset(body));
      if (url === '/api/model/update') return sendJson(res, 200, await wiz.updateModel(body));
      if (url === '/api/model/export') return sendJson(res, 200, await wiz.compressExport(body));
      return sendJson(res, 404, { error: 'unknown action' });
    } catch (err) {
      return sendJson(res, 400, { error: String(err.message ?? err) });
    }
  }

  // Rebuild the baked asset snapshot on each page load so newly generated jobs
  // and freshly applied assets show up without restarting `library --serve`.
  // The rebuild (collectInventory -> enrichAssets -> emitViewer) is content-hash
  // cached, so a warm reload only re-renders assets that actually changed.
  // Overlapping loads share one in-flight rebuild; a failed rebuild falls back
  // to the last good index.html rather than 500ing.
  let refreshing = null;
  const doRefresh = () => {
    if (!refresh) return Promise.resolve();
    if (!refreshing) {
      refreshing = Promise.resolve()
        .then(refresh)
        .finally(() => {
          refreshing = null;
        });
    }
    return refreshing;
  };
  const serveIndex = async (res) => {
    try {
      await doRefresh();
    } catch {
      // keep serving the previous snapshot if a rebuild fails
    }
    let html = rf(join(LIBRARY_DIR, 'index.html'), 'utf8');
    html = html.replace('window.__LIVE__ = false;', 'window.__LIVE__ = true;');
    html = html.replace(
      '</body>',
      '<script type="module" src="/viewer_live.js"></script>\n' +
        '<script type="module" src="/wizard_ui.js"></script>\n</body>',
    );
    send(res, 200, MIME['.html'], html);
  };

  // Stream a dropped file to a server-side temp path (browsers can't hand us the
  // real filesystem path) and return it, so import + ref-image can point the
  // pipeline at a file that lives on this machine. Runs before readBody so it
  // isn't size-capped; the pipeline reads the returned path directly.
  const UPLOAD_DIR = pjoin(REPO_ROOT, 'tmp/asset_pipeline/_uploads');
  const UPLOAD_EXTS = new Set(['glb', 'png', 'jpg', 'jpeg', 'webp']);
  const handleUpload = (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    const ext = (q.get('ext') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!UPLOAD_EXTS.has(ext))
      return sendJson(res, 400, { error: `unsupported file type: .${ext}` });
    const base =
      (q.get('name') || 'upload')
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .slice(0, 40) || 'upload';
    mkdirSync(UPLOAD_DIR, { recursive: true });
    const abs = pjoin(UPLOAD_DIR, `${base}_${Date.now()}.${ext}`);
    const out = createWriteStream(abs);
    let bytes = 0;
    let tooBig = false;
    req.on('data', (c) => {
      bytes += c.length;
      if (bytes > 200 * 1024 * 1024) {
        tooBig = true;
        req.destroy();
        out.destroy();
      }
    });
    req.pipe(out);
    out.on('finish', () =>
      tooBig
        ? sendJson(res, 413, { error: 'file too large (200 MB max)' })
        : sendJson(res, 200, { path: abs }),
    );
    out.on('error', (e) => sendJson(res, 500, { error: String(e.message ?? e) }));
  };

  const server = http.createServer((req, res) => {
    try {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      if (url === '/api/wizard/upload' && req.method === 'POST') return void handleUpload(req, res);
      if (url.startsWith('/api/')) return void handleApi(req, res, url);
      if (url === '/wizard_ui.js') return send(res, 200, MIME['.js'], pageModule('wizard_ui.js'));
      if (url === '/' || url === '/index.html') return void serveIndex(res);
      if (url === '/three.bundle.js') return send(res, 200, MIME['.js'], threeBundle);
      if (url === '/viewer_live.js')
        return send(res, 200, MIME['.js'], pageModule('viewer_live.js'));
      if (url === '/weapon_vfx.js') return send(res, 200, MIME['.js'], pageModule('weapon_vfx.js'));
      if (url.startsWith('/thumbs/')) {
        const p = pjoin(LIBRARY_DIR, url.slice(1));
        if (ex(p) && st(p).isFile())
          return send(res, 200, MIME[extname(p)] ?? 'application/octet-stream', rf(p));
        return send(res, 404, 'text/plain', 'not found');
      }
      if (url.startsWith('/repo/')) {
        const rel = pnorm(url.slice('/repo/'.length)).replace(/^(\.\.[/\\])+/, '');
        if (!ALLOWED.some((a) => rel.startsWith(a)))
          return send(res, 403, 'text/plain', 'forbidden');
        const p = pjoin(REPO_ROOT, rel);
        if (!p.startsWith(REPO_ROOT)) return send(res, 403, 'text/plain', 'forbidden');
        if (ex(p) && st(p).isFile()) {
          return send(res, 200, MIME[extname(p)] ?? 'application/octet-stream', rf(p));
        }
        return send(res, 404, 'text/plain', 'not found');
      }
      return send(res, 404, 'text/plain', 'not found');
    } catch (err) {
      return send(res, 500, 'text/plain', String(err.message ?? err));
    }
  });

  await new Promise((resolve) => server.listen(port, resolve));
  return { server, url: `http://localhost:${port}/` };
}
