-- Testing-stage cutover: TSHREF- plus six characters is the ONLY active code.
-- Apply after account-referral-short-codes-migration.sql (or wallet + coupon v2).
-- Existing codes are replaced and aliases removed. Never rewrite order history.
begin;
select pg_advisory_xact_lock(86420751901::bigint);
lock table public.customer_referrals,public.marketing_coupons in share row exclusive mode;

create or replace function public.allocate_account_referral_code() returns text
language plpgsql security definer set search_path='' as $$
declare candidate text; bytes bytea; i integer; attempt integer;
  alphabet constant text:='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  perform pg_advisory_xact_lock(86420751901::bigint);
  for attempt in 1..100 loop
    bytes:=decode(replace(gen_random_uuid()::text,'-',''),'hex');candidate:='TSHREF-';
    for i in 0..5 loop candidate:=candidate||substr(alphabet,(get_byte(bytes,i)%32)+1,1); end loop;
    if not exists(select 1 from public.customer_referrals where upper(btrim(referral_code))=candidate)
      and not exists(select 1 from public.marketing_coupons where upper(btrim(code))=candidate) then return candidate; end if;
  end loop;
  raise exception '推荐码生成失败，请重试';
end $$;
revoke all on function public.allocate_account_referral_code() from public,anon,authenticated,service_role;

-- Preserve all eligibility/pricing checks; remove alias lookup at each boundary.
do $upgrade$
declare definition text; entry text[];
begin
  foreach entry slice 1 in array array[
    array['public.submit_shop_order(text,text,text,text,text,text,jsonb,uuid,text,text,uuid[])',
      'coupon record;','coupon public.marketing_coupons%rowtype;'],
    array['public.preview_account_offer_legacy(text,text,text,numeric,numeric)',
      'where (referral_code=upper(btrim(p_code)) or short_code=upper(btrim(p_code))) and referrer_user_id is not null;',
      'where referral_code=upper(btrim(p_code)) and referrer_user_id is not null;'],
    array['public.submit_shop_order(text,text,text,text,text,text,jsonb,uuid,text,text,uuid[])',
      'where (referral_code=entered_code or short_code=entered_code) and referrer_user_id is not null;',
      'where referral_code=entered_code and referrer_user_id is not null;'],
    array['public.submit_shop_order_with_referral_rewards(text,text,text,text,text,text,jsonb,uuid,text,text,uuid[])',
      'select coalesce(short_code,referral_code) into code from public.customer_referrals where referrer_user_id=',
      'select referral_code into code from public.customer_referrals where referrer_user_id=']
  ] loop
    select replace(pg_get_functiondef(entry[1]::regprocedure),chr(13),'') into definition;
    if position(entry[3] in definition)=0 then
      if position(entry[2] in definition)=0 then raise exception 'Unknown referral engine: review % before replacing codes',entry[1]; end if;
      execute replace(definition,entry[2],entry[3]);
    end if;
  end loop;
end $upgrade$;

drop trigger if exists guard_referral_short_code on public.customer_referrals;
drop trigger if exists guard_coupon_short_code on public.marketing_coupons;
drop function if exists public.guard_referral_short_code();

-- The table remains write-locked for the entire transaction. Temporarily remove
-- immutability ONLY for this explicit one-time rotation; restore before commit.
drop trigger if exists preserve_referrer_owner on public.customer_referrals;
do $$ declare referral_id uuid; had_aliases boolean; begin
  select exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='customer_referrals' and column_name='short_code') into had_aliases;
  for referral_id in select id from public.customer_referrals where referrer_user_id is not null
    and (had_aliases or referral_code !~ '^TSHREF-[A-HJ-NP-Z2-9]{6}$') order by id loop
    update public.customer_referrals set referral_code=public.allocate_account_referral_code() where id=referral_id;
  end loop;
end $$;
create trigger preserve_referrer_owner before update on public.customer_referrals
  for each row execute function public.keep_account_reward_owner();
alter table public.customer_referrals drop column if exists short_code;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.customer_referrals'::regclass and conname='customer_referral_six_format') then
    alter table public.customer_referrals add constraint customer_referral_six_format
      check(referrer_user_id is null or referral_code ~ '^TSHREF-[A-HJ-NP-Z2-9]{6}$');
  end if;
end $$;

create or replace function public.guard_account_referral_code() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(86420751901::bigint);
  if TG_TABLE_NAME='marketing_coupons' then
    if exists(select 1 from public.customer_referrals where upper(btrim(referral_code))=upper(btrim(NEW.code))) then
      raise exception '优惠券代码与已有推荐码重复' using errcode='23505';
    end if;
  elsif exists(select 1 from public.marketing_coupons where upper(btrim(code))=upper(btrim(NEW.referral_code))) then
    raise exception '推荐码与已有优惠券代码重复' using errcode='23505';
  end if;
  return NEW;
end $$;
revoke all on function public.guard_account_referral_code() from public,anon,authenticated,service_role;
drop trigger if exists guard_account_referral_code on public.customer_referrals;
create trigger guard_account_referral_code before insert or update of referral_code on public.customer_referrals
  for each row execute function public.guard_account_referral_code();
drop trigger if exists guard_coupon_referral_code on public.marketing_coupons;
create trigger guard_coupon_referral_code before insert or update of code on public.marketing_coupons
  for each row execute function public.guard_account_referral_code();

create or replace function public.ensure_account_referral(p_user_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare code text;
begin
  if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null) then return null; end if;
  select referral_code into code from public.customer_referrals where referrer_user_id=p_user_id;
  if code is not null then return code; end if;
  perform pg_advisory_xact_lock(86420751901::bigint);
  select referral_code into code from public.customer_referrals where referrer_user_id=p_user_id;
  if code is not null then return code; end if;
  code:=public.allocate_account_referral_code();
  insert into public.customer_referrals(referrer_user_id,referral_code,referral_amount,referral_min_spend,referral_valid_days,referral_max_uses)
    values(p_user_id,code,5,30,0,0);
  return code;
end $$;
revoke all on function public.ensure_account_referral(uuid) from public,anon,authenticated,service_role;
do $$ declare account_id uuid; begin
  for account_id in select id from auth.users where email_confirmed_at is not null loop
    perform public.ensure_account_referral(account_id);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
