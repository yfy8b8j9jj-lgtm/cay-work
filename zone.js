/* ===== Vista Zone: mappa reale (Leaflet) + lavori, navigazione e giro di consegne =====
   Dati in zone-data.js (ZONE_PAESI, ZONE_CENTER). Nessun indirizzo cliente esce dall'app:
   le coordinate dei pin sono dei PAESI (dato pubblico, CAP ufficiali). La navigazione apre
   Google/Apple Maps con l'indirizzo del cliente solo quando l'utente tocca "Naviga". */
const ZONE_LETTERS=['A','B','C','D','E','F','G','H'];
const ZONE_COLORS={A:'#E23D3D',B:'#E2722E',C:'#C9A227',D:'#4CA02C',E:'#2E9E8F',F:'#2E78E2',G:'#7B57D6',H:'#C24FB0'};
const ZONE_LABEL=z=>'Zona '+z;

/* normalizzazione nome paese (toglie accenti, GR/TI, parentesi, punteggiatura) */
const zNorm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/\(.*?\)/g,'').replace(/\b(gr|ti)\b/g,'').replace(/[^a-z0-9]/g,'');

let _zByName=null,_zByCap=null;
function zoneIndex(){
  if(_zByName)return;
  _zByName={};_zByCap={};const capZ={};
  ZONE_PAESI.forEach(t=>{
    _zByName[zNorm(t.p)]=t.z;
    (capZ[t.c]=capZ[t.c]||new Set()).add(t.z);
  });
  Object.keys(capZ).forEach(c=>{if(capZ[c].size===1)_zByCap[c]=[...capZ[c]][0];});
}
function zoneTownIndex(){ if(!zoneTownIndex._i){const i={};ZONE_PAESI.forEach(t=>{i[zNorm(t.p)]=t;});zoneTownIndex._i=i;} return zoneTownIndex._i; }
function zoneOfClient(c){
  zoneIndex();
  const tw=zNorm(c.town||c.zone||'');
  if(tw&&_zByName[tw])return _zByName[tw];
  const cap=String(c.cap||'').trim();
  if(cap&&_zByCap[cap])return _zByCap[cap];
  return null;
}

