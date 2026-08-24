(() => {
  "use strict";
  const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
  const kg = value => `${Number(value || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })} kg`;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const fmtDate = value => { if (!value) return "—"; const d = new Date(`${value}T00:00:00`); return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat("id-ID", { day:"2-digit", month:"short", year:"numeric" }).format(d); };
  const empty = text => `<div class="empty">${esc(text)}</div>`;

  async function loadJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Data tidak tersedia (${res.status}).`);
    return res.json();
  }

  function renderCards(data) {
    const cards = [];
    if (data.totalProjects !== undefined) {
      cards.push(["Bertunas", Number(data.totalProjects || 0).toLocaleString("id-ID")]);
      cards.push(["Total panen", kg(data.totalWeightKg)]);
      cards.push(["Petikan/panen", Number(data.totalHarvestCount || 0).toLocaleString("id-ID")]);
      cards.push(["Komoditas", Number(data.commodities?.length || 0).toLocaleString("id-ID")]);
    } else {
      cards.push(["Total panen", kg(data.summary?.weightKg)]);
      cards.push(["Jumlah panen", Number(data.summary?.harvestCount || 0).toLocaleString("id-ID")]);
      cards.push(["Aktivitas", Number(data.summary?.activityCount || 0).toLocaleString("id-ID")]);
      cards.push(["Jadwal menunggu", Number(data.summary?.pendingScheduleCount || 0).toLocaleString("id-ID")]);
      if (data.financeVisible) {
        cards.push(["Omzet", rupiah.format(data.summary?.revenue || 0)]);
        cards.push(["Biaya", rupiah.format(data.summary?.expense || 0)]);
        cards.push(["Laba berjalan", rupiah.format(data.summary?.profit || 0)]);
      }
    }
    $("summary").innerHTML = cards.map(([a,b]) => `<article class="card"><span>${esc(a)}</span><strong>${esc(b)}</strong></article>`).join("");
  }

  async function renderIndex() {
    const data = await loadJson("../data/bertunas/index.json");
    renderCards(data);
    $("commodities").innerHTML = data.commodities?.length ? data.commodities.map(c => `<div class="row"><div><strong>${esc(c.komoditas)}</strong><small>${c.harvestCount} panen · ${c.projectCount} Bertunas</small></div><div class="amount"><strong>${esc(kg(c.weightKg))}</strong></div></div>`).join("") : empty("Belum ada data panen.");
    $("projects").innerHTML = data.projects?.length ? data.projects.map(p => `<a class="project" href="./${encodeURIComponent(p.id)}/"><h3>Bertunas ${esc(p.id)} · ${esc(p.nama)}</h3><div class="meta">${esc(p.season?.nama || "Musim aktif")}${p.lokasi ? ` · ${esc(p.lokasi)}` : ""}</div><span class="badge">${esc(kg(p.weightKg))} panen</span></a>`).join("") : empty("Belum ada Bertunas yang dipublikasikan.");
  }

  function renderDetail(data) {
    renderCards(data);
    $("title").textContent = `Bertunas ${data.id} · ${data.nama}`;
    $("meta").textContent = [data.lokasi, data.luas].filter(Boolean).join(" · ") || "Lahan pertanian";
    $("season").textContent = `${data.season?.nama || "Musim"} · ${data.season?.status || ""}`;
    $("crops").innerHTML = data.crops?.length ? data.crops.map(c => `<article class="crop"><h3>${esc(c.komoditas)}</h3><div class="meta">${c.plantingDate ? `Tanam ${esc(fmtDate(c.plantingDate))}` : "Tanggal tanam belum diatur"}</div><span class="badge">${esc(kg(c.weightKg))} · ${c.harvestCount} panen</span>${data.financeVisible ? `<div class="meta" style="margin-top:8px">Omzet ${esc(rupiah.format(c.revenue||0))} · Biaya ${esc(rupiah.format(c.expense||0))}</div>` : ""}</article>`).join("") : empty("Belum ada tanaman.");
    $("harvest").innerHTML = data.recentHarvest?.length ? data.recentHarvest.map(h => `<div class="row"><div><strong>${esc(h.komoditas)} · ${esc(kg(h.weightKg))}</strong><small>${esc(fmtDate(h.date))}${h.note ? ` · ${esc(h.note)}` : ""}</small></div>${data.financeVisible ? `<div class="amount"><strong>${esc(rupiah.format(h.amount||0))}</strong></div>` : ""}</div>`).join("") : empty("Belum ada panen.");
    $("activities").innerHTML = data.recentActivities?.length ? data.recentActivities.map(a => `<div class="row"><div><strong>${esc(a.description)}</strong><small>${esc(a.komoditas)} · ${esc(a.category)} · ${esc(fmtDate(a.date))}${a.hst !== null ? ` · ${a.hst} HST` : ""}</small></div></div>`).join("") : empty("Belum ada aktivitas budidaya.");
    $("schedules").innerHTML = data.schedules?.length ? data.schedules.map(s => `<div class="row"><div><strong>#${s.nomor} · ${esc(s.description)}</strong><small>${esc(s.komoditas)} · ${esc(s.category)}</small></div><div class="amount"><strong>${s.targetDate ? esc(fmtDate(s.targetDate)) : (s.targetHst !== null ? `${s.targetHst} HST` : "—")}</strong></div></div>`).join("") : empty("Tidak ada jadwal menunggu.");
  }

  async function init() {
    try {
      if (document.body.dataset.bertunasIndex) return await renderIndex();
      const id = document.body.dataset.bertunasId;
      const data = await loadJson(`../../data/bertunas/${encodeURIComponent(id)}.json`);
      renderDetail(data);
    } catch (error) {
      document.querySelector(".shell").insertAdjacentHTML("beforeend", `<div class="panel empty">${esc(error.message)}</div>`);
    }
  }
  init();
})();
