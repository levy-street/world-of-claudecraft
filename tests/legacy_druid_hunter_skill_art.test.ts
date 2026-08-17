import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { abilityImageUrl } from '../src/ui/icons';

const repoRoot = process.cwd();
const recordRelativePath =
  'docs/achievements/release-v039-icon-art-second-pass-2026-08-16/legacy-druid-hunter.json';
const recordPath = path.join(repoRoot, recordRelativePath);
const recordSha256 = '94edf6a115a79391aa36e89077d86823f01de135e9a8bff4aac16e97729689ee';
const sourcePack = 'woc_openai_release_v039_icon_art_second_pass_2026_08_16';
const projectLicense = 'World of ClaudeCraft project-generated art, project asset, rights reserved';

const expectedIds = {
  druid: [
    'bash',
    'bear_form',
    'cat_form',
    'claw',
    'demoralizing_roar',
    'ferocious_bite',
    'growl',
    'hibernate',
    'insect_swarm',
    'maul',
    'moonfire',
    'pounce',
    'prowl',
    'rake',
    'rejuvenation',
    'rip',
    'skull_bash',
    'swipe',
    'tigers_fury',
  ],
  hunter: ['aspect_of_the_hawk', 'dismiss_pet', 'tame_beast'],
} as const;

const expectedPins = {
  'druid/bear_form': {
    sourceSha256: '02f91c48f0c9065bb667f5105fbde1567cfa0141e01aa43ec5b8a95adad0454d',
    sourceBytes: 2588198,
    acceptedSha256: 'bf4b54b9653f1bad37f533e3390251a196bad47fd60f7a0333023be34fc00b7d',
    acceptedBytes: 5920,
    supersededSha256: 'c11836dc21183a3a025e21746dec23cecebe870e18b4a4183bb758119f035ab2',
    supersededBytes: 4282,
  },
  'druid/bash': {
    sourceSha256: '97eca7f6677cea0b09aee7cbbc7e0e50704d22cde6615293019bc3aa54134eb0',
    sourceBytes: 2293619,
    acceptedSha256: '43eb6bd7e190ceb6a74834f4a3ddc736f705e36bb29425e65c74d80cd8686d0a',
    acceptedBytes: 4820,
    supersededSha256: 'a1d342cc7279456b5eeb2caba4f9b09471aca2bf62aa8191c19d594c378c2e2b',
    supersededBytes: 4522,
  },
  'druid/maul': {
    sourceSha256: 'f59f309a10c81a27899ac25f60259e3278453350d4206dc3e0b91c5d6ee8256f',
    sourceBytes: 2265631,
    acceptedSha256: 'f9936595377b22b79325a9d0fc563c0a98f69e7b05786c3a16a9a4cb8075f6ae',
    acceptedBytes: 4766,
    supersededSha256: '8e44e643fbe01e24137d4e118d8b9beaf6ddffa8d64b574923f791a3cc1dc32a',
    supersededBytes: 3834,
  },
  'druid/growl': {
    sourceSha256: 'c934624d39d0aff32193281c015ae91c82b6c280d094fc2651b307a3c0a209f5',
    sourceBytes: 2205908,
    acceptedSha256: '5aff29325572f0657e55e0860c111709b12a55516ffd95eacc35a39a42b00c40',
    acceptedBytes: 4018,
    supersededSha256: '55aadfa3663c2e1e450f8ec61b2e942c5e01787655f0c909c4e48fb7f185f235',
    supersededBytes: 4020,
  },
  'druid/demoralizing_roar': {
    sourceSha256: '1ef6411e629f2e59fd39bd79ee256bc976a3cd05a419e94c27a17079d6633eb8',
    sourceBytes: 2460027,
    acceptedSha256: '1742fccb7a2e8dfd180c5cd2d8576e138ac5acac453eaf11686962168578dce3',
    acceptedBytes: 5364,
    supersededSha256: '426ed2cddfad31aa298041cc949a0eb4b6e1f35aa7312824757950ba0bb50f95',
    supersededBytes: 4878,
  },
  'druid/swipe': {
    sourceSha256: '418258255afc23680405665c5730dbdd54afa8e7cebb51c8dfbba6d4860fef24',
    sourceBytes: 2186735,
    acceptedSha256: '630f19527678bdb716a209f581669bfb4fdf716da78fb45545721b28cceea964',
    acceptedBytes: 5010,
    supersededSha256: 'c550468035ee03d4ddc6f51e610e6e8b8ffe700b861e4ef7140225fddc48cde4',
    supersededBytes: 3628,
  },
  'druid/skull_bash': {
    sourceSha256: '5b69216f1321eba26f5247fa0cde7abcffbf01a51de4a0286e84496a63e7f1bf',
    sourceBytes: 2638354,
    acceptedSha256: '31df591f21d194848a9db722596a7505f5ea5f5c2dd0d0385b13839f0f515397',
    acceptedBytes: 4990,
    supersededSha256: 'bbd01ec9d5d00685489657922706a2cbd428f4e3cbffbabc4031c79f508e0859',
    supersededBytes: 5904,
  },
  'druid/cat_form': {
    sourceSha256: 'b5bf8ce0ab9a46140b45276429e534add8bc7ef932494794bf7c4729501bff22',
    sourceBytes: 2433120,
    acceptedSha256: '3406475c02688aaf6f11bcadd3bcda7e9561a222af5bad0e4ec7413e1aed08db',
    acceptedBytes: 4156,
    supersededSha256: '9375a7cd37a4c828d7f14eed549cf27d0a0655aef64d2af24306a5e38861a079',
    supersededBytes: 4320,
  },
  'druid/claw': {
    sourceSha256: '3f7ce32e8af14236275ffadca4fd52c202d52309c049b63ea4264ada8881a76b',
    sourceBytes: 2166243,
    acceptedSha256: 'ceb332a3c96da85958ac5cbc944861f4a932c4601f2cf88c3786b7453764c784',
    acceptedBytes: 3802,
    supersededSha256: 'f81dd996d89973a429bd9d5967d9e3722d46f24bd4f1529bedf8938074a8f33a',
    supersededBytes: 3884,
  },
  'druid/ferocious_bite': {
    sourceSha256: '3dfb6ac2807130bfcbf481d273d7f75ad3d622967beca29789fbdc2831bd95fc',
    sourceBytes: 2365585,
    acceptedSha256: '04ddddf7d472507cd680f74d34dd07a9e6eb0af290ce13417a03e41d1b83124d',
    acceptedBytes: 3620,
    supersededSha256: 'ee674968c726131e79a44b4828ca3852afaa937a6b666df6d7a591c1afbe77c9',
    supersededBytes: 5878,
  },
  'druid/rake': {
    sourceSha256: '379ab7ae7ee48fc7aa865e3b70149719579a3b49f4073ac35ddf941bc04d2bb1',
    sourceBytes: 2487191,
    acceptedSha256: 'b4945369b032095dd5872453cfc443b948bb8feab5664706c1f70f993e6b9251',
    acceptedBytes: 3532,
    supersededSha256: 'bc4038f34c6b3d80c92334d7fe9f2f0c6ae092c68a12e62f8fa1a910ef5167a0',
    supersededBytes: 5066,
  },
  'druid/rip': {
    sourceSha256: '509417ea49749faead1653449a3d7a39d482d61fe16fdad5768ce8dd9c772c26',
    sourceBytes: 2666111,
    acceptedSha256: '8b71692c6dcc8773b248fc888cbc5edbab00445a2c6d85693bcac894011a1b1b',
    acceptedBytes: 3514,
    supersededSha256: '7f40c4ee1e54a58a5a72e69409b6e8598465c5f2fb08c61dcccb6afefa39798b',
    supersededBytes: 4014,
  },
  'druid/pounce': {
    sourceSha256: '30a7cd19b5f4c6b96cc99abd1dee65be158186ec977e04abf12f8e3dcf676b6a',
    sourceBytes: 2367947,
    acceptedSha256: '389bf19db7d26ae351b2d702fdb4672e8782da51410ea39ce3b36c408d963bf3',
    acceptedBytes: 4504,
    supersededSha256: '2786e05605f52987caf23a717a65eb7425abf86ae7f63981407f5a3402ac4c53',
    supersededBytes: 5882,
  },
  'druid/prowl': {
    sourceSha256: '16deeac27e4157599b8b6d0a96e488b600978933bc5df5c83efd4f14f9524f43',
    sourceBytes: 2021569,
    acceptedSha256: 'e9965dfe5abbaa94410175f2b4aae984edbc5616f2f4181e25b299bfc62ee5a3',
    acceptedBytes: 2112,
    supersededSha256: '298aef26a1a4387418902d01256e1f8e69b08ee19993fe82caf6cd9dd2d6c384',
    supersededBytes: 3742,
  },
  'druid/tigers_fury': {
    sourceSha256: 'c4ac78117f42b90e77261228986968590eabed7f8ece17d82a5b6e5a96916ade',
    sourceBytes: 2595626,
    acceptedSha256: '647e550f9b35dabbd83b2957589006e54340630a57aea44e97edd2ea9f09e451',
    acceptedBytes: 6268,
    supersededSha256: 'c640c8326ebb461569c70836ca10dbe86be1e05400a28af9bec7d6a02686135f',
    supersededBytes: 3538,
  },
  'druid/moonfire': {
    sourceSha256: 'da79eb46e95a271167243505bfe9fedbb5d8b21997dfe636214f814c49a2846f',
    sourceBytes: 2382070,
    acceptedSha256: '7b07b3c3b7d3c931d57a921c47a41671576218e96e60966f03e4908e6eb8c61d',
    acceptedBytes: 3666,
    supersededSha256: '984b11a3f9b06166011248bf4ba7a5834760aacbbb8e9f411457a96027e9867a',
    supersededBytes: 1568,
  },
  'druid/insect_swarm': {
    sourceSha256: '063d80ca2afbcee1b6f8b46f4f4e102c368a8673752fbc801779b5acd6b7c011',
    sourceBytes: 2241734,
    acceptedSha256: 'ea25d7e0467a98c3254785806f6dbf5316555b9fb6c01a5bc67b21bab6afabfb',
    acceptedBytes: 5016,
    supersededSha256: 'e9d312553ec0f9789f13a3fabf3606dab94b74d1d0d020488af50b9d3c41743f',
    supersededBytes: 4324,
  },
  'druid/hibernate': {
    sourceSha256: '62a86e1d90bf49fc9d713b5861e70625e057f748b1d0d0b049bd6dce4e3f912a',
    sourceBytes: 2480384,
    acceptedSha256: 'ddb85671e65882a4ffc9d25e9da05664b5873be5af18897e5ab0753977f67d7c',
    acceptedBytes: 4074,
    supersededSha256: 'cda94b782478dd836e5c2e671a98199807225f7effc68be57aeff4c5d6771302',
    supersededBytes: 6066,
  },
  'druid/rejuvenation': {
    sourceSha256: 'da1ba88122faf20af0edd5865317ac4c026e6d87b4486cc3558661c58ea34af9',
    sourceBytes: 2130535,
    acceptedSha256: '6af8ec04dae87e6044dd29763cbc0c44a281800dd7055d087461d6fa2b2f22c7',
    acceptedBytes: 3870,
    supersededSha256: 'cc04587de746bbdbf5a60b041fb1faf247fbe6f5d3acc1ef430d34c88450f9a1',
    supersededBytes: 4142,
  },
  'hunter/aspect_of_the_hawk': {
    sourceSha256: 'bb02c3991b7e22bb008382afed61f03265ffccbca66be473accf8dbf92cac12f',
    sourceBytes: 2153118,
    acceptedSha256: 'a278be6f7d64929d3bfb63bb0cc1fb88daed554e7062dad09af5fca147ddb71b',
    acceptedBytes: 4522,
    supersededSha256: '529d6fc108dd93be2eae47425a68eb115aa72d21921e168d2a876a01b9c92fdf',
    supersededBytes: 4554,
  },
  'hunter/tame_beast': {
    sourceSha256: '5f18e2399cbfa8847ab71517b435d3b8e00e01666a12d6e1110c6d1fc897e604',
    sourceBytes: 2000612,
    acceptedSha256: '54ec0991bb9a48fda36e818114e4a83731fd88053917455d9ca752d70e23b887',
    acceptedBytes: 3254,
    supersededSha256: '70e4613a50fc4b12989f7dc25b235dbf5d4a20c9b7902db4753c4b708c71a109',
    supersededBytes: 2726,
  },
  'hunter/dismiss_pet': {
    sourceSha256: 'eb5fc3723709720a2de51f21e82a44276f2abe151e8b0fd04c77394d656b65c7',
    sourceBytes: 2129225,
    acceptedSha256: '52eadf332e1a375638833b36c6751e020b8f1b9fe04282296d2464e3547a70cb',
    acceptedBytes: 4022,
    supersededSha256: '990fadabd966ea9577b48ec1652361b468b002ea8c35e9c7e42bd501d9203e79',
    supersededBytes: 3502,
  },
} as const;

