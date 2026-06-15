use pbkdf2::pbkdf2_hmac;
use serde::Serialize;
use sha2::{Digest, Sha256};
use spacetimedb::{
    client_visibility_filter, reducer, table, Filter, Identity, ReducerContext, Table,
    TimeDuration, Timestamp,
};

const REALM_NAME: &str = "Claudemoon";
const SESSION_TTL_MICROS: i64 = 7 * 24 * 60 * 60 * 1_000_000;
const SNAPSHOT_TTL_MICROS: i64 = 30_000_000;
const BRIDGE_AUTH_ID: u64 = 0;
const BRIDGE_SETUP_TOKEN_HASH: Option<&str> = option_env!("STDB_BRIDGE_SETUP_TOKEN_SHA256");
const PASSWORD_KDF_ITERS: u32 = 210_000;
const PASSWORD_HASH_BYTES: usize = 32;
const AUTH_WINDOW_MICROS: i64 = 60_000_000;
const AUTH_MAX_ATTEMPTS: u32 = 20;
const AUTH_FAIL_WINDOW_MICROS: i64 = 15 * 60 * 1_000_000;
const AUTH_MAX_FAILURES: u32 = 10;

#[client_visibility_filter]
const AUTH_STATE_OWNER: Filter = Filter::Sql("SELECT * FROM auth_state WHERE owner = :sender");
#[client_visibility_filter]
const CHARACTER_ROSTER_OWNER: Filter =
    Filter::Sql("SELECT * FROM character_roster WHERE owner = :sender");
#[client_visibility_filter]
const WORLD_SESSION_OWNER: Filter =
    Filter::Sql("SELECT * FROM world_session WHERE owner = :sender");
#[client_visibility_filter]
const SNAPSHOT_OWNER: Filter = Filter::Sql("SELECT * FROM world_snapshot WHERE owner = :sender");
#[client_visibility_filter]
const EVENT_OWNER: Filter = Filter::Sql("SELECT * FROM world_event WHERE owner = :sender");
#[client_visibility_filter]
const SOCIAL_OWNER: Filter = Filter::Sql("SELECT * FROM social_snapshot WHERE owner = :sender");
#[client_visibility_filter]
const BRIDGE_SESSION_OWNER: Filter =
    Filter::Sql("SELECT * FROM bridge_session WHERE bridge_owner = :sender");
#[client_visibility_filter]
const BRIDGE_INPUT_OWNER: Filter =
    Filter::Sql("SELECT * FROM bridge_input_state WHERE bridge_owner = :sender");
#[client_visibility_filter]
const BRIDGE_COMMAND_OWNER: Filter =
    Filter::Sql("SELECT * FROM bridge_client_command WHERE bridge_owner = :sender");
#[client_visibility_filter]
const BRIDGE_CHARACTER_OWNER: Filter =
    Filter::Sql("SELECT * FROM bridge_character_state WHERE bridge_owner = :sender");
#[client_visibility_filter]
const BRIDGE_WORLD_STATE_OWNER: Filter =
    Filter::Sql("SELECT * FROM bridge_world_state WHERE bridge_owner = :sender");
#[client_visibility_filter]
const BRIDGE_FRIEND_OWNER: Filter =
    Filter::Sql("SELECT * FROM bridge_friend_link WHERE bridge_owner = :sender");
#[client_visibility_filter]
const BRIDGE_BLOCK_OWNER: Filter =
    Filter::Sql("SELECT * FROM bridge_block_link WHERE bridge_owner = :sender");
#[client_visibility_filter]
const BRIDGE_GUILD_OWNER: Filter =
    Filter::Sql("SELECT * FROM bridge_guild WHERE bridge_owner = :sender");
#[client_visibility_filter]
const BRIDGE_GUILD_MEMBER_OWNER: Filter =
    Filter::Sql("SELECT * FROM bridge_guild_member WHERE bridge_owner = :sender");

#[derive(Clone)]
#[table(accessor = account, index(accessor = by_username, btree(columns = [username_key])))]
pub struct Account {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub username: String,
    pub username_key: String,
    pub password_salt: String,
    pub password_hash: String,
    pub created_at: Timestamp,
    pub is_admin: bool,
    pub banned: bool,
}

#[derive(Clone)]
#[table(accessor = auth_state, public)]
pub struct AuthState {
    #[primary_key]
    pub owner: Identity,
    pub account_id: u64,
    pub username: String,
    pub expires_at: Timestamp,
    pub error: String,
}

#[derive(Clone)]
#[table(
    accessor = character,
    index(accessor = by_account, btree(columns = [account_id])),
    index(accessor = by_name, btree(columns = [name_key]))
)]
pub struct Character {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub account_id: u64,
    pub name: String,
    pub name_key: String,
    pub class_name: String,
    pub level: u32,
    pub lifetime_xp: u64,
    pub prestige_rank: u32,
    pub state_json: String,
    pub online: bool,
    pub force_rename: bool,
    pub updated_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = character_directory, public, index(accessor = by_name, btree(columns = [name_key])))]
pub struct CharacterDirectory {
    #[primary_key]
    pub id: u64,
    pub name: String,
    pub name_key: String,
    pub class_name: String,
    pub level: u32,
    pub realm: String,
    pub lifetime_xp: u64,
    pub prestige_rank: u32,
    pub online: bool,
    pub force_rename: bool,
    pub updated_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = character_roster, public)]
pub struct CharacterRoster {
    #[primary_key]
    pub owner: Identity,
    pub account_id: u64,
    pub realm: String,
    pub characters_json: String,
    pub updated_at: Timestamp,
    pub error: String,
}

#[derive(Clone)]
#[table(
    accessor = world_session,
    public,
    index(accessor = by_character, btree(columns = [character_id])),
    index(accessor = by_owner, btree(columns = [owner]))
)]
pub struct WorldSession {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub account_id: u64,
    pub character_id: u64,
    pub player_id: u32,
    pub class_name: String,
    pub character_name: String,
    pub active: bool,
    pub bridge_attached: bool,
    pub started_at: Timestamp,
    pub updated_at: Timestamp,
    pub error: String,
}

#[derive(Clone)]
#[table(accessor = input_state, index(accessor = by_session, btree(columns = [session_id])))]
pub struct InputState {
    #[primary_key]
    pub session_id: u64,
    pub owner: Identity,
    pub forward: bool,
    pub back: bool,
    pub turn_left: bool,
    pub turn_right: bool,
    pub strafe_left: bool,
    pub strafe_right: bool,
    pub jump: bool,
    pub facing_valid: bool,
    pub facing: f32,
    pub updated_at: Timestamp,
}

#[derive(Clone)]
#[table(
    accessor = client_command,
    index(accessor = by_session, btree(columns = [session_id])),
    index(accessor = by_id, btree(columns = [id]))
)]
pub struct ClientCommand {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub session_id: u64,
    pub kind: String,
    pub payload_json: String,
    pub created_at: Timestamp,
    pub consumed: bool,
}

#[derive(Clone)]
#[table(accessor = world_snapshot, public, index(accessor = by_session, btree(columns = [session_id])))]
pub struct WorldSnapshot {
    #[primary_key]
    pub session_id: u64,
    pub owner: Identity,
    pub payload_json: String,
    pub updated_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = world_event, public, index(accessor = by_session, btree(columns = [session_id])))]
pub struct WorldEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub session_id: u64,
    pub payload_json: String,
    pub created_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = social_snapshot, public, index(accessor = by_session, btree(columns = [session_id])))]
pub struct SocialSnapshot {
    #[primary_key]
    pub session_id: u64,
    pub owner: Identity,
    pub payload_json: String,
    pub updated_at: Timestamp,
}

#[derive(Clone)]
#[table(
    accessor = player_report,
    index(accessor = by_reporter, btree(columns = [reporter_character_id])),
    index(accessor = by_target_name, btree(columns = [target_character_name]))
)]
pub struct PlayerReport {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub account_id: u64,
    pub reporter_character_id: u64,
    pub target_pid: u32,
    pub target_character_name: String,
    pub reason: String,
    pub details: String,
    pub status: String,
    pub created_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = bridge_heartbeat, public)]
