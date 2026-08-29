import React, { useEffect, useMemo, useState } from 'react';
import { Save, RotateCcw, ReceiptText, Upload, ZoomIn, ZoomOut, Trash2, Crosshair, Type, MousePointer2, FileDown, Download, FileUp } from 'lucide-react';
import { Order, StoreSettings } from '../../types';
import { buildExactInvoiceSvg } from '../../lib/exactInvoiceTemplate';
import { generateOrderInvoicePDF, generatePackingTestA6AndMultiPagePDF, generatePackingTestA4FourUpPDF } from '../../lib/pdfGenerator';

interface Props {
  settings: StoreSettings;
  updateSettings:(patch:Partial<StoreSettings>)=>void;
}

type FontGroup = 'company'|'heading'|'labels'|'values'|'table'|'totals'|'notice'|'footer';
type TextStyle = { family?:string; size?:number; weight?:number; spacing?:number };

const GROUP_LABELS:Record<FontGroup,string> = {
  company:'Company',
  heading:'Heading',
  labels:'Label',
  values:'Value',
  table:'Table Text',
  totals:'Totals',
  notice:'Notice',
  footer:'Footer',
};

const sampleOrder: Order = {
  id:'preview',order_number:'WEB-000125',customer_name:'Kasun Perera',phone:'077 987 6543',
  whatsapp:'077 987 6543',address:'No. 45/2, Galle Road, Colombo 03.',city:'Colombo 03',
  payment_method:'COD',payment_status:'Pending',order_status:'Processing',
  items:[
    {product_id:'1',product_name:'Kids Toy Car',sku:'S0001',buying_price:0,unit_price:2050,quantity:2,subtotal:4100},
    {product_id:'2',product_name:'Kitchen Knife Set',sku:'S0004',buying_price:0,unit_price:3250,quantity:1,subtotal:3250},
    {product_id:'3',product_name:"Men's Watch",sku:'S0010',buying_price:0,unit_price:4550,quantity:1,subtotal:4550},
    {product_id:'4',product_name:'Tool Set',sku:'S0015',buying_price:0,unit_price:2850,quantity:1,subtotal:2850},
  ],
  subtotal:14750,delivery_fee:0,special_offer_discount:1106.25,total_amount:13643.75,
  is_advance_required:true,advance_amount:6821.88,advance_confirmed:false,order_source:'Website',
  is_synced_google_sheets:true,courier_name:'Fardar Delivery',waybill_number:'1766579',
  stock_status:'Allocated',stock_allocated:true,invoice_locked:true,
  invoice_number:'INV-WEB-000125',created_at:new Date().toISOString(),
};

const testDeliveryFee = (settings:StoreSettings) => settings.free_delivery_enabled ? 0 : Math.max(0, Number(settings.delivery_fee || 0));

const buildSingleItemTestOrder = (settings:StoreSettings): Order => {
  const delivery=testDeliveryFee(settings);
  const unit=2450;
  return {
    ...sampleOrder,
    id:'preview-1-item-memory-only',
    order_number:'TEST-1ITEM',
    invoice_number:'INV-TEST-1ITEM',
    customer_name:'1 Item Test Customer',
    address:'Temporary memory-only invoice test. Nothing is saved.',
    items:[{
      product_id:'preview-single-1',
      product_name:'Kids Scooter',
      sku:'S0004',
      main_sku:'S0004',
      product_type:'normal',
      buying_price:0,
      unit_price:unit,
      quantity:1,
      subtotal:unit,
    }],
    subtotal:unit,
    delivery_fee:delivery,
    internal_delivery_fee:Math.max(0,Number(settings.delivery_fee||0)),
    delivery_included_in_item_price:Boolean(settings.free_delivery_enabled),
    special_offer_discount:0,
    total_amount:unit+delivery,
    is_advance_required:false,
    advance_amount:0,
    waybill_number:'TEST100001',
    created_at:new Date().toISOString(),
  };
};

