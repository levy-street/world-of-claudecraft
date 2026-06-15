import { describe, expect, it, vi } from 'vitest';
import { resolveReportTarget } from '../server/report_target';

describe('report target resolution', () => {
  it('resolves chat reports by server-side character name', async () => {
    const target = { accountId: 22, characterId: 44, characterName: 'Badmage' };
    const findCharacterReportTargetByName = vi.fn().mockResolvedValue(target);

    await expect(resolveReportTarget(
      { targetCharacterName: ' Badmage ' },
      { reportTargetForPid: vi.fn(), findCharacterReportTargetByName },
    )).resolves.toEqual({ ok: true, target });

    expect(findCharacterReportTargetByName).toHaveBeenCalledWith('Badmage');
  });

  it('keeps live pid reports for world right-click actions', async () => {
    const target = { accountId: 22, characterId: 44, characterName: 'Badmage' };
    const reportTargetForPid = vi.fn().mockReturnValue(target);

    await expect(resolveReportTarget(
      { targetPid: 123 },
      { reportTargetForPid, findCharacterReportTargetByName: vi.fn() },
    )).resolves.toEqual({ ok: true, target });

    expect(reportTargetForPid).toHaveBeenCalledWith(123);
  });

  it('rejects unknown chat names without trusting client-supplied ids', async () => {
    await expect(resolveReportTarget(
      { targetCharacterName: 'Nobody', targetAccountId: 999, targetCharacterId: 888 },
      { reportTargetForPid: vi.fn(), findCharacterReportTargetByName: vi.fn().mockResolvedValue(null) },
    )).resolves.toEqual({ ok: false, status: 404, error: 'that player could not be found' });
  });

  it('falls back to name lookup when targetPid is null/empty rather than coercing to pid 0', async () => {
    const target = { accountId: 22, characterId: 44, characterName: 'Badmage' };
    const reportTargetForPid = vi.fn();
    const findCharacterReportTargetByName = vi.fn().mockResolvedValue(target);

    for (const targetPid of [null, '', [] as unknown]) {
      await expect(resolveReportTarget(
        { targetPid, targetCharacterName: 'Badmage' },
        { reportTargetForPid, findCharacterReportTargetByName },
      )).resolves.toEqual({ ok: true, target });
    }

    expect(reportTargetForPid).not.toHaveBeenCalled();
    expect(findCharacterReportTargetByName).toHaveBeenCalledWith('Badmage');
  });
});
