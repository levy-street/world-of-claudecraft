// The admin family's load-failure verdict, one rule in one place.
//
// Every data surface here (page or panel) already had a boolean "the read
// failed" flag whose only rendering was that surface's generic
// `<domain>.loadFailed` line. That collapsed the one failure an operator can
// act on, a 403, into the same panel as a 500 or a dropped connection: the
// dashboard said "failed to load top holders" when the honest answer was
// "your roles do not carry the permission this view reads". The server has
// always distinguished them (server/admin_routes.ts is a fail-closed
// route-to-permission map, and a missing permission answers 403 with
// `you do not have permission to do this`), so the information was there and
// only the client discarded it.
//
// 403 and 401 are deliberately NOT symmetric. A 401 means the session is gone
// and `auth.handleAuthFailure` logs the operator out before any surface sees
// the error, so a 401 never reaches this classifier in the live app (the arm
// below is a backstop, not a path). A 403 means authenticated-but-unpermitted
// and must stay inline, never a logout: see the auth model in
// src/admin/CLAUDE.md.
//
// Pure and DOM-free on purpose, so the verdict is unit-tested directly in the
// Node environment while the surfaces stay thin consumers.

import { ApiError } from './api';

/** The tri-state every admin data surface holds: quiet, or one of two verdicts. */
export const ADMIN_LOAD_FAILURES = ['none', 'forbidden', 'error'] as const;

export type AdminLoadFailure = (typeof ADMIN_LOAD_FAILURES)[number];

/**
 * The verdict for a caught read failure. Always a FAILURE ('forbidden' or
 * 'error'), never the quiet 'none': callers render on `!== 'none'`, so a
 * classifier that could answer 'none' would silently swallow the panel.
 *
 * The class, not the shape, is the contract: only a real `ApiError` carrying
 * 403 is a permission verdict. Anything else (a transport TypeError from a
 * rejected fetch, a thrown string, a plain object with a 403-looking field) is
 * a generic error, because nothing about it says the operator lacks a
 * permission.
 */
export function classifyAdminLoadFailure(err: unknown): Exclude<AdminLoadFailure, 'none'> {
  return err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error';
}
