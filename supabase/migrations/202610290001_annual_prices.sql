begin;
-- 20% off twelve monthly payments. Purchasing must remain paused during repricing.
do $$ begin
  if exists(select 1 from public.billing_settings where enabled) then
    raise exception 'Disable purchasing before applying annual pricing changes';
  end if;
  if (select count(*) from public.billing_offers where
    (id='starter_annual' and cents in (9000,8640)) or
    (id='pro_annual' and cents in (19000,18240))) <> 2 then
    raise exception 'Unexpected annual price catalog; inspect before repricing';
  end if;
end $$;
update public.billing_offers set cents=case id
  when 'starter_annual' then 8640 when 'pro_annual' then 18240 end
where id in ('starter_annual','pro_annual');
commit;
