import { describe, expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import {
  AbilityVfx,
  type AbilityVfxDeps,
  type AbilityVfxSpellfxAtEvent,
} from '../src/render/ability_vfx/painter';
import { ShamanFields } from '../src/render/ability_vfx/shaman_fields';

const faultwake: AbilityVfxSpellfxAtEvent = {
  ability: 'earthquake',
  fx: 'nova',
  school: 'physical',
  sourceId: 3,
  x: 17,
  z: -23,
  radius: 9.5,
  duration: 6,
};

function fixture(admitted = true, reducedMotion = false) {
  let time = 10;
  const fields = new ShamanFields();
  const decal = vi.fn();
  // Keep this fixture CPU-only: use the actual engine's field entry point with
  // its real persistent owner, without constructing unrelated GPU producers.
  const fieldEngine = {
    disposed: false,
    reducedMotionActive: reducedMotion,
    shamanFields: fields,
    decals: { spawn: decal },
    groundY: () => 0,
    presentationClock: () => time,
    time: 0,
  } as unknown as AbilityVfxFx;
  const shamanField = vi.fn((ev: AbilityVfxSpellfxAtEvent) =>
    AbilityVfxFx.prototype.shamanField.call(fieldEngine, ev),
  );
  const sequenceInstantAt = vi.fn();
  const spawnAoeRing = vi.fn();
  const ventSheet = vi.fn();
  const painter = new AbilityVfx(
    {
      fx: {
        setDelegates: vi.fn(),
        groundYAt: () => 0,
        shamanField,
        sequenceInstantAt,
        flipbookAt: ventSheet,
        pathRibbon: vi.fn(),
        burstAt: vi.fn(),
        shakeAt: vi.fn(),
        abilityAudio: vi.fn(),
      },
      vfx: {},
      anchor: () => ({ x: 0, y: 1, z: 0 }),
      spawnAoeRing,
      triggerAttack: vi.fn(),
      localPlayerId: () => 3,
      castVfxAdmit: () => admitted,
    } as unknown as AbilityVfxDeps,
    () => time,
  );
  const appendHeld = vi.fn();
  const push = vi.fn();
  function drawAt(nextTime: number) {
    time = nextTime;
    appendHeld.mockClear();
    push.mockClear();
    fields.draw(
      1,
      time,
      false,
      1,
      { anchorOf: () => null, groundYAt: () => 0 },
      { appendHeld },
      { push },
    );
  }
  return {
    painter,
    fields,
    shamanField,
    sequenceInstantAt,
    spawnAoeRing,
    appendHeld,
    drawAt,
    decal,
    ventSheet,
  };
}

describe('Shaman point-field presentation ownership', () => {
  it('uses a brief fractured Gripping Earth footprint at the producer radius, never a guessed root timer', () => {
    const h = fixture();
    const grip = { ...faultwake, ability: 'earthbind', radius: 4.25, duration: undefined };
    expect(h.painter.handleSpellfxAt(grip)).toBe(true);
    expect(h.shamanField.mock.results[0].value).toBe(true);
    expect(h.spawnAoeRing).not.toHaveBeenCalled();
    expect(h.decal).toHaveBeenCalledExactlyOnceWith(
      17,
      0,
      -23,
      4.25 * 0.96,
      expect.any(Number),
      'shaman_fracture',
      0.7,
      0,
    );
    h.drawAt(10);
    expect(h.appendHeld).toHaveBeenCalled();
    h.drawAt(10.69);
    expect(h.appendHeld).toHaveBeenCalled();
    expect(h.painter.handleSpellfxAt({ ...grip, fx: 'tick' })).toBe(true);
    expect(h.shamanField.mock.results[1].value).toBe(false);
    h.drawAt(10.7);
    expect(h.appendHeld).not.toHaveBeenCalled();
    expect(h.decal).toHaveBeenCalledTimes(1);
  });

  it('retains the real Gripping Earth radius cue if the shared footprint pool is full', () => {
    const h = fixture();
    for (let i = 0; i < 8; i++) h.painter.handleSpellfxAt({ ...faultwake, x: i * 30 });
    const grip = { ...faultwake, ability: 'earthbind', radius: 4.25, duration: undefined };
    expect(h.painter.handleSpellfxAt(grip)).toBe(true);
    expect(h.shamanField.mock.results[8].value).toBe(false);
    expect(h.spawnAoeRing).toHaveBeenCalledExactlyOnceWith(
      17,
      -23,
      4.25,
      'physical',
      expect.any(Number),
    );
  });

  it('gives accepted Faultwake its persistent boundary for the producer lifetime without a second ring', () => {
    const h = fixture();
    expect(h.painter.handleSpellfxAt(faultwake)).toBe(true);
    expect(h.shamanField).toHaveBeenCalledExactlyOnceWith(faultwake);
    expect(h.shamanField.mock.results[0].value).toBe(true);
    expect(h.decal).toHaveBeenCalledExactlyOnceWith(
      17,
      0,
      -23,
      9.5 * 0.96,
      expect.any(Number),
      'shaman_fracture',
      6,
      0.65,
    );
    expect(h.spawnAoeRing).not.toHaveBeenCalled();
    expect(h.sequenceInstantAt).toHaveBeenCalledExactlyOnceWith(
      'earthquake',
      expect.objectContaining({ shaman: expect.objectContaining({ action: 'field' }) }),
      3,
      17,
      -23,
      expect.any(Number),
      0,
      0,
      false,
    );
    h.drawAt(10);
    expect(h.appendHeld).toHaveBeenCalled();
    h.drawAt(15.99);
    expect(h.appendHeld).toHaveBeenCalled();
    h.drawAt(16);
    expect(h.appendHeld).not.toHaveBeenCalled();
  });

  it('keeps the full fracture static under reduced motion without altering lifetime', () => {
    const h = fixture(true, true);
    h.painter.handleSpellfxAt(faultwake);
    expect(h.decal.mock.calls[0].slice(-2)).toEqual([6, 0]);
    h.drawAt(10);
    expect(h.appendHeld).toHaveBeenCalled();
    h.drawAt(16);
    expect(h.appendHeld).not.toHaveBeenCalled();
  });

  it('adds one storm payoff only to a proven five-charge initial field', () => {
    const h = fixture();
    h.painter.handleSpellfxAt({ ...faultwake, thunderSpent: 5 });
    expect(h.ventSheet).not.toHaveBeenCalled();
    expect(h.sequenceInstantAt.mock.calls[0].slice(-2)).toEqual([0, true]);
    h.painter.handleSpellfxAt({ ...faultwake, fx: 'tick', thunderSpent: 5 });
    h.painter.handleSpellfxAt({ ...faultwake, thunderSpent: 4 });
    h.painter.handleSpellfxAt(faultwake);
    expect(h.ventSheet).not.toHaveBeenCalled();
    expect(h.sequenceInstantAt.mock.calls.map((call) => call[8])).toEqual([true, false, false]);
  });

  it('preserves the producer-radius fallback when field admission explicitly declines', () => {
    const h = fixture();
    h.shamanField.mockReturnValue(false);
    expect(h.painter.handleSpellfxAt(faultwake)).toBe(true);
    expect(h.spawnAoeRing).toHaveBeenCalledExactlyOnceWith(
      17,
      -23,
      9.5,
      'physical',
      expect.any(Number),
    );
    expect(h.sequenceInstantAt).toHaveBeenCalledTimes(1);
  });

  it('preserves actionable coverage when all real field slots are occupied', () => {
    const h = fixture();
    for (let i = 0; i < 8; i++) {
      expect(h.painter.handleSpellfxAt({ ...faultwake, x: i * 30 })).toBe(true);
      expect(h.shamanField.mock.results[i].value).toBe(true);
    }
    expect(h.spawnAoeRing).not.toHaveBeenCalled();
    expect(h.painter.handleSpellfxAt({ ...faultwake, radius: 12.75 })).toBe(true);
    expect(h.shamanField.mock.results[8].value).toBe(false);
    expect(h.spawnAoeRing).toHaveBeenCalledExactlyOnceWith(
      17,
      -23,
      12.75,
      'physical',
      expect.any(Number),
    );
    h.drawAt(15.99);
    expect(h.appendHeld).toHaveBeenCalled();
  });

  it('keeps the fallback when a point event has no producer duration', () => {
    const h = fixture();
    expect(h.painter.handleSpellfxAt({ ...faultwake, duration: undefined })).toBe(true);
    expect(h.shamanField.mock.results[0].value).toBe(false);
    expect(h.spawnAoeRing).toHaveBeenCalledExactlyOnceWith(
      17,
      -23,
      9.5,
      'physical',
      expect.any(Number),
    );
    h.drawAt(10);
    expect(h.appendHeld).not.toHaveBeenCalled();
  });

  it('does not let a tick create a second ring or restart an accepted field', () => {
    const h = fixture();
    h.painter.handleSpellfxAt(faultwake);
    h.drawAt(15);
    expect(h.painter.handleSpellfxAt({ ...faultwake, fx: 'tick' })).toBe(true);
    expect(h.shamanField.mock.results[1].value).toBe(false);
    expect(h.decal).toHaveBeenCalledTimes(1);
    expect(h.spawnAoeRing).not.toHaveBeenCalled();
    expect(h.sequenceInstantAt).toHaveBeenCalledTimes(1);
    h.drawAt(16);
    expect(h.appendHeld).not.toHaveBeenCalled();
  });

  it('retains cast-gated area cues when no persistent field could be registered', () => {
    const h = fixture(false);
    expect(h.painter.handleSpellfxAt(faultwake)).toBe(true);
    expect(h.spawnAoeRing).toHaveBeenCalledExactlyOnceWith(
      17,
      -23,
      9.5,
      'physical',
      expect.any(Number),
    );
    expect(h.shamanField).not.toHaveBeenCalled();
    expect(h.sequenceInstantAt).not.toHaveBeenCalled();
    h.spawnAoeRing.mockClear();
    expect(h.painter.handleSpellfxAt({ ...faultwake, fx: 'tick' })).toBe(true);
    expect(h.spawnAoeRing).toHaveBeenCalledExactlyOnceWith(
      17,
      -23,
      9.5,
      'physical',
      expect.any(Number),
    );
  });

  it('leaves a non-Shaman point-area telegraph under the existing generic owner', () => {
    const h = fixture();
    expect(
      h.painter.handleSpellfxAt({ ...faultwake, ability: 'frost_nova', school: 'frost' }),
    ).toBe(true);
    expect(h.shamanField).not.toHaveBeenCalled();
    expect(h.spawnAoeRing).toHaveBeenCalledExactlyOnceWith(
      17,
      -23,
      9.5,
      'frost',
      expect.any(Number),
    );
    expect(h.sequenceInstantAt).toHaveBeenCalledTimes(1);
  });
});
