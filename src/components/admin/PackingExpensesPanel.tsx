import React, { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, PackageCheck, ReceiptText, Upload } from 'lucide-react';
import { uploadPublicImage } from '../../lib/imageUpload';

interface PackingExpense {
  id: string;
  expense_date: string;
  material_name: string;
  supplier_name: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  invoice_ref?: string;
  bill_image_url?: string;
  notes?: string;
  performed_by: string;
  created_at: string;
}

interface PackingExpensesPanelProps {
  canEdit: boolean;
  performedBy: string;
}

const todayKey = () => new Date().toISOString().slice(0, 10);

const blankForm = () => ({
  expense_date: todayKey(),
  material_name: '',
  supplier_name: '',
  quantity: 1,
  unit_cost: 0,
  invoice_ref: '',
  notes: '',
});

const staffHeaders = () => {
  const token = localStorage.getItem('ora_staff_session_token') || '';
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: 'Bearer ' + token } : {}),
  };
};

export const PackingExpensesPanel: React.FC<PackingExpensesPanelProps> = ({ canEdit, performedBy }) => {
  const [expenses, setExpenses] = useState<PackingExpense[]>([]);
  const [form, setForm] = useState(blankForm);
  const [billFile, setBillFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const loadExpenses = async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/packing-expenses', {
        headers: staffHeaders(),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Packing expenses could not be loaded.');
      setExpenses(Array.isArray(data?.expenses) ? data.expenses : []);
    } catch (error:any) {
      setMessage(error?.message || 'Packing expenses could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadExpenses();
  }, []);

  const allTimeTotal = useMemo(
    () => expenses.reduce((sum, row) => sum + Number(row.total_cost || 0), 0),
    [expenses],
  );

  const currentMonthTotal = useMemo(() => {
    const month = todayKey().slice(0, 7);
    return expenses
      .filter((row) => String(row.expense_date || '').startsWith(month))
      .reduce((sum, row) => sum + Number(row.total_cost || 0), 0);
  }, [expenses]);

  const saveExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canEdit || busy) return;
    if (!form.material_name.trim()) return setMessage('Packing material / expense name is required.');
    if (!(Number(form.quantity) > 0)) return setMessage('Quantity must be greater than zero.');
    if (Number(form.unit_cost) < 0) return setMessage('Unit cost cannot be negative.');

    setBusy(true);
    setMessage('');
    try {
      const billImageUrl = billFile ? await uploadPublicImage(billFile, 'packing-expense') : '';
      const quantity = Number(form.quantity);
      const unitCost = Number(form.unit_cost);
      const expense: PackingExpense = {
        id: 'pack-exp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        expense_date: form.expense_date || todayKey(),
        material_name: form.material_name.trim(),
        supplier_name: form.supplier_name.trim(),
        quantity,
        unit_cost: unitCost,
        total_cost: Math.round(quantity * unitCost * 100) / 100,
        invoice_ref: form.invoice_ref.trim() || undefined,
        bill_image_url: billImageUrl || undefined,
        notes: form.notes.trim() || undefined,
        performed_by: performedBy || 'Admin',
        created_at: new Date().toISOString(),
      };
      const next = [expense, ...expenses].slice(0, 600);
      const response = await fetch('/api/admin/packing-expenses', {
        method: 'PUT',
        headers: staffHeaders(),
        body: JSON.stringify({ expenses: next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Packing expense could not be saved.');
      setExpenses(Array.isArray(data?.expenses) ? data.expenses : next);
      setForm(blankForm());
      setBillFile(null);
      setMessage('Packing expense saved. Product stock was not changed.');
    } catch (error:any) {
      setMessage(error?.message || 'Packing expense could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-violet-500/10 p-2.5">
            <PackageCheck className="h-5 w-5 text-violet-300" />
          </div>
          <div>
            <h2 className="text-base font-black text-white">Packing Materials Expenses</h2>
            <p className="mt-1 text-xs leading-5 text-neutral-400">
              Record courier bags, tape, boxes, bubble wrap, labels and other packing costs here.
              These records are separate from product stock, stock-in purchases and FIFO allocation.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-[10px] font-bold uppercase text-neutral-500">This Month</p>
          <p className="mt-1 text-xl font-black text-violet-300">Rs. {currentMonthTotal.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-[10px] font-bold uppercase text-neutral-500">All Time</p>
          <p className="mt-1 text-xl font-black text-amber-300">Rs. {allTimeTotal.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-[10px] font-bold uppercase text-neutral-500">Entries</p>
          <p className="mt-1 text-xl font-black text-white">{expenses.length}</p>
        </div>
      </div>

      {canEdit && (
        <form onSubmit={saveExpense} className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ReceiptText className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-black text-white">Add Packing Expense</h3>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-neutral-400">
              Date
              <input type="date" required value={form.expense_date} onChange={(e)=>setForm((prev)=>({...prev,expense_date:e.target.value}))} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-white" />
            </label>
            <label className="text-xs text-neutral-400">
              Material / Expense Item
              <input required value={form.material_name} onChange={(e)=>setForm((prev)=>({...prev,material_name:e.target.value}))} placeholder="Packing tape / Courier bags / Boxes..." className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-white" />
            </label>
            <label className="text-xs text-neutral-400">
              Supplier
              <input value={form.supplier_name} onChange={(e)=>setForm((prev)=>({...prev,supplier_name:e.target.value}))} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-white" />
            </label>
            <label className="text-xs text-neutral-400">
              Supplier Invoice Ref
              <input value={form.invoice_ref} onChange={(e)=>setForm((prev)=>({...prev,invoice_ref:e.target.value}))} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-white" />
            </label>
            <label className="text-xs text-neutral-400">
              Quantity
              <input type="number" min="0.01" step="0.01" required value={form.quantity} onChange={(e)=>setForm((prev)=>({...prev,quantity:Number(e.target.value)}))} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-white" />
            </label>
            <label className="text-xs text-neutral-400">
              Unit Cost
              <input type="number" min="0" step="0.01" required value={form.unit_cost} onChange={(e)=>setForm((prev)=>({...prev,unit_cost:Number(e.target.value)}))} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-white" />
            </label>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
              <p className="text-[10px] font-bold uppercase text-neutral-500">Total Expense</p>
              <p className="mt-1 text-lg font-black text-amber-400">Rs. {(Number(form.quantity || 0) * Number(form.unit_cost || 0)).toLocaleString()}</p>
            </div>
            <label className="text-xs text-neutral-400">
              Bill Image <span className="text-neutral-600">(Optional)</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e)=>setBillFile(e.target.files?.[0] || null)} className="mt-1 block w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-300 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-500 file:px-3 file:py-1.5 file:font-bold file:text-white" />
              {billFile && <span className="mt-1 block break-all text-[10px] text-emerald-400">{billFile.name}</span>}
            </label>
            <label className="text-xs text-neutral-400 sm:col-span-2">
              Notes
              <textarea value={form.notes} onChange={(e)=>setForm((prev)=>({...prev,notes:e.target.value}))} className="mt-1 min-h-20 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-white" />
            </label>
          </div>

          <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-sm font-black text-white disabled:opacity-50">
            <Upload className="h-4 w-4" />
            {busy ? 'Saving Expense...' : 'Save Packing Expense'}
          </button>
        </form>
      )}

      {message && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs font-bold text-neutral-300">
          {message}
        </div>
      )}

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-black text-white">Packing Expense History</h3>
          <button type="button" onClick={()=>void loadExpenses()} className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-[10px] font-bold text-neutral-300">
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-neutral-500">Loading expenses...</div>
        ) : expenses.length === 0 ? (
          <div className="py-8 text-center text-xs text-neutral-500">No packing expenses recorded yet.</div>
        ) : (
          <>
            <div className="space-y-3 sm:hidden">
              {expenses.map((row)=>(
                <div key={row.id} className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-white">{row.material_name}</p>
                      <p className="mt-0.5 text-[10px] text-neutral-500">{row.expense_date} • {row.supplier_name || 'No supplier'}</p>
                    </div>
                    <p className="font-black text-amber-300">Rs. {Number(row.total_cost || 0).toLocaleString()}</p>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-neutral-400">
                    <span>Qty: <b className="text-white">{row.quantity}</b></span>
                    <span>Unit: <b className="text-white">Rs. {Number(row.unit_cost || 0).toLocaleString()}</b></span>
                    <span>Invoice: <b className="text-white">{row.invoice_ref || '-'}</b></span>
                    <span>By: <b className="text-white">{row.performed_by}</b></span>
                  </div>
                  {row.bill_image_url && <a href={row.bill_image_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] font-bold text-sky-300"><ImageIcon className="h-3 w-3"/>View Bill</a>}
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[850px] text-left text-xs text-neutral-300">
                <thead className="bg-neutral-950 text-[10px] uppercase text-neutral-500">
                  <tr>
                    <th className="p-3">Date</th>
                    <th className="p-3">Material</th>
                    <th className="p-3">Supplier</th>
                    <th className="p-3 text-center">Qty</th>
                    <th className="p-3 text-right">Unit Cost</th>
                    <th className="p-3 text-right">Total</th>
                    <th className="p-3">Invoice / Bill</th>
                    <th className="p-3">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {expenses.map((row)=>(
                    <tr key={row.id}>
                      <td className="p-3">{row.expense_date}</td>
                      <td className="p-3 font-bold text-white">{row.material_name}</td>
                      <td className="p-3">{row.supplier_name || '-'}</td>
                      <td className="p-3 text-center">{row.quantity}</td>
                      <td className="p-3 text-right">Rs. {Number(row.unit_cost || 0).toLocaleString()}</td>
                      <td className="p-3 text-right font-black text-amber-300">Rs. {Number(row.total_cost || 0).toLocaleString()}</td>
                      <td className="p-3">
                        <div>{row.invoice_ref || '-'}</div>
                        {row.bill_image_url && <a href={row.bill_image_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-sky-300"><ImageIcon className="h-3 w-3"/>View Bill</a>}
                      </td>
                      <td className="p-3">{row.performed_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
