-- Optional read-only size audit for the Supabase SQL Editor. This estimates
-- payload sources; only Organization > Usage reports actual billed egress.
select count(*) as boss_events,
 round(avg(octet_length(to_jsonb(b)::text))) as average_full_boss_bytes,
 max(octet_length(to_jsonb(b)::text)) as largest_full_boss_bytes
from public.boss_events b;
select count(*) as student_profiles,
 count(*) filter(where profile_pic_url like 'data:%') as embedded_photos,
 coalesce(sum(octet_length(profile_pic_url)),0) as total_photo_field_bytes
from public.profiles where role='student';
select bucket_id,count(*) as files,
 coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric else 0 end),0) as stored_bytes
from storage.objects group by bucket_id order by stored_bytes desc;
