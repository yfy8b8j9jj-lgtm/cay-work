-- ============================================================
-- Cay Work — migrazioni database (Supabase SQL Editor)
-- Eseguire PRIMA di pubblicare la nuova versione dell'app.
-- ============================================================

-- 15 giu 2026 — Blocco cliente + Pellet assegnabile a dipendente
-- ------------------------------------------------------------

-- 1) Cliente: campo "bloccato" (default = non bloccato)
alter table public.clients
  add column if not exists blocked boolean not null default false;

-- 2) Pellet: dipendente assegnato
alter table public.pellet
  add column if not exists employee_id uuid;

-- 3) RLS: il dipendente assegnato vede/aggiorna la SUA consegna pellet
--    (per le Notifiche + pulsante "Consegnata"), anche senza permesso 'pellet'.
drop policy if exists pel_sel on public.pellet;
create policy pel_sel on public.pellet for select to authenticated
  using (public.is_owner() or public.has_perm('pellet') or employee_id = public.my_emp());

drop policy if exists pel_upd on public.pellet;
create policy pel_upd on public.pellet for update to authenticated
  using (public.is_owner() or public.has_perm('pellet') or employee_id = public.my_emp());


-- 16 giu 2026 — Titolare multiplo (nessun SQL: usa la colonna is_owner già esistente)
--               + Gruppi note privati (membri selezionabili)
-- ------------------------------------------------------------

-- 4) Gruppi note: elenco membri che possono vedere il gruppo (vuoto = visibile a tutti)
alter table public.note_groups
  add column if not exists members uuid[] default '{}';

-- 5) RLS: gruppo visibile/modificabile solo ai membri (vuoto = tutti); i titolari vedono tutto
drop policy if exists ngr_all on public.note_groups;
drop policy if exists ngr_sel on public.note_groups;
drop policy if exists ngr_ins on public.note_groups;
drop policy if exists ngr_upd on public.note_groups;
drop policy if exists ngr_del on public.note_groups;
create policy ngr_sel on public.note_groups for select to authenticated using (
  public.is_owner() or (public.has_perm('notes') and (coalesce(array_length(members,1),0)=0 or public.my_emp()=any(members))));
create policy ngr_ins on public.note_groups for insert to authenticated with check (public.has_perm('notes'));
create policy ngr_upd on public.note_groups for update to authenticated using (
  public.is_owner() or (public.has_perm('notes') and (coalesce(array_length(members,1),0)=0 or public.my_emp()=any(members))));
create policy ngr_del on public.note_groups for delete to authenticated using (
  public.is_owner() or (public.has_perm('notes') and (coalesce(array_length(members,1),0)=0 or public.my_emp()=any(members))));

-- 6) RLS: una nota in un gruppo privato è visibile/modificabile solo ai membri del gruppo
drop policy if exists not_sel on public.notes;
drop policy if exists not_ins on public.notes;
drop policy if exists not_upd on public.notes;
drop policy if exists not_del on public.notes;
create policy not_sel on public.notes for select to authenticated using (
  public.is_owner() or (public.has_perm('notes') and (group_id is null or exists (
    select 1 from public.note_groups g where g.id=notes.group_id
      and (coalesce(array_length(g.members,1),0)=0 or public.my_emp()=any(g.members))))));
create policy not_ins on public.notes for insert to authenticated with check (
  public.is_owner() or (public.has_perm('notes') and (group_id is null or exists (
    select 1 from public.note_groups g where g.id=notes.group_id
      and (coalesce(array_length(g.members,1),0)=0 or public.my_emp()=any(g.members))))));
create policy not_upd on public.notes for update to authenticated using (
  public.is_owner() or (public.has_perm('notes') and (group_id is null or exists (
    select 1 from public.note_groups g where g.id=notes.group_id
      and (coalesce(array_length(g.members,1),0)=0 or public.my_emp()=any(g.members))))));
create policy not_del on public.notes for delete to authenticated using (
  public.is_owner() or (public.has_perm('notes') and (group_id is null or exists (
    select 1 from public.note_groups g where g.id=notes.group_id
      and (coalesce(array_length(g.members,1),0)=0 or public.my_emp()=any(g.members))))));