interface ReferenceRecord {
  order: number;
  path: string;
  role: string;
}

interface RejectedAttempt {
  decision: 'rejected';
  reason: string;
  prompt: string;
  references: ReferenceRecord[];
  sourceFile: string;
  sourceSha256: string;
  sourceBytes: number;
  width: number;
  height: number;
  colorSpace: string;
  opaque: boolean;
}

interface CohortAsset {
  kind: 'ability';
  class: keyof typeof expectedIds;
  abilityId: string;
  liveName: string;
  researchedLiveMechanic: string;
  oldShipping: {
    sourceCommit: string;
    path: string;
    sha256: string;
    bytes: number;
    width: number;
    height: number;
    colorSpace: string;
    opaque: boolean;
  };
  oldMapping: {
    path: string;
    sourcePack: string;
    sourceFile: string;
    output: string;
    source: string;
    ownerOrLicense: string;
    inheritedClassLicense: string;
  };
  generation: {
    mode: string;
    builtInCallCount: number;
    prompt: string;
    references: ReferenceRecord[];
    sourceFile: string;
    sourceSha256: string;
    sourceBytes: number;
    width: number;
    height: number;
    colorSpace: string;
    opaque: boolean;
  };
  accepted: {
    output: string;
    sha256: string;
    bytes: number;
    width: number;
    height: number;
    colorSpace: string;
    opaque: boolean;
    decision: string;
    review: {
      semantic: string;
      crop: string;
      style: string;
      sizesPx: number[];
      grayscale: string;
      circularCrop: string;
      evidence: string[];
    };
  };
  intendedVisualSubject: string;
  rejects: RejectedAttempt[];
  retries: number;
}

