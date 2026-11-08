export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CODE = /^\d{1,9}$/;
export const text = (v) => String(v ?? '').trim();
export const uuidOrNull = (v) => (UUID.test(v ?? '') ? v : null);
export const list = (v) => [].concat(v ?? []).map(String);
export const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') && !Number.isNaN(Date.parse(v)) ? v : null);
export const fmtDay = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');

// Vincoli violati che l'utente può correggere nel form.
const CONSTRAINT_MESSAGES = {
  tests_code_key: 'Esiste già un test con questo ID.',
  units_name_key: "Esiste già un'unità con questo nome.",
  use_cases_unit_id_name_key: "In questa unità esiste già un caso d'uso con questo nome.",
  devices_name_key: 'Esiste già un dispositivo con questo nome.',
  releases_version_key: 'Esiste già una release con questa versione.',
  configurations_name_key: 'Esiste già una configurazione con questo nome.',
  people_full_name_key: 'Esiste già una persona con questo nome.',
  people_user_id_key: "Questo account è già collegato a un'altra persona.",
  release_signatures_pkey: 'Questa persona ha già questa firma sulla release.',
  tests_use_case_id_fkey: "Il caso d'uso scelto non esiste più.",
  use_cases_unit_id_fkey: "L'unità scelta non esiste più.",
  test_devices_device_id_fkey: 'Uno dei dispositivi scelti non esiste più.',
  configuration_devices_device_id_fkey: 'Uno dei dispositivi scelti non esiste più.',
  releases_author_id_fkey: 'La persona scelta non esiste più.',
  release_signatures_person_id_fkey: 'La persona scelta non esiste più.',
  sessions_tester_id_fkey: 'La persona scelta non esiste più.',
  sessions_release_id_fkey: 'La release scelta non esiste più.',
  sessions_configuration_id_fkey: 'La configurazione scelta non esiste più.',
  people_user_id_fkey: "L'account scelto non esiste più.",
};
export const userError = (err) => CONSTRAINT_MESSAGES[err.constraint] ?? null;

// Allinea i dispositivi di un test o di una configurazione a quelli scelti nel form.
const LINKS = { test: ['test_devices', 'test_id'], configuration: ['configuration_devices', 'configuration_id'] };
export async function syncDevices(q, kind, ownerId, deviceIds) {
  const [table, owner] = LINKS[kind];
  const ids = JSON.stringify(deviceIds);
  await q.query(`delete from ${table} where ${owner} = $1 and device_id::text not in (select jsonb_array_elements_text($2::jsonb))`, [ownerId, ids]);
  await q.query(`insert into ${table} (${owner}, device_id) select $1, d::uuid from jsonb_array_elements_text($2::jsonb) d on conflict do nothing`, [ownerId, ids]);
}
