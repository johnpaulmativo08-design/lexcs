-- Phase 107 · Email notifications (sent from LexC's Gmail by the send-email Edge Function).
-- What this does, in plain words:
--   1. A private email queue (private.email_outbox). Nothing here is readable by customers or the browser.
--   2. The database adds an email to the queue when something happens:
--        to the customer:  order received · confirmed · being made · ready · completed · cancelled
--                          payment confirmed · payment proof not accepted · payment reminder (phase 102 reminders)
--        to LexC's:        new order · payment proof to check · new review · voucher used
--      Adding to the queue can never stop an order or a payment: if it fails, the action still goes through.
--   3. Every minute pg_cron asks the send-email Edge Function to send what is waiting (pg_net is switched on for
--      this). The function picks up at most 20 emails per run through public.email_outbox_claim(), which only the
--      server (service role) can call, and reports back with public.email_outbox_done(). An email that fails is
--      tried up to 3 times. The call carries no data, so anyone triggering the function only sends what is queued.
--   4. Before the first run, set the function's secrets (GMAIL_USER, GMAIL_APP_PASSWORD, optional ADMIN_EMAIL)
--      and deploy it; until then emails simply wait in the queue.
-- Safe to run more than once.
begin;

create extension if not exists pg_net with schema extensions;

create table if not exists private.email_outbox (
  id bigint generated always as identity primary key,
  recipient text not null check (recipient in ('customer', 'admin')),
  customer_id uuid,
  order_id uuid,
  kind text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text
);
create index if not exists email_outbox_waiting on private.email_outbox (created_at) where sent_at is null;
alter table private.email_outbox enable row level security;   -- no policies: only the private functions below use it
revoke all on private.email_outbox from public, anon, authenticated;

create or replace function private.email_queue(to_whom text, customer uuid, ord uuid, what text, subj text, msg text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.email_outbox (recipient, customer_id, order_id, kind, subject, body) values (to_whom, customer, ord, what, subj, msg);
exception when others then
  raise warning 'email not queued (%): %', what, sqlerrm;   -- never block the order or payment
end $$;
revoke all on function private.email_queue(text, uuid, uuid, text, text, text) from public;

create or replace function private.email_when(t timestamptz) returns text language sql stable set search_path = '' as $$
  select to_char(t at time zone 'Asia/Manila', 'Dy, Mon FMDD · FMHH12:MI AM')
$$;
create or replace function private.email_money(n numeric) returns text language sql immutable set search_path = '' as $$
  select '₱' || to_char(coalesce(n, 0), 'FM999,999,990.00')
$$;

-- orders: new order, status changes, payment reminders
create or replace function private.email_on_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare link text := 'https://lexcsnacktime.shop/payment/?order=' || new.id; how text := case when new.fulfillment_method = 'lalamove' then 'delivery' else 'pickup' end;
begin
  if tg_op = 'INSERT' then
    perform private.email_queue('admin', null, new.id, 'order_new', 'New order #' || new.order_number || ' · ' || coalesce(new.customer_name, 'Customer'),
      coalesce(new.customer_name, 'A customer') || ' placed order #' || new.order_number || ' for ' || how || ' on ' || private.email_when(new.receiving_start)
      || '.' || E'\nTotal: ' || coalesce(private.email_money(new.total_amount), 'quote pending') || E'\n\nReview and confirm it in Admin → Orders: https://lexcsnacktime.shop/admin/#orders/detail/' || new.id);
    perform private.email_queue('customer', new.customer_id, new.id, 'order_received', 'We received your order #' || new.order_number,
      'Thank you! Your order #' || new.order_number || ' for ' || how || ' on ' || private.email_when(new.receiving_start) || ' is saved.'
      || E'\nLexC''s will check it and confirm soon. You pay only after it is confirmed.' || E'\n\nSee your order: ' || link);
    return new;
  end if;
  if new.status is distinct from old.status then
    perform private.email_queue('customer', new.customer_id, new.id, 'order_' || new.status,
      case new.status when 'confirmed' then 'Order #' || new.order_number || ' is confirmed — time to pay'
                      when 'preparing' then 'We''re making order #' || new.order_number
                      when 'ready' then 'Order #' || new.order_number || ' is ready'
                      when 'completed' then 'Thank you for order #' || new.order_number
                      when 'cancelled' then 'Order #' || new.order_number || ' was cancelled'
                      else 'Update on order #' || new.order_number end,
      case new.status
        when 'confirmed' then 'Good news! LexC''s confirmed your order #' || new.order_number || '.'
          || E'\nDownpayment: ' || private.email_money(new.deposit_due) || ' · Total: ' || private.email_money(new.total_amount)
          || coalesce(E'\nPlease pay by ' || private.email_when(new.downpayment_due_at) || ', or the order is cancelled automatically.', '')
          || E'\n\nPay here: ' || link
        when 'preparing' then 'Your order #' || new.order_number || ' is in the kitchen now. We''ll tell you when it is ready.'
        when 'ready' then 'Your order #' || new.order_number || ' is ready' || case when how = 'delivery' then ' and waiting for the Lalamove rider.' else ' for pickup at 66 Quezon St., Dau, Mabalacat.' end
          || case when coalesce(new.total_amount, 0) - coalesce(new.amount_paid, 0) > 0 then E'\nBalance to pay: ' || private.email_money(new.total_amount - new.amount_paid) else '' end
        when 'completed' then 'Your order #' || new.order_number || ' is complete. We hope you enjoy it! You can leave a review in My Orders.'
        when 'cancelled' then 'Your order #' || new.order_number || ' was cancelled. If this is unexpected, message LexC''s in the chat.'
        else 'Your order #' || new.order_number || ' is now ' || new.status || '.' end
      || E'\n\nYour order: ' || link);
  end if;
  if coalesce(new.downpayment_reminders, 0) > coalesce(old.downpayment_reminders, 0) and new.status <> 'cancelled' then
    perform private.email_queue('customer', new.customer_id, new.id, 'remind_downpayment', 'Reminder: downpayment for order #' || new.order_number,
      'Your downpayment of ' || private.email_money(new.deposit_due) || ' for order #' || new.order_number || ' is still waiting.'
      || coalesce(E'\nPlease pay by ' || private.email_when(new.downpayment_due_at) || ' to keep your order.', '') || E'\n\nPay here: ' || link);
  end if;
  if coalesce(new.balance_reminders, 0) > coalesce(old.balance_reminders, 0) and new.status <> 'cancelled' then
    perform private.email_queue('customer', new.customer_id, new.id, 'remind_balance', 'Reminder: balance for order #' || new.order_number,
      'The balance of ' || private.email_money(coalesce(new.total_amount, 0) - coalesce(new.amount_paid, 0)) || ' for order #' || new.order_number || ' is due'
      || coalesce(' by ' || private.email_when(new.balance_due_at), '') || '.' || E'\n\nPay here: ' || link);
  end if;
  return new;
end $$;
revoke all on function private.email_on_order() from public;
drop trigger if exists zz_email_order on public.orders;
create trigger zz_email_order after insert or update of status, downpayment_reminders, balance_reminders on public.orders
  for each row execute function private.email_on_order();

-- payments: proof sent (to LexC's), confirmed or not accepted (to the customer)
create or replace function private.email_on_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  select * into o from public.orders where id = new.order_id;
  if new.status = 'verification_pending' then
    perform private.email_queue('admin', null, new.order_id, 'payment_proof', 'Payment to check · order #' || o.order_number || ' · ' || private.email_money(new.amount),
      coalesce(o.customer_name, 'A customer') || ' sent ' || private.email_money(new.amount) || ' for order #' || o.order_number
      || case when new.provider_payment_id is not null then ' online (PayMongo).' else '. Reference: ' || coalesce(new.transaction_reference, '—') || '.' end
      || E'\nCheck that the money arrived, then confirm it in Admin → Orders: https://lexcsnacktime.shop/admin/#orders/detail/' || new.order_id);
  elsif new.status = 'paid' then
    perform private.email_queue('customer', new.customer_id, new.order_id, 'payment_paid', 'Payment received for order #' || o.order_number,
      'LexC''s confirmed your payment of ' || private.email_money(new.amount) || ' for order #' || o.order_number || '. Thank you!'
      || case when coalesce(o.total_amount, 0) - coalesce(o.amount_paid, 0) > 0 then E'\nBalance left: ' || private.email_money(o.total_amount - o.amount_paid) else E'\nYour order is fully paid.' end
      || E'\n\nYour order: https://lexcsnacktime.shop/payment/?order=' || new.order_id);
  elsif new.status = 'rejected' then
    perform private.email_queue('customer', new.customer_id, new.order_id, 'payment_rejected', 'Payment proof not accepted · order #' || o.order_number,
      'LexC''s could not match your payment proof of ' || private.email_money(new.amount) || ' for order #' || o.order_number || '.'
      || coalesce(E'\nReason: ' || nullif(new.rejection_reason, ''), '') || E'\nPlease send a new proof: https://lexcsnacktime.shop/payment/?order=' || new.order_id);
  end if;
  return new;
end $$;
revoke all on function private.email_on_payment() from public;
drop trigger if exists zz_email_payment on public.order_payment_attempts;
create trigger zz_email_payment after insert or update of status on public.order_payment_attempts
  for each row execute function private.email_on_payment();

-- reviews and voucher uses (to LexC's)
create or replace function private.email_on_review() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.email_queue('admin', null, new.order_id, 'review_new', 'New ' || new.rating || '★ review',
    coalesce(new.public_display_name, 'A customer') || ' rated an order ' || new.rating || ' out of 5.'
    || coalesce(E'\n“' || left(nullif(new.review_text, ''), 400) || '”', '') || E'\n\nSee it in Admin → Updates & reviews: https://lexcsnacktime.shop/admin/#updates');
  return new;
end $$;
revoke all on function private.email_on_review() from public;
drop trigger if exists zz_email_review on public.reviews;
create trigger zz_email_review after insert on public.reviews for each row execute function private.email_on_review();

create or replace function private.email_on_voucher() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n bigint := (select order_number from public.orders where id = new.order_id);
begin
  perform private.email_queue('admin', null, new.order_id, 'voucher_used', 'Voucher ' || new.code || ' used on order #' || n,
    'Voucher ' || new.code || ' took ' || private.email_money(new.discount_amount) || ' off order #' || n || '.'
    || E'\nSee it in Admin → Vouchers: https://lexcsnacktime.shop/admin/#vouchers');
  return new;
end $$;
revoke all on function private.email_on_voucher() from public;
drop trigger if exists zz_email_voucher on public.voucher_redemptions;
create trigger zz_email_voucher after insert on public.voucher_redemptions for each row execute function private.email_on_voucher();

-- the Edge Function's two calls (service role only)
create or replace function public.email_outbox_claim() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare picked jsonb;
begin
  with batch as (
    select e.id from private.email_outbox e
     where e.sent_at is null and e.attempts < 3 and (e.claimed_at is null or e.claimed_at < now() - interval '5 minutes')
     order by e.created_at limit 20 for update skip locked),
  marked as (
    update private.email_outbox e set claimed_at = now(), attempts = e.attempts + 1 from batch where e.id = batch.id returning e.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'recipient', m.recipient, 'subject', m.subject, 'body', m.body,
           'to', case when m.recipient = 'customer' then u.email end, 'name', p.full_name)), '[]'::jsonb)
    into picked
    from marked m left join auth.users u on u.id = m.customer_id left join public.profiles p on p.id = m.customer_id;
  return picked;
end $$;
revoke all on function public.email_outbox_claim() from public, anon, authenticated;
grant execute on function public.email_outbox_claim() to service_role;

create or replace function public.email_outbox_done(sent bigint[], failed jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update private.email_outbox set sent_at = now(), last_error = null where id = any(coalesce(sent, '{}'));
  update private.email_outbox e set last_error = left(f.value, 500), claimed_at = null
    from jsonb_each_text(coalesce(failed, '{}'::jsonb)) f where e.id = f.key::bigint;
end $$;
revoke all on function public.email_outbox_done(bigint[], jsonb) from public, anon, authenticated;
grant execute on function public.email_outbox_done(bigint[], jsonb) to service_role;

-- every minute: ask the function to send what is waiting (only when something is waiting)
select cron.unschedule(jobid) from cron.job where jobname = 'lexc-send-email';
select cron.schedule('lexc-send-email', '* * * * *', $job$
  select net.http_post(url := 'https://jruoqutpflfvkshtyyhs.supabase.co/functions/v1/send-email', body := '{}'::jsonb,
                       headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 20000)
   where exists (select 1 from private.email_outbox where sent_at is null and attempts < 3);
$job$);

commit;
notify pgrst, 'reload schema';
