import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

export const PORTRAIT_RENDER_DEFINES = Object.freeze({
  'import.meta.env.DEV': 'true',
  'import.meta.env.PROD': 'false',
  'import.meta.env.TEST': 'false',
  'import.meta.env.BASE_URL': '"/"',
  'import.meta.env.VITE_API_ORIGIN': '""',
  'import.meta.env.VITE_DESKTOP_API_ORIGIN': '""',
  'import.meta.env.VITE_DESKTOP_APP': '""',
  'import.meta.env.VITE_DESKTOP_RELATIVE_API': '""',
  'import.meta.env.VITE_DISCORD_DISABLED': '""',
  'import.meta.env.VITE_NATIVE_APP': '""',
  'import.meta.env.VITE_REOWN_PROJECT_ID': '""',
  'import.meta.env.VITE_TURNSTILE_SITEKEY': '""',
  'import.meta.env.VITE_WALLET_DISABLED': '""',
});

export const PORTRAIT_BROWSER_ENTRY = 'scripts/wiki/stills_render_entry.js';
export const PORTRAIT_RENDER_FILES = Object.freeze([
  'scripts/render_finder_portraits.mjs',
  'scripts/lib/mob_portrait_jobs.mjs',
  'scripts/lib/mob_portrait_background.mjs',
]);
export const PORTRAIT_OUTPUT_CONTRACT = Object.freeze({
  pixels: 128,
  format: 'webp',
  quality: 88,
  alphaQuality: 100,
  effort: 6,
  backdrop: 'scripts/lib/mob_portrait_background.mjs',
});

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function fileDigest(repoRoot, relativePath) {
  const bytes = readFileSync(path.join(repoRoot, relativePath));
  return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
}

function colorHex(color) {
  if (color === null || color === undefined) return null;
  return `#${Number(color).toString(16).padStart(6, '0')}`;
}

