import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { PALADIN_CHOICE_ROWS } from '../src/sim/content/choice_rows_classic';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { ABILITY_IMAGE_IDS, abilityImageUrl } from '../src/ui/icons';
import { PALADIN_TALENT_IMAGE_IDS } from '../src/ui/talent_icons';

// Gate for the committed WebP class ability icons. The art under
// public/ui/skills/<class>/<id>.webp is the source of truth (WebP only, no PNG/JPG in the
// tree), and abilityImageUrl serves it for the action bar (kind 'ability'), aura/debuff
// frames (kind 'aura'), and the /wiki guide class pages. The guard is a bijection:
//   A) every id wired into ABILITY_IMAGE_IDS resolves to a committed, VALID .webp (a wired
//      id without art, a deleted/renamed file, or a zero-byte/renamed-PNG file fails here
//      instead of rendering a blank or broken icon);
//   B) only .webp art (+ mapping.json) is committed under public/ui/skills, i.e. a
//      contributor dropped in a .png/.jpg/etc. and forgot to run `npm run assets:skills`
//      (scripts/convert_skill_icons_webp.mjs), which converts to webp and deletes the source.
//      This is an allowlist (anything that is not .webp/mapping.json fails), so it asserts the
//      actual "webp only" invariant and cannot silently drift from the convert script;
//   C) every committed .webp is a WIRED ability icon living in its own derived class folder
//      (no orphan/dead-weight art, no file in the wrong class folder).
// Filesystem-only (no canvas), so it runs headless on CI in the default node env.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(repoRoot, 'public');
const skillsDir = path.join(publicDir, 'ui/skills');

// Only WebP art and the per-class provenance file may live under public/ui/skills. Dotfiles
// (e.g. a local .DS_Store) are ignored so the gate does not false-positive on dev cruft.
const isDotfile = (p: string): boolean => path.basename(p).startsWith('.');
const isMapping = (p: string): boolean => path.basename(p) === 'mapping.json';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

// A real WebP starts with a RIFF container whose form-type is "WEBP" (bytes 8..12). This
// rejects a zero-byte/truncated write and a foreign raster (e.g. a PNG) renamed to .webp.
function isValidWebp(file: string): boolean {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(12);
    const n = readSync(fd, buf, 0, 12, 0);
    return (
      n === 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
    );
  } finally {
    closeSync(fd);
  }
}

// Dimensions straight out of the WebP header (lossy VP8, lossless VP8L, or extended VP8X),
// mirroring the dependency-free item-icon gate.
function webpSize(file: string): { width: number; height: number } {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(32);
    readSync(fd, buf, 0, 32, 0);
    const tag = buf.toString('ascii', 12, 16);
    if (tag === 'VP8 ')
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (tag === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (tag === 'VP8X') {
      return {
        width: (buf.readUIntLE(24, 3) & 0xffffff) + 1,
        height: (buf.readUIntLE(27, 3) & 0xffffff) + 1,
      };
    }
    throw new Error(`unknown webp chunk "${tag}" in ${file}`);
  } finally {
    closeSync(fd);
  }
}

function webpBufferSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 32) throw new Error('truncated WebP header');
  const tag = bytes.toString('ascii', 12, 16);
  if (tag === 'VP8 ') {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (tag === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (tag === 'VP8X') {
    return {
      width: (bytes.readUIntLE(24, 3) & 0xffffff) + 1,
      height: (bytes.readUIntLE(27, 3) & 0xffffff) + 1,
    };
  }
  throw new Error(`unknown WebP chunk "${tag}"`);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  return value;
}

function canonicalSha256(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue(value)))
    .digest('hex');
}

const webpFiles = (): string[] =>
  walk(skillsDir).filter((p) => path.extname(p).toLowerCase() === '.webp');

function registeredSkillUrls(): string[] {
  const abilityUrls = [...ABILITY_IMAGE_IDS].map((id) => {
    const url = abilityImageUrl(id);
    if (!url) throw new Error(`${id} has no registered skill image URL`);
    return url;
  });
  const talentUrls = [...PALADIN_TALENT_IMAGE_IDS].map((id) => `/ui/skills/paladin/${id}.webp`);
  return [...abilityUrls, ...talentUrls].sort();
}