pub struct BridgeHeartbeat {
    #[primary_key]
    pub id: u64,
    pub owner: Identity,
    pub online: bool,
    pub sessions: u32,
    pub tick: u64,
    pub updated_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = bridge_auth)]
pub struct BridgeAuth {
    #[primary_key]
    pub id: u64,
    pub owner: Identity,
    pub created_at: Timestamp,
}

#[derive(Serialize)]
struct CharacterRosterEntry {
    id: u64,
    name: String,
    #[serde(rename = "class")]
    class_name: String,
    level: u32,
    online: bool,
    #[serde(rename = "forceRename")]
    force_rename: bool,
}

#[derive(Clone)]
#[table(accessor = world_state)]
pub struct WorldState {
    #[primary_key]
    pub key: String,
    pub payload_json: String,
    pub updated_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = play_session, index(accessor = by_character, btree(columns = [character_id])))]
pub struct PlaySession {
    #[primary_key]
    pub id: u64,
    pub account_id: u64,
    pub character_id: u64,
    pub character_name: String,
    pub started_at: Timestamp,
    pub ended: bool,
    pub updated_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = chat_log, index(accessor = by_character, btree(columns = [character_id])))]
pub struct ChatLog {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub account_id: u64,
    pub character_id: u64,
    pub character_name: String,
    pub channel: String,
    pub message: String,
    pub created_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = friend_link, index(accessor = by_character, btree(columns = [character_id])), index(accessor = by_friend, btree(columns = [friend_id])))]
pub struct FriendLink {
    #[primary_key]
    pub key: String,
    pub character_id: u64,
    pub friend_id: u64,
    pub created_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = block_link, index(accessor = by_character, btree(columns = [character_id])))]
pub struct BlockLink {
    #[primary_key]
    pub key: String,
    pub character_id: u64,
    pub blocked_id: u64,
    pub created_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = guild, index(accessor = by_name, btree(columns = [name_key])))]
pub struct Guild {
    #[primary_key]
    pub id: u64,
    pub name: String,
    pub name_key: String,
    pub realm: String,
    pub created_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = guild_member, index(accessor = by_guild, btree(columns = [guild_id])))]
pub struct GuildMember {
    #[primary_key]
    pub character_id: u64,
    pub guild_id: u64,
    pub rank: String,
    pub joined_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = project_stats, public)]
pub struct ProjectStats {
    #[primary_key]
    pub id: u64,
    pub realm: String,
    pub accounts_created: u64,
    pub players_online: u32,
    pub updated_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = auth_attempt)]
pub struct AuthAttempt {
    #[primary_key]
    pub key: String,
    pub count: u32,
    pub window_started_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = auth_failure)]
pub struct AuthFailure {
    #[primary_key]
    pub username_key: String,
    pub count: u32,
    pub window_started_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = bridge_session, public, index(accessor = by_character, btree(columns = [character_id])))]
pub struct BridgeSession {
    #[primary_key]
    pub id: u64,
    pub bridge_owner: Identity,
    pub owner: Identity,
    pub account_id: u64,
    pub character_id: u64,
    pub player_id: u32,
    pub class_name: String,
    pub character_name: String,
    pub active: bool,
    pub bridge_attached: bool,
    pub started_at: Timestamp,
    pub updated_at: Timestamp,
    pub error: String,
}

#[derive(Clone)]
#[table(accessor = bridge_input_state, public, index(accessor = by_session, btree(columns = [session_id])))]
pub struct BridgeInputState {
    #[primary_key]
    pub session_id: u64,
    pub bridge_owner: Identity,
    pub forward: bool,
    pub back: bool,
    pub turn_left: bool,
    pub turn_right: bool,
    pub strafe_left: bool,
    pub strafe_right: bool,
    pub jump: bool,
    pub facing_valid: bool,
    pub facing: f32,
    pub updated_at: Timestamp,
}

#[derive(Clone)]
#[table(
    accessor = bridge_client_command,
    public,
    index(accessor = by_session, btree(columns = [session_id])),
    index(accessor = by_id, btree(columns = [id]))
)]
pub struct BridgeClientCommand {
    #[primary_key]
    pub id: u64,
    pub bridge_owner: Identity,
    pub owner: Identity,
    pub session_id: u64,
    pub kind: String,
    pub payload_json: String,
    pub created_at: Timestamp,
    pub consumed: bool,
}

#[derive(Clone)]
#[table(accessor = bridge_character_state, public, index(accessor = by_name, btree(columns = [name_key])))]
pub struct BridgeCharacterState {
    #[primary_key]
    pub id: u64,
    pub bridge_owner: Identity,
    pub account_id: u64,
    pub name: String,
    pub name_key: String,
    pub class_name: String,
    pub level: u32,
    pub lifetime_xp: u64,
    pub prestige_rank: u32,
    pub state_json: String,
    pub online: bool,
    pub force_rename: bool,
    pub updated_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = bridge_world_state, public)]
pub struct BridgeWorldState {
    #[primary_key]
    pub key: String,
    pub bridge_owner: Identity,
    pub payload_json: String,
    pub updated_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = bridge_friend_link, public, index(accessor = by_character, btree(columns = [character_id])), index(accessor = by_friend, btree(columns = [friend_id])))]
pub struct BridgeFriendLink {
    #[primary_key]
    pub key: String,
    pub bridge_owner: Identity,
    pub character_id: u64,
    pub friend_id: u64,
    pub created_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = bridge_block_link, public, index(accessor = by_character, btree(columns = [character_id])))]
pub struct BridgeBlockLink {
    #[primary_key]
    pub key: String,
    pub bridge_owner: Identity,
    pub character_id: u64,
    pub blocked_id: u64,
    pub created_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = bridge_guild, public, index(accessor = by_name, btree(columns = [name_key])))]
pub struct BridgeGuild {
    #[primary_key]
    pub id: u64,
    pub bridge_owner: Identity,
    pub name: String,
    pub name_key: String,
    pub realm: String,
    pub created_at: Timestamp,
}

#[derive(Clone)]
#[table(accessor = bridge_guild_member, public, index(accessor = by_guild, btree(columns = [guild_id])))]
pub struct BridgeGuildMember {
    #[primary_key]
    pub character_id: u64,
    pub bridge_owner: Identity,
    pub guild_id: u64,
    pub rank: String,
    pub joined_at: Timestamp,
}

#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    upsert_project_stats(ctx);
}

#[reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) {
    let sessions: Vec<WorldSession> = ctx
        .db
        .world_session()
        .iter()
        .filter(|s| s.owner == ctx.sender() && s.active)
        .collect();
    for mut session in sessions {
        session.active = false;
        session.updated_at = ctx.timestamp;
        ctx.db.world_session().id().update(session.clone());
        upsert_bridge_session(ctx, &session);
        if let Some(mut ch) = ctx.db.character().id().find(session.character_id) {
            ch.online = false;
            ch.updated_at = ctx.timestamp;
            ctx.db.character().id().update(ch.clone());
            upsert_character_views(ctx, &ch);
            upsert_roster_for_owner(ctx, ch.owner, ch.account_id, "");
        }
    }
    upsert_project_stats(ctx);
}

#[reducer]
pub fn register(ctx: &ReducerContext, username: String, password: String) -> Result<(), String> {
    check_auth_attempt(ctx)?;
    let username = clean_username(&username)?;
    let key = username.to_lowercase();
    if ctx.db.account().by_username().filter(&key).next().is_some() {
        write_auth_error(ctx, "username already exists");
        return Err("username already exists".into());
    }
    let password_salt = make_salt(ctx, &key);
    let password_hash = hash_password(&password_salt, &password)?;
    let account = ctx.db.account().insert(Account {
        id: 0,
        owner: ctx.sender(),
        username: username.clone(),
        username_key: key,
        password_salt,
        password_hash,
        created_at: ctx.timestamp,
        is_admin: false,
        banned: false,
    });
    write_auth_success(ctx, account.id, username);
    upsert_roster(ctx, account.id, "");
    upsert_project_stats(ctx);
    Ok(())
}

