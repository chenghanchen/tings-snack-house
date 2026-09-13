-- Run AFTER customer-accounts-migration.sql. Additive; preserves existing addresses and orders.
begin;
alter table public.customer_addresses
  add column if not exists unit text not null default '' check (char_length(unit) <= 40),
  add column if not exists city text not null default '' check (char_length(city) <= 80),
  add column if not exists state text not null default '' check (state = '' or state ~ '^[A-Z]{2}$'),
  add column if not exists zip text not null default '' check (zip = '' or zip ~ '^[0-9]{5}(-[0-9]{4})?$');

create or replace function public.get_my_customer_details() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '请先登录' using errcode = '28000'; end if;
  return jsonb_build_object(
    'full_name', coalesce((select full_name from public.customer_profiles where user_id=auth.uid()),''),
    'phone', coalesce((select phone from public.customer_profiles where user_id=auth.uid()),''),
    'address', coalesce((select address from public.customer_addresses where user_id=auth.uid()),''),
    'unit', coalesce((select unit from public.customer_addresses where user_id=auth.uid()),''),
    'city', coalesce((select city from public.customer_addresses where user_id=auth.uid()),''),
    'state', coalesce((select state from public.customer_addresses where user_id=auth.uid()),''),
    'zip', coalesce((select zip from public.customer_addresses where user_id=auth.uid()),''));
end $$;

create or replace function public.save_my_customer_details_v2(
  p_full_name text, p_phone text, p_address text, p_unit text, p_city text, p_state text, p_zip text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(coalesce(p_full_name,'')); v_phone text := trim(coalesce(p_phone,''));
  v_address text := trim(coalesce(p_address,'')); v_unit text := trim(coalesce(p_unit,''));
  v_city text := trim(coalesce(p_city,'')); v_state text := upper(trim(coalesce(p_state,'')));
  v_zip text := trim(coalesce(p_zip,''));
begin
  if auth.uid() is null then raise exception '请先登录' using errcode = '28000'; end if;
  if char_length(v_name)>80 or (v_phone<>'' and v_phone !~ '^[0-9]{10}$')
    or char_length(v_address)>500 or char_length(v_unit)>40 or char_length(v_city)>80
    or (v_state<>'' and v_state !~ '^[A-Z]{2}$') or (v_zip<>'' and v_zip !~ '^[0-9]{5}(-[0-9]{4})?$')
    or char_length(concat_ws(', ',nullif(v_address,''),case when v_unit<>'' then 'Unit '||v_unit end,
      nullif(concat_ws(' ',nullif(v_city,''),nullif(v_state,''),nullif(v_zip,'')),'')))>500
    then raise exception '收货资料格式不正确，请检查电话、州缩写、邮编和地址长度'; end if;
  insert into public.customer_profiles(user_id,full_name,phone) values(auth.uid(),v_name,v_phone)
    on conflict(user_id) do update set full_name=excluded.full_name,phone=excluded.phone,updated_at=now();
  insert into public.customer_addresses(user_id,address,unit,city,state,zip)
    values(auth.uid(),v_address,v_unit,v_city,v_state,v_zip)
    on conflict(user_id) do update set address=excluded.address,unit=excluded.unit,city=excluded.city,
      state=excluded.state,zip=excluded.zip,updated_at=now();
  return public.get_my_customer_details();
end $$;

-- Older clients submit a complete free-form address: clear structured suffixes so they are not appended twice.
create or replace function public.save_my_customer_details(p_full_name text,p_phone text,p_address text)
returns jsonb language sql security definer set search_path = '' as $$
  select public.save_my_customer_details_v2(p_full_name,p_phone,p_address,'','','','');
$$;
revoke all on function public.get_my_customer_details(),public.save_my_customer_details(text,text,text),
  public.save_my_customer_details_v2(text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.get_my_customer_details(),public.save_my_customer_details(text,text,text),
  public.save_my_customer_details_v2(text,text,text,text,text,text,text) to authenticated;
-- Existing RLS, table grants, owner identity, order RPCs and submission service stay unchanged.
notify pgrst, 'reload schema';
commit;