interface CohortRecord {
  schemaVersion: number;
  batch: string;
  baseRelease: string;
  baseCommit: string;
  owner: string;
  license: string;
  result: {
    requested: number;
    generated: number;
    accepted: number;
    rejected: number;
    retried: number;
  };
  generationPolicy: {
    generator: string;
    oneImagegenCallPerDistinctAttempt: boolean;
    correctiveRetryOnlyAfterReviewFailure: boolean;
  };
  contract: {
    width: number;
    height: number;
    maxBytes: number;
    colorSpace: string;
    alpha: string;
  };
  assets: CohortAsset[];
}

interface MappingEntry {
  abilityId: string;
  sourcePack: string;
  sourceFile: string;
  output: string;
  source: string;
  owner: string;
  license: string;
  provenanceRecord: string;
  intendedVisualSubject: string;
  references: ReferenceRecord[];
  generationPrompt: string;
  sourceSha256: string;
  sourceBytes: number;
  sourceWidth: number;
  sourceHeight: number;
  acceptedSha256: string;
  acceptedBytes: number;
  acceptedWidth: number;
  acceptedHeight: number;
  acceptedColorSpace: string;
  acceptedOpaque: boolean;
  review: {
    sizesPx: number[];
    grayscale: string;
    circularCrop: string;
    semantic: string;
    crop: string;
    style: string;
  };
  supersedes: {
    sourcePack: string;
    sourceFile: string;
    ownerOrLicense: string;
    inheritedClassLicense: string;
    output: string;
    shippingSha256: string;
    shippingBytes: number;
    width: number;
    height: number;
    colorSpace: string;
    opaque: boolean;
    reason: string;
  };
}

