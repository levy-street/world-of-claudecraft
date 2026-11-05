# Admin self-update

Adds an opt-in self-update path: an admin endpoint + panel that runs a
`scripts/admin/update.sh` which pulls, rebuilds, and restarts the server,
plus optional systemd units for scheduled updates.

## Wiring

1. `server/admin_update.ts` exports `maybeHandleAdminUpdate(req,res,pathname,readBody)`.
   Call it from your admin route dispatcher before the 404 fallthrough:
   ```ts
   if (await maybeHandleAdminUpdate(req, res, pathname, readBody)) return;
   ```
   Routes: `POST /admin/api/update` (starts the script, detached) and
   `GET /admin/api/update/status` (tails the log + maintenance flag).
   Set `WOC_DISABLE_ADMIN_UPDATE=1` to disable on shared deploys.

2. `src/admin/update_panel.ts` renders the panel in the admin SPA.

3. `scripts/admin/update.sh` — generic single-service updater. Override
   `WOC_HOME`, `WOC_SERVICE`, `WOC_BRANCH`, `WOC_WARN_SECONDS` via env.

4. `deploy/systemd/woc-autoupdate.{service,timer}` — optional daily run.

All additive; nothing runs unless you wire the endpoint and ship the script.
