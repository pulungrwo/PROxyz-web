(() => {
  "use strict";
  const config = window.PROXYZ_ADMIN_CONFIG || {};
  const API = String(config.apiBase || "").replace(/\/$/, "");
  const ALL_CROPS = "__all__";
  const SHARED_CROP = "__shared__";
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

  function selectedCropValue(){ return $("bt-crop").value || ALL_CROPS; }
  function isAllCrops(){ return selectedCropValue() === ALL_CROPS; }
  function currentProjectId(){ return $("bt-project").value || projects[0]?.id || ""; }
  function currentSeason(){ return $("bt-season").value || detail?.activeSeasonId || ""; }
  function currentCrop(){ return isAllCrops() ? "" : selectedCropValue(); }
  function currentSeasonData(){ return (detail?.seasons||[]).find(s=>s.id===currentSeason()) || null; }
  function currentCrops(){ return currentSeasonData()?.crops || []; }
  function fallbackCropId(){ return currentCrops().find(c=>c.status!=="selesai")?.id || currentCrops()[0]?.id || detail?.activeCropId || ""; }
  function today(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}

  function qscope() {
    const params = new URLSearchParams();
    if (currentSeason()) params.set("season", currentSeason());
    if (isAllCrops()) params.set("allCrops", "1");
    else {
      params.set("crop", currentCrop());
      params.set("scope", "crop");
    }
    return params.toString();
  }

  async function init(){
    if(!API) return status("Alamat API Admin belum dikonfigurasi.","error");
    status("Memeriksa sesi…");
    try {
      await api("/api/me");
      const data=await api("/api/bertunas"); projects=data.bertunas||[];
      if(!projects.length){status("Belum ada Bertunas yang dapat Anda kelola.","error"); return;}
      $("bt-project").replaceChildren(...projects.map(p=>new Option(`Bertunas ${p.id} · ${p.nama}`,p.id)));
      $("bt-app").hidden=false; status("");
      await loadDetail(projects[0].id, "", ALL_CROPS);
    } catch(e){status(e.message,"error");}
  }

  function fillScopes(preferredSeason="",preferredCrop=ALL_CROPS){
    const seasons=detail?.seasons||[];
    $("bt-season").replaceChildren(...seasons.map(s=>new Option(`${s.nama} · ${s.status}`,s.id)));
    const seasonId=preferredSeason||detail?.activeSeasonId||seasons[0]?.id||"";
    if(seasonId) $("bt-season").value=seasonId;
    fillCrops(preferredCrop || ALL_CROPS);
  }

  function fillCrops(preferred=ALL_CROPS){
    const season=(detail?.seasons||[]).find(s=>s.id===$("bt-season").value) || detail?.seasons?.[0];
    const crops=season?.crops||[];
    const options=[new Option(`Semua Tanaman · ${crops.length}`, ALL_CROPS), ...crops.map(c=>new Option(`${c.komoditas} · ${c.id}`,c.id))];
    $("bt-crop").replaceChildren(...options);
    const target = preferred===ALL_CROPS ? ALL_CROPS : (crops.some(c=>c.id===preferred) ? preferred : ALL_CROPS);
    $("bt-crop").value=target;
    renderScopeNote();
  }

  function renderScopeNote(){
    const note=$("bt-scope-note");
    if(!note)return;
    if(isAllCrops()) {
      note.textContent=`Menampilkan gabungan ${currentCrops().length} tanaman pada ${currentSeasonData()?.nama || "Musim Tanam ini"}. Pilih tanaman hanya jika ingin memfilter data.`;
    } else {
      const crop=currentCrops().find(c=>c.id===currentCrop());
      note.textContent=`Filter aktif: ${crop?.komoditas || "Tanaman"} · ${crop?.id || currentCrop()}.`;
    }
  }

  async function loadDetail(id, season="", crop=ALL_CROPS){
    status("Memuat Bertunas…");
    const qs=new URLSearchParams();
    if(season) qs.set("season",season);
    if(!crop || crop===ALL_CROPS) qs.set("allCrops","1"); else qs.set("crop",crop);
    const data=await api(`/api/bertunas/${encodeURIComponent(id)}?${qs}`);
    detail=data.bertunas;
    fillScopes(season || detail?.activeSeasonId || "", crop || ALL_CROPS);
    $("bt-name").textContent=`Bertunas ${detail.id} · ${detail.nama}`;
    $("bt-meta").textContent=[detail.lokasi,detail.luas].filter(Boolean).join(" · ")||"Lahan pertanian";
    $("bt-role").textContent=detail.role;
    renderSummary(); renderScopeNote(); status("");
    await loadTab();
  }

  function renderSummary(){
    const seasonSummary=detail?.summary||{};
    const cropSummary=detail?.cropSummary||{};
    const schedule=detail?.scheduleSummary||{};
    let cards;
    if(isAllCrops()) {
      const activeCrops=currentCrops().filter(c=>c.status!=="selesai").length;
      cards=[
        ["Total biaya",rupiah.format(seasonSummary.expense||0)],
        ["Total panen",kg(seasonSummary.weightKg||0)],
        ["Total omzet",rupiah.format(seasonSummary.revenue||0)],
        ["Laba berjalan",rupiah.format(seasonSummary.profit||0)],
        ["Tanaman aktif",String(activeCrops)],
        ["Jadwal menunggu",String(schedule.pending||0)],
        ["Jadwal terlambat",String(schedule.overdue||0)],
        ["Jadwal hari ini",String(schedule.dueToday||0)]
      ];
    } else {
      cards=[
        ["Biaya tanaman",rupiah.format(cropSummary.expense||0)],
        ["Panen tanaman",kg(cropSummary.weightKg||0)],
        ["Omzet tanaman",rupiah.format(cropSummary.harvestRevenue||0)],
        ["Laba tanaman",rupiah.format(cropSummary.profitBeforeShared||0)],
        ["Jumlah panen",String(cropSummary.harvestCount||0)],
        ["Jadwal menunggu",String(schedule.pending||0)],
        ["Jadwal terlambat",String(schedule.overdue||0)],
        ["Jadwal hari ini",String(schedule.dueToday||0)]
      ];
    }
    $("bt-summary").innerHTML=cards.map(([a,b])=>`<article class="bt-card"><span>${esc(a)}</span><strong>${esc(b)}</strong></article>`).join("");
  }

  async function loadTab(){
    const id=currentProjectId(); if(!id)return;
    let data;
    const scope=qscope();
    if(activeTab==="transactions") data=await api(`/api/bertunas/${encodeURIComponent(id)}/transaksi?${scope}`), currentRows=data.transaksi||[];
    if(activeTab==="activities") data=await api(`/api/bertunas/${encodeURIComponent(id)}/aktivitas?${scope}`), currentRows=data.aktivitas||[];
    if(activeTab==="schedules") data=await api(`/api/bertunas/${encodeURIComponent(id)}/jadwal?${scope}`), currentRows=data.jadwal||[];
    renderList();
  }

  function cropTag(row){
    const label=row.cropName || (row.cropId ? `Tanaman ${row.cropId}` : "Umum / Lahan");
    return `<span class="bt-crop-tag">${esc(label)}</span>`;
  }

  function renderList(){
    if(!currentRows.length){$("bt-list").innerHTML='<div class="bt-empty">Belum ada data.</div>';return;}
    if(activeTab==="transactions") $("bt-list").innerHTML=currentRows.map(tx=>{
      const type={expense:"Biaya",harvest:"Panen",capital:"Modal",income:"Pemasukan"}[tx.type]||tx.type;
      const title=tx.type==="harvest"?`${kg(tx.weightKg)} · ${rupiah.format(tx.amount)}`:`${type} · ${rupiah.format(tx.amount)}`;
      return `<article class="bt-item"><div class="bt-item-top"><div>${cropTag(tx)}<h3>${esc(tx.ref)} · ${esc(tx.description||tx.sourceName||type)}</h3><div class="bt-meta">${esc(type)}${tx.category?` · ${esc(tx.category)}`:""} · ${esc(dateFmt(tx.date))}${tx.shared?" · Bersama Musim":""}</div></div><div class="bt-value">${esc(title)}</div></div><div class="bt-item-actions"><button class="ghost" data-edit-tx="${esc(tx.id)}">Edit</button><button class="danger-soft" data-delete-tx="${esc(tx.id)}">Hapus</button></div></article>`;
    }).join("");
    if(activeTab==="activities") $("bt-list").innerHTML=currentRows.map(a=>`<article class="bt-item"><div class="bt-item-top"><div>${cropTag(a)}<h3>${esc(a.ref)} · ${esc(a.description)}</h3><div class="bt-meta">${esc(a.category)} · ${esc(dateFmt(a.date))}${a.hst!==null?` · ${a.hst} HST`:""}</div></div></div><div class="bt-item-actions"><button class="ghost" data-edit-activity="${esc(a.id)}">Edit</button><button class="danger-soft" data-delete-activity="${esc(a.id)}">Hapus</button></div></article>`).join("");
    if(activeTab==="schedules") $("bt-list").innerHTML=currentRows.map(s=>`<article class="bt-item"><div class="bt-item-top"><div>${cropTag(s)}<h3>${esc(s.ref)} · ${esc(s.description)}</h3><div class="bt-meta">${esc(s.category)} · ${esc(s.status)}</div></div><div class="bt-value">${s.targetDate?esc(dateFmt(s.targetDate)):(s.targetHst!==null?`${s.targetHst} HST`:"—")}</div></div><div class="bt-item-actions">${s.status==="pending"?`<button class="primary" data-schedule-done="${esc(s.id)}">Selesai</button><button class="ghost" data-schedule-skip="${esc(s.id)}">Lewati</button><button class="ghost" data-edit-schedule="${esc(s.id)}">Edit</button><button class="danger-soft" data-delete-schedule="${esc(s.id)}">Hapus</button>`:s.status==="skipped"?`<button class="ghost" data-schedule-active="${esc(s.id)}">Aktifkan</button>`:""}</div></article>`).join("");
  }

  function field(label,html){return `<label>${esc(label)}${html}</label>`;}
  function input(name,type="text",value="",attrs=""){return `<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}>`;}
  function select(name,values){return `<select name="${name}">${values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("")}</select>`;}
  function selectRows(name,rows){return `<select name="${name}">${rows.map(r=>`<option value="${esc(r.value)}">${esc(r.label)}</option>`).join("")}</select>`;}
  function targetCropField({allowShared=false}={}){
    if(!isAllCrops()) return "";
    const rows=[{value:"",label:allowShared?"Pilih tanaman atau Umum / Lahan":"Pilih tanaman"}];
    if(allowShared) rows.push({value:SHARED_CROP,label:"Umum / Lahan · biaya bersama musim"});
    for(const crop of currentCrops()) rows.push({value:crop.id,label:`${crop.komoditas} · ${crop.id}`});
    return field("Tanaman",selectRows("targetCropId",rows).replace("<select ","<select required "));
  }

  function openCreate(mode){
    formMode=mode; formStatus("");
    if(isAllCrops() && !currentCrops().length) return alert("Musim Tanam ini belum memiliki tanaman.");
    const categories=detail?.activityCategories||[]; const expenses=detail?.expenseCategories||[];
    let title=""; let html="";
    if(mode==="expense"){
      title="Tambah biaya";
      html=targetCropField({allowShared:true})+field("Nominal",input("amount","number","","min=1 required"))+field("Kategori",select("category",expenses))+field("Keterangan",input("description","text","","maxlength=80 required"))+field("Catatan",input("note"))+field("Tanggal",input("date","date",today(),"required"));
      if(!isAllCrops()) html+=`<label class="bt-check"><input name="shared" type="checkbox"> Biaya bersama Musim Tanam</label>`;
    }
    if(mode==="harvest"){title="Tambah panen";html=targetCropField()+field("Berat (kg)",input("weight","number","","min=0.01 step=0.01 required"))+field("Total harga",input("amount","number","","min=1 required"))+field("Keterangan",input("description","text","Panen"))+field("Catatan",input("note"))+field("Tanggal",input("date","date",today(),"required"));}
    if(mode==="activity"){title="Tambah aktivitas";html=targetCropField()+field("Kategori",select("category",categories))+field("Kegiatan",input("description","text","","maxlength=80 required"))+field("Catatan",input("note"))+field("Tanggal",input("date","date",today(),"required"))+field("Referensi biaya (opsional)",input("expenseRef","text","","placeholder='#3'"));}
    if(mode==="schedule"){title="Tambah jadwal";html=targetCropField()+field("Kategori",select("category",categories))+field("Kegiatan",input("description","text","","maxlength=80 required"))+field("Target",input("target","text","","placeholder='20 HST atau 30-08-2026' required"))+field("Catatan",input("note"));}
    if(mode==="planting"){
      title="Atur tanggal tanam";
      const cropId=isAllCrops()?"":currentCrop();
      const planting=cropId ? (currentCrops().find(c=>c.id===cropId)?.plantingDate||today()) : today();
      html=targetCropField()+field("Tanggal tanam",input("date","date",planting,"required"));
    }
    $("bt-form-title").textContent=title; $("bt-form-mode").textContent=`Bertunas ${currentProjectId()}`; $("bt-fields").innerHTML=html; $("bt-dialog").showModal();
  }

  function resolveFormCrop(body, fd){
    if(!isAllCrops()) {
      body.cropId=currentCrop();
      body.shared=fd.get("shared")==="on";
      return;
    }
    const target=String(body.targetCropId||"");
    if(!target) throw new Error("Pilih tanaman atau Umum / Lahan terlebih dahulu.");
    if(target===SHARED_CROP){
      body.shared=true;
      body.cropId=fallbackCropId();
    } else {
      body.cropId=target || fallbackCropId();
      body.shared=false;
    }
    delete body.targetCropId;
  }

  async function submitCreate(event){
    event.preventDefault(); const fd=new FormData(event.currentTarget); const body=Object.fromEntries(fd.entries()); body.seasonId=currentSeason(); resolveFormCrop(body,fd); formStatus("Menyimpan…");
    try{
      const id=currentProjectId();
      if(!body.cropId && formMode!=="expense") throw new Error("Pilih tanaman terlebih dahulu.");
      if(formMode==="expense") await api(`/api/bertunas/${id}/biaya`,{method:"POST",body:JSON.stringify(body)});
      if(formMode==="harvest") await api(`/api/bertunas/${id}/panen`,{method:"POST",body:JSON.stringify(body)});
      if(formMode==="activity") await api(`/api/bertunas/${id}/aktivitas`,{method:"POST",body:JSON.stringify(body)});
      if(formMode==="schedule") await api(`/api/bertunas/${id}/jadwal`,{method:"POST",body:JSON.stringify(body)});
      if(formMode==="planting") await api(`/api/bertunas/${id}/tanam`,{method:"POST",body:JSON.stringify(body)});
      $("bt-dialog").close(); await loadDetail(id,currentSeason(),selectedCropValue());
    }catch(e){formStatus(e.message,"error");}
  }

  async function editTransaction(id){
    const tx=currentRows.find(x=>x.id===id); if(!tx)return;
    const fields=tx.editableFields||[]; const fieldName=prompt(`Bagian yang dapat diedit:\n${fields.join(", ")}\n\nKetik nama bagian:`); if(!fieldName)return;
    if(!fields.includes(fieldName.toLowerCase())) return alert("Bagian tidak dapat diedit untuk transaksi ini.");
    const current={nominal:tx.amount,total:tx.amount,berat:tx.weightKg,kategori:tx.category,keterangan:tx.description,catatan:tx.note,tanggal:tx.date,sumber:tx.sourceName}[fieldName.toLowerCase()]??"";
    const value=prompt(`Nilai baru untuk ${fieldName}:`,current); if(value===null)return;
    await api(`/api/bertunas/${currentProjectId()}/transaksi/${encodeURIComponent(tx.id)}`,{method:"PUT",body:JSON.stringify({seasonId:currentSeason(),cropId:tx.cropId||"",changes:{[fieldName]:value}})}); await loadDetail(currentProjectId(),currentSeason(),selectedCropValue());
  }
  async function editActivity(id){
    const row=currentRows.find(x=>x.id===id); if(!row)return; const fields=row.editableFields||[]; const f=prompt(`Bagian yang dapat diedit:\n${fields.join(", ")}\n\nKetik nama bagian:`); if(!f)return; const v=prompt(`Nilai baru untuk ${f}:`); if(v===null)return;
    await api(`/api/bertunas/${currentProjectId()}/aktivitas/${encodeURIComponent(row.id)}`,{method:"PUT",body:JSON.stringify({seasonId:currentSeason(),cropId:row.cropId||"",changes:{[f]:v}})}); await loadDetail(currentProjectId(),currentSeason(),selectedCropValue());
  }
  async function editSchedule(id){
    const row=currentRows.find(x=>x.id===id); if(!row)return; const fields=row.editableFields||[]; const f=prompt(`Bagian yang dapat diedit:\n${fields.join(", ")}\n\nKetik nama bagian:`); if(!f)return; const v=prompt(`Nilai baru untuk ${f}:`); if(v===null)return;
    await api(`/api/bertunas/${currentProjectId()}/jadwal/${encodeURIComponent(row.id)}`,{method:"PUT",body:JSON.stringify({seasonId:currentSeason(),cropId:row.cropId||"",changes:{[f]:v}})}); await loadDetail(currentProjectId(),currentSeason(),selectedCropValue());
  }
  async function del(kind,id){
    if(!confirm("Hapus data ini ke arsip?"))return;
    const row=currentRows.find(x=>x.id===id);
    await api(`/api/bertunas/${currentProjectId()}/${kind}/${encodeURIComponent(id)}`,{method:"DELETE",body:JSON.stringify({seasonId:currentSeason(),cropId:row?.cropId||""})});
    await loadDetail(currentProjectId(),currentSeason(),selectedCropValue());
  }
  async function scheduleAction(action,id){
    const row=currentRows.find(x=>x.id===id);
    const body={seasonId:currentSeason(),cropId:row?.cropId||""};
    if(action==="selesai") body.date=prompt("Tanggal pelaksanaan (YYYY-MM-DD):",today())||today();
    await api(`/api/bertunas/${currentProjectId()}/jadwal/${encodeURIComponent(id)}/${action}`,{method:"POST",body:JSON.stringify(body)});
    await loadDetail(currentProjectId(),currentSeason(),selectedCropValue());
  }

  $("bt-project").addEventListener("change",()=>loadDetail(currentProjectId(),"",ALL_CROPS).catch(e=>status(e.message,"error")));
  $("bt-season").addEventListener("change",()=>loadDetail(currentProjectId(),currentSeason(),ALL_CROPS).catch(e=>status(e.message,"error")));
  $("bt-crop").addEventListener("change",()=>loadDetail(currentProjectId(),currentSeason(),selectedCropValue()).catch(e=>status(e.message,"error")));
  document.querySelectorAll("[data-create]").forEach(b=>b.addEventListener("click",()=>openCreate(b.dataset.create)));
  document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.remove("active"));b.classList.add("active");activeTab=b.dataset.tab;loadTab().catch(e=>status(e.message,"error"));}));
  $("bt-close").addEventListener("click",()=>$("bt-dialog").close()); $("bt-form").addEventListener("submit",submitCreate);
  $("bt-list").addEventListener("click",async e=>{const b=e.target.closest("button");if(!b)return;try{if(b.dataset.editTx)await editTransaction(b.dataset.editTx);if(b.dataset.deleteTx)await del("transaksi",b.dataset.deleteTx);if(b.dataset.editActivity)await editActivity(b.dataset.editActivity);if(b.dataset.deleteActivity)await del("aktivitas",b.dataset.deleteActivity);if(b.dataset.editSchedule)await editSchedule(b.dataset.editSchedule);if(b.dataset.deleteSchedule)await del("jadwal",b.dataset.deleteSchedule);if(b.dataset.scheduleDone)await scheduleAction("selesai",b.dataset.scheduleDone);if(b.dataset.scheduleSkip)await scheduleAction("lewati",b.dataset.scheduleSkip);if(b.dataset.scheduleActive)await scheduleAction("aktifkan",b.dataset.scheduleActive);}catch(err){alert(err.message);}});
  init();
})();
