-- Real, manually verified order payments. The existing checkout and booking system remain authoritative.
alter table public.products add column if not exists is_test_product boolean not null default false;

alter table public.orders drop constraint if exists orders_requested_payment_method_check;
alter table public.orders add constraint orders_requested_payment_method_check
  check (requested_payment_method in ('GCash','PayMaya','COD','MariBank'));
alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('unpaid','verification_pending','rejected','partially_paid','paid','refunded'));
alter table public.booking_entries drop constraint if exists booking_entries_payment_status_check;
alter table public.booking_entries add constraint booking_entries_payment_status_check
  check (payment_status in ('unpaid','verification_pending','rejected','partially_paid','paid','refunded'));
alter table public.orders drop constraint if exists orders_check1;
alter table public.orders add constraint orders_amounts_match
  check ((delivery_fee_status='unquoted' and delivery_fee is null and total_amount is null and deposit_due is null)
    or (delivery_fee_status<>'unquoted' and delivery_fee is not null
      and total_amount=items_subtotal+customization_total+delivery_fee
      and deposit_due=round(total_amount*deposit_rate,2)));

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(), code text not null unique,
  display_name text not null, qr_image_path text not null, account_name text not null,
  masked_account text not null, instructions text not null default '',
  active boolean not null default false, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code ~ '^[a-z0-9_-]{2,40}$')
);
alter table public.payment_methods enable row level security;
revoke all on public.payment_methods from anon, authenticated;
grant select on public.payment_methods to anon, authenticated;
create policy payment_methods_read on public.payment_methods for select to anon, authenticated
  using (active or (select private.is_admin()));
create trigger payment_methods_touch before update on public.payment_methods
  for each row execute function private.touch_updated_at();

create table public.order_payment_attempts (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id),
  customer_id uuid not null references public.profiles(id),
  payment_method_id uuid not null references public.payment_methods(id),
  amount numeric(12,2) not null check (amount>0), currency text not null default 'PHP' check(currency='PHP'),
  status text not null default 'awaiting_payment' check(status in ('awaiting_payment','verification_pending','paid','rejected')),
  transaction_reference text, proof_storage_path text,
  submitted_at timestamptz, verified_at timestamptz, verified_by uuid references public.profiles(id),
  rejected_at timestamptz, rejection_reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(order_id,customer_id) references public.orders(id,customer_id),
  check ((status='awaiting_payment' and submitted_at is null and transaction_reference is null and proof_storage_path is null)
    or (status<>'awaiting_payment' and submitted_at is not null and transaction_reference is not null and proof_storage_path is not null)),
  check (status<>'paid' or (verified_at is not null and verified_by is not null)),
  check (status<>'rejected' or (rejected_at is not null and rejection_reason is not null))
);
create index order_payment_attempts_customer_idx on public.order_payment_attempts(customer_id,created_at desc);
create index order_payment_attempts_order_idx on public.order_payment_attempts(order_id,created_at desc);
create index order_payment_attempts_status_idx on public.order_payment_attempts(status,submitted_at desc);
create unique index order_payment_attempts_active_order_idx on public.order_payment_attempts(order_id)
  where status in ('awaiting_payment','verification_pending');
create unique index order_payment_attempts_reference_idx on public.order_payment_attempts(lower(btrim(transaction_reference)))
  where transaction_reference is not null;
create unique index order_payment_attempts_proof_idx on public.order_payment_attempts(proof_storage_path)
  where proof_storage_path is not null;
alter table public.order_payment_attempts enable row level security;
revoke all on public.order_payment_attempts from anon, authenticated;
grant select on public.order_payment_attempts to authenticated;
create policy order_payments_read on public.order_payment_attempts for select to authenticated
  using (customer_id=(select auth.uid()) or (select private.is_admin()));
create trigger order_payment_attempts_touch before update on public.order_payment_attempts
  for each row execute function private.touch_updated_at();

insert into public.payment_methods(code,display_name,qr_image_path,account_name,masked_account,instructions,active)
values('maribank','MariBank / InstaPay','payment-test/assets/maribank-qr.png',
  'JOHN PAUL MATIVO','MariBank ending 8930',
  'Check the recipient in your banking app. Transfer the exact amount, then submit the reference and a screenshot. LexC will verify the actual incoming credit.',true)
on conflict(code) do nothing;

insert into public.categories(slug,name,sort_order,is_active)
values('payment-test','Payment Test',999,true) on conflict(slug) do nothing;
insert into public.products(slug,name,description,category_id,kind,status,image_path,image_alt,badge_label,sort_order,is_test_product)
values('product-a-payment-system-test','Product A — Payment System Test',
  'A real ₱1 manual-payment test order. This is not a physical bakery product.',
  (select id from public.categories where slug='payment-test'),'standard','active',
  'local:payment-test/assets/product-a.png','Product A payment test reference image','Payment test',999,true)
