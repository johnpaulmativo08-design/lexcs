-- Proof files must pass server-side file-signature validation before Storage upload.
-- The Edge Function uses a server-only service key after authenticating the order owner.
drop policy if exists payment_proofs_upload on storage.objects;
