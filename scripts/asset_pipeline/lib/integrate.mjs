// Game integration: file placement, anchored registry edits, CREDITS rows, and
// code snippets for the judgment-required registrations.
//
// The --apply edits are deliberately limited to pure data registries with a
// test-enforced contract:
//   - KAYKIT_WEAPON_ACCESSORY (src/render/characters/assets.ts)  weapon grip family
//   - ITEM_WEAPON_VARIANTS   (src/ui/weapon_variants.ts)         item -> variant key
//   - SKINS['player_<cls>']  (src/render/characters/manifest.ts) class skin atlas list
//   - SKIN_COUNTS[cls]       (src/sim/content/skins.ts)          sim-side lockstep count
// Everything with gameplay judgment (VisualDef, MOB_KEYS, props, items, i18n)
// is emitted as a snippet for the driving agent to place.
//
// Every edit is idempotent (an existing key short-circuits) and anchored: we
// locate the declaration, walk to its matching closing bracket, and insert one
// line before it. If an anchor is missing the edit aborts loudly, never guesses.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { REPO_ROOT } from './env.mjs';

const FILES = {
  accessory: 'src/render/characters/assets.ts',
  variants: 'src/ui/weapon_variants.ts',
  manifest: 'src/render/characters/manifest.ts',
  skins: 'src/sim/content/skins.ts',
  credits: 'CREDITS.md',
};

function read(rel) {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}
function write(rel, content) {
  writeFileSync(resolve(REPO_ROOT, rel), content);
}

/** Index of the bracket closing the one that opens at `openIdx`. */
export function findBlockEnd(source, openIdx) {
  const open = source[openIdx];
  const close = { '{': '}', '[': ']', '(': ')' }[open];
  if (!close) throw new Error(`findBlockEnd: "${open}" is not an opening bracket`);
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error('findBlockEnd: unbalanced brackets');
}

/** Insert `line` (with trailing newline) just before the closing bracket of the
 *  block that starts at the first bracket after `anchor`. Handles single-line
 *  blocks too (`player_paladin: [null, x],`): the entry is spliced inline
 *  before the closing bracket instead of corrupting the preceding line. */
export function insertIntoBlock(source, anchor, line) {
  const at = source.indexOf(anchor);
  if (at === -1) throw new Error(`anchor not found: ${anchor.slice(0, 60)}...`);
  const openIdx = source.indexOf(
    anchor.trimEnd().endsWith('[') ? '[' : '{',
    at + anchor.length - 2,
  );
  if (openIdx === -1) throw new Error(`no opening bracket after anchor: ${anchor.slice(0, 60)}`);
  const closeIdx = findBlockEnd(source, openIdx);
  const lineStart = source.lastIndexOf('\n', closeIdx) + 1;
  if (lineStart <= openIdx) {
    // Single-line block: splice before the closing bracket, comma-separated
    // (a trailing comma before ] or } is valid TS).
    const before = source.slice(openIdx + 1, closeIdx).trimEnd();
    const sep = before === '' || before.endsWith(',') ? ' ' : ', ';
    return source.slice(0, closeIdx) + sep + line.trim() + source.slice(closeIdx);
  }
  return source.slice(0, lineStart) + line + source.slice(lineStart);
}

// ---------------------------------------------------------------------------
// Weapon registration (--apply capable; gated by tests/held_weapon_models.test.ts)
// ---------------------------------------------------------------------------

/** Copy the built GLB + icon into public/ and register the variant key in both
 *  code registries. `itemIds` map existing (or new) item ids to the key. */
