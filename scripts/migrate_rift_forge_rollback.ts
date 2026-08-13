import { runRiftForgeRollbackMigration } from './rift_forge_rollback_migration';

runRiftForgeRollbackMigration(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
