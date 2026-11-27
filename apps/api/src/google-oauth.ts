import { Fault } from './core.js';

type Credentials={clientId:string;clientSecret:string;refreshToken:string};

export class GoogleOAuth {
 private cached?:{token:string;renewAt:number};
 private pending?:Promise<string>;

 constructor(private credentials:Credentials,private fetcher=fetch,private now=Date.now){}

 accessToken(rejected?:string):Promise<string>{
  if(this.cached&&this.cached.renewAt>this.now()&&this.cached.token!==rejected)
   return Promise.resolve(this.cached.token);
  if(!this.pending)this.pending=this.refresh().finally(()=>{this.pending=undefined;});
  return this.pending;
 }

 private async refresh():Promise<string>{
  const startedAt=this.now();
  let response:Response;
  let payload:{access_token?:unknown;expires_in?:unknown;error?:unknown};
  try{
   const {clientId,clientSecret,refreshToken}=this.credentials;
   response=await this.fetcher('https://oauth2.googleapis.com/token',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
    body:new URLSearchParams({grant_type:'refresh_token',client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken}),
   });
   payload=await response.json();
  }catch{throw new Fault('GOOGLE_OAUTH_UNAVAILABLE','Google OAuth token renewal is unavailable',503);}
  if(!response.ok){
   if(typeof payload?.error==='string'&&['invalid_grant','invalid_client','unauthorized_client','deleted_client'].includes(payload.error))
    throw new Fault('GOOGLE_OAUTH_REAUTH_REQUIRED','Google OAuth grant or client is invalid. Reauthorize Calendar access and check the server credentials.',503);
   throw new Fault('GOOGLE_OAUTH_UNAVAILABLE','Google OAuth token renewal is unavailable',503);
  }
  const token=payload?.access_token, expires=payload?.expires_in;
  if(typeof token!=='string'||!token||typeof expires!=='number'||!Number.isSafeInteger(expires)||expires<=0||startedAt+expires*1000<=this.now())
   throw new Fault('GOOGLE_OAUTH_UNAVAILABLE','Google OAuth returned an unusable token response',503);
  this.cached={token,renewAt:startedAt+expires*1000-Math.min(60000,expires*100)};
  return token;
 }
}

export function googleAuth(env:NodeJS.ProcessEnv):string|GoogleOAuth{
 const clientId=env.GOOGLE_OAUTH_CLIENT_ID?.trim();
 const clientSecret=env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
 const refreshToken=env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim();
 if(!clientId&&!clientSecret&&!refreshToken)return env.GOOGLE_ACCESS_TOKEN?.trim()??'';
 if(!clientId||!clientSecret||!refreshToken)
  throw new Fault('GOOGLE_NOT_CONFIGURED','Configure all three Google OAuth renewal variables',503);
 return new GoogleOAuth({clientId,clientSecret,refreshToken});
}
