import { describe, expect, it } from 'vitest';
import {
  parseWocArmorPackUrl,
  WOC_ARMOR_CONSTRAINED_IDLE_EVICT_MS,
  WOC_ARMOR_IDLE_EVICT_MS,
  WOC_ARMOR_TIERS,
  WOC_ARMOR_TOP_IDLE_EVICT_MS,
  WocArmorResidency,
  wocAnimsUrl,
  wocArmorIdleEvictMs,
  wocArmorPackBaseUrl,
  wocArmorPackUrl,
  wocArmorTierFor,
  wocBaseUrl,
  wocStandInTier,
} from '../src/render/characters/woc_armor_core';

// The pure decisions behind the split WOC character files (the 2026-09-25 character size
// gameplan, steps 2, 5 and 6): which file a body, a clip library and an armor set load from,
// which texture tier a character draws, what stands in while a tier streams, and how long a
// set nobody wears stays in memory (never freed for being idle where a crowd draws it on a
// desktop, soon on a phone).

describe('the split file names', () => {
  it('names one base and one library per fit, and per set and fit a low, a medium and a top file', () => {
    expect(wocBaseUrl('male')).toBe('models/chars/players/woc/base_male.glb');
    expect(wocAnimsUrl('female')).toBe('models/chars/players/woc/anims_female.glb');
    expect(wocArmorPackUrl('female', 'mage', 'low')).toBe(
      'models/chars/players/woc/armor/female_mage_low.glb',
    );
    expect(wocArmorPackUrl('female', 'mage', 'medium')).toBe(
      'models/chars/players/woc/armor/female_mage_medium.glb',
    );
    // the high pack has no file of its own: the top file that completes it names it
    expect(wocArmorPackUrl('female', 'mage', 'high')).toBe(
      'models/chars/players/woc/armor/female_mage_top.glb',
    );
    expect(WOC_ARMOR_TIERS).toEqual(['low', 'medium', 'high']);
  });

  it('lays only the high pack over another: its medium file', () => {
    expect(wocArmorPackBaseUrl(wocArmorPackUrl('male', 'iron_crown', 'high'))).toBe(
      'models/chars/players/woc/armor/male_iron_crown_medium.glb',
    );
    expect(wocArmorPackBaseUrl(`/media/${wocArmorPackUrl('female', 'mage', 'high')}`)).toBe(
      'models/chars/players/woc/armor/female_mage_medium.glb',
    );
    expect(wocArmorPackBaseUrl(wocArmorPackUrl('male', 'mage', 'medium'))).toBeNull();
    expect(wocArmorPackBaseUrl(wocArmorPackUrl('male', 'mage', 'low'))).toBeNull();
    expect(wocArmorPackBaseUrl(wocBaseUrl('male'))).toBeNull();
  });

  it('parses an armor file back into its fit, set and tier, and nothing else', () => {
    for (const fit of ['male', 'female'] as const) {
      for (const tier of WOC_ARMOR_TIERS) {
        for (const set of ['warrior', 'iron_crown']) {
          expect(parseWocArmorPackUrl(wocArmorPackUrl(fit, set, tier))).toEqual({ fit, set, tier });
          expect(parseWocArmorPackUrl(`/media/${wocArmorPackUrl(fit, set, tier)}`)).toEqual({
            fit,
            set,
            tier,
          });
        }
      }
    }
    expect(parseWocArmorPackUrl(wocBaseUrl('male'))).toBeNull();
    expect(parseWocArmorPackUrl('models/chars/players/woc/armor/male_mage_ultra.glb')).toBeNull();
    // the retired whole-high-tier file names no pack any more
    expect(parseWocArmorPackUrl('models/chars/players/woc/armor/male_mage_high.glb')).toBeNull();
    expect(parseWocArmorPackUrl('models/chars/players/woc_mage.glb')).toBeNull();
  });
});

