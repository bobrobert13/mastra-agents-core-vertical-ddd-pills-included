/**
 * Factory for domain event definitions.
 *
 * Eliminates the boilerplate of repeating `type` + `payload` + `timestamp`
 * across every domain event interface. Each call produces a type-tagged
 * marker + a constructor helper.
 *
 * @example
 * ```typescript
 * export const taskCreatedEvent = createEvent('task.created')<{
 *   taskId: string;
 *   title: string;
 * }>();
 *
 * // Type: EventDef<'task.created', {...}>
 * // Instance: makeEvent(taskCreatedEvent, { taskId, title })
 * ```
 */

/** Base shape of every domain event. */
export interface DomainEvent<
  Type extends string = string,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  type: Type;
  payload: P;
  timestamp: Date;
}

/**
 * Event definition marker — holds the literal `type` string and the
 * inferred payload shape. `createEvent` returns this object.
 */
export interface EventDef<
  Type extends string = string,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly type: Type;
  // Phantom: captures payload shape on the type only.
  readonly __payload: P;
}

/** Alias for backward compat / explicit typing. */
export type DomainEventCtor<
  Type extends string = string,
  P extends Record<string, unknown> = Record<string, unknown>,
> = EventDef<Type, P>;

/**
 * Define a domain event. Returns a marker object with the literal `type`
 * and the inferred payload shape.
 */
export function createEvent<Type extends string>(type: Type) {
  return <P extends Record<string, unknown> = Record<string, unknown>>(): EventDef<Type, P> => ({
    type,
    __payload: undefined as unknown as P,
  });
}

/**
 * Construct an event instance from a definition. The `timestamp` is set
 * automatically — callers never forget it. `type` comes from the marker
 * so there's no string duplication.
 */
export function makeEvent<Def extends EventDef>(
  def: Def,
  payload: Def['__payload']
): DomainEvent<Def['type'], Def['__payload']> {
  return { type: def.type, payload, timestamp: new Date() };
}
