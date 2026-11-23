// Account registration and optional immutable referral attribution share one commit.
import { validCharName } from './auth';
import { cleanMetadataText } from './clean_metadata_text';
import {
  buildCommunityTestCharacters,
  communityTestAccountsEnabled,
  GENERATED_NAME_ATTEMPTS,
  generatedTestCharacterName,
  prepareCommunityTestCharacters,
} from './community_test_accounts';
import { type AccountRow, pool, type RequestMetadata } from './db';
import { backendCancelViaPool, createDbTransactionDeadline } from './db_transaction_deadline';
import { enqueueLinkChange } from './discord_link_changes';
import { REALM } from './realm';
import { type ReferralSignup, recordReferralOnClient } from './referral_armour_db';

export async function createAccount(
  username: string,
  passwordHash: string,
  meta: RequestMetadata = {},
  // passwordSet=false marks an account whose password is a placeholder the owner
  // never chose (a Discord-provisioned account). Defaults TRUE for every normal
  // (register / portal) signup so nothing changes for them.
  opts: { passwordSet?: boolean; referral?: ReferralSignup | null } = {},
): Promise<AccountRow> {
  const values = [
    username,
    passwordHash,
    cleanMetadataText(meta.ip, 128),
    cleanMetadataText(meta.userAgent, 512),
    opts.passwordSet ?? true,
  ];
  const insertAccount = `INSERT INTO accounts (username, password_hash, created_ip, created_user_agent, password_set)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, password_hash`;
  const community = communityTestAccountsEnabled();
  if (!community && !opts.referral) {
    const res = await pool.query(insertAccount, values);
    return res.rows[0];
  }

  // Sim construction and canonical equipment serialization are CPU work, so
  // warm the immutable templates before opening a database transaction.
  if (community) prepareCommunityTestCharacters();
  const raw = await pool.connect();
  const client = createDbTransactionDeadline(raw, {
    operation: 'referred registration',
    timeoutMs: 10_000,
    cancelBackend: backendCancelViaPool(pool),
  });
  try {
    await client.query('BEGIN');
    await client.query(
      "SET LOCAL statement_timeout = '5s'; SET LOCAL lock_timeout = '2s'; SET LOCAL idle_in_transaction_session_timeout = '5s'",
    );
    const res = await client.query(insertAccount, values);
    const account = res.rows[0] as AccountRow | undefined;
    if (!account) throw new Error('account insert returned no row');
    if (opts.referral) await recordReferralOnClient(client, account.id, opts.referral);

    for (const character of community ? buildCommunityTestCharacters(account.id) : []) {
      let inserted = false;
      for (let attempt = 0; attempt < GENERATED_NAME_ATTEMPTS; attempt++) {
        const name = generatedTestCharacterName(account.id, character.cls, attempt);
        if (!validCharName(name)) continue;
        const characterResult = await client.query(
          `INSERT INTO characters (account_id, name, class, realm, level, state)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [
            account.id,
            name,
            character.cls,
            REALM,
            character.state.level,
            JSON.stringify(character.state),
          ],
        );
        if ((characterResult.rowCount ?? 0) > 0) {
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        throw new Error(`failed to reserve a community test name for ${character.cls}`);
      }
    }
    await client.commit();
    // The roster is inserted at its authored level, so the account has a top
    // character from this moment. After COMMIT only: a rolled-back provisioning
    // transaction inserted nothing and must not enqueue.
    if (community) enqueueLinkChange({ accountId: account.id, kinds: ['flex'] }, Date.now());
    return account;
  } catch (err) {
    await client.rollback();
    throw err;
  } finally {
    client.release();
  }
}