describe('the armor texture tier a character draws', () => {
  it('draws low on the low preset and on every phone, whoever the character is', () => {
    for (const detail of ['full', 'crowd'] as const) {
      expect(wocArmorTierFor({ tier: 'low', constrainedMemory: false }, detail)).toBe('low');
      // a phone-class memory profile draws the low tier whatever preset it runs
      for (const tier of ['low', 'medium', 'high', 'ultra', 'insane']) {
        expect(wocArmorTierFor({ tier, constrainedMemory: true }, detail), tier).toBe('low');
      }
    }
  });

  it('draws medium for everyone on the medium preset: the top levels are a High download', () => {
    for (const detail of ['full', 'crowd'] as const) {
      expect(wocArmorTierFor({ tier: 'medium', constrainedMemory: false }, detail)).toBe('medium');
    }
  });

  it('draws high at full detail and medium for the crowd on high and above', () => {
    for (const tier of ['high', 'ultra', 'insane']) {
      const profile = { tier, constrainedMemory: false };
      // the local player's own character, and every body built directly
      expect(wocArmorTierFor(profile, 'full'), tier).toBe('high');
      // every other character in the world
      expect(wocArmorTierFor(profile, 'crowd'), tier).toBe('medium');
    }
    // full detail is the default: a body built directly needs no say
    expect(wocArmorTierFor({ tier: 'high', constrainedMemory: false })).toBe('high');
  });

  it('stands in the nearest resident tier while the wanted one streams, never a lower one first', () => {
    const resident = (tiers: string[]) => (t: string) => tiers.includes(t);
    expect(wocStandInTier('medium', resident(['low', 'medium', 'high']))).toBe('medium');
    // equal distance: the higher tier first (never draw less than asked when more is here)
    expect(wocStandInTier('medium', resident(['low', 'high']))).toBe('high');
    expect(wocStandInTier('medium', resident(['low']))).toBe('low');
    expect(wocStandInTier('high', resident(['low']))).toBe('low');
    expect(wocStandInTier('high', resident(['medium', 'low']))).toBe('medium');
    expect(wocStandInTier('low', resident(['high']))).toBe('high');
    // nothing resident: the body's own suit
    expect(wocStandInTier('high', resident([]))).toBeNull();
    // a high pack streams over its resident medium file: the medium file stands in
    expect(wocStandInTier('high', resident(['medium']))).toBe('medium');
  });
});

describe('the armor residency ledger (a set nobody wears is freed)', () => {
  it('frees a file only once its last user has been gone for the idle window', () => {
    const r = new WocArmorResidency(1000);
    r.acquire('a');
    r.acquire('a');
    r.release('a', 0);
    expect(r.refs('a')).toBe(1);
    expect(r.takeExpired(5000)).toEqual([]); // still worn
    r.release('a', 100);
    expect(r.refs('a')).toBe(0);
    expect(r.takeExpired(1099)).toEqual([]); // inside the window
    expect(r.takeExpired(1100)).toEqual(['a']);
    expect(r.takeExpired(9000)).toEqual([]); // handed back once
  });

  it('restarts nothing while worn, and a new wearer cancels a pending free', () => {
    const r = new WocArmorResidency(1000);
    r.acquire('a');
    r.release('a', 0);
    r.acquire('a'); // worn again inside the window
    expect(r.takeExpired(5000)).toEqual([]);
    r.release('a', 5000);
    expect(r.takeExpired(5999)).toEqual([]);
    expect(r.takeExpired(6000)).toEqual(['a']);
  });

  it('starts a prefetched file idle, and forgets a file outright', () => {
    const r = new WocArmorResidency(1000);
    r.noteResident('p', 10);
    expect(r.takeExpired(1009)).toEqual([]);
    expect(r.takeExpired(1010)).toEqual(['p']);
    r.acquire('q');
    r.noteResident('q', 0); // worn: arrival never starts a window
    expect(r.takeExpired(10_000)).toEqual([]);
    r.forget('q');
    expect(r.refs('q')).toBe(0);
    expect(r.takeExpired(10_000)).toEqual([]);
    expect(WOC_ARMOR_IDLE_EVICT_MS).toBe(3 * 60 * 1000);
  });

  it('asks the window of each pack at every sweep, and never frees one whose window is infinite', () => {
    const windows: Record<string, number> = {
      kept: Number.POSITIVE_INFINITY,
      short: 100,
      long: 500,
    };
    const r = new WocArmorResidency((url) => windows[url]);
    for (const url of ['kept', 'short', 'long']) {
      r.acquire(url);
      r.release(url, 0);
    }
    expect(r.takeExpired(99)).toEqual([]);
    expect(r.takeExpired(100)).toEqual(['short']);
    expect(r.takeExpired(500)).toEqual(['long']);
    // idle for ever: nothing ever hands it back
    expect(r.takeExpired(Number.MAX_SAFE_INTEGER)).toEqual([]);
    // the rule changed under it (a preset change): its idle time so far counts
    windows.kept = 1000;
    expect(r.takeExpired(999)).toEqual([]);
    expect(r.takeExpired(1000)).toEqual(['kept']);
    // ...and a pack whose rule turns infinite stops ageing out without a touch
    r.acquire('short');
    r.release('short', 2000);
    windows.short = Number.POSITIVE_INFINITY;
    expect(r.takeExpired(1e9)).toEqual([]);
  });

  it('knows which packs were drawn lately: in use, or let go inside the span asked about', () => {
    const r = new WocArmorResidency(Number.POSITIVE_INFINITY);
    r.acquire('worn');
    expect(r.drawnWithin('worn', 1e9, 1)).toBe(true); // in use, however long ago it began
    r.acquire('left');
    r.release('left', 1000);
    expect(r.drawnWithin('left', 1999, 1000)).toBe(true);
    expect(r.drawnWithin('left', 2000, 1000)).toBe(false);
    // a pack that only arrived (a prefetch) is idle, and was never drawn
    r.noteResident('fetched', 1000);
    expect(r.drawnWithin('fetched', 1000, 1000)).toBe(false);
    expect(r.drawnWithin('unknown', 0, 1000)).toBe(false);
    // one of two users leaving is not the pack being let go
    r.acquire('worn');
    r.release('worn', 5000);
    expect(r.drawnWithin('worn', 1e9, 1)).toBe(true);
    r.forget('left');
    expect(r.drawnWithin('left', 1001, 1000)).toBe(false);
  });
});