#[reducer]
pub fn login(ctx: &ReducerContext, username: String, password: String) -> Result<(), String> {
    check_auth_attempt(ctx)?;
    let key = username.trim().to_lowercase();
    if auth_fail_throttled(ctx, &key) {
        write_auth_error(ctx, "too many failed attempts");
        return Err("invalid username or password".into());
    }
    let Some(account) = ctx.db.account().by_username().filter(&key).next() else {
        record_auth_failure(ctx, &key);
        write_auth_error(ctx, "invalid username or password");
        return Err("invalid username or password".into());
    };
    if account.banned {
        write_auth_error(ctx, "account is banned");
        return Err("account is banned".into());
    }
    if hash_password(&account.password_salt, &password)? != account.password_hash {
        record_auth_failure(ctx, &key);
        write_auth_error(ctx, "invalid username or password");
        return Err("invalid username or password".into());
    }
    clear_auth_failure(ctx, &key);
    write_auth_success(ctx, account.id, account.username);
    upsert_roster(ctx, account.id, "");
    Ok(())
}

#[reducer]
pub fn list_characters(ctx: &ReducerContext) -> Result<(), String> {
    let account_id = require_account(ctx)?;
    upsert_roster(ctx, account_id, "");
    Ok(())
}

#[reducer]
pub fn create_character(
    ctx: &ReducerContext,
    name: String,
    class_name: String,
) -> Result<(), String> {
    let account_id = require_account(ctx)?;
    let name = clean_character_name(&name)?;
    let name_key = name.to_lowercase();
    if ctx
        .db
        .character()
        .by_name()
        .filter(&name_key)
        .next()
        .is_some()
    {
        upsert_roster(ctx, account_id, "name is already taken");
        return Err("name is already taken".into());
    }
    let class_name = clean_class(&class_name)?;
    let count = ctx.db.character().by_account().filter(account_id).count();
    if count >= 10 {
        upsert_roster(ctx, account_id, "character limit reached");
        return Err("character limit reached".into());
    }
    let ch = ctx.db.character().insert(Character {
        id: 0,
        owner: ctx.sender(),
        account_id,
        name,
        name_key,
        class_name,
        level: 1,
        lifetime_xp: 0,
        prestige_rank: 0,
        state_json: String::new(),
        online: false,
        force_rename: false,
        updated_at: ctx.timestamp,
    });
    upsert_character_views(ctx, &ch);
    upsert_roster(ctx, account_id, "");
    Ok(())
}

#[reducer]
pub fn rename_character(
    ctx: &ReducerContext,
    character_id: u64,
    name: String,
) -> Result<(), String> {
    let account_id = require_account(ctx)?;
    let name = clean_character_name(&name)?;
    let name_key = name.to_lowercase();
    if ctx
        .db
        .character()
        .by_name()
        .filter(&name_key)
        .any(|c| c.id != character_id)
    {
        upsert_roster(ctx, account_id, "name is already taken");
        return Err("name is already taken".into());
    }
    let Some(mut ch) = ctx.db.character().id().find(character_id) else {
        upsert_roster(ctx, account_id, "character not found");
        return Err("character not found".into());
    };
    if ch.account_id != account_id {
        return Err("character not found".into());
    }
    if ch.online {
        upsert_roster(ctx, account_id, "character is currently online");
        return Err("character is currently online".into());
    }
    ch.name = name;
    ch.name_key = name_key;
    ch.force_rename = false;
    ch.updated_at = ctx.timestamp;
    ctx.db.character().id().update(ch.clone());
    upsert_character_views(ctx, &ch);
    upsert_roster(ctx, account_id, "");
    Ok(())
}

#[reducer]
pub fn delete_character(
    ctx: &ReducerContext,
    character_id: u64,
    name: String,
) -> Result<(), String> {
    let account_id = require_account(ctx)?;
    let Some(ch) = ctx.db.character().id().find(character_id) else {
        upsert_roster(ctx, account_id, "character not found");
        return Err("character not found".into());
    };
    if ch.account_id != account_id || ch.name != name {
        upsert_roster(ctx, account_id, "character not found");
        return Err("character not found".into());
    }
    if ch.online {
        upsert_roster(ctx, account_id, "character is currently online");
        return Err("character is currently online".into());
    }
    ctx.db.character().id().delete(character_id);
    delete_character_views(ctx, character_id);
    upsert_roster(ctx, account_id, "");
    Ok(())
}

#[reducer]
pub fn enter_world(ctx: &ReducerContext, character_id: u64) -> Result<(), String> {
    let account_id = require_account(ctx)?;
    let Some(mut ch) = ctx.db.character().id().find(character_id) else {
        return Err("character not found".into());
    };
    if ch.account_id != account_id {
        return Err("character not found".into());
    }
    if ch.online {
        return Err("character already in world".into());
    }
    ch.online = true;
    ch.updated_at = ctx.timestamp;
    ctx.db.character().id().update(ch.clone());
    upsert_character_views(ctx, &ch);

    let existing: Vec<WorldSession> = ctx
        .db
        .world_session()
        .iter()
        .filter(|s| s.owner == ctx.sender() && s.active)
        .collect();
    for mut s in existing {
        s.active = false;
        s.updated_at = ctx.timestamp;
        ctx.db.world_session().id().update(s.clone());
        upsert_bridge_session(ctx, &s);
    }

    let session = ctx.db.world_session().insert(WorldSession {
        id: 0,
        owner: ctx.sender(),
        account_id,
        character_id,
        player_id: 0,
        class_name: ch.class_name,
        character_name: ch.name,
        active: true,
        bridge_attached: false,
        started_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        error: String::new(),
    });
    upsert_bridge_session(ctx, &session);
    upsert_roster(ctx, account_id, "");
    upsert_project_stats(ctx);
    Ok(())
}

#[reducer]
pub fn leave_world(ctx: &ReducerContext, session_id: u64) -> Result<(), String> {
    let account_id = require_account(ctx)?;
    let Some(mut session) = ctx.db.world_session().id().find(session_id) else {
        return Err("session not found".into());
    };
    if session.owner != ctx.sender() || session.account_id != account_id {
        return Err("session not found".into());
    }
    session.active = false;
    session.updated_at = ctx.timestamp;
    ctx.db.world_session().id().update(session.clone());
    upsert_bridge_session(ctx, &session);
    if let Some(mut ch) = ctx.db.character().id().find(session.character_id) {
        ch.online = false;
        ch.updated_at = ctx.timestamp;
        ctx.db.character().id().update(ch.clone());
        upsert_character_views(ctx, &ch);
    }
    upsert_roster(ctx, account_id, "");
    upsert_project_stats(ctx);
    Ok(())
}

#[reducer]
pub fn set_input(
    ctx: &ReducerContext,
    session_id: u64,
    forward: bool,
    back: bool,
    turn_left: bool,
    turn_right: bool,
    strafe_left: bool,
    strafe_right: bool,
    jump: bool,
    facing_valid: bool,
    facing: f32,
) -> Result<(), String> {
    let session = require_session(ctx, session_id)?;
    let row = InputState {
        session_id,
        owner: ctx.sender(),
        forward,
        back,
        turn_left,
        turn_right,
        strafe_left,
        strafe_right,
        jump,
        facing_valid,
        facing,
        updated_at: ctx.timestamp,
    };
    if ctx.db.input_state().session_id().find(session.id).is_some() {
        ctx.db.input_state().session_id().update(row.clone());
    } else {
        ctx.db.input_state().insert(row.clone());
    }
    upsert_bridge_input_state(ctx, &row);
    Ok(())
}

