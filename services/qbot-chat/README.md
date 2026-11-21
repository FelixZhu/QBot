# QBot chat server

One Node.js process for Qian's personal chat. Conversation turns run in one shared DeepSeek Harness (`@deepseek-ai/dsh` 0.2.2-rc.5) subprocess, profile `sdk-minimal` plus [`dsh/qbot.cordis.patch.yml`](dsh/qbot.cordis.patch.yml). That patch unmounts the shell, filesystem, working-directory, and `danger-full-access` rows. The model route is `dsh-llm-pi-ai` provider `openrouter`, model `deepseek/deepseek-v4.1-flash-1017`, which is not in the installed pi-ai catalog and is declared in the patch.

PostgreSQL stores the agent row, the conversation, and the messages the app reloads. DSH keeps its own JSONL session under `QBOT_DSH_HOME`. The conversation row stores only that session id. The two stores are not rewritten to match each other.

DSH 0.2.2-rc.5 has no per-session cancel method. Aborting a turn closes the shared subprocess. The next turn starts it again and resumes the saved session. There is one process for every conversation, not a process per Bot.

The prepared host still has Node.js 22.23.2. This service needs Node.js >= 24.9 because that is the engine `@deepseek-ai/dsh@0.2.2-rc.5` declares. Install Node 24 beside Node 22 and point the service unit at it. Do not replace the host Node that other software already uses until that is a separate change. PostgreSQL remains 15.19, UTF8, locale `C.utf8`, pgvector 0.8.7. This service does not open PostgreSQL or the chat port on a public interface.

A fixture upstream is not a DeepSeek or OpenRouter acceptance test. Without `OPENROUTER_API_KEY` set to a real key, this repo cannot show a live model reply.

## HTTP

| Method | Path | Auth | Body |
|---|---|---|---|
| GET | `/health` | no | `{ ok, postgres }` |
| GET | `/v1/session` | bearer | `{ ownerId, agentId, model, upstream }` |
| GET | `/v1/conversations` | bearer | `{ conversations }` |
| POST | `/v1/conversations` | bearer | optional `{ title }` |
| GET | `/v1/conversations/:id/messages` | bearer | `{ messages }` |
| POST | `/v1/conversations/:id/messages` | bearer | `{ text }` then assistant-ui SSE |

`upstream` is `openrouter` or `fixture`. A fixture is a test double, not a model acceptance. The client cannot send `model`, `messages`, `role`, `system`, `persona`, `owner`, or `kind`. The server loads the agent row and complete history, then calls the model adapter.

SSE is `text/event-stream` from `assistant-stream` (`text-delta` chunks, then `[DONE]`). A failure after headers is an `error` chunk. A failure before headers is JSON.

A POST is not idempotent. A second send after the first run finished appends another user turn. A second send while a run is still `running` returns 409. Cancelling the HTTP request aborts the model call and marks the run `cancelled`. If the final write fails, the SSE error is `回复没有写入数据库` and the assistant row stays `failed` or `pending`. The process start marks leftover `running` runs and `pending` messages `failed`. Nothing is filled in with a local demo sentence.

Context is the agent persona plus at most 40 complete messages and about 24 000 characters, dropping the oldest first. The persona and model are written by the server. The default model is `deepseek/deepseek-v4.1-flash-1017`.

## Database

Run this on the server as the PostgreSQL superuser, against the maintenance database. The password prompt keeps the secret out of the command line. Use the locale the cluster already has (`C.utf8` on the prepared host; some images spell it `C.UTF-8`).

```bash
sudo -u postgres createuser --pwprompt --no-superuser --no-createdb --no-createrole qbot
sudo -u postgres createdb --owner=qbot --encoding=UTF8 --locale=C.utf8 --template=template0 qbot
sudo -u postgres psql -d qbot -v ON_ERROR_STOP=1 -c "REVOKE ALL ON DATABASE qbot FROM PUBLIC; GRANT CONNECT, TEMPORARY ON DATABASE qbot TO qbot;"
```

`password_encryption` should already be `scram-sha-256`. Confirm `listen_addresses` is `localhost` and stop if it is a wildcard. Do not change it to every interface.

```bash
sudo -u postgres psql -c "SHOW listen_addresses;"
sudo -u postgres psql -c "SHOW hba_file;"
sudo -u postgres psql -c "SHOW password_encryption;"
```

Insert the two lines from [`deploy/pg_hba.snippet.conf`](deploy/pg_hba.snippet.conf) before any broader `host ... ident` rule. The current prepared host authenticates TCP localhost with `ident`, which Node cannot use. Then reload:

```bash
sudo -u postgres psql -c "SELECT pg_reload_conf();"
psql -h 127.0.0.1 -U qbot -d qbot -c "SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user;"
```

Expect `qbot` and `f`. pgvector 0.8.7 is not a trusted extension. The runtime role must not create it. `npm run migrate` uses `DATABASE_MIGRATE_URL` (a superuser connected to the app database) for `001_vector.sql`, then the runtime role for `002_chat.sql`.

## Environment

Copy [`.env.example`](.env.example) to a mode 600 file outside the repo. The service file gets `DATABASE_URL` only. Keep `DATABASE_MIGRATE_URL` out of the long-running service.

Required for the process: `DATABASE_URL`, `QBOT_OWNER_ID`, `QBOT_ACCESS_TOKEN`, `OPENROUTER_API_KEY`.

