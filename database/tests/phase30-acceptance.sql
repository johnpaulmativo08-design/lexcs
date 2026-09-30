-- LOCAL ONLY: acceptance tests for phase30-store-posts.sql. Run against a DISPOSABLE database built from
-- tests/local-supabase-stub.sql + phases 2-30, with Admin ...0a and customer ...0c. Never run on Supabase.
-- Everything runs inside one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function pg_temp.who(sub text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(sub, ''), false) $$;
create or replace function pg_temp.upload(path text, mime text, bytes bigint) returns void language sql as $$
  insert into storage.objects(bucket_id, name, metadata) values ('post-media', path, jsonb_build_object('mimetype', mime, 'size', bytes)) $$;
create or replace function pg_temp.fails(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

create temp table t(k text primary key, v uuid);
grant all on t to anon, authenticated;
insert into t values ('product', (select id from public.products where status = 'active' and kind = 'standard' order by sort_order limit 1)),
                     ('draft_req', gen_random_uuid()), ('pub_req', gen_random_uuid()), ('video_req', gen_random_uuid());
select pg_temp.upload('posts/11111111-1111-1111-1111-111111111111/photo.webp', 'image/webp', 250000);
select pg_temp.upload('posts/22222222-2222-2222-2222-222222222222/clip.mp4', 'video/mp4', 9000000);
select pg_temp.upload('posts/22222222-2222-2222-2222-222222222222/cover.webp', 'image/webp', 90000);
select pg_temp.upload('posts/33333333-3333-3333-3333-333333333333/new.webp', 'image/webp', 120000);
select pg_temp.upload('posts/44444444-4444-4444-4444-444444444444/huge.png', 'image/png', 9000000);
select pg_temp.upload('posts/55555555-5555-5555-5555-555555555555/doc.webp', 'application/pdf', 1000);

-- 1. Customers and anonymous visitors cannot write or read raw posts --------------------------------
set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000c');
select pg_temp.check(pg_temp.fails($$select public.save_store_post(null, gen_random_uuid(), 'publish', '{"caption":"hi"}')$$) like '42501%', 'customer cannot publish');
select pg_temp.check(pg_temp.fails($$insert into public.store_posts(request_id, caption) values (gen_random_uuid(), 'x')$$) is not null, 'customer cannot insert directly');
reset role; set role anon; select pg_temp.who(null);
select pg_temp.check(pg_temp.fails($$select public.save_store_post(null, gen_random_uuid(), 'draft', '{"caption":"hi"}')$$) is not null, 'anonymous cannot save');
select pg_temp.check(pg_temp.fails($$select * from public.store_posts$$) is not null, 'anonymous cannot select table');
reset role;

-- 2. Owner drafts, publishes, retries without duplicates ------------------------------------------
set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000a');
select pg_temp.check(pg_temp.fails($$select public.save_store_post(null, gen_random_uuid(), 'draft', '{"caption":"   "}')$$) like '22023%', 'empty post rejected');
select pg_temp.check(pg_temp.fails($$select public.save_store_post(null, gen_random_uuid(), 'publish', '{"caption":"x","media_kind":"image","media_path":"posts/99999999-9999-9999-9999-999999999999/missing.webp"}')$$) like '22023%not finished uploading%', 'missing upload rejected');
select pg_temp.check(pg_temp.fails($$select public.save_store_post(null, gen_random_uuid(), 'publish', '{"media_kind":"image","media_path":"posts/44444444-4444-4444-4444-444444444444/huge.png"}')$$) like '22023%8 MB%', 'oversized photo rejected');
select pg_temp.check(pg_temp.fails($$select public.save_store_post(null, gen_random_uuid(), 'publish', '{"media_kind":"image","media_path":"posts/55555555-5555-5555-5555-555555555555/doc.webp"}')$$) like '22023%', 'wrong file type rejected');
select pg_temp.check(pg_temp.fails($$select public.save_store_post(null, gen_random_uuid(), 'publish', '{"media_kind":"image","media_path":"../../etc/passwd"}')$$) like '22023%', 'path traversal rejected');
select pg_temp.check(pg_temp.fails(format($$select public.save_store_post(null, gen_random_uuid(), 'publish', '{"caption":"%s"}')$$, repeat('a', 2201))) like '22023%', 'caption limit enforced');

update t set v = (select id from public.save_store_post(null, (select v from t where k = 'draft_req'), 'draft',
  jsonb_build_object('caption', 'Secret menu teaser', 'media_kind', 'image', 'media_path', 'posts/11111111-1111-1111-1111-111111111111/photo.webp',
                     'media_width', 1200, 'media_height', 1500))) where k = 'draft_req';
select pg_temp.check((select status from public.store_posts where id = (select v from t where k = 'draft_req')) = 'draft', 'draft saved');
select pg_temp.check((select id from public.save_store_post(null, gen_random_uuid(), 'draft', '{"caption":"x"}')) is not null, 'text-only draft saved');

insert into t values ('pub', (select id from public.save_store_post(null, (select v from t where k = 'pub_req'), 'publish',
  jsonb_build_object('caption', 'Fresh ube cookies today!', 'product_id', (select v from t where k = 'product')))));
select pg_temp.check((select id from public.save_store_post(null, (select v from t where k = 'pub_req'), 'publish', '{"caption":"Fresh ube cookies today!"}')) = (select v from t where k = 'pub'), 'retry returns the same post');
select pg_temp.check((select count(*) from public.store_posts where request_id = (select v from t where k = 'pub_req')) = 1, 'no duplicate on retry');

insert into t values ('video', (select id from public.save_store_post(null, (select v from t where k = 'video_req'), 'publish',
  jsonb_build_object('caption', 'Frosting in action', 'media_kind', 'video', 'media_path', 'posts/22222222-2222-2222-2222-222222222222/clip.mp4',
                     'poster_path', 'posts/22222222-2222-2222-2222-222222222222/cover.webp', 'media_duration', 18.4, 'media_width', 720, 'media_height', 1280))));
reset role;

-- 3. Public feed: only published posts, correct kinds, drafts and their media hidden -------------------
set role anon; select pg_temp.who(null);
select pg_temp.check((select count(*) from public.get_store_feed('all')) = 2, 'anon sees exactly the 2 published posts');
select pg_temp.check((select count(*) from public.get_store_feed('videos')) = 1 and (select count(*) from public.get_store_feed('photos')) = 0
  and (select count(*) from public.get_store_feed('updates')) = 1, 'kind filters');
select pg_temp.check((select (product->>'available')::boolean and product->>'name' is not null from public.get_store_feed('updates')), 'linked product comes from catalog');
select pg_temp.check((select count(*) from public.get_store_feed('all', null, null, 12, (select v from t where k = 'draft_req'))) = 0, 'draft not reachable by id');
select pg_temp.check(private.post_media_visible('posts/22222222-2222-2222-2222-222222222222/cover.webp'), 'published video cover is readable');
select pg_temp.check(not private.post_media_visible('posts/11111111-1111-1111-1111-111111111111/photo.webp'), 'draft photo is NOT readable');
select pg_temp.check((select count(*) from public.get_store_feed('all', (select published_at from public.get_store_feed('all') limit 1),
  (select id from public.get_store_feed('all') limit 1), 12)) = 1, 'keyset pagination returns the next page');
reset role;

-- 4. Editing a live post keeps customers on the published version until saved ------------------------
set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000a');
select public.save_store_post((select v from t where k = 'pub'), null, 'draft',
  '{"caption":"EDIT IN PROGRESS","media_kind":"image","media_path":"posts/33333333-3333-3333-3333-333333333333/new.webp"}');
reset role; set role anon; select pg_temp.who(null);
select pg_temp.check((select caption from public.get_store_feed('updates')) = 'Fresh ube cookies today!', 'unsaved edit not visible');
select pg_temp.check(not private.post_media_visible('posts/33333333-3333-3333-3333-333333333333/new.webp'), 'unsaved edit media not readable');
reset role;
set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000a');
insert into t values ('pub_time', null);
select pg_temp.check((select pending_revision->>'caption' from public.store_posts where id = (select v from t where k = 'pub')) = 'EDIT IN PROGRESS', 'owner can reopen unsaved edit');
create temp table before_save as select published_at from public.store_posts where id = (select v from t where k = 'pub');
select public.save_store_post((select v from t where k = 'pub'), null, 'save',
  jsonb_build_object('caption', 'Now with photo', 'media_kind', 'image', 'media_path', 'posts/33333333-3333-3333-3333-333333333333/new.webp',
                     'product_id', (select v from t where k = 'product')));
select pg_temp.check((select pending_revision is null and published_at = (select published_at from before_save) from public.store_posts where id = (select v from t where k = 'pub')), 'save applies edit and keeps publication time');
reset role; set role anon; select pg_temp.who(null);
select pg_temp.check((select caption from public.get_store_feed('photos')) = 'Now with photo', 'saved edit visible');
reset role;

-- 5. Archive / restore / delete; catalog and orders untouched -----------------------------------------
create temp table snapshot as select (select count(*) from public.orders) orders, (select count(*) from public.products where status = 'active') products,
  (select sum(price) from public.product_variants) prices;
set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000c');
select pg_temp.check(pg_temp.fails($$select public.set_store_post_status((select v from t where k = 'pub'), 'archived')$$) like '42501%', 'customer cannot archive');
select pg_temp.who('00000000-0000-0000-0000-00000000000a');
select public.set_store_post_status((select v from t where k = 'pub'), 'archived');
reset role; set role anon; select pg_temp.who(null);
select pg_temp.check((select count(*) from public.get_store_feed('all')) = 1, 'archived post hidden');
select pg_temp.check(not private.post_media_visible('posts/33333333-3333-3333-3333-333333333333/new.webp'), 'archived media no longer readable');
reset role;
select pg_temp.check((select orders from snapshot) = (select count(*) from public.orders) and (select products from snapshot) = (select count(*) from public.products where status = 'active')
  and (select prices from snapshot) = (select sum(price) from public.product_variants), 'catalog, prices and orders unchanged');
set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000a');
select public.set_store_post_status((select v from t where k = 'pub'), 'published');
select pg_temp.check((select published_at from public.store_posts where id = (select v from t where k = 'pub')) = (select published_at from before_save), 'restore keeps original publication time');
select pg_temp.check(pg_temp.fails($$select public.delete_store_post_draft((select v from t where k = 'pub'))$$) like '22023%', 'published post cannot be deleted');
select pg_temp.check((select public.delete_store_post_draft((select v from t where k = 'draft_req'))) = array['posts/11111111-1111-1111-1111-111111111111/photo.webp'], 'draft deleted, media paths returned');
reset role;

-- 6. Hidden product: link suppressed, post stays --------------------------------------------------------
update public.products set status = 'archived' where id = (select v from t where k = 'product');
set role anon; select pg_temp.who(null);
select pg_temp.check((select product is null and product_unavailable from public.get_store_feed('photos')), 'hidden product suppressed without breaking the post');
reset role;
rollback;
