FROM node:24.15.0-bookworm-slim AS base

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS dependencies

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm ci

FROM dependencies AS build

COPY . .
RUN npm run build:worker

FROM base AS runtime

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --omit=dev --omit=peer --omit=optional --ignore-scripts
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@img/sharp-linux-x64 ./node_modules/@img/sharp-linux-x64
COPY --from=build /app/node_modules/@img/sharp-libvips-linux-x64 ./node_modules/@img/sharp-libvips-linux-x64
COPY --from=build /app/dist ./dist

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/apps/worker/apps/worker/src/main.js"]
