/* ============================================================
   Ptek — Vetrina clienti (cliente.html)
   App PUBBLICA senza login. Usa la chiave `anon` (publishable):
   la RLS su Supabase è l'unica barriera. Qui può solo:
     • leggere le offerte pubblicate (tabella offers)
     • inserire richieste dei clienti (tabella requests)
   I dati di riferimento delle macchine arrivano da macchine.js
   (variabile globale MACHINES) — sola lettura, nessun accesso DB.
   ============================================================ */

/* >>> MODIFICA QUI i contatti reali dell'azienda <<< */
const AZIENDA = {
  nome:  'Ptek — Pellet Tek',
  tel:   '+41 00 000 00 00',          // telefono pubblico (per il tasto «Chiama»)
  wa:    '',                          // WhatsApp pubblico (es. '+41791234567'); vuoto = usa `tel`
  email: 'info@ptek.ch',              // email pubblica
  citta: ''                           // es. 'Bellinzona (TI)' — opzionale, mostrata nel footer
};

/* ---- Supabase (stesso progetto del gestionale, chiave publishable) ---- */
const SB_URL = 'https://wlqqnfypmtfgulhfktbs.supabase.co';
const SB_KEY = 'sb_publishable_QxT-HaFdiZEAhi6-fwgqAw_lTKRu8nA';
const sb = window.supabase.createClient(SB_URL, SB_KEY);

/* ---- util ---- */
const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const $ = sel => document.querySelector(sel);
const MACHINES_DATA = (typeof MACHINES !== 'undefined' && Array.isArray(MACHINES)) ? MACHINES : [];

/* ---- overlay / modale ---- */
function openOv(html){
  closeOv();                          // un solo modale alla volta
  const o = document.createElement('div');
  o.className = 'overlay'; o.id = 'overlay';
  o.innerHTML = `<div class="sheet" onclick="event.stopPropagation()">${html}</div>`;
  o.onclick = closeOv;
  document.getElementById('ov').appendChild(o);
  document.body.style.overflow = 'hidden';
}
function closeOv(){
  const o = $('#overlay'); if(o) o.remove();
  document.body.style.overflow = '';
}

/* ============================================================
   HEADER + FOOTER (contatti)
   ============================================================ */
function waLink(text){
  const num = ((AZIENDA.wa||AZIENDA.tel||'').replace(/[^\d]/g,''));
  if(!num) return '';
  return 'https://wa.me/' + num + (text ? ('?text=' + encodeURIComponent(text)) : '');
}
function renderContacts(){
  const tel = (AZIENDA.tel||'').trim();
  const telHref = 'tel:' + tel.replace(/[^\d+]/g,'');
  const call = $('#hdr-call');
  if(tel){ call.href = telHref; } else if(call){ call.style.display = 'none'; }
  // WhatsApp: header + hero (stesso link, messaggio precompilato)
  const waHref = waLink('Salve, vi scrivo dal vostro sito: avrei bisogno di…');
  ['#hdr-wa','#hero-wa','#cta-wa'].forEach(sel=>{ const el=$(sel); if(!el) return; if(waHref){ el.href = waHref; } else { el.style.display = 'none'; } });
  const parts = [];
  if(tel) parts.push(`📞 <a href="${esc(telHref)}">${esc(tel)}</a>`);
  if(waHref) parts.push(`💬 <a href="${esc(waHref)}" target="_blank" rel="noopener">WhatsApp</a>`);
  if(AZIENDA.email) parts.push(`✉️ <a href="mailto:${esc(AZIENDA.email)}">${esc(AZIENDA.email)}</a>`);
  if(AZIENDA.citta) parts.push(`📍 ${esc(AZIENDA.citta)}`);
  $('#ft-contacts').innerHTML = parts.join(' · ');
}

/* ============================================================
   OFFERTE E OCCASIONI
   ============================================================ */
