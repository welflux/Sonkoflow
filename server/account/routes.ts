import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { Identity, Services } from "../services.js";
import { AppError } from "../security.js";

const timeZone = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', {timeZone:value}); return true; } catch { return false; }
}, 'Choose a valid time zone.');
export const workDetails = z.object({
  job_title: z.string().trim().max(100),
  location: z.string().trim().max(100),
  time_zone: timeZone,
}).strict();
const emptyDetails = {job_title:'', location:'', time_zone:'UTC'};
function readDetails(value: unknown) {
  const result = workDetails.safeParse(value);
  return result.success ? result.data : {...emptyDetails};
}
export function accountRoutes(
  app: Express, svc: Services, who: (res: Response) => Identity,
  limit: (req: Request, bucket: string, max?: number, seconds?: number) => Promise<void>,
) {
  async function user(userId: string) {
    const {data, error} = await svc.admin.auth.admin.getUserById(userId);
    if (error || !data.user || data.user.id !== userId)
      throw new AppError(503, 'account_unavailable', 'Account details could not load. Please try again.');
    return data.user;
  }
  app.get('/api/account', async (_req, res) => {
    const identity = who(res);
    const account = await user(identity.userId);
    res.json({account:{
      email:account.email ?? '', email_verified:!!account.email_confirmed_at,
      created_at:account.created_at,
      providers:[...new Set((account.identities ?? []).map(item => item.provider))],
      details:readDetails(account.user_metadata?.sonkoflow_profile),

    }});
  });
  app.patch('/api/account/details', async (req, res) => {
    await limit(req, 'account-details', 20);
    const details = workDetails.parse(req.body);
    const identity = who(res);
    // Presentation metadata only: identity and entitlements always come from the server.
    const {data, error} = await svc.admin.auth.admin.updateUserById(identity.userId, {
      user_metadata:{sonkoflow_profile:details},
    });
    if (error || data.user?.id !== identity.userId)
      throw new AppError(503, 'account_save_failed', 'Your work details could not be saved. Please try again.');
    res.json({details:readDetails(data.user.user_metadata?.sonkoflow_profile)});
  });
}
