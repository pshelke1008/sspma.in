#!/usr/bin/env bash
#
# Applies pending Prisma migrations. Run by the platform's app-deploy.sh after
# the new images are pulled and before any container is replaced; a non-zero
# exit stops the deploy with the old code still serving.
#
# app-deploy.sh runs this from the repository root and exports ENVIRONMENT and
# VERSION. VERSION matters: compose.yaml pins ${VERSION:?}, so `run --rm api`
# migrates with the image ABOUT to be deployed. Migrating with the running one
# would apply the old migration set and report success.
#
# A brand-new, empty database is fine here, unlike some sibling apps:
# `migrate deploy` applies every migration in database/schema/migrations from
# the first, which creates the schema. What it does not create is a user —
# see deploy/DEPLOY.md, "First login".

set -euo pipefail

cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.."

: "${ENVIRONMENT:?ENVIRONMENT is required — normally exported by app-deploy.sh}"
: "${VERSION:?VERSION is required — normally exported by app-deploy.sh}"

echo "prisma migrate deploy  (environment=${ENVIRONMENT} version=${VERSION})"

# --no-deps: the web container has nothing to do with a migration.
# traefik.enable=false: `compose run` copies the service's labels, so without
#   this the one-off container registers as a second backend for the API
#   router and Traefik sends it live requests it never answers.
# node_modules/.bin/prisma, not npx: npx wants a writable npm cache under
#   $HOME, and the root filesystem is read-only.
docker compose --env-file "deploy/${ENVIRONMENT}.env" -f deploy/compose.yaml \
    run --rm -T --no-deps --label traefik.enable=false \
    api node_modules/.bin/prisma migrate deploy --schema database/schema/schema.prisma
