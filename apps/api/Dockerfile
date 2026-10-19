# syntax=docker/dockerfile:1
#
# sspma API — built from the REPOSITORY ROOT, not from apps/api:
#
#   docker build -f apps/api/Dockerfile .
#
# This is an npm workspaces monorepo. The API imports @ashram/types through a
# workspace symlink, and the Prisma schema lives in database/, so neither is
# reachable from an apps/api context.
#
# Node 22, the version the sibling platform images use. package.json asks for
# >=20 and nothing here needs more.
#
# Base image is an ARG so it can be pinned to a digest without editing three
# FROM lines:
#   docker buildx imagetools inspect node:22-bookworm-slim   # copy the digest
#   build with: --build-arg NODE_IMAGE=node:22-bookworm-slim@sha256:<digest>
ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
# deps — the full dependency tree, from the lockfile.
#
# openssl first: Prisma's postinstall picks which query and schema engines to
# download by probing the system's libssl, and bookworm-slim ships no openssl
# binary. Without it Prisma guesses, and a wrong guess surfaces as an engine
# that fails to load at the first query rather than at build time.
#
# The root `prepare` script builds @ashram/types during `npm ci`, so that
# package's sources have to be here before the install, not after.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
        openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types packages/types
COPY packages/config packages/config
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# ---------------------------------------------------------------------------
# builder — compile apps/api/src -> apps/api/dist.
#
# `prisma generate` BEFORE tsc, and this is not optional. `deps` installs with
# no schema in the image, so @prisma/client's postinstall leaves an empty stub
# client: no models, no enums, no Prisma.sql. tsc against the stub fails with
# hundreds of errors that all read as type bugs in the application — "no
# exported member 'WhatsAppProvider'", "Parameter 'tx' implicitly has an 'any'
# type" — and none of them mention Prisma generation. That is exactly how the
# first CI build of this image failed.
#
# The runtime stage generates again on its own base; this one exists only to
# give the compiler the types.
# ---------------------------------------------------------------------------
FROM deps AS builder
COPY database/schema database/schema
RUN node_modules/.bin/prisma generate --schema database/schema/schema.prisma
COPY apps/api apps/api
RUN npm run build -w @ashram/api

# ---------------------------------------------------------------------------
# proddeps — the same tree with devDependencies removed.
#
# Pruned rather than reinstalled with --omit=dev: a fresh install would rerun
# `prepare`, which needs TypeScript, which is a devDependency.
#
# `prisma` (the CLI) is a runtime dependency on purpose. deploy/migrate.sh runs
# `prisma migrate deploy` inside THIS image, so the CLI and its schema engine
# have to survive the prune.
#
# The web workspace's runtime dependencies (react, radix, recharts) survive it
# too — npm prunes by dependency type, not by workspace. They cost disk, not
# memory: nothing in the API requires them.
# ---------------------------------------------------------------------------
FROM deps AS proddeps
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ARG VERSION=dev
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="SSPMA API" \
      org.opencontainers.image.description="Ashram Management API (Express + Prisma)" \
      org.opencontainers.image.vendor="Nirantix" \
      org.opencontainers.image.licenses="Proprietary" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      com.nirantix.product="sspma" \
      com.nirantix.service="api" \
      com.nirantix.team="platform"

# tzdata because of TZ below. ca-certificates for outbound TLS to Meta's Graph
# API and WhatsApp's servers; openssl for Prisma, as in `deps`.
RUN apt-get update && apt-get install -y --no-install-recommends \
        openssl ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

# STORAGE_LOCAL_DIR is set HERE, not in compose, because the image is what
# knows where it writes. src/env.ts resolves it with path.resolve(), so an
# absolute path is taken as-is. compose mounts the data volume over it.
#
# TZ=Asia/Kolkata because that is the clock this application was written and
# tested against: the seed's daysAgo(), date-range reports and scheduled
# broadcasts all use the process's local time. Running it on UTC would move
# every "today" boundary by 5h30m with no error anywhere.
#
# CHECKPOINT_DISABLE stops the Prisma CLI phoning home and trying to write a
# cache under $HOME, which the read-only root filesystem refuses.
ENV NODE_ENV=production \
    TZ=Asia/Kolkata \
    API_PORT=4300 \
    STORAGE_DRIVER=local \
    STORAGE_LOCAL_DIR=/data/storage \
    CHECKPOINT_DISABLE=1 \
    APP_VERSION="${VERSION}" \
    APP_GIT_SHA="${GIT_SHA}"

# The workspace symlink node_modules/@ashram/types -> ../../packages/types is
# copied as a symlink, so its target has to exist at the same relative path.
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=proddeps /app/packages/types/package.json ./packages/types/package.json
COPY --from=proddeps /app/packages/types/dist ./packages/types/dist
COPY package.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# src/lib/i18n.ts reads the PDF fonts from __dirname/../../assets/fonts — that
# is apps/api/assets relative to apps/api/dist/lib. Same layout, or every PDF
# export fails on the first Devanagari glyph.
COPY apps/api/assets ./apps/api/assets

# The schema and its migrations, for deploy/migrate.sh.
COPY database/schema ./database/schema

# Generated HERE, on the runtime base image, so the query engine Prisma
# selects is the one for this OS, this libssl and this architecture.
# schema.prisma sets no binaryTargets, so generating in any other stage would
# be a bet that the two stages agree.
RUN node_modules/.bin/prisma generate --schema database/schema/schema.prisma

# Docker seeds an empty named volume from the image directory it is mounted
# over, ownership included — but only if the directory exists in the image.
# Without this line a fresh volume arrives owned by root and every upload
# fails with EACCES.
RUN mkdir -p /data/storage && chown -R node:node /data

USER node
EXPOSE 4300

STOPSIGNAL SIGTERM

# /api/health is LIVENESS only: it does not touch PostgreSQL. That is the
# right thing for a healthcheck, since a database blip should not restart a
# process that holds live WhatsApp sockets.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4300)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]
