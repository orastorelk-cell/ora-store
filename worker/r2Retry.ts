// R2 permits one write per object per second. Confirm uploads, catalog stock
// saves and the admin history can overlap on that same object. Retry only
// transient binding failures; corruption, permissions and failed CAS conditions
// still propagate to their existing guards.
export const transientR2Failure = (error: any): boolean =>
  [429, 500, 502, 503, 504, 507].includes(Number(error?.status || error?.statusCode || error?.code)) ||
  /\b(?:429|500|502|503|504|507)\b|too many requests|rate.?limit|slowdown|temporarily unavailable|internal error/i.test(String(error?.message || error));

export const pauseR2Conflict = (attempt:number) => new Promise<void>(resolve=>
  setTimeout(resolve,1100+Math.min(attempt,3)*200+Math.floor(Math.random()*250)));

export const retryR2Operation = async <T>(operation: () => Promise<T>): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= 2 || !transientR2Failure(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, 1100 * (attempt + 1) + Math.floor(Math.random() * 250)));
    }
  }
};
