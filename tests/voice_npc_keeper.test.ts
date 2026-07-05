// Exercises VoiceNpcKeeper.runCycle with a fake executor/store (no real
// ElevenLabs calls, no real DB): the pending_clone -> generating -> ready
// happy path, and a clone-failure path. Mirrors wt-skins/server/burn_keeper's
// test shape (inject fakes, drive the real orchestration class). Also
// exercises the REAL buildHttpExecutor (the actual ElevenLabs fetch() client)
// against a mocked global.fetch, since that code has no other coverage.
import { afterEach, describe, expect, it, vi } from 'vitest';

// voice_npc_keeper transitively imports server/db (which builds a pg Pool +
// requires DATABASE_URL at import). Stub both so the module loads; the tests
// drive the real VoiceNpcKeeper with INJECTED fakes and never touch the pool.
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return { query: vi.fn(), connect: vi.fn() };
  },
}));

import type { VoiceNpcGrantRow } from '../server/voice_npc_db';
import {
  buildHttpExecutor,
  VOICE_NPC_LINE_KEYS,
  VOICE_NPC_LINE_TEXT,
  type VoiceCloneExecutor,
  type VoiceCloneStore,
  VoiceNpcKeeper,
} from '../server/voice_npc_keeper';

function makeGrant(over: Partial<VoiceNpcGrantRow> & { account_id: number }): VoiceNpcGrantRow {
  return {
    id: over.account_id,
    status: 'pending_clone',
    npc_display_name: 'Echo',
    sample_path: `/tmp/sample-${over.account_id}.webm`,
    eleven_voice_id: null,
    lines: {},
    consent_at: new Date().toISOString(),
    applied_at: null,
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

function fakeStore() {
  const grants = new Map<number, VoiceNpcGrantRow>();
  const writtenClips: { accountId: number; lineKey: string; bytes: number }[] = [];
  const seed = (g: VoiceNpcGrantRow) => grants.set(g.account_id, g);

  const store: VoiceCloneStore & {
    grants: Map<number, VoiceNpcGrantRow>;
    writtenClips: typeof writtenClips;
  } = {
    grants,
    writtenClips,
    async pendingClone() {
      return [...grants.values()].filter((g) => g.status === 'pending_clone');
    },
    async pendingGenerate() {
      return [...grants.values()].filter((g) => g.status === 'generating');
    },
    async stuckCloning() {
      return [...grants.values()].filter((g) => g.status === 'cloning');
    },
    async markCloning(accountId) {
      const g = grants.get(accountId);
      if (!g || g.status !== 'pending_clone') return false;
      g.status = 'cloning';
      return true;
    },
    async markGenerating(accountId, voiceId) {
      const g = grants.get(accountId);
      if (!g || g.status !== 'cloning') return false;
      g.status = 'generating';
      g.eleven_voice_id = voiceId;
      return true;
    },
    async markReady(accountId, lines) {
      const g = grants.get(accountId);
      if (!g || g.status !== 'generating') return false;
      g.status = 'ready';
      g.lines = lines;
      g.error = null;
      return true;
    },
    async markFailed(accountId, reason) {
      const g = grants.get(accountId);
      if (!g || !['pending_clone', 'cloning', 'generating'].includes(g.status)) return false;
      g.status = 'failed';
      g.error = reason;
      return true;
    },
    async readSample(grant) {
      if (!grant.sample_path) return null;
      return { buffer: Buffer.from('fake-sample-bytes'), mimeType: 'audio/webm' };
    },
    async writeClip(accountId, lineKey, mp3) {
      writtenClips.push({ accountId, lineKey, bytes: mp3.length });
      return `/audio/voice_npc/${accountId}/${lineKey}.mp3`;
    },
    async appendLine(accountId, lineKey, url) {
      const g = grants.get(accountId);
      if (!g || g.status !== 'generating') return false;
      g.lines = { ...g.lines, [lineKey]: url };
      return true;
    },
  };
  return Object.assign(store, { seed });
}

function fakeExecutor(over: { cloneFails?: boolean; synthesizeFailsOn?: string } = {}) {
  const calls = { cloneVoice: [] as string[], synthesize: [] as string[] };
  const exec: VoiceCloneExecutor = {
    async cloneVoice(name) {
      calls.cloneVoice.push(name);
      if (over.cloneFails) throw new Error('elevenlabs voice clone failed (500): boom');
      return `voice-${name}`;
    },
    async synthesize(voiceId, text) {
      calls.synthesize.push(text);
      if (over.synthesizeFailsOn && text === over.synthesizeFailsOn) {
        throw new Error('elevenlabs tts failed (500): boom');
      }
      return Buffer.from(`mp3:${voiceId}:${text}`);
    },
  };
  return { exec, calls };
}

describe('VoiceNpcKeeper.runCycle', () => {
  it('walks pending_clone -> generating -> ready and writes every fixed line clip', async () => {
    const store = fakeStore();
    store.seed(makeGrant({ account_id: 1 }));
    const { exec, calls } = fakeExecutor();

    await new VoiceNpcKeeper(exec, store).runCycle();

    const grant = store.grants.get(1)!;
    expect(grant.status).toBe('ready');
    expect(grant.eleven_voice_id).toBe('voice-Echo');
    expect(calls.cloneVoice).toEqual(['Echo']);
    expect(calls.synthesize).toHaveLength(VOICE_NPC_LINE_KEYS.length);
    expect(Object.keys(grant.lines).sort()).toEqual([...VOICE_NPC_LINE_KEYS].sort());
    for (const key of VOICE_NPC_LINE_KEYS) {
      expect(grant.lines[key]).toBe(`/audio/voice_npc/1/${key}.mp3`);
    }
    expect(store.writtenClips).toHaveLength(VOICE_NPC_LINE_KEYS.length);
  });

  it('marks the grant failed with the captured error when cloning fails, and never throws', async () => {
    const store = fakeStore();
    store.seed(makeGrant({ account_id: 2 }));
    const { exec } = fakeExecutor({ cloneFails: true });

    await expect(new VoiceNpcKeeper(exec, store).runCycle()).resolves.toBeUndefined();

    const grant = store.grants.get(2)!;
    expect(grant.status).toBe('failed');
    expect(grant.error).toContain('elevenlabs voice clone failed');
  });

  it('marks the grant failed with the captured error when synthesis fails partway through', async () => {
    const store = fakeStore();
    // Already cloned; sitting in 'generating' waiting on line synthesis.
    store.seed(makeGrant({ account_id: 3, status: 'generating', eleven_voice_id: 'voice-3' }));
    const { exec } = fakeExecutor({
      synthesizeFailsOn:
        'A voice from beyond the bonfire... yes, I remember sounding like that, once.',
    });

    await new VoiceNpcKeeper(exec, store).runCycle();

    const grant = store.grants.get(3)!;
    expect(grant.status).toBe('failed');
    expect(grant.error).toContain('elevenlabs tts failed');
  });

  it('treats a grant stuck mid-clone after a crash as failed (recover), not retried in place', async () => {
    const store = fakeStore();
    store.seed(makeGrant({ account_id: 4, status: 'cloning' }));
    const { exec, calls } = fakeExecutor();

    await new VoiceNpcKeeper(exec, store).runCycle();

    const grant = store.grants.get(4)!;
    expect(grant.status).toBe('failed');
    expect(grant.error).toContain('interrupted');
    expect(calls.cloneVoice).toHaveLength(0);
  });

  it('does nothing when no grants are pending', async () => {
    const store = fakeStore();
    const { exec, calls } = fakeExecutor();
    await new VoiceNpcKeeper(exec, store).runCycle();
    expect(calls.cloneVoice).toHaveLength(0);
    expect(calls.synthesize).toHaveLength(0);
  });

  it('resumes a crash-interrupted generating grant, skipping lines already present', async () => {
    const store = fakeStore();
    store.seed(
      makeGrant({
        account_id: 5,
        status: 'generating',
        eleven_voice_id: 'voice-5',
        lines: {
          greeting: '/audio/voice_npc/5/greeting.mp3',
          quest_offer: '/audio/voice_npc/5/quest_offer.mp3',
        },
      }),
    );
    const { exec, calls } = fakeExecutor();

    await new VoiceNpcKeeper(exec, store).runCycle();

    const grant = store.grants.get(5)!;
    expect(grant.status).toBe('ready');
    // Only the missing line was synthesized; the two already-present lines were not redone.
    expect(calls.synthesize).toEqual([VOICE_NPC_LINE_TEXT.quest_complete]);
    expect(grant.lines.greeting).toBe('/audio/voice_npc/5/greeting.mp3');
    expect(grant.lines.quest_offer).toBe('/audio/voice_npc/5/quest_offer.mp3');
    expect(grant.lines.quest_complete).toBe('/audio/voice_npc/5/quest_complete.mp3');
  });

  it('re-upload race: a stale markGenerating write after a re-upload reset is a no-op, not a clobber', async () => {
    // Simulates: the keeper reads a 'cloning' grant, calls cloneVoice, and
    // while that's in flight the player re-uploads a sample. The DB-level
    // reset (recordConsentAndSample) would flip the row back to
    // 'pending_sample' underneath the keeper. Model that directly against the
    // fake store's markGenerating guard (mirrors the real atomic
    // UPDATE ... WHERE status = 'cloning' in voice_npc_db.ts): once the row's
    // status is no longer 'cloning', the stale write must affect nothing.
    const store = fakeStore();
    store.seed(makeGrant({ account_id: 6, status: 'cloning' }));

    // Re-upload lands first and resets the row (what recordConsentAndSample does).
    const g = store.grants.get(6)!;
    g.status = 'pending_sample';
    g.sample_path = '/tmp/new-sample-6.webm';
    g.eleven_voice_id = null;
    g.lines = {};
    g.error = null;

    // The keeper's stale write (from the cloneVoice call that started before
    // the reset) now lands: markGenerating only succeeds while status ===
    // 'cloning', so this must be a no-op.
    const updated = await store.markGenerating(6, 'voice-stale');

    expect(updated).toBe(false);
    const after = store.grants.get(6)!;
    expect(after.status).toBe('pending_sample');
    expect(after.eleven_voice_id).toBeNull();
    expect(after.sample_path).toBe('/tmp/new-sample-6.webm');
  });

  it('keeper cloneOne abandons the cycle without throwing when markCloning finds the row already moved on', async () => {
    const store = fakeStore();
    // Row is NOT 'pending_clone' (e.g. a re-upload already reset it), so the
    // keeper's own claim (markCloning requires status === 'pending_clone')
    // must fail atomically and cloneOne must abandon without calling cloneVoice.
    store.seed(makeGrant({ account_id: 7, status: 'pending_sample' }));
    const { exec, calls } = fakeExecutor();

    // Directly exercise pendingClone() filtering plus the keeper's guarded
    // claim: since the store only returns 'pending_clone' rows from
    // pendingClone(), simulate the race by seeding as pending_clone, then
    // flipping the row to pending_sample before the keeper's markCloning call
    // fires, mirroring the DB race window between SELECT and UPDATE.
    const grant = { ...store.grants.get(7)!, status: 'pending_clone' as const };
    store.grants.set(7, grant);
    const realMarkCloning = store.markCloning.bind(store);
    store.markCloning = async (accountId: number) => {
      // Re-upload wins the race right before the keeper's compare-and-set fires.
      store.grants.get(accountId)!.status = 'pending_sample';
      return realMarkCloning(accountId);
    };

    await expect(new VoiceNpcKeeper(exec, store).runCycle()).resolves.toBeUndefined();

    expect(calls.cloneVoice).toHaveLength(0);
    expect(store.grants.get(7)!.status).toBe('pending_sample');
  });
});

type FetchCall = [string, RequestInit & { headers: Record<string, string> }];

describe('buildHttpExecutor (real ElevenLabs HTTP client, mocked fetch)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('cloneVoice', () => {
    it('happy path: posts multipart form with xi-api-key and returns voice_id', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ voice_id: 'voice-abc-123' }),
        text: async () => '',
      }));
      vi.stubGlobal('fetch', fetchMock);

      const exec = buildHttpExecutor('test-api-key');
      const voiceId = await exec.cloneVoice('Echo', Buffer.from('sample-bytes'), 'audio/webm');

      expect(voiceId).toBe('voice-abc-123');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as FetchCall;
      expect(url).toBe('https://api.elevenlabs.io/v1/voices/add');
      expect(init.method).toBe('POST');
      expect(init.headers['xi-api-key']).toBe('test-api-key');
      expect(init.body).toBeInstanceOf(FormData);
      const form = init.body as FormData;
      expect(form.get('name')).toBe('Echo');
      const filePart = form.get('files') as unknown as Blob;
      expect(filePart).toBeInstanceOf(Blob);
      expect(filePart.type).toBe('audio/webm');
      expect(filePart.size).toBe(Buffer.from('sample-bytes').length);
    });

    it('non-2xx response throws with a useful error', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: false,
        status: 429,
        json: async () => ({}),
        text: async () => 'rate limited, slow down',
      }));
      vi.stubGlobal('fetch', fetchMock);

      const exec = buildHttpExecutor('test-api-key');
      await expect(exec.cloneVoice('Echo', Buffer.from('x'), 'audio/webm')).rejects.toThrow(
        /elevenlabs voice clone failed \(429\)/,
      );
    });

    it('malformed/missing voice_id in the response body throws rather than proceeding with undefined', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ some_other_field: 'oops' }),
        text: async () => '',
      }));
      vi.stubGlobal('fetch', fetchMock);

      const exec = buildHttpExecutor('test-api-key');
      await expect(exec.cloneVoice('Echo', Buffer.from('x'), 'audio/webm')).rejects.toThrow(
        /elevenlabs voice clone returned no voice_id/,
      );
    });
  });

  describe('synthesize', () => {
    it('happy path: posts JSON with xi-api-key and returns mp3 bytes', async () => {
      const mp3Bytes = new Uint8Array([1, 2, 3, 4, 5]);
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => mp3Bytes.buffer,
        text: async () => '',
      }));
      vi.stubGlobal('fetch', fetchMock);

      const exec = buildHttpExecutor('test-api-key');
      const mp3 = await exec.synthesize('voice-abc-123', 'hello there');

      expect(Buffer.compare(mp3, Buffer.from(mp3Bytes))).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as FetchCall;
      expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-abc-123');
      expect(init.method).toBe('POST');
      expect(init.headers['xi-api-key']).toBe('test-api-key');
      expect(init.headers['content-type']).toBe('application/json');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ text: 'hello there', model_id: 'eleven_multilingual_v2' });
    });

    it('non-2xx response throws/rejects, not a silent fallback', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: false,
        status: 500,
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => 'internal error',
      }));
      vi.stubGlobal('fetch', fetchMock);

      const exec = buildHttpExecutor('test-api-key');
      await expect(exec.synthesize('voice-abc-123', 'hello')).rejects.toThrow(
        /elevenlabs tts failed \(500\)/,
      );
    });
  });
});
