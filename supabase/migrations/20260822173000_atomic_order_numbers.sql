create sequence if not exists public.ora_web_order_number_seq
  as bigint start with 1 increment by 1 minvalue 1 no cycle;
create sequence if not exists public.ora_fb_order_number_seq
  as bigint start with 1 increment by 1 minvalue 1 no cycle;
create sequence if not exists public.ora_tk_order_number_seq
  as bigint start with 1 increment by 1 minvalue 1 no cycle;
create sequence if not exists public.ora_man_order_number_seq
  as bigint start with 1 increment by 1 minvalue 1 no cycle;

do $$
declare
  v_max bigint;
begin
  select coalesce(max(substring(order_number from '^WEB-([0-9]+)$')::bigint), 0)
    into v_max from public.order_snapshots where order_number ~ '^WEB-[0-9]+$';
  if v_max > 0 then perform setval('public.ora_web_order_number_seq', v_max, true);
  else perform setval('public.ora_web_order_number_seq', 1, false); end if;

  select coalesce(max(substring(order_number from '^FB-([0-9]+)$')::bigint), 0)
    into v_max from public.order_snapshots where order_number ~ '^FB-[0-9]+$';
  if v_max > 0 then perform setval('public.ora_fb_order_number_seq', v_max, true);
  else perform setval('public.ora_fb_order_number_seq', 1, false); end if;

  select coalesce(max(substring(order_number from '^TK-([0-9]+)$')::bigint), 0)
    into v_max from public.order_snapshots where order_number ~ '^TK-[0-9]+$';
  if v_max > 0 then perform setval('public.ora_tk_order_number_seq', v_max, true);
  else perform setval('public.ora_tk_order_number_seq', 1, false); end if;

  select coalesce(max(substring(order_number from '^MAN-([0-9]+)$')::bigint), 0)
    into v_max from public.order_snapshots where order_number ~ '^MAN-[0-9]+$';
  if v_max > 0 then perform setval('public.ora_man_order_number_seq', v_max, true);
  else perform setval('public.ora_man_order_number_seq', 1, false); end if;
end $$;

create or replace function public.next_ora_order_number(p_prefix text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text := upper(trim(coalesce(p_prefix, '')));
  v_sequence regclass;
  v_number bigint;
begin
  v_sequence := case v_prefix
    when 'WEB' then 'public.ora_web_order_number_seq'::regclass
    when 'FB' then 'public.ora_fb_order_number_seq'::regclass
    when 'TK' then 'public.ora_tk_order_number_seq'::regclass
    when 'MAN' then 'public.ora_man_order_number_seq'::regclass
    else null
  end;
  if v_sequence is null then
    raise exception 'Unsupported O-RA order prefix: %', v_prefix using errcode = '22023';
  end if;
  v_number := nextval(v_sequence);
  return v_prefix || '-' || lpad(v_number::text, 6, '0');
end;
$$;

create or replace function public.reset_ora_order_number_sequences()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform setval('public.ora_web_order_number_seq', 1, false);
  perform setval('public.ora_fb_order_number_seq', 1, false);
  perform setval('public.ora_tk_order_number_seq', 1, false);
  perform setval('public.ora_man_order_number_seq', 1, false);
end;
$$;

revoke all on function public.next_ora_order_number(text) from public, anon, authenticated;
revoke all on function public.reset_ora_order_number_sequences() from public, anon, authenticated;
grant execute on function public.next_ora_order_number(text) to service_role;
grant execute on function public.reset_ora_order_number_sequences() to service_role;
