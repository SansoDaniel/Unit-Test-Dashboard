-- Import iniziale dal file Excel in un'unica transazione: o entra tutto o niente.
-- Lo chiama solo scripts/import-excel.js con la chiave di servizio; gli id arrivano già generati dallo script.
create function import_workbook(payload jsonb) returns void
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from tests) then
    raise exception 'Il catalogo contiene già dei test: l''import si esegue una sola volta, su un database vuoto';
  end if;

  insert into people (id, full_name, title)
  select id, full_name, title from jsonb_populate_recordset(null::people, payload->'people');
  insert into units (id, name, position)
  select id, name, position from jsonb_populate_recordset(null::units, payload->'units');
  insert into use_cases (id, unit_id, name, position)
  select id, unit_id, name, position from jsonb_populate_recordset(null::use_cases, payload->'use_cases');
  insert into devices (id, name)
  select id, name from jsonb_populate_recordset(null::devices, payload->'devices');
  insert into tests (id, code, use_case_id, name, description, operations, position)
  select id, code, use_case_id, name, description, operations, position from jsonb_populate_recordset(null::tests, payload->'tests');
  insert into test_devices (test_id, device_id)
  select test_id, device_id from jsonb_populate_recordset(null::test_devices, payload->'test_devices');
  insert into configurations (id, name)
  select id, name from jsonb_populate_recordset(null::configurations, payload->'configurations');
  insert into releases (id, version, released_on, author_id, changes, position)
  select id, version, released_on, author_id, changes, position from jsonb_populate_recordset(null::releases, payload->'releases');
  insert into release_signatures (release_id, person_id, role, signed_on)
  select release_id, person_id, role, signed_on from jsonb_populate_recordset(null::release_signatures, payload->'release_signatures');
  insert into sessions (id, release_id, configuration_id, tester_id, started_on, status)
  select id, release_id, configuration_id, tester_id, started_on, status from jsonb_populate_recordset(null::sessions, payload->'sessions');
  insert into results (session_id, test_id, outcome, note, graphic_issue)
  select session_id, test_id, outcome, note, graphic_issue from jsonb_populate_recordset(null::results, payload->'results');
  insert into reports (release_id, test_date, executed_by, motivation, next_actions, final_outcome, status)
  select release_id, test_date, executed_by, motivation, next_actions, final_outcome, status from jsonb_populate_recordset(null::reports, payload->'reports');
end $$;

revoke execute on function import_workbook(jsonb) from public, anon, authenticated;
grant execute on function import_workbook(jsonb) to service_role;
