import type { Express,Request,Response } from 'express';
import type { Identity } from '../services.js';
import { uuid } from '../security.js';
import { ClaidTrial,trialInput } from './claid-trial.js';
export function claidTrialRoutes(app:Express,trial:ClaidTrial,who:(r:Response)=>Identity,limit:(q:Request,b:string,n?:number)=>Promise<void>){
 app.post('/api/claid-trial/jobs',async(q,r)=>{await limit(q,'claid-trial',10);const job=await trial.submit(who(r),trialInput.parse(q.body));r.status(202).json({job:trial.present(job)});});
 app.get('/api/claid-trial/jobs/:id',async(q,r)=>r.json({job:trial.present(await trial.get(who(r),uuid.parse(q.params.id)))}));
 app.post('/api/claid-trial/jobs/:id/recover',async(q,r)=>{await limit(q,'claid-trial-recovery',10);r.status(202).json({job:trial.present(await trial.recover(who(r),uuid.parse(q.params.id)))});});
}
