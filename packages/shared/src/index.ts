/** Shared, platform-neutral primitives belong here. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: Error };
