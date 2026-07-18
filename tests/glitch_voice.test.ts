// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { GlitchSession } from '../src/game/glitch';
import {
  bindGlitchVoiceChat,
  classifyGlitchVoiceError,
  decodeGlitchVoiceAudio,
  decodePcm16,
  encodeGlitchVoiceAudio,
  GLITCH_VOICE_FRAME_DURATION_MS,
  GLITCH_VOICE_FRAME_SAMPLES,
  GLITCH_VOICE_MAX_AUDIO_BYTES,
  GLITCH_VOICE_SAMPLE_RATE,
  glitchVoiceEnabled,
  glitchVoicePacketIsAudible,
  heartbeatGlitchVoice,
  joinGlitchVoice,
  leaveGlitchVoice,
  pollGlitchVoicePackets,
  resampleVoiceMono,
  sendGlitchVoicePacket,
} from '../src/game/glitch_voice';

const TITLE_ID = '8254e0f9-6c3a-4c94-8a16-570157b9df3b';
const INSTALL_ID = '33a533b2-2128-4604-9afc-886848a897b6';
const ROOM_ID = '44a533b2-2128-4604-9afc-886848a897b6';

function response(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(responses: Response[]) {
  const calls: { url: string; init: RequestInit | undefined; body: unknown }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url: String(input), init, body });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch call');
    return next;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function session(): GlitchSession {
  return {
    installId: INSTALL_ID,
    deviceId: 'device-1',
    userName: 'Glitch Player',
    licenseType: 'purchased',
    serverTime: '2026-07-14T18:00:00Z',
    launchedByGlitch: true,
    apiBaseUrl: 'https://api.glitch.fun/api',
    titleId: TITLE_ID,
    titleToken: 'title-token',
    gameVersion: '0.24.2',
  };
}

const room = {
  id: ROOM_ID,
  title_id: TITLE_ID,
  lobby_id: null,
  server_id: null,
  owner_player_id: INSTALL_ID,
  owner_user_id: null,
  provider: 'glitch_relay',
  topology: 'proximity',
  state: 'active',
  region: null,
  codec: 'pcm16',
  sample_rate: 16000,
  bitrate: 24000,
  frame_duration_ms: 60,
  channels: 1,
  max_participants: 16,
  participant_count: 1,
  recording_allowed: false,
  moderation_enabled: false,
  connection_config: {},
  metadata: {},
  last_activity_at: null,
  expires_at: null,
  created_at: null,
  updated_at: null,
};

const participant = {
  id: 'participant-1',
  voice_room_id: ROOM_ID,
  player_id: INSTALL_ID,
  user_id: null,
  display_name: 'Aster',
  status: 'joined',
  muted: false,
  deafened: false,
  speaking: false,
  last_sequence: 0,
  metadata: {},
  joined_at: null,
  last_heartbeat_at: null,
  left_at: null,
  expires_at: null,
  created_at: null,
  updated_at: null,
};

beforeAll(() => {
  if (!globalThis.btoa) {
    Object.defineProperty(globalThis, 'btoa', {
      value: (value: string) => Buffer.from(value, 'binary').toString('base64'),
    });
  }
  if (!globalThis.atob) {
    Object.defineProperty(globalThis, 'atob', {
      value: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    });
  }
});

