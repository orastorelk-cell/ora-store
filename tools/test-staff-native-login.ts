import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ACTIVE_KEY,dataBucket,readDataTable,replaceDataTable } from '../worker/cloudflareData';
import { verifyActiveStaff,withR2DataFallback } from '../worker/r2RecoveryFallback';

class MemoryBucket {
  objects=new Map<string,{value:string;etag:string;customMetadata:any}>();revision=0;failUsers=false;beforeUserSave:(()=>Promise<void>)|null=null;
  async get(key:string){const object=this.objects.get(key);return object?{...object,text:async()=>object.value}:null;}
  async put(key:string,value:string,options:any={}){
    if(key.endsWith('/admin_users.json')){if(this.failUsers)throw new Error('Synthetic account write failure');if(this.beforeUserSave){const hook=this.beforeUserSave;this.beforeUserSave=null;await hook();}}
    const previous=this.objects.get(key),condition=options.onlyIf;
    if(condition?.etagMatches&&condition.etagMatches!==previous?.etag||condition?.etagDoesNotMatch==='*'&&previous)return null;
    const etag=String(++this.revision);this.objects.set(key,{value,etag,customMetadata:options.customMetadata});return {etag};
  }
}
const raw=new MemoryBucket(),env={ORA_MEDIA_R2:raw,STAFF_SESSION_SECRET:'native-login-'+crypto.randomUUID(),ORA_R2_COMPRESSION_ENABLED:'1'};
const bucket=dataBucket(env)!,prefix='ora-data/generations/native-login/';
const password='synthetic existing password',salt=crypto.randomBytes(16).toString('hex'),legacy=salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
const hmac=(password:string)=>'cfhmac:fixture:'+crypto.createHmac('sha256',env.STAFF_SESSION_SECRET).update('fixture:'+password).digest('hex');
const initial=[{id:'legacy-admin',username:'admin',display_name:'Existing Admin',role:'admin',is_active:true,password_hash:legacy},
  {id:'disabled-staff',username:'disabled',role:'staff',is_active:false,password_hash:legacy,permissions:['orders']},
  {id:'write-failure',username:'retry',role:'staff',is_active:true,password_hash:legacy,permissions:['orders','level:orders:view']},
  {id:'reset-race',username:'reset',role:'staff',is_active:true,password_hash:legacy,permissions:['overview']}];
await bucket.put(ACTIVE_KEY,JSON.stringify({format:'ora-r2-tables-v2',prefix}));
await bucket.put(prefix+'admin_users.json',JSON.stringify(initial));
const login=(username:string,passwordValue=password)=>withR2DataFallback(new Request('https://store.test/api/staff/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:passwordValue})}),env,{},async()=>{throw new Error('Staff login must never start Express or contact Supabase');});
const originalEtag=raw.objects.get(prefix+'admin_users.json')!.etag;
assert.equal((await login('admin','wrong')).status,401);
assert.equal((await login('absent')).status,401);
assert.equal((await login('disabled')).status,403);
assert.equal(raw.objects.get(prefix+'admin_users.json')!.etag,originalEtag,'Failed and disabled logins never modify password verifiers');
const simultaneous=await Promise.all([login(' ADMIN '),login('admin')]);
assert.deepEqual(simultaneous.map(response=>response.status),[200,200],'Concurrent correct logins both survive a verifier upgrade');
for(const response of simultaneous){
  const result=await response.json();assert.equal(result.user.id,'legacy-admin');assert.equal(result.user.name,'Existing Admin');
  assert(!JSON.stringify(result).includes('password_hash'));assert(!JSON.stringify(result).includes(legacy));
  const user=await verifyActiveStaff(new Request('https://store.test/api/orders',{headers:{authorization:'Bearer '+result.token}}),env);
  assert.equal(user.id,'legacy-admin','Native login tokens retain the existing staff session signature');
}
const upgraded=(await readDataTable(env,'admin_users')).find(row=>row.id==='legacy-admin')!;
assert(upgraded.password_hash.startsWith('cfhmac:'));assert.equal(upgraded.role,'admin');
const upgradedEtag=raw.objects.get(prefix+'admin_users.json')!.etag;
assert.equal((await login('admin')).status,200);assert.equal((await login('admin','wrong')).status,401);
assert.equal(raw.objects.get(prefix+'admin_users.json')!.etag,upgradedEtag,'Later sign-ins use the lightweight verifier without writes');
raw.failUsers=true;
const optionalUpgrade=await login('retry');assert.equal(optionalUpgrade.status,200,'A failed optional migration cannot lock out a verified account');
assert.deepEqual((await optionalUpgrade.json()).user.permissions,['orders','level:orders:view']);
raw.failUsers=false;
raw.beforeUserSave=async()=>{await replaceDataTable(env,'admin_users',rows=>({rows:rows.map(row=>row.id==='reset-race'?{...row,password_hash:hmac('replacement password')}:row),result:true}));};
assert.equal((await login('reset')).status,401,'A concurrent password reset must reject the old password');
assert.equal((await login('reset','replacement password')).status,200);
console.log('PASS: native legacy and HMAC sign-in, concurrent transparent migration, unchanged credentials/roles, disabled/wrong-password rejection, optional write failure, reset race, private hashes and compatible sessions.');
