import baseWorker from './indexV3';
import { recoverRecentFacebookLeads } from './facebookLeadRecovery';

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    return baseWorker.fetch(request, env, ctx);
  },
  async scheduled(_controller: unknown, env: unknown, ctx: any) {
    const task = recoverRecentFacebookLeads(baseWorker, env, ctx).catch((error) => {
      console.error('[O-RA Meta recovery] failed:', error);
    });
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
    else await task;
  },
};
