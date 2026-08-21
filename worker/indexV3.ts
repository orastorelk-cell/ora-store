import fastWorker from './indexV2';

type WorkersAiLike = { run: (model: string, input: Record<string, any>) => Promise<any> };

const SINHALA_RE = /[\u0D80-\u0DFF]/;
const KNOWN_BRANDS = new Set([
  'harpic','dettol','dove','lux','nivea','vaseline','colgate','pepsodent','lifebuoy','sunlight','vim','comfort','surf','signal',
  'samsung','xiaomi','huawei','apple','sony','philips','panasonic','anker','baseus','ugreen','ora','o-ra'
]);
const GENERIC_NAME_WORDS = new Set([
  'toilet','cleaner','cleaning','bathroom','floor','wash','liquid','soap','shampoo','cream','lotion','gel','spray','powder','bottle','water',
  'kids','kid','baby','adult','men','women','set','pack','piece','pieces','pcs','large','small','mini','premium','new','original','home','kitchen',
  'car','phone','mobile','speaker','bluetooth','wireless','charger','cable','bag','shoe','shoes','watch','toy','toys','brush','mop','holder','rack',
  'box','container','portable','smart','electric','rechargeable','multi','purpose','stainless','steel','plastic','wooden','digital','automatic','item','product'
]);

const words = (value:string) => value.match(/[A-Za-z][A-Za-z0-9+.-]*/g) || [];
const protectedTokens = (source:string) => {
  const ws = words(source);
  const out:string[] = [];
  for (let i=0;i<ws.length;i++) {
    const token = ws[i];
    const low = token.toLowerCase();
    if (KNOWN_BRANDS.has(low) || /\d/.test(token) || /^[A-Z0-9]{2,}$/.test(token)) out.push(token);
  }
  // For short product names, an unknown first title word is usually the brand.
  if (ws.length > 1 && ws.length <= 8) {
    const first = ws[0];
    if (!GENERIC_NAME_WORDS.has(first.toLowerCase()) && /^[A-Z]/.test(first) && !out.some(x=>x.toLowerCase()===first.toLowerCase())) out.unshift(first);
  }
  return out.slice(0,6);
};

const needsRepair = (source:string, translated:string) => {
  const src = source.trim();
  const tr = translated.trim();
  if (!src) return false;
  const ws = words(src);
  if (ws.length === 1 && protectedTokens(src).length) return tr.toLowerCase() !== src.toLowerCase();
  if (!tr) return true;
  if (ws.length > 1 && !SINHALA_RE.test(tr)) return true;
  if (ws.length > 1 && tr.toLowerCase() === src.toLowerCase()) return true;
  for (const token of protectedTokens(src)) if (!tr.toLowerCase().includes(token.toLowerCase())) return true;
  return false;
};

const parseJson = (raw:string, count:number) => {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    const list = Array.isArray(parsed?.translations) ? parsed.translations.map((v:any)=>String(v||'').trim()) : [];
    return list.length === count ? list : [];
  } catch { return []; }
};

const repairTranslations = async (ai:WorkersAiLike, sources:string[]) => {
  const result = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages:[
      {role:'system',content:`Translate English e-commerce text into natural, everyday Sinhala for Sri Lankan shoppers.\nRULES:\n1. Brand/model/SKU/technical tokens must remain EXACTLY in English. Never translate or invent a Sinhala version of a brand.\n2. "Harpic" -> "Harpic".\n3. "Harpic Toilet Cleaner" -> "Harpic වැසිකිළි පිරිසිදුකාරකය".\n4. "Dettol Antiseptic Liquid" must keep Dettol exactly.\n5. Generic product words should be translated naturally, not word-for-word nonsense.\n6. Descriptions must keep the original meaning only; do not invent features or claims.\n7. Never output unrelated words about family, religion, ceremonies, people or places.\n8. Return ONLY JSON exactly like {"translations":["..."]}.`},
      {role:'user',content:sources.map((s,i)=>`${i+1}. ${JSON.stringify(s)}`).join('\n')}
    ],
    temperature:0,
    max_tokens:1800,
  });
  return parseJson(String(result?.response ?? result?.result?.response ?? result?.text ?? '').trim(), sources.length);
};

export default {
  async fetch(request:Request, env:unknown, ctx:unknown) {
    const url = new URL(request.url);
    const requestCopy = request.clone();
    const response = await fastWorker.fetch(request, env, ctx);
    if (requestCopy.method !== 'POST' || url.pathname !== '/api/admin/translate-sinhala' || !response.ok) return response;

    let payload:any = {}, data:any = {};
    try { payload = await requestCopy.json(); data = await response.clone().json(); } catch { return response; }
    const sources = Array.isArray(payload?.texts) ? payload.texts.map((v:any)=>String(v||'').trim()) : [];
    const translations = Array.isArray(data?.translations) ? data.translations.map((v:any)=>String(v||'').trim()) : [];
    if (!sources.length || sources.length !== translations.length) return response;

    const badIndexes = sources.map((s:string,i:number)=>needsRepair(s,translations[i])?i:-1).filter((i:number)=>i>=0);
    if (!badIndexes.length) return response;

    const ai = (env as any)?.AI as WorkersAiLike | undefined;
    if (!ai || typeof ai.run !== 'function') return response;
    try {
      const repairSources = badIndexes.map((i:number)=>sources[i]);
      const repaired = await repairTranslations(ai, repairSources);
      if (repaired.length !== repairSources.length) return response;
      const final = [...translations];
      badIndexes.forEach((originalIndex:number,i:number)=>{
        const source = sources[originalIndex];
        const candidate = repaired[i] || '';
        if (!needsRepair(source,candidate)) final[originalIndex]=candidate;
        else if (words(source).length === 1 && protectedTokens(source).length) final[originalIndex]=source;
      });
      return new Response(JSON.stringify({...data,translations:final,provider:'cloudflare-workers-ai-70b-quality-gated'}),{
        status:200,
        headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
      });
    } catch (error) {
      console.warn('Sinhala quality repair failed:', error);
      return response;
    }
  }
};