describe('Glitch voice API', () => {
  it('is active only for a validated Glitch launch session', () => {
    expect(glitchVoiceEnabled(session())).toBe(true);
    expect(glitchVoiceEnabled({ ...session(), launchedByGlitch: false })).toBe(false);
    expect(glitchVoiceEnabled(null)).toBe(false);
  });

  it('lists and joins an existing proximity room using the title token', async () => {
    const { calls, fetchImpl } = mockFetch([
      response(200, { data: [room] }),
      response(200, { room, participant, voice_token: 'voice-token' }),
    ]);

    const joined = await joinGlitchVoice(session(), 'Aster', fetchImpl);

    expect(joined).toEqual({ room, participant, voiceToken: 'voice-token' });
    expect(calls.map((call) => call.url)).toEqual([
      `https://api.glitch.fun/api/titles/${TITLE_ID}/multiplayer/voice/rooms?topology=proximity&limit=50`,
      `https://api.glitch.fun/api/titles/${TITLE_ID}/multiplayer/voice/rooms/${ROOM_ID}/join`,
    ]);
    expect(calls[1].body).toEqual({
      player_id: INSTALL_ID,
      display_name: 'Aster',
      ttl_minutes: 30,
    });
    const joinHeaders = calls[1].init?.headers as Record<string, string> | undefined;
    expect(joinHeaders?.Authorization).toBe('Bearer title-token');
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[1].init?.method).toBe('POST');
    expect(joinHeaders?.['Content-Type']).toBe('application/json');
  });

  it('accepts the canonical voice_room field returned by the join endpoint', async () => {
    const { fetchImpl } = mockFetch([
      response(200, { data: [room] }),
      response(200, { voice_room: room, participant, voice_token: 'voice-token' }),
    ]);

    await expect(joinGlitchVoice(session(), 'Aster', fetchImpl)).resolves.toEqual({
      room,
      participant,
      voiceToken: 'voice-token',
    });
  });

  it('creates a room and then joins it before persisting the rotated participant token', async () => {
    const { calls, fetchImpl } = mockFetch([
      response(200, { data: [] }),
      response(201, { voice_room: room, participant, voice_token: 'owner-token' }),
      response(200, { room, participant, voice_token: 'rotated-token' }),
    ]);

    const joined = await joinGlitchVoice(session(), 'Aster', fetchImpl);

    expect(joined.voiceToken).toBe('rotated-token');
    expect(calls[1].url).toBe(
      `https://api.glitch.fun/api/titles/${TITLE_ID}/multiplayer/voice/rooms`,
    );
    expect(calls[1].body).toEqual({
      player_id: INSTALL_ID,
      provider: 'glitch_relay',
      topology: 'proximity',
      codec: 'pcm16',
      sample_rate: 16000,
      frame_duration_ms: 60,
      channels: 1,
      max_participants: 16,
      ttl_minutes: 30,
    });
    expect(calls[2].url).toBe(
      `https://api.glitch.fun/api/titles/${TITLE_ID}/multiplayer/voice/rooms/${ROOM_ID}/join`,
    );
  });

  it('recovers from a create conflict by relisting and joining the winning room', async () => {
    const { calls, fetchImpl } = mockFetch([
      response(200, { data: [] }),
      response(409, { message: 'voice room already exists' }),
      response(200, { data: [room] }),
      response(200, { room, participant, voice_token: 'voice-token' }),
    ]);

    const joined = await joinGlitchVoice(session(), 'Aster', fetchImpl);

    expect(joined.room.id).toBe(ROOM_ID);
    expect(calls).toHaveLength(4);
  });

  it('uses body-token participant routes without a title id or Authorization header', async () => {
    const { calls, fetchImpl } = mockFetch([
      response(200, { data: participant }),
      response(201, {
        data: {
          id: 'packet-1',
          voice_room_id: ROOM_ID,
          participant_id: participant.id,
          player_id: INSTALL_ID,
          packet_type: 'audio',
          payload: 'AAE=',
          sequence: 4,
          duration_ms: 60,
          sent_at: null,
          created_at: null,
          updated_at: null,
        },
      }),
      response(200, { data: [] }),
      response(200, { data: { ...participant, status: 'left' } }),
    ]);

    await heartbeatGlitchVoice(
      session(),
      'voice-token',
      {
        muted: false,
        deafened: false,
        speaking: true,
        lastSequence: 3,
      },
      fetchImpl,
    );
    await sendGlitchVoicePacket(session(), 'voice-token', 'AAE=', 60, fetchImpl);
    await pollGlitchVoicePackets(session(), 'voice-token', 3, fetchImpl);
    await leaveGlitchVoice(session(), 'voice-token', fetchImpl, true);

    expect(calls.map((call) => call.url)).toEqual([
      'https://api.glitch.fun/api/multiplayer/voice/heartbeat',
      'https://api.glitch.fun/api/multiplayer/voice/packets',
      'https://api.glitch.fun/api/multiplayer/voice/poll',
      'https://api.glitch.fun/api/multiplayer/voice/leave',
    ]);
    expect(calls[0].body).toEqual({
      voice_token: 'voice-token',
      muted: false,
      deafened: false,
      speaking: true,
      last_sequence: 3,
      ttl_minutes: 30,
    });
    expect(calls[1].body).toEqual({
      voice_token: 'voice-token',
      packet_type: 'audio',
      payload: 'AAE=',
      duration_ms: 60,
    });
    expect(calls[2].body).toEqual({
      voice_token: 'voice-token',
      after_sequence: 3,
      limit: 50,
      exclude_self: true,
    });
    expect(calls[3].body).toEqual({ voice_token: 'voice-token' });
    expect(calls[3].init?.keepalive).toBe(true);
    for (const call of calls) {
      expect(call.init?.method).toBe('POST');
      const headers = call.init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBeUndefined();
      expect(headers?.['Content-Type']).toBe('application/json');
    }
  });

  it('propagates documented HTTP failures and rejects malformed join responses', async () => {
    const failed = mockFetch([response(401, { message: 'expired' })]);
    await expect(joinGlitchVoice(session(), 'Aster', failed.fetchImpl)).rejects.toMatchObject({
      status: 401,
    });

    const malformed = mockFetch([
      response(200, { data: [room] }),
      response(200, { room, participant }),
    ]);
    await expect(joinGlitchVoice(session(), 'Aster', malformed.fetchImpl)).rejects.toMatchObject({
      status: 500,
    });
  });

  it.each([
    [401, 'auth'],
    [403, 'banned'],
    [409, 'retry'],
    [422, 'invalid'],
    [500, 'unavailable'],
  ] as const)('classifies HTTP %s for the documented recovery path', (status, expected) => {
    expect(classifyGlitchVoiceError({ status })).toBe(expected);
  });
});

