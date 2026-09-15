/**
 * A business-rule refusal raised from inside a query-layer transaction, where
 * the check and the write must happen under the same lock and so cannot be
 * split into "route checks, then query writes".
 *
 * Thrown inside `withTransaction`, it rolls the transaction back; the error
 * handler turns it into `{ error }` with this status.
 *
 *   404  the thing referred to does not exist
 *   409  it exists, but its current state refuses the change
 *   422  the request names something that doesn't fit (e.g. a complaint that
 *        isn't on this meeting's agenda)
 */
export class DomainError extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

/** Postgres unique_violation — also raised by migration 004's agenda triggers. */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "23505"
  );
}