// The 12 rework ids whose art was superseded by the accepted release art in the
// v0.34.0 missing-painted-icons wave (bestial_wrath, counter_shot, volley,
// holy_nova, prayer_of_healing, psychic_scream, shadowform, bloodlust,
// chain_heal, chain_lightning, earthquake, elemental_mastery) are pinned by the
// generated-additions test below instead of this PR-provenance fixture.
const PR_2218_OWNED_CLASS_ICON_IDS = {
  hunter: [
    'bloodhook',
    'bloodtrail_assault',
    'cold_focus',
    'fieldcraft_reentry',
    'frostjaw_trap',
    'hunting_momentum',
    'measured_shot',
    'pack_command',
    'pack_rally',
    'shellskin',
    'shrapnel_charge',
    'stampede',
    'trailbreak',
    'unleash_beast',
    'wildheart',
  ],
  shaman: [
    'ancestor_return',
    'galeheart_weapon',
    'lifespring_weapon',
    'primal_exaltation',
    'stoneward',
    'stormsurge',
    'thunder_reservoir',
    'tidecall',
    'unleash_weapon',
    'warspirit_cadence',
  ],
  priest: [
    'choir_of_deliverance',
    'martyrs_aegis',
    'scouring_mercy',
    'seraphic_vigil',
    'summon_tithefiend',
    'veilstep',
  ],
} as const;

const OWNED_CLASS_SPECS = {
  hunter: ['beast_mastery', 'marksmanship', 'survival'],
  shaman: ['elemental', 'enhancement', 'restoration'],
  priest: ['discipline', 'holy', 'shadow'],
} as const;

const paladinWebpFiles = (): string[] =>
  webpFiles().filter((file) => path.basename(path.dirname(file)) === 'paladin');

type PaladinMapping = {
  license: string;
  generatedSource: string;
  iconSize: number;
  abilities: Array<{ abilityId: string; output: string }>;
  talents: Array<{
    talentId: string;
    name: string;
    sourceFile: string;
    output: string;
    confidence: string;
  }>;
};

const paladinMapping = (): PaladinMapping =>
  JSON.parse(
    readFileSync(path.join(skillsDir, 'paladin', 'mapping.json'), 'utf8'),
  ) as PaladinMapping;

interface MissingWaveAbilityPin {
  kind: string;
  id: string;
  class: string;
  runtimeUrl: string;
  acceptedSha256: string;
  acceptedBytes: number;
}

interface SkillNormalizationPin {
  kind: 'ability';
  id: string;
  class: string;
  runtimeUrl: string;
  acceptedSha256: string;
  acceptedBytes: number;
  sourceMapping: string;
  supersedes: {
    sourceCommit: string;
    sha256: string;
    bytes: number;
    width: number;
    height: number;
  };
}

type SkillMappingEntry = Record<string, unknown> & {
  abilityId: string;
  output: string;
};

interface TrackedSkillReviewEvidence {
  path: string;
  layout: string;
  acceptedSha256: string;
  acceptedBytes: number;
}

interface SkillNormalizationManifest {
  schemaVersion: number;
  batch: {
    id: string;
    artIdentityChanged: boolean;
  };
  scope: {
    normalizedSkillIcons: number;
  };
  contracts: {
    ability: {
      width: number;
      height: number;
      maxBytes: number;
      alpha: string;
    };
  };
  processing: {
    sourceCommit: string;
    converter: string;
    command: string;
  };
  review: {
    reviewSizes: number[];
    trackedEvidence: TrackedSkillReviewEvidence[];
    totalBytesBefore: number;
    totalBytesAfter: number;
    maxMeanAbsoluteError: number;
    minPeakSignalToNoiseDb: number;
    verdict: string;
  };
  assets: SkillNormalizationPin[];
}

const NORMALIZED_SKILL_IDS = {
  mage: [
    'arcane_surge',
    'blink',
    'blink_while_casting',
    'blizzard',
    'cold_snap',
    'collective_reversal',
    'counterspell',
    'double_blink',
    'elemental_convergence',
    'evocation',
    'fireball_form',
    'flurry',
    'frozen_orb',
    'greater_invisibility',
    'ice_floes',
    'ice_lance',
    'icy_veins',
    'mass_barrier',
    'overflowing_power',
    'overload',
    'perfect_moment',
    'power_echo',
    'presence_of_mind',
    'rings_of_frost',
    'rune_of_power',
    'snap_polymorph',
    'temporal_barrier',
    'temporal_echo',
    'temporal_hourglass',
    'temporal_mend',
    'temporal_rift',
    'twin_frost_nova',
    'warded',
  ],
  warrior: ['combat_mastery', 'crushing_charge', 'double_charge'],
} as const;

const SKILL_NORMALIZATION_SOURCE_COMMIT = '32abfff7b0cbee34123dc36f69ed3fcab24f7a65';
const SKILL_NORMALIZATION_HISTORY_DIGEST =
  '82d3ef8c0631a6bbdab0022c88fe2cc0d0256c55a1f279d75f300fa0f8d7f835';
const SKILL_NORMALIZATION_OWNERSHIP_DIGEST =
  'a12ca388cf11019ceeff901d7ade678d7770b468fbfc9783e317dbce987e18da';
const SKILL_NORMALIZATION_EVIDENCE_DIGEST =
  '281e073038f41c7ac0f7f020795451e2faec297b464ce373d2a1566dc9cc01b1';

