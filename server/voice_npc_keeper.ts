// Async voice-clone + line-synthesis keeper for the "burn $WOC for a voice NPC"
// feature (docs/prd/woc/voice-npc.md). Mirrors the BurnKeeper split
// (wt-skins/server/burn_keeper.ts is the shape precedent): all orchestration
// (which grants to process, the state machine, crash recovery) lives in
// VoiceNpcKeeper over an injected VoiceCloneExecutor/VoiceCloneStore, fully
// unit-tested with fakes. buildProductionDeps() is the thin real-I/O wiring
// (the ONLY code here that touches the ElevenLabs API key) and a console-only
// fallback so local dev never needs a real key.
//
// Pipeline: pending_clone -> cloneVoice() -> generating -> synthesize() once
// per fixed line key -> ready. A failure at any step marks the grant 'failed'
// with the error captured; runCycle never throws (a bad clone/synthesis must
// not crash the server's poll loop).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  appendGeneratedLine,
  cloningGrants,
  markCloning,
  markFailed,
  markGenerating,
  markReady,
  pendingCloneGrants,
  pendingGenerateGrants,
  type VoiceNpcGrantRow,
} from './voice_npc_db';
import { VOICE_NPC_ENABLED } from './woc_config';

// The fixed set of lines every voice NPC speaks: a greeting plus the offer/
// complete text of the short one-step "Echo of You" quest (src/sim/content/voice_npc.ts).
// Keys mirror scripts/gen_npc_lines.mjs's lineKey convention so the audio
// pipeline stays familiar across the static and per-player voice systems.
export const VOICE_NPC_LINE_KEYS = ['greeting', 'quest_offer', 'quest_complete'] as const;
export type VoiceNpcLineKey = (typeof VOICE_NPC_LINE_KEYS)[number];

// TODO(product): placeholder lines for the draft pipeline. Final copy needs a
// pass once the NPC's zone/quest placement is signed off (see the PRD).
export const VOICE_NPC_LINE_TEXT: Record<VoiceNpcLineKey, string> = {
  greeting: 'A voice from beyond the bonfire... yes, I remember sounding like that, once.',
  quest_offer: 'Something of mine was lost nearby. Would you go and find it for me?',
  quest_complete: 'You found it. Thank you, truly, for hearing me out.',
};

const PUBLIC_AUDIO_ROOT = path.join(process.cwd(), 'public', 'audio', 'voice_npc');

export function clipPublicUrl(accountId: number, lineKey: string): string {
  return `/audio/voice_npc/${accountId}/${lineKey}.mp3`;
}

function clipDiskPath(accountId: number, lineKey: string): string {
  return path.join(PUBLIC_AUDIO_ROOT, String(accountId), `${lineKey}.mp3`);
}

// Signing/calling-out I/O the keeper drives. Split out so the orchestration is
// testable with a fake and the only key-holding code is the production wiring.
export interface VoiceCloneExecutor {
  /** Clone a voice from a sample recording; returns the ElevenLabs voice_id. */
  cloneVoice(name: string, sampleBuffer: Buffer, mimeType: string): Promise<string>;
  /** Synthesize one line of text in the cloned voice; returns raw mp3 bytes. */
  synthesize(voiceId: string, text: string): Promise<Buffer>;
}

// The mark* transitions return whether the row was actually updated: each is
// an atomic compare-and-set guarded on the row still being in the expected
// prior status (see voice_npc_db.ts). A `false` means the grant was reset out
// from under this cycle (e.g. a concurrent re-upload) or a duplicate keeper
// pass raced this one; the keeper treats that as "abandon this cycle for this
// account", never a throw.
export interface VoiceCloneStore {
  pendingClone(): Promise<VoiceNpcGrantRow[]>;
  pendingGenerate(): Promise<VoiceNpcGrantRow[]>;
  stuckCloning(): Promise<VoiceNpcGrantRow[]>;
  markCloning(accountId: number): Promise<boolean>;
  markGenerating(accountId: number, voiceId: string): Promise<boolean>;
  markReady(accountId: number, lines: Record<string, string>): Promise<boolean>;
  markFailed(accountId: number, reason: string): Promise<boolean>;
  /** Read the sample bytes + mime for a grant awaiting cloning. */
  readSample(grant: VoiceNpcGrantRow): Promise<{ buffer: Buffer; mimeType: string } | null>;
  /** Persist one synthesized clip; returns its public URL. */
  writeClip(accountId: number, lineKey: string, mp3: Buffer): Promise<string>;
  /** Persist one synthesized line's URL incrementally, merged into `lines`. */
  appendLine(accountId: number, lineKey: string, url: string): Promise<boolean>;
}

