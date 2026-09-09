// @vitest-environment happy-dom
//
// The composition seam for the six aura tracks
// (src/ui/hud/aura_tracks/aura_track_host.ts).
//
// WHY THIS FILE EXISTS. The core and the painter each had thorough tests and the
// family that wires them had none, on the reasoning that it is only glue. It is
// not: it owns the per-tick input every track reads, and it hands ONE input to
// six consumers in a loop. That is precisely where a defect can be invisible to
// both of the other test files, and one was.
//
// The Hud passes `sim.entities.values()`. An iterator is spent after one pass,
// so the first track drained it and the other five scanned an empty world: every
// ally row in the game was missing, in a family whose whole point is showing
// what you have out on other people. Nothing was red. It surfaced only because a
// screenshot of a priest healing a dummy came back with two player-cast auras on
// the target and not one row anywhere on screen.
//
// So the first test below feeds a REAL one-shot iterator, and asserts that the
// LAST track still sees the ally. Feeding an array would pass on the broken code.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AURA_TRACK_FRAME_PREFIX,
  AURA_TRACKS,
  auraTrackForFrameId,
} from '../src/ui/hud/aura_tracks/aura_track_descriptors';
import { AuraTrackFamily } from '../src/ui/hud/aura_tracks/aura_track_host';
import type { AuraTrackEntityInput } from '../src/ui/hud/aura_tracks/aura_track_view';
import type { PainterHostWriters } from '../src/ui/painter_host';

const PLAYER_ID = 7;

/** The language the frame labels resolve in; the relocalize test flips it. */
let lang = 'en';

/** Applies every write, so the assertions can read the resulting DOM. */
function writers(): PainterHostWriters {
  const facet: PainterHostWriters = {
    setText: (el, text) => {
      el.textContent = text;
    },
    setDisplay: (el, display) => {
      el.style.display = display;
    },
    setTransform: () => {},
    setWidth: (el, width) => {
      el.style.width = width;
    },
    setStyleProp: (el, prop, value) => {
      el.style.setProperty(prop, value);
    },
    toggleClass: (el, cls, on) => {
      el.classList.toggle(cls, on);
    },
    setAttr: (el, attr, value) => {
      if (value === null) el.removeAttribute(attr);
      else el.setAttribute(attr, value);
    },
  };
  return facet;
}

function makeFamily() {
  const containers = new Map<string, HTMLElement>();
  for (const track of AURA_TRACKS) {
    const el = document.createElement('div');
    el.id = track.elementId;
    document.body.append(el);
    containers.set(track.elementId, el);
  }
  const family = new AuraTrackFamily<AuraTrackEntityInput>({
    isOwn: (a) => a.sourceId === PLAYER_ID,
    isMode: () => false,
    auraName: (a) => a.id,
    unitName: (e) => e.name,
    iconKey: (a) => a.id,
    iconBackground: (key) => `url(${key}.png)`,
    writers: writers(),
    container: (elementId) => {
      const el = containers.get(elementId);
      if (!el) throw new Error(`no container for ${elementId}`);
      return el;
    },
    rowLabel: (aura, unit) => (unit ? `${aura} on ${unit}` : aura),
    frameLabel: (track) => (lang === 'en' ? track.id : `${track.id} (${lang})`),
    overflowLabel: (n) => `${n} more`,
    secondsSuffix: () => 's',
    modeLabel: () => 'ON',
  });
  const rowsOf = (trackId: string): string[] => {
    const track = AURA_TRACKS.find((t) => t.id === trackId);
    if (!track) throw new Error(`no such track: ${trackId}`);
    const root = containers.get(track.elementId);
    if (!root) throw new Error('no container');
    if (getComputedStyle(root).display === 'none') return [];
    return [...root.querySelectorAll<HTMLElement>('.at-row')]
      .filter((r) => r.style.display !== 'none')
      .map((r) => r.querySelector('.at-label')?.textContent ?? '');
  };
  return { family, containers, rowsOf };
}

const player = (): AuraTrackEntityInput => ({
  id: PLAYER_ID,
  name: 'Me',
  dead: false,
  auras: [],
});