-- ============================================================
-- 16 giu 2026 — 💰 Sezione CONTI (solo titolari)
-- Spese + listino prezzi manutenzioni + tipo manutenzione
-- + data chiusura cantiere (per l'utile del mese).
-- Le entrate sono calcolate dall'app dai dati esistenti: nessuna tabella nuova per loro.
-- ------------------------------------------------------------

-- 1) SPESE — visibili/modificabili SOLO ai titolari
create table if not exists public.expenses(
  id uuid primary key,
  date date,
  category text,
  amount numeric,
  note text,
  site_id uuid references public.sites(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.expenses enable row level security;
drop policy if exists exp_all on public.expenses;
create policy exp_all on public.expenses for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- 2) LISTINO PREZZI MANUTENZIONI (stufa/camino/caldaia/altro) — SOLO titolari
create table if not exists public.maint_prices(
  id uuid primary key,
  kind text,
  price numeric,
  created_at timestamptz not null default now()
);
alter table public.maint_prices enable row level security;
drop policy if exists mp_all on public.maint_prices;
create policy mp_all on public.maint_prices for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- 3) Manutenzioni: tipo impianto (stufa/camino/caldaia/altro). Il PREZZO non sta più qui:
--    si calcola dal listino in Conti. La colonna price resta per i dati vecchi/override.
alter table public.maintenances add column if not exists type text;

-- 4) Cantieri: data di chiusura (timbrata quando va in archivio) per il conto del mese.
--    Lo stato "previsto" (lavori futuri) usa la colonna status già esistente: nessuna modifica.
alter table public.sites add column if not exists closed_date date;

-- 5) Realtime (best-effort): le due tabelle nuove nel feed in tempo reale, se possibile.
do $$ begin
  alter publication supabase_realtime add table public.expenses, public.maint_prices;
exception when others then null; end $$;

-- 6) Spese ricorrenti: intervallo in mesi (0=una tantum, 1=mensile, 3, 6, 12=annuale).
alter table public.expenses add column if not exists recur integer not null default 0;

-- ============================================================
-- 16 giu 2026 — 🔔 Notifiche push sul telefono (Web Push)
-- ------------------------------------------------------------
-- 7) Dispositivi abilitati alle notifiche (uno per browser/telefono).
--    Ognuno gestisce SOLO le proprie sottoscrizioni; la Edge Function
--    legge tutto con la service_role (lato server).
create table if not exists public.push_subs(
  endpoint text primary key,
  emp_id uuid,
  p256dh text,
  auth text,
  ua text,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists ps_all on public.push_subs;
create policy ps_all on public.push_subs for all to authenticated
  using (emp_id = public.my_emp()) with check (emp_id = public.my_emp());

-- ============================================================
-- 18 giu 2026 — Più dipendenti assegnabili (note/appuntamenti/pellet/manut)
-- ------------------------------------------------------------
-- 8) Campo "employees" (array) su manutenzioni, appuntamenti, pellet, note.
alter table public.maintenances add column if not exists employees uuid[] default '{}';
alter table public.appointments add column if not exists employees uuid[] default '{}';
alter table public.pellet        add column if not exists employees uuid[] default '{}';
alter table public.notes         add column if not exists employees uuid[] default '{}';

-- 9) Migrazione: porta i singoli assegnatari esistenti dentro l'array.
update public.maintenances set employees=array[employee_id]
  where employee_id is not null and coalesce(array_length(employees,1),0)=0;
update public.appointments set employees=array[employee_id]
  where employee_id is not null and coalesce(array_length(employees,1),0)=0;
update public.pellet set employees=array[employee_id]
  where employee_id is not null and coalesce(array_length(employees,1),0)=0;

-- 10) RLS: ogni assegnato (anche non "principale") vede/aggiorna ciò che gli è assegnato.
drop policy if exists man_asg_sel on public.maintenances;
create policy man_asg_sel on public.maintenances for select to authenticated using (public.my_emp() = any(employees));
drop policy if exists man_asg_upd on public.maintenances;
create policy man_asg_upd on public.maintenances for update to authenticated using (public.my_emp() = any(employees)) with check (public.my_emp() = any(employees));

drop policy if exists app_asg_sel on public.appointments;
create policy app_asg_sel on public.appointments for select to authenticated using (public.my_emp() = any(employees));
drop policy if exists app_asg_upd on public.appointments;
create policy app_asg_upd on public.appointments for update to authenticated using (public.my_emp() = any(employees)) with check (public.my_emp() = any(employees));

drop policy if exists pel_asg_sel on public.pellet;
create policy pel_asg_sel on public.pellet for select to authenticated using (public.my_emp() = any(employees));
drop policy if exists pel_asg_upd on public.pellet;
create policy pel_asg_upd on public.pellet for update to authenticated using (public.my_emp() = any(employees)) with check (public.my_emp() = any(employees));

