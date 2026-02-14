-- Run this in the Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- Creates: meetings table, RLS policies, storage bucket + policies

-- 1. Meetings table
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  upload_date timestamptz default now(),
  duration text default '0:00',
  file_name text default '',
  word_count int default 0,
  transcript text default '',
  summary text default '',
  key_insights jsonb default '[]',
  decisions jsonb default '[]',
  action_items jsonb default '[]',
  processed boolean default false,
  audio_path text,
  error text,
  created_at timestamptz default now()
);

-- 2. Row-level security
alter table public.meetings enable row level security;

create policy "Users see own meetings"
  on public.meetings for select using (auth.uid() = user_id);
create policy "Users insert own meetings"
  on public.meetings for insert with check (auth.uid() = user_id);
create policy "Users update own meetings"
  on public.meetings for update using (auth.uid() = user_id);
create policy "Users delete own meetings"
  on public.meetings for delete using (auth.uid() = user_id);

-- 3. Storage bucket for audio files
insert into storage.buckets (id, name, public)
  values ('meeting-audio', 'meeting-audio', false);

create policy "Users upload own audio"
  on storage.objects for insert
  with check (bucket_id = 'meeting-audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users read own audio"
  on storage.objects for select
  using (bucket_id = 'meeting-audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users delete own audio"
  on storage.objects for delete
  using (bucket_id = 'meeting-audio' and (storage.foldername(name))[1] = auth.uid()::text);
