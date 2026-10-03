import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { loadConfigFromFile } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';

const config=(await loadConfigFromFile({command:'build',mode:'production'}))!.config as any;
let source=fs.readFileSync('src/context/StoreContext.tsx','utf8');
for(const plugin of config.plugins.flat(Infinity))if(plugin?.name?.startsWith('ora-')&&typeof plugin.transform==='function'){
  const result=await plugin.transform(source,process.cwd()+'/src/context/StoreContext.tsx');
  if(result)source=typeof result==='string'?result:result.code;
}
const output=await build({stdin:{contents:source,loader:'tsx',resolveDir:process.cwd()+'/src/context'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',loader:{'.png':'dataurl','.jpg':'dataurl','.svg':'dataurl'},define:{'import.meta.env':'{}'}});
const target=process.cwd()+'/tools/.provider-mount-test.mjs';
fs.writeFileSync(target,output.outputFiles[0].text);
const values=new Map<string,string>();
Object.assign(globalThis,{localStorage:{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)},window:{location:{hostname:'localhost'},atob:(value:string)=>Buffer.from(value,'base64').toString('binary')}});
try{
  const { StoreProvider }=await import(target);
  assert.equal(renderToString(React.createElement(StoreProvider,null,React.createElement('span',null,'Orders remain visible'))),'<span>Orders remain visible</span>');
  console.log('PASS: patched production StoreProvider mounts without undefined state or render errors.');
}finally{fs.unlinkSync(target);}