on conflict(slug) do nothing;
insert into public.product_variants(product_id,code,label,price,min_qty,is_active,sort_order)
select id,'test','Payment test',1.00,1,true,1 from public.products where slug='product-a-payment-system-test'
on conflict(product_id,code) do nothing;

-- Preserve the existing trusted checkout RPC while enforcing centavo precision and test-only rules.
create function private.prepare_manual_payment_order() returns trigger language plpgsql set search_path='' as $$
begin
  if new.requested_payment_method is distinct from 'MariBank' then
    raise exception 'Choose MariBank / InstaPay for new online orders.';
  end if;
  if new.total_amount is not null then new.deposit_due:=round(new.total_amount*new.deposit_rate,2); end if;
  return new;
end $$;
create trigger orders_prepare_manual_payment before insert on public.orders
  for each row execute function private.prepare_manual_payment_order();

create function private.enforce_payment_test_item() returns trigger language plpgsql set search_path='' as $$
declare is_test boolean; mixed boolean; o public.orders;
begin
  select p.is_test_product into is_test from public.products p where p.id=new.product_id;
  select exists(select 1 from public.order_items i join public.products p on p.id=i.product_id
    where i.order_id=new.order_id and i.id<>new.id and p.is_test_product<>is_test) into mixed;
  if mixed then raise exception 'Payment Test Product must be checked out separately.'; end if;
  if is_test then
    select * into o from public.orders where id=new.order_id;
    if o.fulfillment_method<>'pickup' then raise exception 'Payment Test Product requires pickup checkout.'; end if;
    update public.orders set deposit_rate=1,deposit_due=total_amount where id=new.order_id;
  end if;
  return null;
