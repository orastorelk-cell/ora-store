create or replace function public.ora_storage_usage_by_bucket()
returns table(bucket_name text, total_bytes bigint, object_count bigint)
language sql
security definer
set search_path = public, storage
as $$
  select
    o.bucket_id::text as bucket_name,
    coalesce(sum(
      case
        when (o.metadata ->> 'size') ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint
        else 0
      end
    ), 0)::bigint as total_bytes,
    count(*)::bigint as object_count
  from storage.objects o
  group by o.bucket_id
  order by o.bucket_id;
$$;

revoke all on function public.ora_storage_usage_by_bucket() from public;
revoke all on function public.ora_storage_usage_by_bucket() from anon;
revoke all on function public.ora_storage_usage_by_bucket() from authenticated;
grant execute on function public.ora_storage_usage_by_bucket() to service_role;