async function renderOffers(){
  const box = $('#offers');
  const sec = $('#sec-offerte');
  const hide = () => { if(sec) sec.style.display = 'none'; };  // niente offerte = sezione nascosta (pagina più pulita)
  let rows = [];
  try{
    const { data, error } = await sb.from('offers')
      .select('id,title,body,price,kind,image_path,sort,created_at')
      .order('sort', { ascending:true })
      .order('created_at', { ascending:false });
    if(error) throw error;
    rows = data || [];
  }catch(e){
    hide();
    return;
  }
  if(!rows.length){ hide(); return; }
  if(sec) sec.style.display = '';
  $('#off-count').textContent = rows.length ? `(${rows.length})` : '';
  box.innerHTML = rows.map(o=>{
    const kind = ['offerta','usato','promo'].includes(o.kind) ? o.kind : 'offerta';
    let img = '';
    if(o.image_path){
      try{ img = sb.storage.from('offerte').getPublicUrl(o.image_path).data.publicUrl || ''; }catch(e){ img=''; }
    }
    const ph = img
      ? `<div class="ph"><img src="${esc(img)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('noimg');this.remove();this.parentElement.textContent='🪵'"><span class="badge ${kind}">${esc(kind)}</span></div>`
      : `<div class="ph noimg">🪵<span class="badge ${kind}">${esc(kind)}</span></div>`;
    const price = (o.price!=null && o.price!=='') ? `<div class="price">CHF ${esc(o.price)}</div>` : '';
    return `<article class="offer">${ph}
      <div class="body">
        <div class="ti">${esc(o.title)}</div>
        ${o.body?`<div class="tx">${esc(o.body)}</div>`:''}
        ${price}
      </div></article>`;
  }).join('');
}

/* ============================================================
   CATALOGO MACCHINE (dati da macchine.js, sola lettura)
   ============================================================ */
let _catBrand = 'all';
const mCard = m => `
    <div class="mcard" data-id="${esc(m.id)}" onclick="openMachine(this.dataset.id)">
      <div class="ph"><img src="${esc(m.foto||'')}" alt="" loading="lazy"></div>
      <div class="body">
        <div class="br">${esc(m.marca)}</div>
        <div class="nm">${esc(m.nome)}</div>
        <div class="ty">${esc(m.tipo||'')}</div>
        <div class="tags">
          <span class="tag">${(m.allarmi||[]).length} codici errore</span>
          ${m.specs&&m.specs[0]?`<span class="tag">${esc(m.specs[0].v)} ${esc(m.specs[0].k)}</span>`:''}
        </div>
      </div>
    </div>`;
function openCatalog(){
  if(!MACHINES_DATA.length){
    openOv(`<div class="head"><h2>Le nostre macchine</h2><span class="x" onclick="closeOv()">✕</span></div>
      <div class="empty">Catalogo non disponibile.</div>`);
    return;
  }
  _catBrand = 'all';
  const brands = [...new Set(MACHINES_DATA.map(m=>m.marca))].sort((a,b)=>a.localeCompare(b));
  const chips = `<button class="bchip on" type="button" data-b="all" onclick="setCatBrand('all')">Tutte (${MACHINES_DATA.length})</button>`
    + brands.map(b=>{
        const n = MACHINES_DATA.filter(m=>m.marca===b).length;
        return `<button class="bchip" type="button" data-b="${esc(b)}" onclick="setCatBrand(this.dataset.b)">${esc(b)} (${n})</button>`;
      }).join('');
  openOv(`<div class="head"><h2>Le nostre macchine</h2><span class="x" onclick="closeOv()">✕</span></div>
    <input class="search" id="mq" type="search" placeholder="Cerca per marca, modello o tipo…" oninput="filterCatalog()">
    <div class="brandbar">${chips}</div>
    <div id="mcat"></div>`);
  filterCatalog();
}
function setCatBrand(b){
  _catBrand = b;
  const bar = $('#overlay .brandbar');
  if(bar) bar.querySelectorAll('.bchip').forEach(c=>c.classList.toggle('on', c.dataset.b===b));
  filterCatalog();
}
function filterCatalog(){
  const host = $('#mcat'); if(!host) return;
  const q = ($('#mq')?.value || '').toLowerCase();
  let list = MACHINES_DATA.filter(m =>
    (m.nome+' '+m.marca+' '+(m.tipo||'')+' '+(m.varianti||'')).toLowerCase().includes(q));
  if(_catBrand !== 'all') list = list.filter(m=>m.marca===_catBrand);
  if(!list.length){ host.innerHTML = `<div class="empty">Nessuna macchina trovata.</div>`; return; }
  // raggruppa per marca (stile catalogo)
  const groups = {};
  list.forEach(m=>{ (groups[m.marca] = groups[m.marca] || []).push(m); });
  const brands = Object.keys(groups).sort((a,b)=>a.localeCompare(b));
  host.innerHTML = brands.map(b=>
    `<div class="mbrand"><span>${esc(b)}</span><span class="c">${groups[b].length} modell${groups[b].length===1?'o':'i'}</span></div>
     <div class="mgrid">${groups[b].map(mCard).join('')}</div>`
  ).join('');
}

