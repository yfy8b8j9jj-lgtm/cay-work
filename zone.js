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
/* posizione esatta salvata (pin spostato a mano o geocodificato)? */
function zoneHasExact(c){return !!c&&typeof c.lat==='number'&&isFinite(c.lat)&&typeof c.lng==='number'&&isFinite(c.lng);}
/* coordinate per il pin: casa esatta se impostata, altrimenti centro del paese */
function zoneClientLL(c){
  if(zoneHasExact(c))return [c.lat,c.lng];
  const t=c?zoneTownIndex()[zNorm(c.town||'')]:null;
  return t?[t.la,t.lo]:null;
}
/* c'è qualcosa da navigare? (coordinate esatte OPPURE un indirizzo testuale) */
function zoneCanNav(c){return zoneHasExact(c)||!!zoneNavAddr(c);}
/* destinazione: coordinate esatte (Google non sbaglia) o, in mancanza, l'indirizzo testuale */
function navUrl(c){
  const dest=zoneHasExact(c)?(c.lat+','+c.lng):zoneNavAddr(c);
  return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination='+encodeURIComponent(dest);
}

/* ---- geocodifica VINCOLATA al paese (Fase 2) ----
   manda solo l'indirizzo (mai il nome) a OpenStreetMap/Nominatim; il riquadro attorno al
   centro del paese impedisce risultati lontani. Throttle ≥1.1s (policy OSM). */
