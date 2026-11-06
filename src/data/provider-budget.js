/** Explicit allocation budgets reject exact work rather than silently changing its meaning. */
export function assertProviderBudget(job, bytes, operation) {
  const limit = job.configuration?.providerBudget ?? null;
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw new RangeError(`${operation} exceeds supported allocation sizes.`);
  if (limit !== null && bytes > limit)
    throw new RangeError(
      `${operation} needs an estimated ${bytes} provider bytes; the configured budget is ${limit}.`,
    );
  return bytes;
}
