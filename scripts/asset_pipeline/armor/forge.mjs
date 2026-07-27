// The Armor Forge CLI. Everything is free and local (no Tripo credits):
//   node scripts/asset_pipeline/armor/forge.mjs bootstrap [--src <v03 dir>] \
//     [--tpose <char>=<pose.json>] ...
// --tpose replaces a body's synthesized T-pose with an artist one: the JSON is
// the per-joint effective-locals dump from tmp/mage_tpose_dump.mjs (rotations
// transplant by joint name; the body keeps its own bone lengths).
//   node scripts/asset_pipeline/armor/forge.mjs forge --set <armor.glb> --name <key> \
//     [--label "Lvl 20 Plate"] [--char warrior|all] [--hat <hat.glb>] [--merge <extra.glb>] \
//     [--nudge Helm=dx,dy,dz[,scale]] [--arms-overlay] ...
// --hat feeds a separate GLB into the Helm slot as a HAT (caster style): every
// mesh in it becomes the Helm piece regardless of name, the fit perches the
// brim on the crown of the head, and the picker keeps the face visible.
// --arms-overlay is for sets whose Arms piece has NO hand geometry (cloth
// wraps): the sleeve stops just past the wrist and the picker keeps the body
// arms visible beneath it, so the body's own hands poke out of the cuff.
//   node scripts/asset_pipeline/armor/forge.mjs verify --name <key> [--char all]
// Bootstrap ingests the v03 player bodies (dequantized, joints deduped) into
// the picker workspace; forge fits + skins an armor set onto each body's own
// skeleton and emits work/armored/<char>__<set>.glb, gated by forge_verify.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  addArmorToBody,
  artistPoseLocals,
  dedupeJoints,
  extractArmor,
  extractBody,
  fitPieces,
  hierarchy,
  POSE_CLIP_NAMES,
  readDoc,
  samplePose,
  shiftPoseWorldY,
  soleY,
  stripCompression,
  stripToSet,
  synthesizeTPoseArms,
  transferWeights,
  weightSources,
  writeDoc,
  writeTPoseClip,
} from './forge_core.mjs';
import { verifyArmored } from './forge_verify.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const WORKSPACE = join(ROOT, 'tmp/asset_pipeline/armor_picker');
const DEFAULT_SRC = join(ROOT, 'tmp/asset_src/_New_Characters_Finished/_Characters_v03');
const CLASS_ORDER = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'mage',
  'priest',
  'warlock',
  'shaman',
  'druid',
];
const SET_SLOT_LABELS = {
  Helm: 'Helm',
  Shoulders: 'Pauldrons',
  Torso: 'Breastplate',
  Arms: 'Gauntlets',
  Legs: 'Greaves',
};

const args = process.argv.slice(2);
const command = args[0];
function opt(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
function optAll(name) {
  const out = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === `--${name}`) out.push(args[i + 1]);
  }
  return out;
}

async function loadManifest() {
  const path = join(WORKSPACE, 'manifest.json');
  if (!existsSync(path)) return { version: 2, chars: {}, sets: {}, setSlots: SET_SLOT_LABELS };
  return JSON.parse(await readFile(path, 'utf8'));
}

