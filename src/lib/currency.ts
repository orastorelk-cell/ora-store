/** O-RA customer prices are collected in whole Sri Lankan Rupees. */
export const roundLkr = (value: unknown): number => {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
};

/** Display an LKR amount without cents, rounded to the nearest Rupee. */
export const formatLkr = (value: unknown): string =>
  roundLkr(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
