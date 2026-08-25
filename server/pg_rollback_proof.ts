// Classifies a THROWN database error by what it proves about the transaction
// it interrupted. Deliberately dependency-free (it only reads err.code), so
// the service layer can consult it for compensation decisions without
// importing the pg-backed db module (whose load reads DATABASE_URL).
//
// The question is one-directional: may the caller COMPENSATE (e.g. restore an
// escrowed copy to the live bags) because the transaction provably rolled
// back? Only a statement-level SQLSTATE from a class that aborts before
// COMMIT proves that. Everything else is treated as ambiguous, including
// shapes that merely LOOK like SQLSTATEs: Node socket errnos (EPIPE, EBADF,
// EBUSY) are five characters of [A-Z] too, and EPIPE is precisely the
// write-to-a-dead-socket case where a COMMIT may have reached the server. So
// this is an ALLOWLIST of proven-abort classes, never a shape check with
// exclusions: an unknown code fails toward ambiguity, and ambiguity parks.
const ROLLBACK_PROOF_CLASSES = new Set([
  '22', // data exception
  '23', // integrity constraint violation (23505 and friends)
  '25', // invalid transaction state (25P03 idle-in-transaction kill)
  '40', // transaction rollback (40P01 deadlock victim)
  '42', // syntax error or access rule violation
  '53', // insufficient resources
  '54', // program limit exceeded
  '55', // object not in prerequisite state (55P03 lock_timeout)
]);

export function throwProvedRollback(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  if (typeof code !== 'string' || !/^[0-9A-Z]{5}$/.test(code)) return false;
  // 57014 (query_canceled: our own statement_timeout) aborts the statement
  // and with it the transaction; its class siblings 57P01/57P02 are server
  // shutdowns whose in-flight COMMIT outcome is unknowable, so the class is
  // not allowlisted wholesale.
  if (code === '57014') return true;
  // 40003 statement_completion_unknown is the one member of class 40 that
  // MEANS the ambiguity this module refuses: core Postgres never raises it,
  // but a pooler or proxy can, and it must park, not restore.
  if (code === '40003') return false;
  return ROLLBACK_PROOF_CLASSES.has(code.slice(0, 2));
}