async function saveManifest(manifest) {
  await writeFile(join(WORKSPACE, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function classKey(file) {
  return basename(file, '.glb')
    .toLowerCase()
    .replace(/_male$/, '')
    .replace(/_female$/, '_f');
}

function label(key) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

async function buildThreeBundle() {
  const out = join(WORKSPACE, 'three.bundle.js');
  const entry = join(ROOT, 'scripts/asset_pipeline/three_bundle_entry.js');
  const res = spawnSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${out}`], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (res.status !== 0) throw new Error('esbuild three bundle failed');
}

async function ingestBodies() {
  const src = opt('src', DEFAULT_SRC);
  await mkdir(join(WORKSPACE, 'work/bodies'), { recursive: true });
  const files = (await readdir(src)).filter((f) => f.endsWith('.glb'));
  const manifest = await loadManifest();
  manifest.chars = {};
  const found = [];
  const tposeBy = {};
  for (const spec of optAll('tpose')) {
    const eq = spec.indexOf('=');
    if (eq === -1) throw new Error(`--tpose wants <char>=<pose.json>, got '${spec}'`);
    tposeBy[spec.slice(0, eq)] = spec.slice(eq + 1);
  }
  for (const file of files) {
    const key = classKey(file);
    if (!CLASS_ORDER.includes(key)) {
      console.log(`  skip ${file} (not a player class)`);
      continue;
    }
    const doc = await readDoc(join(src, file));
    stripCompression(doc);
    const deduped = dedupeJoints(doc);
    // The shipped TPose clip is a rest-pose snapshot, not a T-pose; replace it
    // with the artist pose when one is supplied (--tpose), else the
    // synthesized one, so viewers and the forge agree.
    const tree = hierarchy(doc);
    const poseClip = doc
      .getRoot()
      .listAnimations()
      .find((a) => POSE_CLIP_NAMES.includes(a.getName()));
    const base = poseClip ? samplePose(poseClip, 0) : new Map();
    let poseLocals;
    if (tposeBy[key]) {
      const artist = JSON.parse(await readFile(tposeBy[key], 'utf8'));
      poseLocals = artistPoseLocals(doc, tree, base, artist);
      writeTPoseClip(doc, tree, poseLocals);
      // Ground the retargeted pose: the export's hips height belongs to a
      // crouched action pose, so the straightened legs otherwise sink the
      // soles below the floor.
      const sole = soleY(extractBody(doc));
      if (Number.isFinite(sole) && Math.abs(sole) > 1e-4) {
        shiftPoseWorldY(doc, tree, poseLocals, -sole);
      }
    } else {
      poseLocals = synthesizeTPoseArms(doc, tree, base);
    }
    writeTPoseClip(doc, tree, poseLocals);
    const outRel = `work/bodies/${key}.glb`;
    await writeDoc(doc, join(WORKSPACE, outRel));
    const root = doc.getRoot();
    const meshNames = root
      .listNodes()
      .filter((n) => n.getMesh())
      .map((n) => n.getName() || n.getMesh().getName());
    const clips = root.listAnimations().map((a) => a.getName());
    const cosmetics = {
      hairs: meshNames.filter((n) => /^Head_(Male|Female)_Hair/.test(n)),
      beard: meshNames.includes('Head_Beard'),
      femaleHead: meshNames.includes('Head_Female_Head'),
    };
    manifest.chars[key] = {
      label: label(key),
      glb: outRel,
      segments: meshNames.filter((n) => !n.startsWith('Head_')),
      cosmetics,
      clips,
      ...(tposeBy[key] ? { tpose: basename(tposeBy[key]) } : {}),
    };
    found.push(key);
    console.log(
      `  ingested ${key.padEnd(8)} clips=${clips.length} meshes=${meshNames.length}${deduped ? ` dedupedJoints=${deduped}` : ''}${tposeBy[key] ? ' (artist TPose)' : clips.includes('TPose') ? '' : ' (no TPose clip)'}`,
    );
  }
  manifest.chars = Object.fromEntries(
    CLASS_ORDER.filter((k) => manifest.chars[k]).map((k) => [k, manifest.chars[k]]),
  );
  await saveManifest(manifest);
  console.log(`ingested ${found.length} bodies from ${src}`);
  return found;
}

async function forgeSet() {
  const setPath = opt('set');
  const name = opt('name');
  if (!setPath || !name) throw new Error('forge needs --set <glb> and --name <key>');
  const setLabel = opt('label', label(name));
  const charArg = opt('char');
  if (!charArg) {
    throw new Error(
      "forge needs --char <class[,class]|all>: sets are class-scoped (a warrior set forges onto the warrior); pass 'all' only for a genuinely shared set",
    );
  }
  const nudges = {};
  for (const n of optAll('nudge')) {
    const [slot, rest] = n.split('=');
    const parts = rest.split(',').map(Number);
    nudges[slot] = { d: parts.slice(0, 3), s: parts[3] ?? 1 };
  }

  const manifest = await loadManifest();
  const chars = charArg === 'all' ? Object.keys(manifest.chars) : charArg.split(',');
  for (const c of chars) {
    if (!manifest.chars[c]) throw new Error(`unknown character '${c}' (run bootstrap first)`);
  }

  const armorDoc = await readDoc(resolve(setPath));
  const { pieces, unknown } = extractArmor(armorDoc);
  if (unknown.length) console.log(`  note: unmatched armor meshes ignored: ${unknown.join(', ')}`);
  const hatPath = opt('hat');
  if (hatPath) {
    if (pieces.has('Helm')) throw new Error('--hat given but the set already has a Helm piece');
    const hat = extractArmor(await readDoc(resolve(hatPath)), { forceSlot: 'Helm' });
    if (!hat.pieces.has('Helm')) throw new Error('no meshes found in the hat GLB');
    pieces.set('Helm', hat.pieces.get('Helm'));
  }
  // --merge folds another slot-named GLB into the set (a shoulders-only file,
  // a belt, ...), so a set can be assembled from separately authored pieces.
  const mergePaths = optAll('merge');
  for (const mergePath of mergePaths) {
    const extra = extractArmor(await readDoc(resolve(mergePath)));
    if (!extra.pieces.size) throw new Error(`no slot-named meshes in ${mergePath}`);
    for (const [slot, parts] of extra.pieces) {
      if (pieces.has(slot)) {
        throw new Error(`--merge ${basename(mergePath)}: set already has a ${slot} piece`);
      }
      pieces.set(slot, parts);
    }
  }
  const helmModeArg = opt('helm-mode');
  if (helmModeArg && !['helm', 'hat', 'mask'].includes(helmModeArg)) {
    throw new Error(`--helm-mode wants helm|hat|mask, got '${helmModeArg}'`);
  }
  const helmMode = hatPath ? 'hat' : (helmModeArg ?? 'helm');
  const armsOverlay = args.includes('--arms-overlay');
  const fitMode = opt('fit', 'slots');
  if (!['slots', 'whole', 'anchored'].includes(fitMode)) {
    throw new Error(`--fit wants slots|whole|anchored, got '${fitMode}'`);
  }
  if (!pieces.size) throw new Error('no slot-named meshes found in the armor GLB');
  console.log(`armor '${name}': slots ${[...pieces.keys()].join(', ')}${hatPath ? ' (hat)' : ''}`);

  // Bodies shipped without their own TPose clip borrow the pose from the
  // first roster body that has one (all nine share the donor skeleton).
  let donorLocals = null;
  for (const [key, def] of Object.entries(manifest.chars)) {
    if (def.clips.includes('TPose')) {
      donorLocals = extractBody(await readDoc(join(WORKSPACE, def.glb))).poseLocals;
      console.log(`pose donor: ${key}`);
      break;
    }
  }

  await mkdir(join(WORKSPACE, 'work/armored'), { recursive: true });
  await mkdir(join(WORKSPACE, 'work/sets'), { recursive: true });
  const entry = manifest.sets[name] ?? {};
  manifest.sets[name] = {
    label: setLabel,
    slots: [...pieces.keys()],
    source: [setPath, hatPath, ...mergePaths]
      .filter(Boolean)
      .map((f) => basename(f))
      .join(' + '),
    helmMode,
    armsOverlay,
    fitMode,
    armored: entry.armored ?? {},
    sets: entry.sets ?? {},
    verified: entry.verified ?? {},
  };

  let failures = 0;
  for (const char of chars) {
    const bodyPath = join(WORKSPACE, manifest.chars[char].glb);
    // Whole-set fits happen in the RAW clip pose (the pose viewers render);
    // the synthetic straight-arm space is for the per-slot arm fit only.
    const body = extractBody(await readDoc(bodyPath), {
      poseDonor: donorLocals,
      synthArms: fitMode === 'slots',
    });
    const { fitted, report } = fitPieces(pieces, body, nudges, {
      helmMode,
      armsOverlay,
      fitMode,
    });
    const skinned = new Map();
    for (const [slot, parts] of fitted) {
      const sources = weightSources(slot, body.segments);
      skinned.set(
        slot,
        parts.map((part) => transferWeights(part.positions, sources)),
      );
    }
    addArmorToBody(body, fitted, skinned);
    // Game-spec textures: the UV-fix step hands us a 2048 PNG atlas (~3MB, was
    // the whole download weight); WebP at 1024 keeps the look at ~200KB. Body
    // textures are already small WebPs and pass through unchanged.
    {
      const { textureCompress } = await import('@gltf-transform/functions');
      const sharp = (await import('sharp')).default;
      await body.doc.transform(
        textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }),
      );
    }
    const armoredRel = `work/armored/${char}__${name}.glb`;
    await writeDoc(body.doc, join(WORKSPACE, armoredRel));
    const setDoc = await readDoc(join(WORKSPACE, armoredRel));
    await stripToSet(setDoc);
    const setRel = `work/sets/${name}__${char}.glb`;
    await writeDoc(setDoc, join(WORKSPACE, setRel));

    const scales = Object.entries(report.slots)
      .map(([slot, r]) => `${slot} x${r.scale}`)
      .join(', ');
    console.log(`${char} (pose ${body.poseSource}; fit ${scales}):`);
    const result = await verifyArmored(join(WORKSPACE, armoredRel), {
      helmMode,
      helmScale: nudges.Helm?.s ?? 1,
      fitMode,
    });
    manifest.sets[name].armored[char] = armoredRel;
    manifest.sets[name].sets[char] = setRel;
    manifest.sets[name].verified[char] = result.pass;
    if (!result.pass) failures += 1;
  }
  await saveManifest(manifest);
  const wall = chars
    .map((c) => `${manifest.sets[name].verified[c] ? 'PASS' : 'FAIL'} ${c}`)
    .join('  ');
  console.log(`\nverify wall: ${wall}`);
  if (failures) {
    console.error(`${failures} of ${chars.length} bodies FAILED the gate`);
    process.exit(1);
  }
  console.log(`set '${name}' forged onto ${chars.length} bodies, all gates green`);
}

async function verifyCmd() {
  const name = opt('name');
  if (!name) throw new Error('verify needs --name <key>');
  const manifest = await loadManifest();
  const set = manifest.sets[name];
  if (!set) throw new Error(`unknown set '${name}'`);
  const charArg = opt('char', 'all');
  const chars = charArg === 'all' ? Object.keys(set.armored) : charArg.split(',');
  let failures = 0;
  for (const char of chars) {
    console.log(`${char}:`);
    const result = await verifyArmored(join(WORKSPACE, set.armored[char]), {
      helmMode: set.helmMode,
    });
    set.verified[char] = result.pass;
    if (!result.pass) failures += 1;
  }
  await saveManifest(manifest);
  process.exit(failures ? 1 : 0);
}

async function bootstrap() {
  await mkdir(WORKSPACE, { recursive: true });
  console.log('building three.bundle.js...');
  await buildThreeBundle();
  console.log('ingesting bodies...');
  await ingestBodies();
  console.log('\nbootstrap done. serve the picker with:');
  console.log('  node scripts/asset_pipeline/armor/serve.mjs 5181');
  console.log('then forge a set, e.g.:');
  console.log(
    "  node scripts/asset_pipeline/armor/forge.mjs forge --set <armor.glb> --name lvl20 --label 'Lvl 20 Plate' --char warrior",
  );
}

const commands = { bootstrap, 'ingest-bodies': ingestBodies, forge: forgeSet, verify: verifyCmd };
if (!commands[command]) {
  console.log('usage: forge.mjs <bootstrap|ingest-bodies|forge|verify> [options]');
  process.exit(2);
}
await commands[command]();
