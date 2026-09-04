import baseWorker from './indexV3';
import { scheduleFacebookLeadRecoveryLive } from './facebookLeadRecoveryLive';
import { scheduleFacebookLeadSheetCatchup } from './facebookLeadSheetCatchup';

export default {
  async fetch(request: Request, env: unknown, ctx: any) {
    scheduleFacebookLeadRecoveryLive(baseWorker, env, ctx);
    const response = await baseWorker.fetch(request, env, ctx);
    scheduleFacebookLeadSheetCatchup(env, ctx);
    return response;
  },
  async scheduled(_controller: unknown, env: unknown, ctx: any) {
    scheduleFacebookLeadRecoveryLive(baseWorker, env, ctx);
    scheduleFacebookLeadSheetCatchup(env, ctx);
  },
};