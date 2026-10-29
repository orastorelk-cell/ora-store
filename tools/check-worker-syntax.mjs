import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Vite builds browser assets but does not parse Cloudflare's Worker entry tree.
 * Wrangler previously failed after Vite succeeded due to a missing ')'.
 * Run syntactic preflight BEFORE building assets so Cloudflare fails fast.
 */
const roots=['worker','src/lib'];
const files=[];
function scan(dir){
  for(const e of readdirSync(dir,{withFileTypes:true})){
    const full=join(dir,e.name);
    if(e.isDirectory())scan(full);
    else if(e.isFile() && /\.(ts|tsx)$/.test(e.name))files.push(full);
  }
}
roots.forEach(scan);
let errors=0;
for(const file of files){
  const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,
    file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  for(const diagnostic of source.parseDiagnostics){
    const loc=source.getLineAndCharacterOfPosition(diagnostic.start??0);
    const description=ts.flattenDiagnosticMessageText(diagnostic.messageText,' ');
    console.error(`[worker syntax] ${relative('.',file)}:${loc.line+1}:${loc.character+1} TS${diagnostic.code} ${description}`);
    errors++;
  }
}
if(!files.length||errors){
  console.error(`Worker build preflight failed: ${errors} syntax error(s) in ${files.length} files.`);
  process.exitCode=1;
}else{
  console.log(`Worker build syntax OK (${files.length} Worker/shared-library TypeScript files).`);
}
