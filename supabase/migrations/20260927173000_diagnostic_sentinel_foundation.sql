
create table if not exists public.system_diagnostic_events (
  id uuid primary key default gen_random_uuid(),
  organization_id text references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  kind text not null,
  severity text not null default 'error' check (severity in ('info','warning','error','fatal')),
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  fingerprint text not null,
  route text not null default '',
  surface text not null default '',
  message text not null,
  stack text not null default '',
  request_id text,
  build_id text not null default '',
  user_agent text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  occurrences integer not null default 1 check (occurrences > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, fingerprint, route, build_id)
);

create index if not exists system_diagnostic_events_org_status_last_idx
  on public.system_diagnostic_events (organization_id, status, last_seen_at desc);

create index if not exists system_diagnostic_events_org_last_idx
  on public.system_diagnostic_events (organization_id, last_seen_at desc);

create index if not exists system_diagnostic_events_fingerprint_idx
  on public.system_diagnostic_events (fingerprint);

alter table public.system_diagnostic_events enable row level security;
