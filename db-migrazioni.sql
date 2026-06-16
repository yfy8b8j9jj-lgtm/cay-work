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
