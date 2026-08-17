import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { abilityImageUrl } from '../src/ui/icons';

const repoRoot = process.cwd();
const recordRelativePath =
  'docs/achievements/release-v039-icon-art-second-pass-2026-08-16/legacy-shaman-rogue-priest.json';
const recordPath = path.join(repoRoot, recordRelativePath);
const RECORD_SHA256 = 'b8f4f855109fd7e00429c7466957754b3e8b3b402f55925c10074775b6fba184';
const SOURCE_COMMIT = 'd2d1a8ad5c1121f38c52ca2709d88b84adbe5c9e';
const SOURCE_PACK = 'woc_openai_release_v039_icon_art_second_pass_2026_08_16';
const PROJECT_LICENSE =
  'World of ClaudeCraft project-generated art, project asset, rights reserved';

const EXPECTED_PINS = {
  'priest/shadow_word_pain': {
    sourceSha256: '58052c3085565d8b2c5ee2a44a7ee42df72878a0c3f7a50e3bcdbed5ed116571',
    acceptedSha256: '3e2b06fd6bc3675efc1cda722b102aa1241b6f7c1dc65b0c385577e2d67859d9',
    acceptedBytes: 3274,
    supersededSha256: 'd56f86219b1c7ecb075e0ef8f2d874f33214d9e05b7c6cb5b3e342f9055920bc',
    supersededBytes: 3004,
  },
  'rogue/blind': {
    sourceSha256: 'dcb8de87807fa21ac742e1a6cc862b5b93e7fa2c7f9923f5bd8ead5fb1de454c',
    acceptedSha256: '43bed549f22db4b53cc6a8b54ca810a525f4be923c43d08e5bd5212c66f55b14',
    acceptedBytes: 2876,
    supersededSha256: '97d96f937fe4a451794d97879627c878728249eeb27c1b72741d0edeb985521e',
    supersededBytes: 3030,
  },
  'rogue/expose_armor': {
    sourceSha256: '8b98c456fa89c9d5286011dbf99c3704eb1728d84faf18828851857a2c73910e',
    acceptedSha256: '98fe9fb41a69d6c3f6b1503705d728acf52ede61f9ab6f8913cab7481d225abd',
    acceptedBytes: 2576,
    supersededSha256: 'b288d3c9c1f4e4cbdb7e29223da91d998925a2d4b637fbcbdfc67b0e03a74986',
    supersededBytes: 5892,
  },
  'rogue/sap': {
    sourceSha256: 'a50aff5279a51c4ba64692c23d207863ccd4cdb2df8087de2472b7ddd15b225e',
    acceptedSha256: '7d5088688d2e1dd6a34800fd5074bd43b40e335e75b3f411a7dad041707d10a7',
    acceptedBytes: 2194,
    supersededSha256: 'df44e87143e5f4f68f3055354fb640978f91e9b63cdb06a4452fd9d4d6b9e6b1',
    supersededBytes: 3500,
  },
  'shaman/earth_shock': {
    sourceSha256: 'bdbb680a94fa441945772c396cc5c210cd3a5784124bb582a870365a88415acb',
    acceptedSha256: '714e9e95ccbe5e7b02a9809df2ca599203334aa8a10b44878c35fe93c9a46eec',
    acceptedBytes: 5986,
    supersededSha256: '905b6a8c195cf648630c67f5dacd9abe271d5a18255b9771f87643131a25e5f3',
    supersededBytes: 3806,
  },
  'shaman/flame_shock': {
    sourceSha256: '06586e6a188b35ba1f2865eeba57f11cf6c70ede1fec3beb04a146ddd8c86139',
    acceptedSha256: '91aa49a73a7888357661b7b477f872ac4a827fcab39c5b168007f412f331f9e8',
    acceptedBytes: 4346,
    supersededSha256: '8ed8e6022acce62930c3a0809f7043c95507528ae3c6a823a8bd4a260ee6bc87',
    supersededBytes: 4028,
  },
  'shaman/flametongue_weapon': {
    sourceSha256: '9c55fa48f254e513b903308303714989d4965c87ffa5ab1588d7314b37b12ee9',
    acceptedSha256: '17b322c11692a53a41935ac79bfe9ebaa3b355c2e33b9a7d6654314cef93c9be',
    acceptedBytes: 4428,
    supersededSha256: '30685a6f97729e07271824fce1c3eb82b2ce0fec6941b943e86d116bc5e54310',
    supersededBytes: 2886,
  },
  'shaman/frost_shock': {
    sourceSha256: '5fbb8183c99825d3c4ee9bec9c33a154abaa5bd5d7bcee6afcbd225169345f89',
    acceptedSha256: '91f6ad858dfb97c2deb53145830d9bb170a66179c1e9f0e62cc6f07f3c0539c5',
    acceptedBytes: 4946,
    supersededSha256: 'a22e3a1f7151ba402d8f969adb8c78b4e83a86adcb8667a3d4ad90899474fc74',
    supersededBytes: 4504,
  },
  'shaman/frostbrand_weapon': {
    sourceSha256: 'ebc8ee0ca1668d9345f4c2bbbd38a4007e4e8fb5b889e67b2d031088eb4d7bc4',
    acceptedSha256: 'c5f4e978648e815ab50cb53f4c11b8af82728b74ca7481744d18c563ee9f2b48',
    acceptedBytes: 3616,
    supersededSha256: '96bc6bd822feec06309654c82e45d4cc2c4ef2e19ce71600bcc33de7913c1924',
    supersededBytes: 3382,
  },
  'shaman/ghost_wolf': {
    sourceSha256: 'cbda79b17dbd1067d4156059f93e0c59ccf577a813653af5e3b4585ec1f9c775',
    acceptedSha256: 'cfd779a8108c6d57d8ce07820375316dd4ab0863c154c71d8778be501922e5ae',
    acceptedBytes: 4138,
    supersededSha256: 'dbb787612e78de186347c9610030e4e520e90b541318230ce0581ca1ca1c6301',
    supersededBytes: 3628,
  },
  'shaman/healing_wave': {
    sourceSha256: '7d9067bcaa4b9876b12c902e819f78e3808cbca67a007dafea4254d5203e5f1c',
    acceptedSha256: 'ab152e941bd443d514bfb726df83145f62f6260a3be6ddf4e10296660b78fd85',
    acceptedBytes: 4930,
    supersededSha256: '1ca329023dc89e198dfd32c32b3f3ed1d8747f85567df8d4b62fb4a52374f5f2',
    supersededBytes: 4088,
  },
  'shaman/lightning_bolt': {
    sourceSha256: 'd9eb987b25e90bae918d4640055a84a128c1ae101701e5ff752d3ffb0909c170',
    acceptedSha256: 'e25134c7a294ea5e9ca14ef24e682e8262288a3484fd08327299fe1aa02ce876',
    acceptedBytes: 4032,
    supersededSha256: '1b530a0a70850ac59d0e341df5e4972432ddca31ad5e6b35daefcf2d3cacce38',
    supersededBytes: 4780,
  },
  'shaman/lightning_shield': {
    sourceSha256: '3659e480d2703ce62207632489e722f96b451a080ba60b220fb680ff4f0b9dba',
    acceptedSha256: 'e11e8094d5cc452ded0de3565a37eaafe682cbd617a0a2218713935e006955f9',
    acceptedBytes: 4684,
    supersededSha256: '4305ba21084abd1815b24b920544a97cf29dda6798db0894332a9dff021345f2',
    supersededBytes: 3866,
  },
  'shaman/rockbiter_weapon': {
    sourceSha256: 'becd375b9519eed79c09b441279433338078112bc7f33d8eea8f35dd425b135b',
    acceptedSha256: 'a89dff7e0b4366100ab679d787d7cb0bf69ce3803a332c193e67ee4430d6d5c4',
    acceptedBytes: 3938,
    supersededSha256: '2bbfa1f796b76b5255ee815e6e02f8360e7dc72d530cfc2f716c8a6492c2b951',
    supersededBytes: 3056,
  },
  'shaman/stormstrike': {
    sourceSha256: 'a64299c31ccfea907d422009d272f457ee07f3969036985c54c882136ffb1068',
    acceptedSha256: '89daaddc5be6f509d431bc0868b3df2d3b45d0855dde12a28cbe3b37f807b9d8',
    acceptedBytes: 5666,
    supersededSha256: 'a0793840dd1438a1db5879c27728ffcfa55616b7ce4a05debc1c4d64fb131088',
    supersededBytes: 6094,
  },
} as const;

