# ADR-008: Application Data in Mastra Storage Databases (Custom Tables, Domain-Owned Repositories)

## Status
Accepted

## Context
The task-management tools were decorative: `create_task` fabricated a
`task_<timestamp>_<random>` id and persisted nothing (gap analysis §1.4).
Spec 05 adds real persistence, but the plan inherited from the gap analysis —
"`MastraCompositeStore.getStore()` + drizzle custom tables" — turned out to
be a **non-existent API** in `@mastra/core@1.66.0`:

- `getStore()` only routes fixed built-in domain keys
  (`@mastra/core/dist/storage/base.d.ts:229,277` — `getStore<K extends keyof
  StorageDomains>`), and the LibSQL adapter implements exactly those domains
  (`@mastra/libsql/dist/storage/index.d.ts:4-27`); there is no
  custom-tables surface.
- `LibSQLStore.client` is `private` (no raw-connection escape hatch);
  `PostgresStore` exposes `get pool(): Pool` but only on the pg branch —
  while zero-config runs on LibSQL.
- Adapters auto-create **their own** tables on `init()` (opt-out via
  `disableInit`); anything else is invisible to them.
- Reaching the `Mastra` instance from a tool is a dead end too:
  `context.mastra?.getStorage()` hits the same wall, and importing
  `src/mastra/index.ts` from domain code is a circular dependency.
- `drizzle-orm` is not installed; the repo's "no new DB dependency" rule
  (zero-config, env-optional infra) stands.

The decision here is where application rows (`app_tasks`) live and who owns
their schema.

## Options Considered

### Option 1: Piggyback on a built-in storage domain (e.g. `memory`)
Store tasks inside a domain Mastra already manages.

**Pros:**
- No new connection code; migration handled by the adapter.

**Cons:**
- Opaque row shapes we do not control; schema is coupled to Mastra's
  internals and can change under us; queries (status filters, optimistic
  locks) become contortions against a foreign KV schema.

### Option 2: A separate application database
A dedicated DB instance/connection string for app rows.

**Pros:**
- Clean separation of concerns; independent lifecycle.

**Cons:**
- Violates the zero-config promise (new required dependency or a second
  fallback path), doubles ops burden for a boilerplate, and forces
  cross-database consistency between task rows and their schedules — which
  Mastra persists in the *storage* database.

### Option 3 (chosen): Same database, thin driver-level access, domain-owned tables
`src/mastra/shared/config/db.ts` exposes `resolveDbTarget()` + lazy
`getAppDb()` returning an `AppDatabase` (`execute` / `query` / `close` /
`dialect`) implemented over `@libsql/client` (`createClient`) and `pg`
(`Pool`) — both already present transitively via `@mastra/libsql` /
`@mastra/pg` and **promoted to direct dependencies** (never relying on
hoisting). URL resolution mirrors `buildStorage()`: `DATABASE_URL`
(postgres…) → `LIBSQL_URL` → `file:./mastra.db`. Tables are owned by the
domains: `task-management/repo.ts` holds all task SQL + `ensureTaskSchema()`,
and receives an `AppDatabase` as a parameter (test-seamable, no lazy import
by accident).

**Pros:**
- Same file/URL as storage ⇒ a task row and its schedule row are one
  database apart from nothing; single-URL ops story preserved; zero-config
  intact; plain SQL, full control of indexes and the `version`
  optimistic-lock column; `:memory:` LibSQL makes the unit tier hermetic.

**Cons:**
- Custom tables sit OUTSIDE Mastra's migration system (see Consequences);
  `getStore()` gives no help — all schema code is ours.

## Decision
Adopt Option 3. `AppDatabase` + `createTaskRepository(db)` with the concrete
`app_tasks` DDL from spec 05 §3.2:

```sql
CREATE TABLE IF NOT EXISTS app_tasks (
  id           TEXT PRIMARY KEY,           -- crypto.randomUUID()
  resource_id  TEXT NOT NULL DEFAULT 'default',
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL CHECK (status    IN ('pending','in-progress','completed')),
  priority     TEXT NOT NULL CHECK (priority  IN ('low','medium','high')),
  due_date     TEXT,                        -- ISO 8601
  schedule_id  TEXT,                        -- mastra.schedules row id once scheduled
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1   -- optimistic concurrency
);
CREATE INDEX IF NOT EXISTS idx_app_tasks_resource_status ON app_tasks (resource_id, status);
```

Timestamps are ISO-8601 TEXT (this ADR) rather than dialect-native
`TIMESTAMPTZ`: one identical DDL string serves LibSQL and Postgres, no
driver-level Date parsing drift between dialects (`Date` conversion happens
in one mapper, `repo.ts:toTask`). The `app_` table prefix makes ownership
visible at a glance against Mastra-managed tables.

## Consequences
- **Migrations are ours, forever.** `ensureTaskSchema()` runs lazily, once
  per process on first repository use (`CREATE TABLE IF NOT EXISTS` +
  index). Future column additions are **additive-only**
  (`ADDITIVE_COLUMN_MIGRATIONS`, guarded by column introspection —
  `PRAGMA table_info` / `information_schema.columns`); never destructive.
  CI integration (Postgres leg of the same suite) catches dialect drift.
- Mastra's `prune()`/retention and `disableInit` intentionally do **not**
  cover app tables; nothing in the platform will clean or create them.
- Multi-process writers against one LibSQL `file:` DB rely on WAL +
  `busy_timeout` (LibSQL default 5000 ms, `LibSQLConfig.connectionTimeoutMs`)
  for local files — the single-process zero-config caveat; real multi-process
  is the Postgres + Redis topology (spec 02 / ADR-005).
- New domains needing rows follow the same pattern: a `<domain>/repo.ts`,
  dialect-portable DDL, `AppDatabase` injected — `shared/` never learns
  about tables (`shared/config/db.ts` stays a connection factory).
- Scheduling is NOT part of this decision: `schedule_task` uses the
  platform `mastra.schedules` service (storage `schedules` domain), so
  schedule rows stay Mastra-managed while the task row keeps only the
  derived `schedule_id` pointer.