#[reducer]
pub fn command(
    ctx: &ReducerContext,
    session_id: u64,
    kind: String,
    payload_json: String,
) -> Result<(), String> {
    require_session(ctx, session_id)?;
    if kind.len() > 64 || payload_json.len() > 16 * 1024 {
        return Err("command too large".into());
    }
    let cmd = ctx.db.client_command().insert(ClientCommand {
        id: 0,
        owner: ctx.sender(),
        session_id,
        kind,
        payload_json,
        created_at: ctx.timestamp,
        consumed: false,
    });
    upsert_bridge_client_command(ctx, &cmd);
    Ok(())
}

#[reducer]
pub fn report_player(
    ctx: &ReducerContext,
    reporter_character_id: u64,
    target_pid: u32,
    reason: String,
    details: String,
) -> Result<(), String> {
    let account_id = require_account(ctx)?;
    require_owned_character(ctx, account_id, reporter_character_id)?;
    write_report(
        ctx,
        account_id,
        reporter_character_id,
        target_pid,
        String::new(),
        reason,
        details,
    )
}

#[reducer]
pub fn report_player_by_name(
    ctx: &ReducerContext,
    reporter_character_id: u64,
    target_character_name: String,
    reason: String,
    details: String,
) -> Result<(), String> {
    let account_id = require_account(ctx)?;
    require_owned_character(ctx, account_id, reporter_character_id)?;
    let target_character_name = clean_report_name(&target_character_name)?;
    write_report(
        ctx,
        account_id,
        reporter_character_id,
        0,
        target_character_name,
        reason,
        details,
    )
}

#[reducer]
pub fn bridge_ping(ctx: &ReducerContext, sessions: u32, tick: u64) -> Result<(), String> {
    require_bridge(ctx)?;
    sync_bridge_views(ctx);
    let row = BridgeHeartbeat {
        id: 0,
        owner: ctx.sender(),
        online: true,
        sessions,
        tick,
        updated_at: ctx.timestamp,
    };
    if ctx.db.bridge_heartbeat().id().find(0).is_some() {
        ctx.db.bridge_heartbeat().id().update(row);
    } else {
        ctx.db.bridge_heartbeat().insert(row);
    }
    Ok(())
}

#[reducer]
pub fn authorize_bridge(ctx: &ReducerContext, setup_token: String) -> Result<(), String> {
    let Some(expected_hash) = BRIDGE_SETUP_TOKEN_HASH else {
        return Err("bridge setup token is not configured".into());
    };
    if !constant_time_eq(&hex_sha256(setup_token.trim()), expected_hash) {
        return Err("bridge setup token is invalid".into());
    }
    if let Some(auth) = ctx.db.bridge_auth().id().find(BRIDGE_AUTH_ID) {
        if auth.owner == ctx.sender() {
            return Ok(());
        }
        return Err("bridge already authorized".into());
    }
    ctx.db.bridge_auth().insert(BridgeAuth {
        id: BRIDGE_AUTH_ID,
        owner: ctx.sender(),
        created_at: ctx.timestamp,
    });
    sync_bridge_views(ctx);
    Ok(())
}

#[reducer]
pub fn bridge_attach_session(
    ctx: &ReducerContext,
    session_id: u64,
    player_id: u32,
) -> Result<(), String> {
    require_bridge(ctx)?;
    let Some(mut session) = ctx.db.world_session().id().find(session_id) else {
        return Err("session not found".into());
    };
    session.player_id = player_id;
    session.bridge_attached = true;
    session.updated_at = ctx.timestamp;
    ctx.db.world_session().id().update(session.clone());
    upsert_bridge_session(ctx, &session);
    Ok(())
}

#[reducer]
pub fn bridge_save_character(
    ctx: &ReducerContext,
    character_id: u64,
    level: u32,
    lifetime_xp: u64,
    prestige_rank: u32,
    state_json: String,
) -> Result<(), String> {
    require_bridge(ctx)?;
    if state_json.len() > 512 * 1024 {
        return Err("state too large".into());
    }
    let Some(mut ch) = ctx.db.character().id().find(character_id) else {
        return Err("character not found".into());
    };
    ch.level = level;
    ch.lifetime_xp = lifetime_xp;
    ch.prestige_rank = prestige_rank;
    ch.state_json = state_json;
    ch.updated_at = ctx.timestamp;
    ctx.db.character().id().update(ch.clone());
    upsert_character_views(ctx, &ch);
    upsert_roster_for_owner(ctx, ch.owner, ch.account_id, "");
    Ok(())
}

#[reducer]
pub fn bridge_publish_snapshot(
    ctx: &ReducerContext,
    session_id: u64,
    owner: Identity,
    payload_json: String,
) -> Result<(), String> {
    require_bridge(ctx)?;
    if payload_json.len() > 512 * 1024 {
        return Err("snapshot too large".into());
    }
    let row = WorldSnapshot {
        session_id,
        owner,
        payload_json,
        updated_at: ctx.timestamp,
    };
    if ctx
        .db
        .world_snapshot()
        .session_id()
        .find(session_id)
        .is_some()
    {
        ctx.db.world_snapshot().session_id().update(row);
    } else {
        ctx.db.world_snapshot().insert(row);
    }
    prune_old_events(ctx);
    Ok(())
}

#[reducer]
pub fn bridge_publish_events(
    ctx: &ReducerContext,
    session_id: u64,
    owner: Identity,
    payload_json: String,
) -> Result<(), String> {
    require_bridge(ctx)?;
    if payload_json.len() > 128 * 1024 {
        return Err("events too large".into());
    }
    ctx.db.world_event().insert(WorldEvent {
        id: 0,
        owner,
        session_id,
        payload_json,
        created_at: ctx.timestamp,
    });
    Ok(())
}

#[reducer]
pub fn bridge_publish_social(
    ctx: &ReducerContext,
    session_id: u64,
    owner: Identity,
    payload_json: String,
) -> Result<(), String> {
    require_bridge(ctx)?;
    if payload_json.len() > 128 * 1024 {
        return Err("social snapshot too large".into());
    }
    let row = SocialSnapshot {
        session_id,
        owner,
        payload_json,
        updated_at: ctx.timestamp,
    };
    if ctx
        .db
        .social_snapshot()
        .session_id()
        .find(session_id)
        .is_some()
    {
        ctx.db.social_snapshot().session_id().update(row);
    } else {
        ctx.db.social_snapshot().insert(row);
    }
    Ok(())
}

#[reducer]
pub fn bridge_consume_command(ctx: &ReducerContext, command_id: u64) -> Result<(), String> {
    require_bridge(ctx)?;
    let Some(mut cmd) = ctx.db.client_command().id().find(command_id) else {
        return Ok(());
    };
    cmd.consumed = true;
    ctx.db.client_command().id().update(cmd.clone());
    upsert_bridge_client_command(ctx, &cmd);
    Ok(())
}

#[reducer]
pub fn bridge_close_session(
    ctx: &ReducerContext,
    session_id: u64,
    state_json: String,
    level: u32,
    reason: String,
) -> Result<(), String> {
    require_bridge(ctx)?;
    let Some(mut session) = ctx.db.world_session().id().find(session_id) else {
        return Ok(());
    };
    session.active = false;
    session.error = reason;
    session.updated_at = ctx.timestamp;
    ctx.db.world_session().id().update(session.clone());
    upsert_bridge_session(ctx, &session);
    if let Some(mut ch) = ctx.db.character().id().find(session.character_id) {
        ch.online = false;
        ch.level = level;
        ch.state_json = state_json;
        ch.updated_at = ctx.timestamp;
        ctx.db.character().id().update(ch.clone());
        upsert_character_views(ctx, &ch);
        upsert_roster_for_owner(ctx, ch.owner, ch.account_id, "");
    }
    upsert_project_stats(ctx);
    Ok(())
}

