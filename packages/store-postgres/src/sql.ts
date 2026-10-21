/** A `timestamptz` column read back as epoch milliseconds (a float8, which is exact for ms). */
export const ms = (column: string) => `(extract(epoch from ${column}) * 1000)::float8`;

/** A milliseconds parameter written as `timestamptz`. */
export const toTime = (placeholder: string) => `to_timestamp(${placeholder}::float8 / 1000)`;

/** Drivers differ on `undefined`; postgres.js rejects it. Send `null`. */
export const param = (value: unknown) => (value === undefined ? null : value);

/** A value for a `jsonb` parameter, or `null`. */
export const json = (value: unknown) => (value === undefined || value === null ? null : JSON.stringify(value));