function publicAssetDigest(repoRoot, runtimeUrl, cache) {
  const cached = cache.get(runtimeUrl);
  if (cached) return cached;
  if (
    typeof runtimeUrl !== 'string' ||
    runtimeUrl.length === 0 ||
    runtimeUrl.includes('://') ||
    runtimeUrl.includes('?') ||
    runtimeUrl.includes('#')
  ) {
    throw new Error(`portrait asset URL must be public-root relative: ${String(runtimeUrl)}`);
  }
  const publicDir = path.join(repoRoot, 'public');
  const relativePath = runtimeUrl.replace(/^\/+/, '');
  const absolutePath = path.resolve(publicDir, relativePath);
  if (!absolutePath.startsWith(`${publicDir}${path.sep}`)) {
    throw new Error(`portrait asset URL escapes public/: ${runtimeUrl}`);
  }
  if (!existsSync(absolutePath)) {
    throw new Error(`portrait asset does not exist: public/${relativePath}`);
  }
  const bytes = readFileSync(absolutePath);
  const digest = {
    url: runtimeUrl,
    path: `public/${relativePath}`,
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
  cache.set(runtimeUrl, digest);
  return digest;
}

function attachmentRecord(repoRoot, attachment, assetCache) {
  return {
    asset: publicAssetDigest(repoRoot, attachment.url, assetCache),
    bone: attachment.bone,
    position: attachment.position ?? null,
    rotationY: attachment.rotationY ?? null,
    gripRef: attachment.gripRef ?? null,
  };
}

function specFor(def) {
  const spec = { url: def.url, idle: def.clips?.idle ?? null, height: def.height };
  if (def.yaw) spec.yaw = def.yaw;
  if (def.hover) spec.hover = def.hover;
  if (def.show) spec.show = def.show;
  if (def.attach) spec.attach = def.attach;
  if (def.weaponFix) spec.weaponFix = def.weaponFix;
  if (def.tint !== undefined) spec.tintStrength = def.tintStrength ?? 0.4;
  return spec;
}

async function loadPortraitData(repoRoot) {
  const source = `
    export { FINDER_ACTIVITIES } from './src/sim/content/dungeon_finder.ts';
    export { MOBS } from './src/sim/data.ts';
    export { VISUALS, visualKeyFor } from './src/render/characters/manifest.ts';
  `;
  const built = await esbuild.build({
    stdin: {
      contents: source,
      resolveDir: repoRoot,
      sourcefile: 'mob-portrait-source-data.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  const dataUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
  return import(dataUrl);
}

function sourceRecord(repoRoot, mob, visualKey, def, assetCache) {
  const tintSource = def.tint === undefined ? 'none' : def.tint === 'entity' ? 'entity' : 'fixed';
  const resolvedTint =
    tintSource === 'none' ? null : tintSource === 'entity' ? (mob.color ?? null) : def.tint;
  const tintStrength = tintSource === 'none' ? null : (def.tintStrength ?? 0.4);
  const renderSpec = {
    model: publicAssetDigest(repoRoot, def.url, assetCache),
    idle: def.clips?.idle ?? null,
    height: def.height,
    yaw: def.yaw ?? null,
    hover: def.hover ?? null,
    show: def.show ?? null,
    attach: (def.attach ?? []).map((attachment) =>
      attachmentRecord(repoRoot, attachment, assetCache),
    ),
    weaponFix: def.weaponFix ?? null,
    tintStrength,
  };
  const tint = {
    source: tintSource,
    authored: tintSource === 'entity' ? 'entity' : colorHex(def.tint),
    resolved: colorHex(resolvedTint),
    strength: tintStrength,
  };
  return {
    renderSpec,
    tint,
    sourceFingerprint: sha256(JSON.stringify({ family: mob.family, visualKey, renderSpec, tint })),
  };
}

export async function buildMobPortraitJobs(repoRoot) {
  const { FINDER_ACTIVITIES, MOBS, VISUALS, visualKeyFor } = await loadPortraitData(repoRoot);
  const assetCache = new Map();
  const jobs = new Map();

  function addJob(mobId, finder) {
    const existing = jobs.get(mobId);
    if (existing) {
      existing.finder ||= finder;
      return;
    }
    const mob = MOBS[mobId];
    if (!mob) throw new Error(`portrait job references unknown mob ${mobId}`);
    const visualKey = visualKeyFor({ kind: 'mob', templateId: mobId, family: mob.family });
    const def = VISUALS[visualKey];
    if (!def) throw new Error(`no visual for portrait mob ${mobId} (visual key ${visualKey})`);
    const source = sourceRecord(repoRoot, mob, visualKey, def, assetCache);
    const tint =
      def.tint === undefined ? null : def.tint === 'entity' ? (mob.color ?? null) : def.tint;
    jobs.set(mobId, {
      mobId,
      finder,
      family: mob.family,
      visualKey,
      spec: specFor(def),
      tint,
      renderSpec: source.renderSpec,
      tintRecord: source.tint,
      sourceFingerprint: source.sourceFingerprint,
    });
  }

  for (const activity of FINDER_ACTIVITIES) {
    for (const encounter of activity.encounters) addJob(encounter.mobId, true);
  }
  for (const mobId of Object.keys(MOBS)) addJob(mobId, false);
  return [...jobs.values()];
}

export async function buildPortraitRendererContract(repoRoot, browserBundleBytes) {
  let bundleBytes = browserBundleBytes;
  if (!bundleBytes) {
    const built = await esbuild.build({
      entryPoints: [path.join(repoRoot, PORTRAIT_BROWSER_ENTRY)],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      define: PORTRAIT_RENDER_DEFINES,
      write: false,
      logLevel: 'silent',
    });
    bundleBytes = built.outputFiles[0].contents;
  }
  return {
    trackedFiles: PORTRAIT_RENDER_FILES.map((relativePath) => fileDigest(repoRoot, relativePath)),
    browserBundle: {
      entry: PORTRAIT_BROWSER_ENTRY,
      bytes: bundleBytes.length,
      sha256: sha256(bundleBytes),
      esbuildVersion: esbuild.version,
    },
    output: PORTRAIT_OUTPUT_CONTRACT,
  };
}

export function portraitRendererFingerprint(rendererContract) {
  return sha256(JSON.stringify(rendererContract));
}