#[reducer]
pub fn bridge_save_world_state(
    ctx: &ReducerContext,
    key: String,
    payload_json: String,
) -> Result<(), String> {
    require_bridge(ctx)?;
    let key = clean_state_key(&key)?;
    if payload_json.len() > 1024 * 1024 {
        return Err("world state too large".into());
    }
    let row = WorldState {
        key: key.clone(),
        payload_json,
        updated_at: ctx.timestamp,
    };
    if ctx.db.world_state().key().find(key).is_some() {
        ctx.db.world_state().key().update(row.clone());
    } else {
        ctx.db.world_state().insert(row.clone());
    }
    upsert_bridge_world_state(ctx, &row);
    Ok(())
}

#[reducer]
pub fn bridge_open_play_session(
    ctx: &ReducerContext,
    id: u64,
    account_id: u64,
    character_id: u64,
    character_name: String,
) -> Result<(), String> {
    require_bridge(ctx)?;
    let character_name = clean_bounded_text(&character_name, 64, "character name")?;
    let row = PlaySession {
        id,
        account_id,
        character_id,
        character_name,
        started_at: ctx.timestamp,
        ended: false,
        updated_at: ctx.timestamp,
    };
    if ctx.db.play_session().id().find(id).is_some() {
        ctx.db.play_session().id().update(row);
    } else {
        ctx.db.play_session().insert(row);
    }
    Ok(())
}

#[reducer]
pub fn bridge_close_play_session(ctx: &ReducerContext, id: u64) -> Result<(), String> {
    require_bridge(ctx)?;
    let Some(mut row) = ctx.db.play_session().id().find(id) else {
        return Ok(());
    };
    row.ended = true;
    row.updated_at = ctx.timestamp;
    ctx.db.play_session().id().update(row);
    Ok(())
}

#[reducer]
pub fn bridge_insert_chat_log(
    ctx: &ReducerContext,
    account_id: u64,
    character_id: u64,
    character_name: String,
    channel: String,
    message: String,
) -> Result<(), String> {
    require_bridge(ctx)?;
    let character_name = clean_bounded_text(&character_name, 64, "character name")?;
    let channel = clean_bounded_text(&channel, 32, "channel")?;
    let message = clean_bounded_text(&message, 240, "message")?;
    ctx.db.chat_log().insert(ChatLog {
        id: 0,
        account_id,
        character_id,
        character_name,
        channel,
        message,
        created_at: ctx.timestamp,
    });
    Ok(())
}

#[reducer]
pub fn bridge_add_friend(
    ctx: &ReducerContext,
    character_id: u64,
    friend_id: u64,
) -> Result<(), String> {
    require_bridge(ctx)?;
    if character_id == friend_id {
        return Err("cannot friend self".into());
    }
    let key = social_key(character_id, friend_id);
    if ctx.db.friend_link().key().find(key.clone()).is_none() {
        let row = ctx.db.friend_link().insert(FriendLink {
            key,
            character_id,
            friend_id,
            created_at: ctx.timestamp,
        });
        upsert_bridge_friend_link(ctx, &row);
    }
    Ok(())
}

#[reducer]
pub fn bridge_remove_friend(
    ctx: &ReducerContext,
    character_id: u64,
    friend_id: u64,
) -> Result<(), String> {
    require_bridge(ctx)?;
    let key = social_key(character_id, friend_id);
    ctx.db.friend_link().key().delete(key.clone());
    ctx.db.bridge_friend_link().key().delete(key);
    Ok(())
}

#[reducer]
pub fn bridge_add_block(
    ctx: &ReducerContext,
    character_id: u64,
    blocked_id: u64,
) -> Result<(), String> {
    require_bridge(ctx)?;
    if character_id == blocked_id {
        return Err("cannot block self".into());
    }
    let key = social_key(character_id, blocked_id);
    if ctx.db.block_link().key().find(key.clone()).is_none() {
        let row = ctx.db.block_link().insert(BlockLink {
            key,
            character_id,
            blocked_id,
            created_at: ctx.timestamp,
        });
        upsert_bridge_block_link(ctx, &row);
    }
    let friend_key = social_key(character_id, blocked_id);
    ctx.db.friend_link().key().delete(friend_key.clone());
    ctx.db.bridge_friend_link().key().delete(friend_key);
    Ok(())
}

#[reducer]
pub fn bridge_remove_block(
    ctx: &ReducerContext,
    character_id: u64,
    blocked_id: u64,
) -> Result<(), String> {
    require_bridge(ctx)?;
    let key = social_key(character_id, blocked_id);
    ctx.db.block_link().key().delete(key.clone());
    ctx.db.bridge_block_link().key().delete(key);
    Ok(())
}

#[reducer]
pub fn bridge_create_guild(ctx: &ReducerContext, id: u64, name: String) -> Result<(), String> {
    require_bridge(ctx)?;
    let name = clean_guild_name(&name)?;
    let name_key = guild_name_key(&name);
    if ctx.db.guild().by_name().filter(&name_key).next().is_some() {
        return Err("guild name already exists".into());
    }
    if ctx.db.guild().id().find(id).is_some() {
        return Err("guild id already exists".into());
    }
    let row = ctx.db.guild().insert(Guild {
        id,
        name,
        name_key,
        realm: REALM_NAME.to_string(),
        created_at: ctx.timestamp,
    });
    upsert_bridge_guild(ctx, &row);
    Ok(())
}

#[reducer]
pub fn bridge_create_guild_with_leader(
    ctx: &ReducerContext,
    id: u64,
    name: String,
    leader_id: u64,
) -> Result<(), String> {
    require_bridge(ctx)?;
    let name = clean_guild_name(&name)?;
    let name_key = guild_name_key(&name);
    if ctx.db.guild().by_name().filter(&name_key).next().is_some() {
        return Err("name_taken".into());
    }
    if ctx.db.guild().id().find(id).is_some() {
        return Err("name_taken".into());
    }
    if ctx
        .db
        .guild_member()
        .character_id()
        .find(leader_id)
        .is_some()
    {
        return Err("already_in_guild".into());
    }
    let guild = ctx.db.guild().insert(Guild {
        id,
        name,
        name_key,
        realm: REALM_NAME.to_string(),
        created_at: ctx.timestamp,
    });
    upsert_bridge_guild(ctx, &guild);
    let member = ctx.db.guild_member().insert(GuildMember {
        character_id: leader_id,
        guild_id: id,
        rank: "leader".to_string(),
        joined_at: ctx.timestamp,
    });
    upsert_bridge_guild_member(ctx, &member);
    Ok(())
}

#[reducer]
pub fn bridge_delete_guild(ctx: &ReducerContext, id: u64) -> Result<(), String> {
    require_bridge(ctx)?;
    let members: Vec<u64> = ctx
        .db
        .guild_member()
        .by_guild()
        .filter(id)
        .map(|m| m.character_id)
        .collect();
    for character_id in members {
        ctx.db.guild_member().character_id().delete(character_id);
        ctx.db
            .bridge_guild_member()
            .character_id()
            .delete(character_id);
    }
    ctx.db.guild().id().delete(id);
    ctx.db.bridge_guild().id().delete(id);
    Ok(())
}

#[reducer]
pub fn bridge_add_guild_member(
    ctx: &ReducerContext,
    guild_id: u64,
    character_id: u64,
    rank: String,
) -> Result<(), String> {
    require_bridge(ctx)?;
    if ctx.db.guild().id().find(guild_id).is_none() {
        return Err("guild not found".into());
    }
    if ctx
        .db
        .guild_member()
        .character_id()
        .find(character_id)
        .is_some()
    {
        return Ok(());
    }
    let row = ctx.db.guild_member().insert(GuildMember {
        character_id,
        guild_id,
        rank: clean_guild_rank(&rank)?,
        joined_at: ctx.timestamp,
    });
    upsert_bridge_guild_member(ctx, &row);
    Ok(())
}

