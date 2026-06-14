use sha2::{Digest, Sha256};
use spacetimedb::{client_visibility_filter, reducer, table, Filter, Identity, ReducerContext, Table, Timestamp};

const REALM_NAME: &str = "Claudemoon";
const SESSION_TTL_MICROS: i64 = 7 * 24 * 60 * 60 * 1_000_000;
const SNAPSHOT_TTL_MICROS: i64 = 30_000_000;

#[client_visibility_filter]
const AUTH_STATE_OWNER: Filter = Filter::Sql("SELECT * FROM auth_state WHERE owner = :sender");
#[client_visibility_filter]
const SESSION_OWNER: Filter = Filter::Sql("SELECT * FROM world_session WHERE owner = :sender");
#[client_visibility_filter]
const SNAPSHOT_OWNER: Filter = Filter::Sql("SELECT * FROM world_snapshot WHERE owner = :sender");
#[client_visibility_filter]
const EVENT_OWNER: Filter = Filter::Sql("SELECT * FROM world_event WHERE owner = :sender");
#[client_visibility_filter]
const SOCIAL_OWNER: Filter = Filter::Sql("SELECT * FROM social_snapshot WHERE owner = :sender");

#[derive(Clone)]
#[table(accessor = account, public, index(accessor = by_username, btree(columns = [username_key])))]
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
    pub token: String,
    pub expires_at: Timestamp,
    pub error: String,
}

#[derive(Clone)]
#[table(
    accessor = character,
    public,
    index(accessor = by_account, btree(columns = [account_id])),
    index(accessor = by_name, btree(columns = [name_key]))
)]
pub struct Character {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub account_id: u64,
    pub name: String,
    pub name_key: String,
    pub class_name: String,
    pub level: u32,
    pub state_json: String,
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
#[table(accessor = input_state, public, index(accessor = by_session, btree(columns = [session_id])))]
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
    public,
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
#[table(accessor = project_stats, public)]
pub struct ProjectStats {
    #[primary_key]
    pub id: u64,
    pub realm: String,
    pub accounts_created: u64,
    pub players_online: u32,
    pub updated_at: Timestamp,
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
        if let Some(mut ch) = ctx.db.character().id().find(session.character_id) {
            ch.online = false;
            ch.updated_at = ctx.timestamp;
            ctx.db.character().id().update(ch);
        }
    }
    upsert_project_stats(ctx);
}

