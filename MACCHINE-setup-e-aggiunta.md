# Sezione Macchine — messa in funzione e come aggiungere macchine

## A. Messa in funzione (una volta sola, su Supabase)

Da fare **prima** che la sezione salvi dati reali (installazioni, tagliandi, ricambi).

1. **Database** — apri Supabase → *SQL Editor* → incolla ed esegui la sezione
   «18 giu — Macchine» di [`db-migrazioni.sql`](db-migrazioni.sql). Crea le 3 tabelle
   (`site_machines`, `maintenance_checklists`, `part_replacements`), la RLS, gli indici
   e i bucket Storage `manuali` / `macchine`.
2. **Verifica RLS** — sempre nel SQL Editor, controlla che le 3 tabelle abbiano
   *Row Level Security* attiva (è l'unica barriera ai dati verso l'esterno).
3. **Manuali PDF** — carica i PDF nel bucket `manuali` con questi nomi esatti:
   - `light-manuale.pdf` (Nobis A10 C LIGHT)
   - `polygon-manuale.pdf` (Nobis POLYGON 25·28·32)
   In alternativa: apri la scheda macchina → tab **Manuale** → **Carica manuale**
   (visibile a titolare o a chi ha il permesso «Macchine»).
4. **Permessi** — il titolare vede sempre la sezione. Per i dipendenti: *Personale* →
   dipendente → attiva il permesso **⚙️ Macchine**.

Finché non esegui il punto 1, la sezione funziona lo stesso (cataloghi, allarmi, 3D,
tagliando), ma i salvataggi mostrano un avviso e non vengono persi dati: nessun crash.

## B. Dove si trova la sezione

- **Telefono**: in basso a destra **☰ Altro → ⚙️ Macchine** (puoi anche fissarla nella
  barra in basso da *Altro → Personalizza la barra in basso*).
- **Computer**: menu laterale a sinistra.

## C. Come aggiungere una nuova macchina

Tutti i dati di riferimento di una macchina (allarmi, componenti, pezzi, tagliando,
modelli 3D) stanno **dentro l'app** (file `macchine.js`), così funzionano **offline**.
Aggiungere una macchina = aggiungere un oggetto in quel file.

### Cosa serve fornire (per ogni macchina)
- **Marca + modello** (es. «Nobis A10 C LIGHT») ed eventuali varianti.
- **Manuale PDF** (da cui ricavo allarmi, dati tecnici, manutenzioni).
- **Pezzi che si sostituiscono più spesso** (candeletta, motoriduttori, estrattore, ecc.).
- (Opzionale ma utile) **una foto della macchina** per gli hotspot dei componenti.

### Cosa succede poi (lato file `macchine.js`)
In cima al file c'è il blocco **«➕ COME AGGIUNGERE UNA NUOVA MACCHINA»** con un
**TEMPLATE** pronto da copiare e i commenti campo per campo. In pratica:
1. Si copia il template, si rinomina (es. `const STUFA_X = {…}`) e si compilano i campi.
2. Si aggiunge alla lista in fondo: `const MACHINES=[STUFA,CALDAIA,STUFA_X];`
3. La **foto** si incolla come *data-URI* (resta offline) — di solito me la passi e la incorporo io.
4. Il **manuale PDF** si carica nel bucket Storage `manuali` col nome scritto in `manualeFile`.
5. I **modelli 3D** dei pezzi riusano le forme già pronte
   (`candeletta`, `mot_coclea`, `mot_braciere`, `estrattore`, `braciere`): per un pezzo
   nuovo si usa la forma affine. Sono schematici (forma/funzione, non ricambi OEM esatti).

Non serve toccare altro: lista, ricerca allarmi, hotspot, tagliando, esporta-bollettino,
installazioni e storico funzionano in automatico per ogni macchina aggiunta.

> Per ricavare allarmi/dati tecnici dal manuale e preparare l'oggetto, passami il PDF e
> l'elenco dei pezzi: lo compilo io seguendo il template.
