# Vetrina clienti — messa in funzione

App pubblica per i clienti (`cliente.html`): vetrina con **offerte/occasioni**, **catalogo
macchine con codici di errore** e **richieste** (assistenza, sopralluogo/preventivo, pellet).
Le richieste arrivano nel gestionale (`index.html`) nella sezione **📨 Richieste**.

> È una pagina **pubblica senza login**: usa la chiave `anon` di Supabase. La **RLS** è
> l'unica barriera. Con la configurazione qui sotto, un anonimo può **solo**: leggere le
> offerte pubblicate e **inserire** una richiesta. Non può leggere clienti, pellet o le
> richieste altrui.

## A. Una volta sola (su Supabase)

1. **Database** — Supabase → *SQL Editor* → incolla ed esegui la sezione
   **«23 giu 2026 — Vetrina clienti»** di [`db-migrazioni.sql`](db-migrazioni.sql).
   Crea le tabelle `offers` e `requests`, la RLS, gli indici e il bucket Storage `offerte`.
2. **Verifica RLS** — controlla che `offers` e `requests` abbiano *Row Level Security* attiva.
3. **(Consigliato) Test di sicurezza** — nel SQL Editor o da un client con la chiave `anon`:
   - `select * from requests;` → deve restituire **0 righe** (negato all'anonimo).
   - `select * from clients;` → **0 righe**.
   - Un insert in `requests` con `status='gestita'` → **rifiutato** dalla policy.

## B. Permessi (chi gestisce le richieste)

- Il **titolare** vede sempre la sezione 📨 Richieste e gestisce le offerte.
- Per un dipendente: app → **Personale** → dipendente → attiva il permesso **📨 Richieste**
  (vede e gestisce le richieste; le offerte restano riservate al titolare).

## C. Contatti azienda (importante)

Apri [`cliente.js`](cliente.js) in cima e compila il blocco `AZIENDA` con i dati reali:

```js
const AZIENDA = {
  nome:  'Ptek — Pellet Tek',
  tel:   '+41 …',        // telefono pubblico (tasto «Chiama»)
  email: 'info@…',       // email pubblica
  citta: 'Bellinzona (TI)'
};
```

Finché il telefono è quello segnaposto, il tasto «Chiama» punta a un numero finto.

## D. Dove si trova / come si usa

- **Vetrina (clienti)**: `…/cliente.html` (stesso sito GitHub Pages del gestionale).
  Collega questo indirizzo dal sito aziendale.
- **Offerte**: gestionale → 📨 Richieste → tab **🏷️ Offerte vetrina** → *+ Nuova offerta*.
  Una foto (opzionale) finisce nel bucket pubblico `offerte`; «Pubblicata» la mostra in vetrina.
- **Catalogo macchine**: usa gli stessi dati del modulo Macchine (`macchine.js`). Aggiungere
  una macchina lì la fa comparire **anche** in vetrina (vedi `MACCHINE-setup-e-aggiunta.md`).
- **Richieste**: il cliente invia dal form → arrivano in 📨 Richieste. Da lì: **→ Appuntamento /
  Pellet / Manutenzione** (crea una bozza collegando il cliente se riconosciuto), **Segna
  gestita**, **Elimina** (titolare).

## E. Note di sicurezza / privacy

- Le richieste contengono dati personali (nome, telefono): la tabella `requests` **non è mai
  leggibile** dall'anonimo. Avviso privacy mostrato sotto il form.
- Anti-spam di base: campo *honeypot* nascosto, validazione e limiti di lunghezza (allineati ai
  `CHECK` del DB). **Non c'è captcha**: per un'attività piccola va bene col controllo manuale e
  il tasto Elimina. Se dovesse arrivare spam, si aggiunge un captcha (es. Cloudflare Turnstile).