end $$;
create trigger order_items_payment_test after insert on public.order_items
  for each row execute function private.enforce_payment_test_item();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('payment-proofs','payment-proofs',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create policy payment_proofs_upload on storage.objects for insert to authenticated
  with check (bucket_id='payment-proofs'
    and (storage.foldername(name))[1]=(select auth.uid())::text
    and storage.extension(name) in ('jpg','jpeg','png','webp')
    and exists (select 1 from public.order_payment_attempts p
      where p.id::text=(storage.foldername(name))[3]
        and p.order_id::text=(storage.foldername(name))[2]
        and p.customer_id=(select auth.uid()) and p.status='awaiting_payment'));
create policy payment_proofs_read on storage.objects for select to authenticated
  using (bucket_id='payment-proofs' and (
    ((storage.foldername(name))[1]=auth.uid()::text
      and exists (select 1 from public.order_payment_attempts p
        where p.id::text=(storage.foldername(name))[3] and p.customer_id=auth.uid()))
    or private.is_admin()
  ));

-- Customer starts an attempt only for an owned order; amount is calculated from saved order data.
create function private.start_order_payment(target_order uuid, method_code text)
returns public.order_payment_attempts language plpgsql security definer set search_path='' as $$
declare o public.orders; m public.payment_methods; p public.order_payment_attempts; due numeric(12,2);
begin
  if auth.uid() is null then raise exception 'Sign in to pay for an order.' using errcode='42501'; end if;
  select * into o from public.orders where id=target_order and customer_id=auth.uid() for update;
  if not found then raise exception 'Order not found.' using errcode='42501'; end if;
  if o.status='cancelled' then raise exception 'Cancelled orders cannot be paid.'; end if;
  if o.total_amount is null or o.deposit_due is null then raise exception 'Waiting for the final delivery quote before payment.'; end if;
  if o.amount_paid>=o.total_amount then raise exception 'This order is already fully paid.'; end if;
  select * into m from public.payment_methods where code=method_code and active;
  if not found then raise exception 'Payment method is unavailable.'; end if;
  select * into p from public.order_payment_attempts
    where order_id=o.id and status in ('awaiting_payment','verification_pending') for update;
  if found then return p; end if;
  due:=case when o.amount_paid<o.deposit_due then o.deposit_due-o.amount_paid else o.total_amount-o.amount_paid end;
  if due<=0 then raise exception 'No payment is due.'; end if;
  insert into public.order_payment_attempts(order_id,customer_id,payment_method_id,amount)
    values(o.id,o.customer_id,m.id,due) returning * into p;
  return p;
end $$;
revoke all on function private.start_order_payment(uuid,text) from public;
grant execute on function private.start_order_payment(uuid,text) to authenticated;
create function public.start_order_payment(target_order uuid,method_code text)
returns public.order_payment_attempts language sql security invoker set search_path='' as $$
  select private.start_order_payment(target_order,method_code)
$$;
revoke all on function public.start_order_payment(uuid,text) from public;
grant execute on function public.start_order_payment(uuid,text) to authenticated;

create function private.submit_order_payment(target_payment uuid,reference_number text,proof_path text)
returns public.order_payment_attempts language plpgsql security definer set search_path='' as $$
declare p public.order_payment_attempts; o public.orders; object_record storage.objects;
  normalized text:=nullif(btrim(reference_number),'');
begin
  if auth.uid() is null then raise exception 'Sign in to submit payment.' using errcode='42501'; end if;
  if normalized is null or length(normalized) not between 6 and 100 or normalized !~ '^[A-Za-z0-9 _./-]+$' then
    raise exception 'Enter a valid bank reference (6–100 characters).';
  end if;
  select * into p from public.order_payment_attempts where id=target_payment and customer_id=auth.uid();
  if not found then raise exception 'Payment attempt not found.' using errcode='42501'; end if;
  select * into o from public.orders where id=p.order_id for update;
  select * into p from public.order_payment_attempts where id=target_payment for update;
  if p.status<>'awaiting_payment' then raise exception 'This payment attempt has already been submitted.'; end if;
  if o.status='cancelled' or o.total_amount is null then raise exception 'This order cannot accept payment.'; end if;
  if proof_path is null or split_part(proof_path,'/',1)<>auth.uid()::text
    or split_part(proof_path,'/',2)<>p.order_id::text
    or split_part(proof_path,'/',3)<>p.id::text then raise exception 'Invalid proof location.'; end if;
  select * into object_record from storage.objects
    where bucket_id='payment-proofs' and name=proof_path;
  if not found or object_record.metadata->>'mimetype' not in ('image/jpeg','image/png','image/webp')
    or coalesce((object_record.metadata->>'size')::bigint,0) not between 1 and 5242880 then
    raise exception 'Upload a JPG, PNG, or WEBP proof up to 5 MB.';
  end if;
  if exists(select 1 from public.order_payment_attempts other
    where other.id<>p.id and lower(btrim(other.transaction_reference))=lower(normalized))
    or exists(select 1 from public.payment_tests t where lower(btrim(t.payment_reference))=lower(normalized)) then
    raise exception 'This transaction reference is already associated with another payment.';
  end if;
  update public.order_payment_attempts set transaction_reference=normalized,
    proof_storage_path=proof_path,status='verification_pending',submitted_at=now()
    where id=p.id returning * into p;
  update public.orders set payment_status='verification_pending' where id=o.id;
  return p;
end $$;
revoke all on function private.submit_order_payment(uuid,text,text) from public;
grant execute on function private.submit_order_payment(uuid,text,text) to authenticated;
create function public.submit_order_payment(target_payment uuid,reference_number text,proof_path text)
returns public.order_payment_attempts language sql security invoker set search_path='' as $$
  select private.submit_order_payment(target_payment,reference_number,proof_path)
$$;
revoke all on function public.submit_order_payment(uuid,text,text) from public;
grant execute on function public.submit_order_payment(uuid,text,text) to authenticated;

-- Review locks the order and attempt and updates both in a single transaction.
create function private.review_order_payment(target_payment uuid,decision text,review_reason text)
returns public.order_payment_attempts language plpgsql security definer set search_path='' as $$
declare p public.order_payment_attempts; o public.orders; verified_total numeric(12,2);
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
  if decision not in ('paid','rejected') then raise exception 'Choose paid or rejected.'; end if;
  if nullif(btrim(coalesce(review_reason,'')),'') is null then raise exception 'Record the bank verification or rejection reason.'; end if;
  select * into p from public.order_payment_attempts where id=target_payment;
  if not found then raise exception 'Payment attempt not found.'; end if;
  select * into o from public.orders where id=p.order_id for update;
  select * into p from public.order_payment_attempts where id=target_payment for update;
  if p.status<>'verification_pending' then raise exception 'Payment has already been processed.'; end if;
  if decision='paid' then
    if o.status='cancelled' then raise exception 'Cancelled order requires separate resolution before payment approval.'; end if;
    if o.total_amount is null or o.amount_paid+p.amount>o.total_amount then raise exception 'Payment exceeds the order balance.'; end if;
    update public.order_payment_attempts set status='paid',verified_at=now(),verified_by=auth.uid()
      where id=p.id returning * into p;
    select coalesce(sum(amount),0) into verified_total from public.order_payment_attempts
      where order_id=o.id and status='paid';
    update public.orders set amount_paid=verified_total,
      payment_status=case when verified_total>=total_amount then 'paid' else 'partially_paid' end,
      paid_at=case when verified_total>=total_amount then now() else paid_at end where id=o.id;
  else
    update public.order_payment_attempts set status='rejected',rejected_at=now(),
      rejection_reason=left(btrim(review_reason),1000) where id=p.id returning * into p;
    update public.orders set payment_status='rejected' where id=o.id;
  end if;
  return p;
end $$;
revoke all on function private.review_order_payment(uuid,text,text) from public;
grant execute on function private.review_order_payment(uuid,text,text) to authenticated;
create function public.review_order_payment(target_payment uuid,decision text,review_reason text)
returns public.order_payment_attempts language sql security invoker set search_path='' as $$
  select private.review_order_payment(target_payment,decision,review_reason)
$$;
revoke all on function public.review_order_payment(uuid,text,text) from public;
grant execute on function public.review_order_payment(uuid,text,text) to authenticated;
