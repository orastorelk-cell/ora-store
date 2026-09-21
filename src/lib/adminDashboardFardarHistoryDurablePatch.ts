export const adminDashboardFardarHistoryDurablePatch = () => ({
  name: 'ora-admin-fardar-history-durable-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;
    if (!code.includes('Fardar CSV History')) return null;

    let text = code;

    const oldDerived = String.raw`        const fardarHistoryDates = Array.from(new Set(unifiedConfirmHistory.map(batch => unifiedHistoryDateKey(batch.at)).filter(Boolean))).sort().reverse();
        const selectedFardarHistoryDate = unifiedConfirmHistoryDate || fardarHistoryDates[0] || '';
        const selectedDateBatches = unifiedConfirmHistory
          .filter(batch => unifiedHistoryDateKey(batch.at) === selectedFardarHistoryDate)
          .sort((a,b) => new Date(b.at).getTime() - new Date(a.at).getTime());
        const selectedDateOrderNumbers = Array.from(new Set(selectedDateBatches.flatMap(batch => batch.orderNumbers)));
        const selectedDateOrders = orders.filter(order => selectedDateOrderNumbers.includes(order.order_number));
        const selectedDateReadyOrders = selectedDateOrders.filter(order =>
          order.call_center_status === 'Confirmed' &&
          order.stock_allocated &&
          Boolean(order.waybill_number) &&
          order.order_status !== 'Cancelled'
        );
        const selectedDateNewReadyOrders = selectedDateReadyOrders.filter(order =>
          order.dispatch_status !== 'Handed Over' &&
          !(
            order.fardar_csv_exported_at &&
            order.fardar_csv_exported_waybill &&
            String(order.fardar_csv_exported_waybill) === String(order.waybill_number || '')
          )
        );`;

    const newDerived = String.raw`        const activeOrderNumbers = new Set(orders.map(order => order.order_number));

        // Confirm history used to live only in this browser's localStorage.
        // Rebuild missing batch cards from durable order snapshots so previous
        // Confirm/Cancel uploads remain visible after another Staff/Admin login.
        const durableBatchMap = new Map<string, {
          orderNumbers: string[];
          uploaded: number;
          failed: number;
          ignored: number;
          errors: string[];
          fileCount: number;
          at: string;
        }>();
        orders.forEach(order => {
          const at = String(order.call_center_updated_at || '');
          const status = String(order.call_center_status || '');
          if (!at || (status !== 'Confirmed' && status !== 'Cancelled')) return;
          const rawBatchId = String((order as any).confirm_upload_batch_id || '').trim();
          const batchKey = rawBatchId || at;
          const existing = durableBatchMap.get(batchKey);
          if (existing) {
            if (!existing.orderNumbers.includes(order.order_number)) existing.orderNumbers.push(order.order_number);
            existing.uploaded = existing.orderNumbers.length;
            if (new Date(at).getTime() < new Date(existing.at).getTime()) existing.at = at;
          } else {
            durableBatchMap.set(batchKey, {
              orderNumbers: [order.order_number],
              uploaded: 1,
              failed: 0,
              ignored: 0,
              errors: [],
              fileCount: 1,
              at,
            });
          }
        });

        const durableConfirmBatches = Array.from(durableBatchMap.values());
        const mergedConfirmHistory = [
          ...unifiedConfirmHistory,
          ...durableConfirmBatches.filter(durableBatch =>
            !unifiedConfirmHistory.some(savedBatch =>
              unifiedHistoryDateKey(savedBatch.at) === unifiedHistoryDateKey(durableBatch.at) &&
              savedBatch.orderNumbers.some(orderNumber => durableBatch.orderNumbers.includes(orderNumber))
            )
          ),
        ];
        const activeSavedConfirmBatches = mergedConfirmHistory.filter(batch =>
          batch.orderNumbers.some(orderNumber => activeOrderNumbers.has(orderNumber))
        );

        // Packing's "Last Upload Result" was browser-session state only. After a
        // refresh/login, an already-confirmed durable batch could disappear even
        // though the orders (and their confirm_upload_batch_id) were still saved.
        // Reconstruct the latest source batches from durable orders so the existing
        // Packing Fardar CSV button remains available without changing live order logic.
        const fardarHistoryDates = Array.from(new Set(
          activeSavedConfirmBatches.map(batch => unifiedHistoryDateKey(batch.at)).filter(Boolean)
        )).sort().reverse();
        const selectedFardarHistoryDate = unifiedConfirmHistoryDate || fardarHistoryDates[0] || '';
        const selectedDateBatches = activeSavedConfirmBatches
          .filter(batch => unifiedHistoryDateKey(batch.at) === selectedFardarHistoryDate)
          .sort((a,b) => new Date(b.at).getTime() - new Date(a.at).getTime());
        const selectedDateOrderNumbers = Array.from(new Set(selectedDateBatches.flatMap(batch => batch.orderNumbers)));
        const selectedDateOrders = orders.filter(order =>
          selectedDateOrderNumbers.includes(order.order_number) ||
          unifiedHistoryDateKey(order.call_center_updated_at) === selectedFardarHistoryDate
        );
        const selectedDateReadyOrders = selectedDateOrders.filter(order =>
          order.call_center_status === 'Confirmed' &&
          order.stock_allocated &&
          Boolean(order.waybill_number) &&
          order.order_status !== 'Cancelled'
        );
        const selectedDateNewReadyOrders = selectedDateReadyOrders.filter(order =>
          order.dispatch_status !== 'Handed Over' &&
          !(
            order.fardar_csv_exported_at &&
            order.fardar_csv_exported_waybill &&
            String(order.fardar_csv_exported_waybill) === String(order.waybill_number || '')
          )
        );`;

    if (!text.includes(oldDerived)) throw new Error('[O-RA Fardar durable history] derived history marker not found');
    text = text.replace(oldDerived, newDerived);

    text = text.replace(
      'Saved Batches {unifiedConfirmHistory.length}',
      'Saved Batches {activeSavedConfirmBatches.length}'
    );

 
 
 
 
c
o
n
s
t
 
p
a
c
k
i
n
g
B
a
t
c
h
M
a
r
k
e
r
 
=
 
'
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
c
o
n
s
t
 
b
a
t
c
h
 
=
 
u
p
l
o
a
d
B
a
t
c
h
e
s
[
s
o
u
r
c
e
]
;
'
;


 
 
 
 
i
f
 
(
t
e
x
t
.
i
n
c
l
u
d
e
s
(
p
a
c
k
i
n
g
B
a
t
c
h
M
a
r
k
e
r
)
)
 
{


 
 
 
 
 
 
c
o
n
s
t
 
p
a
c
k
i
n
g
B
a
t
c
h
R
e
p
l
a
c
e
m
e
n
t
 
=
 
S
t
r
i
n
g
.
r
a
w
`
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
c
o
n
s
t
 
s
o
u
r
c
e
N
a
m
e
 
=
 
s
o
u
r
c
e
 
=
=
=
 
'
W
e
b
s
i
t
e
'
 
?
 
'
W
e
b
s
i
t
e
'
 
:
 
s
o
u
r
c
e
 
=
=
=
 
'
F
a
c
e
b
o
o
k
'
 
?
 
'
F
a
c
e
b
o
o
k
 
A
d
s
'
 
:
 
'
T
i
k
T
o
k
 
A
d
s
'
;


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
c
o
n
s
t
 
d
u
r
a
b
l
e
S
o
u
r
c
e
O
r
d
e
r
s
 
=
 
o
r
d
e
r
s


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
.
f
i
l
t
e
r
(
o
r
d
e
r
 
=
>
 
o
r
d
e
r
.
o
r
d
e
r
_
s
o
u
r
c
e
 
=
=
=
 
s
o
u
r
c
e
N
a
m
e
 
&
&
 
S
t
r
i
n
g
(
(
o
r
d
e
r
 
a
s
 
a
n
y
)
.
c
o
n
f
i
r
m
_
u
p
l
o
a
d
_
b
a
t
c
h
_
i
d
 
|
|
 
'
'
)
.
t
r
i
m
(
)
)


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
.
s
o
r
t
(
(
a
,
b
)
 
=
>
 
n
e
w
 
D
a
t
e
(
S
t
r
i
n
g
(
(
b
 
a
s
 
a
n
y
)
.
c
a
l
l
_
c
e
n
t
e
r
_
u
p
d
a
t
e
d
_
a
t
 
|
|
 
b
.
c
r
e
a
t
e
d
_
a
t
 
|
|
 
0
)
)
.
g
e
t
T
i
m
e
(
)
 
-
 
n
e
w
 
D
a
t
e
(
S
t
r
i
n
g
(
(
a
 
a
s
 
a
n
y
)
.
c
a
l
l
_
c
e
n
t
e
r
_
u
p
d
a
t
e
d
_
a
t
 
|
|
 
a
.
c
r
e
a
t
e
d
_
a
t
 
|
|
 
0
)
)
.
g
e
t
T
i
m
e
(
)
)
;


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
c
o
n
s
t
 
d
u
r
a
b
l
e
L
a
t
e
s
t
B
a
t
c
h
I
d
 
=
 
S
t
r
i
n
g
(
(
d
u
r
a
b
l
e
S
o
u
r
c
e
O
r
d
e
r
s
[
0
]
 
a
s
 
a
n
y
)
?
.
c
o
n
f
i
r
m
_
u
p
l
o
a
d
_
b
a
t
c
h
_
i
d
 
|
|
 
'
'
)
.
t
r
i
m
(
)
;


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
c
o
n
s
t
 
d
u
r
a
b
l
e
L
a
t
e
s
t
B
a
t
c
h
O
r
d
e
r
s
 
=
 
d
u
r
a
b
l
e
L
a
t
e
s
t
B
a
t
c
h
I
d


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
?
 
d
u
r
a
b
l
e
S
o
u
r
c
e
O
r
d
e
r
s
.
f
i
l
t
e
r
(
o
r
d
e
r
 
=
>
 
S
t
r
i
n
g
(
(
o
r
d
e
r
 
a
s
 
a
n
y
)
.
c
o
n
f
i
r
m
_
u
p
l
o
a
d
_
b
a
t
c
h
_
i
d
 
|
|
 
'
'
)
.
t
r
i
m
(
)
 
=
=
=
 
d
u
r
a
b
l
e
L
a
t
e
s
t
B
a
t
c
h
I
d
)


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
:
 
[
]
;


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
c
o
n
s
t
 
d
u
r
a
b
l
e
L
a
t
e
s
t
B
a
t
c
h
 
=
 
d
u
r
a
b
l
e
L
a
t
e
s
t
B
a
t
c
h
O
r
d
e
r
s
.
l
e
n
g
t
h


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
?
 
{


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
o
r
d
e
r
N
u
m
b
e
r
s
:
 
d
u
r
a
b
l
e
L
a
t
e
s
t
B
a
t
c
h
O
r
d
e
r
s
.
m
a
p
(
o
r
d
e
r
 
=
>
 
o
r
d
e
r
.
o
r
d
e
r
_
n
u
m
b
e
r
)
,


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
u
p
l
o
a
d
e
d
:
 
d
u
r
a
b
l
e
L
a
t
e
s
t
B
a
t
c
h
O
r
d
e
r
s
.
l
e
n
g
t
h
,


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
f
a
i
l
e
d
:
 
0
,


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
i
g
n
o
r
e
d
:
 
0
,


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
e
r
r
o
r
s
:
 
[
]
,


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
f
i
l
e
C
o
u
n
t
:
 
1
,


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
a
t
:
 
d
u
r
a
b
l
e
L
a
t
e
s
t
B
a
t
c
h
O
r
d
e
r
s
.
r
e
d
u
c
e
(
(
l
a
t
e
s
t
,
 
o
r
d
e
r
)
 
=
>
 
{


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
c
o
n
s
t
 
v
a
l
u
e
 
=
 
S
t
r
i
n
g
(
(
o
r
d
e
r
 
a
s
 
a
n
y
)
.
c
a
l
l
_
c
e
n
t
e
r
_
u
p
d
a
t
e
d
_
a
t
 
|
|
 
o
r
d
e
r
.
c
r
e
a
t
e
d
_
a
t
 
|
|
 
'
'
)
;


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
r
e
t
u
r
n
 
!
l
a
t
e
s
t
 
|
|
 
n
e
w
 
D
a
t
e
(
v
a
l
u
e
)
.
g
e
t
T
i
m
e
(
)
 
<
 
n
e
w
 
D
a
t
e
(
l
a
t
e
s
t
)
.
g
e
t
T
i
m
e
(
)
 
?
 
v
a
l
u
e
 
:
 
l
a
t
e
s
t
;


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
}
,
 
'
'
)


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
}


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
:
 
u
n
d
e
f
i
n
e
d
;


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
c
o
n
s
t
 
b
a
t
c
h
 
=
 
u
p
l
o
a
d
B
a
t
c
h
e
s
[
s
o
u
r
c
e
]
?
.
o
r
d
e
r
N
u
m
b
e
r
s
?
.
l
e
n
g
t
h


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
?
 
u
p
l
o
a
d
B
a
t
c
h
e
s
[
s
o
u
r
c
e
]


 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
:
 
d
u
r
a
b
l
e
L
a
t
e
s
t
B
a
t
c
h
;
`
;


 
 
 
 
 
 
t
e
x
t
 
=
 
t
e
x
t
.
r
e
p
l
a
c
e
(
p
a
c
k
i
n
g
B
a
t
c
h
M
a
r
k
e
r
,
 
p
a
c
k
i
n
g
B
a
t
c
h
R
e
p
l
a
c
e
m
e
n
t
)
;


 
 
 
 
}
    const oldEmpty = '<div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5 text-center text-xs font-bold text-gray-500">No Confirm / Cancel upload history for this date.</div>';
    const newEmpty = '<div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5 text-center text-xs font-bold text-gray-500">{selectedDateOrders.length > 0 ? `${selectedDateOrders.length} historical order(s) recovered from saved Confirm timestamps. Use Download Date CSV above.` : \'No Confirm / Cancel upload history for this date.\'}</div>';
    if (!text.includes(oldEmpty)) throw new Error('[O-RA Fardar durable history] empty-state marker not found');
    text = text.replace(oldEmpty, newEmpty);

    return { code: text, map: null };
  },
});