export class VoiceNpcKeeper {
  constructor(
    private readonly exec: VoiceCloneExecutor,
    private readonly store: VoiceCloneStore,
  ) {}

  /** One keeper tick: clone any pending_clone grants, then synthesize lines for any generating grants. */
  async runCycle(): Promise<void> {
    await this.recover();
    for (const grant of await this.store.pendingClone()) {
      await this.cloneOne(grant);
    }
    for (const grant of await this.store.pendingGenerate()) {
      await this.generateOne(grant);
    }
  }

  // A grant left in 'cloning' (the process died mid-clone) is not retryable in
  // place, the in-flight ElevenLabs call is lost. Mark it failed so the player
  // can re-record/re-confirm rather than wedging the keeper forever.
  async recover(): Promise<void> {
    for (const grant of await this.store.stuckCloning()) {
      await this.store.markFailed(
        grant.account_id,
        'interrupted during voice cloning, please try again',
      );
    }
  }

  private async cloneOne(grant: VoiceNpcGrantRow): Promise<void> {
    const claimed = await this.store.markCloning(grant.account_id);
    if (!claimed) {
      // Row is no longer 'pending_clone' (e.g. a re-upload reset it to
      // 'pending_sample' underneath us, or another cycle already claimed it).
      // Abandon this cycle for this account rather than clobbering fresh state.
      return;
    }
    try {
      const sample = await this.store.readSample(grant);
      if (!sample) {
        await this.store.markFailed(grant.account_id, 'voice sample missing on disk');
        return;
      }
      const name = grant.npc_display_name.trim() || `voice-npc-${grant.account_id}`;
      const voiceId = await this.exec.cloneVoice(name, sample.buffer, sample.mimeType);
      await this.store.markGenerating(grant.account_id, voiceId);
    } catch (err) {
      await this.store.markFailed(grant.account_id, errorMessage(err));
    }
  }