interface ReferencePin {
  path: string;
  role: string;
  provenance: string;
  license: string;
  sha256: string;
  usedAsGenerationInput: boolean;
}

interface SupersededPin {
  sourceCommit: string;
  owner: string;
  license: string;
  sourceManifest: string;
  sourcePack: string;
  sourceFile: string;
  output: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  format: string;
  colorSpace: string;
  channels: number;
  hasAlpha: boolean;
}

interface CohortAsset {
  kind: 'ability';
  class: 'priest' | 'rogue' | 'shaman';
  id: string;
  runtimeUrl: string;
  mappingManifest: string;
  sourcePath: string;
  sourceBytes: number;
  sourceSha256: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceFormat: string;
  sourceColorSpace: string;
  sourceChannels: number;
  sourceHasAlpha: boolean;
  acceptedBytes: number;
  acceptedSha256: string;
  acceptedWidth: number;
  acceptedHeight: number;
  acceptedFormat: string;
  acceptedColorSpace: string;
  acceptedChannels: number;
  acceptedHasAlpha: boolean;
  intendedVisualSubject: string;
  references: ReferencePin[];
  prompt: string;
  supersedes: SupersededPin;
  review: {
    status: string;
    attempt: number;
    regenerated: boolean;
    colorReview: Record<string, string>;
    grayscaleReview: Record<string, string>;
    circularCropReview: Record<string, string>;
    reason: string;
  };
}