function formerSkillBlobIssues(pin: SkillNormalizationPin['supersedes'], bytes: Buffer): string[] {
  const issues: string[] = [];
  if (bytes.length !== pin.bytes) issues.push(`bytes: ${bytes.length}, expected ${pin.bytes}`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== pin.sha256) issues.push(`sha256: ${sha256}, expected ${pin.sha256}`);
  if (
    bytes.length < 12 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    issues.push('container: expected RIFF/WEBP');
    return issues;
  }
  try {
    const dimensions = webpBufferSize(bytes);
    if (dimensions.width !== pin.width || dimensions.height !== pin.height) {
      issues.push(
        `dimensions: ${dimensions.width}x${dimensions.height}, expected ${pin.width}x${pin.height}`,
      );
    }
  } catch (error) {
    issues.push(`dimensions: ${error instanceof Error ? error.message : String(error)}`);
  }
  return issues;
}

function sourceCommitIsAvailable(commit: string): boolean {
  return (
    spawnSync('git', ['cat-file', '-e', `${commit}^{commit}`], {
      cwd: repoRoot,
      stdio: 'ignore',
    }).status === 0
  );
}

function sourceCommitBlob(commit: string, repoRelativePath: string): Buffer {
  return execFileSync('git', ['show', `${commit}:${repoRelativePath}`], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function skillNormalizationManifest(): SkillNormalizationManifest {
  return JSON.parse(
    readFileSync(
      path.join(
        repoRoot,
        'docs/achievements/release-v036-skill-normalization-2026-08-10/accepted-art.json',
      ),
      'utf8',
    ),
  ) as SkillNormalizationManifest;
}

function missingWaveAbilityPins(): MissingWaveAbilityPin[] {
  const manifest = JSON.parse(
    readFileSync(
      path.join(repoRoot, 'docs/achievements/missing-painted-icons-accepted-art.json'),
      'utf8',
    ),
  ) as { assets: MissingWaveAbilityPin[] };
  return manifest.assets.filter((asset) => asset.kind === 'ability');
}

describe('class ability webp icons', () => {
  it('has image-backed ability ids wired (guards the fixture)', () => {
    expect(ABILITY_IMAGE_IDS.size).toBeGreaterThan(0);
  });

  it('gives every paladin ability painted artwork', () => {
    const missing = Object.values(ABILITIES)
      .filter((ability) => ability.class === 'paladin')
      .map((ability) => ability.id)
      .filter((id) => !ABILITY_IMAGE_IDS.has(id))
      .sort();

    expect(missing).toEqual([]);
  });

  it('uses the owner-provided Fireball Form and Counterspell artwork', () => {
    expect(abilityImageUrl('fireball_form')).toBe('/ui/skills/mage/fireball_form.webp');
    expect(abilityImageUrl('counterspell')).toBe('/ui/skills/mage/counterspell.webp');

    const mapping = JSON.parse(
      readFileSync(path.join(skillsDir, 'mage', 'mapping.json'), 'utf8'),
    ) as {
      abilities: Array<{
        abilityId: string;
        sourceFile: string;
        output: string;
      }>;
    };
    const requested = new Map(
      mapping.abilities
        .filter(({ abilityId }) => ['fireball_form', 'counterspell'].includes(abilityId))
        .map(({ abilityId, sourceFile, output }) => [abilityId, { sourceFile, output }]),
    );
    expect(Object.fromEntries(requested)).toEqual({
      fireball_form: {
        sourceFile: 'owner-provided artwork (Fireball Form)',
        output: 'fireball_form.webp',
      },
      counterspell: {
        sourceFile: 'owner-provided artwork (Counterspell)',
        output: 'counterspell.webp',
      },
    });
  });

  it('uses the owner-provided painted icons for both Chronomancy abilities', () => {
    expect(abilityImageUrl('collective_reversal')).toBe('/ui/skills/mage/collective_reversal.webp');
    expect(abilityImageUrl('temporal_hourglass')).toBe('/ui/skills/mage/temporal_hourglass.webp');
  });

  it('image-backs every owned-class icon delivered by PR #2218 with recorded provenance', () => {
    for (const [cls, ids] of Object.entries(PR_2218_OWNED_CLASS_ICON_IDS)) {
      const mapping = JSON.parse(
        readFileSync(path.join(skillsDir, cls, 'mapping.json'), 'utf8'),
      ) as {
        abilities: Array<{ abilityId: string; sourcePack?: string; output: string }>;
      };
      const entries = new Map(mapping.abilities.map((entry) => [entry.abilityId, entry]));

      for (const id of ids) {
        expect(abilityImageUrl(id)).toBe(`/ui/skills/${cls}/${id}.webp`);
        expect(entries.get(id)).toMatchObject({
          abilityId: id,
          sourcePack: 'OpenAI image generation through Codex',
          output: `${id}.webp`,
        });
      }
    }
  });

  it('image-backs every level-20 Hunter, Shaman, and Priest spellbook entry', () => {
    const missing: string[] = [];
    for (const cls of Object.keys(OWNED_CLASS_SPECS) as Array<keyof typeof OWNED_CLASS_SPECS>) {
      const specs = OWNED_CLASS_SPECS[cls];
      for (const spec of specs) {
        const mods = computeTalentModifiers(cls, { ...emptyAllocation(), spec }, 20);
        for (const { def } of abilitiesKnownAt(cls, 20, mods)) {
          if (!abilityImageUrl(def.id)) missing.push(`${cls}/${spec}/${def.id}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('backs every Warlock spell and choice talent with distinct painted art', () => {
    const spellIds = Object.values(ABILITIES)
      .filter(({ class: owner }) => owner === 'warlock')
      .map(({ id }) => id);
    const talentOptions = CHOICE_ROWS.warlock.rows.flatMap(({ options }) => options);
    const talentIconIds = talentOptions.map(({ icon }) => icon);
    const resolvedTalentIconIds = talentIconIds.filter((id): id is string => Boolean(id));

    expect(spellIds.filter((id) => !ABILITY_IMAGE_IDS.has(id))).toEqual([]);
    expect(talentIconIds).toEqual(talentOptions.map(({ id }) => id));
    expect(new Set(talentIconIds).size).toBe(talentOptions.length);
    expect(resolvedTalentIconIds).toHaveLength(talentOptions.length);
    expect(resolvedTalentIconIds.filter((id) => !ABILITY_IMAGE_IDS.has(id))).toEqual([]);
    expect([...spellIds, ...resolvedTalentIconIds].map((id) => abilityImageUrl(id))).not.toContain(
      null,
    );
  });

  it('pins generated Warlock provenance, dimensions, decoding, and unique bytes', async () => {
    const warlockDir = path.join(skillsDir, 'warlock');
    const mapping = JSON.parse(readFileSync(path.join(warlockDir, 'mapping.json'), 'utf8')) as {
      iconSize: number;
      abilities: Array<{ abilityId: string }>;
      generatedBatches: Array<{ abilityIds?: string[]; talentIds?: string[] }>;
    };
    const generatedIds = mapping.generatedBatches.flatMap(
      ({ abilityIds, talentIds }) => abilityIds ?? talentIds ?? [],
    );
    const mappedIds = [...mapping.abilities.map(({ abilityId }) => abilityId), ...generatedIds];
    const committedIds = readdirSync(warlockDir)
      .filter((name) => name.endsWith('.webp'))
      .map((name) => path.basename(name, '.webp'));

    expect(new Set(mappedIds).size).toBe(mappedIds.length);
    expect(new Set(mappedIds)).toEqual(new Set(committedIds));

    const hashes = new Set<string>();
    for (const id of generatedIds) {
      const file = path.join(warlockDir, `${id}.webp`);
      const bytes = readFileSync(file);
      const metadata = await sharp(bytes).metadata();
      expect(metadata).toMatchObject({
        format: 'webp',
        width: mapping.iconSize,
        height: mapping.iconSize,
      });
      hashes.add(createHash('sha256').update(bytes).digest('hex'));
    }
    expect(hashes.size).toBe(generatedIds.length);
    expect(readFileSync(path.join(repoRoot, 'CREDITS.md'), 'utf8')).toContain(
      'Generated Warlock spell and talent icons',
    );
  });

  it('A) every image-backed ability id resolves to a committed, valid .webp', () => {
    const broken: string[] = [];
    for (const id of ABILITY_IMAGE_IDS) {
      const url = abilityImageUrl(id);
      if (!url) {
        broken.push(`${id} (abilityImageUrl returned null; missing ability class?)`);
        continue;
      }
      expect(url, `${id} must resolve to a webp url`).toMatch(/^\/ui\/skills\/.+\.webp$/);
      const file = path.join(publicDir, url.replace(/^\//, ''));
      if (!existsSync(file)) {
        broken.push(`${id} -> ${url} (missing file)`);
        continue;
      }
      if (!isValidWebp(file))
        broken.push(`${id} -> ${url} (not a valid webp: bad RIFF/WEBP header)`);
    }
    expect(broken).toEqual([]);
  });

  it('B) commits only webp art (no unconverted png/jpg/etc., no stray files)', () => {
    const stray = walk(skillsDir)
      .filter((p) => !isDotfile(p) && !isMapping(p) && path.extname(p).toLowerCase() !== '.webp')
      .map((p) => path.relative(repoRoot, p));
    expect(
      stray,
      'only .webp art (+ mapping.json) may live under public/ui/skills; run `npm run assets:skills` to convert dropped-in art',
    ).toEqual([]);
  });

  it('C) every committed webp is a wired ability or Paladin talent icon (no orphans)', () => {
    const orphans: string[] = [];
    for (const file of webpFiles()) {
      const id = path.basename(file, '.webp');
      if (PALADIN_TALENT_IMAGE_IDS.has(id)) {
        const expected = `/ui/skills/paladin/${id}.webp`;
        const actual = `/${path.relative(publicDir, file).split(path.sep).join('/')}`;
        if (actual !== expected) {
          orphans.push(
            `${path.relative(repoRoot, file)} (talent served as ${actual}, expected ${expected})`,
          );
        }
        continue;
      }
      if (!ABILITY_IMAGE_IDS.has(id)) {
        orphans.push(`${path.relative(repoRoot, file)} (id "${id}" not in ABILITY_IMAGE_IDS)`);
        continue;
      }
      const url = abilityImageUrl(id);
      const expected = `/${path.relative(publicDir, file).split(path.sep).join('/')}`;
      if (url !== expected) {
        orphans.push(`${path.relative(repoRoot, file)} (served as ${url}, expected ${expected})`);
      }
    }
    expect(
      orphans,
      'unwired or misplaced webp(s) committed; remove dead-weight art or wire the id into ABILITY_IMAGE_IDS',
    ).toEqual([]);
  });

  it('D) every registered skill webp meets the global shipping contract', async () => {
    const urls = registeredSkillUrls();
    const committedUrls = webpFiles()
      .map((file) => `/${path.relative(publicDir, file).split(path.sep).join('/')}`)
      .sort();
    expect(new Set(urls).size, 'registered skill URLs must be unique').toBe(urls.length);
    expect(urls, 'the shipping contract must cover every committed skill webp').toEqual(
      committedUrls,
    );

    const issues: string[] = [];
    const hashes = new Map<string, string[]>();
    for (const url of urls) {
      const file = path.join(publicDir, url.replace(/^\//, ''));
      if (!existsSync(file)) {
        issues.push(`${url}: missing file`);
        continue;
      }
      if (!isValidWebp(file)) {
        issues.push(`${url}: invalid RIFF/WEBP container`);
        continue;
      }

      const bytes = readFileSync(file);
      // Fresh converter outputs hard-cap at 15 KiB. The complete historical catalog has one
      // alpha-heavy 15.8 KiB icon, so the all-art gate uses the next exact KiB boundary.
      if (bytes.length > 16 * 1024) issues.push(`${url}: ${bytes.length} B exceeds 16 KiB`);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const duplicateGroup = hashes.get(hash) ?? [];
      duplicateGroup.push(url);
      hashes.set(hash, duplicateGroup);

      const metadata = await sharp(bytes).metadata();
      if (metadata.format !== 'webp') issues.push(`${url}: decoded as ${metadata.format}`);
      if (metadata.width !== 128 || metadata.height !== 128) {
        issues.push(`${url}: ${metadata.width}x${metadata.height}, expected 128x128`);
      }
      if (metadata.space !== 'srgb') issues.push(`${url}: ${metadata.space}, expected sRGB`);

      const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const pixelCount = decoded.info.width * decoded.info.height;
      let visiblePixels = 0;
      let opaquePixels = 0;
      for (let offset = 3; offset < decoded.data.length; offset += decoded.info.channels) {
        const alpha = decoded.data[offset];
        if (alpha > 0) visiblePixels++;
        if (alpha === 255) opaquePixels++;
      }
      if (visiblePixels < pixelCount * 0.25) {
        issues.push(`${url}: only ${visiblePixels}/${pixelCount} pixels are visible`);
      }
      if (opaquePixels < pixelCount * 0.02) {
        issues.push(`${url}: only ${opaquePixels}/${pixelCount} pixels are fully opaque`);
      }
      if (!metadata.hasAlpha && opaquePixels !== pixelCount) {
        issues.push(`${url}: alpha-free WebP decoded with non-opaque pixels`);
      }
    }

    for (const duplicateUrls of hashes.values()) {
      if (duplicateUrls.length > 1) issues.push(`duplicate bytes: ${duplicateUrls.join(', ')}`);
    }
    expect(issues).toEqual([]);
    expect(hashes.size, 'every registered skill icon needs distinct painted bytes').toBe(
      urls.length,
    );
  });

  it('E) pins the normalized shipping bytes while preserving source-art ownership', async () => {
    const manifest = skillNormalizationManifest();
    const expected = Object.entries(NORMALIZED_SKILL_IDS)
      .flatMap(([className, ids]) => ids.map((id) => `${className}/${id}`))
      .sort();
    const actual = manifest.assets.map((asset) => `${asset.class}/${asset.id}`).sort();
    const historicalPins = manifest.assets
      .map((asset) => ({
        class: asset.class,
        id: asset.id,
        runtimeUrl: asset.runtimeUrl,
        ...asset.supersedes,
      }))
      .sort((left, right) =>
        `${left.class}/${left.id}`.localeCompare(`${right.class}/${right.id}`),
      );

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.batch).toMatchObject({
      id: 'release-v036-skill-normalization-2026-08-10',
      artIdentityChanged: false,
    });
    expect(manifest.processing).toMatchObject({
      sourceCommit: SKILL_NORMALIZATION_SOURCE_COMMIT,
      converter: 'scripts/convert_skill_icons_webp.mjs',
      command: 'npm run assets:skills',
    });
    expect(manifest.contracts.ability).toEqual({
      width: 128,
      height: 128,
      maxBytes: 15 * 1024,
      alpha: 'opaque',
    });
    expect(manifest.review.reviewSizes).toEqual([128, 40, 28]);
    expect(manifest.review).toMatchObject({
      maxMeanAbsoluteError: 8.910522,
      minPeakSignalToNoiseDb: 26.00389,
      verdict:
        'Accepted. Side-by-side review preserves subject, framing, palette, border, and small-size readability at every review size.',
    });
    expect(manifest.scope.normalizedSkillIcons).toBe(expected.length);
    expect(actual).toEqual(expected);
    expect(canonicalSha256(historicalPins), 'former shipping identity aggregate').toBe(
      SKILL_NORMALIZATION_HISTORY_DIGEST,
    );
    expect(canonicalSha256(manifest.review.trackedEvidence), 'durable review-evidence pins').toBe(
      SKILL_NORMALIZATION_EVIDENCE_DIGEST,
    );

    for (const evidence of manifest.review.trackedEvidence) {
      const file = path.join(repoRoot, evidence.path);
      expect(existsSync(file), `${evidence.path} exists`).toBe(true);
      const bytes = readFileSync(file);
      expect(bytes.length, `${evidence.path} accepted bytes`).toBe(evidence.acceptedBytes);
      expect(
        createHash('sha256').update(bytes).digest('hex'),
        `${evidence.path} accepted hash`,
      ).toBe(evidence.acceptedSha256);
      expect(await sharp(bytes).metadata(), evidence.path).toMatchObject({ format: 'webp' });
    }

    // Local worktrees and full-history release gates verify the former bytes straight from the
    // recorded commit. Shallow CI checkouts may not carry that parent object, so the independent
    // literal aggregate above remains the always-on history pin there.
    if (sourceCommitIsAvailable(SKILL_NORMALIZATION_SOURCE_COMMIT)) {
      const sourceIssues: string[] = [];
      for (const asset of manifest.assets) {
        const repoRelativePath = `public${asset.runtimeUrl}`;
        try {
          const bytes = sourceCommitBlob(SKILL_NORMALIZATION_SOURCE_COMMIT, repoRelativePath);
          sourceIssues.push(
            ...formerSkillBlobIssues(asset.supersedes, bytes).map(
              (issue) => `${asset.class}/${asset.id}: ${issue}`,
            ),
          );
        } catch (error) {
          sourceIssues.push(
            `${asset.class}/${asset.id}: git show failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      expect(sourceIssues, 'former pins must match exact source-commit Git blobs').toEqual([]);
    }

    const oldHashes = new Set<string>();
    const currentHashes = new Set<string>();
    const oldDimensions = new Map<string, number>();
    const mappingCache = new Map<string, SkillMappingEntry[]>();
    const ownershipRows: Array<{ class: string; entry: SkillMappingEntry }> = [];
    let oldBytes = 0;
    let currentBytes = 0;
    for (const asset of manifest.assets) {
      expect(asset.kind, asset.id).toBe('ability');
      expect(asset.runtimeUrl, asset.id).toBe(`/ui/skills/${asset.class}/${asset.id}.webp`);
      expect(asset.sourceMapping, asset.id).toBe(`public/ui/skills/${asset.class}/mapping.json`);
      expect(asset.supersedes.sourceCommit, asset.id).toBe(SKILL_NORMALIZATION_SOURCE_COMMIT);
      expect(asset.supersedes.sha256, `${asset.id} historical hash`).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.supersedes.width, asset.id).toBe(asset.supersedes.height);
      expect([512, 1254], asset.id).toContain(asset.supersedes.width);
      expect(asset.supersedes.bytes, asset.id).toBeGreaterThan(asset.acceptedBytes);

      oldHashes.add(asset.supersedes.sha256);
      currentHashes.add(asset.acceptedSha256);
      oldBytes += asset.supersedes.bytes;
      currentBytes += asset.acceptedBytes;
      const dimension = `${asset.supersedes.width}x${asset.supersedes.height}`;
      oldDimensions.set(dimension, (oldDimensions.get(dimension) ?? 0) + 1);

      let mappings = mappingCache.get(asset.class);
      if (!mappings) {
        const parsed = JSON.parse(
          readFileSync(path.join(skillsDir, asset.class, 'mapping.json'), 'utf8'),
        ) as { abilities: SkillMappingEntry[] };
        mappings = parsed.abilities;
        mappingCache.set(asset.class, mappings);
      }
      const owners = mappings.filter(({ abilityId }) => abilityId === asset.id);
      expect(owners, `${asset.id} keeps exactly one source-art mapping owner`).toHaveLength(1);
      expect(owners[0]?.output, `${asset.id} owner keeps the canonical output`).toBe(
        `${asset.id}.webp`,
      );
      ownershipRows.push({ class: asset.class, entry: owners[0] as SkillMappingEntry });

      const file = path.join(publicDir, asset.runtimeUrl.replace(/^\//, ''));
      const bytes = readFileSync(file);
      expect(bytes.length, `${asset.id} accepted bytes`).toBe(asset.acceptedBytes);
      expect(createHash('sha256').update(bytes).digest('hex'), `${asset.id} accepted hash`).toBe(
        asset.acceptedSha256,
      );
      const metadata = await sharp(bytes).metadata();
      expect(metadata, asset.id).toMatchObject({
        format: 'webp',
        width: manifest.contracts.ability.width,
        height: manifest.contracts.ability.height,
        space: 'srgb',
        hasAlpha: false,
      });
      expect(bytes.length, `${asset.id} byte budget`).toBeLessThanOrEqual(
        manifest.contracts.ability.maxBytes,
      );
    }

    expect(oldHashes.size).toBe(manifest.assets.length);
    expect(currentHashes.size).toBe(manifest.assets.length);
    expect([...oldHashes].filter((hash) => currentHashes.has(hash))).toEqual([]);
    ownershipRows.sort((left, right) =>
      `${left.class}/${left.entry.abilityId}`.localeCompare(
        `${right.class}/${right.entry.abilityId}`,
      ),
    );
    expect(canonicalSha256(ownershipRows), 'full source-art ownership rows').toBe(
      SKILL_NORMALIZATION_OWNERSHIP_DIGEST,
    );
    expect(Object.fromEntries([...oldDimensions].sort())).toEqual({
      '1254x1254': 31,
      '512x512': 5,
    });
    expect(manifest.review.totalBytesBefore).toBe(oldBytes);
    expect(manifest.review.totalBytesAfter).toBe(currentBytes);
    expect(currentBytes).toBeLessThan(oldBytes / 30);
  });

  it('E2) the former-blob verifier rejects byte, hash, container, and dimension drift', () => {
    const asset = skillNormalizationManifest().assets[0];
    expect(asset).toBeDefined();
    const bytes = readFileSync(path.join(publicDir, asset.runtimeUrl.replace(/^\//, '')));
    const dimensions = webpBufferSize(bytes);
    const pin: SkillNormalizationPin['supersedes'] = {
      sourceCommit: 'fixture',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      width: dimensions.width,
      height: dimensions.height,
    };
    expect(formerSkillBlobIssues(pin, bytes)).toEqual([]);

    const changedBytes = Buffer.from(bytes);
    changedBytes[changedBytes.length - 1] ^= 1;
    expect(formerSkillBlobIssues(pin, changedBytes)).toEqual([expect.stringMatching(/^sha256:/)]);
    expect(formerSkillBlobIssues({ ...pin, bytes: pin.bytes + 1 }, bytes)).toEqual([
      expect.stringMatching(/^bytes:/),
    ]);
    expect(formerSkillBlobIssues({ ...pin, width: pin.width + 1 }, bytes)).toEqual([
      expect.stringMatching(/^dimensions:/),
    ]);
    expect(formerSkillBlobIssues({ ...pin, bytes: 32 }, Buffer.alloc(32))).toEqual([
      expect.stringMatching(/^sha256:/),
      'container: expected RIFF/WEBP',
    ]);
  });

  it('keeps every PR #2218 ability icon at the canonical 128px square size', async () => {
    const wrongSize: string[] = [];
    for (const [cls, ids] of Object.entries(PR_2218_OWNED_CLASS_ICON_IDS)) {
      for (const id of ids) {
        const file = path.join(skillsDir, cls, `${id}.webp`);
        const metadata = await sharp(file).metadata();
        if (metadata.width !== 128 || metadata.height !== 128) {
          wrongSize.push(`${path.relative(repoRoot, file)} (${metadata.width}x${metadata.height})`);
        }
      }
    }
    expect(wrongSize).toEqual([]);
  });

  it('keeps every Paladin icon and provenance row in a one-to-one mapping', () => {
    const files = paladinWebpFiles().map((file) => path.basename(file));
    const mapping = paladinMapping();
    const entries = [
      ...mapping.abilities.map(({ abilityId: id, output }) => ({ id, output })),
      ...mapping.talents.map(({ talentId: id, output }) => ({ id, output })),
    ];
    const outputs = entries.map(({ output }) => output);

    expect(new Set(outputs).size, 'mapping.json contains duplicate output filenames').toBe(
      outputs.length,
    );
    expect(
      files.filter((file) => !outputs.includes(file)),
      'Paladin artwork without provenance in mapping.json',
    ).toEqual([]);
    expect(
      outputs.filter((file) => !files.includes(file)),
      'mapping.json lists missing Paladin artwork',
    ).toEqual([]);
    expect(
      entries.filter(({ id, output }) => output !== `${id}.webp`),
      'Paladin provenance rows must map each ability or talent id to its canonical filename',
    ).toEqual([]);
  });

  it('keeps choice rows, painted talent ids, files, and provenance in exact parity', () => {
    const mapping = paladinMapping();
    const choices = PALADIN_CHOICE_ROWS.rows.flatMap((row) => row.options);
    const choiceIds = choices.map(({ id }) => id).sort();
    const paintedIds = [...PALADIN_TALENT_IMAGE_IDS].sort();
    const mappedIds = mapping.talents.map(({ talentId }) => talentId).sort();
    const fileIds = paladinWebpFiles()
      .map((file) => path.basename(file, '.webp'))
      .filter((id) => id.startsWith('pal_r'))
      .sort();

    expect(paintedIds).toEqual(choiceIds);
    expect(mappedIds).toEqual(choiceIds);
    expect(fileIds).toEqual(choiceIds);
    expect(mapping.generatedSource).toBe('OpenAI image generation, original project artwork');
    expect(mapping.license).toContain('project-owned original art');

    const choiceNames = new Map(choices.map(({ id, name }) => [id, name]));
    for (const entry of mapping.talents) {
      expect(entry.name, entry.talentId).toBe(choiceNames.get(entry.talentId));
      expect(entry.sourceFile, entry.talentId).toBe(mapping.generatedSource);
      expect(entry.confidence, entry.talentId).toBe('high');
    }
  });

  it('keeps every Paladin icon at the declared 128px square', () => {
    const { iconSize } = paladinMapping();
    expect(iconSize).toBe(128);
    const wrong = paladinWebpFiles()
      .map((file) => ({ file, ...webpSize(file) }))
      .filter(({ width, height }) => width !== iconSize || height !== iconSize)
      .map(({ file, width, height }) => `${path.basename(file)} (${width}x${height})`);

    expect(
      wrong,
      'resize Paladin source art to 128px square before running `npm run assets:skills`',
    ).toEqual([]);
  });

  it('F) every accepted generated addition is unique, opaque, exact 128px art', async () => {
    const pins = missingWaveAbilityPins();
    expect(pins).toHaveLength(100);
    const hashes = new Set<string>();
    const mapped = new Set<string>();
    for (const className of [
      'druid',
      'hunter',
      'mage',
      'paladin',
      'priest',
      'rogue',
      'shaman',
      'warlock',
      'warrior',
    ]) {
      const mapping = JSON.parse(
        readFileSync(path.join(skillsDir, className, 'mapping.json'), 'utf8'),
      ) as {
        abilities: Array<{
          abilityId: string;
          sourcePack: string;
          source?: string;
          owner?: string;
          license?: string;
        }>;
      };
      for (const entry of mapping.abilities.filter(
        ({ sourcePack }) => sourcePack === 'woc_openai_missing_painted_icons_2026_08_01',
      )) {
        expect(entry.source, entry.abilityId).toBe('OpenAI built-in image generation');
        expect(entry.owner, entry.abilityId).toBe('World of ClaudeCraft');
        expect(entry.license, entry.abilityId).toContain('project asset');
        expect(entry.license, entry.abilityId).not.toContain('CraftPix');
        mapped.add(entry.abilityId);
      }
    }
    expect([...mapped].sort()).toEqual(pins.map(({ id }) => id).sort());

    for (const pin of pins) {
      expect(ABILITY_IMAGE_IDS.has(pin.id), `${pin.id} registry wiring`).toBe(true);
      expect(abilityImageUrl(pin.id), `${pin.id} runtime URL`).toBe(pin.runtimeUrl);
      const file = path.join(publicDir, pin.runtimeUrl.replace(/^\//, ''));
      const bytes = readFileSync(file);
      expect(bytes.length, `${pin.id} accepted bytes`).toBe(pin.acceptedBytes);
      expect(bytes.length, `${pin.id} weight ceiling`).toBeLessThanOrEqual(15 * 1024);
      expect(createHash('sha256').update(bytes).digest('hex'), `${pin.id} accepted hash`).toBe(
        pin.acceptedSha256,
      );
      expect(hashes.has(pin.acceptedSha256), `${pin.id} duplicate painted encoding`).toBe(false);
      hashes.add(pin.acceptedSha256);
      const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(decoded.info.width, `${pin.id} width`).toBe(128);
      expect(decoded.info.height, `${pin.id} height`).toBe(128);
      let opaque = true;
      for (let offset = 3; offset < decoded.data.length; offset += decoded.info.channels) {
        if (decoded.data[offset] !== 255) {
          opaque = false;
          break;
        }
      }
      expect(opaque, `${pin.id} must keep its full-square opaque background`).toBe(true);
    }
    expect(hashes.size).toBe(100);
  });
});
