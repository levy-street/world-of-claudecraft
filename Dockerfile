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
# Optional private extensions live under ./private. Public checkouts contain only
# a placeholder, so builds still fall back to public stubs; deploys can clone the
# private bot detector into private/bot_detector before this Docker build.
COPY private ./private
# Public client config is inlined into the bundle at build time (Vite reads
# VITE_* from the environment). Empty defaults keep Turnstile and external
# wallet handoff off; injected wallet UI stays enabled unless explicitly disabled.
# Passed through from compose build args.
ARG VITE_TURNSTILE_SITEKEY=""
ARG VITE_REOWN_PROJECT_ID=""
ARG VITE_WALLET_DISABLED=""
RUN VITE_TURNSTILE_SITEKEY="$VITE_TURNSTILE_SITEKEY" \
    VITE_REOWN_PROJECT_ID="$VITE_REOWN_PROJECT_ID" \
    VITE_WALLET_DISABLED="$VITE_WALLET_DISABLED" \
    npm run build && cp -a dist/media ./media-build && rm -rf dist/media && npm run build:server && npm run build:bot

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/media-build ./media-build
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/dist-bot ./dist-bot
COPY --from=build /app/scripts/prod_cpu_game_helper.mjs /app/ops/
COPY --from=build /app/scripts/prod_cpu_profile_client.mjs /app/ops/
RUN mkdir -p /app/dist/media && chown -R node:node /app/dist/media
EXPOSE 8787
USER node
CMD ["sh", "-c", "mkdir -p /app/dist/media && node -e \"require('fs').cpSync('/app/media-build', '/app/dist/media', { recursive: true, force: true })\" && node dist-server/server.cjs"]
