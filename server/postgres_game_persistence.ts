import type { GamePersistence } from './game_persistence';
import {
  closePlaySession,
  insertChatLogs,
  loadMarketState,
  openPlaySession,
  pool,
  saveCharacterState,
  saveMarketState,
} from './db';
import { PgSocialDb } from './social_db';

export function createPostgresGamePersistence(): GamePersistence {
  return {
    socialDb: new PgSocialDb(pool),
    saveCharacterState,
    loadMarketState,
    saveMarketState,
    openPlaySession,
    closePlaySession,
    insertChatLogs,
  };
}
