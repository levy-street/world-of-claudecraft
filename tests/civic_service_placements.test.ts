import { afterEach, describe, expect, it } from 'vitest';
import {
  type CivicServicePlacementsReader,
  createCivicServicePlacementsReader,
} from '../src/net/civic_service_placements';
import { buildCivicServicePlacements } from '../src/sim/civic_service_placements';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { bareClient } from './helpers/bare_client';

afterEach(() => setActiveWorldContent(null));

describe('buildCivicServicePlacements', () => {
  it('keeps authored order with every mailbox before every noticeboard', () => {
    expect(
      buildCivicServicePlacements(
        [
          { x: 7, z: 70 },
          { x: 8, z: 80 },
        ],
        [
          { x: 9, z: 90 },
          { x: 10, z: 100 },
        ],
      ),
    ).toEqual([
      { kind: 'mailbox', x: 7, z: 70 },
      { kind: 'mailbox', x: 8, z: 80 },
      { kind: 'noticeboard', x: 9, z: 90 },
      { kind: 'noticeboard', x: 10, z: 100 },
    ]);
  });

  it('returns frozen boundary copies that never alias either input', () => {
    const mailbox = { x: 11, z: 12 };
    const noticeboard = { x: 13, z: 14 };
    const mailboxes = [mailbox];
    const noticeboards = [noticeboard];

    const placements = buildCivicServicePlacements(mailboxes, noticeboards);

    expect(Object.isFrozen(placements)).toBe(true);
    expect(placements.every((placement) => Object.isFrozen(placement))).toBe(true);
    expect(placements).not.toBe(mailboxes);
    expect(placements[0]).not.toBe(mailbox);
    expect(placements[1]).not.toBe(noticeboard);

    mailbox.x = 111;
    noticeboard.z = 114;
    mailboxes.push({ x: 15, z: 16 });
    noticeboards.length = 0;
    expect(placements).toEqual([
      { kind: 'mailbox', x: 11, z: 12 },
      { kind: 'noticeboard', x: 13, z: 14 },
    ]);
  });
});

describe('createCivicServicePlacementsReader', () => {
  it('reuses one frozen result until the active-content generation changes', () => {
    const read = createCivicServicePlacementsReader();
    const builtin = read();

    expect(read()).toBe(builtin);

    setActiveWorldContent(BUILTIN_WORLD);
    const sameContentNewGeneration = read();
    expect(sameContentNewGeneration).not.toBe(builtin);
    expect(sameContentNewGeneration).toEqual(builtin);
    expect(read()).toBe(sameContentNewGeneration);

    setActiveWorldContent({
      ...BUILTIN_WORLD,
      services: {
        ...BUILTIN_WORLD.services,
        mailboxes: [{ x: 21, z: 22 }],
        noticeboards: [],
      },
    });
    const custom = read();
    expect(custom).not.toBe(sameContentNewGeneration);
    expect(custom).toEqual([{ kind: 'mailbox', x: 21, z: 22 }]);
    expect(read()).toBe(custom);

    setActiveWorldContent(BUILTIN_WORLD);
    const restored = read();
    expect(restored).not.toBe(sameContentNewGeneration);
    expect(restored).not.toBe(custom);
  });

  it('keeps cache identity local to each reader', () => {
    const firstReader: CivicServicePlacementsReader = createCivicServicePlacementsReader();
    const secondReader: CivicServicePlacementsReader = createCivicServicePlacementsReader();

    expect(firstReader).not.toBe(secondReader);
    const first = firstReader();
    const second = secondReader();

    expect(first).not.toBe(second);
    expect(firstReader()).toBe(first);
    expect(secondReader()).toBe(second);
  });

  it('lazily gives each constructor-skipping bare ClientWorld its own reader', () => {
    const firstClient = bareClient(1);
    const secondClient = bareClient(2);

    const first = firstClient.civicServicePlacements;
    const second = secondClient.civicServicePlacements;

    expect(first).toEqual(
      buildCivicServicePlacements(
        BUILTIN_WORLD.services?.mailboxes ?? [],
        BUILTIN_WORLD.services?.noticeboards ?? [],
      ),
    );
    expect(first).not.toBe(second);
    expect(firstClient.civicServicePlacements).toBe(first);
    expect(secondClient.civicServicePlacements).toBe(second);
  });
});
