# SSPMA — deployment

Ashram Management on the Nirantix platform, at **https://sspma.nirantix.com**.

| | |
| --- | --- |
| Product | `sspma` |
| Environments | `prod` only, built from `main` |
| Server unit | `/opt/platform/applications/sspma/prod/app/` |
| Images | `ghcr.io/pshelke1008/sspma-api`, `ghcr.io/pshelke1008/sspma-web` |
| Database | `sspma_prod` on the platform PostgreSQL |
| Uploads | volume `prod_sspma_data`, mounted at `/data/storage` |

## Shape

One clone, one compose file, two containers:

```
browser ── Cloudflare ── Traefik ─┬─ sspma.nirantix.com/api/*  → prod-sspma-api-1  (Express, :4300)
                                  └─ sspma.nirantix.com/*      → prod-sspma-web-1  (nginx, :8080)
```

The web bundle calls `/api` on its own origin, so there is no CORS preflight
and the session cookie is host-only. Both images are tagged `prod-<short-sha>`
from the same commit, and `app-deploy.sh` checks **both** containers' revision
labels against the clone's HEAD.

The API runs as **one replica, always**. The broadcast scheduler and the
WhatsApp (Baileys) sockets live in the process; two copies would send each
scheduled broadcast twice.

## How a change reaches production

1. Merge to `main`. CI builds and publishes both images. **Nothing deploys.**
2. Actions → *Build and publish* → *Run workflow* on `main`, tick **deploy**.
   That builds (or finds) the images and asks the server to deploy
   `sspma app prod`. The tick is the approval and the run records who gave it.

Or on the server, which does exactly the same:

```bash
/opt/platform/scripts/app-deploy.sh --check
/opt/platform/scripts/app-deploy.sh --app sspma --env prod --service app
```

Either way the order is: pull both images → `deploy/migrate.sh` →
`up -d` → read the revision labels back. A failed migration stops the deploy
with the old containers still serving.

Raw `docker compose up` does not work here and is not meant to: the compose
file pins `${VERSION:?}`.

---

## First-time setup

Once. Every step runs on the server as `deploy` unless it says `sudo`.

### 0. Outside the server

- **DNS.** `sspma.nirantix.com` in the `nirantix.com` Cloudflare zone,
  pointing at the VM the same way the other application hostnames do.
- **GitHub secrets** on this repository: `DEPLOY_HOST`, `DEPLOY_SSH_KEY`,
  `DEPLOY_KNOWN_HOSTS`. The same values as the other application repositories.
  The key's forced command on the server already limits what it can do.

### 1. The database and its role

```bash
PW="$(openssl rand -hex 24)"
docker exec -i postgres psql -U postgres -v pw="$PW" <<'SQL'
CREATE ROLE sspma_prod LOGIN PASSWORD :'pw';
CREATE DATABASE sspma_prod OWNER sspma_prod;
SQL
echo "$PW"   # goes into DATABASE_URL below, then clear the terminal
```

The password goes in as a psql variable, so it never appears in the SQL text,
the shell history or `pg_stat_activity`. Hex, so it needs no URL-escaping.

`sspma_prod`, not `sspma`: this cluster holds every environment of every
product, and the env token in the name is all that keeps them apart. Created,
it is also **backed up automatically** — the platform's backup enumerates the
cluster on every run.

### 2. The secrets file

```bash
sudo install -d -m 0700 -o deploy -g deploy /opt/platform/secrets/applications/sspma
sudo install -m 0600 -o deploy -g deploy /dev/null \
     /opt/platform/secrets/applications/sspma/prod.env
```

0700 and 0600, `deploy:deploy` — what `init-secrets.sh --check` audits for.

Contents. **Credentials only.** `NODE_ENV`, `API_PORT` and the storage
settings come from the image; `WEB_ORIGIN` and `API_PUBLIC_URL` come from
compose. Setting any of those here as well does nothing for the first group
and is silently discarded for the second.

```bash
# postgres is the alias the platform PostgreSQL registers on the database network.
DATABASE_URL=postgresql://sspma_prod:<PW from step 1>@postgres:5432/sspma_prod?schema=public

# openssl rand -base64 48. Below 32 characters the API refuses to start.
# Rotating it signs everyone out, nothing worse.
SESSION_SECRET=
SESSION_TTL_HOURS=12

# openssl rand -base64 32. Encrypts stored Cloud API tokens and linked-device
# sessions. Empty disables WhatsApp rather than crashing. DO NOT ROTATE once
# set: every stored token and linked device becomes unreadable.
WHATSAPP_ENCRYPTION_KEY=

# Meta app, only if Cloud API / "Connect with Facebook" is used. In the Meta
# app, the OAuth redirect URI and webhook URL are:
#   https://sspma.nirantix.com/api/whatsapp/oauth/callback
#   https://sspma.nirantix.com/api/webhooks/whatsapp
WHATSAPP_APP_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
# true if the Meta app is shared with CAThrives — see .env.example.
WHATSAPP_WEBHOOK_OVERRIDE=false
```

No quotes around values: Compose's `env_file` keeps them literally.

### 3. The clone

```bash
sudo install -d -o deploy -g deploy /opt/platform/applications/sspma/prod
git clone -b main https://github.com/pshelke1008/sspma.in.git \
    /opt/platform/applications/sspma/prod/app
git -C /opt/platform/applications/sspma/prod/app rev-parse --abbrev-ref HEAD   # must say main
```

The directory is `app`. The workflow sends `deploy sspma app prod`, and
`app-deploy.sh` resolves it against this path — any other name matches
nothing and the deploy fails listing the units it does know.

