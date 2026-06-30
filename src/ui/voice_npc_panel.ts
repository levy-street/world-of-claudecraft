// Minimal "burn $WOC for a voice NPC" entry point (docs/prd/woc/voice-npc.md).
// EXPLICITLY WIP/DRAFT: this is a self-mounted floating panel, not a
// classic-fidelity HUD window (no PainterHost/write-elision/pure-view-core
// split). A polished HUD treatment is a tracked follow-up once the feature's
// product/legal sign-off lands; this only needs to prove the pipeline end to
// end. Mounted once after world entry (see main.ts), behind a small launcher
// button so it never gets in the way until a player opens it.
//
// Flow: record a short mic sample (MediaRecorder) -> explicit consent
// checkbox + display-name field -> upload to /api/voice-npc/sample -> price
// quote (/api/voice-npc/quote) -> TODO: client burn-tx signing is not wired
// in this draft (see signAndSendVoiceNpcBurn below) -> confirm
// (/api/voice-npc/confirm) -> poll /api/voice-npc/status until ready, then
// play the resulting clips via voice.playUrl.

import { voice } from '../game/voice';
import { esc } from './esc';
import { t } from './i18n';

export interface VoiceNpcApiDeps {
  token: string;
  base: string;
}

interface InfoResponse {
  enabled: boolean;
  priceWoc: number;
  mint: string;
  decimals: number;
}

interface StatusResponse {
  status: string;
  npcDisplayName: string;
  lines: Record<string, string>;
  error: string | null;
}

function apiUrl(deps: VoiceNpcApiDeps, path: string): string {
  return `${deps.base}${path}`;
}