#[reducer]
pub fn bridge_add_guild_member_atomic(
    ctx: &ReducerContext,
    guild_id: u64,
    character_id: u64,
    rank: String,
    limit: u32,
) -> Result<(), String> {
    require_bridge(ctx)?;
    if ctx.db.guild().id().find(guild_id).is_none() {
        return Err("no_guild".into());
    }
    if ctx
        .db
        .guild_member()
        .character_id()
        .find(character_id)
        .is_some()
    {
        return Err("already_member".into());
    }
    if ctx.db.guild_member().by_guild().filter(guild_id).count() as u32 >= limit {
        return Err("full".into());
    }
    let row = ctx.db.guild_member().insert(GuildMember {
        character_id,
        guild_id,
        rank: clean_guild_rank(&rank)?,
        joined_at: ctx.timestamp,
    });
    upsert_bridge_guild_member(ctx, &row);
    Ok(())
}

#[reducer]
pub fn bridge_remove_guild_member(ctx: &ReducerContext, character_id: u64) -> Result<(), String> {
    require_bridge(ctx)?;
    ctx.db.guild_member().character_id().delete(character_id);
    ctx.db
        .bridge_guild_member()
        .character_id()
        .delete(character_id);
    Ok(())
}

#[reducer]
pub fn bridge_set_guild_rank(
    ctx: &ReducerContext,
    character_id: u64,
    rank: String,
) -> Result<(), String> {
    require_bridge(ctx)?;
    let Some(mut row) = ctx.db.guild_member().character_id().find(character_id) else {
        return Ok(());
    };
    row.rank = clean_guild_rank(&rank)?;
    ctx.db.guild_member().character_id().update(row.clone());
    upsert_bridge_guild_member(ctx, &row);
    Ok(())
}

fn require_account(ctx: &ReducerContext) -> Result<u64, String> {
    let Some(auth) = ctx.db.auth_state().owner().find(ctx.sender()) else {
        return Err("not logged in".into());
    };
    if auth.expires_at < ctx.timestamp {
        return Err("session expired".into());
    }
    Ok(auth.account_id)
}

fn require_session(ctx: &ReducerContext, session_id: u64) -> Result<WorldSession, String> {
    let account_id = require_account(ctx)?;
    let Some(session) = ctx.db.world_session().id().find(session_id) else {
        return Err("session not found".into());
    };
    if session.owner != ctx.sender() || session.account_id != account_id || !session.active {
        return Err("session not found".into());
    }
    Ok(session)
}

fn require_bridge(ctx: &ReducerContext) -> Result<(), String> {
    if let Some(auth) = ctx.db.bridge_auth().id().find(BRIDGE_AUTH_ID) {
        if auth.owner != ctx.sender() {
            return Err("bridge not authorized".into());
        }
        return Ok(());
    }
    Err("bridge not authorized".into())
}

fn require_owned_character(
    ctx: &ReducerContext,
    account_id: u64,
    character_id: u64,
) -> Result<Character, String> {
    let Some(ch) = ctx.db.character().id().find(character_id) else {
        return Err("character not found".into());
    };
    if ch.account_id != account_id {
        return Err("character not found".into());
    }
    Ok(ch)
}

fn current_bridge_owner(ctx: &ReducerContext) -> Option<Identity> {
    ctx.db
        .bridge_auth()
        .id()
        .find(BRIDGE_AUTH_ID)
        .map(|auth| auth.owner)
}

fn upsert_character_views(ctx: &ReducerContext, ch: &Character) {
    let directory = CharacterDirectory {
        id: ch.id,
        name: ch.name.clone(),
        name_key: ch.name_key.clone(),
        class_name: ch.class_name.clone(),
        level: ch.level,
        realm: REALM_NAME.to_string(),
        lifetime_xp: ch.lifetime_xp,
        prestige_rank: ch.prestige_rank,
        online: ch.online,
        force_rename: ch.force_rename,
        updated_at: ch.updated_at,
    };
    if ctx.db.character_directory().id().find(ch.id).is_some() {
        ctx.db.character_directory().id().update(directory);
    } else {
        ctx.db.character_directory().insert(directory);
    }
    upsert_bridge_character_state(ctx, ch);
}

fn delete_character_views(ctx: &ReducerContext, character_id: u64) {
    ctx.db.character_directory().id().delete(character_id);
    ctx.db.bridge_character_state().id().delete(character_id);
}

fn upsert_bridge_session(ctx: &ReducerContext, session: &WorldSession) {
    let Some(bridge_owner) = current_bridge_owner(ctx) else {
        return;
    };
    let row = BridgeSession {
        id: session.id,
        bridge_owner,
        owner: session.owner,
        account_id: session.account_id,
        character_id: session.character_id,
        player_id: session.player_id,
        class_name: session.class_name.clone(),
        character_name: session.character_name.clone(),
        active: session.active,
        bridge_attached: session.bridge_attached,
        started_at: session.started_at,
        updated_at: session.updated_at,
        error: session.error.clone(),
    };
    if ctx.db.bridge_session().id().find(session.id).is_some() {
        ctx.db.bridge_session().id().update(row);
    } else {
        ctx.db.bridge_session().insert(row);
    }
}

fn upsert_bridge_input_state(ctx: &ReducerContext, input: &InputState) {
    let Some(bridge_owner) = current_bridge_owner(ctx) else {
        return;
    };
    let row = BridgeInputState {
        session_id: input.session_id,
        bridge_owner,
        forward: input.forward,
        back: input.back,
        turn_left: input.turn_left,
        turn_right: input.turn_right,
        strafe_left: input.strafe_left,
        strafe_right: input.strafe_right,
        jump: input.jump,
        facing_valid: input.facing_valid,
        facing: input.facing,
        updated_at: input.updated_at,
    };
    if ctx
        .db
        .bridge_input_state()
        .session_id()
        .find(input.session_id)
        .is_some()
    {
        ctx.db.bridge_input_state().session_id().update(row);
    } else {
        ctx.db.bridge_input_state().insert(row);
    }
}

fn upsert_bridge_client_command(ctx: &ReducerContext, cmd: &ClientCommand) {
    let Some(bridge_owner) = current_bridge_owner(ctx) else {
        return;
    };
    let row = BridgeClientCommand {
        id: cmd.id,
        bridge_owner,
        owner: cmd.owner,
        session_id: cmd.session_id,
        kind: cmd.kind.clone(),
        payload_json: cmd.payload_json.clone(),
        created_at: cmd.created_at,
        consumed: cmd.consumed,
    };
    if ctx.db.bridge_client_command().id().find(cmd.id).is_some() {
        ctx.db.bridge_client_command().id().update(row);
    } else {
        ctx.db.bridge_client_command().insert(row);
    }
}

fn upsert_bridge_character_state(ctx: &ReducerContext, ch: &Character) {
    let Some(bridge_owner) = current_bridge_owner(ctx) else {
        return;
    };
    let row = BridgeCharacterState {
        id: ch.id,
        bridge_owner,
        account_id: ch.account_id,
        name: ch.name.clone(),
        name_key: ch.name_key.clone(),
        class_name: ch.class_name.clone(),
        level: ch.level,
        lifetime_xp: ch.lifetime_xp,
        prestige_rank: ch.prestige_rank,
        state_json: ch.state_json.clone(),
        online: ch.online,
        force_rename: ch.force_rename,
        updated_at: ch.updated_at,
    };
    if ctx.db.bridge_character_state().id().find(ch.id).is_some() {
        ctx.db.bridge_character_state().id().update(row);
    } else {
        ctx.db.bridge_character_state().insert(row);
    }
}

fn upsert_bridge_world_state(ctx: &ReducerContext, state: &WorldState) {
    let Some(bridge_owner) = current_bridge_owner(ctx) else {
        return;
    };
    let row = BridgeWorldState {
        key: state.key.clone(),
        bridge_owner,
        payload_json: state.payload_json.clone(),
        updated_at: state.updated_at,
    };
    if ctx
        .db
        .bridge_world_state()
        .key()
        .find(state.key.clone())
        .is_some()
    {
        ctx.db.bridge_world_state().key().update(row);
    } else {
        ctx.db.bridge_world_state().insert(row);
    }
}

