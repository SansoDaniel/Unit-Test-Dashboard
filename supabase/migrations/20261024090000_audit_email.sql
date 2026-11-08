-- Lo storico mostra chi ha fatto la modifica: l'app scrive l'email dell'utente nelle impostazioni della transazione.
alter table audit_log add column actor_email text default nullif(current_setting('request.jwt.claim.email', true), '');