Optional: `OPENROUTER_MODEL` (default is the exact id above), `HOST` (default `127.0.0.1`, loopback only), `PORT` (default `8787`).

Test only: `QBOT_FIXTURE_UPSTREAM=1` and `QBOT_FIXTURE_UPSTREAM_URL` on `127.0.0.1`. Leave both unset on the server.

## Commands

On PostgreSQL 15 the `public` schema is not writable by a `NOINHERIT` role, even when that role owns the database. As the local superuser, connected to this database, give the runtime role the schema before migrating. Do not print the passwords:

```sql
ALTER SCHEMA public OWNER TO qbot;
```

```bash
cd services/qbot-chat
npm ci
node -v   # this service: v24.9 or newer; the rest of the host may stay on v22.23.2
export DATABASE_URL='postgres://qbot:replace-with-role-password@127.0.0.1:5432/qbot'
export DATABASE_MIGRATE_URL='postgres://postgres:replace-with-superuser-password@127.0.0.1:5432/qbot'
npm run migrate
npm run check-db
QBOT_CHECK_LISTEN=1 npm run check-db
npm start
```

`check-db` fails unless the runtime role is not a superuser, the database is UTF8 and `C.utf8` (or `C.UTF-8`), and `vector` is installed in this database. `QBOT_CHECK_LISTEN=1` also requires `listen_addresses` to be loopback. There is no vector column in the chat tables.

An example unit is [`deploy/qbot-chat.service`](deploy/qbot-chat.service). Replace `ExecStart` with the absolute path of Node >= 24.9, not the Node 22 binary already on the host. Replace `After=` with the PostgreSQL unit that is already running. Set `QBOT_DSH_HOME` in the environment file to a mode 700 directory. Do not put `OPENROUTER_API_KEY` in the app or in git.

## Upstream connection

The DSH child starts with `--dns-result-order=ipv4first` and `--no-network-family-autoselection`, so a host that has an IPv6 answer but no IPv6 route does not stall the model request. A transport failure before any text is retried twice inside the same turn (`maxRetries: 2`). The phone is told to send again. The log line is `upstream error code=...` and does not include the model key.

If `package-lock.json` did not change, restart the process after replacing these files. Do not run `npm ci` on a small host.

## Personal trial

The default process still requires `QBOT_ACCESS_TOKEN`. Set `QBOT_PERSONAL_OPEN=1` in the private env file only for this one-person trial. That flag skips the bearer check on the existing chat and history routes. It does not open PostgreSQL, a shell, or any other route. Unset it to require the token again.

The phone build reads `EXPO_PUBLIC_QBOT_ORIGIN` at publish time. Leave it unset in git. Set it to the HTTPS origin already in front of this process only in the private publish environment.

## Cards

`QBOT_FEED_OPEN` stays off. Feed, follow, and card routes keep requiring `QBOT_ACCESS_TOKEN`. If that flag is later set, a request without a bearer can list, mint, and read only a public card on a public bot. Follow acts for the configured owner and only on a public bot. A private bot and a followers-only card stay unreachable. The flag does not skip the bearer on chat. These routes set no CORS header, and follow accepts only JSON.

`authored_at` on the two cards is when the text was recorded, `2026-11-21T09:21:18Z`. `published_at` is the clock of the first successful seed and is not rewritten later. The seed does not delete conversations. A second run does not publish them again, and it does not follow Qbot again after an unfollow.

```bash
cd services/qbot-chat
npm run migrate
QBOT_SEED_CONFIRM=cards npm run seed
npm run seed-keys
```

`package-lock.json` is unchanged, so do not run `npm ci`. Restart the existing process. `npm run upload-seed` refuses. Put the printed keys in the private bucket with the existing helper. This repo does not upload and does not change a bucket ACL. Do not set `QBOT_OBJECT_ROOT` on the host.

The server reads objects with `QBOT_OSS_ENDPOINT`, `QBOT_OSS_BUCKET`, `QBOT_OSS_ACCESS_KEY_ID`, and `QBOT_OSS_ACCESS_KEY_SECRET`. `QBOT_OSS_KEY_PREFIX` must stay under `qbot/`. The default is `qbot/cards/`, then `<artifact id>/v<version>/<file>`. A phone receives a ten-minute token for that exact artifact version. The token is in the file path so relative CSS and SVG use the same grant. A public bot does not make a non-public card readable.

## Verify on the server

PostgreSQL and this process stay on `127.0.0.1`. Do not publish 5432 or 8787. This repository does not record the public name.

On the server:

```bash
curl -fsS http://127.0.0.1:8787/health
```

The body is `{"ok":true,"postgres":"up"}`. It has no key and no access token.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/v1/session
```

With the flag unset, that code is `401`, and the same path with the operator token is `200`. With `QBOT_PERSONAL_OPEN=1`, the path is `200` without a token. The JSON has `model` and `upstream`, and no API key.

The phone certificate must already be trusted. A non-loopback origin in the private publish environment must be `https://`.

## Tests

GitHub Actions job `chat-server` uses `pgvector/pgvector:0.8.7-pg15`, creates the same least-privilege role, and runs the server tests plus the app client tests against a fixture upstream. The fixture is labeled `openrouter-sse-not-a-model`.

```bash
cd services/qbot-chat
npm ci
npm test
npm run typecheck
```
