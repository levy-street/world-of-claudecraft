// Authored guild-signpost listings, keyed by NoticeboardDef id
// (content/noticeboards.ts), NOT templateId, which Eastbrook's board shares
// with the island's. A board with an entry here raises the noticeboard
// event's 'listings' arm (types.ts NoticeboardListing) instead of 'empty';
// guild names and notes are world data the client splices verbatim, never
// translation keys. Production ships this table EMPTY: every board reads
// "nothing posted" until a real posting system fills it, and test servers
// can overlay dummy rows here (any such rows are removed before merge).

import type { NoticeboardListing } from '../types';

export const NOTICEBOARD_LISTINGS: Readonly<Record<string, readonly NoticeboardListing[]>> = {};
