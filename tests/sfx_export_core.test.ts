import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped zero-dependency authoring tool (scripts/*.mjs convention)
import * as exportBundleModule from '../scripts/sfx_studio/export_bundle.mjs';
// @ts-expect-error untyped zero-dependency authoring tool (scripts/*.mjs convention)
import { buildDeterministicZip } from '../scripts/sfx_studio/zip.mjs';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';

const {
  assertExportableSfxTrack,
  buildSfxProductionBundle,
  uniqueBlobEntries,
  validateProductionTracks,
} = exportBundleModule;

const ROOT = process.cwd();
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function storedZipEntries(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = zip.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const dataStart = nameStart + nameLength + extraLength;
    entries.set(name, zip.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

function writeArtifact(root: string, files: Map<string, Buffer>): void {
  for (const [name, bytes] of files) {
    const output = join(root, name);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, bytes);
  }
}

function snapshotDirectory(root: string, relative = ''): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const directory = join(root, relative);
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      snapshot[`${name}/`] = 'directory';
      Object.assign(snapshot, snapshotDirectory(root, name));
    } else {
      snapshot[name] = `file:${hash(readFileSync(join(root, name)))}`;
    }
  }
  return snapshot;
}

type InstallerResult = { error?: Error; status: number | null; stderr: string };

// The installer cases are independent processes over separate fixture roots.
// Under Git for Windows sh, a POSIX install forks several tools per blob (about
// 100 s for the full catalog), so the cases run side by side: the wall clock is
// the slowest case instead of the sum. Every case still runs on every platform.
function runInstaller(command: string, args: string[]): Promise<InstallerResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => resolve({ error, status: null, stderr }));
    child.on('close', (status) => resolve({ status, stderr }));
  });
}

// Waits for every installer before the fixture is removed, then fails with the
// first failing case.
async function settleAll(runs: Promise<unknown>[]): Promise<void> {
  const failed = (await Promise.allSettled(runs)).find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failed) throw failed.reason;
}

describe('SFX production bundle', () => {
  it('requires every exported blob to decode and pass the fixed production spec', async () => {
    expect(await assertExportableSfxTrack(join(ROOT, 'public/audio/sfx/ui_click.mp3'))).toMatch(
      /^[a-f0-9]{64}$/,
    );

    if (!ffmpegPath) throw new Error('ffmpeg-static is unavailable');
    const fixture = mkdtempSync(join(tmpdir(), 'woc-sfx-export-validation-'));
    try {
      const malformed = join(fixture, 'malformed.mp3');
      writeFileSync(malformed, 'not audio');
      await expect(assertExportableSfxTrack(malformed)).rejects.toThrow(
        'published SFX is not decodable: malformed.mp3',
      );

      const unconformed = join(fixture, 'unconformed.mp3');
      execFileSync(ffmpegPath, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=0.5',
        '-ac',
        '1',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '128k',
        unconformed,
      ]);
      await expect(assertExportableSfxTrack(unconformed)).rejects.toThrow(
        'published SFX is not production-conforming: unconformed.mp3',
      );

      const wrongCodec = join(fixture, 'pcm-named-mp3.mp3');
      execFileSync(ffmpegPath, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100:duration=0.5',
        '-ac',
        '1',
        '-codec:a',
        'pcm_s16le',
        '-f',
        'wav',
        wrongCodec,
      ]);
      await expect(assertExportableSfxTrack(wrongCodec)).rejects.toThrow('codec must be MP3');

      const repository = join(fixture, 'repository');
      const audioDirectory = join(repository, 'public/audio/sfx');
      mkdirSync(audioDirectory, { recursive: true });
      mkdirSync(join(repository, 'scripts/sfx'), { recursive: true });
      const copied = new Set<string>();
      for (const clip of Object.values(SFX_CLIPS)) {
        for (const variant of clip.variants) {
          const filename = variant.url.match(/^\/audio\/sfx\/([^?]+)\?v=/)?.[1];
          if (!filename || copied.has(filename)) continue;
          copied.add(filename);
          copyFileSync(join(ROOT, 'public/audio/sfx', filename), join(audioDirectory, filename));
        }
      }
      writeFileSync(join(repository, 'scripts/sfx/sfx_mix.json'), '{"version":1,"clips":{}}\n');

      // foot_grass has several real takes now (no bare file), so corrupt an
      // actually-referenced variant, not a filename the export builder would
      // never look at.
      const published = join(audioDirectory, 'foot_grass_1.mp3');
      writeFileSync(published, 'not audio');
      await expect(buildSfxProductionBundle(repository)).rejects.toThrow(
        'published SFX is not decodable: foot_grass_1.mp3',
      );
      execFileSync(ffmpegPath, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=0.5',
        '-ac',
        '1',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '128k',
        published,
      ]);
      await expect(buildSfxProductionBundle(repository)).rejects.toThrow(
        'published SFX is not production-conforming: foot_grass_1.mp3',
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);

  it('reports the first failing track in export order when validating concurrently', async () => {
    if (!ffmpegPath) throw new Error('ffmpeg-static is unavailable');
    const fixture = mkdtempSync(join(tmpdir(), 'woc-sfx-export-order-'));
    try {
      // The decodable-but-nonconforming take fails only after ffprobe AND the
      // ebur128 pass; the garbage take fails at ffprobe. Run side by side, the
      // later track finishes failing first, and a serial pass would still have
      // reported the earlier one.
      const slowFailure = join(fixture, 'slow_failure.mp3');
      execFileSync(ffmpegPath, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=3',
        '-ac',
        '1',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '128k',
        slowFailure,
      ]);
      const track = (path: string, bytes: Buffer) => ({ path, identity: hash(bytes), bytes });
      const conforming = readFileSync(join(ROOT, 'public/audio/sfx/ui_click.mp3'));
      const tracks = [
        track(join(ROOT, 'public/audio/sfx/ui_click.mp3'), conforming),
        track(slowFailure, readFileSync(slowFailure)),
        track(join(fixture, 'fast_failure.mp3'), Buffer.from('not audio')),
      ];
      for (const concurrency of [1, 3]) {
        await expect(
          validateProductionTracks(tracks, concurrency),
          `x${concurrency}`,
        ).rejects.toThrow('published SFX is not production-conforming: slow_failure.mp3');
      }
      await expect(validateProductionTracks([tracks[0], tracks[2]], 2)).rejects.toThrow(
        'published SFX is not decodable: fast_failure.mp3',
      );
      // One failing blob at two positions shares a verdict; the error names the
      // earlier of the two tracks.
      const garbage = Buffer.from('shared garbage take');
      await expect(
        validateProductionTracks(
          [
            tracks[0],
            track(join(fixture, 'first_copy.mp3'), garbage),
            track(join(fixture, 'second_copy.mp3'), garbage),
          ],
          3,
        ),
      ).rejects.toThrow('published SFX is not decodable: first_copy.mp3');
      await expect(validateProductionTracks(tracks, 0)).rejects.toThrow(RangeError);
      await expect(validateProductionTracks(tracks, Number.NaN)).rejects.toThrow(RangeError);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('reports a read failure only after every earlier track validated', async () => {
    if (!ffmpegPath) throw new Error('ffmpeg-static is unavailable');
    const repository = mkdtempSync(join(tmpdir(), 'woc-sfx-export-read-order-'));
    try {
      const audioDirectory = join(repository, 'public/audio/sfx');
      mkdirSync(audioDirectory, { recursive: true });
      const conforming = readFileSync(join(ROOT, 'public/audio/sfx/ui_click.mp3'));
      writeFileSync(join(audioDirectory, 'conforming.mp3'), conforming);
      writeFileSync(join(audioDirectory, 'garbage.mp3'), 'not audio');
      writeFileSync(join(audioDirectory, 'changed.mp3'), conforming);
      const variant = (filename: string, bytes: Buffer, sha256 = hash(bytes)) => ({
        url: `/audio/sfx/${filename}?v=${sha256.slice(0, 12)}`,
        bytes: bytes.length,
        sha256,
      });
      // changed.mp3 is listed under a digest its bytes do not have: the read
      // pass fails on it as a file that changed while exporting.
      const changed = variant('changed.mp3', conforming, 'f'.repeat(64));
      const entries = (...variants: ReturnType<typeof variant>[]) => ({
        cue: { variants },
      });
      const garbage = variant('garbage.mp3', Buffer.from('not audio'));
      const good = variant('conforming.mp3', conforming);

      // A nonconforming track before the read failure wins, as in a serial pass.
      await expect(uniqueBlobEntries(repository, entries(good, garbage, changed))).rejects.toThrow(
        'published SFX is not decodable: garbage.mp3',
      );
      // With every earlier track conforming, the read failure itself surfaces.
      await expect(uniqueBlobEntries(repository, entries(good, changed, garbage))).rejects.toThrow(
        'published SFX changed while exporting: changed.mp3',
      );
      const ok = await uniqueBlobEntries(repository, entries(good, good));
      expect(ok.trackCount).toBe(2);
      expect(ok.totalAudioBytes).toBe(2 * conforming.length);
      expect([...ok.blobs.keys()]).toEqual([hash(conforming)]);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it('measures the production-conformance verdict with the shared SFX conformance toolchain', async () => {
    // The export validator must resolve the same binaries that gate the checked-in
    // assets (scripts/sfx_conform.mjs / npm run sfx:check), not the PATH ffmpeg
    // the Studio spawns for playback. A newer PATH ffmpeg measures MP3 duration a
    // few tens of milliseconds shorter, which flips these clips across the
    // one-second peak/LUFS branch boundary and rejects a clip the gate accepts.
    // ffprobe-static@3.1.0 has no Linux arm64 binary, so the shared conformance
    // resolver falls back to PATH ffprobe only when the static binary is absent.
    expect(exportBundleModule.CONFORMANCE_FFMPEG_PATH).toBe(ffmpegPath);
    expect(exportBundleModule.CONFORMANCE_FFPROBE_PATH).toBe(
      existsSync(ffprobeStatic.path) ? ffprobeStatic.path : 'ffprobe',
    );
    // The constants alone do not prove the validator USES them: pin the call-site
    // wiring so a revert to the PATH binaries (which only misbehaves on machines
    // whose PATH ffmpeg diverges from the bundled one) reds deterministically.
    const exportSrc = readFileSync(join(ROOT, 'scripts/sfx_studio/export_bundle.mjs'), 'utf8');
    expect(exportSrc).toContain('ffmpegPath: CONFORMANCE_FFMPEG_PATH');
    expect(exportSrc).toContain('ffprobePath: CONFORMANCE_FFPROBE_PATH');
    for (const clip of [
      'mob_demon_hurt',
      'mob_humanoid_hurt_2',
      'mob_troll_hurt',
      'mob_reptile_death_2',
    ]) {
      expect(
        await assertExportableSfxTrack(join(ROOT, `public/audio/sfx/${clip}.mp3`)),
        clip,
      ).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('is byte deterministic and includes the exact published runtime state', async () => {
    const first = await buildSfxProductionBundle(ROOT);
    const second = await buildSfxProductionBundle(ROOT);
    expect(first.sha256).toBe(second.sha256);
    expect(first.zip.equals(second.zip)).toBe(true);
    expect(first.metadata.keyCount).toBe(Object.keys(SFX_CLIPS).length);
    expect(first.metadata.trackCount).toBe(
      Object.values(SFX_CLIPS).reduce((sum, clip) => sum + clip.variants.length, 0),
    );

    const files = storedZipEntries(first.zip);
    const runtime = JSON.parse(
      files.get('activate/audio/sfx/runtime-pack.json')?.toString('utf8') ?? '',
    );
    expect(runtime.bundleId).toBe(first.metadata.runtimeBundleId);
    expect(runtime.bundleId).toBe(
      hash(Buffer.from(JSON.stringify({ catalogHash: runtime.catalogHash, clips: runtime.clips }))),
    );
    expect(first.metadata.bundleId).not.toBe(first.metadata.runtimeBundleId);
    expect(Object.keys(runtime.clips).sort()).toEqual(Object.keys(SFX_CLIPS).sort());
    for (const clip of Object.values(runtime.clips) as {
      variants: { url: string; sha256: string; bytes: number }[];
    }[]) {
      for (const variant of clip.variants) {
        expect(variant.url).toBe(`/audio/sfx/blobs/${variant.sha256}.mp3`);
        const blob = files.get(`payload/audio/sfx/blobs/${variant.sha256}.mp3`);
        expect(blob).toBeDefined();
        expect(blob?.length).toBe(variant.bytes);
        expect(blob && hash(blob)).toBe(variant.sha256);
      }
    }
    expect([...files.keys()].some((name) => /draft|preview|source|version/i.test(name))).toBe(
      false,
    );
    expect(files.has('authoring/sfx_gain_map.json')).toBe(true);
    expect(files.has('authoring/sfx_speed_map.json')).toBe(true);
    expect(files.has('authoring/sfx_mix.json')).toBe(true);
    expect(files.has('install.sh')).toBe(true);
    expect(files.has('install.mjs')).toBe(true);
    expect(files.has('install-blobs.txt')).toBe(true);
    expect(files.has('SHA256SUMS')).toBe(true);

    const installFixture = mkdtempSync(join(tmpdir(), 'woc-sfx-install-'));
    const runs: Promise<void>[] = [];
    try {
      const artifactRoot = join(installFixture, 'artifact');
      writeArtifact(artifactRoot, files);
      execFileSync('sh', ['-n', join(artifactRoot, 'install.sh')]);
      const installers = [
        { name: 'POSIX', command: 'sh', script: join(artifactRoot, 'install.sh') },
        { name: 'Node', command: process.execPath, script: join(artifactRoot, 'install.mjs') },
      ];
      for (const installer of installers) {
        const staticRoot = join(installFixture, `static-${installer.name.toLowerCase()}`);
        runs.push(
          runInstaller(installer.command, [installer.script, staticRoot]).then((result) => {
            expect(result.error, `${installer.name} installer failed to execute`).toBeUndefined();
            expect(result.status, `${installer.name} installer: ${result.stderr}`).toBe(0);
            expect(readFileSync(join(staticRoot, 'audio/sfx/runtime-pack.json'))).toEqual(
              files.get('activate/audio/sfx/runtime-pack.json'),
            );
            for (const clip of Object.values(runtime.clips) as {
              variants: { url: string; sha256: string }[];
            }[]) {
              for (const variant of clip.variants) {
                expect(hash(readFileSync(join(staticRoot, variant.url)))).toBe(variant.sha256);
              }
            }
          }),
        );
      }

      const corruptArtifactRoot = join(installFixture, 'artifact-corrupt');
      writeArtifact(corruptArtifactRoot, files);
      const blobIdentities = (files.get('install-blobs.txt')?.toString('utf8') ?? '')
        .trim()
        .split('\n');
      // Corrupt the FIRST identity in the sorted install-blobs list, not the last: the
      // installer's per-blob source checksum loop reads this file top to bottom and
      // exits on the first mismatch, so picking the first identity fails fast instead
      // of spawning sha256sum against every other real blob before finally failing.
      // Same corruption-detection code path either way, just a cheaper fixture pick.
      const corruptIdentity = blobIdentities[0];
      if (!corruptIdentity) throw new Error('export has no audio blobs to corrupt');
      const corruptBlob = join(
        corruptArtifactRoot,
        `payload/audio/sfx/blobs/${corruptIdentity}.mp3`,
      );
      const corruptBytes = Buffer.from(readFileSync(corruptBlob));
      corruptBytes[0] ^= 0xff;
      writeFileSync(corruptBlob, corruptBytes);

      for (const installer of [
        { name: 'POSIX', command: 'sh', script: join(corruptArtifactRoot, 'install.sh') },
        {
          name: 'Node',
          command: process.execPath,
          script: join(corruptArtifactRoot, 'install.mjs'),
        },
      ]) {
        const staticRoot = join(installFixture, `sentinel-${installer.name.toLowerCase()}`);
        mkdirSync(staticRoot);
        writeFileSync(join(staticRoot, 'sentinel.txt'), 'production stays untouched\n');
        const before = snapshotDirectory(staticRoot);
        runs.push(
          runInstaller(installer.command, [installer.script, staticRoot]).then((result) => {
            expect(result.error, `${installer.name} installer failed to execute`).toBeUndefined();
            expect(result.status, `${installer.name} installer accepted a corrupt blob`).not.toBe(
              0,
            );
            expect(result.stderr).toContain('artifact audio checksum failed');
            expect(snapshotDirectory(staticRoot)).toEqual(before);
          }),
        );
      }

      const lastRuntimeVariant = (
        Object.values(runtime.clips) as { variants: { sha256: string }[] }[]
      )
        .flatMap((clip) => clip.variants)
        .at(-1);
      if (!lastRuntimeVariant) throw new Error('runtime pack has no audio blobs');
      for (const installer of [
        { ...installers[0], corruptIdentity },
        { ...installers[1], corruptIdentity: lastRuntimeVariant.sha256 },
      ]) {
        const staticRoot = join(installFixture, `existing-corrupt-${installer.name.toLowerCase()}`);
        const corruptTarget = join(staticRoot, `audio/sfx/blobs/${installer.corruptIdentity}.mp3`);
        mkdirSync(dirname(corruptTarget), { recursive: true });
        writeFileSync(corruptTarget, 'corrupt production blob');
        writeFileSync(join(staticRoot, 'sentinel.txt'), 'production stays untouched\n');
        const before = snapshotDirectory(staticRoot);
        runs.push(
          runInstaller(installer.command, [installer.script, staticRoot]).then((result) => {
            expect(result.error, `${installer.name} installer failed to execute`).toBeUndefined();
            expect(result.status, `${installer.name} installer accepted a corrupt target`).not.toBe(
              0,
            );
            expect(result.stderr).toContain('existing audio blob checksum failed');
            expect(snapshotDirectory(staticRoot)).toEqual(before);
          }),
        );
      }

      const originalList = files.get('install-blobs.txt');
      if (!originalList) throw new Error('export has no install blob list');
      expect(originalList.length).toBeGreaterThan(0);
      expect(originalList.at(-1)).not.toBe(0x0a);
      const lastLineStart = originalList.lastIndexOf(0x0a);
      const listFailures = [
        {
          name: 'tampered',
          bytes: Buffer.concat([
            Buffer.from(originalList.subarray(0, originalList.length - 1)),
            Buffer.from(originalList.at(-1) === 0x61 ? 'b' : 'a'),
          ]),
        },
        {
          name: 'truncated',
          bytes: lastLineStart < 0 ? Buffer.alloc(0) : originalList.subarray(0, lastLineStart),
        },
        { name: 'empty', bytes: Buffer.alloc(0) },
      ];
      for (const failure of listFailures) {
        const artifact = join(installFixture, `artifact-list-${failure.name}`);
        writeArtifact(artifact, files);
        writeFileSync(join(artifact, 'install-blobs.txt'), failure.bytes);
        const staticRoot = join(installFixture, `list-${failure.name}-target`);
        mkdirSync(join(staticRoot, 'audio/sfx'), { recursive: true });
        writeFileSync(join(staticRoot, 'audio/sfx/runtime-pack.json'), 'old manifest\n');
        writeFileSync(join(staticRoot, 'sentinel.txt'), 'production stays untouched\n');
        const before = snapshotDirectory(staticRoot);
        runs.push(
          runInstaller('sh', [join(artifact, 'install.sh'), staticRoot]).then((result) => {
            expect(result.error, `${failure.name} list test failed to execute`).toBeUndefined();
            expect(result.status, `${failure.name} list was accepted`).not.toBe(0);
            expect(result.stderr).toContain('artifact audio list checksum failed');
            expect(snapshotDirectory(staticRoot)).toEqual(before);
          }),
        );
      }
      await settleAll(runs);
    } finally {
      // A failing setup step can throw while installers still write into the
      // fixture; let them finish before removing it.
      await Promise.allSettled(runs);
      rmSync(installFixture, { recursive: true, force: true });
    }
    // Two full bundle builds (the first ffprobe-validating every published track,
    // the second answered from the in-process verdict cache) plus the installer
    // spawns measured ~63s solo on an M-class laptop while both still ran
    // serially; under bounded-worker gate contention the old 90s budget flaked
    // while the SFX set itself was untouched. 180s keeps a genuine hang loud
    // without re-flaking on a busy runner.
  }, 180_000);

  it('exports numbered takes in exact round-robin order with runtime mix values', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'woc-sfx-export-round-robin-'));
    try {
      const audioDirectory = join(fixture, 'public/audio/sfx');
      const profileDirectory = join(fixture, 'scripts/sfx');
      mkdirSync(audioDirectory, { recursive: true });
      mkdirSync(profileDirectory, { recursive: true });
      for (const clip of Object.values(SFX_CLIPS)) {
        for (const variant of clip.variants) {
          const filename = variant.url.match(/^\/audio\/sfx\/([^?]+)\?v=/)?.[1];
          if (filename) {
            copyFileSync(join(ROOT, 'public/audio/sfx', filename), join(audioDirectory, filename));
          }
        }
      }
      for (const filename of ['sfx_gain_map.json', 'sfx_speed_map.json', 'sfx_mix.json']) {
        copyFileSync(join(ROOT, 'scripts/sfx', filename), join(profileDirectory, filename));
      }
      // foot_grass already has several real numbered takes now (no bare file
      // to synthesize a 2-take scenario from); the loop above already copied
      // every real variant, so this demonstrates round-robin ordering on
      // real, not synthetic, multi-take data.
      const bundle = await buildSfxProductionBundle(fixture);
      expect(
        bundle.runtimePack.clips.foot_grass.variants.map(({ id }: { id: string }) => id),
      ).toEqual(SFX_CLIPS.foot_grass.variants.map(({ id }) => id));
      expect(bundle.runtimePack.clips.foot_grass).toMatchObject({
        gain: SFX_CLIPS.foot_grass.gain,
        playbackRate: SFX_CLIPS.foot_grass.playbackRate,
      });
      // No synthetic extra file anymore (the fixture loop above copies every
      // real variant 1:1), so the count matches the real catalog exactly.
      expect(bundle.metadata.trackCount).toBe(
        Object.values(SFX_CLIPS).reduce((sum, clip) => sum + clip.variants.length, 0),
      );

      copyFileSync(
        join(audioDirectory, 'foot_grass_2.mp3'),
        join(audioDirectory, 'foot_grass_3.mp3'),
      );
      rmSync(join(audioDirectory, 'foot_grass_2.mp3'));
      await expect(buildSfxProductionBundle(fixture)).rejects.toThrow(
        'noncontiguous SFX variants for foot_grass',
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects unsafe and duplicate ZIP paths', () => {
    for (const name of ['/absolute', '../escape', 'a/../escape', 'a\\escape', 'a//b']) {
      expect(() => buildDeterministicZip([{ name, bytes: Buffer.from('x') }]), name).toThrow(
        `unsafe ZIP entry name: ${name}`,
      );
    }
    expect(() =>
      buildDeterministicZip([
        { name: 'same', bytes: Buffer.from('a') },
        { name: 'same', bytes: Buffer.from('b') },
      ]),
    ).toThrow('duplicate ZIP entry');
  });
});
