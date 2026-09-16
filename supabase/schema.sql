-- openplex sync schema (v2)
-- Paste this whole file into the Supabase SQL editor and run it.
-- Safe to re-run on an existing project (only adds what's missing).

create table if not exists public.threads (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New chat',
  system_prompt text,
  model_ref jsonb,
  web_search boolean,
  prefs jsonb,
  pinned boolean not null default false,
  archived boolean not null default false,
  deleted boolean not null default false,
  untitled boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- v1 -> v2 upgrade
alter table public.threads add column if not exists prefs jsonb;

create table if not exists public.messages (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  reasoning text,
  model jsonb,
  usage jsonb,
  sources jsonb,
  tool_steps jsonb,
  variants jsonb,
  status text not null default 'complete',
  error text,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- v2 -> v3: agent tool-step trace travels with the message so it shows on every device
alter table public.messages add column if not exists tool_steps jsonb;

-- v3 -> v4: kept alternate answers (regeneration branches) sync as { list, index }
alter table public.messages add column if not exists variants jsonb;

create table if not exists public.memories (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null,
  source text not null default 'manual',
  enabled boolean not null default true,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- one row per user: synced settings + the E2E-encrypted API-key blob.
-- Keys inside data->'keysBlob' are AES-GCM ciphertext; the passphrase never
-- leaves the user's devices, so this row is useless without it.
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists threads_user_updated on public.threads (user_id, updated_at);
create index if not exists messages_user_updated on public.messages (user_id, updated_at);
create index if not exists messages_thread on public.messages (thread_id);
create index if not exists memories_user_updated on public.memories (user_id, updated_at);

alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "own threads" on public.threads;
create policy "own threads" on public.threads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own messages" on public.messages;
create policy "own messages" on public.messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own memories" on public.memories;
create policy "own memories" on public.memories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Last-write-wins guard: when two devices edit the same row, the newest edit
-- must win regardless of which one pushes last. This trigger ignores any UPDATE
-- whose updated_at is older than the stored row (a stale write), so older
-- versions are discarded and the latest is kept.
create or replace function public.lww_guard() returns trigger as $$
begin
  if NEW.updated_at < OLD.updated_at then
    return OLD; -- incoming write is stale — keep the newer row
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists threads_lww on public.threads;
create trigger threads_lww before update on public.threads
  for each row execute function public.lww_guard();

drop trigger if exists messages_lww on public.messages;
create trigger messages_lww before update on public.messages
  for each row execute function public.lww_guard();

drop trigger if exists memories_lww on public.memories;
create trigger memories_lww before update on public.memories
  for each row execute function public.lww_guard();

drop trigger if exists user_settings_lww on public.user_settings;
create trigger user_settings_lww before update on public.user_settings
  for each row execute function public.lww_guard();

-- Live cross-device updates (optional but nice). One block per table so a
-- duplicate on re-run doesn't stop the rest.
do $$ begin
  alter publication supabase_realtime add table public.threads;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.memories;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Agent compute queue (v3): lets the app drive a paired "computer" (the
-- `openplex agent` runner on your PC) over this same Supabase project. The app
-- inserts a job row; the runner — signed in as you, filtered to its device
-- token — picks it up via realtime, executes it, and writes the result back.
-- All rows are RLS-scoped to the owner, so nothing here is reachable by anyone
-- but you. Generated files land in the `agent-files` storage bucket below.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_jobs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- which paired computer should run this (matches the runner's device token)
  device text not null,
  -- chat thread → each thread gets its own persistent shell on the runner
  thread_id uuid,
  -- terminal | code | write_file | edit_file | read_file | list_files | make_document
  tool text not null,
  input jsonb not null default '{}'::jsonb,
  -- pending → running → done | error
  status text not null default 'pending',
  stdout text,
  stderr text,
  exit_code int,
  -- structured result: { files?: [{name,path,bucketKey,bytes,mime}], text?, error? }
  output jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_jobs_device_status on public.agent_jobs (device, status);
create index if not exists agent_jobs_user_updated on public.agent_jobs (user_id, updated_at);

alter table public.agent_jobs enable row level security;

drop policy if exists "own agent_jobs" on public.agent_jobs;
create policy "own agent_jobs" on public.agent_jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$ begin
  alter publication supabase_realtime add table public.agent_jobs;
exception when duplicate_object then null; end $$;

-- Private bucket for files the agent generates (PDFs, docs, scripts, …).
-- Objects are stored under "<user_id>/..." and locked to the owner by the
-- policies below, so a signed/owner download is the only way to read them.
insert into storage.buckets (id, name, public)
  values ('agent-files', 'agent-files', false)
  on conflict (id) do nothing;

drop policy if exists "own agent files read" on storage.objects;
create policy "own agent files read" on storage.objects
  for select using (
    bucket_id = 'agent-files' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own agent files write" on storage.objects;
create policy "own agent files write" on storage.objects
  for insert with check (
    bucket_id = 'agent-files' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own agent files update" on storage.objects;
create policy "own agent files update" on storage.objects
  for update using (
    bucket_id = 'agent-files' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own agent files delete" on storage.objects;
create policy "own agent files delete" on storage.objects
  for delete using (
    bucket_id = 'agent-files' and (storage.foldername(name))[1] = auth.uid()::text
  );
