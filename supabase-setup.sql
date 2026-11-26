-- ==========================================================================
-- AVISO EN LÍNEA · Planta San Juan
-- Script de inicialización para Supabase (PostgreSQL + Storage + RPC)
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

-- Genera automáticamente el código PR-YYYY-XXXX si no se envía uno
create or replace function public.set_report_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null or btrim(new.code) = '' then
    new.code := 'PR-' || to_char(coalesce(new.created_at, now()), 'YYYY') || '-' || lpad(new.id::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reports_set_code on public.reports;
create trigger trg_reports_set_code
before insert on public.reports
for each row execute function public.set_report_code();

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

create index if not exists idx_report_events_report_id on public.report_events (report_id, created_at asc);

-- --------------------------------------------------------------------------
-- 3. TABLA DE FOTOS (report_photos) -> apunta al bucket de Storage
-- --------------------------------------------------------------------------
create table if not exists public.report_photos (
  id text primary key,
  report_id bigint not null references public.reports(id) on delete cascade,
  kind text not null default 'reporte' check (kind in ('reporte', 'cierre', 'antes', 'despues')),
  storage_path text not null,
  created_at timestamptz not null default now()
);

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
  created_at timestamptz not null default now()
);

create table if not exists public.custom_areas (
  id text primary key,
  label text not null,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- 5. CONTRASEÑAS / PINS DE SUPERVISORES (OPCIÓN B: Hash + RPC)
--    Nadie puede leer esta tabla desde el navegador; solo se valida por RPC.
-- --------------------------------------------------------------------------
create table if not exists public.role_credentials (
  role text primary key check (role in ('admin', 'mantenimiento', 'produccion', 'seguridad')),
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

-- Contraseña inicial por defecto igual que la app ("Sanjuan1")
insert into public.role_credentials (role, pin_hash)
values
  ('admin', crypt('Sanjuan1', gen_salt('bf'))),
  ('mantenimiento', crypt('Sanjuan1', gen_salt('bf'))),
  ('produccion', crypt('Sanjuan1', gen_salt('bf'))),
  ('seguridad', crypt('Sanjuan1', gen_salt('bf')))
on conflict (role) do nothing;

-- Validar PIN de un rol (devuelve true/false)
create or replace function public.verify_role_pin(p_role text, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select pin_hash into v_hash
  from public.role_credentials
  where role = p_role;

  if v_hash is null then
    return false;
  end if;

  return crypt(p_pin, v_hash) = v_hash;
end;
$$;

-- Cambiar PIN propio (validando el PIN actual del rol) o desde admin (validando PIN de admin)
create or replace function public.update_role_pin(
  p_target_role text,
  p_new_pin text,
  p_auth_role text,
  p_auth_pin text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_new_pin is null or length(btrim(p_new_pin)) < 4 then
    return false;
  end if;

  if p_auth_role <> 'admin' and p_auth_role <> p_target_role then
    return false;
  end if;

  if not public.verify_role_pin(p_auth_role, p_auth_pin) then
    return false;
  end if;

  update public.role_credentials
  set pin_hash = crypt(btrim(p_new_pin), gen_salt('bf')),
      updated_at = now()
  where role = p_target_role;

  return found;
end;
$$;

-- --------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS)
-- --------------------------------------------------------------------------
alter table public.reports enable row level security;
alter table public.report_events enable row level security;
alter table public.report_photos enable row level security;
alter table public.supervisors enable row level security;
alter table public.custom_areas enable row level security;
alter table public.role_credentials enable row level security;

-- role_credentials: SIN políticas públicas -> bloqueada lectura/escritura directa desde el navegador

-- reports: lectura, alta y actualización para la app (el control de rol se valida en la app + RPC)
drop policy if exists "reports_select_all" on public.reports;
create policy "reports_select_all" on public.reports for select using (true);

drop policy if exists "reports_insert_all" on public.reports;
create policy "reports_insert_all" on public.reports for insert with check (true);

drop policy if exists "reports_update_all" on public.reports;
create policy "reports_update_all" on public.reports for update using (true) with check (true);

drop policy if exists "reports_delete_all" on public.reports;
create policy "reports_delete_all" on public.reports for delete using (true);

-- report_events
drop policy if exists "events_select_all" on public.report_events;
create policy "events_select_all" on public.report_events for select using (true);

drop policy if exists "events_insert_all" on public.report_events;
create policy "events_insert_all" on public.report_events for insert with check (true);

-- report_photos
drop policy if exists "photos_select_all" on public.report_photos;
create policy "photos_select_all" on public.report_photos for select using (true);

drop policy if exists "photos_insert_all" on public.report_photos;
create policy "photos_insert_all" on public.report_photos for insert with check (true);

-- supervisors y custom_areas
drop policy if exists "supervisors_all" on public.supervisors;
create policy "supervisors_all" on public.supervisors for all using (true) with check (true);

drop policy if exists "custom_areas_all" on public.custom_areas;
create policy "custom_areas_all" on public.custom_areas for all using (true) with check (true);

-- Permisos de ejecución para las funciones RPC
grant execute on function public.verify_role_pin(text, text) to anon, authenticated;
grant execute on function public.update_role_pin(text, text, text, text) to anon, authenticated;

-- --------------------------------------------------------------------------
-- 7. STORAGE BUCKET PARA FOTOS (avisos-fotos)
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avisos-fotos', 'avisos-fotos', true)
on conflict (id) do nothing;

drop policy if exists "avisos_fotos_select" on storage.objects;
create policy "avisos_fotos_select" on storage.objects
for select using (bucket_id = 'avisos-fotos');

drop policy if exists "avisos_fotos_insert" on storage.objects;
create policy "avisos_fotos_insert" on storage.objects
for insert with check (bucket_id = 'avisos-fotos');

drop policy if exists "avisos_fotos_delete" on storage.objects;
create policy "avisos_fotos_delete" on storage.objects
for delete using (bucket_id = 'avisos-fotos');
