FROM node:24.15.0-bookworm-slim AS base

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS dependencies

COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build

COPY . .
RUN npm run build:api

FROM build AS migrate

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "prisma:migrate:deploy"]

FROM base AS runtime

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/apps/api/main.js"]
