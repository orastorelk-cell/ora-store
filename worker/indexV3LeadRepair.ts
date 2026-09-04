import baseWorker from './indexV3';
import { scheduleFacebookLeadRecoveryLive } from './facebookLeadRecoveryLive';
import { scheduleFacebookLeadSheetRepairOnce } from './facebookLeadSheetRepairOnce';

export default {
  async fetch(request: Request, env: unknown, ctx: any) {
    scheduleFacebookLeadRecoveryLive(baseWorker, env, ctx);
    scheduleFacebookLeadSheetRepairOnce(baseWorker, env, ctx);
    return baseWorker.fetch(request, env, ctx);
  },
  async scheduled(_controller: unknown, env: unknown, ctx: any) {
    scheduleFacebookLeadRecoveryLive(baseWorker, env, ctx);
    scheduleFacebookLeadSheetRepairOnce(baseWorker, env, ctx);
  },
};
