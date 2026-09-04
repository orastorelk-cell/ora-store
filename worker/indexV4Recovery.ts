import baseWorker from './indexV3';
import { recoverRecentFacebookLeads } from './facebookLeadRecovery';

const MANUAL_RECOVERY_PATH = '/api/integrations/meta/recover-now-6c91e7d2';
const RECOVERY_INTERVAL_MS = 5 * 60 * 1000;

let nextRecoveryAt = 0;
let recoveryInFlight: Promise<unknown> | null = null;

const scheduleRecovery = (env: unknown, ctx: any) => {
  const now = Date.now();
  if (recoveryInFlight || now < nextRecoveryAt) return;

  nextRecoveryAt = now + RECOVERY_INTERVAL_MS;
  const task = recoverRecentFacebookLeads(baseWorker, env, ctx)
    .catch((error) => {
      console.error('[O-RA Meta recovery] failed:', error);
    })
    .finally(() => {
      recoveryInFlight = null;
    });

  recoveryInFlight = task;
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
};

export default {
  async fetch(request: Request, env: unknown, ctx: any) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === MANUAL_RECOVERY_PATH) {
      try {
        const summary = await recoverRecentFacebookLeads(baseWorker, env, ctx);
        return new Response(JSON.stringify({ ok: true, summary }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
        });
      } catch (error: any) {
        return new Response(JSON.stringify({ ok: false, error: String(error?.message || error) }), {
          status: 500,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
    }

    // Safety net: do not rely only on Cloudflare Cron. Any normal site/API traffic
    // can kick the same idempotent recovery path at most once every 5 minutes per isolate.
    scheduleRecovery(env, ctx);
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
