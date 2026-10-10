// R2 objects accept one write per second. Keep this browser's stock, order,
// waybill and invoice mutations in order, including fire-and-forget mirrors.
export const createStaffMutationQueue = (gapMs = 1100, pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), now = Date.now) => {
  let tail: Promise<unknown> = Promise.resolve(), lastStarted = -Infinity;
  return {
    run<T>(action: () => Promise<T>): Promise<T> {
      const pending = tail.catch(() => {}).then(async () => {
        const wait = gapMs - (now() - lastStarted);
        if (wait > 0) await pause(wait);
        lastStarted = now();
        return action();
      });
      tail = pending;
      return pending;
    },
    async drain() { await tail.catch(() => {}); }
  };
};
