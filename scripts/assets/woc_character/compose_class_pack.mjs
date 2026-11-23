// Compose a buildable WOC character source directory from a BODY handoff (the
// warrior pack: base rig + clips, appearance parts, its character manifest) and
// an EQUIPMENT-ONLY fragment (the 2026-09-18 class sets: `armor_<fit>_<class>.glb`
// plus `armor_<fit>_<class>.manifest.json`, schema 1 "equipment-pack").
//
// The fragment's INTEGRATION.md contract: keep the body's base, appearance
// pack, baseNodes, appearance variants, defaultAppearance and animation list;
// replace packs.armor, items, armorSlots and defaultEquipment with the
// fragment's. The result is the same schema-1 character manifest
// build_woc_warrior.mjs reads, minus assembledReference (the fragments ship
// none; the build then verifies the written file against its own merged
// source). The fragment's bodyMaterial block rides along for provenance; the
// runtime body atlas is wired separately (WocCharacterManifest.underArmorAtlas).
//
// Usage: node scripts/assets/woc_character/compose_class_pack.mjs \
//   --body tmp/asset_src/woc_character \
//   --armor "<delivery>/armor_male_mage.manifest.json" \
//   --out tmp/asset_src/woc_mage
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--body' || key === '--armor' || key === '--out') opts[key.slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${key}`);
  }
  for (const k of ['body', 'armor', 'out']) if (!opts[k]) throw new Error(`--${k} is required`);
  return opts;
}

export function composeClassManifest(body, fragment, armorFile) {
  if (body.schemaVersion !== 1 || fragment.schemaVersion !== 1) {
    throw new Error('both manifests must be schema 1');
  }
  if (fragment.kind !== 'equipment-pack')
    throw new Error('armor manifest is not an equipment-pack');
  if (fragment.rigId !== body.rigId) {
    throw new Error(`rig mismatch: body ${body.rigId}, armor ${fragment.rigId}`);
  }
  const listed = new Set(fragment.packs.armor.nodes);
  for (const item of Object.values(fragment.items)) {
    for (const node of item.nodes) {
      if (!listed.has(node)) throw new Error(`item node ${node} is not in packs.armor.nodes`);
    }
  }
  return {
    schemaVersion: 1,
    rigId: body.rigId,
    name: fragment.name,
    base: body.base,
    packs: {
      appearance: body.packs.appearance,
      armor: { url: armorFile, nodes: [...fragment.packs.armor.nodes] },
    },
    baseNodes: body.baseNodes,
    appearance: body.appearance,
    defaultAppearance: body.defaultAppearance,
    armorSlots: fragment.armorSlots,
    items: fragment.items,
    defaultEquipment: fragment.defaultEquipment,
    animationNames: body.animationNames,
    coordinates: body.coordinates,
    bodyVariant: fragment.bodyVariant,
    bodyMaterial: fragment.bodyMaterial,
    notes: [
      `Composed by compose_class_pack.mjs: ${fragment.name} equipment fragment on the ${path.basename(body.base)} body pack.`,
      ...(fragment.notes ?? []),
    ],
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const body = JSON.parse(fs.readFileSync(path.join(opts.body, 'character.manifest.json'), 'utf8'));
  const fragment = JSON.parse(fs.readFileSync(opts.armor, 'utf8'));
  const armorSrc = path.resolve(path.dirname(opts.armor), fragment.packs.armor.url);
  const armorFile = path.basename(armorSrc);
  const manifest = composeClassManifest(body, fragment, armorFile);
  fs.mkdirSync(opts.out, { recursive: true });
  for (const file of [body.base, body.packs.appearance.url]) {
    fs.copyFileSync(path.join(opts.body, file), path.join(opts.out, file));
  }
  fs.copyFileSync(armorSrc, path.join(opts.out, armorFile));
  fs.copyFileSync(opts.armor, path.join(opts.out, 'armor.manifest.json'));
  fs.writeFileSync(
    path.join(opts.out, 'character.manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    `${opts.out}: ${fragment.name}, base ${body.base}, appearance ${body.packs.appearance.url}, armor ${armorFile} (${manifest.packs.armor.nodes.length} nodes)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