  // Crash recovery: a grant stuck in 'generating' after a restart is picked
  // up again by pendingGenerateGrants(). Lines already present in the grant's
  // `lines` JSONB (persisted incrementally, one write per successful line
  // rather than one batched write at the end) are skipped, so a resume only
  // synthesizes what's actually missing.
  private async generateOne(grant: VoiceNpcGrantRow): Promise<void> {
    if (!grant.eleven_voice_id) {
      await this.store.markFailed(grant.account_id, 'no cloned voice id to synthesize from');
      return;
    }
    try {
      const lines: Record<string, string> = { ...grant.lines };
      for (const key of VOICE_NPC_LINE_KEYS) {
        if (lines[key]) continue; // already synthesized in a prior (possibly crashed) cycle
        const text = VOICE_NPC_LINE_TEXT[key];
        const mp3 = await this.exec.synthesize(grant.eleven_voice_id, text);
        const url = await this.store.writeClip(grant.account_id, key, mp3);
        const persisted = await this.store.appendLine(grant.account_id, key, url);
        if (!persisted) {
          // Grant was reset out from under us mid-cycle (e.g. a re-upload);
          // abandon this cycle for this account rather than pressing on.
          return;
        }
        lines[key] = url;
      }
      await this.store.markReady(grant.account_id, lines);
    } catch (err) {
      await this.store.markFailed(grant.account_id, errorMessage(err));
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --------------------------------------------------------------------------
// Production wiring (real ElevenLabs HTTP calls). The ONLY code here that
// touches ELEVENLABS_API_KEY. Modeled on server/email/sender.ts's
// ConsoleSender/HttpSender split: without a key (or with the feature
// disabled), cloneVoice/synthesize log and return a harmless stub instead of
// calling out, so local dev never needs real credentials.
// --------------------------------------------------------------------------

const ELEVENLABS_API = 'https://api.elevenlabs.io';
const TTS_MODEL = 'eleven_multilingual_v2';

export function keeperConfigured(): boolean {
  return VOICE_NPC_ENABLED && (process.env.ELEVENLABS_API_KEY ?? '').trim().length > 0;
}

export function buildHttpExecutor(apiKey: string): VoiceCloneExecutor {
  return {
    async cloneVoice(name, sampleBuffer, mimeType) {
      const form = new FormData();
      form.set('name', name);
      // Copy into a plain ArrayBuffer-backed Uint8Array: Buffer's backing store
      // is typed as ArrayBufferLike (it can be a SharedArrayBuffer), which Blob's
      // BlobPart type rejects even though the bytes are fine at runtime.
      const bytes = Uint8Array.from(sampleBuffer);
      form.set('files', new Blob([bytes], { type: mimeType }), 'sample.webm');
      const res = await fetch(`${ELEVENLABS_API}/v1/voices/add`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`elevenlabs voice clone failed (${res.status}): ${detail.slice(0, 200)}`);
      }
      const data = (await res.json()) as { voice_id?: string };
      if (!data.voice_id) throw new Error('elevenlabs voice clone returned no voice_id');
      return data.voice_id;
    },

    async synthesize(voiceId, text) {
      const res = await fetch(`${ELEVENLABS_API}/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: TTS_MODEL }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`elevenlabs tts failed (${res.status}): ${detail.slice(0, 200)}`);
      }
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

// Dev / no-key stub: logs intent and returns a deterministic fake voice id /
// empty mp3 buffer so the pipeline still exercises end to end without billing
// a real ElevenLabs account.
function buildConsoleExecutor(): VoiceCloneExecutor {
  return {
    async cloneVoice(name) {
      console.log(
        `[voice_npc:console] would clone voice for "${name}" (no ELEVENLABS_API_KEY configured)`,
      );
      return `console-stub-${Date.now()}`;
    },
    async synthesize(voiceId, text) {
      console.log(
        `[voice_npc:console] would synthesize voice=${voiceId} text=${JSON.stringify(text)}`,
      );
      return Buffer.alloc(0);
    },
  };
}

function buildExecutor(): VoiceCloneExecutor {
  const apiKey = (process.env.ELEVENLABS_API_KEY ?? '').trim();
  if (VOICE_NPC_ENABLED && apiKey) return buildHttpExecutor(apiKey);
  return buildConsoleExecutor();
}

function buildStore(): VoiceCloneStore {
  return {
    pendingClone: pendingCloneGrants,
    pendingGenerate: pendingGenerateGrants,
    stuckCloning: cloningGrants,
    markCloning,
    markGenerating,
    markReady,
    markFailed,
    appendLine: appendGeneratedLine,
    async readSample(grant) {
      if (!grant.sample_path) return null;
      try {
        const { readFile } = await import('node:fs/promises');
        const buffer = await readFile(grant.sample_path);
        return { buffer, mimeType: 'audio/webm' };
      } catch {
        return null;
      }
    },
    async writeClip(accountId, lineKey, mp3) {
      const dest = clipDiskPath(accountId, lineKey);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, mp3);
      return clipPublicUrl(accountId, lineKey);
    },
  };
}

export function buildProductionDeps(): { exec: VoiceCloneExecutor; store: VoiceCloneStore } {
  return { exec: buildExecutor(), store: buildStore() };
}

/** Construct the production keeper. Runs in console-stub mode unless VOICE_NPC_ENABLED + a key are set. */
export function buildVoiceNpcKeeper(): VoiceNpcKeeper {
  const { exec, store } = buildProductionDeps();
  return new VoiceNpcKeeper(exec, store);
}
