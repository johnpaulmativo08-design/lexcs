-- Phase 30: "Fresh from LexC's" store posts (photos, short videos and text updates).
-- Posts are separate from the catalog: a post may point at an existing product, but it never stores
-- price, stock or availability and never changes products, carts or orders.
--
-- Security model
--   * public.store_posts has no customer grants. Customers read only through get_store_feed(), which
--     returns published, non-archived posts and never exposes drafts or unsaved edits (pending_revision).
--   * Every write goes through Admin-only functions (errcode 42501 otherwise).
--   * Media lives in the PRIVATE "post-media" bucket. Customers can only sign URLs for files that the
--     live version of a published post uses, so draft uploads stay undiscoverable.
-- Safe to re-run.

create table if not exists public.store_posts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  caption text not null default '' check (char_length(caption) <= 2200),
  media_kind text not null default 'none' check (media_kind in ('none', 'image', 'video')),
  media_path text,
  poster_path text,
  media_width integer check (media_width between 1 and 10000),
  media_height integer check (media_height between 1 and 10000),
  media_duration numeric(7,2) check (media_duration >= 0 and media_duration <= 600),
  media_alt text not null default '' check (char_length(media_alt) <= 300),
  product_id uuid references public.products(id) on delete set null,
  pending_revision jsonb,
  author_id uuid references auth.users(id) on delete set null default auth.uid(),
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_posts_media_shape check (
    (media_kind = 'none' and media_path is null and poster_path is null)
    or (media_kind = 'image' and media_path is not null and poster_path is null)
    or (media_kind = 'video' and media_path is not null)),
  constraint store_posts_not_empty check (btrim(caption) <> '' or media_kind <> 'none'),
  constraint store_posts_published_time check (status = 'draft' or published_at is not null)
);
create index if not exists store_posts_feed_idx on public.store_posts (published_at desc, id desc) where status = 'published';
create index if not exists store_posts_product_idx on public.store_posts (product_id);

alter table public.store_posts enable row level security;
revoke all on public.store_posts from anon, authenticated;
grant select on public.store_posts to authenticated;
drop policy if exists store_posts_admin_read on public.store_posts;
create policy store_posts_admin_read on public.store_posts for select to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------------------------------
-- Media bucket: private, explicit types, 50 MB ceiling (videos). Images are checked at 8 MB below.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.post_media_visible(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.store_posts p
                 where p.status = 'published' and (p.media_path = object_name or p.poster_path = object_name))
$$;
revoke all on function private.post_media_visible(text) from public;
grant execute on function private.post_media_visible(text) to anon, authenticated;

drop policy if exists post_media_upload on storage.objects;
create policy post_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'post-media' and (select private.is_admin()) and (storage.foldername(name))[1] = 'posts');
drop policy if exists post_media_admin_read on storage.objects;
create policy post_media_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'post-media' and (select private.is_admin()));
drop policy if exists post_media_admin_delete on storage.objects;
create policy post_media_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'post-media' and (select private.is_admin()));
drop policy if exists post_media_public_read on storage.objects;
create policy post_media_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'post-media' and private.post_media_visible(name));

