// Group metadata-only saves by the same partition used by the durable journal.
// Each request then stages at most one order shard and one atomic commit.
export const orderJournalShard = (id: string) => {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return String((hash >>> 0) % 16);
};