export function registerWeapon({ key, gripFamily, glbPath, iconPath, itemIds = [] }) {
  if (!/^[a-z0-9_]+$/.test(key)) throw new Error(`weapon key must be snake_case: ${key}`);
  for (const itemId of itemIds) {
    if (!/^[a-z0-9_]+$/.test(itemId)) throw new Error(`item id must be snake_case: ${itemId}`);
  }
  const actions = [];

  const glbDest = resolve(REPO_ROOT, `public/models/weapons/${key}.glb`);
  // Refuse to clobber a shipped NON-variant weapon file: generic KayKit keys
  // (dagger, staff, wand, halberd, scythe, ...) exist as models/weapons GLBs
  // routed through the KayKit hand-grip path, not applyVariantGrip. A variant
  // registered by a previous --apply of the same key maps to a VAR_* family
  // and may be overwritten (that is a legitimate re-apply).
  const accessorySrc = read(FILES.accessory);
  const existing = accessorySrc.match(new RegExp(`^\\s*${key}: '([A-Za-z0-9_]+)',`, 'm'));
  if (existsSync(glbDest) && (!existing || !existing[1].startsWith('VAR_'))) {
    throw new Error(
      `public/models/weapons/${key}.glb already exists and is not a pipeline variant; ` +
        'pick a different --name (overwriting a shipped KayKit weapon would break its grip)',
    );
  }
  mkdirSync(dirname(glbDest), { recursive: true });
  copyFileSync(glbPath, glbDest);
  actions.push(`copied ${key}.glb -> public/models/weapons/`);
  if (iconPath) {
    const iconDest = resolve(REPO_ROOT, `public/ui/weapons/${key}.jpg`);
    mkdirSync(dirname(iconDest), { recursive: true });
    copyFileSync(iconPath, iconDest);
    actions.push(`copied ${key}.jpg -> public/ui/weapons/`);
  }

  let accessory = read(FILES.accessory);
  if (new RegExp(`^\\s*${key}:`, 'm').test(accessory)) {
    actions.push(`accessory map already has ${key} (skipped)`);
  } else {
    accessory = insertIntoBlock(
      accessory,
      'const KAYKIT_WEAPON_ACCESSORY: Record<string, string> = {',
      `  ${key}: '${gripFamily}',\n`,
    );
    write(FILES.accessory, accessory);
    actions.push(`registered ${key}: '${gripFamily}' in KAYKIT_WEAPON_ACCESSORY`);
  }

  let variants = read(FILES.variants);
  for (const itemId of itemIds) {
    if (new RegExp(`^\\s*${itemId}:`, 'm').test(variants)) {
      actions.push(`ITEM_WEAPON_VARIANTS already maps ${itemId} (skipped)`);
      continue;
    }
    variants = insertIntoBlock(
      variants,
      'export const ITEM_WEAPON_VARIANTS: Record<string, string> = {',
      `  ${itemId}: '${key}',\n`,
    );
    actions.push(`mapped ${itemId} -> ${key} in ITEM_WEAPON_VARIANTS`);
  }
  if (itemIds.length) write(FILES.variants, variants);
  return actions;
}

// ---------------------------------------------------------------------------
// Class-skin registration (--apply capable; gated by tests/skin_event.test.ts)
// ---------------------------------------------------------------------------

/** Register an alternate class-skin atlas: copies the texture, appends its url
 *  to SKINS['player_<cls>'], and bumps SKIN_COUNTS[cls] (the sim/render pair is
 *  a test-enforced lockstep). `model` is the skin dir (knight/ranger/mage/...). */
export function registerClassSkin({ cls, model, texturePath, suffix }) {
  if (!/^[a-z_]+$/.test(cls)) throw new Error(`bad class: ${cls}`);
  if (!/^[a-z0-9_]+$/.test(suffix)) throw new Error(`skin suffix must be snake_case: ${suffix}`);
  const actions = [];
  const rel = `textures/skins/${model}/alt_${suffix}.png`;
  const dest = resolve(REPO_ROOT, `public/${rel}`);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(texturePath, dest);
  actions.push(`copied atlas -> public/${rel}`);

  let manifest = read(FILES.manifest);
  const anchor = `player_${cls}: [`;
  // Idempotence must be scoped to THIS CLASS's SKINS array, not the whole file:
  // classes sharing a model (priest/mage/warlock all use the mage atlas) each
  // need their own SKINS entry pointing at the same shared atlas path.
  const anchorAt = manifest.indexOf(anchor);
  if (anchorAt === -1) {
    throw new Error(`SKINS has no entry for player_${cls}; add the class array first`);
  }
  const classBlockEnd = findBlockEnd(manifest, manifest.indexOf('[', anchorAt));
  const classBlock = manifest.slice(anchorAt, classBlockEnd);
  if (classBlock.includes(`${model}/alt_${suffix}.png`)) {
    actions.push(`SKINS.player_${cls} already lists ${model}/alt_${suffix}.png (skipped)`);
  } else {
    manifest = insertIntoBlock(
      manifest,
      anchor,
      `    \`\${SKINS_DIR}/${model}/alt_${suffix}.png\`,\n`,
    );
    write(FILES.manifest, manifest);
    actions.push(`appended skin to SKINS.player_${cls}`);

    // Lockstep bump in the sim data, scoped to the SKIN_COUNTS literal so a
    // same-named key elsewhere in the file can never be bumped by mistake.
    let skins = read(FILES.skins);
    const declAt = skins.indexOf('export const SKIN_COUNTS');
    if (declAt === -1) throw new Error('SKIN_COUNTS declaration not found');
    const openIdx = skins.indexOf('{', declAt);
    const closeIdx = findBlockEnd(skins, openIdx);
    const block = skins.slice(openIdx, closeIdx);
    const countRe = new RegExp(`(\\b${cls}:\\s*)(\\d+)`);
    const m = block.match(countRe);
    if (!m) throw new Error(`SKIN_COUNTS has no ${cls} entry`);
    const newBlock = block.replace(countRe, `$1${Number(m[2]) + 1}`);
    skins = skins.slice(0, openIdx) + newBlock + skins.slice(closeIdx);
    write(FILES.skins, skins);
    actions.push(`bumped SKIN_COUNTS.${cls} ${m[2]} -> ${Number(m[2]) + 1}`);
  }
  return actions;
}