async function getJson<T>(deps: VoiceNpcApiDeps, path: string): Promise<T> {
  const res = await fetch(apiUrl(deps, path), {
    headers: { Authorization: `Bearer ${deps.token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
  return data as T;
}

async function postJson<T>(deps: VoiceNpcApiDeps, path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(deps, path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
  return data as T;
}

async function uploadSample(
  deps: VoiceNpcApiDeps,
  blob: Blob,
  displayName: string,
  consent: boolean,
): Promise<void> {
  const params = new URLSearchParams({ displayName, consent: consent ? 'true' : 'false' });
  const res = await fetch(apiUrl(deps, `/api/voice-npc/sample?${params.toString()}`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.token}`,
      'Content-Type': blob.type || 'application/octet-stream',
    },
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
}

// TODO(wallet): this draft does not build/sign the on-chain $WOC burn
// transaction yet. This repo has no client-side Solana transaction builder
// (no @solana/web3.js dependency; src/net/wallet.ts only does Wallet Standard
// CONNECT + SIGN MESSAGE for the non-custodial wallet link, not transaction
// signing). Wiring this needs a deliberate dependency decision (add
// @solana/web3.js, or hand-build the burnChecked instruction bytes and use
// the Wallet Standard `solana:signAndSendTransaction` feature) plus a memo
// instruction carrying the quote id, mirroring server/woc_payment.ts's
// verification. Left as an explicit gap rather than a half-working signer.
async function signAndSendVoiceNpcBurn(_quote: {
  quoteId: string;
  memo: string;
  mint: string;
  decimals: number;
  amountBase: string;
  payer: string;
}): Promise<string> {
  throw new Error('burnNotWired');
}

interface PanelState {
  displayName: string;
  consent: boolean;
  recording: boolean;
  sampleBlob: Blob | null;
  busy: boolean;
  statusLine: string;
}

const MAX_RECORD_MS = 30_000;

export class VoiceNpcPanel {
  private root: HTMLElement | null = null;
  private launcher: HTMLElement | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private pollTimer: number | null = null;
  private state: PanelState = {
    displayName: '',
    consent: false,
    recording: false,
    sampleBlob: null,
    busy: false,
    statusLine: '',
  };

  constructor(private readonly deps: VoiceNpcApiDeps) {}

  /** Mount the floating launcher button. Safe to call once per world session. */
  mount(container: HTMLElement = document.body): void {
    if (this.launcher) return;
    const btn = document.createElement('button');
    btn.id = 'voice-npc-launcher';
    btn.type = 'button';
    btn.className = 'voice-npc-launcher';
    btn.textContent = t('hudChrome.voiceNpc.title');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.addEventListener('click', () => this.toggle());
    container.appendChild(btn);
    this.launcher = btn;
  }

  unmount(): void {
    this.stopPolling();
    this.launcher?.remove();
    this.root?.remove();
    this.launcher = null;
    this.root = null;
  }

  private toggle(): void {
    if (this.root) {
      this.close();
    } else {
      void this.open();
    }
  }

  private close(): void {
    this.root?.remove();
    this.root = null;
  }

  private async open(): Promise<void> {
    const panel = document.createElement('div');
    panel.id = 'voice-npc-panel';
    panel.className = 'voice-npc-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', t('hudChrome.voiceNpc.title'));
    document.body.appendChild(panel);
    this.root = panel;
    this.render();

    try {
      const info = await getJson<InfoResponse>(this.deps, '/api/voice-npc/info');
      if (!info.enabled) {
        this.state.statusLine = t('hudChrome.voiceNpc.disabled');
        this.render();
        return;
      }
      this.render(info);
    } catch {
      // Best-effort: the panel still renders the record/consent flow even if
      // the info read fails, so a transient network blip doesn't fully block it.
    }
  }

  private render(info?: InfoResponse): void {
    if (!this.root) return;
    const s = this.state;
    this.root.innerHTML = `
      <div class="voice-npc-panel-inner">
        <p class="voice-npc-wip">WIP draft, not a final HUD window.</p>
        <h2>${esc(t('hudChrome.voiceNpc.title'))}</h2>
        <p>${esc(t('hudChrome.voiceNpc.intro'))}</p>
        ${info ? `<p>${esc(t('hudChrome.voiceNpc.priceLabel', { price: info.priceWoc }))}</p>` : ''}
        <label>
          ${esc(t('hudChrome.voiceNpc.displayNameLabel'))}
          <input id="voice-npc-name" type="text" maxlength="32"
            placeholder="${esc(t('hudChrome.voiceNpc.displayNamePlaceholder'))}" value="${esc(s.displayName)}" />
        </label>
        <label class="voice-npc-consent">
          <input id="voice-npc-consent" type="checkbox" ${s.consent ? 'checked' : ''} />
          ${esc(t('hudChrome.voiceNpc.consentLabel'))}
        </label>
        <button id="voice-npc-record" type="button">
          ${esc(s.recording ? t('hudChrome.voiceNpc.recordStop') : t('hudChrome.voiceNpc.recordStart'))}
        </button>
        ${s.recording ? `<p>${esc(t('hudChrome.voiceNpc.recordingHint'))}</p>` : ''}
        <button id="voice-npc-burn" type="button" ${s.busy ? 'disabled' : ''}>
          ${esc(t('hudChrome.voiceNpc.recordStart'))}
        </button>
        ${s.statusLine ? `<p class="voice-npc-status">${esc(s.statusLine)}</p>` : ''}
      </div>
    `;
    this.wireControls();
  }

  private wireControls(): void {
    const root = this.root;
    if (!root) return;
    const nameInput = root.querySelector<HTMLInputElement>('#voice-npc-name');
    nameInput?.addEventListener('input', () => {
      this.state.displayName = nameInput.value;
    });
    const consentInput = root.querySelector<HTMLInputElement>('#voice-npc-consent');
    consentInput?.addEventListener('change', () => {
      this.state.consent = consentInput.checked;
    });
    root.querySelector<HTMLButtonElement>('#voice-npc-record')?.addEventListener('click', () => {
      void this.toggleRecording();
    });
    root.querySelector<HTMLButtonElement>('#voice-npc-burn')?.addEventListener('click', () => {
      void this.runBurnFlow();
    });
  }

  private async toggleRecording(): Promise<void> {
    if (this.state.recording) {
      this.mediaRecorder?.stop();
      return;
    }
    if (!this.state.consent) {
      this.state.statusLine = t('hudChrome.voiceNpc.needConsent');
      this.render();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordedChunks = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordedChunks.push(e.data);
      };
      recorder.onstop = () => {
        this.state.sampleBlob = new Blob(this.recordedChunks, {
          type: recorder.mimeType || 'audio/webm',
        });
        this.state.recording = false;
        for (const track of stream.getTracks()) track.stop();
        this.render();
      };
      this.mediaRecorder = recorder;
      recorder.start();
      this.state.recording = true;
      this.render();
      // Auto-stop after MAX_RECORD_MS so a forgotten recording doesn't run forever.
      setTimeout(() => {
        if (this.mediaRecorder === recorder && recorder.state === 'recording') recorder.stop();
      }, MAX_RECORD_MS);
    } catch {
      this.state.statusLine = t('hudChrome.voiceNpc.micError');
      this.render();
    }
  }

  private async runBurnFlow(): Promise<void> {
    const s = this.state;
    if (!s.consent) {
      s.statusLine = t('hudChrome.voiceNpc.needConsent');
      this.render();
      return;
    }
    if (!s.displayName.trim()) {
      s.statusLine = t('hudChrome.voiceNpc.needName');
      this.render();
      return;
    }
    if (!s.sampleBlob) {
      s.statusLine = t('hudChrome.voiceNpc.micError');
      this.render();
      return;
    }
    s.busy = true;
    this.render();
    try {
      await uploadSample(this.deps, s.sampleBlob, s.displayName.trim(), s.consent);
      const quote = await postJson<{
        quoteId: string;
        memo: string;
        mint: string;
        decimals: number;
        amountBase: string;
        payer: string | null;
      }>(this.deps, '/api/voice-npc/quote', {});
      if (!quote.payer) {
        s.statusLine = t('hudChrome.voiceNpc.needWallet');
        return;
      }
      let signature: string;
      try {
        signature = await signAndSendVoiceNpcBurn({
          quoteId: quote.quoteId,
          memo: quote.memo,
          mint: quote.mint,
          decimals: quote.decimals,
          amountBase: quote.amountBase,
          payer: quote.payer,
        });
      } catch {
        s.statusLine = t('hudChrome.voiceNpc.burnNotWired');
        return;
      }
      await postJson(this.deps, '/api/voice-npc/confirm', { quoteId: quote.quoteId, signature });
      this.startPolling();
    } catch {
      s.statusLine = t('hudChrome.voiceNpc.uploadError');
    } finally {
      s.busy = false;
      this.render();
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = window.setInterval(() => void this.pollStatus(), 4000);
    void this.pollStatus();
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollStatus(): Promise<void> {
    try {
      const status = await getJson<StatusResponse>(this.deps, '/api/voice-npc/status');
      this.state.statusLine = this.statusLineFor(status);
      this.render();
      if (status.status === 'ready') {
        this.stopPolling();
        const greeting = status.lines.greeting;
        if (greeting) voice.playUrl(greeting);
      } else if (status.status === 'failed') {
        this.stopPolling();
      }
    } catch {
      // transient: keep polling, do not surface a status flap to the player
    }
  }

  private statusLineFor(status: StatusResponse): string {
    switch (status.status) {
      case 'pending_sample':
        return t('hudChrome.voiceNpc.statusPendingSample');
      case 'pending_clone':
        return t('hudChrome.voiceNpc.statusPendingClone');
      case 'cloning':
        return t('hudChrome.voiceNpc.statusCloning');
      case 'generating':
        return t('hudChrome.voiceNpc.statusGenerating');
      case 'ready':
        return t('hudChrome.voiceNpc.statusReady');
      case 'failed':
        return t('hudChrome.voiceNpc.statusFailed', { error: status.error ?? '' });
      default:
        return '';
    }
  }
}