/* indirizzo per la navigazione + url Maps (universale) */
function zoneNavAddr(c){
  const a=[[c.street,c.streetNo].filter(Boolean).join(' '),[c.cap,(c.town||c.zone)].filter(Boolean).join(' ')].filter(Boolean).join(', ')||c.address||(c.town||'');
  return a?a+', Svizzera':'';
}
function navUrl(c){return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination='+encodeURIComponent(zoneNavAddr(c));}

/* lavori in scadenza per cliente: manutenzioni non fatte + pellet non consegnato */
function zoneDueByClient(){
  const map={};
  const add=(cid,it)=>{if(!cid)return;const m=map[cid]||(map[cid]={cid,items:[],minRel:Infinity});if(it.rel<m.minRel)m.minRel=it.rel;m.items.push(it);};
  S.maintenances.forEach(x=>{if(x.status!=='fatta')add(x.clientId,{kind:'man',date:x.date,rel:x.date?relDays(x.date):9999});});
  S.pellet.forEach(x=>{if(x.status!=='consegnato')add(x.clientId,{kind:'pellet',date:x.date,rel:x.date?relDays(x.date):9999,qty:num(x.qty),unit:x.unit||'sacchi'});});
  return map;
}
/* finestra temporale (solo modalità Lavori): oggi / 7 giorni / tutti */
function zoneWinPass(d){if(zoneMode!=='lavori')return true;if(!d)return false;if(zoneWin==='all')return true;return d.minRel<=(zoneWin==='oggi'?0:7);}
function zoneShownDue(c,due){const d=due[c.id];return d&&zoneWinPass(d)?d:null;}
/* totali per zona (cosa caricare): consegne, sacchi, tonnellate, manutenzioni */
function zoneTotals(clients,due){
  let cons=0,sacchi=0,ton=0,man=0;
  clients.forEach(c=>{const d=due[c.id];if(!d)return;d.items.forEach(it=>{
    if(it.kind==='pellet'){cons++;const u=(it.unit||'sacchi').toLowerCase();if(u==='t'||u==='ton'||u==='sfuso')ton+=it.qty||0;else sacchi+=it.qty||0;}
    else man++;
  });});
  return {cons,sacchi,ton,man};
}
function zoneTotalsLabel(t){
  const a=[];if(t.man)a.push(t.man+' manut.');if(t.cons)a.push(t.cons+' consegn'+(t.cons>1?'e':'a'));
  const q=[];if(t.sacchi)q.push(fmtQty(t.sacchi)+' sacchi');if(t.ton)q.push(fmtQty(t.ton)+' t');
  return [a.join(' · '),q.length?'→ '+q.join(' + '):''].filter(Boolean).join(' ');
}
const urgColor=rel=>rel<0?'#D64528':rel===0?'#E2722E':rel<=7?'#C9A227':'#5BA02C';
function zHav(a,b){const R=6371,r=Math.PI/180;const dLa=(b.la-a.la)*r,dLo=(b.lo-a.lo)*r,l1=a.la*r,l2=b.la*r;const x=Math.sin(dLa/2)**2+Math.cos(l1)*Math.cos(l2)*Math.sin(dLo/2)**2;return 2*R*Math.asin(Math.sqrt(x));}

/* punto di partenza per ordinare il giro (imbocco valle ~ San Vittore/Roveredo).
   Se la base/officina è altrove, cambia queste coordinate. */
const ZONE_BASE=[46.2444,9.0981];

/* ---- stato vista ---- */
let zoneSel='all', zoneMode='lavori', zoneWin='all', zoneShowAll=false, zoneQuery='', zoneRoute=[];
let zMap=null, zMarkers=[], zoneFocusId=null;

/* base/officina: paese di partenza per ordinare il giro (salvata sul dispositivo) */
function zoneBaseTown(){try{return localStorage.getItem('ptek_base')||'';}catch(e){return '';}}
function zoneBase(){
  const tn=zoneBaseTown();
  if(tn){const t=zoneTownIndex()[zNorm(tn)];if(t)return[t.la,t.lo];}
  return ZONE_BASE;
}
function zoneSetBase(v){try{localStorage.setItem('ptek_base',(v||'').trim());}catch(e){}if(typeof toast==='function')toast('📍 Base aggiornata');}

/* apri la mappa centrata su un cliente (dalle schede manutenzione/pellet/cliente) */
function zoneFocusClient(cid){
  if(!cid){if(typeof toast==='function')toast('Nessun cliente selezionato');return;}
  const c=byId(S.clients,cid);if(!c)return;
  if(typeof closeSheet==='function')closeSheet();
  zoneFocusId=cid;zoneMode='clienti';zoneSel='all';zoneQuery='';
  const z=zoneOfClient(c);
  nav('zone');
  if(!z&&typeof toast==='function')setTimeout(()=>toast('📍 '+(c.town||'Questo cliente')+': paese senza zona riconosciuta'),60);
}
function zoneFromSheet(selId){const s=document.getElementById(selId);zoneFocusClient(s&&s.value);}

/* clienti elencati: filtrati per modalità + zona + ricerca */
function zoneListClients(){
  const due=zoneDueByClient(); const q=norm(zoneQuery);
  return S.clients.filter(c=>{
    if(c.blocked)return false;
    const z=zoneOfClient(c); if(!z)return false;
    if(zoneSel!=='all'&&z!==zoneSel)return false;
    if(zoneMode==='lavori'&&!zoneShownDue(c,due))return false;
    if(q&&!norm(c.name+' '+(c.town||'')+' '+(c.street||'')+' '+(c.phone||'')).includes(q))return false;
    return true;
  });
}
function zoneCounts(){
  const due=zoneDueByClient();const counts={};ZONE_LETTERS.forEach(z=>counts[z]=0);let tot=0;
  S.clients.forEach(c=>{if(c.blocked)return;const z=zoneOfClient(c);if(!z)return;if(zoneMode==='lavori'&&!zoneShownDue(c,due))return;counts[z]++;tot++;});
  return {counts,tot};
}

function renderZone(){
  zoneIndex();
  const {counts,tot}=zoneCounts();
  const noZone=S.clients.filter(c=>!c.blocked&&!zoneOfClient(c)&&((c.town||'').trim()||(c.cap||'').trim()));
  $('#main').innerHTML=`
  <div class="pagetitle"><span class="accent" style="background:var(--teal)"></span>Zone</div>
  <div class="zsearch"><input id="zone-q" class="searchbar" style="margin:0" placeholder="🔍 Cerca paese o cliente…" value="${esc(zoneQuery)}" oninput="zoneQuery=this.value;zoneRenderList()" onkeydown="if(event.key==='Enter')zoneSearchFly()"></div>
  <div class="zmodes">
    <div class="zmode${zoneMode==='lavori'?' on':''}" onclick="zoneSetMode('lavori')">🔧 Lavori da fare</div>
    <div class="zmode${zoneMode==='clienti'?' on':''}" onclick="zoneSetMode('clienti')">👥 Tutti i clienti</div>
  </div>
  ${zoneMode==='lavori'?`<div class="zwin">${[['oggi','Oggi'],['7','Questa settimana'],['all','Tutti']].map(([v,l])=>`<div class="zw${zoneWin===v?' on':''}" onclick="zoneSetWin('${v}')">${l}</div>`).join('')}</div>`:''}
  <div id="zone-chips">${zoneChipsHTML(counts,tot)}</div>
  <div id="zone-map" class="zone-map"></div>
  <label class="ztoggle"><input type="checkbox" ${zoneShowAll?'checked':''} onchange="zoneShowAll=this.checked;renderZone()"> Mostra tutti i ${ZONE_PAESI.length} paesi sulla mappa</label>
  <div id="zone-routebar"></div>
  <div id="zone-list"></div>
  ${noZone.length?`<details class="znozone"><summary>⚠️ ${noZone.length} client${noZone.length===1?'e':'i'} senza zona (paese non riconosciuto)</summary><div class="card" style="margin-top:8px">${noZone.sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<div class="item" onclick="openClient('${c.id}')"><div class="bd"><div class="ti">${esc(c.name)}</div><div class="su">${esc([c.town||'(nessun paese)',c.cap].filter(Boolean).join(' · '))}</div></div></div>`).join('')}</div></details>`:''}
  ${isOwner()?`<div style="text-align:center;margin:16px 0 4px"><span class="zlink" onclick="zoneAssignAll()">🔄 Assegna le zone ai clienti (gruppo = zona)</span></div>`:''}`;
  zoneInitMap();
  zoneRenderList();
  zoneRouteBar();
}

function zoneChipsHTML(counts,tot){
  const chip=z=>{const on=zoneSel===z;return `<div class="zchip${on?' on':''}${counts[z]?'':' empty'}" style="--zc:${ZONE_COLORS[z]}" onclick="zoneSelect('${on?'all':z}')"><span class="zdot"></span>${z}<span class="zn">${counts[z]}</span></div>`;};
  return `<div class="zchips">
    <div class="zchip${zoneSel==='all'?' on':''}" style="--zc:var(--teal)" onclick="zoneSelect('all')">🗺️ Tutte<span class="zn">${tot}</span></div>
    ${ZONE_LETTERS.map(chip).join('')}
  </div>`;
}

function zoneSetMode(m){zoneMode=m;zoneRoute=[];renderZone();}
function zoneSetWin(w){zoneWin=w;renderZone();}
/* dall'Hub: apri la mappa filtrata su una zona, in modalità Lavori */
function zoneOpenFiltered(z){zoneMode='lavori';zoneWin='all';zoneSel=z;zoneQuery='';zoneRoute=[];nav('zone');}
/* aggiungi al giro tutti i clienti elencati di una zona */
function zoneAddZoneToRoute(z){
  const ids=zoneListClients().filter(c=>zoneOfClient(c)===z).map(c=>c.id);
  ids.forEach(id=>{if(!zoneRoute.includes(id))zoneRoute.push(id);});
  zoneRenderList();zoneRouteBar();
  if(typeof toast==='function')toast('🧭 '+ids.length+' nel giro');
}
function zoneSelect(z){
  zoneSel=z;
  const {counts,tot}=zoneCounts();
  const el=document.getElementById('zone-chips');if(el)el.innerHTML=zoneChipsHTML(counts,tot);
  zoneRenderList();zoneStyle();
}

/* ---------- mappa ---------- */
function zoneInitMap(){
  const el=document.getElementById('zone-map');if(!el)return;
  if(typeof L==='undefined'){el.innerHTML='<div class="subtle" style="padding:20px;text-align:center">Mappa non disponibile offline (serve connessione).</div>';return;}
  if(zMap){try{zMap.remove();}catch(e){}zMap=null;}
  zMarkers=[];
  zMap=L.map(el,{center:ZONE_CENTER,zoom:10,scrollWheelZoom:true});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap'}).addTo(zMap);
  const due=zoneDueByClient();const tindex=zoneTownIndex();
  const byTown={};
  S.clients.forEach(c=>{if(c.blocked)return;const z=zoneOfClient(c);if(!z)return;if(zoneMode==='lavori'&&!zoneShownDue(c,due))return;const t=tindex[zNorm(c.town||'')];if(!t)return;const k=zNorm(t.p);(byTown[k]=byTown[k]||{t,clients:[]}).clients.push(c);});
  /* paesi di sfondo (opzionale) */
  if(zoneShowAll){ZONE_PAESI.forEach(t=>{if(byTown[zNorm(t.p)])return;const m=L.circleMarker([t.la,t.lo],{radius:3.5,color:'#fff',weight:0.4,fillColor:ZONE_COLORS[t.z],fillOpacity:0.45,opacity:0.5});m.bindTooltip(t.p,{direction:'top'});m.addTo(zMap);zMarkers.push({m,z:t.z,bg:true});});}
  /* pin attivi (clienti / lavori) */
  Object.values(byTown).forEach(({t,clients})=>{
    let color=ZONE_COLORS[t.z],rel=Infinity;
    if(zoneMode==='lavori'){clients.forEach(c=>{const d=due[c.id];if(d&&d.minRel<rel)rel=d.minRel;});color=urgColor(rel);}
    const m=L.circleMarker([t.la,t.lo],{radius:7+Math.min(clients.length,7),color:'#fff',weight:1.6,fillColor:color,fillOpacity:0.9,opacity:1});
    m.bindPopup(zonePopupHTML(t,clients,due),{maxWidth:280});
    m.bindTooltip(t.p+' ('+clients.length+')',{direction:'top'});
    m.addTo(zMap);zMarkers.push({m,z:t.z,town:t});
  });
  const fc=zoneFocusId?byId(S.clients,zoneFocusId):null;
  const ft=fc?zoneTownIndex()[zNorm(fc.town||'')]:null;
  zoneFocusId=null;
  zoneStyle(!ft); // se focalizzo un cliente non faccio il fitBounds (lascio lavorare il flyTo)
  setTimeout(()=>{
    if(!zMap)return;
    zMap.invalidateSize();
    if(ft){const mk=zMarkers.find(o=>o.town&&zNorm(o.town.p)===zNorm(ft.p));zMap.flyTo([ft.la,ft.lo],14,{duration:.6});if(mk)setTimeout(()=>mk.m.openPopup(),650);}
  },70);
}
function zonePopupHTML(t,clients,due){
  let h=`<b>${esc(t.p)}</b> · <span style="color:${ZONE_COLORS[t.z]}">Zona ${t.z}</span><div style="margin-top:5px;max-height:210px;overflow:auto">`;
  clients.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(c=>{
    const d=due[c.id];
    const jobs=d?d.items.slice().sort((a,b)=>a.rel-b.rel).map(it=>(it.kind==='pellet'?'🪵':'🔧')+(it.date?' '+fmtD(it.date):'')).join(' · '):'';
    h+=`<div style="padding:5px 0;border-top:1px solid #eaeaea"><div style="font-weight:600">👤 ${esc(c.name)}</div>${jobs?`<div style="color:#777;font-size:11px;margin:1px 0 3px">${jobs}</div>`:''}<div style="display:flex;gap:10px;flex-wrap:wrap">${zoneNavAddr(c)?`<a href="${navUrl(c)}" target="_blank" rel="noopener">🧭 Naviga</a>`:''}${c.phone?`<a href="tel:${esc(c.phone)}">📞 ${esc(c.phone)}</a>`:''}</div></div>`;
  });
  return h+'</div>';
}
function zoneStyle(fit=true){
  if(!zMap)return;const sel=zoneSel;const b=[];
  zMarkers.forEach(o=>{
    const inSel=sel==='all'||o.z===sel;
    const base=o.bg?0.45:0.9;
    o.m.setStyle({opacity:sel==='all'||inSel?(o.bg?0.5:1):0.12,fillOpacity:sel==='all'?base:(inSel?base:0.1)});
    if(!o.bg&&inSel)b.push(o.m.getLatLng());
  });
  if(fit&&b.length)zMap.fitBounds(b,{padding:[28,28],maxZoom:sel==='all'?11:13});
}
function zoneSearchFly(){
  const q=norm(zoneQuery);if(!q||!zMap)return;
  let hit=ZONE_PAESI.find(t=>norm(t.p).includes(q));
  if(!hit){const c=S.clients.find(c=>!c.blocked&&norm(c.name).includes(q)&&zoneOfClient(c));if(c)hit=zoneTownIndex()[zNorm(c.town||'')];}
  if(hit)zMap.flyTo([hit.la,hit.lo],14,{duration:0.6});
}

/* ---------- lista ---------- */
function zoneRow(c,due){
  const z=zoneOfClient(c);const d=due[c.id];
  const dot=zoneMode==='lavori'&&d?urgColor(d.minRel):(ZONE_COLORS[z]||'var(--t3)');
  const jobs=d?d.items.slice().sort((a,b)=>a.rel-b.rel).map(it=>`<span class="zjob">${it.kind==='pellet'?'🪵':'🔧'} ${it.date?fmtD(it.date):'da pianificare'}</span>`).join(''):'';
  const sub=[c.town,c.street?c.street+(c.streetNo?' '+c.streetNo:''):''].filter(Boolean).join(' · ');
  const inRoute=zoneRoute.includes(c.id);
  return `<div class="item zitem" onclick="openClient('${c.id}')">
    <span class="zrdot" style="background:${dot}"></span>
    <div class="bd"><div class="ti">${esc(c.name)}</div><div class="su">${esc(sub)||'—'}</div>${jobs?`<div class="zjobs">${jobs}</div>`:''}</div>
    <div class="zact" onclick="event.stopPropagation()">
      ${zoneNavAddr(c)?`<a href="${navUrl(c)}" target="_blank" rel="noopener" class="zbtn" title="Naviga">🧭</a>`:''}
      ${c.phone?`<a href="tel:${esc(c.phone)}" class="zbtn" title="Chiama">📞</a>`:''}
      <span class="zbtn route${inRoute?' on':''}" title="Aggiungi al giro" onclick="zoneRouteToggle('${c.id}')">${inRoute?'✓':'＋'}</span>
    </div></div>`;
}
function zoneSecHead(z,cls,due){
  const tot=zoneMode==='lavori'?zoneTotalsLabel(zoneTotals(cls,due)):'';
  return `<div class="zsection" style="--zc:${ZONE_COLORS[z]}"><span class="zsdot"></span><span style="color:${ZONE_COLORS[z]}">${ZONE_LABEL(z)}</span><span class="badge" style="border-color:var(--line2);color:var(--t3)">${cls.length}</span><span class="zgiro" onclick="zoneAddZoneToRoute('${z}')" title="Aggiungi tutta la zona al giro">➕ Giro</span></div>${tot?`<div class="ztot">📦 ${tot}</div>`:''}`;
}
function zoneListHTML(){
  const due=zoneDueByClient();
  const list=zoneListClients();
  if(!list.length)return `<div class="card"><div class="empty"><div class="big">${zoneMode==='lavori'?'✅':'🗺️'}</div>${zoneMode==='lavori'?'Nessun lavoro in sospeso qui.':'Nessun cliente in questa selezione.'}</div></div>`;
  const ord=(a,b)=>(due[a.id]?.minRel??1e9)-(due[b.id]?.minRel??1e9)||a.name.localeCompare(b.name);
  if(zoneSel==='all'){
    return ZONE_LETTERS.filter(z=>list.some(c=>zoneOfClient(c)===z)).map(z=>{
      const cls=list.filter(c=>zoneOfClient(c)===z).sort(ord);
      return zoneSecHead(z,cls,due)+`<div class="card">${cls.map(c=>zoneRow(c,due)).join('')}</div>`;
    }).join('');
  }
  const cls=list.slice().sort(ord);
  const byTown={};cls.forEach(c=>{const k=(c.town||'—').trim()||'—';(byTown[k]=byTown[k]||[]).push(c);});
  return zoneSecHead(zoneSel,cls,due)
    +Object.keys(byTown).sort((a,b)=>a.localeCompare(b)).map(k=>`<div class="zsection" style="--zc:var(--line2)"><span style="color:var(--t2)">📍 ${esc(k)}</span><span class="badge" style="border-color:var(--line2);color:var(--t3)">${byTown[k].length}</span></div><div class="card">${byTown[k].map(c=>zoneRow(c,due)).join('')}</div>`).join('');
}
function zoneRenderList(){const el=document.getElementById('zone-list');if(el)el.innerHTML=zoneListHTML();}

/* ---------- giro di consegne ---------- */
function zoneRouteToggle(cid){const i=zoneRoute.indexOf(cid);if(i<0)zoneRoute.push(cid);else zoneRoute.splice(i,1);zoneRenderList();zoneRouteBar();}
function zoneRouteClear(){zoneRoute=[];zoneRenderList();zoneRouteBar();}
function zoneRouteBar(){
  const el=document.getElementById('zone-routebar');if(!el)return;
  if(!zoneRoute.length){el.innerHTML='';return;}
  el.innerHTML=`<div class="zroutebar"><span>🧭 Giro: <b>${zoneRoute.length}</b> tapp${zoneRoute.length===1?'a':'e'}</span><span style="display:flex;gap:8px"><button class="btn ghost" style="padding:7px 12px" onclick="zoneRouteClear()">Svuota</button><button class="btn pri" style="padding:7px 12px" onclick="zoneRouteOpen()">Apri in Maps ▸</button></span></div>`;
}
function zoneRouteOpen(){
  const cls=zoneRoute.map(id=>byId(S.clients,id)).filter(c=>c&&zoneNavAddr(c));
  if(!cls.length){toast('Aggiungi almeno un cliente con indirizzo');return;}
  const tindex=zoneTownIndex();
  let pts=cls.map(c=>{const t=tindex[zNorm(c.town||'')];return {c,la:t?t.la:ZONE_CENTER[0],lo:t?t.lo:ZONE_CENTER[1]};});
  /* ordina per vicinanza partendo dalla base (nearest-neighbour) */
  const B=zoneBase();const ordered=[];let cur={la:B[0],lo:B[1]};
  while(pts.length){let bi=0,bd=Infinity;pts.forEach((p,i)=>{const d=zHav(cur,p);if(d<bd){bd=d;bi=i;}});cur=pts[bi];ordered.push(pts[bi]);pts.splice(bi,1);}
  let addrs=ordered.map(p=>zoneNavAddr(p.c));
  if(addrs.length>10){toast('Maps accetta max 10 tappe — uso le 10 più vicine');addrs=addrs.slice(0,10);}
  const dest=encodeURIComponent(addrs[addrs.length-1]);
  const wp=addrs.slice(0,-1).map(encodeURIComponent).join('|');
  let url='https://www.google.com/maps/dir/?api=1&travelmode=driving&destination='+dest;
  if(wp)url+='&waypoints='+wp;
  window.open(url,'_blank','noopener');
}

/* assegna gruppo = zona a tutti i clienti */
function zoneAssignAll(){
  zoneIndex();
  if(!confirm('Assegno a ogni cliente il GRUPPO in base alla zona del suo Paese (A–H).\nI gruppi attuali verranno sovrascritti. Procedo?'))return;
  let upd=0;const noz=[];
  S.clients.forEach(c=>{const z=zoneOfClient(c);if(z){const g=ZONE_LABEL(z);if(c.group!==g){c.group=g;upd++;}}else if((c.town||'').trim()||(c.cap||'').trim())noz.push(c.name);});
  save();renderZone();
  openSheet(`<h3>Zone assegnate ✓ <span class="x" onclick="closeSheet()">✕</span></h3>
  <div class="subtle" style="margin-bottom:10px">Aggiornati <b>${upd}</b> client${upd===1?'e':'i'} (gruppo = zona).</div>
  ${noz.length?`<div class="card" style="padding:10px 12px"><div style="color:var(--amber);font-weight:600;margin-bottom:6px">⚠️ ${noz.length} senza zona (paese non riconosciuto):</div><div class="subtle" style="max-height:220px;overflow:auto">${noz.sort((a,b)=>a.localeCompare(b)).map(esc).join('<br>')}</div></div>`:'<div class="subtle">Tutti i clienti con un Paese sono stati abbinati. 👍</div>'}
  <div class="actions"><button class="btn pri" onclick="closeSheet()">Ok</button></div>`);
}

/* card "Lavori per zona" per l'Hub (sopra la casella Oggi) */
function zoneHubCardHTML(){
  if(typeof ZONE_PAESI==='undefined')return '';
  zoneIndex();
  const due=zoneDueByClient();
  const byZone={};ZONE_LETTERS.forEach(z=>byZone[z]=[]);
  S.clients.forEach(c=>{if(c.blocked)return;if(!due[c.id])return;const z=zoneOfClient(c);if(z)byZone[z].push(c);});
  const zs=ZONE_LETTERS.filter(z=>byZone[z].length);
  if(!zs.length)return '';
  const rows=zs.map(z=>{
    const cls=byZone[z];const late=cls.filter(c=>(due[c.id].minRel||0)<0).length;
    const sub=zoneTotalsLabel(zoneTotals(cls,due))||(cls.length+' lavori');
    return `<div class="item" onclick="zoneOpenFiltered('${z}')"><span class="zrdot" style="background:${ZONE_COLORS[z]};margin-top:3px"></span><div class="bd"><div class="ti">${ZONE_LABEL(z)} <span class="subtle">· ${cls.length} client${cls.length>1?'i':'e'}</span>${late?` <span class="badge" style="border-color:var(--coral);color:var(--coral)">${late} in ritardo</span>`:''}</div><div class="su">${esc(sub)}</div></div></div>`;
  }).join('');
  return `<div class="card"><div class="sh"><span class="t">🗺️ Lavori per zona</span><span class="a" onclick="nav('zone')">Mappa →</span></div>${rows}</div>`;
}

window.renderZone=renderZone;
window.zoneFocusClient=zoneFocusClient;
window.zoneFromSheet=zoneFromSheet;
window.zoneSetWin=zoneSetWin;
window.zoneOpenFiltered=zoneOpenFiltered;
window.zoneAddZoneToRoute=zoneAddZoneToRoute;
window.zoneHubCardHTML=zoneHubCardHTML;
window.zoneSetBase=zoneSetBase;
window.zoneBaseTown=zoneBaseTown;
window.zoneSelect=zoneSelect;
window.zoneSetMode=zoneSetMode;
window.zoneSearchFly=zoneSearchFly;
window.zoneRenderList=zoneRenderList;
window.zoneRouteToggle=zoneRouteToggle;
window.zoneRouteClear=zoneRouteClear;
window.zoneRouteOpen=zoneRouteOpen;
window.zoneAssignAll=zoneAssignAll;
window.zoneOfClient=zoneOfClient;
window.ZONE_LABEL=ZONE_LABEL;
