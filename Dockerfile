# ---------------------------------------------------------------------------
# Vulnerable Notes API — container image
#
# ⚠️  This image is a LAB image, not a production image. When LAB_MODE is
#     "vulnerable" it serves deliberately insecure endpoints. Only ever run it
#     bound to loopback on a machine you own (see docker-compose.yml).
#
# The runtime stage installs production dependencies only. `prisma` and `tsx`
# are runtime dependencies here on purpose: the entrypoint pushes the schema
# and seeds the lab database before the API starts.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH"

# openssl is required by Prisma's query engine.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app


# --- dependencies -----------------------------------------------------------
FROM base AS deps

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile


# --- build ------------------------------------------------------------------
FROM deps AS build

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

RUN pnpm prisma:generate && pnpm build


# --- runtime ----------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=development \
    HOST=0.0.0.0 \
    PORT=3000

COPY package.json pnpm-lock.yaml ./
# Drop the content-addressable store once the modules are linked — it is build
# scratch, and leaving it behind roughly doubles the image.
RUN pnpm install --frozen-lockfile --prod \
    && pnpm store prune \
    && rm -rf /pnpm/store /root/.cache

COPY --from=build /app/dist ./dist
COPY prisma ./prisma

# Generate against the production install so the client matches the
# @prisma/client actually present in this stage.
RUN pnpm exec prisma generate

COPY tsconfig.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Only the SQLite directory needs to be writable by the runtime user. A
# recursive chown over /app would duplicate every installed file into a new
# layer for no benefit.
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/data \
    && chown node:node /app/data

USER node

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
