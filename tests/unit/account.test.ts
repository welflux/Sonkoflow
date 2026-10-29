import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {accountRoutes} from '../../server/account/routes.js';
function fixture(fail=false) {
  let metadata:any={sonkoflow_profile:{job_title:'Photographer',location:'Cape Town',time_zone:'Africa/Johannesburg'},other:'retained'};
  const calls:any[]=[];
  const admin:any={auth:{admin:{
    async getUserById(id:string){calls.push(['get-user',id]);return {data:{user:{id,email:'owner@example.test',email_confirmed_at:'2026-01-01',created_at:'2026-01-01',identities:[{provider:'google',identity_data:{secret:'not-public'}}],user_metadata:metadata,app_metadata:{private:'not-public'}}},error:fail?{}:null};},
    async updateUserById(id:string,input:any){calls.push(['update-user',id,input]);metadata={...metadata,...input.user_metadata};return {data:{user:{id,user_metadata:metadata}},error:fail?{}:null};},
  }}};
  const app=express();app.use(express.json());
  accountRoutes(app,{admin} as any,()=>({id:'current',userId:'owner'}) as any,async()=>{});
  app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status??400).json({error:{code:error.code??'invalid_input'}}));
  return {app,calls,metadata:()=>metadata};
}
test('account overview is owner scoped and exposes no session IDs, tokens or auth metadata',async()=>{
 const f=fixture();const r=await request(f.app).get('/api/account');assert.equal(r.status,200);assert.equal(r.body.account.email,'owner@example.test');assert.deepEqual(r.body.account.providers,['google']);assert.equal(r.body.account.sessions,undefined);assert(!JSON.stringify(r.body).match(/private-token|not-public|foreign|"id"/));assert.deepEqual(f.calls,[['get-user','owner']]);
});
test('work details update only bounded presentation metadata for the authenticated owner',async()=>{
 const f=fixture();const details={job_title:'  Designer ',location:'London',time_zone:'Europe/London'};
 const r=await request(f.app).patch('/api/account/details').send(details);assert.equal(r.status,200);assert.equal(r.body.details.job_title,'Designer');assert.equal(f.metadata().other,'retained');assert.equal(f.calls[0][1],'owner');assert.deepEqual(Object.keys(f.calls[0][2]),['user_metadata']);
 for(const extra of [{time_zone:'Invented/Place'},{job_title:'x'.repeat(101)},{user_id:'another-owner'},{plan:'pro'}])assert.equal((await request(f.app).patch('/api/account/details').send({...details,...extra})).status,400);
});
test('account storage failures never return a fabricated save',async()=>{
 const f=fixture(true);assert.equal((await request(f.app).get('/api/account')).status,503);
 assert.equal((await request(f.app).patch('/api/account/details').send({job_title:'',location:'',time_zone:'UTC'})).status,503);
});
