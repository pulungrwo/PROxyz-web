(() => {
  "use strict";
  const config = window.PROXYZ_ADMIN_CONFIG || {};
  const API = String(config.apiBase || "").replace(/\/$/, "");
  const $ = id => document.getElementById(id);
  const rupiah = new Intl.NumberFormat("id-ID", { style:"currency", currency:"IDR", maximumFractionDigits:0 });
  const kg = n => `${Number(n||0).toLocaleString("id-ID",{maximumFractionDigits:2})} kg`;
  const dateFmt = value => value ? new Intl.DateTimeFormat("id-ID",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(`${value}T00:00:00`)) : "—";
  let projects = [];
  let detail = null;
  let activeTab = "transactions";
  let currentRows = [];
  let formMode = "";

  function status(message="", type="") { $("bt-status").textContent=message; $("bt-status").className=`status ${type}`.trim(); }
  function formStatus(message="", type="") { $("bt-form-status").textContent=message; $("bt-form-status").className=`status ${type}`.trim(); }
  function esc(v){return String(v??"").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
  async function api(path, options={}) {
    let res;
    try { res = await fetch(`${API}${path}`, { ...options, headers:{"Content-Type":"application/json",...(options.headers||{})}, credentials:"include", cache:"no-store" }); }
    catch { throw new Error("API PROxyz belum dapat dihubungi."); }
    const data = await res.json().catch(()=>({}));
    if (!res.ok) {
      if (res.status===401) setTimeout(()=>location.href="./",700);
      throw new Error(data.error || `Permintaan gagal (${res.status}).`);
    }
    return data;
  }
  function qscope() {
    const season=$("bt-season").value||""; const crop=$("bt-crop").value||"";
    return `season=${encodeURIComponent(season)}&crop=${encodeURIComponent(crop)}`;
  }
  function currentProjectId(){ return $("bt-project").value || projects[0]?.id || ""; }
  function currentSeason(){return $("bt-season").value||detail?.activeSeasonId||"";}
  function currentCrop(){return $("bt-crop").value||detail?.activeCropId||"";}
  function today(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}

  async function init(){
    if(!API) return status("Alamat API Admin belum dikonfigurasi.","error");
    status("Memeriksa sesi…");
    try {
      await api("/api/me");
      const data=await api("/api/bertunas"); projects=data.bertunas||[];
      if(!projects.length){status("Belum ada Bertunas yang dapat Anda kelola.","error"); return;}
      $("bt-project").replaceChildren(...projects.map(p=>new Option(`Bertunas ${p.id} · ${p.nama}`,p.id)));
      $("bt-app").hidden=false; status("");
      await loadDetail(projects[0].id);
    } catch(e){status(e.message,"error");}
  }

  function fillScopes(preferredSeason="",preferredCrop=""){
    const seasons=detail?.seasons||[];
    $("bt-season").replaceChildren(...seasons.map(s=>new Option(`${s.nama} · ${s.status}`,s.id)));
    const seasonId=preferredSeason||detail?.activeSeasonId||seasons[0]?.id||"";
    if(seasonId) $("bt-season").value=seasonId;
    fillCrops(preferredCrop||detail?.activeCropId||"");
  }
  function fillCrops(preferred=""){
    const season=(detail?.seasons||[]).find(s=>s.id===$("bt-season").value) || detail?.seasons?.[0];
    const crops=season?.crops||[];
    $("bt-crop").replaceChildren(...crops.map(c=>new Option(`${c.komoditas} · ${c.id}`,c.id)));
    const target=preferred||crops[0]?.id||""; if(target) $("bt-crop").value=target;
  }

  async function loadDetail(id, season="", crop=""){
    status("Memuat Bertunas…");
    const qs=new URLSearchParams(); if(season)qs.set("season",season); if(crop)qs.set("crop",crop);
    const data=await api(`/api/bertunas/${encodeURIComponent(id)}${qs.toString()?`?${qs}`:""}`);
    detail=data.bertunas;
    if(!season&&!crop) fillScopes(); else { fillScopes(season,crop); }
    $("bt-name").textContent=`Bertunas ${detail.id} · ${detail.nama}`;
    $("bt-meta").textContent=[detail.lokasi,detail.luas].filter(Boolean).join(" · ")||"Lahan pertanian";
    $("bt-role").textContent=detail.role;
    renderSummary(); status("");
    await loadTab();
  }

  function renderSummary(){
    const s=detail?.summary||{}; const c=detail?.cropSummary||{};
    const cards=[
      ["Total biaya",rupiah.format(s.expense||0)],
      ["Total panen",kg(s.weightKg||0)],
      ["Omzet",rupiah.format(s.revenue||0)],
      ["Laba berjalan",rupiah.format(s.profit||0)],
      ["Panen tanaman",kg(c.weightKg||0)],
      ["Omzet tanaman",rupiah.format(c.harvestRevenue||0)],
      ["Jadwal menunggu",String(detail?.scheduleSummary?.pending||0)],
      ["Jadwal terlambat",String(detail?.scheduleSummary?.overdue||0)]
    ];
    $("bt-summary").innerHTML=cards.map(([a,b])=>`<article class="bt-card"><span>${esc(a)}</span><strong>${esc(b)}</strong></article>`).join("");
  }

  async function loadTab(){
    const id=currentProjectId(); if(!id)return;
    let data;
    if(activeTab==="transactions") data=await api(`/api/bertunas/${encodeURIComponent(id)}/transaksi?${qscope()}`), currentRows=data.transaksi||[];
    if(activeTab==="activities") data=await api(`/api/bertunas/${encodeURIComponent(id)}/aktivitas?${qscope()}`), currentRows=data.aktivitas||[];
    if(activeTab==="schedules") data=await api(`/api/bertunas/${encodeURIComponent(id)}/jadwal?${qscope()}`), currentRows=data.jadwal||[];
    renderList();
  }

  function renderList(){
    if(!currentRows.length){$("bt-list").innerHTML='<div class="bt-empty">Belum ada data.</div>';return;}
    if(activeTab==="transactions") $("bt-list").innerHTML=currentRows.map(tx=>{
      const type={expense:"Biaya",harvest:"Panen",capital:"Modal",income:"Pemasukan"}[tx.type]||tx.type;
      const title=tx.type==="harvest"?`${kg(tx.weightKg)} · ${rupiah.format(tx.amount)}`:`${type} · ${rupiah.format(tx.amount)}`;
      return `<article class="bt-item"><div class="bt-item-top"><div><h3>${esc(tx.ref)} · ${esc(tx.description||tx.sourceName||type)}</h3><div class="bt-meta">${esc(type)}${tx.category?` · ${esc(tx.category)}`:""} · ${esc(dateFmt(tx.date))}${tx.shared?" · Bersama Musim":""}</div></div><div class="bt-value">${esc(title)}</div></div><div class="bt-item-actions"><button class="ghost" data-edit-tx="${esc(tx.id)}">Edit</button><button class="danger-soft" data-delete-tx="${esc(tx.id)}">Hapus</button></div></article>`;
    }).join("");
    if(activeTab==="activities") $("bt-list").innerHTML=currentRows.map(a=>`<article class="bt-item"><div class="bt-item-top"><div><h3>${esc(a.ref)} · ${esc(a.description)}</h3><div class="bt-meta">${esc(a.category)} · ${esc(dateFmt(a.date))}${a.hst!==null?` · ${a.hst} HST`:""}</div></div></div><div class="bt-item-actions"><button class="ghost" data-edit-activity="${esc(a.id)}">Edit</button><button class="danger-soft" data-delete-activity="${esc(a.id)}">Hapus</button></div></article>`).join("");
    if(activeTab==="schedules") $("bt-list").innerHTML=currentRows.map(s=>`<article class="bt-item"><div class="bt-item-top"><div><h3>${esc(s.ref)} · ${esc(s.description)}</h3><div class="bt-meta">${esc(s.cropName)} · ${esc(s.category)} · ${esc(s.status)}</div></div><div class="bt-value">${s.targetDate?esc(dateFmt(s.targetDate)):(s.targetHst!==null?`${s.targetHst} HST`:"—")}</div></div><div class="bt-item-actions">${s.status==="pending"?`<button class="primary" data-schedule-done="${esc(s.id)}">Selesai</button><button class="ghost" data-schedule-skip="${esc(s.id)}">Lewati</button><button class="ghost" data-edit-schedule="${esc(s.id)}">Edit</button><button class="danger-soft" data-delete-schedule="${esc(s.id)}">Hapus</button>`:s.status==="skipped"?`<button class="ghost" data-schedule-active="${esc(s.id)}">Aktifkan</button>`:""}</div></article>`).join("");
  }

  function field(label,html){return `<label>${esc(label)}${html}</label>`;}
  function input(name,type="text",value="",attrs=""){return `<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}>`;}
  function select(name,values){return `<select name="${name}">${values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("")}</select>`;}
  function openCreate(mode){
    formMode=mode; formStatus(""); const categories=detail?.activityCategories||[]; const expenses=detail?.expenseCategories||[];
    let title=""; let html="";
    if(mode==="expense"){title="Tambah biaya";html=field("Nominal",input("amount","number","","min=1 required"))+field("Kategori",select("category",expenses))+field("Keterangan",input("description","text","","maxlength=80 required"))+field("Catatan",input("note"))+field("Tanggal",input("date","date",today(),"required"))+`<label class="bt-check"><input name="shared" type="checkbox"> Biaya bersama Musim Tanam</label>`;}
    if(mode==="harvest"){title="Tambah panen";html=field("Berat (kg)",input("weight","number","","min=0.01 step=0.01 required"))+field("Total harga",input("amount","number","","min=1 required"))+field("Keterangan",input("description","text","Panen"))+field("Catatan",input("note"))+field("Tanggal",input("date","date",today(),"required"));}
    if(mode==="activity"){title="Tambah aktivitas";html=field("Kategori",select("category",categories))+field("Kegiatan",input("description","text","","maxlength=80 required"))+field("Catatan",input("note"))+field("Tanggal",input("date","date",today(),"required"))+field("Referensi biaya (opsional)",input("expenseRef","text","","placeholder='#3'"));}
    if(mode==="schedule"){title="Tambah jadwal";html=field("Kategori",select("category",categories))+field("Kegiatan",input("description","text","","maxlength=80 required"))+field("Target",input("target","text","","placeholder='20 HST atau 30-08-2026' required"))+field("Catatan",input("note"));}
    if(mode==="planting"){title="Atur tanggal tanam";html=field("Tanggal tanam",input("date","date",detail?.seasons?.find(s=>s.id===currentSeason())?.crops?.find(c=>c.id===currentCrop())?.plantingDate||today(),"required"));}
    $("bt-form-title").textContent=title; $("bt-form-mode").textContent=`Bertunas ${currentProjectId()}`; $("bt-fields").innerHTML=html; $("bt-dialog").showModal();
  }

  async function submitCreate(event){
    event.preventDefault(); const fd=new FormData(event.currentTarget); const body=Object.fromEntries(fd.entries()); body.seasonId=currentSeason(); body.cropId=currentCrop(); body.shared=fd.get("shared")==="on"; formStatus("Menyimpan…");
    try{
      const id=currentProjectId();
      if(formMode==="expense") await api(`/api/bertunas/${id}/biaya`,{method:"POST",body:JSON.stringify(body)});
      if(formMode==="harvest") await api(`/api/bertunas/${id}/panen`,{method:"POST",body:JSON.stringify(body)});
      if(formMode==="activity") await api(`/api/bertunas/${id}/aktivitas`,{method:"POST",body:JSON.stringify(body)});
      if(formMode==="schedule") await api(`/api/bertunas/${id}/jadwal`,{method:"POST",body:JSON.stringify(body)});
      if(formMode==="planting") await api(`/api/bertunas/${id}/tanam`,{method:"POST",body:JSON.stringify(body)});
      $("bt-dialog").close(); await loadDetail(id,currentSeason(),currentCrop());
    }catch(e){formStatus(e.message,"error");}
  }

  async function editTransaction(id){
    const tx=currentRows.find(x=>x.id===id); if(!tx)return;
    const fields=tx.editableFields||[]; const fieldName=prompt(`Bagian yang dapat diedit:\n${fields.join(", ")}\n\nKetik nama bagian:`); if(!fieldName)return;
    if(!fields.includes(fieldName.toLowerCase())) return alert("Bagian tidak dapat diedit untuk transaksi ini.");
    const current={nominal:tx.amount,total:tx.amount,berat:tx.weightKg,kategori:tx.category,keterangan:tx.description,catatan:tx.note,tanggal:tx.date,sumber:tx.sourceName}[fieldName.toLowerCase()]??"";
    const value=prompt(`Nilai baru untuk ${fieldName}:`,current); if(value===null)return;
    await api(`/api/bertunas/${currentProjectId()}/transaksi/${encodeURIComponent(tx.id)}`,{method:"PUT",body:JSON.stringify({seasonId:currentSeason(),cropId:currentCrop(),changes:{[fieldName]:value}})}); await loadDetail(currentProjectId(),currentSeason(),currentCrop());
  }
  async function editActivity(id){
    const row=currentRows.find(x=>x.id===id); if(!row)return; const fields=row.editableFields||[]; const f=prompt(`Bagian yang dapat diedit:\n${fields.join(", ")}\n\nKetik nama bagian:`); if(!f)return; const v=prompt(`Nilai baru untuk ${f}:`); if(v===null)return;
    await api(`/api/bertunas/${currentProjectId()}/aktivitas/${encodeURIComponent(row.id)}`,{method:"PUT",body:JSON.stringify({seasonId:currentSeason(),cropId:currentCrop(),changes:{[f]:v}})}); await loadTab();
  }
  async function editSchedule(id){
    const row=currentRows.find(x=>x.id===id); if(!row)return; const fields=row.editableFields||[]; const f=prompt(`Bagian yang dapat diedit:\n${fields.join(", ")}\n\nKetik nama bagian:`); if(!f)return; const v=prompt(`Nilai baru untuk ${f}:`); if(v===null)return;
    await api(`/api/bertunas/${currentProjectId()}/jadwal/${encodeURIComponent(row.id)}`,{method:"PUT",body:JSON.stringify({seasonId:currentSeason(),cropId:currentCrop(),changes:{[f]:v}})}); await loadDetail(currentProjectId(),currentSeason(),currentCrop());
  }
  async function del(kind,id){ if(!confirm("Hapus data ini ke arsip?"))return; await api(`/api/bertunas/${currentProjectId()}/${kind}/${encodeURIComponent(id)}`,{method:"DELETE",body:JSON.stringify({seasonId:currentSeason(),cropId:currentCrop()})}); await loadDetail(currentProjectId(),currentSeason(),currentCrop()); }
  async function scheduleAction(action,id){ const body={seasonId:currentSeason(),cropId:currentCrop()}; if(action==="selesai") body.date=prompt("Tanggal pelaksanaan (YYYY-MM-DD):",today())||today(); await api(`/api/bertunas/${currentProjectId()}/jadwal/${encodeURIComponent(id)}/${action}`,{method:"POST",body:JSON.stringify(body)}); await loadDetail(currentProjectId(),currentSeason(),currentCrop()); }

  $("bt-project").addEventListener("change",()=>loadDetail(currentProjectId()).catch(e=>status(e.message,"error")));
  $("bt-season").addEventListener("change",()=>{fillCrops();loadDetail(currentProjectId(),currentSeason(),currentCrop()).catch(e=>status(e.message,"error"));});
  $("bt-crop").addEventListener("change",()=>loadDetail(currentProjectId(),currentSeason(),currentCrop()).catch(e=>status(e.message,"error")));
  document.querySelectorAll("[data-create]").forEach(b=>b.addEventListener("click",()=>openCreate(b.dataset.create)));
  document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.remove("active"));b.classList.add("active");activeTab=b.dataset.tab;loadTab().catch(e=>status(e.message,"error"));}));
  $("bt-close").addEventListener("click",()=>$("bt-dialog").close()); $("bt-form").addEventListener("submit",submitCreate);
  $("bt-list").addEventListener("click",async e=>{const b=e.target.closest("button");if(!b)return;try{if(b.dataset.editTx)await editTransaction(b.dataset.editTx);if(b.dataset.deleteTx)await del("transaksi",b.dataset.deleteTx);if(b.dataset.editActivity)await editActivity(b.dataset.editActivity);if(b.dataset.deleteActivity)await del("aktivitas",b.dataset.deleteActivity);if(b.dataset.editSchedule)await editSchedule(b.dataset.editSchedule);if(b.dataset.deleteSchedule)await del("jadwal",b.dataset.deleteSchedule);if(b.dataset.scheduleDone)await scheduleAction("selesai",b.dataset.scheduleDone);if(b.dataset.scheduleSkip)await scheduleAction("lewati",b.dataset.scheduleSkip);if(b.dataset.scheduleActive)await scheduleAction("aktifkan",b.dataset.scheduleActive);}catch(err){alert(err.message);}});
  init();
})();
