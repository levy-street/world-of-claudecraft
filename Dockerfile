# World of Claudecraft game server — serves the built client, REST API and WebSocket
# world on one port. Pair with a postgres service (see docker-compose.yml).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY .browserslistrc tsconfig.json vite.config.ts svelte.config.js index.html admin.html play.html guide.html editor.html ./
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
# VITE_* from the environment). Empty defaults keep optional UI disabled:
# Turnstile widget off. Passed through from compose/Glitch build args.
ARG VITE_TURNSTILE_SITEKEY=""
ARG VITE_GLITCH_ENABLED=""
ARG VITE_GLITCH_TITLE_ID=""
ARG VITE_GLITCH_TITLE_TOKEN=""
ARG VITE_GLITCH_DEFAULT_CLASS=""
ARG VITE_API_ORIGIN=""
RUN VITE_TURNSTILE_SITEKEY="$VITE_TURNSTILE_SITEKEY" \
    VITE_GLITCH_ENABLED="$VITE_GLITCH_ENABLED" \
    VITE_GLITCH_TITLE_ID="$VITE_GLITCH_TITLE_ID" \
    VITE_GLITCH_TITLE_TOKEN="$VITE_GLITCH_TITLE_TOKEN" \
    VITE_GLITCH_DEFAULT_CLASS="$VITE_GLITCH_DEFAULT_CLASS" \
    VITE_API_ORIGIN="$VITE_API_ORIGIN" \
    npm run build && cp -a dist/media ./media-build && rm -rf dist/media && npm run build:server && npm run build:bot

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/dist ./dist
COPY --from=build /app/media-build ./media-build
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/dist-bot ./dist-bot
RUN mkdir -p /app/dist/media && chown -R node:node /app/dist/media
EXPOSE 3000
USER node
CMD ["sh", "-c", "mkdir -p /app/dist/media && node -e \"require('fs').cpSync('/app/media-build', '/app/dist/media', { recursive: true, force: true })\" && node dist-server/server.cjs"]