#[reducer]
pub fn register(ctx: &ReducerContext, username: String, password: String) -> Result<(), String> {
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
    let key = username.trim().to_lowercase();
    let Some(account) = ctx.db.account().by_username().filter(&key).next() else {
        write_auth_error(ctx, "invalid username or password");
        return Err("invalid username or password".into());
    };
    if account.banned {
        write_auth_error(ctx, "account is banned");
        return Err("account is banned".into());
    }
    if hash_password(&account.password_salt, &password)? != account.password_hash {
        write_auth_error(ctx, "invalid username or password");
        return Err("invalid username or password".into());
    }
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
pub fn create_character(ctx: &ReducerContext, name: String, class_name: String) -> Result<(), String> {
    let account_id = require_account(ctx)?;
    let name = clean_character_name(&name)?;
    let name_key = name.to_lowercase();
    if ctx.db.character().by_name().filter(&name_key).next().is_some() {
        upsert_roster(ctx, account_id, "name is already taken");
        return Err("name is already taken".into());
    }
    let class_name = clean_class(&class_name)?;
    let count = ctx.db.character().by_account().filter(account_id).count();
    if count >= 10 {
        upsert_roster(ctx, account_id, "character limit reached");
        return Err("character limit reached".into());
    }
    ctx.db.character().insert(Character {
        id: 0,
        account_id,
        name,
        name_key,
        class_name,
        level: 1,
        state_json: String::new(),
        online: false,
        force_rename: false,
        updated_at: ctx.timestamp,
    });
    upsert_roster(ctx, account_id, "");
    Ok(())
}

#[reducer]
pub fn rename_character(ctx: &ReducerContext, character_id: u64, name: String) -> Result<(), String> {
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
    ctx.db.character().id().update(ch);
    upsert_roster(ctx, account_id, "");
    Ok(())
}

#[reducer]
pub fn delete_character(ctx: &ReducerContext, character_id: u64, name: String) -> Result<(), String> {
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

    let existing: Vec<WorldSession> = ctx
        .db
        .world_session()
        .iter()
        .filter(|s| s.owner == ctx.sender() && s.active)
        .collect();
    for mut s in existing {
        s.active = false;
        s.updated_at = ctx.timestamp;
        ctx.db.world_session().id().update(s);
    }

    ctx.db.world_session().insert(WorldSession {
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
    if let Some(mut ch) = ctx.db.character().id().find(session.character_id) {
        ch.online = false;
        ch.updated_at = ctx.timestamp;
        ctx.db.character().id().update(ch);
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
        ctx.db.input_state().session_id().update(row);
    } else {
        ctx.db.input_state().insert(row);
    }
    Ok(())
}

#[reducer]
pub fn command(ctx: &ReducerContext, session_id: u64, kind: String, payload_json: String) -> Result<(), String> {
    require_session(ctx, session_id)?;
    if kind.len() > 64 || payload_json.len() > 16 * 1024 {
        return Err("command too large".into());
    }
    ctx.db.client_command().insert(ClientCommand {
        id: 0,
        owner: ctx.sender(),
        session_id,
        kind,
        payload_json,
        created_at: ctx.timestamp,
        consumed: false,
    });
    Ok(())
}

#[reducer]
pub fn bridge_ping(ctx: &ReducerContext, sessions: u32, tick: u64) {
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
}

#[reducer]
pub fn bridge_attach_session(ctx: &ReducerContext, session_id: u64, player_id: u32) -> Result<(), String> {
    let Some(mut session) = ctx.db.world_session().id().find(session_id) else {
        return Err("session not found".into());
    };
    session.player_id = player_id;
    session.bridge_attached = true;
    session.updated_at = ctx.timestamp;
    ctx.db.world_session().id().update(session);
    Ok(())
}

#[reducer]
pub fn bridge_save_character(ctx: &ReducerContext, character_id: u64, level: u32, state_json: String) -> Result<(), String> {
    if state_json.len() > 512 * 1024 {
        return Err("state too large".into());
    }
    let Some(mut ch) = ctx.db.character().id().find(character_id) else {
        return Err("character not found".into());
    };
    ch.level = level;
    ch.state_json = state_json;
    ch.updated_at = ctx.timestamp;
    ctx.db.character().id().update(ch);
    Ok(())
}

#[reducer]
pub fn bridge_publish_snapshot(ctx: &ReducerContext, session_id: u64, owner: Identity, payload_json: String) -> Result<(), String> {
    if payload_json.len() > 512 * 1024 {
        return Err("snapshot too large".into());
    }
    let row = WorldSnapshot {
        session_id,
        owner,
        payload_json,
        updated_at: ctx.timestamp,
    };
    if ctx.db.world_snapshot().session_id().find(session_id).is_some() {
        ctx.db.world_snapshot().session_id().update(row);
    } else {
        ctx.db.world_snapshot().insert(row);
    }
    prune_old_events(ctx);
    Ok(())
}

#[reducer]
pub fn bridge_publish_events(ctx: &ReducerContext, session_id: u64, owner: Identity, payload_json: String) -> Result<(), String> {
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
pub fn bridge_publish_social(ctx: &ReducerContext, session_id: u64, owner: Identity, payload_json: String) -> Result<(), String> {
    if payload_json.len() > 128 * 1024 {
        return Err("social snapshot too large".into());
    }
    let row = SocialSnapshot {
        session_id,
        owner,
        payload_json,
        updated_at: ctx.timestamp,
    };
    if ctx.db.social_snapshot().session_id().find(session_id).is_some() {
        ctx.db.social_snapshot().session_id().update(row);
    } else {
        ctx.db.social_snapshot().insert(row);
    }
    Ok(())
}

#[reducer]
pub fn bridge_consume_command(ctx: &ReducerContext, command_id: u64) -> Result<(), String> {
    let Some(mut cmd) = ctx.db.client_command().id().find(command_id) else {
        return Ok(());
    };
    cmd.consumed = true;
    ctx.db.client_command().id().update(cmd);
    Ok(())
}

#[reducer]
pub fn bridge_close_session(ctx: &ReducerContext, session_id: u64, state_json: String, level: u32, reason: String) -> Result<(), String> {
    let Some(mut session) = ctx.db.world_session().id().find(session_id) else {
        return Ok(());
    };
    session.active = false;
    session.error = reason;
    session.updated_at = ctx.timestamp;
    ctx.db.world_session().id().update(session.clone());
    if let Some(mut ch) = ctx.db.character().id().find(session.character_id) {
        ch.online = false;
        ch.level = level;
        ch.state_json = state_json;
        ch.updated_at = ctx.timestamp;
        ctx.db.character().id().update(ch);
    }
    upsert_project_stats(ctx);
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

fn write_auth_success(ctx: &ReducerContext, account_id: u64, username: String) {
    let row = AuthState {
        owner: ctx.sender(),
        account_id,
        username,
        token: make_token(ctx, account_id),
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
        token: String::new(),
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
    let mut rows: Vec<Character> = ctx.db.character().by_account().filter(account_id).collect();
    rows.sort_by(|a, b| a.id.cmp(&b.id));
    let characters_json = format!(
        "[{}]",
        rows.iter()
            .map(|c| {
                format!(
                    "{{\"id\":{},\"name\":\"{}\",\"class\":\"{}\",\"level\":{},\"online\":{},\"forceRename\":{}}}",
                    c.id,
                    json_escape(&c.name),
                    json_escape(&c.class_name),
                    c.level,
                    c.online,
                    c.force_rename
                )
            })
            .collect::<Vec<_>>()
            .join(",")
    );
    let row = CharacterRoster {
        owner: ctx.sender(),
        account_id,
        realm: REALM_NAME.to_string(),
        characters_json,
        updated_at: ctx.timestamp,
        error: error.to_string(),
    };
    if ctx.db.character_roster().owner().find(ctx.sender()).is_some() {
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

fn clean_username(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    if s.len() < 3 || s.len() > 20 {
        return Err("username must be 3-20 characters".into());
    }
    if !s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("username can contain letters, numbers, _ and -".into());
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
    if !s.chars().all(|c| c.is_ascii_alphabetic() || c == '\'' || c == '-' || c == ' ') {
        return Err("name can contain letters, apostrophes, hyphens, and spaces".into());
    }
    Ok(s.to_string())
}

fn clean_class(raw: &str) -> Result<String, String> {
    match raw {
        "warrior" | "paladin" | "hunter" | "rogue" | "priest" | "shaman" | "mage" | "warlock" | "druid" => Ok(raw.to_string()),
        _ => Err("invalid class".into()),
    }
}

fn make_salt(ctx: &ReducerContext, key: &str) -> String {
    hex_sha256(&format!("{:?}:{}:{}", ctx.sender(), key, ctx.timestamp.to_micros_since_unix_epoch()))
}

fn make_token(ctx: &ReducerContext, account_id: u64) -> String {
    hex_sha256(&format!("{:?}:{}:{}", ctx.sender(), account_id, ctx.timestamp.to_micros_since_unix_epoch()))
}

fn hash_password(salt: &str, password: &str) -> Result<String, String> {
    if password.len() < 6 || password.len() > 128 {
        return Err("password must be 6-128 characters".into());
    }
    Ok(hex_sha256(&format!("{}:{}", salt, password)))
}

fn hex_sha256(input: &str) -> String {
    let digest = Sha256::digest(input.as_bytes());
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        out.push(nibble(b >> 4));
        out.push(nibble(b & 0x0f));
    }
    out
}

fn nibble(v: u8) -> char {
    match v {
        0..=9 => (b'0' + v) as char,
        _ => (b'a' + (v - 10)) as char,
    }
}

fn json_escape(raw: &str) -> String {
    raw.chars().flat_map(|c| match c {
        '"' => "\\\"".chars().collect::<Vec<_>>(),
        '\\' => "\\\\".chars().collect(),
        '\n' => "\\n".chars().collect(),
        '\r' => "\\r".chars().collect(),
        '\t' => "\\t".chars().collect(),
        c => vec![c],
    }).collect()
}