// ---------------------------------------------------------------------------
// CREDITS.md
// ---------------------------------------------------------------------------

/** Append an attribution row (the "Project asset" style used for generated art).
 *  Idempotent on the asset cell text. */
export function appendCreditsRow({ assets, source }) {
  let credits = read(FILES.credits);
  if (credits.includes(assets)) return [`CREDITS.md already lists "${assets}" (skipped)`];
  const rows = [...credits.matchAll(/^\|.*\|$/gm)];
  if (!rows.length) throw new Error('CREDITS.md table not found');
  const last = rows[rows.length - 1];
  const insertAt = last.index + last[0].length + 1;
  const row = `| ${assets} | World of ClaudeCraft | ${source} | Project asset |\n`;
  credits = credits.slice(0, insertAt) + row + credits.slice(insertAt);
  write(FILES.credits, credits);
  return ['appended CREDITS.md row'];
}

// ---------------------------------------------------------------------------
// Snippets (agent-applied; gameplay judgment required)
// ---------------------------------------------------------------------------

export function visualDefSnippet({ name, kind, height, clips, hasCast, hasJump }) {
  const url = `\${CREATURES}/${name}.glb`;
  const clipLines = [
    `      idle: '${clips.idle ?? 'Idle'}',`,
    `      walk: '${clips.walk ?? 'Walk'}',`,
    `      run: '${clips.run ?? clips.walk ?? 'Run'}',`,
    `      attack: ['${clips.attack ?? 'Attack'}'],`,
    ...(clips.hit ? [`      hit: ['${clips.hit}'],`] : []),
    `      death: '${clips.death ?? 'Death'}',`,
    ...(hasCast ? [`      cast: '${clips.cast}',`] : []),
    ...(hasJump ? [`      jump: '${clips.jump}',`] : []),
  ].join('\n');
  return [
    '// Add to VISUALS in src/render/characters/manifest.ts:',
    `  mob_${name}: {`,
    `    url: \`${url}\`,`,
    `    height: ${height ?? 2.0}, // world-unit pivot-to-crown height; tune against similar mobs`,
    '    clips: {',
    clipLines,
    '    },',
    "    tint: 'entity',",
    '    tintStrength: 0.35,',
    '  },',
    '',
    '// Then route a mob template to it in MOB_KEYS (same file):',
    `//   <your_mob_template_id>: 'mob_${name}',`,
    `// The ${kind === 'creature' ? 'creature' : 'model'} GLB is auto-preloaded via manifestUrls().`,
  ].join('\n');
}

/** Placement + collision snippet for a generated environment asset. The
 *  footprint numbers are MEASURED from the built GLB's bounds, so the collider
 *  matches the visuals exactly (the sim's WYSIWYG-collision invariant: render
 *  and colliders read the same record; footprints must never drift apart).
 *  `footprint` = { w, d, r } world units (width/depth extents + circumscribed
 *  circle radius); `building` switches the snippet to the OBB building form. */
