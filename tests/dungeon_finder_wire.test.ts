import { describe, expect, it } from 'vitest';
import {
  decodeDungeonFinderBoard,
  decodeDungeonFinderExpedition,
  decodeDungeonFinderInfo,
} from '../src/net/dungeon_finder_wire';
import { applySocialSelfWire } from '../src/net/social_self_wire';
import { bareClient } from './helpers/bare_client';

const expedition = {
  exitId: 12,
  leaderPid: 7,
  activityId: 'hollow_crypt_normal',
  dungeonId: 'hollow_crypt',
  isLeader: false,
  isInside: false,
  canTravel: true,
  open: true,
  bossesDefeated: 1,
  bossesTotal: 2,
};

describe('group listing extras decoding (gear, advert, guild)', () => {
  it('keeps valid applicant gear and advert cooldowns by reference', () => {
    const info = {
      myListing: {
        id: 7,
        advertText: 'LFM - The Hollow Crypt - Normal - 1/5 - Healer/DPS needed',
        applicants: [{ pid: 1, spec: 'arms', gear: { chest: 'gear_chest', mainhand: 'sword' } }],
      },
      advert: { general: 3, discord: 0, discordAvailable: true },
    };
    expect(decodeDungeonFinderInfo(info)).toBe(info);
  });

  it('drops only the malformed part: a bad gear map, an oversized line, a bad cooldown', () => {
    const decoded = decodeDungeonFinderInfo({
      myListing: {
        id: 7,
        advertText: 'x'.repeat(161),
        applicants: [
          { pid: 1, spec: 'arms', gear: { notASlot: 'gear_chest' } },
          { pid: 2, spec: 'arms', gear: { chest: 'gear_chest' } },
        ],
      },
      advert: { general: -1, discord: 0, discordAvailable: true },
    });
    expect(decoded?.myListing?.advertText).toBeUndefined();
    expect(decoded?.myListing?.applicants[0]).toEqual({ pid: 1, spec: 'arms' });
    expect(decoded?.myListing?.applicants[1].gear).toEqual({ chest: 'gear_chest' });
    expect(decoded?.advert).toBeUndefined();
  });

  it('drops a board row whose guild is not a bounded string', () => {
    const ok = { id: 1, guild: 'Nightwatch' };
    expect(decodeDungeonFinderBoard([ok, { id: 2, guild: 5 }])).toEqual([ok]);
  });
});

