/** Error metadata that remains actionable after crossing a worker boundary. */
export const STRUCTURED_ERROR_FIELDS = [
  'name', 'accepted', 'durable', 'slot', 'action', 'completed', 'status',
  'scheduledUnknown', 'fatalRetirement', 'terminationConfirmed', 'durationMs',
];

export function structuredErrorFields(error) {
  const fields = {};
  for (const name of STRUCTURED_ERROR_FIELDS) {
    if (error?.[name] !== undefined) fields[name] = error[name];
  }
  return fields;
}

export function failureEventFields(error) {
  return {
    error: error?.message ?? String(error),
    durationMs: Number.isFinite(error?.durationMs) ? error.durationMs : null,
    ...structuredErrorFields(error),
  };
}
