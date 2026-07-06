// A golden-master generator with no manual-approve step: deterministic
// write-then-compare. captureResponse runs a dispatcher through a FakeRes and
// returns the captured (status, headers, body) triple; goldenMaster captures +
// normalizes, then writes the fixture if absent ('written') or compares against
// it if present ('match' | 'mismatch'). It never prompts and never requires
// approval, so it is safe to run unattended in CI.
//
// A dispatcher is the frozen Dispatch contract: it writes to res and ends; the
// driver awaits the (possibly-Promise) return, then reads the captured triple.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type * as http from 'node:http';
import { dirname } from 'node:path';
import { FakeRes } from './fake_http';
import { type CapturedResponse, normalizeResponse, stableStringify } from './normalizer';

/**
 * A request dispatcher: writes the response to `res` and ends it. May be sync or
 * async; the driver awaits its return, then reads the captured response. A later
 * phase supplies a real dispatcher whose Promise resolves when the response ends;
 * the self-tests here use trivial fakes that write+end synchronously.
 */
export type Dispatch = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => Promise<void> | void;

/** Run `dispatch` through a FakeRes and return the captured response triple. */
export async function captureResponse(
  dispatch: Dispatch,
  req: http.IncomingMessage,
): Promise<CapturedResponse> {
  const res = new FakeRes();
  await dispatch(req, res as unknown as http.ServerResponse);
  return { status: res.statusCode, headers: res.headers, body: res.body };
}

export interface GoldenMasterOpts {
  dispatch: Dispatch;
  req: http.IncomingMessage;
  /** Where the fixture lives. Absent file -> write; present file -> compare. */
  fixturePath: string;
  /** Defaults to normalizeResponse; injectable so a caller can mask differently. */
  normalizer?: typeof normalizeResponse;
}

export interface GoldenMasterResult {
  status: 'written' | 'match' | 'mismatch';
  /** The on-disk fixture text (present for 'match' and 'mismatch'). */
  expected?: string;
  /** The freshly captured + normalized + serialized text. */
  actual?: string;
}

const FIXTURE_INDENT = 2;

/**
 * Capture + normalize the dispatcher's response, then: if the fixture file is
 * ABSENT, write it and return 'written'; if PRESENT, compare and return 'match'
 * or 'mismatch' (with both texts). Deterministic and approval-free.
 */
export async function goldenMaster(opts: GoldenMasterOpts): Promise<GoldenMasterResult> {
  const normalize = opts.normalizer ?? normalizeResponse;
  const captured = await captureResponse(opts.dispatch, opts.req);
  const actual = stableStringify(normalize(captured), FIXTURE_INDENT);

  if (!existsSync(opts.fixturePath)) {
    mkdirSync(dirname(opts.fixturePath), { recursive: true });
    writeFileSync(opts.fixturePath, actual, 'utf8');
    return { status: 'written', actual };
  }

  const expected = readFileSync(opts.fixturePath, 'utf8');
  return { status: expected === actual ? 'match' : 'mismatch', expected, actual };
}
