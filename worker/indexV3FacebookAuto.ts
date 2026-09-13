import baseWorker from './indexV3';
import { scheduleFacebookLeadRecoveryLive } from './facebookLeadRecoveryLive';
import { scheduleFacebookLeadSheetCatchup } from './facebookLeadSheetCatchup';

export default {
  async fetch(request: Request, env: unknown, ctx: any) {
    // Facebook lead recovery is intentionally NOT started from normal website/API
    // traffic. Running it here caused every visitor/request to trigger Meta lead
    // scans and could exhaust the Page leadgen API quota. The cron below is the
    // single backup/recovery runner; the webhook in indexV3 remains the real-time
    // path for new leads.
    const response = await baseWorker.fetch(request, env, ctx);
    scheduleFacebookLeadSheetCatchup(env, ctx);
    return response;
  },
  async scheduled(_controller: unknown, env: unknown, ctx: any) {
    scheduleFacebookLeadRecoveryLive(baseWorker, env, ctx);
    scheduleFacebookLeadSheetCatchup(env, ctx);
  },
};