interface SkillMapping {
  licenseScope: string;
  abilities: MappingEntry[];
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const sorted = (values: Iterable<string>): string[] =>
  [...values].sort((left, right) => left.localeCompare(right));
const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')) as T;

function sourceCommitIsAvailable(commit: string): boolean {
  return (
    spawnSync('git', ['cat-file', '-e', `${commit}^{commit}`], {
      cwd: repoRoot,
      stdio: 'ignore',
    }).status === 0
  );
}

describe('release v0.39 legacy Druid and Hunter skill repaints', () => {
  it('pins the exact cohort inventory, prompts, references, and supersession owners', () => {
    const recordBytes = readFileSync(recordPath);
    const recordText = recordBytes.toString('utf8');
    const cohort = JSON.parse(recordText) as CohortRecord;
    const expectedKeys = Object.keys(expectedPins).sort();
    const actualKeys = cohort.assets
      .map(({ class: className, abilityId }) => `${className}/${abilityId}`)
      .sort();

    expect(sha256(recordBytes)).toBe(recordSha256);
    expect(recordText).not.toMatch(/[\u2013\u2014]/u);
    expect(cohort).toMatchObject({
      schemaVersion: 1,
      batch: 'release-v039-second-pass-legacy-druid-hunter-2026-08-16',
      baseRelease: 'release/v0.39.0',
      owner: 'World of ClaudeCraft',
      license: projectLicense,
      result: {
        requested: 22,
        generated: 23,
        accepted: 22,
        rejected: 1,
        retried: 1,
      },
      generationPolicy: {
        generator: 'OpenAI built-in image generation',
        oneImagegenCallPerDistinctAttempt: true,
        correctiveRetryOnlyAfterReviewFailure: true,
      },
      contract: {
        width: 128,
        height: 128,
        maxBytes: 15 * 1024,
        colorSpace: 'sRGB',
        alpha: 'opaque',
      },
    });
    expect(actualKeys).toEqual(expectedKeys);
    expect(new Set(actualKeys).size).toBe(22);

    for (const asset of cohort.assets) {
      const key = `${asset.class}/${asset.abilityId}` as keyof typeof expectedPins;
      const expected = expectedPins[key];
      const mappingPath = `public/ui/skills/${asset.class}/mapping.json`;
      const mapping = readJson<SkillMapping>(mappingPath);
      const owners = mapping.abilities.filter(({ abilityId }) => abilityId === asset.abilityId);
      const cohortOwners = mapping.abilities.filter(
        ({ provenanceRecord }) => provenanceRecord === recordRelativePath,
      );
      const entry = owners[0];

      expect(expected, `${key} literal pin`).toBeDefined();
      expect(asset.kind).toBe('ability');
      expect(asset.generation).toMatchObject({
        mode: 'OpenAI built-in image generation',
        sourceSha256: expected.sourceSha256,
        sourceBytes: expected.sourceBytes,
        width: 1254,
        height: 1254,
        colorSpace: 'sRGB',
        opaque: true,
      });
      expect(asset.generation.prompt.length, `${key} exact prompt`).toBeGreaterThan(500);
      expect(asset.generation.prompt).toContain(`runtime ID ${asset.abilityId}`);
      expect(asset.generation.references).toHaveLength(3);
      expect(asset.generation.references.map(({ order }) => order)).toEqual([1, 2, 3]);
      expect(
        asset.generation.references.every(({ path: referencePath, role }) => {
          return referencePath.length > 0 && role.length > 0;
        }),
      ).toBe(true);
      expect(asset.researchedLiveMechanic.length, `${key} researched mechanic`).toBeGreaterThan(40);
      expect(asset.intendedVisualSubject.length, `${key} visual subject`).toBeGreaterThan(40);
      expect(asset.oldMapping.path).toBe(mappingPath);
      expect(asset.oldShipping).toMatchObject({
        sourceCommit: cohort.baseCommit,
        path: `public/ui/skills/${asset.class}/${asset.abilityId}.webp`,
        sha256: expected.supersededSha256,
        bytes: expected.supersededBytes,
        width: 128,
        height: 128,
        colorSpace: 'sRGB',
      });
      expect(asset.accepted).toMatchObject({
        output: `public/ui/skills/${asset.class}/${asset.abilityId}.webp`,
        sha256: expected.acceptedSha256,
        bytes: expected.acceptedBytes,
        width: 128,
        height: 128,
        colorSpace: 'sRGB',
        opaque: true,
        decision: 'accepted',
        review: {
          semantic: 'accepted',
          crop: 'accepted',
          style: 'accepted',
          sizesPx: [128, 48, 32, 16],
          grayscale: 'accepted',
          circularCrop: 'accepted',
        },
      });

      expect(owners, `${key} one current mapping owner`).toHaveLength(1);
      expect(sorted(cohortOwners.map(({ abilityId }) => abilityId))).toEqual(
        sorted(expectedIds[asset.class]),
      );
      expect(mapping.licenseScope).toContain(sourcePack);
      expect(entry).toMatchObject({
        abilityId: asset.abilityId,
        sourcePack,
        sourceFile: asset.generation.sourceFile,
        output: `${asset.abilityId}.webp`,
        source: 'OpenAI built-in image generation',
        owner: 'World of ClaudeCraft',
        license: projectLicense,
        provenanceRecord: recordRelativePath,
        intendedVisualSubject: asset.intendedVisualSubject,
        sourceSha256: expected.sourceSha256,
        sourceBytes: expected.sourceBytes,
        sourceWidth: 1254,
        sourceHeight: 1254,
        acceptedSha256: expected.acceptedSha256,
        acceptedBytes: expected.acceptedBytes,
        acceptedWidth: 128,
        acceptedHeight: 128,
        acceptedColorSpace: 'sRGB',
        acceptedOpaque: true,
      });
      expect(entry.references).toEqual(asset.generation.references);
      expect(entry.generationPrompt).toBe(asset.generation.prompt);
      expect(entry.review).toEqual({
        sizesPx: [128, 48, 32, 16],
        grayscale: 'accepted',
        circularCrop: 'accepted',
        semantic: 'accepted',
        crop: 'accepted',
        style: 'accepted',
      });
      expect(entry.supersedes).toEqual({
        sourcePack: asset.oldMapping.sourcePack,
        sourceFile: asset.oldMapping.sourceFile,
        ownerOrLicense: asset.oldMapping.ownerOrLicense,
        inheritedClassLicense: asset.oldMapping.inheritedClassLicense,
        output: `${asset.abilityId}.webp`,
        shippingSha256: expected.supersededSha256,
        shippingBytes: expected.supersededBytes,
        width: 128,
        height: 128,
        colorSpace: 'sRGB',
        opaque: asset.oldShipping.opaque,
        reason:
          'Release v0.39 second-pass audit replaced a high-confidence legacy flat/cartoon outlier with mechanic-accurate premium painted art.',
      });
      expect(entry.acceptedSha256).not.toBe(entry.supersedes.shippingSha256);

      if (existsSync(path.join(repoRoot, asset.generation.sourceFile))) {
        const sourceBytes = readFileSync(path.join(repoRoot, asset.generation.sourceFile));
        expect(sourceBytes.length, `${key} staged raw bytes`).toBe(expected.sourceBytes);
        expect(sha256(sourceBytes), `${key} staged raw SHA-256`).toBe(expected.sourceSha256);
      }
    }
  });

  it('pins each current opaque 128px WebP and the retired source blob when available', async () => {
    const cohort = readJson<CohortRecord>(recordRelativePath);
    const acceptedHashes = new Set<string>();

    for (const asset of cohort.assets) {
      const key = `${asset.class}/${asset.abilityId}` as keyof typeof expectedPins;
      const expected = expectedPins[key];
      const bytes = readFileSync(path.join(repoRoot, asset.accepted.output));
      const metadata = await sharp(bytes).metadata();

      expect(abilityImageUrl(asset.abilityId), `${key} runtime URL`).toBe(
        `/ui/skills/${asset.class}/${asset.abilityId}.webp`,
      );
      expect(bytes.length, `${key} accepted bytes`).toBe(expected.acceptedBytes);
      expect(bytes.length, `${key} byte ceiling`).toBeLessThanOrEqual(15 * 1024);
      expect(sha256(bytes), `${key} accepted SHA-256`).toBe(expected.acceptedSha256);
      expect(metadata, `${key} image contract`).toMatchObject({
        format: 'webp',
        width: 128,
        height: 128,
        space: 'srgb',
        hasAlpha: false,
      });
      expect(acceptedHashes.has(expected.acceptedSha256), `${key} unique painting`).toBe(false);
      acceptedHashes.add(expected.acceptedSha256);

      if (sourceCommitIsAvailable(cohort.baseCommit)) {
        const oldBytes = execFileSync(
          'git',
          ['show', `${cohort.baseCommit}:${asset.oldShipping.path}`],
          { cwd: repoRoot, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 },
        );
        expect(oldBytes.length, `${key} retired bytes`).toBe(expected.supersededBytes);
        expect(sha256(oldBytes), `${key} retired SHA-256`).toBe(expected.supersededSha256);
      }
    }

    expect(acceptedHashes.size).toBe(22);
  });

  it('records the rejected scenic Release Companion attempt and corrective repaint', () => {
    const cohort = readJson<CohortRecord>(recordRelativePath);
    const dismiss = cohort.assets.find(({ abilityId }) => abilityId === 'dismiss_pet');
    const ordinaryAssets = cohort.assets.filter(({ abilityId }) => abilityId !== 'dismiss_pet');

    expect(ordinaryAssets).toHaveLength(21);
    expect(
      ordinaryAssets.every(
        ({ generation, rejects, retries }) =>
          generation.builtInCallCount === 1 && rejects.length === 0 && retries === 0,
      ),
    ).toBe(true);
    expect(dismiss?.generation.builtInCallCount).toBe(2);
    expect(dismiss?.retries).toBe(1);
    expect(dismiss?.rejects).toHaveLength(1);
    expect(dismiss?.rejects[0]).toMatchObject({
      decision: 'rejected',
      reason:
        'Beautiful and semantically correct at 128 px, but the distant full-body wolf, foreground hand, and large scenic gap collapsed into murk at 16 px; failed the small-size silhouette gate.',
      sourceFile:
        'tmp/imagegen/v039-second-pass/legacy-druid-hunter/raw/rejected/dismiss_pet-attempt-1.png',
      sourceSha256: '5c3698064fd845a05953f672470df81f352fda2172512f13c55f86971dd98508',
      sourceBytes: 2148935,
      width: 1254,
      height: 1254,
      colorSpace: 'sRGB',
      opaque: true,
    });
    expect(dismiss?.rejects[0].references.map(({ order }) => order)).toEqual([1, 2, 3]);
    expect(dismiss?.rejects[0].prompt).toContain('walking away into a softly lit forest opening');
    expect(dismiss?.generation.prompt).toContain('extremely tight action-bar composition');
  });
});