fn upsert_bridge_friend_link(ctx: &ReducerContext, link: &FriendLink) {
    let Some(bridge_owner) = current_bridge_owner(ctx) else {
        return;
    };
    let row = BridgeFriendLink {
        key: link.key.clone(),
        bridge_owner,
        character_id: link.character_id,
        friend_id: link.friend_id,
        created_at: link.created_at,
    };
    if ctx
        .db
        .bridge_friend_link()
        .key()
        .find(link.key.clone())
        .is_some()
    {
        ctx.db.bridge_friend_link().key().update(row);
    } else {
        ctx.db.bridge_friend_link().insert(row);
    }
}

fn upsert_bridge_block_link(ctx: &ReducerContext, link: &BlockLink) {
    let Some(bridge_owner) = current_bridge_owner(ctx) else {
        return;
    };
    let row = BridgeBlockLink {
        key: link.key.clone(),
        bridge_owner,
        character_id: link.character_id,
        blocked_id: link.blocked_id,
        created_at: link.created_at,
    };
    if ctx
        .db
        .bridge_block_link()
        .key()
        .find(link.key.clone())
        .is_some()
    {
        ctx.db.bridge_block_link().key().update(row);
    } else {
        ctx.db.bridge_block_link().insert(row);
    }
}

fn upsert_bridge_guild(ctx: &ReducerContext, guild: &Guild) {
    let Some(bridge_owner) = current_bridge_owner(ctx) else {
        return;
    };
    let row = BridgeGuild {
        id: guild.id,
        bridge_owner,
        name: guild.name.clone(),
        name_key: guild.name_key.clone(),
        realm: guild.realm.clone(),
        created_at: guild.created_at,
    };
    if ctx.db.bridge_guild().id().find(guild.id).is_some() {
        ctx.db.bridge_guild().id().update(row);
    } else {
        ctx.db.bridge_guild().insert(row);
    }
}

fn upsert_bridge_guild_member(ctx: &ReducerContext, member: &GuildMember) {
    let Some(bridge_owner) = current_bridge_owner(ctx) else {
        return;
    };
    let row = BridgeGuildMember {
        character_id: member.character_id,
        bridge_owner,
        guild_id: member.guild_id,
        rank: member.rank.clone(),
        joined_at: member.joined_at,
    };
    if ctx
        .db
        .bridge_guild_member()
        .character_id()
        .find(member.character_id)
        .is_some()
    {
        ctx.db.bridge_guild_member().character_id().update(row);
    } else {
        ctx.db.bridge_guild_member().insert(row);
    }
}

fn sync_bridge_views(ctx: &ReducerContext) {
    if current_bridge_owner(ctx).is_none() {
        return;
    }
    let characters: Vec<Character> = ctx.db.character().iter().collect();
    for ch in characters {
        upsert_character_views(ctx, &ch);
    }
    let sessions: Vec<WorldSession> = ctx.db.world_session().iter().collect();
    for session in sessions {
        upsert_bridge_session(ctx, &session);
    }
    let inputs: Vec<InputState> = ctx.db.input_state().iter().collect();
    for input in inputs {
        upsert_bridge_input_state(ctx, &input);
    }
    let commands: Vec<ClientCommand> = ctx.db.client_command().iter().collect();
    for cmd in commands {
        upsert_bridge_client_command(ctx, &cmd);
    }
    let states: Vec<WorldState> = ctx.db.world_state().iter().collect();
    for state in states {
        upsert_bridge_world_state(ctx, &state);
    }
    let friends: Vec<FriendLink> = ctx.db.friend_link().iter().collect();
    for friend in friends {
        upsert_bridge_friend_link(ctx, &friend);
    }
    let blocks: Vec<BlockLink> = ctx.db.block_link().iter().collect();
    for block in blocks {
        upsert_bridge_block_link(ctx, &block);
    }
    let guilds: Vec<Guild> = ctx.db.guild().iter().collect();
    for guild in guilds {
        upsert_bridge_guild(ctx, &guild);
    }
    let members: Vec<GuildMember> = ctx.db.guild_member().iter().collect();
    for member in members {
        upsert_bridge_guild_member(ctx, &member);
    }
}

fn write_report(
    ctx: &ReducerContext,
    account_id: u64,
    reporter_character_id: u64,
    target_pid: u32,
    target_character_name: String,
    reason: String,
    details: String,
) -> Result<(), String> {
    let reason = clean_report_text(&reason, 64, "reason")?;
    let details = clean_report_text(&details, 1_000, "details")?;
    ctx.db.player_report().insert(PlayerReport {
        id: 0,
        owner: ctx.sender(),
        account_id,
        reporter_character_id,
        target_pid,
        target_character_name,
        reason,
        details,
        status: "open".to_string(),
        created_at: ctx.timestamp,
    });
    Ok(())
}

fn write_auth_success(ctx: &ReducerContext, account_id: u64, username: String) {
    let row = AuthState {
        owner: ctx.sender(),
        account_id,
        username,
        expires_at: ctx.timestamp + spacetimedb::TimeDuration::from_micros(SESSION_TTL_MICROS),
        error: String::new(),
    };
    if ctx.db.auth_state().owner().find(ctx.sender()).is_some() {
        ctx.db.auth_state().owner().update(row);
    } else {
        ctx.db.auth_state().insert(row);
    }
}

fn write_auth_error(ctx: &ReducerContext, error: &str) {
    let row = AuthState {
        owner: ctx.sender(),
        account_id: 0,
        username: String::new(),
        expires_at: ctx.timestamp,
        error: error.to_string(),
    };
    if ctx.db.auth_state().owner().find(ctx.sender()).is_some() {
        ctx.db.auth_state().owner().update(row);
    } else {
        ctx.db.auth_state().insert(row);
    }
}

fn upsert_roster(ctx: &ReducerContext, account_id: u64, error: &str) {
    upsert_roster_for_owner(ctx, ctx.sender(), account_id, error);
}

fn upsert_roster_for_owner(ctx: &ReducerContext, owner: Identity, account_id: u64, error: &str) {
    let mut rows: Vec<Character> = ctx.db.character().by_account().filter(account_id).collect();
    rows.sort_by(|a, b| a.id.cmp(&b.id));
    let entries: Vec<CharacterRosterEntry> = rows
        .into_iter()
        .map(|c| CharacterRosterEntry {
            id: c.id,
            name: c.name,
            class_name: c.class_name,
            level: c.level,
            online: c.online,
            force_rename: c.force_rename,
        })
        .collect();
    let characters_json = serde_json::to_string(&entries).unwrap_or_else(|_| "[]".to_string());
    let row = CharacterRoster {
        owner,
        account_id,
        realm: REALM_NAME.to_string(),
        characters_json,
        updated_at: ctx.timestamp,
        error: error.to_string(),
    };
    if ctx.db.character_roster().owner().find(owner).is_some() {
        ctx.db.character_roster().owner().update(row);
    } else {
        ctx.db.character_roster().insert(row);
    }
}

fn upsert_project_stats(ctx: &ReducerContext) {
    let accounts_created = ctx.db.account().iter().count() as u64;
    let players_online = ctx.db.world_session().iter().filter(|s| s.active).count() as u32;
    let row = ProjectStats {
        id: 0,
        realm: REALM_NAME.to_string(),
        accounts_created,
        players_online,
        updated_at: ctx.timestamp,
    };
    if ctx.db.project_stats().id().find(0).is_some() {
        ctx.db.project_stats().id().update(row);
    } else {
        ctx.db.project_stats().insert(row);
    }
}

fn prune_old_events(ctx: &ReducerContext) {
    let cutoff = ctx.timestamp - spacetimedb::TimeDuration::from_micros(SNAPSHOT_TTL_MICROS);
    let old: Vec<u64> = ctx
        .db
        .world_event()
        .iter()
        .filter(|e| e.created_at < cutoff)
        .map(|e| e.id)
        .collect();
    for id in old {
        ctx.db.world_event().id().delete(id);
    }
}

