import { type TranslationKey, t } from '../ui/i18n';
import { GlitchApiError, type GlitchFetch, type GlitchSession } from './glitch';

const VOICE_TTL_MINUTES = 30;
export const GLITCH_VOICE_SAMPLE_RATE = 16_000;
export const GLITCH_VOICE_FRAME_DURATION_MS = 60;
export const GLITCH_VOICE_FRAME_SAMPLES =
  (GLITCH_VOICE_SAMPLE_RATE * GLITCH_VOICE_FRAME_DURATION_MS) / 1000;
export const GLITCH_VOICE_MAX_AUDIO_BYTES = 16 * 1024;
const VOICE_PROXIMITY_DISTANCE = 32;
const VOICE_POLL_MS = 120;
const VOICE_HEARTBEAT_MS = 60_000;
const VOICE_CREATE_RETRY_MS = 250;

export type GlitchVoiceErrorKind = 'auth' | 'banned' | 'retry' | 'invalid' | 'unavailable';

export interface GlitchVoiceRoom {
  id: string;
  title_id: string;
  lobby_id: string | null;
  server_id: string | null;
  owner_player_id: string;
  owner_user_id: string | null;
  provider: 'glitch_relay' | 'external';
  topology: 'lobby' | 'server' | 'party' | 'proximity';
  state: 'active' | 'closed';
  region: string | null;
  codec: 'opus' | 'pcm16' | 'aac';
  sample_rate: number;
  bitrate: number;
  frame_duration_ms: 10 | 20 | 40 | 60;
  channels: 1 | 2;
  max_participants: number;
  participant_count: number;
  recording_allowed: boolean;
  moderation_enabled: boolean;
  connection_config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  last_activity_at: string | null;
  expires_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface GlitchVoiceParticipant {
  id: string;
  voice_room_id: string;
  player_id: string;
  user_id: string | null;
  display_name: string | null;
  status: 'joined' | 'left' | 'muted' | 'kicked';
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  last_sequence: number;
  metadata: Record<string, unknown>;
  joined_at: string | null;
  last_heartbeat_at: string | null;
  left_at: string | null;
  expires_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface GlitchVoicePacket {
  id: string;
  voice_room_id: string;
  participant_id: string | null;
  player_id: string;
  packet_type: 'audio' | 'speaking' | 'mute_state' | 'offer' | 'answer' | 'ice' | 'control';
  payload: string;
  sequence: number;
  duration_ms: number | null;
  sent_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface GlitchVoiceMembership {
  room: GlitchVoiceRoom;
  participant: GlitchVoiceParticipant;
  voiceToken: string;
}

export interface GlitchVoiceHeartbeatState {
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  lastSequence: number;
}

export interface GlitchVoiceScope {
  realm: string;
  x: number;
  z: number;
}

interface GlitchVoiceAudioEnvelope extends GlitchVoiceScope {
  pcm16: string;
}

type Wait = (milliseconds: number) => Promise<void>;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function classifyGlitchVoiceError(error: { status?: number }): GlitchVoiceErrorKind {
  switch (error.status) {
    case 401:
      return 'auth';
    case 403:
      return 'banned';
    case 409:
      return 'retry';
    case 422:
      return 'invalid';
    default:
      return 'unavailable';
  }
}

export function glitchVoiceEnabled(session: GlitchSession | null): boolean {
  return session?.launchedByGlitch === true;
}

export async function joinGlitchVoice(
  session: GlitchSession,
  displayName: string,
  fetchImpl: GlitchFetch = fetch,
  waitImpl: Wait = wait,
): Promise<GlitchVoiceMembership> {
  let rooms = await listGlitchVoiceRooms(session, fetchImpl);
  let room = rooms.find((candidate) => candidate.state === 'active');
  if (!room) {
    try {
      room = await createGlitchVoiceRoom(session, fetchImpl);
    } catch (error) {
      if (!(error instanceof GlitchApiError) || classifyGlitchVoiceError(error) !== 'retry') {
        throw error;
      }
      await waitImpl(VOICE_CREATE_RETRY_MS);
      rooms = await listGlitchVoiceRooms(session, fetchImpl);
      room = rooms.find((candidate) => candidate.state === 'active');
      if (!room) throw error;
    }
  }

  const data = await titleRequest(
    session,
    `/titles/${session.titleId}/multiplayer/voice/rooms/${encodeURIComponent(room.id)}/join`,
    {
      method: 'POST',
      body: {
        player_id: session.installId,
        display_name: displayName,
        ttl_minutes: VOICE_TTL_MINUTES,
      },
    },
    fetchImpl,
  );
  const result = data as {
    voice_room?: GlitchVoiceRoom;
    room?: GlitchVoiceRoom;
    participant: GlitchVoiceParticipant;
    voice_token: string;
  };
  const joinedRoom = result.voice_room ?? result.room;
  if (!joinedRoom?.id || !result.participant?.id || !result.voice_token) {
    throw new GlitchApiError('Glitch voice join returned an invalid response.', 500, data);
  }
  return {
    room: joinedRoom,
    participant: result.participant,
    voiceToken: result.voice_token,
  };
}

export async function heartbeatGlitchVoice(
  session: GlitchSession,
  voiceToken: string,
  state: GlitchVoiceHeartbeatState,
  fetchImpl: GlitchFetch = fetch,
): Promise<GlitchVoiceParticipant> {
  const data = await participantRequest(
    session,
    '/multiplayer/voice/heartbeat',
    {
      voice_token: voiceToken,
      muted: state.muted,
      deafened: state.deafened,
      speaking: state.speaking,
      last_sequence: state.lastSequence,
      ttl_minutes: VOICE_TTL_MINUTES,
    },
    fetchImpl,
  );
  return (data as { data: GlitchVoiceParticipant }).data;
}

export async function sendGlitchVoicePacket(
  session: GlitchSession,
  voiceToken: string,
  payload: string,
  durationMs: number,
  fetchImpl: GlitchFetch = fetch,
): Promise<GlitchVoicePacket> {
  const data = await participantRequest(
    session,
    '/multiplayer/voice/packets',
    {
      voice_token: voiceToken,
      packet_type: 'audio',
      payload,
      duration_ms: durationMs,
    },
    fetchImpl,
  );
  return (data as { data: GlitchVoicePacket }).data;
}

export async function pollGlitchVoicePackets(
  session: GlitchSession,
  voiceToken: string,
  afterSequence: number,
  fetchImpl: GlitchFetch = fetch,
): Promise<GlitchVoicePacket[]> {
  const data = await participantRequest(
    session,
    '/multiplayer/voice/poll',
    {
      voice_token: voiceToken,
      after_sequence: afterSequence,
      limit: 50,
      exclude_self: true,
    },
    fetchImpl,
  );
  const packets = (data as { data?: unknown }).data;
  return Array.isArray(packets) ? (packets as GlitchVoicePacket[]) : [];
}

export async function leaveGlitchVoice(
  session: GlitchSession,
  voiceToken: string,
  fetchImpl: GlitchFetch = fetch,
  keepalive = false,
): Promise<GlitchVoiceParticipant> {
  const data = await participantRequest(
    session,
    '/multiplayer/voice/leave',
    { voice_token: voiceToken },
    fetchImpl,
    keepalive,
  );
  return (data as { data: GlitchVoiceParticipant }).data;
}

export function encodePcm16(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const sample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(i * 2, Math.round(sample), true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function encodeGlitchVoiceAudio(samples: Float32Array, scope: GlitchVoiceScope): string {
  return JSON.stringify({ ...scope, pcm16: encodePcm16(samples) });
}

export function decodeGlitchVoiceAudio(payload: string): GlitchVoiceAudioEnvelope | null {
  try {
    const value = JSON.parse(payload) as Partial<GlitchVoiceAudioEnvelope>;
    if (
      typeof value.realm !== 'string' ||
      typeof value.x !== 'number' ||
      typeof value.z !== 'number' ||
      typeof value.pcm16 !== 'string'
    ) {
      return null;
    }
    return value as GlitchVoiceAudioEnvelope;
  } catch {
    return null;
  }
}

export function glitchVoicePacketIsAudible(
  sender: GlitchVoiceScope,
  listener: GlitchVoiceScope,
): boolean {
  if (sender.realm !== listener.realm) return false;
  return Math.hypot(sender.x - listener.x, sender.z - listener.z) <= VOICE_PROXIMITY_DISTANCE;
}

export function decodePcm16(payload: string): Float32Array {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < samples.length; i++) {
    const sample = view.getInt16(i * 2, true);
    samples[i] = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
  }
  return samples;
}

export function resampleVoiceMono(
  samples: Float32Array,
  sourceRate: number,
  targetRate = GLITCH_VOICE_SAMPLE_RATE,
): Float32Array {
  if (sourceRate === targetRate) return samples.slice();
  if (samples.length === 0 || sourceRate <= 0 || targetRate <= 0) return new Float32Array();
  const outputLength = Math.max(1, Math.round((samples.length * targetRate) / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let i = 0; i < outputLength; i++) {
    const sourcePosition = i * ratio;
    const left = Math.floor(sourcePosition);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = sourcePosition - left;
    output[i] = samples[left] * (1 - fraction) + samples[right] * fraction;
  }
  return output;
}

async function listGlitchVoiceRooms(
  session: GlitchSession,
  fetchImpl: GlitchFetch,
): Promise<GlitchVoiceRoom[]> {
  const query = new URLSearchParams({ topology: 'proximity', limit: '50' });
  const data = await titleRequest(
    session,
    `/titles/${session.titleId}/multiplayer/voice/rooms?${query.toString()}`,
    { method: 'GET' },
    fetchImpl,
  );
  const rooms = (data as { data?: unknown }).data;
  return Array.isArray(rooms) ? (rooms as GlitchVoiceRoom[]) : [];
}

async function createGlitchVoiceRoom(
  session: GlitchSession,
  fetchImpl: GlitchFetch,
): Promise<GlitchVoiceRoom> {
  const data = await titleRequest(
    session,
    `/titles/${session.titleId}/multiplayer/voice/rooms`,
    {
      method: 'POST',
      body: {
        player_id: session.installId,
        provider: 'glitch_relay',
        topology: 'proximity',
        codec: 'pcm16',
        sample_rate: GLITCH_VOICE_SAMPLE_RATE,
        frame_duration_ms: GLITCH_VOICE_FRAME_DURATION_MS,
        channels: 1,
        max_participants: 16,
        ttl_minutes: VOICE_TTL_MINUTES,
      },
    },
    fetchImpl,
  );
  const room = (data as { voice_room?: GlitchVoiceRoom }).voice_room;
  if (!room?.id) throw new GlitchApiError('Glitch voice create returned no room.', 500, data);
  return room;
}

async function titleRequest(
  session: GlitchSession,
  path: string,
  opts: { method: 'GET' | 'POST'; body?: unknown },
  fetchImpl: GlitchFetch,
): Promise<unknown> {
  return voiceRequest(session, path, opts, fetchImpl, true);
}

async function participantRequest(
  session: GlitchSession,
  path: string,
  body: unknown,
  fetchImpl: GlitchFetch,
  keepalive = false,
): Promise<unknown> {
  return voiceRequest(session, path, { method: 'POST', body }, fetchImpl, false, keepalive);
}

async function voiceRequest(
  session: GlitchSession,
  path: string,
  opts: { method: 'GET' | 'POST'; body?: unknown },
  fetchImpl: GlitchFetch,
  authorized: boolean,
  keepalive = false,
): Promise<unknown> {
  const response = await fetchImpl(`${session.apiBaseUrl}${path}`, {
    method: opts.method,
    headers: {
      ...(authorized ? { Authorization: `Bearer ${session.titleToken}` } : {}),
      ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    keepalive,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new GlitchApiError(
      `Glitch voice request failed (${response.status})`,
      response.status,
      data,
    );
  }
  return data;
}

export interface GlitchVoiceLabels {
  off: TranslationKey;
  connecting: TranslationKey;
  on: TranslationKey;
  muted: TranslationKey;
  authError: TranslationKey;
  bannedError: TranslationKey;
  retryError: TranslationKey;
  invalidError: TranslationKey;
  unavailableError: TranslationKey;
  permissionError: TranslationKey;
}

export interface GlitchVoiceControl {
  leave(keepalive?: boolean): void;
  stop(): void;
}

export function bindGlitchVoiceChat(opts: {
  session: GlitchSession;
  displayName: string;
  buttons: readonly HTMLButtonElement[];
  labels: GlitchVoiceLabels;
  getScope: () => GlitchVoiceScope;
  fetchImpl?: GlitchFetch;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
  createAudioContext?: () => AudioContext;
}): GlitchVoiceControl {
  if (!glitchVoiceEnabled(opts.session)) {
    return { leave: () => undefined, stop: () => undefined };
  }
  const runtime = new BrowserGlitchVoice(opts);
  for (const button of opts.buttons) {
    button.hidden = false;
    button.addEventListener('click', runtime.toggle);
  }
  runtime.paint('off');
  return {
    leave: (keepalive = false) => {
      void runtime.leave(keepalive);
    },
    stop: () => {
      for (const button of opts.buttons) button.removeEventListener('click', runtime.toggle);
      void runtime.destroy();
    },
  };
}

type VoiceUiState = 'off' | 'connecting' | 'on' | 'muted' | GlitchVoiceErrorKind | 'permission';

class BrowserGlitchVoice {
  private readonly fetchImpl: GlitchFetch;
  private readonly mediaDevices: Pick<MediaDevices, 'getUserMedia'> | null;
  private readonly createAudioContext: (() => AudioContext) | null;
  private membership: GlitchVoiceMembership | null = null;
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silentGain: GainNode | null = null;
  private heartbeatTimer: number | null = null;
  private pollTimer: number | null = null;
  private muted = false;
  private speaking = false;
  private lastSequence = 0;
  private captureBuffer = new Float32Array();
  private pendingFrame: { payload: string; voiceToken: string } | null = null;
  private sending = false;
  private polling = false;
  private nextPlaybackAt = 0;
  private starting = false;
  private destroyed = false;
  private lifecycle = 0;

  constructor(
    private readonly opts: {
      session: GlitchSession;
      displayName: string;
      buttons: readonly HTMLButtonElement[];
      labels: GlitchVoiceLabels;
      getScope: () => GlitchVoiceScope;
      fetchImpl?: GlitchFetch;
      mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
      createAudioContext?: () => AudioContext;
    },
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.mediaDevices = opts.mediaDevices ?? navigator.mediaDevices ?? null;
    this.createAudioContext =
      opts.createAudioContext ??
      (() => {
        const AudioContextCtor = window.AudioContext;
        return new AudioContextCtor();
      });
  }

  readonly toggle = (): void => {
    if (this.destroyed) return;
    if (!this.membership) {
      if (!this.starting) this.beginStart();
      return;
    }
    this.muted = !this.muted;
    if (this.muted) this.pendingFrame = null;
    if (this.stream) {
      for (const track of this.stream.getAudioTracks()) track.enabled = !this.muted;
    }
    this.paint(this.muted ? 'muted' : 'on');
    void this.heartbeat();
  };

  paint(state: VoiceUiState): void {
    const key = this.keyFor(state);
    const label = t(key);
    for (const button of this.opts.buttons) {
      button.disabled = state === 'connecting';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.dataset.i18nTitle = key;
      button.dataset.i18nAria = key;
      button.setAttribute('aria-pressed', String(state === 'on'));
      button.classList.toggle('active', state === 'on');
      button.classList.toggle('is-on', state === 'on');
      button.classList.toggle('mm-muted', state === 'muted');
      const mobileLabel = button.querySelector<HTMLElement>('.mobile-label');
      if (mobileLabel) {
        mobileLabel.dataset.i18n = key;
        mobileLabel.textContent = label;
      }
    }
  }

  async leave(keepalive = false): Promise<void> {
    this.lifecycle += 1;
    this.starting = false;
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    this.heartbeatTimer = null;
    this.pollTimer = null;
    if (this.processor) this.processor.disconnect();
    if (this.source) this.source.disconnect();
    if (this.silentGain) this.silentGain.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.processor = null;
    this.source = null;
    this.silentGain = null;
    this.stream = null;
    this.captureBuffer = new Float32Array();
    this.pendingFrame = null;
    const membership = this.membership;
    this.membership = null;
    if (membership) {
      await participantRequest(
        this.opts.session,
        '/multiplayer/voice/leave',
        { voice_token: membership.voiceToken },
        this.fetchImpl,
        keepalive,
      ).catch(() => undefined);
    }
    await this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.paint('off');
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.leave(true);
  }

  private beginStart(): void {
    try {
      if (!this.createAudioContext) throw new Error('audio unavailable');
      const audioContext = this.createAudioContext();
      void this.start(audioContext);
    } catch (error) {
      this.paint(classifyGlitchVoiceError(error as { status?: number }));
    }
  }

  private async start(audioContext: AudioContext): Promise<void> {
    const lifecycle = ++this.lifecycle;
    this.starting = true;
    this.audioContext = audioContext;
    this.paint('connecting');
    try {
      const membership = await joinGlitchVoice(
        this.opts.session,
        this.opts.displayName,
        this.fetchImpl,
      );
      if (!this.isCurrent(lifecycle)) {
        await leaveGlitchVoice(
          this.opts.session,
          membership.voiceToken,
          this.fetchImpl,
          true,
        ).catch(() => undefined);
        return;
      }
      this.membership = membership;
      if (!this.mediaDevices) throw new Error('microphone unavailable');
      const stream = await this.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!this.isCurrent(lifecycle)) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.stream = stream;
      await audioContext.resume();
      if (!this.isCurrent(lifecycle)) return;
      this.source = audioContext.createMediaStreamSource(stream);
      this.processor = audioContext.createScriptProcessor(4096, 1, 1);
      this.silentGain = audioContext.createGain();
      this.silentGain.gain.value = 0;
      this.processor.onaudioprocess = (event) => this.capture(event.inputBuffer.getChannelData(0));
      this.source.connect(this.processor);
      this.processor.connect(this.silentGain);
      this.silentGain.connect(audioContext.destination);
      await this.heartbeat();
      this.heartbeatTimer = window.setInterval(() => void this.heartbeat(), VOICE_HEARTBEAT_MS);
      this.pollTimer = window.setInterval(() => void this.poll(), VOICE_POLL_MS);
      this.paint('on');
    } catch (error) {
      const joined = this.membership !== null;
      if (!this.isCurrent(lifecycle)) return;
      await this.leave();
      if (joined && error instanceof DOMException && error.name === 'NotAllowedError') {
        this.paint('permission');
      } else {
        this.paint(classifyGlitchVoiceError(error as { status?: number }));
      }
    } finally {
      if (this.lifecycle === lifecycle) this.starting = false;
    }
  }

  private capture(input: Float32Array): void {
    if (this.muted || !this.membership || !this.audioContext) return;
    const samples = resampleVoiceMono(input, this.audioContext.sampleRate);
    const combined = new Float32Array(this.captureBuffer.length + samples.length);
    combined.set(this.captureBuffer);
    combined.set(samples, this.captureBuffer.length);
    this.captureBuffer = combined;
    while (this.captureBuffer.length >= GLITCH_VOICE_FRAME_SAMPLES) {
      const frame = this.captureBuffer.slice(0, GLITCH_VOICE_FRAME_SAMPLES);
      this.captureBuffer = this.captureBuffer.slice(GLITCH_VOICE_FRAME_SAMPLES);
      let energy = 0;
      for (const sample of frame) energy += sample * sample;
      this.speaking = Math.sqrt(energy / frame.length) >= 0.015;
      const payload = encodeGlitchVoiceAudio(frame, this.opts.getScope());
      if (new TextEncoder().encode(payload).byteLength > GLITCH_VOICE_MAX_AUDIO_BYTES) continue;
      const voiceToken = this.membership.voiceToken;
      this.pendingFrame = { payload, voiceToken };
      void this.flushSend();
    }
  }

  private async heartbeat(): Promise<void> {
    if (!this.membership) return;
    try {
      await heartbeatGlitchVoice(
        this.opts.session,
        this.membership.voiceToken,
        {
          muted: this.muted,
          deafened: false,
          speaking: this.speaking,
          lastSequence: this.lastSequence,
        },
        this.fetchImpl,
      );
    } catch (error) {
      this.handleRuntimeError(error);
    }
  }

  private async poll(): Promise<void> {
    if (!this.membership || this.polling) return;
    this.polling = true;
    try {
      const packets = await pollGlitchVoicePackets(
        this.opts.session,
        this.membership.voiceToken,
        this.lastSequence,
        this.fetchImpl,
      );
      for (const packet of packets) {
        this.lastSequence = Math.max(this.lastSequence, packet.sequence);
        if (packet.packet_type === 'audio') this.play(packet.payload);
      }
    } catch (error) {
      this.handleRuntimeError(error);
    } finally {
      this.polling = false;
    }
  }

  private play(payload: string): void {
    if (!this.audioContext) return;
    const envelope = decodeGlitchVoiceAudio(payload);
    if (!envelope || !glitchVoicePacketIsAudible(envelope, this.opts.getScope())) return;
    const samples = decodePcm16(envelope.pcm16);
    if (samples.length === 0) return;
    const buffer = this.audioContext.createBuffer(1, samples.length, GLITCH_VOICE_SAMPLE_RATE);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);
    const now = this.audioContext.currentTime;
    this.nextPlaybackAt = Math.max(now, this.nextPlaybackAt);
    source.start(this.nextPlaybackAt);
    this.nextPlaybackAt += buffer.duration;
  }

  private handleRuntimeError(error: unknown): void {
    const kind = classifyGlitchVoiceError(error as { status?: number });
    if (kind === 'retry' || kind === 'unavailable') return;
    void this.leave().then(() => this.paint(kind));
  }

  private async flushSend(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.pendingFrame && !this.muted) {
        const frame = this.pendingFrame;
        this.pendingFrame = null;
        if (this.membership?.voiceToken !== frame.voiceToken) continue;
        try {
          await sendGlitchVoicePacket(
            this.opts.session,
            frame.voiceToken,
            frame.payload,
            GLITCH_VOICE_FRAME_DURATION_MS,
            this.fetchImpl,
          );
        } catch (error) {
          this.handleRuntimeError(error);
        }
      }
    } finally {
      this.sending = false;
    }
  }

  private isCurrent(lifecycle: number): boolean {
    return !this.destroyed && this.lifecycle === lifecycle;
  }

  private keyFor(state: VoiceUiState): TranslationKey {
    switch (state) {
      case 'off':
        return this.opts.labels.off;
      case 'connecting':
        return this.opts.labels.connecting;
      case 'on':
        return this.opts.labels.on;
      case 'muted':
        return this.opts.labels.muted;
      case 'auth':
        return this.opts.labels.authError;
      case 'banned':
        return this.opts.labels.bannedError;
      case 'retry':
        return this.opts.labels.retryError;
      case 'invalid':
        return this.opts.labels.invalidError;
      case 'permission':
        return this.opts.labels.permissionError;
      case 'unavailable':
        return this.opts.labels.unavailableError;
    }
  }
}
