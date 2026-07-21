// An in-house, pino-shaped structured JSON logger for the API request pipeline.
// No dependency (pino is deliberately forbidden here); it
// is a thin facade over process.stdout / process.stderr that writes EXACTLY ONE
// JSON object per line.
//
// Shape of every emitted record: { level, time (epoch ms), msg, reqId, ...child
// bindings, ...call fields }. reqId is read from the request-scoped
// AsyncLocalStorage (context.currentReqId) AT EMIT TIME and OMITTED when there is
// no ambient request. The whole record passes through redact() before
// JSON.stringify, so a secret in a bound field or a caller's fields can never reach
// the log. info goes to stdout; warn and error go to stderr.
//
// The logger NEVER throws: a logging failure (a circular structure redact could not
// break, a serializer error) is swallowed so it can never crash the request path.
// The transport is injectable (createLogger({ out, err })) for deterministic tests;
// the default exported singleton is bound to the process streams.
//
// Convention: never log raw req.url, req.headers, or a request body; pass
// hand-picked fields instead. The string-level redaction rules only cover
// Bearer + 64-hex shapes, so a raw URL or header blob carrying a non-hex secret
// (a PKCE code_verifier, a base32 TOTP secret, an OAuth state) relies on the
// caller not logging it wholesale (guarded by
// tests/server/http/logger_call_hygiene.test.ts). Pass an Error as a TOP-LEVEL
// field ({ err }): serializeErrors flattens only top-level Error values to
// { message, stack }; a NESTED Error serializes via its enumerable props
// instead, and a driver error's enumerable extras (a pg DatabaseError's
// `detail`) can carry row values the redactor's needles do not cover.

import { currentReqId } from './context';
import { redact } from './redact';

/** A structured log line's fields: child bindings or per-call fields. */
export type LogFields = Record<string, unknown>;

/** The severities this logger emits; info to stdout, warn/error to stderr. */
type LogLevel = 'info' | 'warn' | 'error';

/**
 * A pino-shaped structured logger. Each level method accepts pino's argument
 * order: either a bare message, or a fields object followed by the message.
 */
export interface Logger {
  info(msg: string): void;
  info(fields: LogFields, msg: string): void;
  warn(msg: string): void;
  warn(fields: LogFields, msg: string): void;
  error(msg: string): void;
  error(fields: LogFields, msg: string): void;
  /** Return a child logger that merges `bindings` into every line it emits. */
  child(bindings: LogFields): Logger;
}

/** The per-line write sink. `out` receives info lines; `err` receives warn/error. */
export interface LoggerOptions {
  /** Where info lines go; the line is the JSON record WITHOUT a trailing newline. */
  out?: (line: string) => void;
  /** Where warn/error lines go; the line is the JSON record WITHOUT a trailing newline. */
  err?: (line: string) => void;
}

/** Serialize an Error value to a plain { message, stack } so it survives JSON.stringify. */
function serializeErrors(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, val] of Object.entries(fields)) {
    out[key] = val instanceof Error ? { message: val.message, stack: val.stack } : val;
  }
  return out;
}

/** JSON.stringify replacer: bigint has no JSON form, so render it as a decimal string. */
function stringifyReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** Normalize pino's (msg) | (fields, msg) call shape into a [fields, msg] pair. */
function normalizeArgs(fieldsOrMsg: LogFields | string, maybeMsg?: string): [LogFields, string] {
  if (typeof fieldsOrMsg === 'string') return [{}, fieldsOrMsg];
  return [fieldsOrMsg, maybeMsg ?? ''];
}

/**
 * Build one JSON line and hand it to `write`. Reads the ambient reqId at emit time
 * and omits the key when there is no request. Never throws: a serialization failure
 * is swallowed so logging cannot break the request path.
 */
function emit(
  write: (line: string) => void,
  level: LogLevel,
  bindings: LogFields,
  fieldsOrMsg: LogFields | string,
  maybeMsg: string | undefined,
): void {
  try {
    const [fields, msg] = normalizeArgs(fieldsOrMsg, maybeMsg);
    const reqId = currentReqId();
    const record: Record<string, unknown> = {
      level,
      time: Date.now(),
      msg,
      ...(reqId !== undefined ? { reqId } : {}),
      ...bindings,
      ...serializeErrors(fields),
    };
    write(JSON.stringify(redact(record), stringifyReplacer));
  } catch {
    // A logger must never throw out into the request path; drop the line instead.
  }
}

/** The default process-stream transport: append the newline the streams expect. */
const defaultOptions: Required<LoggerOptions> = {
  out: (line: string) => void process.stdout.write(`${line}\n`),
  err: (line: string) => void process.stderr.write(`${line}\n`),
};

/** Build a Logger over `out`/`err` that carries the accumulated child `bindings`. */
function build(
  out: (line: string) => void,
  err: (line: string) => void,
  bindings: LogFields,
): Logger {
  return {
    info: (fieldsOrMsg: LogFields | string, maybeMsg?: string) =>
      emit(out, 'info', bindings, fieldsOrMsg, maybeMsg),
    warn: (fieldsOrMsg: LogFields | string, maybeMsg?: string) =>
      emit(err, 'warn', bindings, fieldsOrMsg, maybeMsg),
    error: (fieldsOrMsg: LogFields | string, maybeMsg?: string) =>
      emit(err, 'error', bindings, fieldsOrMsg, maybeMsg),
    child: (extra: LogFields) => build(out, err, { ...bindings, ...extra }),
  };
}

/** Create a Logger with an injectable transport (defaults to the process streams). */
export function createLogger(opts: LoggerOptions = {}): Logger {
  return build(opts.out ?? defaultOptions.out, opts.err ?? defaultOptions.err, {});
}

/** The default process-bound logger singleton. */
export const logger: Logger = createLogger();
