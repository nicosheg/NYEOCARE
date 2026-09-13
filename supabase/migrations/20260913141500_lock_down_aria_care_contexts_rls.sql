alter table public.aria_care_contexts enable row level security;
revoke all on public.aria_care_contexts from anon,authenticated;
