-- ============================================================
-- PTEK — SETUP sezione MACCHINE (Supabase SQL Editor)
-- Esegui TUTTO questo file una volta. È idempotente: puoi rieseguirlo senza danni.
-- Dopo l'esecuzione funzionano: collega macchina, installazioni, tagliando→bollettino,
-- storico ricambi, upload manuali e foto collegate ai clienti.
-- (È la stessa cosa contenuta in db-migrazioni.sql, raccolta qui per comodità.)
-- ============================================================

-- 1) INSTALLAZIONI: quale modello (machine_key dell'app) è installato presso quale cliente/cantiere.
create table if not exists public.site_machines(
  id uuid primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  machine_key text not null,
  serial text,
  install_date date,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.site_machines enable row level security;
drop policy if exists sm_sel on public.site_machines;
drop policy if exists sm_ins on public.site_machines;
drop policy if exists sm_upd on public.site_machines;
drop policy if exists sm_del on public.site_machines;
create policy sm_sel on public.site_machines for select to authenticated
  using (public.is_owner() or public.has_perm('macchine') or public.has_perm('man'));
create policy sm_ins on public.site_machines for insert to authenticated
  with check (public.is_owner() or public.has_perm('macchine') or public.has_perm('man'));
create policy sm_upd on public.site_machines for update to authenticated
  using (public.is_owner() or public.has_perm('macchine') or public.has_perm('man'))
  with check (public.is_owner() or public.has_perm('macchine') or public.has_perm('man'));
create policy sm_del on public.site_machines for delete to authenticated
  using (public.is_owner() or public.has_perm('macchine'));

-- 2) TAGLIANDI COMPILATI (checklist + firma cliente + tecnico + data), legati a una manutenzione.
create table if not exists public.maintenance_checklists(
  id uuid primary key,
  maintenance_id uuid references public.maintenances(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  site_machine_id uuid references public.site_machines(id) on delete set null,
  machine_key text,
  items jsonb not null default '[]',
  signature text,
  signed_name text,
  tech_id uuid,
  done_date date,
  created_at timestamptz not null default now()
);
alter table public.maintenance_checklists enable row level security;
drop policy if exists mc_sel on public.maintenance_checklists;
drop policy if exists mc_ins on public.maintenance_checklists;
drop policy if exists mc_upd on public.maintenance_checklists;
drop policy if exists mc_del on public.maintenance_checklists;
create policy mc_sel on public.maintenance_checklists for select to authenticated
  using (public.is_owner() or public.has_perm('macchine') or public.has_perm('man'));
create policy mc_ins on public.maintenance_checklists for insert to authenticated
  with check (public.is_owner() or public.has_perm('macchine') or public.has_perm('man'));
create policy mc_upd on public.maintenance_checklists for update to authenticated
  using (public.is_owner() or public.has_perm('macchine') or public.has_perm('man'))
  with check (public.is_owner() or public.has_perm('macchine') or public.has_perm('man'));
create policy mc_del on public.maintenance_checklists for delete to authenticated
  using (public.is_owner() or public.has_perm('macchine'));

-- 3) STORICO RICAMBI ("pezzo sostituito il <data>").
create table if not exists public.part_replacements(
  id uuid primary key,
  client_id uuid references public.clients(id) on delete cascade,
  site_machine_id uuid references public.site_machines(id) on delete cascade,
  maintenance_id uuid references public.maintenances(id) on delete set null,
  machine_key text,
  part_key text,
  part_name text,
  replaced_date date,
  tech_id uuid,
  note text,
  created_at timestamptz not null default now()
);
alter table public.part_replacements enable row level security;
drop policy if exists pr_sel on public.part_replacements;
drop policy if exists pr_ins on public.part_replacements;
drop policy if exists pr_upd on public.part_replacements;
drop policy if exists pr_del on public.part_replacements;
create policy pr_sel on public.part_replacements for select to authenticated
  using (public.is_owner() or public.has_perm('macchine') or public.has_perm('man'));
create policy pr_ins on public.part_replacements for insert to authenticated
  with check (public.is_owner() or public.has_perm('macchine') or public.has_perm('man'));
create policy pr_upd on public.part_replacements for update to authenticated
  using (public.is_owner() or public.has_perm('macchine') or public.has_perm('man'))
  with check (public.is_owner() or public.has_perm('macchine') or public.has_perm('man'));
create policy pr_del on public.part_replacements for delete to authenticated
  using (public.is_owner() or public.has_perm('macchine'));

-- 4) FOTO/FILE collegati ai CLIENTI (storico cliente).
create table if not exists public.client_attachments(
  id uuid primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text,
  type text,
  storage_path text,
  date date,
  created_at timestamptz not null default now()
);
alter table public.client_attachments enable row level security;
drop policy if exists ca_sel on public.client_attachments;
drop policy if exists ca_ins on public.client_attachments;
drop policy if exists ca_del on public.client_attachments;
create policy ca_sel on public.client_attachments for select to authenticated
  using (public.is_owner() or public.has_perm('clients'));
create policy ca_ins on public.client_attachments for insert to authenticated
  with check (public.is_owner() or public.has_perm('clients'));
create policy ca_del on public.client_attachments for delete to authenticated
  using (public.is_owner() or public.has_perm('clients'));

-- 5) Indici.
create index if not exists sm_client_idx on public.site_machines(client_id);
create index if not exists mc_maint_idx  on public.maintenance_checklists(maintenance_id);
create index if not exists mc_client_idx on public.maintenance_checklists(client_id);
create index if not exists pr_sm_idx     on public.part_replacements(site_machine_id);
create index if not exists pr_client_idx on public.part_replacements(client_id);
create index if not exists ca_client_idx on public.client_attachments(client_id);

-- 6) Realtime (best-effort).
do $$ begin
  alter publication supabase_realtime add table
    public.site_machines, public.maintenance_checklists, public.part_replacements, public.client_attachments;
exception when others then null; end $$;

-- 7) STORAGE — bucket privati per manuali e foto macchine (le foto cliente usano 'allegati').
insert into storage.buckets (id, name, public) values ('manuali','manuali',false)  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('macchine','macchine',false) on conflict (id) do nothing;
drop policy if exists man_read on storage.objects;
create policy man_read on storage.objects for select to authenticated
  using (bucket_id in ('manuali','macchine'));
drop policy if exists man_write on storage.objects;
create policy man_write on storage.objects for insert to authenticated
  with check (bucket_id in ('manuali','macchine') and (public.is_owner() or public.has_perm('macchine')));
drop policy if exists man_update on storage.objects;
create policy man_update on storage.objects for update to authenticated
  using (bucket_id in ('manuali','macchine') and (public.is_owner() or public.has_perm('macchine')));
drop policy if exists man_delete on storage.objects;
create policy man_delete on storage.objects for delete to authenticated
  using (bucket_id in ('manuali','macchine') and (public.is_owner() or public.has_perm('macchine')));

-- FATTO. Ora: carica i manuali nel bucket 'manuali' (o dal pulsante in-app) e
-- dai il permesso 'macchine' ai dipendenti in Personale.
