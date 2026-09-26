-- Additional personal receiving QRs for manually verified order payments.
-- These are not merchant checkout links and do not encode the LexC order amount.
insert into public.payment_methods
  (code, display_name, qr_image_path, account_name, masked_account, instructions, active)
values
  ('gcash', 'GCash / InstaPay', 'payment/assets/gcash-qr.jpg',
   'JO*N PA*L M.', 'GCash mobile +63 993 282 ••••',
   'Check the recipient shown by your paying app. Enter the exact LexC order amount, complete the transfer, and submit the bank reference and receipt for Admin verification.', true),
  ('maya', 'Maya / InstaPay', 'payment/assets/maya-qr.jpg',
   'JOHN PAUL MATIVO', 'Maya mobile ending 2544',
   'Check the recipient shown by your paying app. Enter the exact LexC order amount, complete the transfer, and submit the bank reference and receipt for Admin verification.', true)
on conflict (code) do nothing;
