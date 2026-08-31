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
RUN npm run build:api

FROM build AS migrate

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "prisma:migrate:deploy"]

FROM base AS runtime

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/apps/api/public ./apps/api/public

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/apps/api/apps/api/src/main.js"]
