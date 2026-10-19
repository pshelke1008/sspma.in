# syntax=docker/dockerfile:1
#
# sspma web — built from the REPOSITORY ROOT, not from apps/web:
#
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=/api .
#
# vite.config.ts aliases @ashram/types to packages/types/src and reads .env
# from the repository root, so an apps/web context reaches neither.
ARG NODE_IMAGE=node:22-bookworm-slim
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine

# ---------------------------------------------------------------------------
# deps — the root `prepare` script builds @ashram/types during `npm ci`, so
# that package's sources have to be here before the install.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types packages/types
COPY packages/config packages/config
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# ---------------------------------------------------------------------------
# builder — compile the Vite bundle.
#
# VITE_API_URL is compiled INTO the bundle. Pointing this app at a different
# API is a rebuild, never a restart. CI reads it from deploy/<env>.env, the same
# file the server hands to `docker compose --env-file`, so the bundle and the
# Traefik router cannot disagree.
#
# It must be non-empty. vite.config.ts uses `env.VITE_API_URL ?? fallback`, and
# `??` keeps an empty string — the bundle would then request /auth/me from its
# own origin, get index.html back from the SPA fallback, and fail on JSON.parse.
# An unset one is worse: it falls back to http://localhost:4300/api, which works
# on the developer's machine and nowhere else.
# ---------------------------------------------------------------------------
FROM deps AS builder
COPY apps/web apps/web
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN test -n "$VITE_API_URL" || { echo "ERROR: VITE_API_URL build arg is required" >&2; exit 1; }
RUN npm run build -w @ashram/web

# ---------------------------------------------------------------------------
# runtime — nginx serving the static bundle.
#
# The unprivileged variant runs as uid 101, listens on 8080 and keeps its pid
# and temp files under /tmp, so it runs under read_only: true with a /tmp tmpfs.
# ---------------------------------------------------------------------------
FROM ${NGINX_IMAGE} AS runtime

ARG VERSION=dev
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="SSPMA" \
      org.opencontainers.image.description="Ashram Management web app (React + Vite SPA)" \
      org.opencontainers.image.vendor="Nirantix" \
      org.opencontainers.image.licenses="Proprietary" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      com.nirantix.product="sspma" \
      com.nirantix.service="web" \
      com.nirantix.team="platform"

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

# busybox wget ships in the alpine base.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