const ally = (): AuraTrackEntityInput => ({
  id: 42,
  name: 'Bob',
  dead: false,
  auras: [
    {
      id: 'renew',
      name: 'Renew',
      kind: 'hot',
      remaining: 9,
      duration: 12,
      sourceId: PLAYER_ID,
    },
    {
      id: 'power_word_shield',
      name: 'Shield',
      kind: 'absorb',
      remaining: 20,
      duration: 30,
      sourceId: PLAYER_ID,
      value: 400,
    },
  ],
});

const on = () => true;

describe('AuraTrackFamily: the shared per-tick input', () => {
  it('lets EVERY track see the allies, not just the first one to look', () => {
    // The regression. `allies` arrives as a one-shot iterator from
    // `sim.entities.values()`; six tracks read it in a loop. Feeding an array
    // here would pass against the broken code, so this feeds a real generator
    // and asserts on tracks at BOTH ends of the descriptor order.
    const { family, rowsOf } = makeFamily();
    const allies = ally();
    function* oneShot(): Generator<AuraTrackEntityInput> {
      yield allies;
    }
    family.tick(player(), oneShot(), on, true);

    // `friendly` is 5th and `shields` 6th in the table; both were empty.
    expect(rowsOf('friendly')).toEqual(['renew on Bob']);
    expect(rowsOf('shields')).toEqual(['power_word_shield on Bob']);
  });

  it('sees the allies again on the NEXT tick, with a fresh iterator each frame', () => {
    // The reused scratch has to be cleared per tick, or the second frame either
    // doubles the rows or keeps a unit that has gone.
    const { family, rowsOf } = makeFamily();
    function* oneShot(e: AuraTrackEntityInput): Generator<AuraTrackEntityInput> {
      yield e;
    }
    family.tick(player(), oneShot(ally()), on, true);
    family.tick(player(), oneShot(ally()), on, true);
    expect(rowsOf('friendly')).toEqual(['renew on Bob']);

    // The ally leaves: its row must go with it rather than linger in the scratch.
    family.tick(player(), [], on, true);
    expect(rowsOf('friendly')).toEqual([]);
    expect(rowsOf('shields')).toEqual([]);
  });

  it('asks the enabled predicate once per track, with that track own setting key', () => {
    const asked: string[] = [];
    const { family, rowsOf } = makeFamily();
    family.tick(
      player(),
      [ally()],
      (key) => {
        asked.push(key);
        return key !== 'showShieldTrack';
      },
      true,
    );
    expect(asked).toEqual(AURA_TRACKS.map((t) => t.settingKey));
    // The one switched off is empty; its neighbour is not.
    expect(rowsOf('shields')).toEqual([]);
    expect(rowsOf('friendly')).toEqual(['renew on Bob']);
  });

  it('passes the mode sub-option through to every core, both ways', () => {
    // The wiring pin for Include Stealth and Travel Modes. Feeding the same
    // stealth aura with the flag on and then off must change the utility track's
    // rows; without this, dropping the pass-through kept every other test green.
    const containers = new Map<string, HTMLElement>();
    for (const track of AURA_TRACKS) {
      const el = document.createElement('div');
      el.id = `${track.elementId}-modes`;
      document.body.append(el);
      containers.set(track.elementId, el);
    }
    const family = new AuraTrackFamily<AuraTrackEntityInput>({
      isOwn: (a) => a.sourceId === PLAYER_ID,
      isMode: (a) => a.id === 'stealth',
      auraName: (a) => a.id,
      unitName: (e) => e.name,
      iconKey: (a) => a.id,
      iconBackground: (key) => `url(${key}.png)`,
      writers: writers(),
      container: (elementId) => {
        const el = containers.get(elementId);
        if (!el) throw new Error(`no container for ${elementId}`);
        return el;
      },
      rowLabel: (aura, unit) => (unit ? `${aura} on ${unit}` : aura),
      frameLabel: (track) => track.id,
      overflowLabel: (n) => `${n} more`,
      secondsSuffix: () => 's',
      modeLabel: () => 'ON',
    });
    const stealthed = (): AuraTrackEntityInput => ({
      ...player(),
      auras: [
        {
          id: 'sprint',
          name: 'Sprint',
          kind: 'buff_speed',
          remaining: 9,
          duration: 15,
          sourceId: PLAYER_ID,
        },
        {
          id: 'stealth',
          name: 'Stealth',
          kind: 'stealth',
          remaining: 3600,
          duration: 3600,
          sourceId: PLAYER_ID,
        },
      ],
    });
    const utility = AURA_TRACKS.find((t) => t.id === 'utility');
    if (!utility) throw new Error('no utility track');
    const rows = () => {
      const root = containers.get(utility.elementId);
      if (!root) throw new Error('no container');
      return [...root.querySelectorAll<HTMLElement>('.at-row')]
        .filter((r) => r.style.display !== 'none')
        .map((r) => r.querySelector('.at-label')?.textContent ?? '');
    };
    family.tick(stealthed(), [], on, true);
    expect(rows()).toEqual(['sprint', 'stealth']);
    family.tick(stealthed(), [], on, false);
    expect(rows()).toEqual(['sprint']);
  });

  it('does nothing per frame while every track is off, not even read the roster', () => {
    // All six ship off, so this is the frame every player pays by default. The
    // roster arrives as an iterator; a family that walked it would consume it.
    const { family, rowsOf } = makeFamily();
    let pulled = 0;
    function* counting(): Generator<AuraTrackEntityInput> {
      pulled++;
      yield ally();
    }
    family.tick(player(), counting(), () => false, true);
    expect(pulled).toBe(0);
    for (const track of AURA_TRACKS) expect(rowsOf(track.id)).toEqual([]);

    // Switched on, the same roster is read and the rows appear; switched off
    // again, the frame hides on that one tick and the roster is left alone.
    family.tick(player(), counting(), on, true);
    expect(pulled).toBe(1);
    expect(rowsOf('friendly')).toEqual(['renew on Bob']);
    family.tick(player(), counting(), () => false, true);
    expect(pulled).toBe(1);
    expect(rowsOf('friendly')).toEqual([]);
  });

  it('composes one view and one painter per descriptor, in table order', () => {
    const { family } = makeFamily();
    expect(family.tracks.map((t) => t.descriptor.id)).toEqual(AURA_TRACKS.map((t) => t.id));
    for (const track of family.tracks) {
      expect(track.view).toBeTruthy();
      expect(track.painter).toBeTruthy();
    }
  });

  it('relocalizes every track, not merely the first', () => {
    // The label resolver reads a language that flips between the two sweeps, so
    // the second sweep can only pass if relocalize() really re-resolved every
    // frame's name (a constant on both sides would pass with the method empty).
    const { family, containers } = makeFamily();
    family.tick(player(), [ally()], on, true);
    for (const track of AURA_TRACKS) {
      expect(containers.get(track.elementId)?.getAttribute('aria-label')).toBe(track.id);
    }
    lang = 'fr';
    family.relocalize();
    for (const track of AURA_TRACKS) {
      expect(containers.get(track.elementId)?.getAttribute('aria-label')).toBe(`${track.id} (fr)`);
    }
    lang = 'en';
  });

  it('has a container for every track in both HTML entries', () => {
    // The painter resolves its root in the constructor, so a missing container
    // is a construction-time failure on every login, not one degraded frame.
    // This file builds its own containers and cannot see that; the entries can.
    for (const entry of ['index.html', 'play.html']) {
      const html = readFileSync(join(process.cwd(), entry), 'utf8');
      for (const track of AURA_TRACKS) {
        expect(html, `${entry} lacks #${track.elementId}`).toContain(`id="${track.elementId}"`);
      }
    }
  });
});

describe('auraTrackForFrameId', () => {
  it('reverses the generated frame id for every track and nothing else', () => {
    for (const track of AURA_TRACKS) {
      expect(auraTrackForFrameId(`${AURA_TRACK_FRAME_PREFIX}${track.id}`)?.id).toBe(track.id);
    }
    expect(auraTrackForFrameId('buffBar')).toBeUndefined();
    expect(auraTrackForFrameId('auraTrack_nope')).toBeUndefined();
    expect(auraTrackForFrameId('')).toBeUndefined();
  });
});
