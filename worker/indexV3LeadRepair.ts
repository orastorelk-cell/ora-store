import baseWorker from './indexV3';
import { scheduleFacebookLeadRecoveryOnce } from './facebookLeadRecoveryOnce';

export default {
  async fetch(request: Request, env: unknown, ctx: any) {
    scheduleFacebookLeadRecoveryOnce(baseWorker, env, ctx);
    return baseWorker.fetch(request, env, ctx);
  },
  async scheduled(_controller: unknown, env: unknown, ctx: any) {
    scheduleFacebookLeadRecoveryOnce(baseWorker, env, ctx);
  },
};
