-- Fase 1: catalogo, release, sessioni, esiti e report.
-- Notifiche (fase 4) e dispositivi per configurazione (fase 3) arrivano con le loro migrazioni.

create type outcome as enum ('PASSED', 'NOT PASSED', 'NOT TESTED', 'NOT AVAILABLE');
create type session_status as enum ('open', 'closed');
create type report_status as enum ('draft', 'pending_approval', 'approved');

-- Persone citate nei documenti (autori, approvatori, tester). user_id si collega quando la persona ha un account.
create table people (
  id uuid primary key default gen_random_uuid(),
  full_name text not null unique,
  title text,
  user_id uuid unique references auth.users on delete set null
);

create table units (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  position int not null
);

create table use_cases (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units on delete restrict,
  name text not null,
  position int not null,
  unique (unit_id, name)
);

create table devices (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table tests (
  id uuid primary key default gen_random_uuid(),
  code int not null unique, -- "ID Test" del file Excel
  use_case_id uuid not null references use_cases on delete restrict,
  name text not null,
  description text,
  operations text,
  position int not null,
  archived boolean not null default false
);

create table test_devices (
  test_id uuid references tests on delete cascade,
  device_id uuid references devices on delete restrict,
  primary key (test_id, device_id)
);

create table configurations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text
);

create table releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  released_on date,
  author_id uuid references people on delete restrict,
  changes text,
  position int not null
);

create table release_signatures (
  release_id uuid references releases on delete cascade,
  person_id uuid references people on delete restrict,
  role text not null check (role in ('author', 'approver')),
  signed_on date,
  primary key (release_id, person_id, role)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references releases on delete restrict,
  configuration_id uuid not null references configurations on delete restrict,
  tester_id uuid references people on delete restrict,
  started_on date,
  status session_status not null default 'open'
);

-- Un test con esiti non si può cancellare (restrict): l'app lo archivia.
create table results (
  session_id uuid references sessions on delete cascade,
  test_id uuid references tests on delete restrict,
  outcome outcome not null default 'NOT TESTED',
  note text,
  graphic_issue boolean not null default false,
  executed_by uuid references people on delete set null,
  executed_at timestamptz,
  primary key (session_id, test_id)
);

create table reports (
  release_id uuid primary key references releases on delete cascade,
  test_date date,
  executed_by uuid references people on delete set null,
  motivation text,
  next_actions text,
  final_outcome outcome check (final_outcome in ('PASSED', 'NOT PASSED')),
  final_reason text,
  status report_status not null default 'draft'
);

create view session_outcomes with (security_invoker = true) as
select s.id as session_id, c.name as configuration, r.outcome, count(*)::int as n
from sessions s
join configurations c on c.id = s.configuration_id
join results r on r.session_id = s.id
group by s.id, c.name, r.outcome;

-- Ogni utente autenticato fa parte del team e legge/scrive tutto; il ruolo anon non vede nulla.
-- Le registrazioni pubbliche vanno disattivate in Supabase (vedi README).
do $$
declare t text;
begin
  foreach t in array array['people', 'units', 'use_cases', 'devices', 'tests', 'test_devices', 'configurations',
                           'releases', 'release_signatures', 'sessions', 'results', 'reports'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy team_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