let _zGeoNext=0;
function _zGeoWait(){const w=Math.max(0,_zGeoNext-Date.now());_zGeoNext=Date.now()+w+1150;return new Promise(r=>setTimeout(r,w));}
async function zoneGeocode(c){
  if(!c)return null;
  const street=[c.streetNo,c.street].filter(Boolean).join(' ').trim();
  const cap=String(c.cap||'').trim(), town=(c.town||c.zone||'').trim();
  if(!street&&!cap&&!town)return null;
  const t=zoneTownIndex()[zNorm(town)];
  const p=new URLSearchParams({format:'jsonv2',limit:'5',countrycodes:'ch'});
  if(street)p.set('street',street);
  if(town)p.set('city',town);
  if(cap)p.set('postalcode',cap);
  if(t){const d=0.06;p.set('viewbox',[t.lo-d,t.la-d,t.lo+d,t.la+d].join(','));p.set('bounded','1');}
  await _zGeoWait();
  const r=await fetch('https://nominatim.openstreetmap.org/search?'+p.toString(),{headers:{Accept:'application/json'}});
  if(!r.ok)throw new Error('Geocoder '+r.status);
  let arr=await r.json();
  if(!Array.isArray(arr)||!arr.length)return null;
  if(t){const ref={la:t.la,lo:t.lo};arr=arr.slice().sort((a,b)=>zHav(ref,{la:+a.lat,lo:+a.lon})-zHav(ref,{la:+b.lat,lo:+b.lon}));}
  const b=arr[0];const lat=+b.lat,lng=+b.lon;
  if(!isFinite(lat)||!isFinite(lng))return null;
  return {lat:+lat.toFixed(6),lng:+lng.toFixed(6)};
}

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
  ${isOwner()?`<div style="text-align:center;margin:16px 0 4px;display:flex;flex-direction:column;gap:8px"><span class="zlink" onclick="zoneAssignAll()">🔄 Assegna le zone ai clienti (gruppo = zona)</span><span class="zlink" onclick="zoneGeocodeMissing()">🎯 Trova la posizione dei clienti senza pin</span></div>`:''}`;
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
  const byTown={};const exact=[];
  S.clients.forEach(c=>{if(c.blocked)return;const z=zoneOfClient(c);if(!z)return;if(zoneMode==='lavori'&&!zoneShownDue(c,due))return;
    if(zoneHasExact(c)){exact.push({c,z});return;}
    const t=tindex[zNorm(c.town||'')];if(!t)return;const k=zNorm(t.p);(byTown[k]=byTown[k]||{t,clients:[]}).clients.push(c);});
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
  /* pin esatti: casa del cliente (segnaposto a goccia) */
  exact.forEach(({c,z})=>{
    let color=ZONE_COLORS[z];
    if(zoneMode==='lavori'){const d=due[c.id];color=urgColor(d?d.minRel:Infinity);}
    const icon=L.divIcon({className:'zpin',html:`<i style="--c:${color}"></i>`,iconSize:[22,28],iconAnchor:[11,26],popupAnchor:[0,-24]});
    const m=L.marker([c.lat,c.lng],{icon});
    m.bindPopup(zoneClientPopupHTML(c,due),{maxWidth:280});
    m.bindTooltip(esc(c.name),{direction:'top'});
    m.addTo(zMap);zMarkers.push({m,z,exact:true,c});
  });
  const fc=zoneFocusId?byId(S.clients,zoneFocusId):null;
  const fll=fc?zoneClientLL(fc):null;
  zoneFocusId=null;
  zoneStyle(!fll); // se focalizzo un cliente non faccio il fitBounds (lascio lavorare il flyTo)
  setTimeout(()=>{
    if(!zMap)return;
    zMap.invalidateSize();
    if(fll){zMap.flyTo(fll,zoneHasExact(fc)?17:14,{duration:.6});
      const mk=zMarkers.find(o=>(o.exact&&o.c&&o.c.id===fc.id)||(o.town&&zNorm(o.town.p)===zNorm(fc.town||'')));
      if(mk)setTimeout(()=>mk.m.openPopup(),650);}
  },70);
}
/* popup di un singolo cliente posizionato (pin esatto) */
function zoneClientPopupHTML(c,due){
  const z=zoneOfClient(c);const d=due&&due[c.id];
  const jobs=d?d.items.slice().sort((a,b)=>a.rel-b.rel).map(it=>(it.kind==='pellet'?'🪵':'🔧')+(it.date?' '+fmtD(it.date):'')).join(' · '):'';
  return `<div style="font-weight:700">🏠 ${esc(c.name)}</div>${z?`<div style="font-size:11px;color:${ZONE_COLORS[z]}">Zona ${z}</div>`:''}${jobs?`<div style="color:#777;font-size:11px;margin:2px 0">${jobs}</div>`:''}<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px">${zoneCanNav(c)?`<a href="${navUrl(c)}" target="_blank" rel="noopener">🧭 Naviga</a>`:''}${c.phone?`<a href="tel:${esc(c.phone)}">📞</a>`:''}<a href="javascript:void 0" onclick="event.preventDefault();openClientGeo('${c.id}')">✏️ Posizione</a></div>`;
}
function zonePopupHTML(t,clients,due){
  let h=`<b>${esc(t.p)}</b> · <span style="color:${ZONE_COLORS[t.z]}">Zona ${t.z}</span><div style="margin-top:5px;max-height:210px;overflow:auto">`;
  clients.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(c=>{
    const d=due[c.id];
    const jobs=d?d.items.slice().sort((a,b)=>a.rel-b.rel).map(it=>(it.kind==='pellet'?'🪵':'🔧')+(it.date?' '+fmtD(it.date):'')).join(' · '):'';
    h+=`<div style="padding:5px 0;border-top:1px solid #eaeaea"><div style="font-weight:600">${zoneHasExact(c)?'🏠':'👤'} ${esc(c.name)}</div>${jobs?`<div style="color:#777;font-size:11px;margin:1px 0 3px">${jobs}</div>`:''}<div style="display:flex;gap:10px;flex-wrap:wrap">${zoneCanNav(c)?`<a href="${navUrl(c)}" target="_blank" rel="noopener">🧭 Naviga</a>`:''}${c.phone?`<a href="tel:${esc(c.phone)}">📞 ${esc(c.phone)}</a>`:''}<a href="javascript:void 0" onclick="event.preventDefault();openClientGeo('${c.id}')">${zoneHasExact(c)?'✏️':'🎯'} Posizione</a></div></div>`;
  });
  return h+'</div>';
}
function zoneStyle(fit=true){
  if(!zMap)return;const sel=zoneSel;const b=[];
  zMarkers.forEach(o=>{
    const inSel=sel==='all'||o.z===sel;
    if(o.exact){o.m.setOpacity(sel==='all'||inSel?1:0.18);if(sel==='all'||inSel)b.push(o.m.getLatLng());return;}
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
      ${zoneCanNav(c)?`<a href="${navUrl(c)}" target="_blank" rel="noopener" class="zbtn" title="Naviga">🧭</a>`:''}
      <span class="zbtn" title="${zoneHasExact(c)?'Posizione esatta — modifica':'Imposta posizione esatta'}" onclick="openClientGeo('${c.id}')">${zoneHasExact(c)?'🏠':'🎯'}</span>
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
  const cls=zoneRoute.map(id=>byId(S.clients,id)).filter(c=>c&&zoneCanNav(c));
  if(!cls.length){toast('Aggiungi almeno un cliente con indirizzo');return;}
  let pts=cls.map(c=>{const ll=zoneClientLL(c)||ZONE_CENTER;return {c,la:ll[0],lo:ll[1]};});
  /* ordina per vicinanza partendo dalla base (nearest-neighbour) */
  const B=zoneBase();const ordered=[];let cur={la:B[0],lo:B[1]};
  while(pts.length){let bi=0,bd=Infinity;pts.forEach((p,i)=>{const d=zHav(cur,p);if(d<bd){bd=d;bi=i;}});cur=pts[bi];ordered.push(pts[bi]);pts.splice(bi,1);}
  let addrs=ordered.map(p=>zoneHasExact(p.c)?(p.c.lat+','+p.c.lng):zoneNavAddr(p.c));
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

/* ---------- editor posizione cliente (A: pin manuale · B: geocodifica) ---------- */
let _zGeoMap=null,_zGeoMk=null,_zGeoMoved=false;
function openClientGeo(cid){
  const c=byId(S.clients,cid);if(!c){if(typeof toast==='function')toast('Cliente non trovato');return;}
  const ll=zoneClientLL(c)||ZONE_CENTER;const has=zoneHasExact(c);
  const addr=(typeof cAddr==='function'?cAddr(c):'')||c.town||'—';
  openSheet(`<h3>📍 Posizione · ${esc(c.name)} <span class="x" onclick="closeSheet()">✕</span></h3>
  <div class="subtle" style="margin-bottom:8px">${esc(addr)}${has?` · <span style="color:var(--teal)">posizione ${c.geoSrc==='manual'?'manuale':'trovata'} ✓</span>`:''}</div>
  <div id="cgeo-map" style="height:300px;border-radius:12px;overflow:hidden;border:1px solid var(--line2)"></div>
  <div class="subtle" style="margin:8px 0;font-size:12px;line-height:1.4">🔒 «Trova dall'indirizzo» invia l'indirizzo (<b>senza il nome</b>) a OpenStreetMap per calcolare le coordinate. Il trascinamento del segnaposto resta nell'app.</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
    <button class="btn" id="cgeo-find" style="border-color:var(--teal);color:var(--teal)" onclick="zoneGeoFind('${cid}')">🔍 Trova dall'indirizzo</button>
    ${has?`<button class="btn" style="border-color:var(--coral);color:var(--coral)" onclick="zoneGeoRemove('${cid}')">🗑️ Rimuovi posizione</button>`:''}
  </div>
  <div class="subtle" style="font-size:12px">Trascina il segnaposto sulla casa, poi salva.</div>
  <div class="actions"><button class="btn ghost" onclick="closeSheet()">Annulla</button><button class="btn pri" onclick="zoneGeoSave('${cid}')">✅ Salva posizione</button></div>`);
  _zGeoMoved=false;
  setTimeout(()=>{
    const el=document.getElementById('cgeo-map');if(!el)return;
    if(typeof L==='undefined'){el.innerHTML='<div class="subtle" style="padding:20px;text-align:center">Mappa non disponibile (serve connessione).</div>';return;}
    if(_zGeoMap){try{_zGeoMap.remove();}catch(e){}_zGeoMap=null;}
    _zGeoMap=L.map(el,{center:ll,zoom:has?17:14});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(_zGeoMap);
    const icon=L.divIcon({className:'zpin zpin-edit',html:'<i style="--c:#2E9E8F"></i>',iconSize:[24,30],iconAnchor:[12,28]});
    _zGeoMk=L.marker(ll,{draggable:true,icon,autoPan:true}).addTo(_zGeoMap);
    _zGeoMk.on('dragend',()=>{_zGeoMoved=true;});
    _zGeoMap.on('click',e=>{_zGeoMk.setLatLng(e.latlng);_zGeoMoved=true;});
    setTimeout(()=>{if(_zGeoMap)_zGeoMap.invalidateSize();},80);
  },70);
}
async function zoneGeoFind(cid){
  const c=byId(S.clients,cid);if(!c)return;
  const btn=document.getElementById('cgeo-find');if(btn){btn.disabled=true;btn.textContent='⏳ Cerco…';}
  try{
    const g=await zoneGeocode(c);
    if(g&&_zGeoMap&&_zGeoMk){_zGeoMk.setLatLng([g.lat,g.lng]);_zGeoMap.flyTo([g.lat,g.lng],17,{duration:.5});_zGeoMoved=false;if(typeof toast==='function')toast('📍 Trovato — controlla e salva');}
    else if(typeof toast==='function')toast('❓ Non trovato nel paese — posiziona a mano');
  }catch(e){if(typeof toast==='function')toast('⚠️ Geocoder non raggiungibile');}
  if(btn){btn.disabled=false;btn.textContent='🔍 Trova dall\'indirizzo';}
}
function zoneGeoSave(cid){
  const c=byId(S.clients,cid);if(!c||!_zGeoMk)return;
  const p=_zGeoMk.getLatLng();
  c.lat=+(+p.lat).toFixed(6);c.lng=+(+p.lng).toFixed(6);c.geoSrc=_zGeoMoved?'manual':'auto';
  save();closeSheet();if(typeof toast==='function')toast('✅ Posizione salvata');
  if(document.getElementById('zone-map'))renderZone();
}
function zoneGeoRemove(cid){
  const c=byId(S.clients,cid);if(!c)return;
  c.lat=null;c.lng=null;c.geoSrc=null;
  save();closeSheet();if(typeof toast==='function')toast('🗑️ Posizione rimossa');
  if(document.getElementById('zone-map'))renderZone();
}
/* batch (solo titolare): geocodifica i clienti senza posizione, ≤1 richiesta/sec, salta i pin manuali */
async function zoneGeocodeMissing(){
  if(!confirm('Cerco automaticamente la posizione dei clienti che non ce l\'hanno ancora.\nInvia gli indirizzi (senza nome) a OpenStreetMap, una richiesta al secondo.\nI pin già sistemati a mano NON vengono toccati. Procedo?'))return;
  const todo=S.clients.filter(c=>!c.blocked&&!zoneHasExact(c)&&((c.street||'').trim()||(c.cap||'').trim())&&(c.town||'').trim()&&zoneOfClient(c));
  if(!todo.length){if(typeof toast==='function')toast('Tutti già posizionati 👍');return;}
  let ok=0,ko=0;
  for(let i=0;i<todo.length;i++){
    const c=todo[i];if(typeof toast==='function')toast('📍 '+(i+1)+'/'+todo.length+' — '+(c.town||''));
    try{const g=await zoneGeocode(c);if(g){c.lat=g.lat;c.lng=g.lng;c.geoSrc='auto';ok++;}else ko++;}catch(e){ko++;}
  }
  save();renderZone();
  openSheet(`<h3>Posizioni trovate ✓ <span class="x" onclick="closeSheet()">✕</span></h3>
  <div class="subtle">Posizionati <b>${ok}</b> · non trovati <b>${ko}</b>.<br>I non trovati restano sul centro paese: apri il cliente e sistema il pin a mano (🏠).</div>
  <div class="actions"><button class="btn pri" onclick="closeSheet()">Ok</button></div>`);
}

window.renderZone=renderZone;
window.openClientGeo=openClientGeo;
window.zoneGeoFind=zoneGeoFind;
window.zoneGeoSave=zoneGeoSave;
window.zoneGeoRemove=zoneGeoRemove;
window.zoneGeocodeMissing=zoneGeocodeMissing;
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