describe('expedition snapshot decoding', () => {
  it('mirrors actual applicant specs while accepting legacy rows and sanitizing malformed specs', () => {
    const rows = [{ pid: 1, spec: 'shadow' }, { pid: 2, spec: null }, { pid: 3 }];
    const info = { myListing: { id: 7, applicants: rows } };
    expect(decodeDungeonFinderInfo(info)).toBe(info);
    const client = bareClient(7);
    applySocialSelfWire(client, { df: info });
    expect(client.dungeonFinderInfo?.myListing?.applicants).toBe(rows);
    applySocialSelfWire(client, {});
    expect(client.dungeonFinderInfo?.myListing?.applicants[0].spec).toBe('shadow');
    const malformed = { myListing: { id: 7, applicants: [...rows, { pid: 4, spec: {} }] } };
    expect(decodeDungeonFinderInfo(malformed)?.myListing?.applicants).toEqual([
      ...rows,
      { pid: 4, spec: null },
    ]);
    expect(malformed.myListing.applicants.at(-1)?.spec).toEqual({});
  });

  it('retains bounded valid application rows by reference and filters invalid or duplicate rows', () => {
    const first = {
      listingId: 1,
      remaining: 90,
      leaderName: 'One',
      activityId: 'hollow_crypt_normal',
    };
    const second = { listingId: 2, remaining: 60, leaderName: 'Two' };
    const valid = { myApplication: first, myApplications: [first, second] };
    expect(decodeDungeonFinderInfo(valid)).toBe(valid);
    const invalid = decodeDungeonFinderInfo({
      myApplications: [
        first,
        { ...first, remaining: 10 },
        { ...second, listingId: 0 },
        { ...second, remaining: Infinity },
        { ...second, activityId: {} },
      ],
    });
    expect(invalid?.myApplications).toEqual([first]);
    expect(decodeDungeonFinderInfo({ myApplications: 'rows' })?.myApplications).toEqual([]);
    expect(
      decodeDungeonFinderInfo({ myApplications: Array(6).fill(first) })?.myApplications,
    ).toEqual([]);
  });
  it('mirrors all applications across delta omissions and clears explicit empty state', () => {
    const client = bareClient(7);
    const applications = [
      { listingId: 1, remaining: 120, leaderName: 'One' },
      { listingId: 2, remaining: 120, leaderName: 'Two' },
    ];
    applySocialSelfWire(client, {
      df: { myApplication: applications[0], myApplications: applications },
    });
    applySocialSelfWire(client, {});
    expect(client.dungeonFinderInfo?.myApplications).toBe(applications);
    applySocialSelfWire(client, { df: { myApplication: null, myApplications: [] } });
    expect(client.dungeonFinderInfo?.myApplications).toEqual([]);
    expect(client.dungeonFinderInfo?.myApplication).toBeNull();
  });
  it('retains validated enrichments by reference and strips malformed optional controls', () => {
    const valid = {
      availability: { enabled: true, roles: ['healer'], notice: { seq: 1, listingIds: [2] } },
      applicationFeedback: { seq: 2, outcome: 'accepted', leaderName: 'Mira' },
      queueRewards: {
        balance: 40,
        unlocked: ['bronze'],
        equipped: 'bronze',
        earnedToday: 20,
        dailyCap: 60,
      },
      myApplication: { listingId: 2, remaining: 90, leaderName: 'Leader' },
    };
    expect(decodeDungeonFinderInfo(valid)).toBe(valid);
    const invalid = decodeDungeonFinderInfo({
      availability: { ...valid.availability, roles: ['admin'] },
      applicationFeedback: { ...valid.applicationFeedback, outcome: 'hacked' },
      queueRewards: { ...valid.queueRewards, equipped: 'gold' },
      myApplication: { ...valid.myApplication, remaining: Infinity },
    });
    expect(invalid?.availability).toBeUndefined();
    expect(invalid?.applicationFeedback).toBeNull();
    expect(invalid?.queueRewards).toBeUndefined();
    expect(invalid?.myApplication).toBeNull();
    expect(decodeDungeonFinderBoard([{ id: 1, details: { purpose: 'admin', note: '' } }])).toEqual(
      [],
    );
  });
  it('preserves valid and legacy finder state by reference', () => {
    const valid = { expedition };
    const legacy = { roles: ['dps'] };
    expect(decodeDungeonFinderInfo(valid)).toBe(valid);
    expect(decodeDungeonFinderInfo(legacy)).toBe(legacy);
    expect(decodeDungeonFinderExpedition(expedition)).toBe(expedition);
    const board = [{ id: 1, expedition: { bossesDefeated: 1, bossesTotal: 2 } }, { id: 2 }];
    expect(decodeDungeonFinderBoard(board)).toBe(board);
  });

  it.each([
    { exitId: '12' },
    { exitId: NaN },
    { leaderPid: -2 },
    { canTravel: 1 },
    { dungeonId: {} },
    { bossesDefeated: 3 },
    { bossesTotal: Infinity },
  ])('disables malformed expedition controls %j', (override) => {
    expect(decodeDungeonFinderExpedition({ ...expedition, ...override })).toBeNull();
    expect(
      decodeDungeonFinderInfo({ expedition: { ...expedition, ...override } })?.expedition,
    ).toBeNull();
  });

  it('drops malformed running listings while retaining valid legacy listings', () => {
    const legacy = { id: 1 };
    expect(
      decodeDungeonFinderBoard([
        legacy,
        { id: 2, expedition: { bossesDefeated: 4, bossesTotal: 2 } },
      ]),
    ).toEqual([legacy]);
  });

  it('keeps expedition state across delta omissions and clears it on explicit null', () => {
    const client = bareClient(7);
    applySocialSelfWire(client, {
      df: { expedition },
      dfb: [{ id: 1, expedition: { bossesDefeated: 1, bossesTotal: 2 } }],
    });
    expect(client.dungeonFinderInfo?.expedition).toBe(expedition);
    applySocialSelfWire(client, {});
    expect(client.dungeonFinderInfo?.expedition).toBe(expedition);
    expect(client.dungeonFinderBoard).toHaveLength(1);
    applySocialSelfWire(client, { df: null, dfb: null });
    expect(client.dungeonFinderInfo).toBeNull();
    expect(client.dungeonFinderBoard).toBeNull();
  });
});
