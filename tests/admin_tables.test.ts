import { describe, expect, it } from 'vitest';
import { renderModerationDetail, renderModerationQueue } from '../src/admin/tables';
import type { ModerationAccountDetail, ModerationQueueRow } from '../src/admin/types';

function accountDetail() {
  return {
    id: 9,
    username: 'badactor',
    createdAt: '2026-06-01T00:00:00Z',
    lastLogin: null,
    isAdmin: false,
    playtimeSeconds: 0,
    characters: [],
    recentSessions: [],
  };
}

describe('admin moderation tables', () => {
  it('renders system report-abuse queue rows and detail evidence', () => {
    const queueRow: ModerationQueueRow = {
      accountId: 9,
      username: 'badactor',
      status: 'active',
      suspendedUntil: null,
      openReports: 1,
      latestReportAt: '2026-06-13T00:00:00Z',
      latestReason: 'report_abuse',
      latestSource: 'system',
      latestReportKind: 'report_abuse',
      maxAbuseScore: 140,
      abuseReasons: ['shared_ip_coordination'],
      characterNames: ['Badactor'],
      online: false,
    };

    const detail: ModerationAccountDetail = {
      account: accountDetail(),
      reports: [{
        id: 55,
        reason: 'report_abuse',
        details: 'Automated report-abuse alert for moderator review.',
        status: 'open',
        source: 'system',
        reportKind: 'report_abuse',
        evidence: {
          summary: 'Linked reporters submitted a same-target burst with shared report-abuse signals.',
          linkedReporterAccountIds: [9, 10, 11],
        },
        abuseScore: 140,
        abuseReasons: ['same_target_burst', 'shared_ip_coordination'],
        createdAt: '2026-06-13T00:00:00Z',
        reporterAccountId: null,
        reporterUsername: null,
        reporterCharacterId: null,
        reporterCharacterName: 'System',
        reportedAccountId: 9,
        reportedUsername: 'badactor',
        reportedCharacterId: 90,
        reportedCharacterName: 'Badactor',
        relatedEvents: [{
          id: 501,
          createdAt: '2026-06-13T00:00:00Z',
          outcome: 'accepted',
          reason: 'harassment',
          reporterAccountId: 9,
          reporterCharacterName: 'Badactor',
          targetAccountId: 2,
          targetCharacterName: 'Target',
          detailsHash: 'abc',
          detailsLength: 12,
          ipHash: 'def',
          userAgentHash: 'ghi',
          abuseScore: 140,
          abuseReasons: ['shared_ip_coordination'],
          evidence: {},
        }],
        chatContext: [],
      }],
    };

    expect(renderModerationQueue([queueRow])).toContain('System: report abuse');
    const html = renderModerationDetail(detail);
    expect(html).toContain('System: report abuse');
    expect(html).toContain('shared_ip_coordination');
    expect(html).toContain('Related report submissions');
    expect(html).toContain('Linked reporters submitted');
  });
});