let _machineTab = 'allarmi';
function openMachine(id){
  const m = MACHINES_DATA.find(x=>x.id===id);
  if(!m) return;
  _machineTab = 'allarmi';
  const specs = (m.specs||[]).map(s=>`<div class="spec"><b>${esc(s.v)}</b><span>${esc(s.k)}</span></div>`).join('');
  openOv(`<div class="head"><h2>${esc(m.marca)} ${esc(m.nome)}</h2><span class="x" onclick="closeOv()">✕</span></div>
    <div class="mdet">
      <div class="top">
        <div class="ph"><img src="${esc(m.foto||'')}" alt=""></div>
        <div class="info">
          <div class="sub" style="font-family:var(--mono);letter-spacing:1px;color:var(--teal);text-transform:uppercase">${esc(m.tipo)}</div>
          ${m.varianti?`<div class="muted" style="margin-top:4px">Varianti: ${esc(m.varianti)}</div>`:''}
          <div class="specs">${specs}</div>
          <button class="btn" style="margin-top:14px;width:auto" onclick="reqForMachine()">🔧 Richiedi assistenza per questo modello</button>
        </div>
      </div>
      <div class="tabs">
        <button class="tabbtn" data-t="allarmi" onclick="setMachineTab('allarmi')">Codici errore</button>
        <button class="tabbtn" data-t="pezzi" onclick="setMachineTab('pezzi')">Parti che si usurano</button>
        <button class="tabbtn" data-t="tecnici" onclick="setMachineTab('tecnici')">Dati tecnici</button>
      </div>
      <div id="mtab"></div>
    </div>`);
  setMachineTab('allarmi', m.id);
}
/* CTA dal dettaglio macchina: apre il form assistenza col modello precompilato */
function reqForMachine(){
  const m = _curMachine();
  openForm('assistenza', m ? (m.marca+' '+m.nome) : '');
}
function setMachineTab(t, id){
  _machineTab = t;
  const sheet = $('#overlay'); if(!sheet) return;
  sheet.querySelectorAll('.tabbtn').forEach(b=>b.classList.toggle('on', b.dataset.t===t));
  // ricava la macchina dall'intestazione corrente non è affidabile: la passiamo o la ricaviamo dal bottone CTA
  const m = _curMachine();
  const host = $('#mtab'); if(!host||!m) return;
  if(t==='allarmi'){
    host.innerHTML = `<input class="search" id="aq" type="search" placeholder="Cerca un codice di errore (es. 02) o il sintomo…" oninput="filterAlarms()">
      <div id="alist"></div>`;
    filterAlarms();
  }else if(t==='pezzi'){
    const parts = (m.fragili||[]).map(p=>`
      <div class="part">
        <div class="pic">${esc(p.ico||'🔧')}</div>
        <div>
          <div class="nm">${esc(p.nome)}</div>
          ${p.sint?`<div class="de">${esc(p.sint)}</div>`:''}
          ${p.vita?`<div class="wear ${esc(p.wear||'')}">Durata indicativa: ${esc(p.vita)}</div>`:''}
        </div>
      </div>`).join('');
    host.innerHTML = parts || `<div class="empty">Nessuna parte indicata.</div>`;
  }else{
    const rows = (m.tecnici||[]).map(r=>`<tr><td style="padding:7px 10px;color:var(--t2)">${esc(r[0])}</td><td style="padding:7px 10px;text-align:right;font-weight:600">${esc(r[1])}</td></tr>`).join('');
    host.innerHTML = rows
      ? `<table style="width:100%;border-collapse:collapse;background:var(--bg1);border:1px solid var(--line);border-radius:12px;overflow:hidden">${rows}</table>`
      : `<div class="empty">Dati tecnici non disponibili.</div>`;
  }
}
/* macchina correntemente aperta: la deduciamo dal titolo del modale */
function _curMachine(){
  const h = $('#overlay h2'); if(!h) return null;
  const title = h.textContent.trim();
  return MACHINES_DATA.find(m=>(m.marca+' '+m.nome)===title) || null;
}
function filterAlarms(){
  const m = _curMachine(); if(!m) return;
  const q = ($('#aq')?.value || '').toLowerCase();
  const list = (m.allarmi||[]).filter(a=>{
    const [cod,nome,,causa] = a;
    return (cod+' '+nome+' '+(causa||'')).toLowerCase().includes(q);
  });
  const host = $('#alist');
  host.innerHTML = list.map(a=>{
    const [cod,nome,sev,causa,rimedio] = a;
    const sv = sev==='crit'?'crit':'warn';
    const svLabel = sev==='crit'?'critico':'avviso';
    return `<div class="alarm">
      <div class="h">
        <span class="cod">${esc(cod)}</span>
        <span class="nm">${esc(nome)}</span>
        <span class="sev ${sv}">${svLabel}</span>
      </div>
      ${causa?`<div class="row"><b>Possibile causa:</b> ${esc(causa)}</div>`:''}
      ${rimedio?`<div class="row"><b>Cosa fare:</b> ${esc(rimedio)}</div>`:''}
    </div>`;
  }).join('') || `<div class="empty">Nessun codice corrisponde alla ricerca.</div>`;
}