export function propSnippet({ name, height, footprint, building = false }) {
  const fp = footprint ?? { w: 1, d: 1, r: 0.7 };
  const lines = [
    '// 1. Add to PROP_ASSET_DEFS in src/render/props.ts (front faces +Z; pass a',
    '//    yaw there if the model was authored facing another way):',
    `  ${camel(name)}: { url: '/models/props/${name}.glb', kit: 'qprops' },`,
    '',
  ];
  if (building) {
    lines.push(
      '// 2. BUILDING placement (ZonePropsDef.buildings in src/sim/content/zone*.ts).',
      `//    Measured footprint at authored height ${height}: w=${fp.w} d=${fp.d}.`,
      '//    buildProps scales the model so the VISUAL footprint equals w x d, and',
      '//    staticWorldColliders derives the matching OBB from the SAME record, so',
      '//    using these measured numbers keeps collision exactly WYSIWYG:',
      `  { kind: '${camel(name)}', x: <X>, z: <Z>, w: ${fp.w}, d: ${fp.d}, rot: 0 },`,
      '',
      '//    NOTE: buildings need a render arm in buildProps (src/render/props.ts)',
      "//    for the new kind (copy the 'house' arm: place asset, scale to w x d)",
      '//    AND the collider pass in src/sim/colliders.ts already handles every',
      '//    ZonePropsDef.buildings record generically via its w/d/rot OBB.',
    );
  } else {
    lines.push(
      '// 2. PROP placement with collision. Zone record (pick a category array in',
      '//    ZonePropsDef, e.g. a new entry or an existing shape like wells/tents):',
      `//    Measured: radius ${fp.r} (circumscribed), extents ${fp.w} x ${fp.d}, height ${height}.`,
      `  { x: <X>, z: <Z>, r: ${fp.r} },`,
      '',
      '//    Collider (src/sim/colliders.ts staticWorldColliders reads the SAME',
      '//    record; a circle collider of the same radius keeps WYSIWYG collision):',
      `  circle(p.x, p.z, ${fp.r}, { cameraTopY: ${Math.min(height, 3).toFixed(2)} }),`,
      '',
      '//    Or as an interactable ground object (GROUND_OBJECTS lane, auto-',
      '//    normalized to ~1.35yd, NO collision) if players should click it.',
    );
  }
  lines.push('// 3. On the map-editor branch, re-run scripts/gen_asset_catalog.mjs instead.');
  return lines.join('\n');
}

export function itemDefSnippet({ itemId, name, family }) {
  const dagger = family === 'dagger' ? ', dagger: true' : '';
  return [
    '// Add to BASE_ITEMS (src/sim/content/items.ts) or the zone item table:',
    `  ${itemId}: {`,
    `    id: '${itemId}',`,
    `    name: '${name}',`,
    "    kind: 'weapon',",
    "    slot: 'mainhand',",
    "    quality: 'common', // set the real quality/stats for the drop table",
    `    weapon: { min: 2, max: 5, speed: 2.0${dagger} }, // use real vanilla-style numbers`,
    '    sellValue: 10,',
    '  },',
    '',
    '// i18n: item names localize via the items catalog; English-only is fine at',
    '// PR tier (the maintainer fills locales at release). See src/ui/CLAUDE.md.',
  ].join('\n');
}

/** Integration snippet for a generated skin-model character body. The GLB
 *  carries the EXACT KayKit clip vocabulary, so the shipped kaykit() ClipMap
 *  factory drives it unchanged; handslot bones make the game's weapon attach
 *  work as-is. */
export function skinModelSnippet({ name, cls, theme, hasRightSlot, hasLeftSlot }) {
  const lines = [
    `// Skin model "${name}" ("${theme}" ${cls}): a full character body with the`,
    '// KayKit clip vocabulary baked in. Three integration options:',
    '//',
    '// A) NPC or MOB (instant, data-only). Add to VISUALS in',
    '//    src/render/characters/manifest.ts and wire NPC_KEYS/MOB_KEYS:',
    `  ${name}: {`,
    `    url: 'models/chars/skins/${name}.glb',`,
    '    height: HUMANOID_H,',
    "    clips: kaykit(['1H_Melee_Attack_Chop']),",
  ];
  if (hasRightSlot) {
    lines.push("    attach: [{ url: `${WEAPONS}/sword_1handed.glb`, bone: 'handslot.r' }],");
    lines.push('    weaponSlots: [0],');
  } else {
    lines.push('    // no handslot.r found on this rig: omit attach (no held weapon)');
  }
  lines.push(
    '  },',
    '//',
    '// B) PLAYER COSMETIC BODY (the Combat Mech pattern): requires extending the',
    "//    closed SkinCatalog union ('class' | 'mech') across src/sim/types.ts,",
    '//    visualKeyFor (manifest.ts), the wire cat field (server/game.ts),',
    '//    ClientWorld (src/net/online.ts), and the appearance picker. See the',
    '//    player_mech VisualDef + preloadMechAssets for the lazyPreload recipe.',
    '//',
    '// C) Review it first: node scripts/asset_pipeline/pipeline.mjs library --serve',
    `//    (search "${name}"; every KayKit clip + the held-weapon preview render).`,
    `// Handslots: right=${hasRightSlot ? 'yes' : 'NO'} left=${hasLeftSlot ? 'yes' : 'NO'}.`,
    '// The clip names match the kaykit() factory exactly (Walking_Backwards, Block,',
    '// and the strafe emote clips are absent and fall back gracefully).',
  );
  return lines.join('\n');
}

function camel(s) {
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}
