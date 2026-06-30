// Exercises VoiceNpcKeeper.runCycle with a fake executor/store (no real
// ElevenLabs calls, no real DB): the pending_clone -> generating -> ready
// happy path, and a clone-failure path. Mirrors wt-skins/server/burn_keeper's
// test shape (inject fakes, drive the real orchestration class).
import { describe, expect, it, vi } from 'vitest';

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
  VOICE_NPC_LINE_KEYS,
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
      const g = grants.get(accountId)!;
      g.status = 'cloning';
    },
    async markGenerating(accountId, voiceId) {
      const g = grants.get(accountId)!;
      g.status = 'generating';
      g.eleven_voice_id = voiceId;
    },
    async markReady(accountId, lines) {
      const g = grants.get(accountId)!;
      g.status = 'ready';
      g.lines = lines;
      g.error = null;
    },
    async markFailed(accountId, reason) {
      const g = grants.get(accountId)!;
      g.status = 'failed';
      g.error = reason;
    },
    async readSample(grant) {
      if (!grant.sample_path) return null;
      return { buffer: Buffer.from('fake-sample-bytes'), mimeType: 'audio/webm' };
    },
    async writeClip(accountId, lineKey, mp3) {
      writtenClips.push({ accountId, lineKey, bytes: mp3.length });
      return `/audio/voice_npc/${accountId}/${lineKey}.mp3`;
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
});
