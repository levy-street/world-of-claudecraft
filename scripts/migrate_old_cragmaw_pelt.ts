import { runOldCragmawPeltMigration } from './old_cragmaw_pelt_migration';

runOldCragmawPeltMigration(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
