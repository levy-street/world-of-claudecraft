import { runMailBotWelcomePurgeMigration } from './mail_bot_welcome_purge_migration';

runMailBotWelcomePurgeMigration(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
