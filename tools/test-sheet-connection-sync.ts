import assert from 'node:assert/strict';
import { watchSavedSheetConnection, type SheetConnectionState } from '../src/lib/sheetConnectionSync';

const connection={connected:true,spreadsheet_id:'saved-server-sheet',tabs:['FACEBOOK ORDERS'],client_email:'account@example.test'};
const timers=new Map<number,{task:()=>void;delay:number}>();let next=0;
const clock={schedule:(task:()=>void,delay:number)=>{timers.set(++next,{task,delay});return next;},cancel:(id:unknown)=>{timers.delete(id as number);}};
const states:SheetConnectionState[]=[];
let calls=0;
const mobile=watchSavedSheetConnection(async()=>{
  if(++calls===1)throw Object.assign(new Error('Network gateway busy'),{status:503});
  return {ok:true,connection};
},state=>states.push(state),clock);
await mobile.refresh();
assert.equal(states.at(-1)?.connection,null,'A failed read must not claim that setup is missing');
assert.match(states.at(-1)?.error||'',/gateway/);
const retry=Array.from(timers.values())[0];assert.equal(retry.delay,5000);
timers.clear();retry.task();await mobile.refresh();
assert.deepEqual(states.at(-1)?.connection,connection,'A new device recovers the saved server connection without a key upload');
assert.equal(states.at(-1)?.error,'');assert.equal(timers.size,0);
const pcStates:SheetConnectionState[]=[];
const pc=watchSavedSheetConnection(async()=>({connection}),state=>pcStates.push(state),clock);
await pc.refresh();assert.deepEqual(pcStates.at(-1)?.connection,states.at(-1)?.connection);
mobile.stop();pc.stop();

const missingStates:SheetConnectionState[]=[];let setupCompleted=false;
const missing=watchSavedSheetConnection(async()=>({connection:setupCompleted?connection:{connected:false}}),state=>missingStates.push(state),clock);
await missing.refresh();assert.equal(missingStates.at(-1)?.connection?.connected,false);
assert.equal(Array.from(timers.values())[0].delay,30000);
setupCompleted=true;await missing.refresh();assert.equal(missingStates.at(-1)?.connection?.connected,true);assert.equal(timers.size,0);
missing.stop();

const forbidden=watchSavedSheetConnection(async()=>{throw Object.assign(new Error('Confirm Upload permission required.'),{status:403});},()=>{},clock);
await forbidden.refresh();assert.equal(timers.size,0,'Permission failures must not produce repeated automatic requests');forbidden.stop();

let resolve!:(data:any)=>void;let notifications=0,reads=0;
const stopped=watchSavedSheetConnection(()=>{reads++;return new Promise(r=>{resolve=r;});},()=>{notifications++;},clock);
const first=stopped.refresh(),second=stopped.refresh();assert.equal(first,second);assert.equal(reads,1);
stopped.stop();resolve({connection});await first;assert.equal(notifications,1,'An unmounted or signed-out device must not accept a late response');
console.log('PASS: mobile first-read failure recovery, shared saved connection, setup on another device, permission errors, single-flight requests and safe unmount.');