interface CohortRecord {
  schemaVersion: number;
  batch: {
    id: string;
    cohort: string;
    acceptedDate: string;
    baseRelease: string;
    baseCommit: string;
    rasterGenerator: string;
    owner: string;
    license: string;
  };
  scope: {
    rasterPaintings: number;
    replacements: number;
    classes: Record<string, number>;
    abilityIds: string[];
  };
  generationContract: {
    oneBuiltInImagegenCallPerAsset: boolean;
    callCount: number;
  };
  contract: {
    width: number;
    height: number;
    maxBytes: number;
    alpha: string;
    colorSpace: string;
  };
  assets: CohortAsset[];
}

type MappingEntry = {
  abilityId: string;
  sourcePack: string;
  sourceFile: string;
  output: string;
  source: string;
  owner: string;
  license: string;
  acceptedArtManifest: string;
  intendedVisualSubject: string;
  references: ReferencePin[];
  generationPrompt: string;
  sourceSha256: string;
  sourceBytes: number;
  acceptedSha256: string;
  acceptedBytes: number;
  supersedes: SupersededPin;
};

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

function sourceCommitIsAvailable(): boolean {
  return (
    spawnSync('git', ['cat-file', '-e', `${SOURCE_COMMIT}^{commit}`], {
      cwd: repoRoot,
      stdio: 'ignore',
    }).status === 0
  );
}

function sourceCommitBlob(relativePath: string): Buffer {
  return execFileSync('git', ['show', `${SOURCE_COMMIT}:${relativePath}`], { cwd: repoRoot });
}

function readRecord(): CohortRecord {
  return JSON.parse(readFileSync(recordPath, 'utf8')) as CohortRecord;
}

