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
