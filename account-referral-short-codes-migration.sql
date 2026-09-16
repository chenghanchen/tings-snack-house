-- Apply AFTER coupon-claims-v2-migration.sql, before publishing the rewards UI.
-- Keep canonical codes, order snapshots and referral ownership unchanged.
begin;

alter table public.customer_referrals add column if not exists short_code text;
create unique index if not exists customer_referral_short_code on public.customer_referrals(short_code) where short_code is not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.customer_referrals'::regclass and conname='customer_referral_short_format') then
    alter table public.customer_referrals add constraint customer_referral_short_format
      check(short_code is null or (referrer_user_id is not null and short_code ~ '^[A-HJ-NP-Z2-9]{8}$'));
  end if;
end $$;

-- Serialize code allocation across referrals and coupons, including owner-created
-- coupons. A short alias must never shadow a coupon or another canonical code.
create or replace function public.guard_referral_short_code() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(86420751901::bigint);
  if TG_TABLE_NAME='marketing_coupons' then
    if exists(select 1 from public.customer_referrals where short_code=upper(btrim(NEW.code))) then
      raise exception '优惠券代码与已有推荐短码重复' using errcode='23505';
    end if;
  else
    if TG_OP='UPDATE' then
      if OLD.short_code is not null and NEW.short_code is distinct from OLD.short_code then
        raise exception '账户推荐短码不可转让或更换';
      end if;
    end if;
    if exists(select 1 from public.customer_referrals where short_code=upper(btrim(NEW.referral_code)) and id<>NEW.id) then
      raise exception '推荐码与已有推荐短码重复' using errcode='23505';
    end if;
    if NEW.short_code is not null and (
      exists(select 1 from public.marketing_coupons where upper(btrim(code))=NEW.short_code)
      or exists(select 1 from public.customer_referrals where upper(btrim(referral_code))=NEW.short_code)
    ) then raise exception '推荐短码与已有代码重复' using errcode='23505'; end if;
  end if;
  return NEW;
end $$;
revoke all on function public.guard_referral_short_code() from public,anon,authenticated;
drop trigger if exists guard_referral_short_code on public.customer_referrals;
create trigger guard_referral_short_code before insert or update of referral_code,short_code on public.customer_referrals
  for each row execute function public.guard_referral_short_code();
drop trigger if exists guard_coupon_short_code on public.marketing_coupons;
create trigger guard_coupon_short_code before insert or update of code on public.marketing_coupons
  for each row execute function public.guard_referral_short_code();

create or replace function public.ensure_account_referral(p_user_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare generated_code text; bytes bytea; byte_index integer; attempt integer;
  alphabet constant text:='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null) then return null; end if;
  select short_code into generated_code from public.customer_referrals where referrer_user_id=p_user_id;
  if generated_code is not null then return generated_code; end if;
  perform pg_advisory_xact_lock(86420751901::bigint);
  select short_code into generated_code from public.customer_referrals where referrer_user_id=p_user_id;
  if generated_code is not null then return generated_code; end if;
  insert into public.customer_referrals(referrer_user_id,referral_code,referral_amount,referral_min_spend,referral_valid_days,referral_max_uses)
    values(p_user_id,'TSHREF-'||upper(replace(gen_random_uuid()::text,'-','')),5,30,0,0)
    on conflict(referrer_user_id) where referrer_user_id is not null do nothing;
  for attempt in 1..100 loop
    bytes:=decode(replace(gen_random_uuid()::text,'-',''),'hex'); generated_code:='';
    -- Skip UUID version/variant bytes; use 40 uniformly random bits.
    foreach byte_index in array array[0,1,2,3,4,5,9,10] loop
      generated_code:=generated_code||substr(alphabet,(get_byte(bytes,byte_index)%32)+1,1);
    end loop;
    if exists(select 1 from public.customer_referrals where short_code=generated_code or upper(btrim(referral_code))=generated_code)
      or exists(select 1 from public.marketing_coupons c where upper(btrim(c.code))=generated_code) then continue; end if;
    begin
      update public.customer_referrals set short_code=generated_code where referrer_user_id=p_user_id;
      return generated_code;
    exception when unique_violation then null;
    end;
  end loop;
  raise exception '推荐短码生成失败，请重试';
end $$;
revoke all on function public.ensure_account_referral(uuid) from public,anon,authenticated;

-- Narrow, fail-closed replacements: pricing, eligibility, redemption and reward
-- settlement remain the existing reviewed implementation. Reruns are safe.
do $upgrade$
declare definition text; entry text[]; old_fragment text; new_fragment text;
begin
  foreach entry slice 1 in array array[
    -- A fresh session can submit a referral before ever selecting a coupon.
    -- Give that nullable record a known shape for coupon snapshot fields.
    array['public.submit_shop_order(text,text,text,text,text,text,jsonb,uuid,text,text,uuid[])',
      'coupon record;', 'coupon public.marketing_coupons%rowtype;'],
    array['public.preview_account_offer_legacy(text,text,text,numeric,numeric)',
      'where referral_code=upper(btrim(p_code)) and referrer_user_id is not null;',
      'where (referral_code=upper(btrim(p_code)) or short_code=upper(btrim(p_code))) and referrer_user_id is not null;'],
    array['public.submit_shop_order(text,text,text,text,text,text,jsonb,uuid,text,text,uuid[])',
      'where referral_code=entered_code and referrer_user_id is not null;',
      'where (referral_code=entered_code or short_code=entered_code) and referrer_user_id is not null;'],
    array['public.submit_shop_order_with_referral_rewards(text,text,text,text,text,text,jsonb,uuid,text,text,uuid[])',
      'select referral_code into code from public.customer_referrals where referrer_user_id=',
      'select coalesce(short_code,referral_code) into code from public.customer_referrals where referrer_user_id=']
  ] loop
    select replace(pg_get_functiondef(entry[1]::regprocedure),chr(13),'') into definition;
    old_fragment:=entry[2];new_fragment:=entry[3];
    if position(new_fragment in definition)=0 then
      if position(old_fragment in definition)=0 then raise exception 'Unknown referral engine: review % before upgrading',entry[1]; end if;
      execute replace(definition,old_fragment,new_fragment);
    end if;
  end loop;
end $upgrade$;

-- Backfill aliases only. Never replace an old shared code or modify history.
do $$ declare account_id uuid; begin
  for account_id in select id from auth.users where email_confirmed_at is not null loop
    perform public.ensure_account_referral(account_id);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
