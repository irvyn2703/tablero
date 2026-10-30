begin;

select plan(20);

insert into public.companies (name, slug)
values ('Acme', 'acme')
returning id as company_id \gset

select private.seed_statuses(:'company_id'::uuid);

insert into public.tickets (company_id, public_number, title, status_id, view_token_hash)
values (
  :'company_id'::uuid,
  1,
  'Arreglar el margen',
  (select id from public.statuses where company_id = :'company_id' and name = 'Recibido'),
  repeat('ab', 32)
)
returning id as ticket_id \gset

select is(private.measure_progress(:'ticket_id'::uuid), 0::numeric, 'recibido al 0');

select private.apply_progress(
  :'ticket_id'::uuid,
  (select id from public.statuses where company_id = :'company_id' and name = 'Recibido'),
  100
);
select is(private.measure_progress(:'ticket_id'::uuid), 10::numeric, 'recibido al 100');

select private.apply_progress(
  :'ticket_id'::uuid,
  (select id from public.statuses where company_id = :'company_id' and name = 'En cola'),
  null
);
select is(private.measure_progress(:'ticket_id'::uuid), 10::numeric, 'entra a en cola');

select private.apply_progress(
  :'ticket_id'::uuid,
  (select id from public.statuses where company_id = :'company_id' and name = 'En cola'),
  100
);
select is(private.measure_progress(:'ticket_id'::uuid), 15::numeric, 'en cola completo');

select private.apply_progress(
  :'ticket_id'::uuid,
  (select id from public.statuses where company_id = :'company_id' and name = 'En curso'),
  50
);
select is(private.measure_progress(:'ticket_id'::uuid), 55::numeric, 'en curso al 50 es 55');

select private.apply_progress(
  :'ticket_id'::uuid,
  (select id from public.statuses where company_id = :'company_id' and name = 'Falta información'),
  null
);
select is(private.measure_progress(:'ticket_id'::uuid), 55::numeric, 'la pausa conserva el 55');

select private.apply_progress(
  :'ticket_id'::uuid,
  (select id from public.statuses where company_id = :'company_id' and name = 'En curso'),
  100
);
select is(private.measure_progress(:'ticket_id'::uuid), 95::numeric, 'en curso completo');

select private.apply_progress(
  :'ticket_id'::uuid,
  (select id from public.statuses where company_id = :'company_id' and name = 'En revisión'),
  null
);
select is(private.measure_progress(:'ticket_id'::uuid), 95::numeric, 'entra a revisión');

select private.apply_progress(
  :'ticket_id'::uuid,
  (select id from public.statuses where company_id = :'company_id' and name = 'En revisión'),
  100
);
select is(private.measure_progress(:'ticket_id'::uuid), 100::numeric, 'revisión completa');

select private.apply_progress(
  :'ticket_id'::uuid,
  (select id from public.statuses where company_id = :'company_id' and name = 'En curso'),
  null
);
select is(
  (select local_percent from public.tickets where id = :'ticket_id'::uuid),
  100,
  'al regresar el local queda en 100'
);
select is(private.measure_progress(:'ticket_id'::uuid), 95::numeric, 'al regresar la barra no cae');

select private.apply_progress(
  :'ticket_id'::uuid,
  (select id from public.statuses where company_id = :'company_id' and name = 'Listo'),
  null
);
select is(private.measure_progress(:'ticket_id'::uuid), 100::numeric, 'listo es 100');

select throws_ok(
  format(
    $sql$select private.set_statuses(%L::uuid, %L::jsonb, '{}'::jsonb)$sql$,
    :'company_id',
    '[{"name":"Solo","kind":"work","weight":40},{"name":"Cierre","kind":"close","weight":0}]'
  ),
  'P0001',
  'rechaza pesos que no suman 100'
);

insert into public.companies (name, slug) values ('Otra', 'otra') returning id as other_id \gset
select private.seed_statuses(:'other_id'::uuid);

select throws_ok(
  format(
    $sql$
      insert into public.tickets (company_id, public_number, title, status_id, view_token_hash)
      values (%L::uuid, 1, 'Ajeno', (select id from public.statuses where company_id = %L::uuid and name = 'Recibido'), repeat('c', 64))
    $sql$,
    :'company_id',
    :'other_id'
  ),
  'P0001',
  'un ticket no apunta a un estado de otra empresa'
);

set local role anon;
select throws_ok(
  'select * from public.tickets',
  '42501',
  'anon no lee tickets'
);
reset role;

insert into public.agent_tokens (company_id, name, token_hash)
values
  (:'company_id'::uuid, 'Uno', private.sha256_hex('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  (:'company_id'::uuid, 'Dos', private.sha256_hex('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'));

select private.apply_progress(
  :'ticket_id'::uuid,
  (select id from public.statuses where company_id = :'company_id' and name = 'En curso'),
  50
);

select is(
  (public.agent_claim('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', :'ticket_id'::uuid) ->> 'title'),
  'Arreglar el margen',
  'el primer agente toma el ticket'
);

select throws_ok(
  format(
    $sql$select public.agent_claim('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', %L::uuid)$sql$,
    :'ticket_id'
  ),
  'P0001',
  'el segundo agente no toma una reserva viva'
);

select throws_ok(
  format(
    $sql$select public.agent_report_progress('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', %L::uuid, null, 10, null, false)$sql$,
    :'ticket_id'
  ),
  'P0001',
  'sin reserva vigente no hay avance'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-4111-8111-111111111111',
    'authenticated', 'authenticated', 'owner@tablero.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    'tok-owner', 'rec-owner', 'new-owner', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-4222-8222-222222222222',
    'authenticated', 'authenticated', 'admin@tablero.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    'tok-admin', 'rec-admin', 'new-admin', ''
  );

insert into public.company_members (company_id, user_id, email, role)
values
  (:'company_id'::uuid, '11111111-1111-4111-8111-111111111111', 'owner@tablero.test', 'owner'),
  (:'company_id'::uuid, '22222222-2222-4222-8222-222222222222', 'admin@tablero.test', 'admin');

select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
set local role authenticated;

select is_empty(
  $$
    update public.company_members
      set role = 'owner'
    where user_id = '22222222-2222-4222-8222-222222222222'
    returning user_id
  $$,
  'un admin no cambia roles'
);

reset role;

select is(
  (select role from public.company_members where user_id = '22222222-2222-4222-8222-222222222222'),
  'admin',
  'el rol del admin sigue igual'
);

select * from finish();

rollback;