describe('how long an armor pack nobody draws stays in memory', () => {
  const desktop = (tier: string) => ({ tier, constrainedMemory: false });
  const phone = (tier: string) => ({ tier, constrainedMemory: true });
  const NEVER = Number.POSITIVE_INFINITY;

  it('never frees the tier a crowd draws on a desktop: low on the low preset, medium above it', () => {
    expect(wocArmorIdleEvictMs('low', desktop('low'))).toBe(NEVER);
    for (const preset of ['medium', 'high', 'ultra', 'insane']) {
      expect(wocArmorIdleEvictMs('medium', desktop(preset)), preset).toBe(NEVER);
    }
    // the rule follows wocArmorTierFor, whatever it answers: one source for both
    for (const preset of ['low', 'medium', 'high', 'ultra', 'insane']) {
      const crowd = wocArmorTierFor(desktop(preset), 'crowd');
      expect(wocArmorIdleEvictMs(crowd, desktop(preset)), preset).toBe(NEVER);
    }
  });

  it('frees a tier the preset draws for nobody after the long window (a preset change left it)', () => {
    // medium files after a switch down to the low preset
    expect(wocArmorIdleEvictMs('medium', desktop('low'))).toBe(WOC_ARMOR_IDLE_EVICT_MS);
    // low files (a switch up, or a portrait's own fetch) on every other preset
    for (const preset of ['medium', 'high', 'ultra', 'insane']) {
      expect(wocArmorIdleEvictMs('low', desktop(preset)), preset).toBe(WOC_ARMOR_IDLE_EVICT_MS);
    }
  });

  it('frees the top levels of a high pack nobody draws quickly, on every desktop preset', () => {
    for (const preset of ['low', 'medium', 'high', 'ultra', 'insane']) {
      expect(wocArmorIdleEvictMs('high', desktop(preset)), preset).toBe(
        WOC_ARMOR_TOP_IDLE_EVICT_MS,
      );
    }
    // short against the window of a file left behind, and long enough to flip back to
    expect(WOC_ARMOR_TOP_IDLE_EVICT_MS).toBe(20 * 1000);
    expect(WOC_ARMOR_TOP_IDLE_EVICT_MS).toBeLessThan(WOC_ARMOR_IDLE_EVICT_MS);
  });

  it('frees everything soon on the phone-class memory profile, whatever the preset and the tier', () => {
    for (const preset of ['low', 'medium', 'high', 'ultra', 'insane']) {
      for (const tier of WOC_ARMOR_TIERS) {
        expect(wocArmorIdleEvictMs(tier, phone(preset)), `${preset} ${tier}`).toBe(
          WOC_ARMOR_CONSTRAINED_IDLE_EVICT_MS,
        );
      }
    }
    // inside the minute after a crowd leaves, where three minutes was not
    expect(WOC_ARMOR_CONSTRAINED_IDLE_EVICT_MS).toBe(30 * 1000);
    expect(WOC_ARMOR_CONSTRAINED_IDLE_EVICT_MS).toBeLessThan(60 * 1000);
  });
});