const buildComboItemTestOrder = (settings:StoreSettings): Order => {
  const delivery=testDeliveryFee(settings);
  const unit=3400;
  return {
    ...sampleOrder,
    id:'preview-combo-memory-only',
    order_number:'TEST-COMBO',
    invoice_number:'INV-TEST-COMBO',
    customer_name:'Combo Test Customer',
    address:'Temporary combo invoice test. Nothing is saved.',
    items:[{
      product_id:'preview-combo-1',
      product_name:'Kids Scooter + Kids Helmet Combo Pack',
      sku:'CB-S0004-S0019',
      main_sku:'CB-S0004-S0019',
      product_type:'bundle',
      bundle_components:[
        {product_id:'preview-component-1',sku:'S0004',product_name:'Kids Scooter',quantity_per_bundle:1},
        {product_id:'preview-component-2',sku:'S0019',product_name:'Kids Helmet',quantity_per_bundle:1},
      ],
      buying_price:0,
      unit_price:unit,
      quantity:1,
      subtotal:unit,
    }],
    subtotal:unit,
    delivery_fee:delivery,
    internal_delivery_fee:Math.max(0,Number(settings.delivery_fee||0)),
    delivery_included_in_item_price:Boolean(settings.free_delivery_enabled),
    special_offer_discount:0,
    total_amount:unit+delivery,
    is_advance_required:false,
    advance_amount:0,
    waybill_number:'TEST100002',
    created_at:new Date().toISOString(),
  };
};

const buildTenItemTestOrder = (settings:StoreSettings): Order => {
  const items = Array.from({length:10}, (_,i) => {
    const unitPrice = 1200 + i * 175;
    return {
      product_id:`preview-test-${i+1}`,
      product_name:`10-Item PDF Test Product ${i+1}`,
      sku:`T${String(i+1).padStart(4,'0')}`,
      buying_price:0,
      unit_price:unitPrice,
      quantity:1,
      subtotal:unitPrice,
    };
  });

  const subtotal=items.reduce((sum,item)=>sum+item.subtotal,0);
  const delivery=testDeliveryFee(settings);
  const discount=750;

  return {
    ...sampleOrder,
    id:'preview-10-item-memory-only',
    order_number:'TEST-10ITEM',
    invoice_number:'INV-TEST-10ITEM',
    customer_name:'10 Item Test Customer',
    address:'Temporary memory-only invoice test. Nothing is saved.',
    items,
    subtotal,
    delivery_fee:delivery,
    internal_delivery_fee:Math.max(0,Number(settings.delivery_fee||0)),
    delivery_included_in_item_price:Boolean(settings.free_delivery_enabled),
    special_offer_discount:discount,
    total_amount:subtotal + delivery - discount,
    waybill_number:'TEST100010',
    created_at:new Date().toISOString(),
  };
};

