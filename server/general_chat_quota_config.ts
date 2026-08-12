// Fixed process/database bounds shared without importing db.ts into the pure
// coordinator or creating a db.ts <-> quota module cycle.
//
// GENERAL_CHAT_QUOTA_MAX_IN_FLIGHT is a REALM-GLOBAL ceiling shared by every
// configured account, and it also sizes the dedicated pool below. Once this
// many consumes are in flight, every other configured account is refused as
// busy for the short unavailable-cache window: that shared fate is deliberate
// while configured accounts number in the handful (same-account back-to-back
// sends are refused as 'pending' instead and never occupy these slots). The
// cap is static rather than derived from the configured-account count because
// the dedicated pool is sized once at boot; raise this constant if configured
// accounts outgrow a handful.
export const GENERAL_CHAT_QUOTA_MAX_IN_FLIGHT = 2;
export const GENERAL_CHAT_QUOTA_DB_POOL_MAX_CLIENTS = GENERAL_CHAT_QUOTA_MAX_IN_FLIGHT;
export const GENERAL_CHAT_QUOTA_LISTENER_CONNECTIONS = 1;
export const GENERAL_CHAT_QUOTA_ACQUIRE_TIMEOUT_MS = 500;
export const GENERAL_CHAT_QUOTA_ADVISORY_NAMESPACE = 1_195_594_577;
