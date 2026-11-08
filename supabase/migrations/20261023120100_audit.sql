-- Storico modifiche (decisione 3): chi ha cambiato cosa e quando. actor è vuoto per l'import e per la chiave di servizio.
create table audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  action text not null,
  new_data jsonb,
  old_data jsonb,
  actor uuid default auth.uid(),
  at timestamptz not null default now()
);

alter table audit_log enable row level security;
create policy team_read on audit_log for select to authenticated using (true);

create function log_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (table_name, action, new_data, old_data)
  values (tg_table_name, tg_op,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          case when tg_op <> 'INSERT' then to_jsonb(old) end);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['people', 'units', 'use_cases', 'devices', 'tests', 'test_devices', 'configurations',
                           'releases', 'release_signatures', 'sessions', 'results', 'reports'] loop
    execute format('create trigger audit after insert or update or delete on %I for each row execute function log_change()', t);
  end loop;
end $$;
