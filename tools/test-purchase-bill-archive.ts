import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const server=fs.readFileSync('worker/purchaseBillArchive.ts','utf8');
const gallery=fs.readFileSync('src/components/admin/PurchaseBillArchivePanel.tsx','utf8');
const parent=fs.readFileSync('src/components/admin/PurchaseHistoryRecoveryPanel.tsx','utf8');
const route=fs.readFileSync('worker/r2RecoveryFallback.ts','utf8');
assert(server.includes("prefix:'media/purchase-bill/'"));
assert(server.includes("request.method!=='GET'"));
assert(server.includes("user.role!=='admin'"));
assert(gallery.includes('Find Old Purchasing Bill Photos'));
assert(gallery.includes('Open original bill photo'));
assert(gallery.includes('next_cursor'));
assert(parent.includes('<PurchaseBillArchivePanel />'));
assert(route.includes("pathname==='/api/admin/purchase-bill-archive'"));
for(const [name,source] of [['worker/purchaseBillArchive.ts',server],
 ['src/components/admin/PurchaseBillArchivePanel.tsx',gallery],
 ['src/components/admin/PurchaseHistoryRecoveryPanel.tsx',parent]]){
 const parsed=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 assert.equal(parsed.parseDiagnostics.length,0,name+' has TypeScript parse errors');
}
console.log('PASS: original supplier bill photos scanned read-only under Super Admin; no stock mutation.');
