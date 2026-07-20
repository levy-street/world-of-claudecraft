# WoCC compute delegation pool — one image, two roles:
#   web    (default CMD): migrate then serve Next.js on $PORT
#   worker (override CMD with `npm run worker`): BullMQ health/settlement jobs
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY . .
# Generates the linux-musl Prisma engines inside the image, then builds.
RUN npx prisma generate && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3100
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -p ${PORT:-3100}"]