describe('Glitch PCM16 frames', () => {
  it('round-trips the runtime 60 ms frame and stays below the literal 16 KB limit', () => {
    expect(GLITCH_VOICE_SAMPLE_RATE).toBe(16_000);
    expect(GLITCH_VOICE_FRAME_DURATION_MS).toBe(60);
    expect(GLITCH_VOICE_FRAME_SAMPLES).toBe(960);
    expect(GLITCH_VOICE_MAX_AUDIO_BYTES).toBe(16_384);
    const samples = new Float32Array(GLITCH_VOICE_FRAME_SAMPLES);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((i / 32) * Math.PI);

    const payload = encodeGlitchVoiceAudio(samples, { realm: 'Azeroth', x: 10, z: 20 });
    const envelope = decodeGlitchVoiceAudio(payload);
    const decoded = decodePcm16(envelope?.pcm16 ?? '');

    expect(Buffer.from(envelope?.pcm16 ?? '', 'base64').byteLength).toBe(1920);
    expect(new TextEncoder().encode(payload).byteLength).toBeLessThan(GLITCH_VOICE_MAX_AUDIO_BYTES);
    expect(decoded).toHaveLength(samples.length);
    expect(decoded[100]).toBeCloseTo(samples[100], 4);
  });

  it('resamples to the runtime rate and filters playback by realm and distance', () => {
    const source = new Float32Array(2_880).fill(0.25);
    expect(resampleVoiceMono(source, 48_000)).toHaveLength(GLITCH_VOICE_FRAME_SAMPLES);
    expect(
      glitchVoicePacketIsAudible(
        { realm: 'Azeroth', x: 10, z: 20 },
        { realm: 'Azeroth', x: 20, z: 20 },
      ),
    ).toBe(true);
    expect(
      glitchVoicePacketIsAudible(
        { realm: 'Azeroth', x: 10, z: 20 },
        { realm: 'Azeroth', x: 100, z: 20 },
      ),
    ).toBe(false);
    expect(
      glitchVoicePacketIsAudible(
        { realm: 'Azeroth', x: 10, z: 20 },
        { realm: 'Other', x: 10, z: 20 },
      ),
    ).toBe(false);
  });
});

