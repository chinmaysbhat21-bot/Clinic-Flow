import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GoogleOAuth,googleAuth } from '../../apps/api/src/google-oauth.js';
import { GoogleAdapter } from '../../apps/api/src/adapters.js';

const credentials={clientId:'fixture-client',clientSecret:'fixture-secret',refreshToken:'fixture-refresh'};
const slot={doctorId:'fixture-doctor',start:'2026-12-01T03:30:00.000Z',end:'2026-12-01T04:00:00.000Z'};

test('OAuth exchanges the refresh grant, deduplicates calls and renews before expiry',async()=>{
 let now=0,calls=0;
 const auth=new GoogleOAuth(credentials,async(url,init)=>{
  assert.equal(url,'https://oauth2.googleapis.com/token');
  assert.equal(init?.method,'POST');
  assert.equal(String(init?.body),'grant_type=refresh_token&client_id=fixture-client&client_secret=fixture-secret&refresh_token=fixture-refresh');
  assert.ok(init?.signal);
  return Response.json({access_token:'token-'+ ++calls,expires_in:3600});
 },()=>now);
 assert.deepEqual(await Promise.all([auth.accessToken(),auth.accessToken()]),['token-1','token-1']);
 now=3539999;
 assert.equal(await auth.accessToken(),'token-1');
 now=3540000;
 assert.equal(await auth.accessToken(),'token-2');
 now=7200001;
 assert.equal(await auth.accessToken(),'token-3');
 assert.equal(googleAuth({GOOGLE_ACCESS_TOKEN:'fixture-static'}),'fixture-static');
 assert.throws(()=>googleAuth({GOOGLE_ACCESS_TOKEN:'fixture-static',GOOGLE_OAUTH_CLIENT_ID:'fixture-client'}),{code:'GOOGLE_NOT_CONFIGURED'});
});

test('Calendar uses one refresh for concurrent 401s and retries only once',async()=>{
 let calls=0;
 const auth=new GoogleOAuth(credentials,async()=>Response.json({access_token:'token-'+ ++calls,expires_in:3600}));
 const headers:string[]=[];
 const adapter=new GoogleAdapter(auth,'test','Asia/Kolkata',async(_,init)=>{
  const header=new Headers(init?.headers).get('Authorization')!;
  headers.push(header);
  return header==='Bearer token-1'?new Response(null,{status:401}):Response.json({calendars:{test:{busy:[]}}});
 });
 assert.deepEqual(await Promise.all([adapter.getSlots(slot),adapter.getSlots(slot)]),[[],[]]);
 assert.equal(calls,2);
 assert.equal(headers.filter(h=>h==='Bearer token-2').length,2);
 let rejected=0;
 const denied=new GoogleAdapter(auth,'test','Asia/Kolkata',async()=>{
  rejected++;
  return new Response(null,{status:401});
 });
 await assert.rejects(denied.getSlots(slot),{code:'PROVIDER_REJECTED'});
 assert.equal(rejected,2);
});

test('OAuth failures are sanitized and a timed-out Calendar write is not replayed',async()=>{
 for(const error of ['invalid_grant','invalid_client','unauthorized_client','deleted_client']){
  const auth=new GoogleOAuth(credentials,async()=>Response.json({error,error_description:credentials.refreshToken},{status:400}));
  await assert.rejects(auth.accessToken(),(reason:Error&{code?:string})=>{
   assert.equal(reason.code,'GOOGLE_OAUTH_REAUTH_REQUIRED');
   return !Object.values(credentials).some(value=>String(reason).includes(value));
  });
 }
 const timeout=new GoogleOAuth(credentials,async()=>{throw new DOMException(credentials.clientSecret,'TimeoutError');});
 await assert.rejects(timeout.accessToken(),{code:'GOOGLE_OAUTH_UNAVAILABLE',message:'Google OAuth token renewal is unavailable'});
 const auth=new GoogleOAuth(credentials,async()=>Response.json({access_token:'fictional-access',expires_in:3600}));
 let writes=0;
 const adapter=new GoogleAdapter(auth,'test','Asia/Kolkata',async(url,init)=>{
  if(init?.method==='POST'&&String(url).endsWith('/events')){writes++;throw new DOMException('Response lost','TimeoutError');}
  if(String(url).endsWith('/freeBusy'))return Response.json({calendars:{test:{busy:[]}}});
  return new Response(null,{status:404});
 });
 await assert.rejects(adapter.confirmBooking({...slot,id:'11111111-1111-4111-8111-111111111111',patientId:'fixture'}),{code:'PROVIDER_UNAVAILABLE'});
 assert.equal(writes,1);
});