-- ---------------------------------------------------------------------------------------------
-- Validates an editor payload and returns it normalised. Raises 22023 with a customer-safe message.
create or replace function private.store_post_clean(payload jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  caption text := coalesce(payload->>'caption', '');
  kind text := coalesce(nullif(payload->>'media_kind', ''), 'none');
  media text := nullif(payload->>'media_path', '');
  poster text := nullif(payload->>'poster_path', '');
  product uuid;
  obj record;
  w integer; h integer; d numeric;
begin
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'Invalid post.' using errcode = '22023'; end if;
  caption := regexp_replace(caption, '\s+$', '');
  if char_length(caption) > 2200 then raise exception 'Keep the caption under 2,200 characters.' using errcode = '22023'; end if;
  if kind not in ('none', 'image', 'video') then raise exception 'Unsupported attachment.' using errcode = '22023'; end if;
  if kind = 'none' then media := null; poster := null; end if;
  if kind = 'image' then poster := null; end if;
  if kind <> 'none' and media is null then raise exception 'The attachment is missing. Upload it again.' using errcode = '22023'; end if;
  if btrim(caption) = '' and kind = 'none' then raise exception 'Write something or add a photo or video first.' using errcode = '22023'; end if;

  if media is not null then
    if media !~ '^posts/[0-9a-f-]{36}/[A-Za-z0-9._-]+$' then raise exception 'Invalid attachment path.' using errcode = '22023'; end if;
    select o.metadata into obj from storage.objects o where o.bucket_id = 'post-media' and o.name = media;
    if not found then raise exception 'The attachment has not finished uploading. Try again.' using errcode = '22023'; end if;
    if obj.metadata is not null then
      if kind = 'image' and (coalesce(obj.metadata->>'mimetype', '') not in ('image/jpeg', 'image/png', 'image/webp')
                             or coalesce((obj.metadata->>'size')::bigint, 0) > 8388608) then
        raise exception 'Photos must be JPG, PNG or WebP up to 8 MB.' using errcode = '22023'; end if;
      if kind = 'video' and (coalesce(obj.metadata->>'mimetype', '') not in ('video/mp4', 'video/webm', 'video/quicktime')
                             or coalesce((obj.metadata->>'size')::bigint, 0) > 52428800) then
        raise exception 'Videos must be MP4, WebM or MOV up to 50 MB.' using errcode = '22023'; end if;
    end if;
  end if;
  if poster is not null then
    if poster !~ '^posts/[0-9a-f-]{36}/[A-Za-z0-9._-]+$' then raise exception 'Invalid cover image path.' using errcode = '22023'; end if;
    select o.metadata into obj from storage.objects o where o.bucket_id = 'post-media' and o.name = poster;
    if not found then raise exception 'The video cover has not finished uploading. Try again.' using errcode = '22023'; end if;
    if obj.metadata is not null and coalesce(obj.metadata->>'mimetype', '') not in ('image/jpeg', 'image/png', 'image/webp') then
      raise exception 'Invalid video cover.' using errcode = '22023'; end if;
  end if;

  begin
    product := nullif(payload->>'product_id', '')::uuid;
    w := nullif(payload->>'media_width', '')::numeric::integer;
    h := nullif(payload->>'media_height', '')::numeric::integer;
    d := round(nullif(payload->>'media_duration', '')::numeric, 2);
  exception when others then raise exception 'Invalid post details.' using errcode = '22023';
  end;
  if kind = 'none' then w := null; h := null; d := null; end if;
  if kind = 'image' then d := null; end if;
  if w is not null and (w < 1 or w > 10000) or h is not null and (h < 1 or h > 10000) then w := null; h := null; end if;
  if d is not null and (d < 0 or d > 600) then raise exception 'Videos can be up to 10 minutes long.' using errcode = '22023'; end if;
  if product is not null and not exists (select 1 from public.products p where p.id = product and p.status = 'active') then
    raise exception 'That product is no longer available to tag. Choose another product.' using errcode = '22023';
  end if;

  return jsonb_build_object('caption', caption, 'media_kind', kind, 'media_path', media, 'poster_path', poster,
    'media_width', w, 'media_height', h, 'media_duration', d,
    'media_alt', left(coalesce(payload->>'media_alt', ''), 300), 'product_id', product);
end $$;
revoke all on function private.store_post_clean(jsonb) from public;
grant execute on function private.store_post_clean(jsonb) to authenticated;

-- action: 'draft'   new post -> draft; draft -> saved; published/archived -> unsaved edits kept privately
--         'publish' new post or draft -> published now; published/archived -> same as 'save'
--         'save'    applies the edits to the post (a published post stays live, published_at unchanged)
-- A repeated call with the same request_id for a NEW post returns the first result (no duplicates).
create or replace function private.save_store_post(p_post_id uuid, p_request_id uuid, p_action text, p_payload jsonb)
returns public.store_posts language plpgsql volatile security definer set search_path = '' as $$
declare v jsonb; r public.store_posts;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  if p_action not in ('draft', 'publish', 'save') then raise exception 'Unknown post action.' using errcode = '22023'; end if;

  if p_post_id is null then
    if p_request_id is null then raise exception 'Missing request id.' using errcode = '22023'; end if;
    select * into r from public.store_posts where request_id = p_request_id;
    if found then return r; end if;
    v := private.store_post_clean(p_payload);
    insert into public.store_posts (request_id, status, caption, media_kind, media_path, poster_path, media_width,
      media_height, media_duration, media_alt, product_id, published_at, author_id)
    values (p_request_id, case when p_action = 'draft' then 'draft' else 'published' end, v->>'caption', v->>'media_kind',
      v->>'media_path', v->>'poster_path', (v->>'media_width')::integer, (v->>'media_height')::integer,
      (v->>'media_duration')::numeric, v->>'media_alt', (v->>'product_id')::uuid,
      case when p_action = 'draft' then null else now() end, auth.uid())
    on conflict (request_id) do nothing
    returning * into r;
    if r.id is null then select * into r from public.store_posts where request_id = p_request_id; end if;
    return r;
  end if;

  select * into r from public.store_posts where id = p_post_id for update;
  if not found then raise exception 'This post no longer exists.' using errcode = 'P0002'; end if;
  v := private.store_post_clean(p_payload);

  if r.status <> 'draft' and p_action = 'draft' then
    update public.store_posts set pending_revision = v, updated_at = now() where id = r.id returning * into r;
    return r;
  end if;

  update public.store_posts set
    caption = v->>'caption', media_kind = v->>'media_kind', media_path = v->>'media_path', poster_path = v->>'poster_path',
    media_width = (v->>'media_width')::integer, media_height = (v->>'media_height')::integer,
    media_duration = (v->>'media_duration')::numeric, media_alt = v->>'media_alt', product_id = (v->>'product_id')::uuid,
    pending_revision = null,
    status = case when r.status = 'draft' and p_action = 'publish' then 'published' else r.status end,
    published_at = case when r.status = 'draft' and p_action = 'publish' then now() else r.published_at end,
    updated_at = now()
  where id = r.id returning * into r;
  return r;
end $$;
revoke all on function private.save_store_post(uuid, uuid, text, jsonb) from public;
grant execute on function private.save_store_post(uuid, uuid, text, jsonb) to authenticated;

create or replace function public.save_store_post(p_post_id uuid, p_request_id uuid, p_action text, p_payload jsonb)
returns public.store_posts language sql volatile security invoker set search_path = '' as $$
  select * from private.save_store_post(p_post_id, p_request_id, p_action, p_payload) $$;
revoke all on function public.save_store_post(uuid, uuid, text, jsonb) from public;
grant execute on function public.save_store_post(uuid, uuid, text, jsonb) to authenticated;

-- 'archived' hides a published post; 'published' restores an archived one (original publication time kept);
-- 'discard_edits' drops unsaved edits of a live post. Linked products are never touched.
create or replace function private.set_store_post_status(p_post_id uuid, p_status text)
returns public.store_posts language plpgsql volatile security definer set search_path = '' as $$
declare r public.store_posts;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  select * into r from public.store_posts where id = p_post_id for update;
  if not found then raise exception 'This post no longer exists.' using errcode = 'P0002'; end if;
  if p_status = 'archived' and r.status = 'published' then
    update public.store_posts set status = 'archived', archived_at = now(), updated_at = now() where id = r.id returning * into r;
  elsif p_status = 'published' and r.status = 'archived' then
    update public.store_posts set status = 'published', archived_at = null, updated_at = now() where id = r.id returning * into r;
  elsif p_status = 'discard_edits' then
    update public.store_posts set pending_revision = null, updated_at = now() where id = r.id returning * into r;
  elsif p_status is distinct from r.status then
    raise exception 'That change is not available for this post.' using errcode = '22023';
  end if;
  return r;
end $$;
revoke all on function private.set_store_post_status(uuid, text) from public;
grant execute on function private.set_store_post_status(uuid, text) to authenticated;

create or replace function public.set_store_post_status(p_post_id uuid, p_status text)
returns public.store_posts language sql volatile security invoker set search_path = '' as $$
  select * from private.set_store_post_status(p_post_id, p_status) $$;
revoke all on function public.set_store_post_status(uuid, text) from public;
grant execute on function public.set_store_post_status(uuid, text) to authenticated;

-- Deletes a never-published draft and returns the media paths it used (the client removes those files).
create or replace function private.delete_store_post_draft(p_post_id uuid)
returns text[] language plpgsql volatile security definer set search_path = '' as $$
declare r public.store_posts;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  delete from public.store_posts where id = p_post_id and status = 'draft' returning * into r;
  if not found then raise exception 'Only drafts can be deleted. Archive a published post instead.' using errcode = '22023'; end if;
  return array_remove(array[r.media_path, r.poster_path], null);
end $$;
revoke all on function private.delete_store_post_draft(uuid) from public;
grant execute on function private.delete_store_post_draft(uuid) to authenticated;

create or replace function public.delete_store_post_draft(p_post_id uuid)
returns text[] language sql volatile security invoker set search_path = '' as $$
  select private.delete_store_post_draft(p_post_id) $$;
revoke all on function public.delete_store_post_draft(uuid) from public;
grant execute on function public.delete_store_post_draft(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Customer feed. kind: all | photos | videos | updates. Keyset pagination on (published_at, id).
-- The linked product comes from the CURRENT catalog; hidden/archived/deleted products return
-- product = null with product_unavailable = true so the storefront can drop the buying action.
create or replace function private.store_feed(p_kind text, p_before timestamptz, p_before_id uuid, p_limit integer, p_post_id uuid)
returns table(id uuid, caption text, media_kind text, media_path text, poster_path text, media_width integer,
              media_height integer, media_duration numeric, media_alt text, published_at timestamptz,
              product jsonb, product_unavailable boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.caption, s.media_kind, s.media_path, s.poster_path, s.media_width, s.media_height, s.media_duration,
         s.media_alt, s.published_at,
         case when pr.id is not null then jsonb_build_object(
           'id', pr.id, 'slug', pr.slug, 'name', pr.name, 'kind', pr.kind, 'image_path', pr.image_path,
           'min_price', (select min(v.price) from public.product_variants v where v.product_id = pr.id and v.is_active),
           'available', exists (select 1 from public.product_variants v where v.product_id = pr.id and v.is_active)) end,
         s.product_id is not null and pr.id is null
  from public.store_posts s
  left join public.products pr on pr.id = s.product_id and pr.status = 'active'
       and (pr.category_id is null or exists (select 1 from public.categories c where c.id = pr.category_id and c.is_active))
  where s.status = 'published'
    and (p_post_id is null or s.id = p_post_id)
    and (coalesce(p_kind, 'all') = 'all'
         or (p_kind = 'photos' and s.media_kind = 'image')
         or (p_kind = 'videos' and s.media_kind = 'video')
         or (p_kind = 'updates' and s.media_kind = 'none'))
    and (p_before is null or (s.published_at, s.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by s.published_at desc, s.id desc
  limit least(greatest(coalesce(p_limit, 12), 1), 40)
$$;
revoke all on function private.store_feed(text, timestamptz, uuid, integer, uuid) from public;
grant execute on function private.store_feed(text, timestamptz, uuid, integer, uuid) to anon, authenticated;

create or replace function public.get_store_feed(p_kind text default 'all', p_before timestamptz default null,
  p_before_id uuid default null, p_limit integer default 12, p_post_id uuid default null)
returns table(id uuid, caption text, media_kind text, media_path text, poster_path text, media_width integer,
              media_height integer, media_duration numeric, media_alt text, published_at timestamptz,
              product jsonb, product_unavailable boolean)
language sql stable security invoker set search_path = '' as $$
  select * from private.store_feed(p_kind, p_before, p_before_id, p_limit, p_post_id) $$;
revoke all on function public.get_store_feed(text, timestamptz, uuid, integer, uuid) from public;
grant execute on function public.get_store_feed(text, timestamptz, uuid, integer, uuid) to anon, authenticated;
