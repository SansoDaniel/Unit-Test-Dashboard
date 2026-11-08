-- Fase 3: i dispositivi di ogni configurazione hardware. Decidono quali test entrano in una nuova sessione.
create table configuration_devices (
  configuration_id uuid references configurations on delete cascade,
  device_id uuid references devices on delete restrict,
  primary key (configuration_id, device_id)
);

alter table configuration_devices enable row level security;
create policy team_all on configuration_devices for all to authenticated using (true) with check (true);
create trigger audit after insert or update or delete on configuration_devices for each row execute function log_change();
