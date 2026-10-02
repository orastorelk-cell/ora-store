import { configureCloudflareData } from './cloudflareData';
import { withR2DataFallback } from './r2RecoveryFallback';
import baseWorker from './indexV3';
import { scheduleFacebookLeadRecoveryLive } from './facebookLeadRecoveryLive';
import { scheduleFacebookLeadSheetCatchup } from './facebookLeadSheetCatchup';
import { compactR2StorageOnce } from './r2StorageCompression';

export default {
  async fetch(request: Request, env: unknown, ctx: any) {
    return withR2DataFallback(request, env, ctx, async () => {
      // Facebook lead recovery is intentionally NOT started from normal website/API
      // traffic. Running it here caused every visitor/request to trigger Meta lead
      // scans and could exhaust the Page leadgen API quota. The cron below is the
      // single backup/recovery runner; the webhook in indexV3 remains the real-time
      // path for new leads.
      // A normal dashboard read must not also scan, decrypt and rewrite recent
      // orders in a background Sheet catch-up job. Cron owns that retry work.
      return baseWorker.fetch(request, env, ctx);
    });
  },
  async scheduled(_controller: unknown, env: unknown, ctx: any) {
    configureCloudflareData(env);
    scheduleFacebookLeadRecoveryLive(baseWorker, env, ctx);
    scheduleFacebookLeadSheetCatchup(env, ctx);
    ctx.waitUntil(compactR2StorageOnce(env).catch(()=>console.warn('R2 storage compression will retry on the next cron run.')));
  },
};