describe('Glitch browser voice runtime', () => {
  it('reveals controls only for Glitch, creates audio on the click, and preserves real mobile state text', async () => {
    const button = document.createElement('button');
    button.hidden = true;
    button.innerHTML = '<span class="mobile-label"></span>';
    const audioContext = fakeAudioContext();
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(() => undefined));
    const control = bindGlitchVoiceChat({
      session: session(),
      displayName: 'Aster',
      buttons: [button],
      labels: labels(),
      getScope: () => ({ realm: 'Azeroth', x: 0, z: 0 }),
      fetchImpl: mockFetch([new Response(null, { status: 200 })]).fetchImpl,
      mediaDevices: { getUserMedia },
      createAudioContext: vi.fn(() => audioContext),
    });

    expect(button.hidden).toBe(false);
    expect(button.querySelector('.mobile-label')?.textContent).toBe('Voice Chat Off');
    button.click();
    expect(audioContext.resume).not.toHaveBeenCalled();
    expect(button.querySelector('.mobile-label')?.textContent).toBe('Connecting to Voice Chat');
    control.stop();
  });

  it('cancels a pending microphone start and stops a stream that resolves after cleanup', async () => {
    let resolveStream!: (stream: MediaStream) => void;
    const streamPromise = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    });
    const track = { stop: vi.fn(), enabled: true };
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
    const { fetchImpl } = mockFetch([
      response(200, { data: [room] }),
      response(200, { room, participant, voice_token: 'voice-token' }),
      response(200, { data: { ...participant, status: 'left' } }),
    ]);
    const button = document.createElement('button');
    const getUserMedia = vi.fn(() => streamPromise);
    const control = bindGlitchVoiceChat({
      session: session(),
      displayName: 'Aster',
      buttons: [button],
      labels: labels(),
      getScope: () => ({ realm: 'Azeroth', x: 0, z: 0 }),
      fetchImpl,
      mediaDevices: { getUserMedia },
      createAudioContext: () => fakeAudioContext(),
    });

    button.click();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    control.stop();
    resolveStream(stream);
    await vi.waitFor(() => expect(track.stop).toHaveBeenCalledOnce());
  });

  it('keeps at most the latest unsent frame while a packet upload is stalled', async () => {
    let resolveFirstPacket!: (value: Response) => void;
    const firstPacket = new Promise<Response>((resolve) => {
      resolveFirstPacket = resolve;
    });
    const packetPayloads: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/voice/rooms?')) return response(200, { data: [room] });
      if (url.endsWith(`/voice/rooms/${ROOM_ID}/join`)) {
        return response(200, { room, participant, voice_token: 'voice-token' });
      }
      if (url.endsWith('/voice/heartbeat')) return response(200, { data: participant });
      if (url.endsWith('/voice/packets')) {
        packetPayloads.push(JSON.parse(String(init?.body)).payload);
        if (packetPayloads.length === 1) return firstPacket;
        return response(201, { data: { sequence: packetPayloads.length } });
      }
      if (url.endsWith('/voice/leave')) {
        return response(200, { data: { ...participant, status: 'left' } });
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;
    const { context, processor } = fakeRunningAudioContext();
    const track = { stop: vi.fn(), enabled: true };
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
    const button = document.createElement('button');
    const control = bindGlitchVoiceChat({
      session: session(),
      displayName: 'Aster',
      buttons: [button],
      labels: labels(),
      getScope: () => ({ realm: 'Azeroth', x: packetPayloads.length, z: 0 }),
      fetchImpl,
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
      createAudioContext: () => context,
    });

    button.click();
    await vi.waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));
    const process = processor.onaudioprocess;
    const frame = new Float32Array(GLITCH_VOICE_FRAME_SAMPLES).fill(0.1);
    const event = {
      inputBuffer: { getChannelData: () => frame },
    } as unknown as AudioProcessingEvent;
    process?.call(processor, event);
    process?.call(processor, event);
    process?.call(processor, event);
    expect(packetPayloads).toHaveLength(1);
    resolveFirstPacket(response(201, { data: { sequence: 1 } }));
    await vi.waitFor(() => expect(packetPayloads).toHaveLength(2));
    expect(decodeGlitchVoiceAudio(packetPayloads[1])?.x).toBe(1);
    control.stop();
  });
});

function labels() {
  return {
    off: 'hudChrome.glitchVoice.off',
    connecting: 'hudChrome.glitchVoice.connecting',
    on: 'hudChrome.glitchVoice.on',
    muted: 'hudChrome.glitchVoice.muted',
    authError: 'hudChrome.glitchVoice.authError',
    bannedError: 'hudChrome.glitchVoice.bannedError',
    retryError: 'hudChrome.glitchVoice.retryError',
    invalidError: 'hudChrome.glitchVoice.invalidError',
    unavailableError: 'hudChrome.glitchVoice.unavailableError',
    permissionError: 'hudChrome.glitchVoice.permissionError',
  } as const;
}

function fakeAudioContext(): AudioContext {
  return {
    sampleRate: 48_000,
    currentTime: 0,
    destination: {},
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    createMediaStreamSource: vi.fn(),
    createScriptProcessor: vi.fn(),
    createGain: vi.fn(),
    createBuffer: vi.fn(),
    createBufferSource: vi.fn(),
  } as unknown as AudioContext;
}

function fakeRunningAudioContext(): {
  context: AudioContext;
  processor: ScriptProcessorNode;
} {
  const connectable = { connect: vi.fn(), disconnect: vi.fn() };
  const processor = {
    ...connectable,
    onaudioprocess: null,
  } as unknown as ScriptProcessorNode;
  return {
    processor,
    context: {
      sampleRate: GLITCH_VOICE_SAMPLE_RATE,
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      createMediaStreamSource: vi.fn(() => connectable),
      createScriptProcessor: vi.fn(() => processor),
      createGain: vi.fn(() => ({ ...connectable, gain: { value: 1 } })),
      createBuffer: vi.fn(),
      createBufferSource: vi.fn(),
    } as unknown as AudioContext,
  };
}
