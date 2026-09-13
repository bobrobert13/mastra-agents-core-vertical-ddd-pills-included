# ADR-005: Cross-Process Eventing via Env-Optional Redis PubSub Bridge

## Status
Accepted

**Supersedes:** [ADR-003: Event-Driven Cross-Domain Communication](./003-event-driven.md) (ADR-003 file left untouched per append-only ADR rule; supersession tracked here and in the index.)

## Context
ADR-003 established the in-process `eventBus` (EventEmitter singleton) for cross-domain traffic. The production HA compose runs 3 API replicas plus split workers: an in-process bus means domain events never leave the replica that published them, and `mastra` split workers cannot start against the default in-process `EventEmitterPubSub`. Gap analysis §1.2. We need real cross-process delivery without breaking the zero-config (`npm run dev`, no env vars) promise, and without editing existing `eventBus.publish/subscribe` call sites.

## Options Considered

### Option 1: Keep in-process bus only
- Pros: zero deps, simple, deterministic.
- Cons: silently no-ops across replicas; fake HA.

### Option 2: Env-optional `RedisStreamsPubSub` + thin bridge (chosen)
- Pros: `@mastra/redis-streams` is the first-party backend (Redis 7+ streams, consumer groups, reclaim loop); zero-config path untouched (`buildPubsub → undefined` → Mastra's default); call-site API byte-identical; also enables real split workers.
- Cons: Redis becomes a dependency for HA deployments; at-least-once semantics require care.

### Option 3: RabbitMQ/Kafka or GoogleCloudPubSub
- Pros: richer queue features.
- Cons: heavy ops surface for a boilerplate; no first-party Mastra worker support; rejected. `GoogleCloudPubSub` is kept as a doc pointer only (no `PUBSUB_BACKEND` switch) per anti-filler rule.

## Decision
1. **`buildPubsub(services)` (`shared/config/pubsub.ts`)**: `REDIS_URL` set → `new RedisStreamsPubSub({ url })` (defaults: `keyPrefix 'mastra:topic'`, `maxDeliveryAttempts 5`, `reclaimIntervalMs 30000`, `reclaimIdleMs 60000`); unset → `undefined` → in-process default. Banner reports the live mode in both branches. Prod compose runs `redis:7-alpine` with `appendonly yes`; Redis is **never host-published** (no `ports:`).
2. **Bridge (`attachEventBusBridge(pubsub?)`, exported from `shared/events`)**: all domain traffic rides topic `domain.events` as carrier `Event.type = 'domain.event'`; `{ origin, domainType, payload }` lives inside `Event.data`; `runId` carries the per-process `INSTANCE_ID`. Subscribe **without** a group → private consumer group → fan-out (every process receives every event).
3. **Ack on EVERY delivery**, including echo-guarded and malformed ones (try/finally). Unacked entries grow the Redis pending-entry list and the reclaim loop redelivers up to `maxDeliveryAttempts`, multiplying duplicate fan-out. Malformed `Event.data` (`domainType` not a string) is logged via `logger` and dropped — never thrown into the bus. The bridge has no nack path.
4. **Echo guard**: events whose `data.origin` equals this process's `INSTANCE_ID` are not re-emitted locally — in-process listeners already fired synchronously on `publish()`.
5. **Degradation is explicit, not silent**: without `REDIS_URL` the bus is guaranteed **single-process only**. `shared/AGENTS.md` states the boundary.

## Consequences
- **Easier:** replicas and workers share one event plane; split workers (`MASTRA_WORKERS=orchestration|scheduler|backgroundTasks`) become real; `npm run dev` zero-config is untouched.
- **Harder / accepted limits (best-effort bus, queue-grade parity explicitly out of scope):**
  - **At-least-once**: handlers may see duplicates — step/handler logic must be idempotent.
  - **JSON round-trip**: `Date` payload fields arrive as ISO strings.
  - `publish()` returns before remote handlers run; `ack`/`nack` are **not surfaced per handler**, so a throwing remote listener does **not** trigger redelivery.
  - **No DLQ**: events are dropped after `maxDeliveryAttempts` (default 5); a run crashed mid-step stays `running` (visible, retrievable) — no automatic retry. This is a documented Mastra limitation.
  - Exactly **one scheduler replica, ever** (multiple schedulers duplicate every cron tick).
  - Consumers needing ordering/exactly-once must use workflow steps, not the bus.
- Production Redis AUTH (`requirepass`) is a documented follow-up (ADR-005 note, adjacent to spec Q1 `redis:7-alpine` vs Valkey).
