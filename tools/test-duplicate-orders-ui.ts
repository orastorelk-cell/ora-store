import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import React from 'react';
import { create,act } from 'react-test-renderer';
const target=process.cwd()+'/tools/.duplicate-orders-ui-test.mjs',originalFetch=globalThis.fetch;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
(globalThis as any).localStorage={getItem:()=> 'synthetic-token'};
let refreshed=0,approved=false;
(globalThis as any).__duplicateTestStore={refreshOrdersFromServer:async()=>{refreshed++;}};
const previous={id:'old',order_number:'WEB-000001',customer_name:'Repeat Buyer',phone:'0770000000',city:'Naiwala',created_at:new Date().toISOString(),order_source:'Website',order_status:'Delivered',total_amount:350,items:[{product_name:'Fixture item',quantity:1}]};
const order={...previous,id:'new',order_number:'WEB-000002',order_status:'New Orders',is_duplicate_order:true};
const requests:any[]=[];
globalThis.fetch=(async(url:any,options:any={})=>{
  requests.push({url:String(url),method:options.method||'GET',body:options.body&&JSON.parse(options.body)});
  if(options.method==='POST'){assert.deepEqual(JSON.parse(options.body),{action:'approve_separate',order_id:'new'});approved=true;return Response.json({ok:true});}
  const history=String(url).includes('status=approved');
  return Response.json({pending:approved?0:1,approved:approved?1:0,total:history?(approved?1:0):(approved?0:1),pairs:history?(approved?[{order:{...order,duplicate_review_status:'Approved',duplicate_reviewed_at:new Date().toISOString(),duplicate_reviewed_by_name:'Admin'},original:previous}]:[]):approved?[]:[{order,original:previous}]});
}) as typeof fetch;
let ui:any;
try{
  await build({entryPoints:['src/components/admin/DuplicateOrdersPanel.tsx'],outfile:target,bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'fixture-store',setup(builder){builder.onResolve({filter:/context\/StoreContext$/},()=>({path:'fixture',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useStore=()=>globalThis.__duplicateTestStore;',loader:'js'}));}}]});
  const {DuplicateOrdersPanel}=await import(target);
  await act(async()=>{ui=create(React.createElement(DuplicateOrdersPanel,{canEdit:true}));});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,230));});
  const content=()=>JSON.stringify(ui.toJSON());
  assert(content().includes('WEB-000001')&&content().includes('WEB-000002'),'Review must compare the previous and new order');
  const button=()=>ui.root.findAllByType('button').find((node:any)=>node.children.includes('Approve as separate order'));
  assert.equal(button().props.disabled,false);
  await act(async()=>{await button().props.onClick();});
  assert.equal(refreshed,1);assert(content().includes('approved as a separate order'));
  assert.equal(requests.filter(request=>request.method==='POST').length,1);
  await act(async()=>{ui.root.findAllByType('button').find((node:any)=>node.children[0]==='Approved (').props.onClick();});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,230));});
  assert(content().includes('Approved by ')&&content().includes('Admin'));
  await act(async()=>ui.unmount());
  approved=false;await act(async()=>{ui=create(React.createElement(DuplicateOrdersPanel,{canEdit:false}));});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,230));});
  assert.equal(button().props.disabled,true,'View-only staff cannot approve');
  console.log('PASS: duplicate comparisons, one approval request, order refresh, approval history and view-only controls.');
}finally{if(ui)await act(async()=>ui.unmount());globalThis.fetch=originalFetch;if(fs.existsSync(target))fs.unlinkSync(target);}