### 4. First deploy

Run the workflow with **deploy** ticked, or the `app-deploy.sh` line above.
On an empty database `migrate.sh` applies every migration from the first,
which creates the schema.

### 5. First login

**Do not run the seed against production.** `database/seed/seed.ts` builds two
demo organisations with fictional donors, donations and bank accounts, and four
users per organisation sharing one hard-coded password printed in its output.

There is no sign-up route. The first organisation and its users come from
`apps/api/src/scripts/bootstrap-org.ts`, which ships in the API image and runs
against the production database from inside it.

Write the spec on the server, **outside the clone** so `git status` stays
clean and nobody's details get committed:

```bash
cd /opt/platform/applications/sspma/prod/app
install -m 0600 deploy/bootstrap.example.json ~/sspma-bootstrap.json
nano ~/sspma-bootstrap.json          # real organisation, real names and emails
```

- `users` needs at least one `ADMIN`. Roles are `ADMIN`, `FINANCE_MANAGER`,
  `ACCOUNTANT`, `APPROVER`.
- Leave any field blank (`""`) that you do not have; it is stored as absent.
- `extraAccounts` is optional — funds, a second bank, expense heads. The
  script always creates the minimum chart the app needs, including the six
  codes it looks up by number (`1101`, `1103`, `2100`, `4101`, `4199`,
  `5199`). Without those, donations save but **post nothing to the ledger, with
  no error**. Everything else can be added later in the app.

Dry run first — every write is made against the real database and then rolled
back:

```bash
VERSION="$(git describe --tags --always)"; export VERSION
run_bootstrap() {
  docker compose --env-file deploy/prod.env -f deploy/compose.yaml \
    run --rm -T --no-deps --label traefik.enable=false \
    api node apps/api/dist/scripts/bootstrap-org.js "$@" < ~/sspma-bootstrap.json
}
run_bootstrap --dry-run
run_bootstrap                         # for real: prints each new password ONCE
shred -u ~/sspma-bootstrap.json
```

**Demo mode.** `deploy/bootstrap.demo.json` creates the four users the login
page's "Demo accounts" panel advertises, with its password. It needs no
editing and holds no secret — the password is already in `LoginPage.tsx`:

```bash
cd /opt/platform/applications/sspma/prod/app
export VERSION="$(git describe --tags --always)"
for mode in --dry-run ""; do
  docker compose --env-file deploy/prod.env -f deploy/compose.yaml \
    run --rm -T --no-deps --label traefik.enable=false \
    api node apps/api/dist/scripts/bootstrap-org.js $mode < deploy/bootstrap.demo.json || break
done
```

The loop runs the dry run first and stops there if it fails.

Read "Known gaps" before doing this on anything that will hold real data.

The passwords are printed once and stored nowhere. Hand each to its owner and
have them change it after their first sign-in. Re-running is safe: it adds only
what is missing and never touches an existing user, so a lost password is
reset by an admin in the app, not by running this again.

---

## Checking it

```bash
cd /opt/platform/applications/sspma/prod/app
VERSION="$(git describe --tags --always)" \
    docker compose --env-file deploy/prod.env -f deploy/compose.yaml ps
for c in prod-sspma-api-1 prod-sspma-web-1; do
  docker inspect "$c" --format '{{.Name}} {{.Config.Image}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{.State.Health.Status}}'
done
git rev-parse HEAD     # both revisions must equal this

curl -fsS https://sspma.nirantix.com/api/health
curl -fsSI https://sspma.nirantix.com/donors | head -1     # 200: the SPA fallback works
```

## Rolling back

Tags are immutable, so the previous images are still in the registry:

```bash
cd /opt/platform/applications/sspma/prod/app
git checkout <previous-commit>
/opt/platform/scripts/app-deploy.sh --app sspma --env prod --service app
```

**A rollback does not roll back migrations.** Prisma has no down migrations;
if the bad release migrated, the old code runs against the new schema. Restore
the database from backup only if that combination does not work.

---

## Known gaps

- **Production is a public demo (since 2026-10-19).** The demo users exist with
  `Ashram@2026`, and the login page shows them unconditionally — one click
  signs anyone in as Admin, with access to every donor record, the ledger, user
  management and the linked WhatsApp number. **Put no real data in.** Before
  real use: gate the panel in `LoginPage.tsx` behind a build flag left off in
  `deploy/prod.env`, deactivate the four demo users (or change their
  passwords), and bootstrap the real organisation and users.
- **Uploaded files have no backup yet.** `prod_sspma_data` holds receipts and
  attachments, and the platform backs up PostgreSQL, Redis and Qdrant only. The
  volume carries `com.nirantix.backup=true` so that a volume component in the
  platform's backup framework can discover it; until that component is
  deployed and its first nightly summary names this volume, losing it loses
  every uploaded file.
- **Every client looks like a Cloudflare edge address.** Traefik trusts no
  forwarded headers (platform `SECURITY_CHECKLIST.md`, "Edge exposure
  2026-10-11"), so `req.ip` is the edge node. The login limiter — 10 failed
  attempts per 15 minutes per IP — is therefore shared by everyone behind the
  same edge, and in practice most users of an Indian deployment are. Ten bad
  passwords from anyone can lock everyone out for 15 minutes.
- **No dev environment.** Nothing runs on the platform before production. See
  the header of `.github/workflows/build.yml` for what adding one takes.
- **The API image carries the web workspace's runtime dependencies.** `npm
  prune` works by dependency type, not by workspace. Disk only; nothing loads
  them.