export const InvoiceDesignPanel:React.FC<Props>=({settings,updateSettings})=>{
  const [draft,setDraft]=useState<StoreSettings>({...settings});
  const [selectedTextId,setSelectedTextId]=useState<string>('');
  const [selectedTextLabel,setSelectedTextLabel]=useState<string>('Click a word or sentence in the invoice');
  const [selectedGroup,setSelectedGroup]=useState<FontGroup>('values');
  const [saved,setSaved]=useState(false);
  const [selectedIcon,setSelectedIcon]=useState<'call'|'location'|'web'|'whatsapp'|'facebook'|''>('');
  const [previewMode,setPreviewMode]=useState<'fit'|'actual'>('fit');
  const [testingPdf,setTestingPdf]=useState<'single'|'combo'|'ten'|'packing'|'a4'|null>(null);

  useEffect(()=>setDraft({...settings}),[settings]);

  const set=(patch:Partial<StoreSettings>)=>setDraft(prev=>({...prev,...patch}));
  const previewSvg=useMemo(()=>buildExactInvoiceSvg(sampleOrder,draft,true),[draft]);

  const fonts = useMemo(()=>{
    try { return JSON.parse(draft.invoice_custom_fonts_json || '[]') as Array<{name:string;data:string;format?:string}>; }
    catch { return []; }
  },[draft.invoice_custom_fonts_json]);

  const textStyles = useMemo<Record<string,TextStyle>>(()=>{
    try { return JSON.parse(draft.invoice_text_styles_json || '{}'); }
    catch { return {}; }
  },[draft.invoice_text_styles_json]);

  const textContent = useMemo<Record<string,string>>(()=>{
    try { return JSON.parse(draft.invoice_text_content_json || '{}'); }
    catch { return {}; }
  },[draft.invoice_text_content_json]);

  const selectedContent = selectedTextId
    ? (Object.prototype.hasOwnProperty.call(textContent, selectedTextId) ? textContent[selectedTextId] : selectedTextLabel)
    : '';

  const updateSelectedContent = (value:string) => {
    if(!selectedTextId) return;
    const next = {...textContent, [selectedTextId]: value};
    set({invoice_text_content_json: JSON.stringify(next)});
    setSelectedTextLabel(value.replace(/\r?\n/g,' / ').slice(0,90) || 'Selected Text');
  };

  const groupFallback=(suffix:'family'|'size'|'weight'|'spacing')=>{
    const key=`invoice_font_${selectedGroup}_${suffix}`;
    const defaults:any={
      company:{family:'Arial',size:28,weight:700,spacing:0},
      heading:{family:'Arial',size:34,weight:700,spacing:0},
      labels:{family:'Arial',size:24,weight:600,spacing:0},
      values:{family:'Arial',size:24,weight:400,spacing:0},
      table:{family:'Arial',size:23,weight:500,spacing:0},
      totals:{family:'Arial',size:25,weight:600,spacing:0},
      notice:{family:'Arial',size:22,weight:500,spacing:0},
      footer:{family:'Arial',size:20,weight:500,spacing:0},
    };
    return (draft as any)[key] ?? defaults[selectedGroup][suffix];
  };

  const selectedStyle:TextStyle = selectedTextId ? (textStyles[selectedTextId] || {}) : {};
  const family=String(selectedStyle.family ?? groupFallback('family'));
  const size=Number(selectedStyle.size ?? groupFallback('size'));
  const weight=Number(selectedStyle.weight ?? groupFallback('weight'));
  const spacing=Number(selectedStyle.spacing ?? groupFallback('spacing'));

  const updateSelectedStyle=(patch:TextStyle)=>{
    if(!selectedTextId) return;
    const next={...textStyles,[selectedTextId]:{...(textStyles[selectedTextId]||{}),...patch}};
    set({invoice_text_styles_json:JSON.stringify(next)});
  };

  const resetSelectedText=()=>{
    if(!selectedTextId) return;
    const nextStyles={...textStyles};
    const nextContent={...textContent};
    delete nextStyles[selectedTextId];
    delete nextContent[selectedTextId];
    set({
      invoice_text_styles_json:JSON.stringify(nextStyles),
      invoice_text_content_json:JSON.stringify(nextContent),
    });
  };

  const uploadLogo=(file?:File)=>{
    if(!file)return;
    const r=new FileReader();
    r.onload=()=>set({invoice_logo:String(r.result||'')});
    r.readAsDataURL(file);
  };

  const uploadFont=(file?:File)=>{
    if(!file)return;
    const ext=(file.name.split('.').pop()||'ttf').toLowerCase();
    const fmt=ext==='otf'?'opentype':ext==='woff'?'woff':ext==='woff2'?'woff2':'truetype';
    const baseName=file.name.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9 _-]/g,'').trim() || `Custom Font ${fonts.length+1}`;
    const uniqueName=`ORA-${baseName}-${fonts.length+1}`;
    const r=new FileReader();
    r.onload=()=>{
      const next=[...fonts,{name:uniqueName,data:String(r.result||''),format:fmt}];
      set({invoice_custom_fonts_json:JSON.stringify(next)});
      if(selectedTextId) updateSelectedStyle({family:uniqueName});
    };
    r.readAsDataURL(file);
  };

  const removeCustomFont=(name:string)=>{
    const nextFonts=fonts.filter(f=>f.name!==name);
    const nextStyles:Record<string,TextStyle>={};
    (Object.entries(textStyles) as Array<[string,TextStyle]>).forEach(([id,style])=>{
      nextStyles[id]=style.family===name ? {...style,family:'Arial'} : style;
    });
    set({
      invoice_custom_fonts_json:JSON.stringify(nextFonts),
      invoice_text_styles_json:JSON.stringify(nextStyles),
    });
  };

  // Cross-device font lock is intentionally opt-in and affects invoice design only.
  // It keeps every saved size/weight/spacing/content value unchanged and swaps only
  // the font family after the exact font file has been uploaded by the admin.
  const applyCustomFontToAllInvoiceText=(name:string)=>{
    const groups:FontGroup[]=['company','heading','labels','values','table','totals','notice','footer'];
    const patch:Record<string,unknown>={};
    groups.forEach((group)=>{ patch[`invoice_font_${group}_family`]=name; });

    const nextStyles:Record<string,TextStyle>={};
    (Object.entries(textStyles) as Array<[string,TextStyle]>).forEach(([id,style])=>{
      nextStyles[id]={...style,family:name};
    });
    patch.invoice_text_styles_json=JSON.stringify(nextStyles);
    set(patch as Partial<StoreSettings>);
    setSaved(false);
  };

  const save=()=>{
    updateSettings(draft);
    setSaved(true);
    window.setTimeout(()=>setSaved(false),1300);
  };

  const downloadTestPdf=async(kind:'single'|'combo'|'ten')=>{
    if(testingPdf) return;
    setTestingPdf(kind);
    try{
      // Test downloads intentionally use SAVED settings, not unsaved draft edits.
      // This makes the test PDF match the invoice settings that real orders use.
      const order=kind==='single'
        ? buildSingleItemTestOrder(settings)
        : kind==='combo'
          ? buildComboItemTestOrder(settings)
          : buildTenItemTestOrder(settings);
      await generateOrderInvoicePDF(order,settings);
    }catch(error:any){
      alert(error?.message || 'Could not create the test invoice PDF.');
    }finally{
      setTestingPdf(null);
    }
  };

  const downloadPackingTestPdf=async()=>{
    if(testingPdf) return;
    setTestingPdf('packing');
    try{
      await generatePackingTestA6AndMultiPagePDF(settings);
    }catch(error:any){
      alert(error?.message || 'Could not create the A6 / Multi-Page packing test PDF.');
    }finally{
      setTestingPdf(null);
    }
  };

  const downloadA4CutGuideTestPdf=async()=>{
    if(testingPdf) return;
    setTestingPdf('a4');
    try{
      await generatePackingTestA4FourUpPDF(settings);
    }catch(error:any){
      alert(error?.message || 'Could not create the A4 4-Up + Cut Guides test PDF.');
    }finally{
      setTestingPdf(null);
    }
  };

  const exportInvoiceSettings=()=>{
    const invoiceSettings = Object.fromEntries(
      Object.entries(draft).filter(([key])=>key.startsWith('invoice_'))
    );
    const payload={
      type:'O-RA_INVOICE_SETTINGS',
      version:1,
      exported_at:new Date().toISOString(),
      settings:invoiceSettings,
    };
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const date=new Date().toISOString().slice(0,10);
    a.href=url;
    a.download=`O-RA_Invoice_Settings_${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importInvoiceSettings=(file?:File)=>{
    if(!file) return;
    const r=new FileReader();
    r.onload=()=>{
      try{
        const parsed=JSON.parse(String(r.result||''));
        const source=(parsed && typeof parsed==='object' && parsed.settings && typeof parsed.settings==='object') ? parsed.settings : parsed;
        if(!source || typeof source!=='object' || Array.isArray(source)) throw new Error('Invalid invoice settings file.');
        const patch:Record<string,unknown>={};
        Object.entries(source).forEach(([key,value])=>{
          if(key.startsWith('invoice_')) patch[key]=value;
        });
        if(Object.keys(patch).length===0) throw new Error('No O-RA invoice settings were found in this file.');
        setDraft(prev=>({...prev,...patch} as StoreSettings));
        setSaved(false);
        alert('Invoice settings imported into the preview. Check the design, then click Save Invoice Design to apply them.');
      }catch(error:any){
        alert(error?.message || 'Could not import invoice settings.');
      }finally{
        const input=document.getElementById('ora-invoice-settings-import') as HTMLInputElement | null;
        if(input) input.value='';
      }
    };
    r.readAsText(file);
  };

  const resetLogo=()=>set({
    invoice_logo_scale:1,invoice_logo_x:0,invoice_logo_y:0,
    invoice_logo_width:54,invoice_logo_height:25
  });

  const handlePreviewClick=(e:React.MouseEvent<HTMLDivElement>)=>{
    const target=e.target as Element;
    const iconEl=target.closest('[data-icon-id]');
    if(iconEl){
      setSelectedIcon((iconEl.getAttribute('data-icon-id') || '') as any);
      setSelectedTextId('');
      return;
    }
    const el=target.closest('[data-text-id]');
    if(!el) return;
    setSelectedIcon('');
    const id=el.getAttribute('data-text-id') || '';
    const group=(el.getAttribute('data-font-group') || 'values') as FontGroup;
    const label=(el.textContent || '').trim() || 'Selected Text';
    setSelectedTextId(id);
    setSelectedGroup(group);
    setSelectedTextLabel(label.length>70 ? `${label.slice(0,70)}…` : label);
  };

  return <div className="space-y-5">
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2"><ReceiptText className="h-5 w-5 text-orange-400"/>A6 Invoice Design Studio</h2>
        <p className="text-xs text-neutral-400 mt-1">A6 Landscape • Readability-first print layout • Preview changes apply to invoices only after Save.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={exportInvoiceSettings} className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-xs font-black text-sky-300">
          <Download className="inline h-4 w-4 mr-1"/>Export Invoice Settings
        </button>
        <label className="cursor-pointer rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-xs font-black text-violet-300">
          <FileUp className="inline h-4 w-4 mr-1"/>Import Invoice Settings
          <input id="ora-invoice-settings-import" type="file" accept="application/json,.json" className="hidden" onChange={e=>importInvoiceSettings(e.target.files?.[0])}/>
        </label>
        <button
          type="button"
          onClick={()=>void downloadTestPdf('single')}
          disabled={Boolean(testingPdf)}
          className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-black text-emerald-300 disabled:opacity-50"
        >
          <FileDown className="inline h-4 w-4 mr-1"/>
          {testingPdf==='single'?'Creating 1-Item PDF...':'Test 1-Item Invoice PDF'}
        </button>
        <button
          type="button"
          onClick={()=>void downloadTestPdf('combo')}
          disabled={Boolean(testingPdf)}
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-black text-amber-300 disabled:opacity-50"
        >
          <FileDown className="inline h-4 w-4 mr-1"/>
          {testingPdf==='combo'?'Creating Combo PDF...':'Test Combo Invoice PDF'}
        </button>
        <button
          type="button"
          onClick={()=>void downloadTestPdf('ten')}
          disabled={Boolean(testingPdf)}
          className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-xs font-black text-sky-300 disabled:opacity-50"
        >
          <FileDown className="inline h-4 w-4 mr-1"/>
          {testingPdf==='ten'?'Creating 10-Item PDF...':'Test 10-Item Invoice PDF'}
        </button>
        <button
          type="button"
          onClick={()=>void downloadPackingTestPdf()}
          disabled={Boolean(testingPdf)}
          className="rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/10 px-4 py-2 text-xs font-black text-fuchsia-300 disabled:opacity-50"
        >
          <FileDown className="inline h-4 w-4 mr-1"/>
          {testingPdf==='packing'?'Creating Packing PDF...':'Test Packing A6 + Multi-Page'}
        </button>
        <button
          type="button"
          onClick={()=>void downloadA4CutGuideTestPdf()}
          disabled={Boolean(testingPdf)}
          className="rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-xs font-black text-violet-300 disabled:opacity-50"
        >
          <FileDown className="inline h-4 w-4 mr-1"/>
          {testingPdf==='a4'?'Creating A4 4-Up PDF...':'Test A4 4-Up + Cut Guides'}
        </button>
        <button onClick={save} className="rounded-xl bg-orange-500 px-4 py-2 text-xs font-black text-black">
          <Save className="inline h-4 w-4 mr-1"/>{saved?'Saved ✓':'Save Invoice Design'}
        </button>
      </div>
    </div>
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-[10px] font-bold text-emerald-200">All test PDFs use the last <b>saved</b> Invoice Settings and the same real PDF generators used for normal / packing invoices. Test files are memory-only and do not change real orders, Sheet rows or packing download history.</div>

    <div className="grid grid-cols-1 2xl:grid-cols-[370px_minmax(0,1fr)] gap-5">
      <div className="space-y-4">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 space-y-3">
          <p className="text-xs font-black uppercase tracking-wider text-orange-400">Invoice Logo</p>
          <label className="block cursor-pointer rounded-xl border border-dashed border-neutral-700 bg-neutral-950 p-3 text-center text-xs text-neutral-300">
            <Upload className="inline h-4 w-4 mr-1"/> Upload / Replace Invoice Logo
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e=>uploadLogo(e.target.files?.[0])}/>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={()=>set({invoice_logo_scale:Math.min(2.5,Number(draft.invoice_logo_scale||1)+.1)})} className="rounded-lg bg-neutral-800 p-2 text-xs text-white"><ZoomIn className="inline h-4 w-4"/> Zoom In</button>
            <button onClick={()=>set({invoice_logo_scale:Math.max(.3,Number(draft.invoice_logo_scale||1)-.1)})} className="rounded-lg bg-neutral-800 p-2 text-xs text-white"><ZoomOut className="inline h-4 w-4"/> Zoom Out</button>
          </div>
          {[
            ['Width','invoice_logo_width',30,90,1],
            ['Height','invoice_logo_height',12,42,1],
            ['Position X','invoice_logo_x',-140,140,1],
            ['Position Y','invoice_logo_y',-90,90,1],
          ].map(([label,key,min,max,step]:any)=><label key={key} className="block text-[11px] text-neutral-300">
            {label}: <b>{Number((draft as any)[key]||0)}</b>
            <input type="range" min={min} max={max} step={step} value={Number((draft as any)[key]||0)}
              onChange={e=>set({[key]:Number(e.target.value)} as any)} className="mt-1 w-full"/>
          </label>)}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={()=>set({invoice_logo_x:0,invoice_logo_y:0})} className="rounded-lg bg-neutral-800 p-2 text-xs text-white"><Crosshair className="inline h-4 w-4"/> Center</button>
            <button onClick={resetLogo} className="rounded-lg bg-neutral-800 p-2 text-xs text-white"><RotateCcw className="inline h-4 w-4"/> Reset Logo</button>
          </div>
          <button onClick={()=>set({invoice_logo:''})} className="w-full rounded-lg border border-red-900/60 bg-red-950/30 p-2 text-xs text-red-300"><Trash2 className="inline h-4 w-4"/> Remove Invoice Logo</button>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 space-y-3">
          <p className="text-xs font-black uppercase tracking-wider text-orange-400">Invoice Icon Editor</p>
          <p className="text-[10px] text-neutral-500">Click Address / Hotline / Web / WhatsApp / Facebook icon in the preview.</p>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-xs text-white">
            Selected: <b className="text-orange-300">{selectedIcon || 'No icon selected'}</b>
          </div>
          {selectedIcon && <>
            {[
              ['Size',`invoice_icon_${selectedIcon}_size`,12,48],
              ['Position X',`invoice_icon_${selectedIcon}_x`,-80,80],
              ['Position Y',`invoice_icon_${selectedIcon}_y`,-50,50],
            ].map(([label,key,min,max]:any)=><label key={key} className="block text-[11px] text-neutral-300">
              {label}: <b>{Number((draft as any)[key] || (label==='Size'?24:0))}</b>
              <input type="range" min={min} max={max} step="1"
                value={Number((draft as any)[key] || (label==='Size'?24:0))}
                onChange={e=>set({[key]:Number(e.target.value)} as any)} className="mt-1 w-full"/>
            </label>)}
            <label className="block cursor-pointer rounded-xl border border-dashed border-neutral-700 bg-neutral-950 p-3 text-center text-[10px] font-bold text-neutral-300">
              <Upload className="inline h-4 w-4 mr-1"/> Replace Selected Icon (PNG / SVG / WEBP)
              <input type="file" accept="image/png,image/svg+xml,image/webp" className="hidden" onChange={e=>{
                const file=e.target.files?.[0]; if(!file)return;
                const r=new FileReader(); r.onload=()=>set({[`invoice_icon_${selectedIcon}_image`]:String(r.result||'')} as any); r.readAsDataURL(file);
              }}/>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={()=>set({
                [`invoice_icon_${selectedIcon}_size`]:24,
                [`invoice_icon_${selectedIcon}_x`]:0,
                [`invoice_icon_${selectedIcon}_y`]:0,
              } as any)} className="rounded-lg bg-neutral-800 p-2 text-xs text-white">Reset</button>
              <button onClick={()=>set({[`invoice_icon_${selectedIcon}_image`]:''} as any)}
                className="rounded-lg border border-red-900/60 bg-red-950/30 p-2 text-xs text-red-300">Use Default B/W</button>
            </div>
          </>}
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 space-y-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-orange-400 flex items-center gap-2"><Type className="h-4 w-4"/>Selected Text Editor</p>
            <p className="mt-1 text-[10px] text-neutral-500">Click the exact word / sentence you want to change in the preview.</p>
          </div>

          <div className={`rounded-xl border p-3 ${selectedTextId?'border-orange-500/30 bg-orange-500/5':'border-neutral-800 bg-neutral-950'}`}>
            <p className="text-[9px] font-bold uppercase text-neutral-500">{selectedTextId ? GROUP_LABELS[selectedGroup] : 'Nothing selected'}</p>
            <p className="mt-1 text-sm font-black text-orange-300 break-words">{selectedTextLabel}</p>
          </div>

          <label className="block text-[10px] font-bold text-neutral-400">TEXT / SENTENCE
            <textarea
              disabled={!selectedTextId}
              rows={4}
              value={selectedContent}
              onChange={e=>updateSelectedContent(e.target.value)}
              placeholder="Click text in the preview, then edit it here. Press Enter for a new line."
              className="mt-1 w-full resize-y rounded-xl border border-neutral-800 bg-neutral-950 p-2 text-xs leading-5 text-white disabled:opacity-40"
            />
            <span className="mt-1 block text-[9px] font-normal text-neutral-500">Enter = new line in the invoice.</span>
          </label>

          <label className="block text-[10px] font-bold text-neutral-400">FONT STYLE / FAMILY
            <select disabled={!selectedTextId} value={family} onChange={e=>updateSelectedStyle({family:e.target.value})}
              className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 p-2 text-xs text-white disabled:opacity-40">
              <option value="Arial">Arial</option>
              <option value="Arial Black">Arial Black</option>
              <option value="Verdana">Verdana</option>
              <option value="Tahoma">Tahoma</option>
              <option value="Trebuchet MS">Trebuchet MS</option>
              <option value="Georgia">Georgia</option>
              <option value="Times New Roman">Times New Roman</option>
              <option value="Courier New">Courier New</option>
              <option value="Segoe UI">Segoe UI</option>
              <option value="Segoe Script">Segoe Script</option>
              {fonts.map(f=><option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </label>

          <label className="block cursor-pointer rounded-xl border border-dashed border-neutral-700 bg-neutral-950 p-3 text-center text-[10px] font-bold text-neutral-300">
            <Upload className="inline h-4 w-4 mr-1"/> Upload Custom Font (TTF / OTF / WOFF)
            <input type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" className="hidden" onChange={e=>uploadFont(e.target.files?.[0])}/>
          </label>

          {[
            ['Font Size',size,12,56,.5,(v:number)=>updateSelectedStyle({size:v})],
            ['Font Weight',weight,300,900,100,(v:number)=>updateSelectedStyle({weight:v})],
            ['Letter Spacing',spacing,-2,6,.1,(v:number)=>updateSelectedStyle({spacing:v})],
          ].map(([label,val,min,max,step,fn]:any)=><label key={label} className="block text-[11px] text-neutral-300">
            {label}: <b>{val}</b>
            <input disabled={!selectedTextId} type="range" min={min} max={max} step={step} value={val}
              onChange={e=>fn(Number(e.target.value))} className="mt-1 w-full disabled:opacity-40"/>
          </label>)}

          <button disabled={!selectedTextId} onClick={resetSelectedText}
            className="w-full rounded-lg bg-neutral-800 p-2 text-xs font-bold text-white disabled:opacity-40">
            <RotateCcw className="inline h-4 w-4 mr-1"/>Reset Selected Text
          </button>

          {fonts.length>0 && <div className="space-y-2 pt-2">
            <p className="text-[10px] font-bold text-neutral-500">UPLOADED FONTS</p>
            {fonts.map(f=><div key={f.name} className="rounded-lg bg-neutral-950 px-2 py-2 text-[10px] text-neutral-300">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{f.name}</span>
                <button onClick={()=>removeCustomFont(f.name)} className="text-red-400">Remove</button>
              </div>
              <button
                type="button"
                onClick={()=>applyCustomFontToAllInvoiceText(f.name)}
                className="mt-2 w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 font-black text-emerald-300"
              >
                Use This Font For All Invoice Text
              </button>
            </div>)}
            <p className="text-[9px] leading-4 text-neutral-500">
              Safe font lock: only font family changes in the Invoice Design draft. Text, sizes, weights, spacing, layout, orders, stock and Sheet data stay unchanged until you press Save Invoice Design.
            </p>
          </div>}
        </div>

        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-[10px] leading-5 text-blue-200">
          A6 PDF remains 148 × 105 mm landscape. Company Address, Hotline, WhatsApp and Email come automatically from Store Settings.
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <b className="text-xs text-orange-400">A6 READABILITY PREVIEW</b>
            <p className="text-[10px] text-neutral-500">Click one exact word or sentence. Only that text will be edited.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>setPreviewMode('fit')} className={`rounded-lg px-3 py-1.5 text-[10px] font-bold ${previewMode==='fit'?'bg-orange-500 text-black':'bg-neutral-800 text-white'}`}>Fit to Screen</button>
            <button onClick={()=>setPreviewMode('actual')} className={`rounded-lg px-3 py-1.5 text-[10px] font-bold ${previewMode==='actual'?'bg-orange-500 text-black':'bg-neutral-800 text-white'}`}>Actual Size</button>
          </div>
        </div>

        <div className="overflow-auto rounded-xl bg-neutral-950 p-4">
          <div
            onClick={handlePreviewClick}
            className={`mx-auto cursor-pointer bg-white shadow-2xl ${previewMode==='fit'?'w-full max-w-[760px]':''}`}
            style={previewMode==='actual'
              ? {width:'148mm',height:'105mm',minWidth:'148mm',minHeight:'105mm'}
              : {aspectRatio:'148 / 105'}}
            dangerouslySetInnerHTML={{__html:previewSvg}}
          />
        </div>

        <div className="mx-auto mt-3 max-w-[760px] rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-[10px] text-neutral-500">
          Print/PDF: A6 Landscape 148 × 105 mm. Actual Size uses CSS physical mm; monitor/Windows/browser scaling can still affect the physical on-screen measurement.
        </div>
      </div>
    </div>
  </div>;
};
