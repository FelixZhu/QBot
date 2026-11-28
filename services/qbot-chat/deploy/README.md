# Deploying qbot-chat

Production updates this service by publishing the `services/qbot-chat` tree, not the whole monorepo. Runtime files the process reads must live inside this directory.

## Runtime files that travel with this tree

| Path in this service | Used by |
| --- | --- |
| `docs/card-package/v1.schema.json` | Card-package import validator (`src/card-import/schema.ts`) |
| `migrations/*.sql` | `src/migrate.ts` |
| `dsh/qbot.cordis.patch.yml` | DSH runtime |
| `seed/` | Optional `npm run seed` (not required to start the server) |

The published contract for the schema also lives at repo-root `docs/card-package/v1.schema.json`. The two copies must stay byte-identical; `test/schema-packaging.test.ts` fails if they drift. Do not point the validator at a path outside this service (for example `/opt/qbot/docs/...`). A deploy that only rsyncs `services/qbot-chat` would miss that file.

## Production sync

Take the tree from GitHub `main` (or the release SHA), not a dirty local checkout. After backups, and after confirming there is no running turn:

```bash
# Stop the service before installing dependencies on a small host (no swap).
# Reuse existing node_modules when package-lock.json is unchanged.
# If the lockfile changed, run `npm ci` only after `systemctl stop qbot-chat.service`.

rsync -a --delete --exclude='node_modules' \
  <staged>/services/qbot-chat/ \
  /opt/qbot/services/qbot-chat/

chown -R qbot:qbot /opt/qbot/services/qbot-chat
```

This rsync includes `docs/card-package/v1.schema.json`. The destination is the service directory, so `--delete` cannot remove a leftover host copy at `/opt/qbot/docs/card-package/v1.schema.json` (that path is outside the destination). After a release that contains this change, the running process reads only the in-tree file at `/opt/qbot/services/qbot-chat/docs/card-package/v1.schema.json` and no longer depends on the host-level path.

Then run migrations from the service directory as the `qbot` role, start `qbot-chat.service`, and check `GET /health`. Do not print environment-file secrets.
