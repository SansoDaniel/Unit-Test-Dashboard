-- Fase 4: notifiche nell'app, create dal database così nessun evento si perde.
-- Destinatari (decisione 8): nuovo NOT PASSED e sessione chiusa → autore e approvatori della release;
-- report da approvare → approvatori. Chi compie l'azione non riceve la propria notifica.
create type notification_event as enum ('not_passed', 'session_closed', 'report_pending');

create table notifications (
  id bigint generated always as identity primary key,
  person_id uuid not null references people on delete cascade,
  event notification_event not null,
  title text not null,
  detail text,
  link text not null check (link like '/%' and link not like '//%'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_person_unread on notifications (person_id) where read_at is null;

alter table notifications enable row level security;
create policy own_notifications on notifications for all to authenticated
  using (person_id in (select id from people where user_id = auth.uid()))
  with check (person_id in (select id from people where user_id = auth.uid()));

-- Nome di chi compie l'azione: la persona collegata all'account, altrimenti l'email.
create function actor_name() returns text language sql stable set search_path = public as $$
  select coalesce((select full_name from people where user_id = auth.uid()),
                  nullif(current_setting('request.jwt.claim.email', true), ''), 'sistema')
$$;

create function notify(rel uuid, roles text[], ev notification_event, title text, detail text, link text) returns void
language sql security definer set search_path = public as $$
  insert into notifications (person_id, event, title, detail, link)
  select p, ev, title, detail, link
  from (select author_id as p from releases where id = rel and 'author' = any(roles)
        union select person_id from release_signatures where release_id = rel and role = any(roles)) x
  where p is not null and p not in (select id from people where user_id is not null and user_id = auth.uid())
$$;

create function notify_not_passed() returns trigger language plpgsql security definer set search_path = public as $$
declare s record; t record;
begin
  if new.outcome = 'NOT PASSED' and old.outcome is distinct from 'NOT PASSED' then
    select se.id, se.release_id, c.name as configuration into s
    from sessions se join configurations c on c.id = se.configuration_id where se.id = new.session_id;
    select code, name into t from tests where id = new.test_id;
    perform notify(s.release_id, array['author', 'approver'], 'not_passed',
      format('Test %s · %s', t.code, t.name), format('%s · registrato da %s', s.configuration, actor_name()),
      format('/sessioni/%s#t-%s', s.id, t.code));
  end if;
  return null;
end $$;
create trigger notify_not_passed after update of outcome on results for each row execute function notify_not_passed();

create function notify_session_closed() returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if new.status = 'closed' and old.status <> 'closed' then
    select cf.name,
           count(*) filter (where x.outcome = 'PASSED') as passed, count(*) filter (where x.outcome = 'NOT PASSED') as failed,
           count(*) filter (where x.outcome = 'NOT TESTED') as todo
    into c from configurations cf left join results x on x.session_id = new.id where cf.id = new.configuration_id group by cf.name;
    perform notify(new.release_id, array['author', 'approver'], 'session_closed', c.name,
      format('%s PASSED · %s NOT PASSED · %s NOT TESTED · chiusa da %s', c.passed, c.failed, c.todo, actor_name()),
      format('/sessioni/%s', new.id));
  end if;
  return null;
end $$;
create trigger notify_session_closed after update of status on sessions for each row execute function notify_session_closed();

create function notify_report_pending() returns trigger language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if new.status = 'pending_approval' and (tg_op = 'INSERT' or old.status <> 'pending_approval') then
    select version into v from releases where id = new.release_id;
    perform notify(new.release_id, array['approver'], 'report_pending', format('Report %s da approvare', v),
      format('Risultato finale proposto %s · inviato da %s', coalesce(new.final_outcome::text, '—'), actor_name()),
      format('/release/%s/report', new.release_id));
  end if;
  return null;
end $$;
create trigger notify_report_pending after insert or update of status on reports for each row execute function notify_report_pending();
