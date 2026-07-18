# World of Claudecraft game server — serves the built client, REST API and WebSocket
# world on one port. Pair with a postgres service (see docker-compose.yml).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY .browserslistrc tsconfig.json vite.config.ts svelte.config.js index.html admin.html play.html guide.html editor.html wallet-handoff.html ./
COPY src ./src
COPY server ./server
COPY bot ./bot
COPY headless ./headless
COPY scripts ./scripts
COPY public ./public
COPY glitch.public.env .env.production
# Optional private extensions live under ./private. Public checkouts contain only
# a placeholder, so builds still fall back to public stubs; deploys can clone the
# private bot detector into private/bot_detector before this Docker build.
COPY private ./private
# Public client config is inlined into the bundle at build time (Vite reads
# VITE_* from the environment). Empty defaults keep Turnstile and external
# wallet handoff off; injected wallet UI stays enabled unless explicitly disabled.
# Passed through from compose/Glitch build args.
ARG VITE_TURNSTILE_SITEKEY=""
ARG VITE_REOWN_PROJECT_ID=""
ARG VITE_WALLET_DISABLED=""
ARG VITE_GLITCH_ENABLED=""
ARG VITE_GLITCH_TITLE_ID=""
ARG VITE_GLITCH_TITLE_TOKEN=""
ARG VITE_GLITCH_DEFAULT_CLASS=""
ARG VITE_API_ORIGIN=""
ARG VITE_DESKTOP_RELATIVE_API=""
RUN if [ -n "$VITE_TURNSTILE_SITEKEY" ]; then export VITE_TURNSTILE_SITEKEY; else unset VITE_TURNSTILE_SITEKEY; fi; \
    if [ -n "$VITE_REOWN_PROJECT_ID" ]; then export VITE_REOWN_PROJECT_ID; else unset VITE_REOWN_PROJECT_ID; fi; \
    if [ -n "$VITE_WALLET_DISABLED" ]; then export VITE_WALLET_DISABLED; else unset VITE_WALLET_DISABLED; fi; \
    if [ -n "$VITE_GLITCH_ENABLED" ]; then export VITE_GLITCH_ENABLED; else unset VITE_GLITCH_ENABLED; fi; \
    if [ -n "$VITE_GLITCH_TITLE_ID" ]; then export VITE_GLITCH_TITLE_ID; else unset VITE_GLITCH_TITLE_ID; fi; \
    if [ -n "$VITE_GLITCH_TITLE_TOKEN" ]; then export VITE_GLITCH_TITLE_TOKEN; else unset VITE_GLITCH_TITLE_TOKEN; fi; \
    if [ -n "$VITE_GLITCH_DEFAULT_CLASS" ]; then export VITE_GLITCH_DEFAULT_CLASS; else unset VITE_GLITCH_DEFAULT_CLASS; fi; \
    if [ -n "$VITE_API_ORIGIN" ]; then export VITE_API_ORIGIN; else unset VITE_API_ORIGIN; fi; \
    if [ -n "$VITE_DESKTOP_RELATIVE_API" ]; then export VITE_DESKTOP_RELATIVE_API; else unset VITE_DESKTOP_RELATIVE_API; fi; \
    npm run build && cp -a dist/media ./media-build && rm -rf dist/media && npm run build:server && npm run build:bot

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/dist ./dist
COPY --from=build /app/media-build ./media-build
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/dist-bot ./dist-bot
COPY --from=build /app/scripts/prod_cpu_game_helper.mjs /app/ops/
COPY --from=build /app/scripts/prod_cpu_profile_client.mjs /app/ops/
RUN mkdir -p /app/dist/media && chown -R node:node /app/dist/media
EXPOSE 3000
USER node
CMD ["sh", "-c", "mkdir -p /app/dist/media && node -e \"require('fs').cpSync('/app/media-build', '/app/dist/media', { recursive: true, force: true })\" && node dist-server/server.cjs"]
