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

## Verify without publishing the port

On the server, over an existing SSH session:

```bash
curl -fsS http://127.0.0.1:8787/health
```

From a computer or phone that can open SSH, forward only loopback. The placeholders are not a host, user, or key path:

```bash
ssh -N -L 8787:127.0.0.1:8787 <user>@<server>
curl -fsS http://127.0.0.1:8787/health
```

Point the app at `http://127.0.0.1:8787` only while that forward exists. The HTTP hop stays on the device. Do not put the chat port or PostgreSQL on a public address, and do not enter an `http://` URL that is not loopback. The app refuses those.

## HTTPS, when a name exists

No domain or certificate is configured. When one is:

1. Keep PostgreSQL and this process on `127.0.0.1`.
2. Allow public TCP 443 only. Do not allow 5432 or 8787 from the internet.
3. Terminate TLS in Caddy or nginx on the same machine and proxy to `127.0.0.1:8787`.
4. Set the app address to `https://<that-name>`.

Until that proxy exists, the supported remote check is the SSH local forward above.

## Tests

GitHub Actions job `chat-server` uses `pgvector/pgvector:0.8.7-pg15`, creates the same least-privilege role, and runs the server tests plus the app client tests against a fixture upstream. The fixture is labeled `openrouter-sse-not-a-model`.

```bash
cd services/qbot-chat
npm ci
npm test
npm run typecheck
```
