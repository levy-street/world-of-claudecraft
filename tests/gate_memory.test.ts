import { describe, expect, it } from 'vitest';
import {
  parseDarwinAvailableMemory,
  resolveAvailableMemoryBytes,
} from '../scripts/lib/gate_memory.mjs';
import { computeGateWorkers } from '../scripts/lib/gate_workers.mjs';

const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;

// Verbatim shape of `vm_stat` on macOS 15 (16 KiB pages, Apple silicon), trimmed to the
// lines the parser reads plus a few it must ignore. Pinned as a literal because the
// label text and the trailing period are the contract being parsed.
const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               64722.
Pages active:                            372691.
Pages inactive:                          367677.
Pages speculative:                         3135.
Pages throttled:                              0.
Pages wired down:                        331714.
Pages purgeable:                             27.
"Translation faults":                 987654321.
Pages copy-on-write:                   12345678.
File-backed pages:                       220342.
Anonymous pages:                         523161.
`;

// free + inactive + speculative, at 16 KiB per page. Purgeable and file-backed are
// excluded on purpose: each is already counted in the active or inactive queues.
const VM_STAT_AVAILABLE = (64722 + 367677 + 3135) * 16384;

describe('parseDarwinAvailableMemory', () => {
  it('sums the reclaimable page classes at the reported page size', () => {
    expect(parseDarwinAvailableMemory(VM_STAT)).toBe(VM_STAT_AVAILABLE);
  });

  it('excludes file-backed and purgeable pages, which are already counted elsewhere', () => {
    // Both classes also sit in the active or inactive queues, so summing them would
    // double count and over-provision workers, the exact way to reach the swapping the
    // clamp exists to prevent. Pinned against the exact inflated totals, not a range.
    const withFileBacked = (64722 + 367677 + 3135 + 220342) * 16384;
    const withPurgeable = (64722 + 367677 + 3135 + 27) * 16384;
    expect(parseDarwinAvailableMemory(VM_STAT)).not.toBe(withFileBacked);
    expect(parseDarwinAvailableMemory(VM_STAT)).not.toBe(withPurgeable);
    expect(parseDarwinAvailableMemory(VM_STAT)).toBeLessThan(withPurgeable);
  });

  it('ignores active, wired, and throttled pages, which are not available', () => {
    const everything = (64722 + 372691 + 367677 + 3135 + 331714 + 27) * 16384;
    expect(parseDarwinAvailableMemory(VM_STAT)).toBeLessThan(everything);
  });

  it('honors a different page size', () => {
    const fourKiB = VM_STAT.replace('page size of 16384 bytes', 'page size of 4096 bytes');
    expect(parseDarwinAvailableMemory(fourKiB)).toBe(VM_STAT_AVAILABLE / 4);
  });

  it('treats an omitted optional line as zero rather than failing the whole parse', () => {
    const noSpeculative = VM_STAT.split('\n')
      .filter((l) => !l.startsWith('Pages speculative:'))
      .join('\n');
    expect(parseDarwinAvailableMemory(noSpeculative)).toBe(VM_STAT_AVAILABLE - 3135 * 16384);
  });

  it('returns null when the page size is missing, so the caller keeps os.freemem()', () => {
    expect(parseDarwinAvailableMemory('Pages free: 64722.\n')).toBeNull();
  });

  it('returns null when the free-page line is missing', () => {
    const noFree = VM_STAT.split('\n')
      .filter((l) => !l.startsWith('Pages free:'))
      .join('\n');
    expect(parseDarwinAvailableMemory(noFree)).toBeNull();
  });

  it('returns null on absent, empty, or non-string input', () => {
    expect(parseDarwinAvailableMemory(null)).toBeNull();
    expect(parseDarwinAvailableMemory(undefined)).toBeNull();
    expect(parseDarwinAvailableMemory('')).toBeNull();
    expect(parseDarwinAvailableMemory('   ')).toBeNull();
    expect(parseDarwinAvailableMemory(42 as unknown as string)).toBeNull();
  });
});

describe('resolveAvailableMemoryBytes', () => {
  it('passes os.freemem() straight through on linux and win32', () => {
    for (const platform of ['linux', 'win32', 'freebsd']) {
      expect(
        resolveAvailableMemoryBytes({
          platform,
          freeMemBytes: 3 * GIB,
          readVmStat: () => VM_STAT, // never consulted off darwin
        }),
      ).toBe(3 * GIB);
    }
  });

  it('uses the vm_stat figure on darwin when it beats the reported free memory', () => {
    expect(
      resolveAvailableMemoryBytes({
        platform: 'darwin',
        freeMemBytes: 1.47 * GIB, // what os.freemem() reported on the machine that hit this
        readVmStat: () => VM_STAT,
      }),
    ).toBe(VM_STAT_AVAILABLE);
  });

  it('never reports less than os.freemem(), so the sensor only ever widens', () => {
    expect(
      resolveAvailableMemoryBytes({
        platform: 'darwin',
        freeMemBytes: 64 * GIB,
        readVmStat: () => VM_STAT,
      }),
    ).toBe(64 * GIB);
  });

  it('falls back to os.freemem() when vm_stat is unparseable', () => {
    expect(
      resolveAvailableMemoryBytes({
        platform: 'darwin',
        freeMemBytes: 2 * GIB,
        readVmStat: () => 'not vm_stat output',
      }),
    ).toBe(2 * GIB);
  });

  it('falls back to os.freemem() when the reader throws or returns null', () => {
    expect(
      resolveAvailableMemoryBytes({
        platform: 'darwin',
        freeMemBytes: 2 * GIB,
        readVmStat: () => {
          throw new Error('vm_stat: command not found');
        },
      }),
    ).toBe(2 * GIB);
    expect(
      resolveAvailableMemoryBytes({
        platform: 'darwin',
        freeMemBytes: 2 * GIB,
        readVmStat: () => null,
      }),
    ).toBe(2 * GIB);
  });
});

describe('the macOS single-worker collapse this fixes', () => {
  // Regression pin for the observed case: a 14-core / 26 GB Mac, up 27 days, running four
  // worktree gates. os.freemem() said 1.47 GB, so the clamp allowed ONE worker and the full
  // suite ran serially; vm_stat showed the machine was not under pressure at all.
  const OBSERVED_FREEMEM = 1.47 * GIB;

  it('collapsed to a single worker on the raw os.freemem() reading', () => {
    expect(
      computeGateWorkers({ cpuCount: 14, freeMemBytes: OBSERVED_FREEMEM, envOverride: undefined }),
    ).toBe(1);
  });

  it('restores the CPU bound once availability is measured properly', () => {
    const available = resolveAvailableMemoryBytes({
      platform: 'darwin',
      freeMemBytes: OBSERVED_FREEMEM,
      readVmStat: () => VM_STAT,
    });
    expect(
      computeGateWorkers({ cpuCount: 14, freeMemBytes: available, envOverride: undefined }),
    ).toBe(7);
  });

  it('still clamps below the CPU bound when the machine is genuinely tight', () => {
    // A real squeeze: vm_stat itself reports only ~1.5 GiB reclaimable, so the clamp holds
    // and the fix cannot paper over actual memory pressure.
    const tight = VM_STAT.replace(
      'Pages free:                               64722.',
      'Pages free:                                   0.',
    )
      .replace(
        'Pages inactive:                          367677.',
        'Pages inactive:                           98304.',
      )
      .replace(
        'Pages speculative:                         3135.',
        'Pages speculative:                            0.',
      );
    const available = resolveAvailableMemoryBytes({
      platform: 'darwin',
      freeMemBytes: 100 * MIB,
      readVmStat: () => tight,
    });
    expect(available).toBe(98304 * 16384); // 1.5 GiB
    expect(
      computeGateWorkers({ cpuCount: 14, freeMemBytes: available, envOverride: undefined }),
    ).toBe(2);
  });
});
