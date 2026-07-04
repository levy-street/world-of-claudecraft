// Asset library builder: inventories every shipped and generated asset, cross
// references the game registries (which items/visual keys/skin slots actually
// use each file), inspects each GLB structurally, renders hash-cached
// thumbnails through the headless previewer, and emits a self-contained static
// HTML viewer at tmp/asset_pipeline/library/index.html.
//
// The registry parsers work on SOURCE TEXT (read-only, regex over the pure
// data registries), never by importing TS, per the scripts/ rules.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
      assets.push({
        id: `job:${id}`,
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
        registration: { referenced: false, generated: true },
      });
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

/** Start the live viewer http server. Returns { server, url }. */
export async function serveLibrary({ port = 5180 } = {}) {
  const http = await import('node:http');
  const { readFileSync: rf, existsSync: ex, statSync: st } = await import('node:fs');
  const { extname, join: pjoin, normalize: pnorm } = await import('node:path');
  const threeBundle = await buildThreeBundle();
  const liveModule = rf(join(REPO_ROOT, 'scripts/asset_pipeline/viewer_live.js'), 'utf8');

  // Only these repo subtrees are reachable via /repo/* (never .env, src, etc.).
  const ALLOWED = ['public/', 'tmp/asset_pipeline/'];
  const send = (res, code, type, body) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };

  const server = http.createServer((req, res) => {
    try {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      if (url === '/' || url === '/index.html') {
        let html = rf(join(LIBRARY_DIR, 'index.html'), 'utf8');
        html = html.replace('window.__LIVE__ = false;', 'window.__LIVE__ = true;');
        html = html.replace(
          '</body>',
          '<script type="module" src="/viewer_live.js"></script>\n</body>',
        );
        return send(res, 200, MIME['.html'], html);
      }
      if (url === '/three.bundle.js') return send(res, 200, MIME['.js'], threeBundle);
      if (url === '/viewer_live.js') return send(res, 200, MIME['.js'], liveModule);
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
