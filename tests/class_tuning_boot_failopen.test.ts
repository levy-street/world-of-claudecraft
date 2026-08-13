// The boot install's fail-open guard, in its own file because it mocks the
// sim tuning barrel: installClassTuning is forced to throw, which no document
// reaching it through the sanitizer can do, so this pins the LAST line of
// defense behind the reserved-id gate and the Object.hasOwn lookups.
// installRealmClassTuning sits before the first GameServer, so an unguarded
// throw here rejects startServer on EVERY restart until the stored row is
// hand-edited out of Postgres. Paired module: server/class_tuning.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  loadClassTuning: vi.fn(),
  saveClassTuningChange: vi.fn(),
  listClassTuningHistory: vi.fn(),
}));

vi.mock('../server/class_tuning_db', () => ({
  loadClassTuning: dbMocks.loadClassTuning,
  saveClassTuningChange: dbMocks.saveClassTuningChange,
  listClassTuningHistory: dbMocks.listClassTuningHistory,
}));

const installMock = vi.hoisted(() => ({ fail: false }));

vi.mock('../src/sim/tuning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sim/tuning')>();
  return {
    ...actual,
    installClassTuning: (input: unknown) => {
      if (installMock.fail) throw new Error('walker exploded');
      return actual.installClassTuning(input);
    },
  };
});

import { installRealmClassTuning, resetClassTuningRuntimeForTests } from '../server/class_tuning';
import { ABILITIES } from '../src/sim/content/classes';
// straight from the leaf modules, past the mocked barrel, so cleanup uses the
// REAL install
import { emptyClassTuningDocument } from '../src/sim/tuning/document';
import { installClassTuning } from '../src/sim/tuning/install';

beforeEach(() => {
  dbMocks.loadClassTuning.mockReset();
  installMock.fail = false;
  resetClassTuningRuntimeForTests();
});

afterEach(() => {
  installMock.fail = false;
  installClassTuning(emptyClassTuningDocument());
  resetClassTuningRuntimeForTests();
});

describe('the boot install fail-open guard', () => {
  it('boots on the shipped numbers when the install itself throws', async () => {
    const shipped = ABILITIES.thorns;
    dbMocks.loadClassTuning.mockResolvedValue({
      data: { version: 1, abilities: { thorns: { damage_reflect: 2 } } },
      updatedAt: '2026-08-01T00:00:00.000Z',
      updatedBy: 7,
    });
    installMock.fail = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const state = await installRealmClassTuning();
      // the realm is up, untuned, and honest about the drift
      expect(state.active.abilities).toEqual({});
      expect(state.saved.abilities.thorns).toEqual({ damage_reflect: 2 });
      expect(state.pendingRestart).toBe(true);
      expect(ABILITIES.thorns).toBe(shipped);
      expect(errorSpy).toHaveBeenCalledWith(
        'failed to install class tuning; booting on the shipped numbers:',
        expect.any(Error),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
