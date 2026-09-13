create table if not exists public.identity_shared_contacts (id uuid primary key default gen_random_uuid(),organization_id text not null references public.organizations(id) on delete cascade,person_a_id uuid not null references public.people(id) on delete cascade,person_b_id uuid not null references public.people(id) on delete cascade,phone text not null,confirmed_by uuid,confirmed_at timestamptz not null default now(),metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),constraint identity_shared_contacts_distinct_people check(person_a_id<>person_b_id));
create unique index if not exists identity_shared_contacts_pair_phone_idx on public.identity_shared_contacts(organization_id,least(person_a_id,person_b_id),greatest(person_a_id,person_b_id),phone);
create index if not exists identity_shared_contacts_org_phone_idx on public.identity_shared_contacts(organization_id,phone);
alter table public.identity_shared_contacts enable row level security;
revoke all on public.identity_shared_contacts from anon,authenticated;
create index if not exists people_org_status_identity_idx on public.people(organization_id,status,identity_verification_status);
create index if not exists identity_pair_decisions_org_pair_idx on public.identity_pair_decisions(organization_id,person_a_id,person_b_id);
comment on table public.identity_shared_contacts is 'Explicit human-confirmed shared contact relationships within one organization. A shared phone is not duplicate identity evidence once confirmed.';
