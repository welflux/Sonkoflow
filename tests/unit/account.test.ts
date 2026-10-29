import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {accountRoutes} from '../../server/account/routes.js';
function fixture(fail=false) {
  let metadata:any={sonkoflow_profile:{job_title:'Photographer',location:'Cape Town',time_zone:'Africa/Johannesburg'},other:'retained'};
  let sessions:any[]=[
    {id:'current',user_id:'owner',purpose:'account',created_at:'2026-10-29T08:00:00Z',expires_at:'2099-01-01T00:00:00Z',tokens:'private-token'},
    {id:'other',user_id:'owner',purpose:'account',created_at:'2026-10-28T08:00:00Z',expires_at:'2099-01-01T00:00:00Z',tokens:'private-token'},
    {id:'foreign',user_id:'another-owner',purpose:'account',created_at:'2026-10-28T08:00:00Z',expires_at:'2099-01-01T00:00:00Z',tokens:'private-token'},
  ];
  const calls:any[]=[];
  const admin:any={auth:{admin:{
    async getUserById(id:string){calls.push(['get-user',id]);return {data:{user:{id,email:'owner@example.test',email_confirmed_at:'2026-01-01',created_at:'2026-01-01',identities:[{provider:'google',identity_data:{secret:'not-public'}}],user_metadata:metadata,app_metadata:{private:'not-public'}}},error:fail?{}:null};},
    async updateUserById(id:string,input:any){calls.push(['update-user',id,input]);metadata={...metadata,...input.user_metadata};return {data:{user:{id,user_metadata:metadata}},error:fail?{}:null};},
  }},from(table:string){assert.equal(table,'app_sessions');const filters:any[]=[];let deleting=false;
    const query:any={select(){return query;},delete(){deleting=true;return query;},eq(key:string,value:any){filters.push((row:any)=>row[key]===value);return query;},neq(key:string,value:any){filters.push((row:any)=>row[key]!==value);return query;},gt(key:string,value:any){filters.push((row:any)=>row[key]>value);return query;},order(){return query;},limit(){return query;},then(resolve:any){const matches=sessions.filter(row=>filters.every(f=>f(row)));if(deleting&&!fail)sessions=sessions.filter(row=>!matches.includes(row));return Promise.resolve({data:matches,error:fail?{}:null}).then(resolve);}};return query;
  }};
  const app=express();app.use(express.json());
  accountRoutes(app,{admin} as any,()=>({id:'current',userId:'owner'}) as any,async()=>{});
  app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status??400).json({error:{code:error.code??'invalid_input'}}));
  return {app,calls,sessions:()=>sessions,metadata:()=>metadata};
}
test('account overview is owner scoped and exposes no session IDs, tokens or auth metadata',async()=>{
 const f=fixture();const r=await request(f.app).get('/api/account');assert.equal(r.status,200);assert.equal(r.body.account.email,'owner@example.test');assert.deepEqual(r.body.account.providers,['google']);assert.equal(r.body.account.sessions.length,2);assert.equal(r.body.account.sessions[0].current,true);assert(!JSON.stringify(r.body).match(/private-token|not-public|foreign|"id"/));assert.deepEqual(f.calls,[['get-user','owner']]);
});
test('work details update only bounded presentation metadata for the authenticated owner',async()=>{
 const f=fixture();const details={job_title:'  Designer ',location:'London',time_zone:'Europe/London'};
 const r=await request(f.app).patch('/api/account/details').send(details);assert.equal(r.status,200);assert.equal(r.body.details.job_title,'Designer');assert.equal(f.metadata().other,'retained');assert.equal(f.calls[0][1],'owner');assert.deepEqual(Object.keys(f.calls[0][2]),['user_metadata']);
 for(const extra of [{time_zone:'Invented/Place'},{job_title:'x'.repeat(101)},{user_id:'another-owner'},{plan:'pro'}])assert.equal((await request(f.app).patch('/api/account/details').send({...details,...extra})).status,400);
});
test('signing out other sessions preserves the current session and every other owner',async()=>{
 const f=fixture();assert.equal((await request(f.app).post('/api/account/sessions/revoke-others').send({user_id:'another-owner'})).status,400);
 assert.equal((await request(f.app).post('/api/account/sessions/revoke-others').send({})).status,200);assert.deepEqual(f.sessions().map(s=>s.id),['current','foreign']);
});
test('account storage failures never return a fabricated save or session revocation success',async()=>{
 const f=fixture(true);assert.equal((await request(f.app).get('/api/account')).status,503);
 assert.equal((await request(f.app).patch('/api/account/details').send({job_title:'',location:'',time_zone:'UTC'})).status,503);
 assert.equal((await request(f.app).post('/api/account/sessions/revoke-others').send({})).status,503);assert.equal(f.sessions().length,3);
});
