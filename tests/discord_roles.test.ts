import { describe, expect, it } from 'vitest';
import {
  DISCORD_SPECIAL_ROLES,
  specialRoleByKey,
  specialRoleByName,
  specialRoleColor,
  topSpecialRole,
} from '../src/sim/discord_roles';
import { discordRoleTagKey } from '../src/ui/discord_role_tag';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';

describe('discord special roles - guild role name matching', () => {
  it('resolves the canonical staff role names (the original four)', () => {
    expect(specialRoleByName('Levy St')?.key).toBe('levyst');
    expect(specialRoleByName('Devs')?.key).toBe('devs');
    expect(specialRoleByName('Mods')?.key).toBe('mods');
    expect(specialRoleByName('Artists')?.key).toBe('artists');
  });

  it('resolves the Admin guild role to a dedicated admin key', () => {
    // The guild's staff role is named Admin; it must surface in game like
    // Levy St and Devs do (bug: previously there was no matching entry).
    expect(specialRoleByName('Admin')?.key).toBe('admin');
    expect(specialRoleByName('admin')?.key).toBe('admin');
    expect(specialRoleByName('Admins')?.key).toBe('admin');
    expect(specialRoleByName('Administrator')?.key).toBe('admin');
  });

  it('keeps the Admin nameplate color on the staff green the role has in Discord', () => {
    // The Admin role is the renamed Mods role, and renaming a Discord role
    // keeps its color, so admin inherits the staff green.
    expect(specialRoleColor('admin')).toBe('#57d98a');
  });

  it('resolves the singular Artist guild role name (bug: only Artists matched)', () => {
    expect(specialRoleByName('Artist')?.key).toBe('artists');
    expect(specialRoleByName('artist')?.key).toBe('artists');
  });

  it('resolves the Core Dev guild role to its own key, distinct from Devs', () => {
    expect(specialRoleByName('Core Dev')?.key).toBe('coredevs');
    expect(specialRoleByName('core dev')?.key).toBe('coredevs');
    expect(specialRoleByName('Core Devs')?.key).toBe('coredevs');
    expect(specialRoleByName('Core Developer')?.key).toBe('coredevs');
    // Core Dev is a separate Discord role, not an alias that collapses into Devs.
    expect(specialRoleByName('Core Dev')?.key).not.toBe('devs');
  });

  it('resolves common aliases for the other staff roles', () => {
    expect(specialRoleByName('Levy Street')?.key).toBe('levyst');
    expect(specialRoleByName('Dev')?.key).toBe('devs');
    expect(specialRoleByName('Developers')?.key).toBe('devs');
    expect(specialRoleByName('Mod')?.key).toBe('mods');
    expect(specialRoleByName('Moderators')?.key).toBe('mods');
  });

  it('never resolves non-staff role names', () => {
    for (const name of ['everyone', 'WoC Champion', 'Member', 'Bots', '']) {
      expect(specialRoleByName(name)).toBeUndefined();
    }
  });

  it('resolves the Senior Mods and Junior Mods guild roles to their own keys', () => {
    expect(specialRoleByName('Senior Mods')?.key).toBe('seniormods');
    expect(specialRoleByName('senior mods')?.key).toBe('seniormods');
    expect(specialRoleByName('Senior Mod')?.key).toBe('seniormods');
    expect(specialRoleByName('Senior Moderator')?.key).toBe('seniormods');
    expect(specialRoleByName('Senior Moderators')?.key).toBe('seniormods');
    expect(specialRoleByName('Sr Mod')?.key).toBe('seniormods');
    expect(specialRoleByName('Sr Mods')?.key).toBe('seniormods');
    expect(specialRoleByName('Junior Mods')?.key).toBe('juniormods');
    expect(specialRoleByName('junior mods')?.key).toBe('juniormods');
    expect(specialRoleByName('Junior Mod')?.key).toBe('juniormods');
    expect(specialRoleByName('Junior Moderator')?.key).toBe('juniormods');
    expect(specialRoleByName('Junior Moderators')?.key).toBe('juniormods');
    expect(specialRoleByName('Jr Mod')?.key).toBe('juniormods');
    expect(specialRoleByName('Jr Mods')?.key).toBe('juniormods');
    // The tiered mod roles are separate roles, not aliases that collapse into Mods.
    expect(specialRoleByName('Senior Mods')?.key).not.toBe('mods');
    expect(specialRoleByName('Junior Mods')?.key).not.toBe('mods');
    expect(specialRoleByName('Mods')?.key).toBe('mods');
  });

  it('resolves the SHILL and LEGEND community roles case-insensitively', () => {
    expect(specialRoleByName('SHILL')?.key).toBe('shill');
    expect(specialRoleByName('shill')?.key).toBe('shill');
    expect(specialRoleByName('Shills')?.key).toBe('shill');
    expect(specialRoleByName('LEGEND')?.key).toBe('legend');
    expect(specialRoleByName('legend')?.key).toBe('legend');
    expect(specialRoleByName('Legends')?.key).toBe('legend');
  });

  it('resolves the Content Creator guild role and its variants', () => {
    expect(specialRoleByName('Content Creator')?.key).toBe('contentcreator');
    expect(specialRoleByName('content creator')?.key).toBe('contentcreator');
    expect(specialRoleByName('Content Creators')?.key).toBe('contentcreator');
    expect(specialRoleByName('Creator')?.key).toBe('contentcreator');
    expect(specialRoleByName('Creators')?.key).toBe('contentcreator');
  });
});

