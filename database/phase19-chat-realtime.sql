-- Publish the existing chat tables so both existing chat UIs receive changes immediately.
-- Table RLS continues to govern which rows each signed-in user can access.
alter publication supabase_realtime add table public.chat_conversations, public.chat_messages;