/* ============================================================
   FORM RICHIESTE → tabella requests (insert anon)
   ============================================================ */
let _submitting = false;
const TYPE_OPTS = [
  { v:'assistenza',  l:'🔧 Assistenza / manutenzione' },
  { v:'pellet',      l:'🪵 Consegna pellet' },
  { v:'sopralluogo', l:'📋 Sopralluogo / preventivo' },
  { v:'info',        l:'💬 Informazioni' },
];
function openForm(type, machineRef){
  _submitting = false;
  const sel = TYPE_OPTS.some(o=>o.v===type) ? type : 'assistenza';
  const opts = TYPE_OPTS.map(o=>`<option value="${o.v}"${o.v===sel?' selected':''}>${o.l}</option>`).join('');
  const mref = machineRef ? esc(machineRef) : '';
  openOv(`<div class="head"><h2>Invia una richiesta</h2><span class="x" onclick="closeOv()">✕</span></div>
    <form id="reqform" onsubmit="submitRequest(event)" autocomplete="on">
      <!-- honeypot anti-spam: invisibile agli umani -->
      <div class="hp" aria-hidden="true"><label>Non compilare<input type="text" id="hp_website" tabindex="-1" autocomplete="off"></label></div>

      <div class="field">
        <label for="f_type">Di cosa hai bisogno?</label>
        <select id="f_type" onchange="onTypeChange()">${opts}</select>
      </div>

      ${mref ? `<div class="field"><label>Modello</label><input type="text" id="f_machine" value="${mref}" maxlength="120" readonly></div>`
             : `<input type="hidden" id="f_machine" value="">`}

      <div class="row2">
        <div class="field"><label for="f_name">Nome e cognome <span class="req">*</span></label>
          <input type="text" id="f_name" maxlength="120" required></div>
        <div class="field"><label for="f_phone">Telefono <span class="req">*</span></label>
          <input type="tel" id="f_phone" maxlength="40" inputmode="tel" required></div>
      </div>
      <div class="row2">
        <div class="field"><label for="f_email">Email</label>
          <input type="email" id="f_email" maxlength="200"></div>
        <div class="field"><label for="f_town">Paese / località</label>
          <input type="text" id="f_town" maxlength="120"></div>
      </div>

      <div class="field" id="qty-field" style="display:none">
        <label for="f_qty">Quantità pellet</label>
        <input type="text" id="f_qty" maxlength="80" placeholder="es. 10 sacchi · 2 tonnellate sfuso">
      </div>

      <div class="field"><label for="f_msg">Messaggio</label>
        <textarea id="f_msg" maxlength="2000" placeholder="Descrivi brevemente la richiesta (modello, problema, periodo preferito…)"></textarea></div>

      <button class="btn" type="submit" id="f_send">Invia richiesta</button>
      <p class="privacy">🔒 Inviando accetti di essere ricontattato da ${esc(AZIENDA.nome)}.
        I dati servono solo a gestire la tua richiesta e non vengono ceduti a terzi.</p>
    </form>`);
  onTypeChange();
}
function onTypeChange(){
  const t = $('#f_type')?.value;
  const qf = $('#qty-field'); if(qf) qf.style.display = (t==='pellet') ? '' : 'none';
}
async function submitRequest(ev){
  ev.preventDefault();
  if(_submitting) return;
  // honeypot: se compilato è un bot → fingiamo successo senza inviare nulla
  if(($('#hp_website')?.value || '').trim()){ showOk(); return; }

  const val = id => ($('#'+id)?.value || '').trim();
  const name = val('f_name'), phone = val('f_phone');
  if(name.length < 1){ alert('Inserisci il tuo nome.'); return; }
  if(phone.length < 3){ alert('Inserisci un recapito telefonico.'); return; }

  const types = ['assistenza','pellet','sopralluogo','preventivo','info'];
  let type = $('#f_type')?.value || 'assistenza';
  if(!types.includes(type)) type = 'info';

  // costruiamo la riga: NON inviamo status/handled/handled_by → restano i default
  // del DB ('nuova'/false/null), come richiede la policy req_anon_ins.
  const row = {
    type,
    name:        name.slice(0,120),
    phone:       phone.slice(0,40),
    email:       val('f_email').slice(0,200),
    town:        val('f_town').slice(0,120),
    message:     val('f_msg').slice(0,2000),
    machine_ref: val('f_machine').slice(0,120),
    qty:         (type==='pellet' ? val('f_qty') : '').slice(0,80),
  };

  _submitting = true;
  const btn = $('#f_send'); if(btn){ btn.disabled = true; btn.textContent = 'Invio…'; }
  try{
    const { error } = await sb.from('requests').insert(row);
    if(error) throw error;
    showOk();
  }catch(e){
    _submitting = false;
    if(btn){ btn.disabled = false; btn.textContent = 'Invia richiesta'; }
    alert('Invio non riuscito. Riprova o chiamaci' + (AZIENDA.tel?(' allo '+AZIENDA.tel):'') + '.');
  }
}
function showOk(){
  openOv(`<div class="ok">
    <div class="big">✅</div>
    <h2>Richiesta inviata!</h2>
    <p class="muted">Grazie, ti ricontattiamo il prima possibile.</p>
    <button class="btn ghost" style="margin-top:18px;width:auto" onclick="closeOv()">Chiudi</button>
  </div>`);
}