describe('release v0.39 legacy Shaman, Rogue, and Priest skill repaint lineage', () => {
  it('seals the exact prompts, reference identities, source masters, and superseded bytes', () => {
    const recordBytes = readFileSync(recordPath);
    const record = JSON.parse(recordBytes.toString('utf8')) as CohortRecord;
    const expectedKeys = Object.keys(EXPECTED_PINS).sort();

    expect(sha256(recordBytes)).toBe(RECORD_SHA256);
    expect(record).toMatchObject({
      schemaVersion: 1,
      batch: {
        id: 'release-v039-icon-art-second-pass-legacy-shaman-rogue-priest-2026-08-16',
        cohort: 'legacy-shaman-rogue-priest',
        acceptedDate: '2026-08-16',
        baseRelease: 'release/v0.39.0',
        baseCommit: SOURCE_COMMIT,
        rasterGenerator: 'OpenAI built-in image generation',
        owner: 'World of ClaudeCraft',
        license: PROJECT_LICENSE,
      },
      scope: {
        rasterPaintings: 15,
        replacements: 15,
        classes: { shaman: 11, rogue: 3, priest: 1 },
      },
      generationContract: {
        oneBuiltInImagegenCallPerAsset: true,
        callCount: 15,
      },
      contract: {
        width: 128,
        height: 128,
        maxBytes: 15 * 1024,
        alpha: 'opaque',
        colorSpace: 'srgb',
      },
    });
    expect(record.assets.map((asset) => `${asset.class}/${asset.id}`).sort()).toEqual(expectedKeys);
    expect(record.scope.abilityIds).toEqual(
      expectedKeys.map((key) => key.slice(key.indexOf('/') + 1)).sort(),
    );

    const sourceHashes = new Set<string>();
    const acceptedHashes = new Set<string>();
    const supersededHashes = new Set<string>();
    const historicalReferenceBlobs = new Map<string, Buffer>();
    for (const asset of record.assets) {
      const key = `${asset.class}/${asset.id}` as keyof typeof EXPECTED_PINS;
      const expected = EXPECTED_PINS[key];
      expect(expected, `${key} literal pin`).toBeDefined();
      expect(asset).toMatchObject({
        kind: 'ability',
        runtimeUrl: `/ui/skills/${asset.class}/${asset.id}.webp`,
        mappingManifest: `public/ui/skills/${asset.class}/mapping.json`,
        sourcePath: `tmp/imagegen/v039-second-pass/legacy-shaman-rogue-priest/raw/${asset.id}.png`,
        sourceSha256: expected.sourceSha256,
        sourceWidth: 1254,
        sourceHeight: 1254,
        sourceFormat: 'png',
        sourceColorSpace: 'srgb',
        sourceChannels: 3,
        sourceHasAlpha: false,
        acceptedBytes: expected.acceptedBytes,
        acceptedSha256: expected.acceptedSha256,
        acceptedWidth: 128,
        acceptedHeight: 128,
        acceptedFormat: 'webp',
        acceptedColorSpace: 'srgb',
        acceptedChannels: 3,
        acceptedHasAlpha: false,
        supersedes: {
          sourceCommit: SOURCE_COMMIT,
          sourceManifest: `public/ui/skills/${asset.class}/mapping.json`,
          output: `${asset.id}.webp`,
          sha256: expected.supersededSha256,
          bytes: expected.supersededBytes,
          width: 128,
          height: 128,
          format: 'webp',
          colorSpace: 'srgb',
        },
        review: {
          status: 'accepted_supersedes_legacy',
          attempt: 1,
          regenerated: false,
        },
      });
      expect(asset.supersedes.owner, key).toContain('Levy Street');
      expect(asset.supersedes.license, key).toContain('CraftPix premium');
      expect(asset.supersedes.sourcePack.trim().length, key).toBeGreaterThan(0);
      expect(asset.supersedes.sourceFile.trim().length, key).toBeGreaterThan(0);
      expect(asset.prompt, key).toContain(`(${asset.id})`);
      expect(asset.prompt, key).toContain(`Subject: ${asset.intendedVisualSubject}`);
      expect(asset.prompt, key).toContain('Approved sibling references visually inspected:');
      expect(asset.references, key).toHaveLength(3);
      for (const reference of asset.references) {
        expect(reference.path, key).toMatch(/^public\/ui\/skills\/.+\.webp$/);
        expect(reference.role.trim().length, key).toBeGreaterThan(0);
        expect(reference.provenance, key).toBe('World of ClaudeCraft project asset');
        expect(reference.license, key).toBe(PROJECT_LICENSE);
        expect(reference.sha256, key).toMatch(/^[0-9a-f]{64}$/);
        expect(reference.usedAsGenerationInput, key).toBe(false);
        expect(existsSync(path.join(repoRoot, reference.path)), reference.path).toBe(true);
      }
      for (const size of ['16', '32', '48', '128']) {
        expect(asset.review.colorReview[size], `${key} color ${size}`).toBe('pass');
        expect(asset.review.grayscaleReview[size], `${key} grayscale ${size}`).toBe('pass');
        expect(asset.review.circularCropReview[size], `${key} circle ${size}`).toBe('pass');
      }
      expect(asset.review.reason.trim().length, key).toBeGreaterThan(0);

      const sourcePath = path.join(repoRoot, asset.sourcePath);
      if (existsSync(sourcePath)) {
        const sourceBytes = readFileSync(sourcePath);
        expect(sourceBytes.length, `${key} source bytes`).toBe(asset.sourceBytes);
        expect(sha256(sourceBytes), `${key} source hash`).toBe(asset.sourceSha256);
      }

      sourceHashes.add(asset.sourceSha256);
      acceptedHashes.add(asset.acceptedSha256);
      supersededHashes.add(asset.supersedes.sha256);
    }
    expect(sourceHashes.size).toBe(15);
    expect(acceptedHashes.size).toBe(15);
    expect(supersededHashes.size).toBe(15);

    if (sourceCommitIsAvailable()) {
      for (const asset of record.assets) {
        const oldBytes = sourceCommitBlob(`public${asset.runtimeUrl}`);
        expect(oldBytes.length, `${asset.id} superseded bytes`).toBe(asset.supersedes.bytes);
        expect(sha256(oldBytes), `${asset.id} superseded hash`).toBe(asset.supersedes.sha256);
        for (const reference of asset.references) {
          let referenceBytes = historicalReferenceBlobs.get(reference.path);
          if (!referenceBytes) {
            referenceBytes = sourceCommitBlob(reference.path);
            historicalReferenceBlobs.set(reference.path, referenceBytes);
          }
          expect(sha256(referenceBytes), `${asset.id}: ${reference.path}`).toBe(reference.sha256);
        }
      }
    }
  });

  it('keeps each current mapping owner and shipping WebP identical to the sealed cohort', async () => {
    const record = readRecord();
    const mappings = new Map<string, { licenseScope: string; abilities: MappingEntry[] }>();
    const acceptedHashes = new Set<string>();

    for (const asset of record.assets) {
      let mapping = mappings.get(asset.class);
      if (!mapping) {
        mapping = JSON.parse(
          readFileSync(path.join(repoRoot, `public/ui/skills/${asset.class}/mapping.json`), 'utf8'),
        ) as { licenseScope: string; abilities: MappingEntry[] };
        mappings.set(asset.class, mapping);
      }
      expect(mapping.licenseScope, asset.class).toContain('explicitly override');
      const owners = mapping.abilities.filter((entry) => entry.abilityId === asset.id);
      expect(owners, `${asset.class}/${asset.id} mapping owner`).toHaveLength(1);
      expect(owners[0]).toEqual({
        abilityId: asset.id,
        sourcePack: SOURCE_PACK,
        sourceFile: asset.sourcePath,
        output: `${asset.id}.webp`,
        source: 'OpenAI built-in image generation',
        owner: 'World of ClaudeCraft',
        license: PROJECT_LICENSE,
        acceptedArtManifest: recordRelativePath,
        intendedVisualSubject: asset.intendedVisualSubject,
        references: asset.references,
        generationPrompt: asset.prompt,
        sourceSha256: asset.sourceSha256,
        sourceBytes: asset.sourceBytes,
        acceptedSha256: asset.acceptedSha256,
        acceptedBytes: asset.acceptedBytes,
        supersedes: asset.supersedes,
      });

      expect(abilityImageUrl(asset.id), asset.id).toBe(asset.runtimeUrl);
      const shippingBytes = readFileSync(path.join(repoRoot, `public${asset.runtimeUrl}`));
      expect(shippingBytes.length, asset.id).toBe(asset.acceptedBytes);
      expect(shippingBytes.length, asset.id).toBeLessThanOrEqual(15 * 1024);
      expect(sha256(shippingBytes), asset.id).toBe(asset.acceptedSha256);
      expect(await sharp(shippingBytes).metadata(), asset.id).toMatchObject({
        format: 'webp',
        width: 128,
        height: 128,
        space: 'srgb',
        channels: 3,
        hasAlpha: false,
      });
      acceptedHashes.add(asset.acceptedSha256);
    }
    expect(acceptedHashes.size).toBe(15);
  });
});