describe('discord special roles - priority', () => {
  it('ranks admin above devs and below levyst', () => {
    const levyst = specialRoleByKey('levyst');
    const admin = specialRoleByKey('admin');
    const devs = specialRoleByKey('devs');
    expect(admin).toBeDefined();
    expect(levyst!.priority).toBeGreaterThan(admin!.priority);
    expect(admin!.priority).toBeGreaterThan(devs!.priority);
  });

  it('ranks core dev above devs and below admin', () => {
    const admin = specialRoleByKey('admin');
    const coredevs = specialRoleByKey('coredevs');
    const devs = specialRoleByKey('devs');
    expect(coredevs).toBeDefined();
    expect(admin!.priority).toBeGreaterThan(coredevs!.priority);
    expect(coredevs!.priority).toBeGreaterThan(devs!.priority);
  });

  it('picks the top role across mixed guild role names, aliases included', () => {
    expect(topSpecialRole(['Artist', 'Admin'])?.key).toBe('admin');
    expect(topSpecialRole(['Admin', 'Levy St'])?.key).toBe('levyst');
    expect(topSpecialRole(['Member', 'Artist'])?.key).toBe('artists');
    expect(topSpecialRole(['Member', 'WoC Champion'])).toBeUndefined();
  });

  it('surfaces Core Dev over Devs, but Admin still outranks Core Dev', () => {
    // A member who holds both Devs and Core Dev (like the founder) surfaces the
    // higher Core Dev tag.
    expect(topSpecialRole(['Devs', 'Core Dev'])?.key).toBe('coredevs');
    expect(topSpecialRole(['Mods', 'Core Dev'])?.key).toBe('coredevs');
    expect(topSpecialRole(['Core Dev', 'Admin'])?.key).toBe('admin');
  });

  it('slots Senior Mods above Mods and Junior Mods below Mods, all below staff', () => {
    const devs = specialRoleByKey('devs');
    const seniormods = specialRoleByKey('seniormods');
    const mods = specialRoleByKey('mods');
    const juniormods = specialRoleByKey('juniormods');
    const artists = specialRoleByKey('artists');
    expect(seniormods).toBeDefined();
    expect(juniormods).toBeDefined();
    expect(devs!.priority).toBeGreaterThan(seniormods!.priority);
    expect(seniormods!.priority).toBeGreaterThan(mods!.priority);
    expect(mods!.priority).toBeGreaterThan(juniormods!.priority);
    expect(juniormods!.priority).toBeGreaterThan(artists!.priority);
  });

  it('ranks the community roles below Artists: Content Creator, then LEGEND, then SHILL', () => {
    const artists = specialRoleByKey('artists');
    const contentcreator = specialRoleByKey('contentcreator');
    const legend = specialRoleByKey('legend');
    const shill = specialRoleByKey('shill');
    expect(contentcreator).toBeDefined();
    expect(legend).toBeDefined();
    expect(shill).toBeDefined();
    expect(artists!.priority).toBeGreaterThan(contentcreator!.priority);
    expect(contentcreator!.priority).toBeGreaterThan(legend!.priority);
    expect(legend!.priority).toBeGreaterThan(shill!.priority);
  });

  it('picks the top role for members who mix staff, mod-tier, and community roles', () => {
    expect(topSpecialRole(['SHILL', 'Senior Mods'])?.key).toBe('seniormods');
    expect(topSpecialRole(['Junior Mods', 'Mods'])?.key).toBe('mods');
    expect(topSpecialRole(['Senior Mods', 'Devs'])?.key).toBe('devs');
    expect(topSpecialRole(['LEGEND', 'SHILL'])?.key).toBe('legend');
    expect(topSpecialRole(['Content Creator', 'LEGEND'])?.key).toBe('contentcreator');
    expect(topSpecialRole(['Member', 'SHILL'])?.key).toBe('shill');
    expect(topSpecialRole(['Content Creator', 'Artist'])?.key).toBe('artists');
  });

  it('keeps priorities unique so the top pick is deterministic', () => {
    const priorities = DISCORD_SPECIAL_ROLES.map((r) => r.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });
});

describe('discord special roles - catalog integrity', () => {
  it('keeps the English tag catalog exactly in sync with the role keys', () => {
    const tags = hudChromeStrings.discord.roleTag as Record<string, string>;
    for (const role of DISCORD_SPECIAL_ROLES) {
      expect(tags[role.key], `missing hudChrome.discord.roleTag.${role.key}`).toBeTruthy();
    }
    const keys = new Set(DISCORD_SPECIAL_ROLES.map((r) => r.key));
    for (const tagKey of Object.keys(tags)) {
      expect(keys.has(tagKey), `stale roleTag entry '${tagKey}' has no catalog role`).toBe(true);
    }
  });

  it('ships the exact English tag labels for the new mod-tier and community roles', () => {
    const tags = hudChromeStrings.discord.roleTag as Record<string, string>;
    expect(tags.seniormods).toBe('Senior Mod');
    expect(tags.juniormods).toBe('Junior Mod');
    expect(tags.contentcreator).toBe('Content Creator');
    expect(tags.legend).toBe('LEGEND');
    expect(tags.shill).toBe('SHILL');
  });

  it('gives every role a color and unique key and matcher names', () => {
    const keys = new Set<string>();
    const names = new Set<string>();
    for (const role of DISCORD_SPECIAL_ROLES) {
      expect(role.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(keys.has(role.key)).toBe(false);
      keys.add(role.key);
      for (const name of [role.name, ...(role.aliases ?? [])]) {
        const lower = name.toLowerCase();
        expect(names.has(lower), `duplicate matcher name '${name}'`).toBe(false);
        names.add(lower);
      }
    }
  });
});

describe('discord role tag labels - single source', () => {
  it('maps every special role key to a tag label key, and only those', () => {
    // The nameplate painter and both HUD discord cards resolve the tag through
    // discordRoleTagKey; a role added here without a tag entry would silently
    // show no tag in game (the Admin/Artist drop-out bug class).
    for (const role of DISCORD_SPECIAL_ROLES) {
      expect(discordRoleTagKey(role.key), `no tag label key for '${role.key}'`).toBeTruthy();
    }
    expect(discordRoleTagKey('not-a-role')).toBeUndefined();
    expect(discordRoleTagKey(undefined)).toBeUndefined();
  });
});
