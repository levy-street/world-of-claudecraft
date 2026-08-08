// Unit tests for the pure NPC voice-line manifest builder (scripts/voices/voice_manifest.mjs):
// the `?v=<hash12>` cache-busting mechanism gen_npc_lines.mjs bakes into every
// clip URL, plus a regression pin that the REAL committed manifest's hashes
// still match the REAL committed clips on disk (the guard a swapped-in
// re-recording without a manifest regen would miss).

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildVoiceManifestEntries,
  voiceClipHash,
  voiceLineUrl,
} from '../scripts/voices/voice_manifest.mjs';
import { VOICE_LINES } from '../src/game/voice_manifest.generated';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('voiceClipHash', () => {
  it('is the first 12 hex chars of the sha256 of the bytes', () => {
    const bytes = Buffer.from('a fake mp3 payload');
    const full = createHash('sha256').update(bytes).digest('hex');
    expect(voiceClipHash(bytes)).toBe(full.slice(0, 12));
    expect(voiceClipHash(bytes)).toHaveLength(12);
  });

  it('changes whenever the bytes change (the whole point of a cache-buster)', () => {
    expect(voiceClipHash(Buffer.from('one'))).not.toBe(voiceClipHash(Buffer.from('two')));
  });
});

describe('voiceLineUrl', () => {
  it('builds the versioned public path', () => {
    expect(voiceLineUrl('brother_aldric', 'greeting__brother_aldric', 'abc123def456')).toBe(
      '/audio/voice/brother_aldric/greeting__brother_aldric.mp3?v=abc123def456',
    );
  });
});

describe('buildVoiceManifestEntries', () => {
  let voiceDir: string;

  beforeEach(() => {
    voiceDir = mkdtempSync(path.join(tmpdir(), 'woc_voice_manifest_test_'));
  });

  afterEach(() => {
    rmSync(voiceDir, { recursive: true, force: true });
  });

  function diskPathFor(line: { key: string; voiceNpc: string }): string {
    return path.join(voiceDir, line.voiceNpc, `${line.key}.mp3`);
  }

  function write(voiceNpc: string, key: string, contents: string): void {
    const dest = diskPathFor({ key, voiceNpc });
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, contents);
  }

  it('includes only lines whose clip already exists, versioned with the real content hash', () => {
    write('brother_aldric', 'greeting__brother_aldric', 'aldric audio bytes');
    write('captain_thessaly', 'greeting__captain_thessaly', 'thessaly audio bytes');

    const lines = [
      { key: 'greeting__brother_aldric', voiceNpc: 'brother_aldric' },
      { key: 'greeting__captain_thessaly', voiceNpc: 'captain_thessaly' },
      // No clip on disk for this one: a missing-voice or partial-run line.
      { key: 'greeting__unrendered_npc', voiceNpc: 'unrendered_npc' },
    ];

    const entries = buildVoiceManifestEntries(lines, diskPathFor);

    expect(Object.keys(entries).sort()).toEqual([
      'greeting__brother_aldric',
      'greeting__captain_thessaly',
    ]);
    const expectedAldricHash = createHash('sha256')
      .update('aldric audio bytes')
      .digest('hex')
      .slice(0, 12);
    expect(entries.greeting__brother_aldric).toBe(
      `/audio/voice/brother_aldric/greeting__brother_aldric.mp3?v=${expectedAldricHash}`,
    );
  });

  it('re-derives a different hash when the same key later points at different audio bytes', () => {
    const line = { key: 'greeting__recast_npc', voiceNpc: 'recast_npc' };

    write('recast_npc', 'greeting__recast_npc', 'take one');
    const first = buildVoiceManifestEntries([line], diskPathFor).greeting__recast_npc;

    write('recast_npc', 'greeting__recast_npc', 'take two, re-recorded');
    const second = buildVoiceManifestEntries([line], diskPathFor).greeting__recast_npc;

    expect(first).not.toBe(second);
  });
});

describe('the committed voice manifest', () => {
  it('every entry carries a content-hash query that matches the real clip on disk', () => {
    const entries = Object.entries(VOICE_LINES);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, url] of entries) {
      expect(url, key).toMatch(/^\/audio\/voice\/[a-z0-9_]+\/[a-z0-9_]+\.mp3\?v=[a-f0-9]{12}$/);
      const [bareUrl, requestedHash] = url.split('?v=');
      const filePath = path.join(repoRoot, 'public', ...bareUrl.split('/').filter(Boolean));
      const actualHash = createHash('sha256')
        .update(readFileSync(filePath))
        .digest('hex')
        .slice(0, 12);
      expect(requestedHash, `stale cache-bust hash for ${key}: ${url}`).toBe(actualHash);
    }
  });
});