fn check_auth_attempt(ctx: &ReducerContext) -> Result<(), String> {
    let key = format!("auth:{:?}", ctx.sender());
    let window = TimeDuration::from_micros(AUTH_WINDOW_MICROS);
    let mut row = ctx
        .db
        .auth_attempt()
        .key()
        .find(key.clone())
        .unwrap_or(AuthAttempt {
            key: key.clone(),
            count: 0,
            window_started_at: ctx.timestamp,
        });
    if row.window_started_at + window < ctx.timestamp {
        row.count = 0;
        row.window_started_at = ctx.timestamp;
    }
    row.count = row.count.saturating_add(1);
    if ctx.db.auth_attempt().key().find(key).is_some() {
        ctx.db.auth_attempt().key().update(row.clone());
    } else {
        ctx.db.auth_attempt().insert(row.clone());
    }
    if row.count > AUTH_MAX_ATTEMPTS {
        return Err("too many attempts".into());
    }
    Ok(())
}

fn auth_fail_throttled(ctx: &ReducerContext, username_key: &str) -> bool {
    let Some(row) = ctx
        .db
        .auth_failure()
        .username_key()
        .find(username_key.to_string())
    else {
        return false;
    };
    if row.window_started_at + TimeDuration::from_micros(AUTH_FAIL_WINDOW_MICROS) < ctx.timestamp {
        ctx.db
            .auth_failure()
            .username_key()
            .delete(username_key.to_string());
        return false;
    }
    row.count >= AUTH_MAX_FAILURES
}

fn record_auth_failure(ctx: &ReducerContext, username_key: &str) {
    let window = TimeDuration::from_micros(AUTH_FAIL_WINDOW_MICROS);
    let mut row = ctx
        .db
        .auth_failure()
        .username_key()
        .find(username_key.to_string())
        .unwrap_or(AuthFailure {
            username_key: username_key.to_string(),
            count: 0,
            window_started_at: ctx.timestamp,
        });
    if row.window_started_at + window < ctx.timestamp {
        row.count = 0;
        row.window_started_at = ctx.timestamp;
    }
    row.count = row.count.saturating_add(1);
    if ctx
        .db
        .auth_failure()
        .username_key()
        .find(username_key.to_string())
        .is_some()
    {
        ctx.db.auth_failure().username_key().update(row);
    } else {
        ctx.db.auth_failure().insert(row);
    }
}

fn clear_auth_failure(ctx: &ReducerContext, username_key: &str) {
    ctx.db
        .auth_failure()
        .username_key()
        .delete(username_key.to_string());
}

fn clean_username(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    if s.len() < 3 || s.len() > 20 {
        return Err("username must be 3-20 characters".into());
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("username can contain letters, numbers, _ and -".into());
    }
    if offensive_name(s) {
        return Err("username is not allowed".into());
    }
    Ok(s.to_string())
}

fn clean_character_name(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    if s.len() < 2 || s.len() > 16 {
        return Err("name must be 2-16 characters".into());
    }
    let mut chars = s.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphabetic()) {
        return Err("name must start with a letter".into());
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphabetic() || c == '\'' || c == '-' || c == ' ')
    {
        return Err("name can contain letters, apostrophes, hyphens, and spaces".into());
    }
    if offensive_name(s) {
        return Err("character name is not allowed".into());
    }
    Ok(s.to_string())
}

fn offensive_name(raw: &str) -> bool {
    let normalized = normalized_name_for_censorship(raw);
    let collapsed = collapse_repeated_chars(&normalized);
    let built_in_terms = ["hitler", "fuck"];
    for term in built_in_terms {
        if normalized.contains(term) || collapsed.contains(term) {
            return true;
        }
    }
    for term in option_env!("USERNAME_BANLIST")
        .unwrap_or("")
        .split(|c: char| c.is_whitespace() || c == ',')
    {
        let term = normalized_name_for_censorship(term);
        if !term.is_empty() && (normalized.contains(&term) || collapsed.contains(&term)) {
            return true;
        }
    }
    false
}

fn normalized_name_for_censorship(raw: &str) -> String {
    let mut out = String::new();
    for c in raw.chars() {
        let c = match c.to_ascii_lowercase() {
            '0' => 'o',
            '1' | '!' | '|' => 'i',
            '3' => 'e',
            '4' | '@' => 'a',
            '5' | '$' => 's',
            '7' | '+' => 't',
            '8' => 'b',
            c => c,
        };
        if c.is_ascii_lowercase() {
            out.push(c);
        }
    }
    out
}

fn collapse_repeated_chars(raw: &str) -> String {
    let mut out = String::new();
    let mut prev = '\0';
    for c in raw.chars() {
        if c != prev {
            out.push(c);
            prev = c;
        }
    }
    out
}

fn clean_class(raw: &str) -> Result<String, String> {
    match raw {
        "warrior" | "paladin" | "hunter" | "rogue" | "priest" | "shaman" | "mage" | "warlock"
        | "druid" => Ok(raw.to_string()),
        _ => Err("invalid class".into()),
    }
}

fn clean_report_name(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    if s.is_empty() || s.len() > 64 {
        return Err("target name is invalid".into());
    }
    Ok(s.to_string())
}

fn clean_report_text(raw: &str, max_len: usize, field: &str) -> Result<String, String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err(format!("{field} is required"));
    }
    if s.len() > max_len {
        return Err(format!("{field} is too long"));
    }
    Ok(s.to_string())
}

fn clean_bounded_text(raw: &str, max_len: usize, field: &str) -> Result<String, String> {
    let s = raw.trim();
    if s.len() > max_len {
        return Err(format!("{field} is too long"));
    }
    Ok(s.to_string())
}

fn clean_state_key(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    if s.is_empty() || s.len() > 64 {
        return Err("world state key is invalid".into());
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("world state key is invalid".into());
    }
    Ok(s.to_string())
}

fn social_key(a: u64, b: u64) -> String {
    format!("{a}:{b}")
}

fn clean_guild_name(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    if s.len() < 3 || s.len() > 24 {
        return Err("guild name is invalid".into());
    }
    let mut chars = s.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        || !s.chars().last().is_some_and(|c| c.is_ascii_alphabetic())
    {
        return Err("guild name is invalid".into());
    }
    if !s.chars().all(|c| c.is_ascii_alphabetic() || c == ' ') || s.contains("  ") {
        return Err("guild name is invalid".into());
    }
    Ok(s.to_string())
}

fn guild_name_key(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn clean_guild_rank(raw: &str) -> Result<String, String> {
    match raw {
        "leader" | "officer" | "member" => Ok(raw.to_string()),
        _ => Err("guild rank is invalid".into()),
    }
}

fn make_salt(ctx: &ReducerContext, key: &str) -> String {
    let nonce_a: u128 = ctx.random();
    let nonce_b: u128 = ctx.random();
    hex_sha256(&format!(
        "{:?}:{}:{}:{}:{}",
        ctx.sender(),
        key,
        ctx.timestamp.to_micros_since_unix_epoch(),
        nonce_a,
        nonce_b
    ))
}

fn hash_password(salt: &str, password: &str) -> Result<String, String> {
    if password.len() < 6 || password.len() > 128 {
        return Err("password must be 6-128 characters".into());
    }
    let mut out = [0u8; PASSWORD_HASH_BYTES];
    pbkdf2_hmac::<Sha256>(
        password.as_bytes(),
        salt.as_bytes(),
        PASSWORD_KDF_ITERS,
        &mut out,
    );
    Ok(format!(
        "pbkdf2-sha256${}${}",
        PASSWORD_KDF_ITERS,
        hex_bytes(&out)
    ))
}

fn hex_sha256(input: &str) -> String {
    let digest = Sha256::digest(input.as_bytes());
    hex_bytes(&digest)
}

fn hex_bytes(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(nibble(b >> 4));
        out.push(nibble(b & 0x0f));
    }
    out
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let a = a.as_bytes();
    let b = b.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

fn nibble(v: u8) -> char {
    match v {
        0..=9 => (b'0' + v) as char,
        _ => (b'a' + (v - 10)) as char,
    }
}
