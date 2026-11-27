-- ==========================================================================
-- AVISO EN LÍNEA · Planta San Juan
-- Script de seguridad y blindaje completo para Supabase (PostgreSQL + Storage)
-- Pegar y ejecutar completo en: Supabase Dashboard -> SQL Editor -> New query
-- ==========================================================================

create extension if not exists pgcrypto;

-- --------------------------------------------------------------------------
-- 1. TABLA PRINCIPAL: AVISOS (reports)
-- --------------------------------------------------------------------------
create sequence if not exists public.reports_seq start 1;

create table if not exists public.reports (
  id bigint primary key default nextval('public.reports_seq'),
  code text unique not null,
  employee_name text not null,
  employee_id text not null default '',
  operator_sector text not null,
  shift text not null,
  phone text not null default '',
  type text not null check (type in ('mantenimiento', '5s', 'seguridad')),
  severity text not null check (severity in ('baja', 'media', 'alta', 'critica')),
  equipment text not null,
  location text not null default '',
  description text not null,
  status text not null default 'abierto' check (status in ('abierto', 'en_proceso', 'resuelto', 'cerrado')),
  assigned_to text not null default '',
  resolution text not null default '',
  resolved_at timestamptz,
  whatsapp_sent_at timestamptz,
  due_at timestamptz not null,
  recipients jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Constraints anti-spam y validación estricta en servidor (idempotentes)
alter table public.reports drop constraint if exists chk_reports_employee_name_len;
alter table public.reports add constraint chk_reports_employee_name_len check (char_length(btrim(employee_name)) between 3 and 90);

alter table public.reports drop constraint if exists chk_reports_employee_id_len;
alter table public.reports add constraint chk_reports_employee_id_len check (char_length(btrim(employee_id)) between 1 and 20);

alter table public.reports drop constraint if exists chk_reports_operator_sector_len;
alter table public.reports add constraint chk_reports_operator_sector_len check (char_length(btrim(operator_sector)) between 2 and 80);

alter table public.reports drop constraint if exists chk_reports_shift_len;
alter table public.reports add constraint chk_reports_shift_len check (char_length(btrim(shift)) between 2 and 40);

alter table public.reports drop constraint if exists chk_reports_phone_len;
alter table public.reports add constraint chk_reports_phone_len check (char_length(phone) <= 30);

alter table public.reports drop constraint if exists chk_reports_equipment_len;
alter table public.reports add constraint chk_reports_equipment_len check (char_length(btrim(equipment)) between 2 and 120);

alter table public.reports drop constraint if exists chk_reports_location_len;
alter table public.reports add constraint chk_reports_location_len check (char_length(location) <= 140);

alter table public.reports drop constraint if exists chk_reports_description_len;
alter table public.reports add constraint chk_reports_description_len check (char_length(btrim(description)) between 10 and 2000);

alter table public.reports drop constraint if exists chk_reports_resolution_len;
alter table public.reports add constraint chk_reports_resolution_len check (char_length(resolution) <= 2000);

alter table public.reports drop constraint if exists chk_reports_assigned_len;
alter table public.reports add constraint chk_reports_assigned_len check (char_length(assigned_to) <= 90);

alter table public.reports drop constraint if exists chk_reports_recipients_arr;
alter table public.reports add constraint chk_reports_recipients_arr check (jsonb_typeof(recipients) = 'array' and jsonb_array_length(recipients) <= 12);

-- Genera automáticamente el código PR-YYYY-XXXX si no se envía uno (evitando colisiones)
create or replace function public.set_report_code()
returns trigger
language plpgsql
as $$
declare
  v_year text := to_char(coalesce(new.created_at, now()), 'YYYY');
  v_seq bigint := coalesce(new.id, nextval('public.reports_seq'));
  v_candidate text;
begin
  if new.code is null or btrim(new.code) = '' then
    loop
      v_candidate := 'PR-' || v_year || '-' || lpad(v_seq::text, 4, '0');
      exit when not exists (select 1 from public.reports r where r.code = v_candidate);
      v_seq := v_seq + 1;
    end loop;
    new.code := v_candidate;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reports_set_code on public.reports;
create trigger trg_reports_set_code
before insert on public.reports
for each row execute function public.set_report_code();

-- Sincronizar secuencias de reports (id y reports_seq) por si ya hay registros cargados
do $$
declare
  v_id_seq text := pg_get_serial_sequence('public.reports', 'id');
  v_next bigint;
begin
  select coalesce(max(id), 0) + 1 into v_next from public.reports;
  if v_id_seq is not null then
    execute format('select setval(%L, %s, false)', v_id_seq, v_next);
  end if;
  perform setval('public.reports_seq', v_next, false);
end $$;

create index if not exists idx_reports_created_at on public.reports (created_at desc);
create index if not exists idx_reports_status on public.reports (status);
create index if not exists idx_reports_code on public.reports (code);

-- --------------------------------------------------------------------------
-- 2. TABLA DE TRAZABILIDAD / BITÁCORA (report_events)
-- --------------------------------------------------------------------------
create table if not exists public.report_events (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.reports(id) on delete cascade,
  action text not null,
  author text not null default 'Sistema',
  note text not null default '',
  to_status text,
  created_at timestamptz not null default now()
);

alter table public.report_events drop constraint if exists chk_events_lengths;
alter table public.report_events add constraint chk_events_lengths check (
  char_length(action) between 1 and 40
  and char_length(author) between 1 and 90
  and char_length(note) <= 2000
);

create index if not exists idx_report_events_report_id on public.report_events (report_id, created_at asc);

-- --------------------------------------------------------------------------
-- 3. TABLA DE FOTOS (report_photos)
-- --------------------------------------------------------------------------
create table if not exists public.report_photos (
  id text primary key,
  report_id bigint not null references public.reports(id) on delete cascade,
  kind text not null default 'reporte' check (kind in ('reporte', 'cierre', 'antes', 'despues')),
  storage_path text not null,
  created_at timestamptz not null default now()
);

alter table public.report_photos drop constraint if exists report_photos_kind_check;
alter table public.report_photos
  add constraint report_photos_kind_check
  check (kind in ('reporte', 'cierre', 'antes', 'despues'));

alter table public.report_photos drop constraint if exists chk_photos_path;
alter table public.report_photos
  add constraint chk_photos_path
  check (storage_path ~ '^PR-[0-9]{4}-[0-9]{4,8}/ph-[a-zA-Z0-9_-]{4,40}\.(jpg|jpeg|png|webp)$');

create index if not exists idx_report_photos_report_id on public.report_photos (report_id);

-- --------------------------------------------------------------------------
-- 4. CONFIGURACIÓN COMPARTIDA: SUPERVISORES Y ÁREAS
-- --------------------------------------------------------------------------
create table if not exists public.supervisors (
  id text primary key,
  name text not null,
  area text not null,
  shift text not null default 'Todos los turnos',
  phone text not null default '',
  email text not null default '',
  created_at timestamptz not null default now()
);

alter table public.supervisors add column if not exists email text not null default '';

alter table public.supervisors drop constraint if exists chk_supervisors_len;
alter table public.supervisors add constraint chk_supervisors_len check (
  char_length(btrim(name)) between 3 and 70
  and char_length(btrim(area)) between 2 and 50
  and char_length(phone) <= 24
  and char_length(email) <= 120
  and (email = '' or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create table if not exists public.custom_areas (
  id text primary key,
  label text not null,
  created_at timestamptz not null default now()
);

alter table public.custom_areas drop constraint if exists chk_custom_areas_len;
alter table public.custom_areas add constraint chk_custom_areas_len check (
  char_length(btrim(label)) between 3 and 50
);

-- --------------------------------------------------------------------------
-- 5. USUARIOS, ROLES Y SESIONES BLINDADAS (bcrypt + tokens opacos SHA-256)
--    Acceso directo desde el navegador completamente BLOQUEADO.
-- --------------------------------------------------------------------------
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  display_name text not null,
  role text not null check (role in ('admin', 'mantenimiento', 'produccion', 'seguridad')),
  password_hash text not null,
  must_change_password boolean not null default false,
  active boolean not null default true,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_username_format check (username ~ '^[a-z0-9._-]{3,32}$'),
  constraint chk_display_name_len check (char_length(btrim(display_name)) between 2 and 80)
);

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  user_id uuid not null references public.app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_sessions_user_id on public.app_sessions (user_id);
create index if not exists idx_app_sessions_expires_at on public.app_sessions (expires_at);

-- Migrar hashes previos desde role_credentials si existía de la versión anterior
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'role_credentials'
  ) then
    insert into public.app_users (username, display_name, role, password_hash, must_change_password)
    select
      rc.role,
      case rc.role
        when 'admin' then 'Administrador General'
        when 'mantenimiento' then 'Jefatura de Mantenimiento'
        when 'produccion' then 'Jefatura de Producción'
        when 'seguridad' then 'Jefatura de Seguridad'
        else rc.role
      end,
      rc.role,
      rc.pin_hash,
      false
    from public.role_credentials rc
    on conflict (username) do nothing;
  end if;
end $$;

-- Garantizar que existan los 4 usuarios/roles base si la tabla estaba vacía
insert into public.app_users (username, display_name, role, password_hash, must_change_password)
values
  ('admin', 'Administrador General', 'admin', crypt('Sanjuan1', gen_salt('bf', 10)), true),
  ('mantenimiento', 'Jefatura de Mantenimiento', 'mantenimiento', crypt('Sanjuan1', gen_salt('bf', 10)), true),
  ('produccion', 'Jefatura de Producción', 'produccion', crypt('Sanjuan1', gen_salt('bf', 10)), true),
  ('seguridad', 'Jefatura de Seguridad', 'seguridad', crypt('Sanjuan1', gen_salt('bf', 10)), true)
on conflict (username) do nothing;

-- --------------------------------------------------------------------------
-- 6. HELPERS PRIVADOS DE SEGURIDAD (no expuestos a anon/authenticated)
-- --------------------------------------------------------------------------
create or replace function public._is_strong_password(p_pwd text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_clean text := btrim(coalesce(p_pwd, ''));
begin
  return char_length(v_clean) > 6
     and char_length(v_clean) <= 64
     and v_clean ~ '[A-ZÁÉÍÓÚÑ]'
     and v_clean ~ '[0-9]';
end;
$$;

create or replace function public._session_user(p_token text)
returns public.app_users
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_user public.app_users%rowtype;
begin
  if p_token is null or btrim(p_token) = '' then
    return null;
  end if;

  v_hash := encode(digest(convert_to(btrim(p_token), 'UTF8'), 'sha256'), 'hex');

  delete from public.app_sessions where expires_at < now();

  select u.* into v_user
  from public.app_sessions s
  join public.app_users u on u.id = s.user_id
  where s.token_hash = v_hash
    and s.expires_at > now()
    and u.active = true
  limit 1;

  if not found then
    return null;
  end if;

  return v_user;
end;
$$;

revoke all on function public._is_strong_password(text) from public, anon, authenticated;
revoke all on function public._session_user(text) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 7. FUNCIONES RPC DE AUTENTICACIÓN Y GESTIÓN DE USUARIOS
-- --------------------------------------------------------------------------

-- Login seguro con bloqueo temporal ante fuerza bruta (5 intentos -> 5 min)
create or replace function public.rpc_login(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uname text := lower(btrim(coalesce(p_username, '')));
  v_pwd text := btrim(coalesce(p_password, ''));
  v_user public.app_users%rowtype;
  v_token text;
  v_token_hash text;
  v_exp timestamptz := now() + interval '8 hours';
begin
  if v_uname = '' or v_pwd = '' then
    return jsonb_build_object('ok', false, 'error', 'Ingresá usuario y contraseña.');
  end if;

  select * into v_user
  from public.app_users
  where username = v_uname
  limit 1;

  if not found or not v_user.active then
    return jsonb_build_object('ok', false, 'error', 'Usuario o contraseña incorrectos.');
  end if;

  if v_user.locked_until is not null and v_user.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Cuenta bloqueada temporalmente por múltiples intentos fallidos. Esperá unos minutos.');
  end if;

  if crypt(v_pwd, v_user.password_hash) <> v_user.password_hash then
    update public.app_users
    set failed_attempts = failed_attempts + 1,
        locked_until = case when failed_attempts + 1 >= 5 then now() + interval '5 minutes' else null end,
        updated_at = now()
    where id = v_user.id;
    return jsonb_build_object('ok', false, 'error', 'Usuario o contraseña incorrectos.');
  end if;

  update public.app_users
  set failed_attempts = 0,
      locked_until = null
  where id = v_user.id;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex');

  insert into public.app_sessions (token_hash, user_id, expires_at)
  values (v_token_hash, v_user.id, v_exp);

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'expires_at', v_exp,
    'user', jsonb_build_object(
      'id', v_user.id,
      'username', v_user.username,
      'display_name', v_user.display_name,
      'role', v_user.role,
      'must_change_password', v_user.must_change_password
    )
  );
end;
$$;

-- Validar sesión activa contra el servidor
create or replace function public.rpc_validate_session(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
begin
  v_user := public._session_user(p_token);
  if v_user.id is null then
    return jsonb_build_object('ok', false);
  end if;

  return jsonb_build_object(
    'ok', true,
    'user', jsonb_build_object(
      'id', v_user.id,
      'username', v_user.username,
      'display_name', v_user.display_name,
      'role', v_user.role,
      'must_change_password', v_user.must_change_password
    )
  );
end;
$$;

-- Cerrar sesión en el servidor (revoca token)
create or replace function public.rpc_logout(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  if p_token is null or btrim(p_token) = '' then
    return true;
  end if;
  v_hash := encode(digest(convert_to(btrim(p_token), 'UTF8'), 'sha256'), 'hex');
  delete from public.app_sessions where token_hash = v_hash;
  return true;
end;
$$;

-- Cambio de contraseña propio (exige contraseña actual válida)
create or replace function public.rpc_change_own_password(
  p_token text,
  p_current_password text,
  p_new_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_curr text := btrim(coalesce(p_current_password, ''));
  v_new text := btrim(coalesce(p_new_password, ''));
  v_curr_hash text;
begin
  v_user := public._session_user(p_token);
  if v_user.id is null then
    return jsonb_build_object('ok', false, 'error', 'Sesión expirada o inválida.');
  end if;

  if v_curr = '' or crypt(v_curr, v_user.password_hash) <> v_user.password_hash then
    return jsonb_build_object('ok', false, 'error', 'La contraseña actual es incorrecta.');
  end if;

  if not public._is_strong_password(v_new) then
    return jsonb_build_object('ok', false, 'error', 'La nueva contraseña debe tener más de 6 caracteres, una mayúscula y un número.');
  end if;

  update public.app_users
  set password_hash = crypt(v_new, gen_salt('bf', 10)),
      must_change_password = false,
      updated_at = now()
  where id = v_user.id;

  -- Revocar otras sesiones antiguas de este usuario
  v_curr_hash := encode(digest(convert_to(btrim(p_token), 'UTF8'), 'sha256'), 'hex');
  delete from public.app_sessions where user_id = v_user.id and token_hash <> v_curr_hash;

  return jsonb_build_object('ok', true);
end;
$$;

-- Listar usuarios (SOLO Administrador, nunca devuelve password_hash)
create or replace function public.rpc_admin_list_users(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor public.app_users%rowtype;
  v_list jsonb;
begin
  v_actor := public._session_user(p_token);
  if v_actor.id is null or v_actor.role <> 'admin' then
    return jsonb_build_object('ok', false, 'error', 'Acceso denegado: requiere rol Administrador.');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', u.id,
      'username', u.username,
      'display_name', u.display_name,
      'role', u.role,
      'active', u.active,
      'must_change_password', u.must_change_password,
      'updated_at', u.updated_at
    ) order by
      case u.role when 'admin' then 0 when 'mantenimiento' then 1 when 'produccion' then 2 else 3 end,
      u.username asc
  ), '[]'::jsonb)
  into v_list
  from public.app_users u;

  return jsonb_build_object('ok', true, 'users', v_list);
end;
$$;

-- Crear usuario nuevo (SOLO Administrador)
create or replace function public.rpc_admin_create_user(
  p_token text,
  p_username text,
  p_display_name text,
  p_role text,
  p_temp_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor public.app_users%rowtype;
  v_uname text := lower(btrim(coalesce(p_username, '')));
  v_dname text := btrim(coalesce(p_display_name, ''));
  v_pwd text := btrim(coalesce(p_temp_password, ''));
  v_new_id uuid;
begin
  v_actor := public._session_user(p_token);
  if v_actor.id is null or v_actor.role <> 'admin' then
    return jsonb_build_object('ok', false, 'error', 'Acceso denegado: requiere rol Administrador.');
  end if;

  if v_uname !~ '^[a-z0-9._-]{3,32}$' then
    return jsonb_build_object('ok', false, 'error', 'El usuario debe tener entre 3 y 32 caracteres (letras minúsculas, números, punto o guion).');
  end if;

  if char_length(v_dname) < 2 or char_length(v_dname) > 80 then
    return jsonb_build_object('ok', false, 'error', 'Ingresá un nombre visible válido.');
  end if;

  if p_role not in ('admin', 'mantenimiento', 'produccion', 'seguridad') then
    return jsonb_build_object('ok', false, 'error', 'Rol inválido.');
  end if;

  if not public._is_strong_password(v_pwd) then
    return jsonb_build_object('ok', false, 'error', 'La clave temporal debe tener más de 6 caracteres, una mayúscula y un número.');
  end if;

  if exists (select 1 from public.app_users where username = v_uname) then
    return jsonb_build_object('ok', false, 'error', 'Ese nombre de usuario ya existe.');
  end if;

  insert into public.app_users (username, display_name, role, password_hash, must_change_password, active)
  values (v_uname, v_dname, p_role, crypt(v_pwd, gen_salt('bf', 10)), true, true)
  returning id into v_new_id;

  return jsonb_build_object('ok', true, 'id', v_new_id);
end;
$$;

-- Cambiar rol, nombre o estado activo de un usuario (SOLO Administrador)
create or replace function public.rpc_admin_update_user(
  p_token text,
  p_user_id uuid,
  p_display_name text,
  p_role text,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor public.app_users%rowtype;
  v_target public.app_users%rowtype;
  v_dname text := btrim(coalesce(p_display_name, ''));
  v_other_admins int;
begin
  v_actor := public._session_user(p_token);
  if v_actor.id is null or v_actor.role <> 'admin' then
    return jsonb_build_object('ok', false, 'error', 'Acceso denegado: requiere rol Administrador.');
  end if;

  select * into v_target from public.app_users where id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Usuario no encontrado.');
  end if;

  if p_role not in ('admin', 'mantenimiento', 'produccion', 'seguridad') then
    return jsonb_build_object('ok', false, 'error', 'Rol inválido.');
  end if;

  if char_length(v_dname) < 2 or char_length(v_dname) > 80 then
    return jsonb_build_object('ok', false, 'error', 'Nombre inválido.');
  end if;

  if v_target.role = 'admin' and (p_role <> 'admin' or not coalesce(p_active, true)) then
    select count(*) into v_other_admins
    from public.app_users
    where role = 'admin' and active = true and id <> v_target.id;

    if v_other_admins = 0 then
      return jsonb_build_object('ok', false, 'error', 'No podés desactivar ni cambiar el rol del único Administrador activo.');
    end if;
  end if;

  update public.app_users
  set display_name = v_dname,
      role = p_role,
      active = coalesce(p_active, true),
      updated_at = now()
  where id = v_target.id;

  -- Si fue desactivado o cambió de rol, invalidar sus sesiones activas
  if not coalesce(p_active, true) or p_role <> v_target.role then
    delete from public.app_sessions where user_id = v_target.id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Blanquear (restablecer) contraseña asignando una clave temporal (SOLO Administrador)
create or replace function public.rpc_admin_reset_password(
  p_token text,
  p_user_id uuid,
  p_temp_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor public.app_users%rowtype;
  v_pwd text := btrim(coalesce(p_temp_password, ''));
begin
  v_actor := public._session_user(p_token);
  if v_actor.id is null or v_actor.role <> 'admin' then
    return jsonb_build_object('ok', false, 'error', 'Acceso denegado: requiere rol Administrador.');
  end if;

  if not public._is_strong_password(v_pwd) then
    return jsonb_build_object('ok', false, 'error', 'La clave temporal debe tener más de 6 caracteres, una mayúscula y un número.');
  end if;

  update public.app_users
  set password_hash = crypt(v_pwd, gen_salt('bf', 10)),
      must_change_password = true,
      failed_attempts = 0,
      locked_until = null,
      updated_at = now()
  where id = p_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Usuario no encontrado.');
  end if;

  -- Cerrar sesiones previas del usuario restablecido
  delete from public.app_sessions where user_id = p_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- --------------------------------------------------------------------------
-- 8. FUNCIONES RPC BLINDADAS PARA AVISOS, FOTOS Y CONFIGURACIÓN
-- --------------------------------------------------------------------------

-- Alta pública de aviso (fuerza estado inicial 'abierto' y valida longitudes en servidor)
create or replace function public.rpc_create_report(
  p_employee_name text,
  p_employee_id text,
  p_operator_sector text,
  p_shift text,
  p_phone text,
  p_type text,
  p_severity text,
  p_equipment text,
  p_location text,
  p_description text,
  p_recipients jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_now timestamptz := now();
  v_sla int;
  v_due timestamptz;
  v_rec jsonb := coalesce(p_recipients, '[]'::jsonb);
  v_row public.reports%rowtype;
begin
  if char_length(btrim(coalesce(p_employee_name, ''))) < 3 then
    return jsonb_build_object('ok', false, 'error', 'Nombre y apellido inválido.');
  end if;
  if char_length(btrim(coalesce(p_employee_id, ''))) < 1 then
    return jsonb_build_object('ok', false, 'error', 'Legajo obligatorio.');
  end if;
  if p_type not in ('mantenimiento', '5s', 'seguridad') then
    return jsonb_build_object('ok', false, 'error', 'Tipo de aviso inválido.');
  end if;
  if p_severity not in ('baja', 'media', 'alta', 'critica') then
    return jsonb_build_object('ok', false, 'error', 'Prioridad inválida.');
  end if;
  if char_length(btrim(coalesce(p_description, ''))) < 10 then
    return jsonb_build_object('ok', false, 'error', 'La descripción debe tener al menos 10 caracteres.');
  end if;
  if jsonb_typeof(v_rec) <> 'array' or jsonb_array_length(v_rec) > 12 then
    v_rec := '[]'::jsonb;
  end if;

  v_sla := case p_severity
    when 'critica' then 8
    when 'alta' then 24
    when 'media' then 48
    else 72
  end;
  v_due := v_now + make_interval(hours => v_sla);

  insert into public.reports (
    code, employee_name, employee_id, operator_sector, shift, phone,
    type, severity, equipment, location, description,
    status, assigned_to, resolution, resolved_at, whatsapp_sent_at,
    due_at, recipients, created_at, updated_at
  ) values (
    '',
    left(btrim(p_employee_name), 90),
    left(btrim(p_employee_id), 20),
    left(btrim(p_operator_sector), 80),
    left(btrim(p_shift), 40),
    left(btrim(coalesce(p_phone, '')), 30),
    p_type,
    p_severity,
    left(btrim(p_equipment), 120),
    left(btrim(coalesce(p_location, '')), 140),
    left(btrim(p_description), 2000),
    'abierto',
    '',
    '',
    null,
    null,
    v_due,
    v_rec,
    v_now,
    v_now
  ) returning * into v_row;

  insert into public.report_events (report_id, action, author, note, to_status, created_at)
  values (
    v_row.id,
    'creado',
    v_row.employee_name,
    'Aviso registrado · Prioridad ' || initcap(v_row.severity),
    'abierto',
    v_now
  );

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'code', v_row.code,
    'created_at', v_row.created_at,
    'due_at', v_row.due_at
  );
end;
$$;

-- Registrar foto adjunta en report_photos con control de ventana y rol
create or replace function public.rpc_attach_report_photo(
  p_report_id bigint,
  p_photo_id text,
  p_kind text,
  p_storage_path text,
  p_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rep public.reports%rowtype;
  v_user public.app_users%rowtype;
  v_existing_count int;
begin
  select * into v_rep from public.reports where id = p_report_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Aviso no encontrado.');
  end if;

  if p_photo_id !~ '^ph-[a-zA-Z0-9_-]{4,40}$' then
    return jsonb_build_object('ok', false, 'error', 'Identificador de foto inválido.');
  end if;

  if p_storage_path !~ ('^' || v_rep.code || '/ph-[a-zA-Z0-9_-]{4,40}\.(jpg|jpeg|png|webp)$') then
    return jsonb_build_object('ok', false, 'error', 'Ruta de archivo inválida.');
  end if;

  if p_kind not in ('reporte', 'cierre') then
    return jsonb_build_object('ok', false, 'error', 'Tipo de foto inválido.');
  end if;

  if p_kind = 'cierre' then
    v_user := public._session_user(p_token);
    if v_user.id is null then
      return jsonb_build_object('ok', false, 'error', 'Sesión requerida para adjuntar foto de cierre.');
    end if;
    if not (
      v_user.role = 'admin'
      or (v_user.role = 'mantenimiento' and v_rep.type = 'mantenimiento')
      or (v_user.role = 'produccion' and v_rep.type = '5s')
      or (v_user.role = 'seguridad' and v_rep.type = 'seguridad')
    ) then
      return jsonb_build_object('ok', false, 'error', 'Tu rol no tiene permiso sobre este tipo de aviso.');
    end if;
  else
    -- Foto inicial de operario: máx 2 fotos dentro de los 15 minutos posteriores a la creación
    select count(*) into v_existing_count
    from public.report_photos
    where report_id = v_rep.id and kind = 'reporte';

    if v_existing_count >= 2 or v_rep.created_at < now() - interval '15 minutes' then
      return jsonb_build_object('ok', false, 'error', 'Límite o ventana de carga de fotos iniciales excedida.');
    end if;
  end if;

  insert into public.report_photos (id, report_id, kind, storage_path)
  values (p_photo_id, v_rep.id, p_kind, p_storage_path)
  on conflict (id) do nothing;

  if p_kind = 'cierre' then
    insert into public.report_events (report_id, action, author, note, to_status)
    values (v_rep.id, 'evidencia', coalesce(v_user.display_name, 'Supervisión'), 'Se adjuntó foto de evidencia de cierre.', null);
  elsif v_existing_count = 0 then
    insert into public.report_events (report_id, action, author, note, to_status)
    values (v_rep.id, 'evidencia', v_rep.employee_name, 'Evidencia fotográfica adjuntada.', null);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Registrar marca de derivación por WhatsApp (sin tocar estado ni cierre)
create or replace function public.rpc_mark_whatsapp_sent(
  p_code text,
  p_recipient_name text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rep public.reports%rowtype;
  v_now timestamptz := now();
  v_rec_name text := left(btrim(coalesce(p_recipient_name, '')), 80);
begin
  select * into v_rep from public.reports where code = upper(btrim(coalesce(p_code, '')));
  if not found then
    return false;
  end if;

  update public.reports
  set whatsapp_sent_at = coalesce(whatsapp_sent_at, v_now),
      updated_at = v_now
  where id = v_rep.id;

  if v_rec_name <> '' then
    insert into public.report_events (report_id, action, author, note, to_status, created_at)
    values (v_rep.id, 'aviso', 'Notificación WhatsApp', 'Alerta derivada por WhatsApp a ' || v_rec_name || '.', null, v_now);
  end if;

  return true;
end;
$$;

-- Gestionar, actualizar estado o cerrar aviso (verifica sesión y rol en servidor)
create or replace function public.rpc_manage_report(
  p_token text,
  p_code text,
  p_status text,
  p_assigned_to text,
  p_note text,
  p_author text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_rep public.reports%rowtype;
  v_now timestamptz := now();
  v_note text := left(btrim(coalesce(p_note, '')), 2000);
  v_assignee text := left(btrim(coalesce(p_assigned_to, '')), 90);
  v_author text := left(btrim(coalesce(p_author, '')), 90);
  v_is_closing boolean := p_status in ('cerrado', 'resuelto');
  v_status_changed boolean;
  v_assignee_changed boolean;
  v_action text;
  v_event_note text := '';
  v_resolved_at timestamptz;
  v_resolution text;
begin
  v_user := public._session_user(p_token);
  if v_user.id is null then
    return jsonb_build_object('ok', false, 'error', 'Sesión expirada o no autorizada. Volvé a iniciar sesión.');
  end if;

  select * into v_rep from public.reports where code = upper(btrim(coalesce(p_code, '')));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Aviso no encontrado.');
  end if;

  if not (
    v_user.role = 'admin'
    or (v_user.role = 'mantenimiento' and v_rep.type = 'mantenimiento')
    or (v_user.role = 'produccion' and v_rep.type = '5s')
    or (v_user.role = 'seguridad' and v_rep.type = 'seguridad')
  ) then
    return jsonb_build_object('ok', false, 'error', 'Tu rol no puede gestionar avisos de este sector.');
  end if;

  if p_status not in ('abierto', 'en_proceso', 'resuelto', 'cerrado') then
    return jsonb_build_object('ok', false, 'error', 'Estado inválido.');
  end if;

  if v_is_closing and char_length(v_note) < 5 and char_length(btrim(coalesce(v_rep.resolution, ''))) < 5 then
    return jsonb_build_object('ok', false, 'error', 'Describí la acción realizada (mínimo 5 caracteres) para cerrar el aviso.');
  end if;

  v_status_changed := p_status <> v_rep.status;
  v_assignee_changed := v_assignee <> coalesce(v_rep.assigned_to, '');

  if v_is_closing then
    v_resolution := case when v_note <> '' then v_note else v_rep.resolution end;
    v_resolved_at := coalesce(v_rep.resolved_at, v_now);
  else
    v_resolution := v_rep.resolution;
    v_resolved_at := null;
  end if;

  if v_assignee_changed then
    v_event_note := case when v_assignee <> '' then 'Responsable: ' || v_assignee else 'Se quitó el responsable' end;
  end if;
  if v_note <> '' then
    v_event_note := case when v_event_note <> '' then v_event_note || ' · ' else '' end ||
      case when v_is_closing then 'Cierre: ' || v_note else v_note end;
  end if;

  v_action := case
    when v_status_changed then 'estado'
    when v_assignee_changed and v_note = '' then 'asignacion'
    else 'comentario'
  end;

  if v_author = '' then
    v_author := v_user.display_name;
  end if;

  update public.reports
  set status = p_status,
      assigned_to = v_assignee,
      resolution = v_resolution,
      resolved_at = v_resolved_at,
      updated_at = v_now
  where id = v_rep.id;

  insert into public.report_events (report_id, action, author, note, to_status, created_at)
  values (
    v_rep.id,
    v_action,
    v_author,
    v_event_note,
    case when v_status_changed then p_status else null end,
    v_now
  );

  return jsonb_build_object('ok', true, 'updated_at', v_now, 'resolved_at', v_resolved_at);
end;
$$;

-- Eliminar aviso completo (SOLO Administrador)
create or replace function public.rpc_delete_report(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
begin
  v_user := public._session_user(p_token);
  if v_user.id is null or v_user.role <> 'admin' then
    return jsonb_build_object('ok', false, 'error', 'Solo el Administrador puede eliminar avisos.');
  end if;

  delete from public.reports where code = upper(btrim(coalesce(p_code, '')));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Aviso no encontrado.');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Administración de Supervisores y Categorías (SOLO Administrador)
create or replace function public.rpc_admin_upsert_supervisor(
  p_token text,
  p_id text,
  p_name text,
  p_area text,
  p_shift text,
  p_phone text,
  p_email text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  v_user := public._session_user(p_token);
  if v_user.id is null or v_user.role <> 'admin' then
    return jsonb_build_object('ok', false, 'error', 'Solo el Administrador puede gestionar supervisores.');
  end if;

  if char_length(btrim(coalesce(p_name, ''))) < 3 then
    return jsonb_build_object('ok', false, 'error', 'Ingresá un nombre o cargo válido.');
  end if;

  if v_email <> '' and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'El correo electrónico no tiene un formato válido.');
  end if;

  if char_length(v_phone) < 8 and v_email = '' then
    return jsonb_build_object('ok', false, 'error', 'Ingresá al menos un número de WhatsApp o un correo electrónico válido.');
  end if;

  insert into public.supervisors (id, name, area, shift, phone, email)
  values (
    left(btrim(p_id), 40),
    left(btrim(p_name), 70),
    left(btrim(p_area), 50),
    left(btrim(coalesce(p_shift, 'Todos los turnos')), 40),
    left(v_phone, 24),
    left(v_email, 120)
  )
  on conflict (id) do update
    set name = excluded.name,
        area = excluded.area,
        shift = excluded.shift,
        phone = excluded.phone,
        email = excluded.email;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.rpc_admin_delete_supervisor(p_token text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
begin
  v_user := public._session_user(p_token);
  if v_user.id is null or v_user.role <> 'admin' then
    return jsonb_build_object('ok', false, 'error', 'Solo el Administrador puede eliminar supervisores.');
  end if;

  delete from public.supervisors where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.rpc_admin_upsert_custom_area(
  p_token text,
  p_id text,
  p_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
begin
  v_user := public._session_user(p_token);
  if v_user.id is null or v_user.role <> 'admin' then
    return jsonb_build_object('ok', false, 'error', 'Solo el Administrador puede crear categorías.');
  end if;

  if char_length(btrim(coalesce(p_label, ''))) < 3 then
    return jsonb_build_object('ok', false, 'error', 'Nombre de categoría inválido.');
  end if;

  insert into public.custom_areas (id, label)
  values (left(btrim(p_id), 40), left(btrim(p_label), 50))
  on conflict (id) do update set label = excluded.label;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.rpc_admin_delete_custom_area(p_token text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
begin
  v_user := public._session_user(p_token);
  if v_user.id is null or v_user.role <> 'admin' then
    return jsonb_build_object('ok', false, 'error', 'Solo el Administrador puede eliminar categorías.');
  end if;

  delete from public.custom_areas where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- --------------------------------------------------------------------------
-- 9. ROW LEVEL SECURITY (RLS) ESTRICTO Y PERMISOS MÍNIMOS
-- --------------------------------------------------------------------------
alter table public.reports enable row level security;
alter table public.report_events enable row level security;
alter table public.report_photos enable row level security;
alter table public.supervisors enable row level security;
alter table public.custom_areas enable row level security;
alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;

-- Bloquear acceso directo a tablas de usuarios y sesiones
revoke all on public.app_users, public.app_sessions from public, anon, authenticated;
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'role_credentials') then
    alter table public.role_credentials enable row level security;
    revoke all on public.role_credentials from public, anon, authenticated;
  end if;
end $$;

-- Eliminar políticas inseguras anteriores
drop policy if exists "reports_select_all" on public.reports;
drop policy if exists "reports_insert_all" on public.reports;
drop policy if exists "reports_update_all" on public.reports;
drop policy if exists "reports_delete_all" on public.reports;

drop policy if exists "events_select_all" on public.report_events;
drop policy if exists "events_insert_all" on public.report_events;

drop policy if exists "photos_select_all" on public.report_photos;
drop policy if exists "photos_insert_all" on public.report_photos;
drop policy if exists "photos_update_all" on public.report_photos;
drop policy if exists "photos_delete_all" on public.report_photos;

drop policy if exists "supervisors_all" on public.supervisors;
drop policy if exists "supervisors_select_public" on public.supervisors;

drop policy if exists "custom_areas_all" on public.custom_areas;
drop policy if exists "custom_areas_select_public" on public.custom_areas;

-- Revocar escrituras directas sobre tablas operativas (solo lectura vía REST; toda escritura via RPC)
revoke insert, update, delete on public.reports, public.report_events, public.report_photos, public.supervisors, public.custom_areas from anon, authenticated;
grant select on public.reports, public.report_events, public.report_photos, public.supervisors, public.custom_areas to anon, authenticated;

-- Políticas de solo lectura para trazabilidad pública y selector de destinatarios
drop policy if exists "reports_select_public" on public.reports;
drop policy if exists "events_select_public" on public.report_events;
drop policy if exists "photos_select_public" on public.report_photos;

create policy "reports_select_public" on public.reports for select using (true);
create policy "events_select_public" on public.report_events for select using (true);
create policy "photos_select_public" on public.report_photos for select using (true);
create policy "supervisors_select_public" on public.supervisors for select using (true);
create policy "custom_areas_select_public" on public.custom_areas for select using (true);

-- Retirar funciones RPC antiguas sin token si existieran
drop function if exists public.verify_role_pin(text, text);
drop function if exists public.update_role_pin(text, text, text, text);

-- Otorgar EXECUTE únicamente sobre los RPC públicos necesarios
grant execute on function public.rpc_login(text, text) to anon, authenticated;
grant execute on function public.rpc_validate_session(text) to anon, authenticated;
grant execute on function public.rpc_logout(text) to anon, authenticated;
grant execute on function public.rpc_change_own_password(text, text, text) to anon, authenticated;
grant execute on function public.rpc_admin_list_users(text) to anon, authenticated;
grant execute on function public.rpc_admin_create_user(text, text, text, text, text) to anon, authenticated;
grant execute on function public.rpc_admin_update_user(text, uuid, text, text, boolean) to anon, authenticated;
grant execute on function public.rpc_admin_reset_password(text, uuid, text) to anon, authenticated;
grant execute on function public.rpc_create_report(text, text, text, text, text, text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.rpc_attach_report_photo(bigint, text, text, text, text) to anon, authenticated;
grant execute on function public.rpc_mark_whatsapp_sent(text, text) to anon, authenticated;
grant execute on function public.rpc_manage_report(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.rpc_delete_report(text, text) to anon, authenticated;
drop function if exists public.rpc_admin_upsert_supervisor(text, text, text, text, text, text);
grant execute on function public.rpc_admin_upsert_supervisor(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.rpc_admin_delete_supervisor(text, text) to anon, authenticated;
grant execute on function public.rpc_admin_upsert_custom_area(text, text, text) to anon, authenticated;
grant execute on function public.rpc_admin_delete_custom_area(text, text) to anon, authenticated;

-- --------------------------------------------------------------------------
-- 10. STORAGE BUCKET PARA FOTOS (avisos-fotos) BLINDADO
--     Permite subir imágenes válidas; bloquea listado, sobrescritura y borrado.
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avisos-fotos', 'avisos-fotos', true)
on conflict (id) do nothing;

drop policy if exists "avisos_fotos_select" on storage.objects;
drop policy if exists "avisos_fotos_insert" on storage.objects;
drop policy if exists "avisos_fotos_update" on storage.objects;
drop policy if exists "avisos_fotos_delete" on storage.objects;
drop policy if exists "avisos_fotos_insert_valid" on storage.objects;

create policy "avisos_fotos_insert_valid" on storage.objects
for insert with check (
  bucket_id = 'avisos-fotos'
  and name ~ '^PR-[0-9]{4}-[0-9]{4,8}/ph-[a-zA-Z0-9_-]{4,40}\.(jpg|jpeg|png|webp)$'
);
