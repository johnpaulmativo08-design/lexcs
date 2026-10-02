-- Phase 39: LexC's now takes two InstaPay QRs only, GCash and MariBank, from the "Online Payments" card.
-- New QR images: payment/assets/gcash-qr.png and payment/assets/maribank-qr.png (cropped from that card).
-- Maya is switched off (not deleted), so earlier payment attempts that used it still show in history.
-- The card shows the mobile numbers but not the registered names, so the recipient line shows the number;
-- customers check the name their banking app displays after scanning.
begin;

update public.payment_methods set
  display_name = 'GCash / InstaPay',
  qr_image_path = 'payment/assets/gcash-qr.png',
  account_name = 'GCash +63 926 499 2341',
  masked_account = 'Scan with any InstaPay QR Ph app',
  instructions = 'Check the recipient shown by your paying app. Send the exact LexC order amount, then submit the reference and receipt for verification.',
  active = true, updated_at = now()
where code = 'gcash';

update public.payment_methods set
  display_name = 'MariBank / InstaPay',
  qr_image_path = 'payment/assets/maribank-qr.png',
  account_name = 'MariBank +63 991 212 8558',
  masked_account = 'Scan with any InstaPay QR Ph app',
  instructions = 'Check the recipient shown by your paying app. Send the exact LexC order amount, then submit the reference and receipt for verification.',
  active = true, updated_at = now()
where code = 'maribank';

update public.payment_methods set active = false, updated_at = now() where code = 'maya';

do $$ begin
  if (select count(*) from public.payment_methods where active) <> 2
     or exists (select 1 from public.payment_methods where active and code not in ('gcash', 'maribank')) then
    raise exception 'Phase 39: expected exactly the GCash and MariBank QRs to be active.';
  end if;
end $$;

commit;
