-- Ting's Snack House: move storefront images out of table JSON/Base64 fields.
-- Run once in the Supabase SQL editor as the project owner.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'storefront-images',
  'storefront-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- The current footer artwork is already bundled as a much smaller WebP.
-- Keep only that static path in settings instead of the Base64 PNG payload.
update public.shop_settings
set content = jsonb_set(
  coalesce(content, '{}'::jsonb),
  '{storyBackgroundImage}',
  to_jsonb('footer-composite-v1.webp'::text),
  true
)
where id = 1
  and coalesce(content ->> 'storyBackgroundImage', '') like 'data:image/%';

drop policy if exists "public reads storefront images" on storage.objects;
drop policy if exists "owner inserts storefront images" on storage.objects;
drop policy if exists "owner updates storefront images" on storage.objects;
drop policy if exists "owner deletes storefront images" on storage.objects;

create policy "public reads storefront images"
on storage.objects for select
to public
using (bucket_id = 'storefront-images');

create policy "owner inserts storefront images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'storefront-images'
  and (auth.jwt() ->> 'email') = 'chenghanchen1@gmail.com'
);

create policy "owner updates storefront images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'storefront-images'
  and (auth.jwt() ->> 'email') = 'chenghanchen1@gmail.com'
)
with check (
  bucket_id = 'storefront-images'
  and (auth.jwt() ->> 'email') = 'chenghanchen1@gmail.com'
);

create policy "owner deletes storefront images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'storefront-images'
  and (auth.jwt() ->> 'email') = 'chenghanchen1@gmail.com'
);