drop policy if exists not_asg_sel on public.notes;
create policy not_asg_sel on public.notes for select to authenticated using (public.my_emp() = any(employees));


-- ============================================================
-- 18 giu 2026 — ⚙️ Sezione MACCHINE (schede + tagliandi + ricambi)
-- I DATI DI RIFERIMENTO delle macchine (allarmi, componenti, pezzi, 3D,
-- tagliando-template) restano nell'app (macchine.js, offline). Qui solo i
-- DATI OPERATIVI legati ai clienti/cantieri/manutenzioni → su Supabase con RLS.
-- Nuovo permesso assegnabile: 'macchine' (catalogo schede). I tecnici con
-- permesso 'man' possono comunque registrare tagliandi e ricambi.
-- GDPR: tutto si cancella a cascata con il cliente (niente record orfani).
-- ------------------------------------------------------------

-- 1) INSTALLAZIONI: quale modello (machine_key dell'app) è installato presso
--    quale cliente/cantiere, con matricola e data di installazione.
create table if not exists public.site_machines(
  id uuid primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  machine_key text not null,           -- id macchina nell'app (es. 'nobis-a10c-light')
  serial text,                         -- matricola
  install_date date,
  note text,
  created_by uuid,                     -- dipendente che l'ha registrata (employees.id)
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

-- 2) TAGLIANDI COMPILATI: la checklist spuntata + firma cliente + tecnico + data,
--    legata a una manutenzione (e quindi al suo bollettino/cliente).
--    items = jsonb [{t,f,done}]. signature = data-URI (come il bollettino) → si
--    cancella con la riga, niente file orfani nello Storage.
create table if not exists public.maintenance_checklists(
  id uuid primary key,
  maintenance_id uuid references public.maintenances(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  site_machine_id uuid references public.site_machines(id) on delete set null,
  machine_key text,
  items jsonb not null default '[]',
  signature text,                      -- firma cliente (data-URI)
  signed_name text,                    -- nome di chi ha firmato
  tech_id uuid,                        -- tecnico (employees.id)
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

-- 3) STORICO RICAMBI: "pezzo sostituito il <data>" sui pezzi fragili/3D.
create table if not exists public.part_replacements(
  id uuid primary key,
  client_id uuid references public.clients(id) on delete cascade,
  site_machine_id uuid references public.site_machines(id) on delete cascade,
  maintenance_id uuid references public.maintenances(id) on delete set null,
  machine_key text,
  part_key text,                       -- key del ricambio (es. 'candeletta')
  part_name text,
  replaced_date date,
  tech_id uuid,                        -- tecnico (employees.id)
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

-- 4) Indici per le query più frequenti (storico per cliente / installazione).
create index if not exists sm_client_idx on public.site_machines(client_id);
create index if not exists mc_maint_idx  on public.maintenance_checklists(maintenance_id);
create index if not exists mc_client_idx on public.maintenance_checklists(client_id);
create index if not exists pr_sm_idx     on public.part_replacements(site_machine_id);
create index if not exists pr_client_idx on public.part_replacements(client_id);

-- 5) Realtime (best-effort): le nuove tabelle nel feed in tempo reale, se possibile.
do $$ begin
  alter publication supabase_realtime add table
    public.site_machines, public.maintenance_checklists, public.part_replacements;
exception when others then null; end $$;

-- 6) STORAGE — manuali PDF e foto macchine (lettura per staff autenticato).
--    Bucket privati: l'app legge via URL firmati (come il bucket 'allegati').
insert into storage.buckets (id, name, public) values ('manuali','manuali',false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('macchine','macchine',false)
  on conflict (id) do nothing;
-- lettura: qualunque utente autenticato dello staff
drop policy if exists man_read on storage.objects;
create policy man_read on storage.objects for select to authenticated
  using (bucket_id in ('manuali','macchine'));
-- scrittura/aggiornamento/eliminazione: titolare o permesso 'macchine'
drop policy if exists man_write on storage.objects;
create policy man_write on storage.objects for insert to authenticated
  with check (bucket_id in ('manuali','macchine') and (public.is_owner() or public.has_perm('macchine')));
drop policy if exists man_update on storage.objects;
create policy man_update on storage.objects for update to authenticated
  using (bucket_id in ('manuali','macchine') and (public.is_owner() or public.has_perm('macchine')));
drop policy if exists man_delete on storage.objects;
create policy man_delete on storage.objects for delete to authenticated
  using (bucket_id in ('manuali','macchine') and (public.is_owner() or public.has_perm('macchine')));
