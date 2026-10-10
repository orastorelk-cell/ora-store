import { Buffer } from 'node:buffer';
import type { SheetTab } from '../src/lib/sheetConfirmRows';

export type SheetConnection = { spreadsheet_id:string; tabs:string[]; client_email:string; private_key:string; private_key_id?:string; connected_at:string; connected_by:string };
export class SheetApiError extends Error { constructor(message:string,public status=503){super(message);} }
type Network = typeof fetch;
const tokenCache=new Map<string,{token:string;expires:number}>();
const b64 = (value:string|Uint8Array) => Buffer.from(value).toString('base64url');
export const spreadsheetId = (value:unknown) => {
  const input=String(value||'').trim(),match=input.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/);
  const id=match?.[1]||input;
  if(!/^[A-Za-z0-9_-]{20,150}$/.test(id))throw new SheetApiError('Paste the Google Sheet link or its spreadsheet ID.',400);
  return id;
};
export const validateServiceAccount = async(value:unknown) => {
  if(!value||typeof value!=='object')throw new SheetApiError('Choose the Google service account JSON key file.',400);
  const account=value as Record<string,any>;
  if(account.type!=='service_account'||!/^[-a-z0-9.]+@[-a-z0-9.]+\.iam\.gserviceaccount\.com$/i.test(String(account.client_email||''))||
    typeof account.private_key!=='string'||account.private_key.length>12000||!account.private_key.startsWith('-----BEGIN PRIVATE KEY-----'))throw new SheetApiError('A valid Google service account JSON key is required.',400);
  try { await crypto.subtle.importKey('pkcs8',Buffer.from(account.private_key.replace(/-----[^-]+-----/g,'').replace(/\s/g,''),'base64'),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']); }
  catch {throw new SheetApiError('The service account private key could not be read.',400);}
  return {client_email:String(account.client_email),private_key:account.private_key,private_key_id:String(account.private_key_id||'').slice(0,150)};
};

export const sheetAccessToken = async(connection:SheetConnection,network:Network=fetch) => {
  const cacheKey=connection.client_email+':'+(connection.private_key_id||connection.connected_at);
  const cached=tokenCache.get(cacheKey);if(cached&&cached.expires>Date.now()+60000)return cached.token;
  const now=Math.floor(Date.now()/1000),header=b64(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claim=b64(JSON.stringify({iss:connection.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const unsigned=header+'.'+claim;
  const key=await crypto.subtle.importKey('pkcs8',Buffer.from(connection.private_key.replace(/-----[^-]+-----/g,'').replace(/\s/g,''),'base64'),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(unsigned)));
  const response=await network('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+b64(signature)}),signal:AbortSignal.timeout(10000)});
  const data:any=await response.json().catch(()=>null);
  if(!response.ok||typeof data?.access_token!=='string')throw new SheetApiError('Google authentication failed. Check that the service account key is active and Google Sheets API is enabled.',response.status===400?400:503);
  if(tokenCache.size>8)tokenCache.clear();
  tokenCache.set(cacheKey,{token:data.access_token,expires:Date.now()+Math.max(60,Number(data.expires_in)||3600)*1000});
  return data.access_token as string;
};
export const googleSheetRequest = async(connection:SheetConnection,path:string,body?:unknown,network:Network=fetch):Promise<any> => {
  const token=await sheetAccessToken(connection,network);
  const response=await network('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(connection.spreadsheet_id)+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  const data:any=await response.json().catch(()=>null);
  if(!response.ok){
    if(response.status===401)tokenCache.clear();
    const message=response.status===403?'Google denied Sheet access. Enable Google Sheets API and share this Sheet with '+connection.client_email+' as Editor.':response.status===404?'Google Sheet was not found. Check the Sheet link and its sharing permission.':response.status===429?'Google Sheet is temporarily busy; the saved job will retry.':'Google Sheet request failed ('+response.status+').';
    throw new SheetApiError(message,[400,401,403,404].includes(response.status)?response.status:503);
  }
  if(!data||typeof data!=='object')throw new SheetApiError('Google did not acknowledge the Sheet request.');
  return data;
};
export const sheetMetadata = (connection:SheetConnection,network?:Network) => googleSheetRequest(connection,'?fields=spreadsheetId,properties.title,sheets.properties',undefined,network);
export const readGoogleSheetTabs = async(connection:SheetConnection,network?:Network):Promise<SheetTab[]> => {
  const metadata=await sheetMetadata(connection,network);
  const properties=connection.tabs.map(title=>metadata.sheets?.find((sheet:any)=>sheet.properties?.title===title)?.properties);
  if(properties.some(value=>!value))throw new SheetApiError('A connected order tab was renamed or removed. Check the Google Sheet connection.',400);
  const query=new URLSearchParams({valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'FORMATTED_STRING'});
  for(const property of properties){
    if(property.gridProperties.columnCount>100)throw new SheetApiError('The order tab has more than 100 columns. Choose the call-center order tabs.',400);
    if(property.gridProperties.rowCount>20000)throw new SheetApiError('The order tab has more than 20,000 rows. Archive completed orders before importing.',400);
    const title="'"+String(property.title).replace(/'/g,"''")+"'";
    let n=property.gridProperties.columnCount,column='';
    while(n>0){n--;column=String.fromCharCode(65+n%26)+column;n=Math.floor(n/26);}
    query.append('ranges',title+'!A1:'+column+property.gridProperties.rowCount);
  }
  const data=await googleSheetRequest(connection,'/values:batchGet?'+query.toString(),undefined,network);
  if(!Array.isArray(data.valueRanges)||data.valueRanges.length!==properties.length)throw new SheetApiError('Google did not return every connected order tab.');
  return properties.map((property,i)=>{
    const values=data.valueRanges[i].values||[];
    if(values.length>20000)throw new SheetApiError('The order tab has more than 20,000 rows. Archive completed orders before importing.',400);
    return {sheetId:property.sheetId,title:property.title,columnCount:property.gridProperties.columnCount,values:values.map((row:any[])=>row.map(value=>String(value ?? '')))};
  });
};
