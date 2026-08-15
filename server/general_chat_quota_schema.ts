import { GENERAL_CHAT_QUOTA_ADVISORY_NAMESPACE } from './general_chat_quota_config';

export const GENERAL_CHAT_QUOTA_SCHEMA = `
CREATE TABLE IF NOT EXISTS account_general_chat_rate_limits (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  messages INT NOT NULL CHECK (messages BETWEEN 1 AND 1000),
  window_minutes INT NOT NULL CHECK (window_minutes BETWEEN 1 AND 1440),
  window_started_at TIMESTAMPTZ,
  message_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_general_chat_rate_limits_count_check
    CHECK (message_count BETWEEN 0 AND messages),
  CONSTRAINT account_general_chat_rate_limits_window_check
    CHECK ((window_started_at IS NULL AND message_count = 0) OR
           (window_started_at IS NOT NULL AND message_count >= 1))
);
ALTER TABLE account_moderation_actions
  ADD COLUMN IF NOT EXISTS general_chat_rate_limit_before JSONB;
ALTER TABLE account_moderation_actions
  ADD COLUMN IF NOT EXISTS general_chat_rate_limit_after JSONB;
CREATE OR REPLACE FUNCTION consume_account_general_chat_quota(p_account_id INT)
RETURNS TABLE (allowed BOOLEAN, retry_after_seconds INT)
LANGUAGE plpgsql
VOLATILE
AS $quota$
DECLARE
  policy account_general_chat_rate_limits%ROWTYPE;
  now_at TIMESTAMPTZ;
  affected_rows INT;
BEGIN
  -- This is deliberately a separate command inside a VOLATILE function. Under
  -- READ COMMITTED, the SELECT below receives a fresh post-lock snapshot; a CTE
  -- lock inside the caller statement would retain its stale statement snapshot.
  PERFORM pg_advisory_xact_lock(${GENERAL_CHAT_QUOTA_ADVISORY_NAMESPACE}, p_account_id);
  SELECT * INTO policy
  FROM account_general_chat_rate_limits
  WHERE account_id = p_account_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  now_at := clock_timestamp();
  IF policy.window_started_at IS NULL OR
     now_at >= policy.window_started_at + make_interval(mins => policy.window_minutes) THEN
    UPDATE account_general_chat_rate_limits
    SET window_started_at = now_at, message_count = 1
    WHERE account_id = p_account_id;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION 'general chat quota policy disappeared during consume';
    END IF;
    allowed := TRUE;
    retry_after_seconds := 0;
  ELSIF policy.message_count < policy.messages THEN
    UPDATE account_general_chat_rate_limits
    SET message_count = message_count + 1
    WHERE account_id = p_account_id;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION 'general chat quota policy disappeared during consume';
    END IF;
    allowed := TRUE;
    retry_after_seconds := 0;
  ELSE
    -- Denial takes only the advisory lock: no tuple lock, heap update, or WAL.
    allowed := FALSE;
    retry_after_seconds := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
      policy.window_started_at + make_interval(mins => policy.window_minutes) - now_at
    )))::INT);
  END IF;
  RETURN NEXT;
END
$quota$;
`;
