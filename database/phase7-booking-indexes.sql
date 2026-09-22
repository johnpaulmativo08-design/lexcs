-- Cover booking foreign keys used by customer ownership and Admin close/reopen audits.
create index if not exists booking_entries_customer_idx on public.booking_entries(customer_id);
create index if not exists booking_entries_created_by_idx on public.booking_entries(created_by);
create index if not exists booking_date_settings_closed_by_idx on public.booking_date_settings(closed_by);
create index if not exists booking_date_settings_reopened_by_idx on public.booking_date_settings(reopened_by);