/* ============================================================
   DIAGNOSI — prima il MODELLO, poi i suoi codici errore
   (ogni stufa ha i suoi codici; selezionando il modello si apre
    la scheda con la ricerca codici già pronta — dati da macchine.js)
   ============================================================ */
function diagModels(){
  const host = $('#diagres'); if(!host) return;
  const q = ($('#diagq')?.value || '').trim().toLowerCase();
  const list = MACHINES_DATA.filter(m =>
    (m.marca+' '+m.nome+' '+(m.tipo||'')+' '+(m.varianti||'')).toLowerCase().includes(q)
  );
  if(!list.length){
    host.innerHTML = `<div class="empty">Nessun modello trovato per «${esc(q)}». <button class="lnk" type="button" onclick="openForm('assistenza')">Contattaci e ti aiutiamo ›</button></div>`;
    return;
  }
  host.innerHTML = list.map(m=>{
    const n = (m.allarmi||[]).length;
    return `<button class="modelrow" type="button" data-id="${esc(m.id)}" onclick="openMachine(this.dataset.id)">
      <span class="ph"><img src="${esc(m.foto||'')}" alt="" loading="lazy"></span>
      <span class="bd"><span class="br">${esc(m.marca)}</span><span class="nm">${esc(m.nome)}</span><span class="ty">${esc(m.tipo||'')}</span></span>
      <span class="cnt">${n} codici ›</span>
    </button>`;
  }).join('');
}

/* ============================================================
   FAQ — domande frequenti (modifica/aggiungi liberamente qui)
   ============================================================ */
const FAQ = [
  ["Ogni quanto va fatta la manutenzione della stufa o caldaia a pellet?",
   "In genere una volta all’anno, meglio se prima della stagione fredda. Una manutenzione regolare riduce guasti, consumi e blocchi."],
  ["La mia stufa segnala un errore: cosa faccio?",
   "Usa la ricerca rapida qui in alto: scrivi il codice o il sintomo e ti diciamo la causa e cosa fare. Se l’errore persiste, prenota un’assistenza: interveniamo noi."],
  ["Consegnate il pellet a domicilio?",
   "Sì. Puoi ordinare sacchi o sfuso dal sito: scegli «Prenota assistenza o pellet» e indica la quantità che ti serve."],
  ["Quanto costa un intervento?",
   "Dipende dal tipo di intervento e dal modello. Ti diamo un’indicazione chiara prima di iniziare: nessuna sorpresa in fattura."],
  ["In quali zone operate?",
   "Operiamo nella nostra area di servizio. Indicaci il tuo paese nella richiesta e ti confermiamo tempi e disponibilità."],
  ["Quanto tempo per essere ricontattati?",
   "Di norma ti richiamiamo in giornata o il primo giorno lavorativo utile."]
];
function renderFaq(){
  const host = $('#faq'); if(!host) return;
  host.innerHTML = FAQ.map(([q,a])=>
    `<details class="faq-item"><summary>${esc(q)}</summary><div class="faq-a">${esc(a)}</div></details>`
  ).join('');
}

/* ============================================================
   AVVIO
   ============================================================ */
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeOv(); });
renderContacts();
renderOffers();
renderFaq();
diagModels();   // mostra subito i modelli da scegliere
