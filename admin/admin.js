(() => {
  "use strict";

  const config = window.PROXYZ_ADMIN_CONFIG || {};
  const API = String(config.apiBase || "").replace(/\/$/, "");
  const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
  const dateFmt = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  const dateTimeFmt = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const $ = id => document.getElementById(id);
  const OTP_STORAGE_KEY = "proxyz_admin_otp_challenge";

  let me = null;
  let challengeId = "";
  let challengeExpiresAt = 0;
  let activeView = "";

  // Kas
  let activeKas = "";
  let activeKasDetail = null;
  let kasRows = [];
  let kasTotal = 0;
  const kasPage = 50;

  // Bertunas
  let activeBertunas = "";
  let btDetail = null;
  let btTransactions = [];
  let btActivities = [];
  let btSchedules = [];
  let btFormState = null;
  let btCropScope = "__all__";

  // Galeri
  let activeGallery = "";
  let galleryDetail = null;
  let galleryPhotos = [];
  let galleryPhotoTotal = 0;
  const galleryPage = 48;

  function setStatus(el, message = "", type = "") {
    if (!el) return;
    el.textContent = message;
    el.className = `status ${type}`.trim();
  }

  async function api(path, options = {}) {
    if (!API) throw new Error("Alamat API Admin belum dikonfigurasi.");
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    let response;
    try {
      response = await fetch(`${API}${path}`, { ...options, headers, credentials: "include", cache: "no-store" });
    } catch (_) {
      throw new Error("API PROxyz belum dapat dihubungi. Pastikan bot dan tunnel aktif.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && !path.includes("/auth/")) clearSession();
      throw new Error(data.error || `Permintaan gagal (${response.status}).`);
    }
    return data;
  }

  function clearSession() {
    me = null;
    $("app-view").hidden = true;
    $("login-view").hidden = false;
  }

  function todayJakarta() {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  function dateToTimestamp(value) {
    return new Date(`${value}T12:00:00+07:00`).getTime();
  }

  function timestampToDate(value) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Number(value) || Date.now()));
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  function parseTags(value) {
    return [...new Set(String(value || "").split(/\s+/).map(x => x.replace(/^#/, "").trim().toLowerCase()).filter(Boolean))];
  }

  function escapeText(value) {
    return String(value ?? "");
  }

  function emptyBox(text) {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = text;
    return div;
  }

  function button(text, className, onClick) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = className;
    el.textContent = text;
    el.addEventListener("click", onClick);
    return el;
  }

  function clearOtpChallenge() {
    challengeId = "";
    challengeExpiresAt = 0;
    try { sessionStorage.removeItem(OTP_STORAGE_KEY); } catch (_) {}
    $("otp-form").hidden = true;
    $("phone-form").hidden = false;
  }

  function saveOtpChallenge(phone) {
    try {
      sessionStorage.setItem(OTP_STORAGE_KEY, JSON.stringify({ challengeId, expiresAt: challengeExpiresAt, phone: String(phone || "") }));
    } catch (_) {}
  }

  function restoreOtpChallenge() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(OTP_STORAGE_KEY) || "null");
      if (!saved?.challengeId || Number(saved.expiresAt) <= Date.now()) return false;
      challengeId = String(saved.challengeId);
      challengeExpiresAt = Number(saved.expiresAt);
      if (saved.phone) $("phone").value = saved.phone;
      $("phone-form").hidden = true;
      $("otp-form").hidden = false;
      return true;
    } catch (_) { return false; }
  }

  async function bootstrapSession() {
    try {
      const data = await api("/api/me");
      me = data.user;
      renderMe();
    } catch (_) {
      clearSession();
      setStatus($("auth-status"));
    }
  }

  function renderMe() {
    $("login-view").hidden = true;
    $("app-view").hidden = false;
    $("welcome").textContent = `+${me.phone}`;

    const counts = [
      (me.kas || []).length ? `${me.kas.length} Kas` : "",
      (me.bertunas || []).length ? `${me.bertunas.length} Bertunas` : "",
      (me.galeri || []).length ? `${me.galeri.length} Galeri` : ""
    ].filter(Boolean);
    $("access-summary").textContent = counts.join(" · ") || "Tidak ada akses aplikasi.";

    const availability = {
      kas: (me.kas || []).length > 0,
      bertunas: (me.bertunas || []).length > 0,
      galeri: (me.galeri || []).length > 0
    };
    for (const [name, available] of Object.entries(availability)) $("tab-" + name).hidden = !available;

    fillSelect($("kas-select"), me.kas || [], row => `${row.nama} · ${row.role}`);
    fillSelect($("bertunas-select"), me.bertunas || [], row => `${row.nama} · ${row.role}`);
    fillSelect($("gallery-select"), me.galeri || [], row => `${row.nama} · ${row.role}`);

    const first = ["kas", "bertunas", "galeri"].find(name => availability[name]);
    if (first) switchView(first);
  }

  function fillSelect(select, rows, labeler) {
    select.replaceChildren();
    for (const row of rows) {
      const option = document.createElement("option");
      option.value = row.id;
      option.textContent = labeler(row);
      select.appendChild(option);
    }
  }

  function switchView(view) {
    activeView = view;
    for (const name of ["kas", "bertunas", "galeri"]) {
      $(`${name}-view`).hidden = name !== view;
      $("tab-" + name).classList.toggle("active", name === view);
    }
    if (view === "kas" && !activeKas && me.kas?.length) loadKas(me.kas[0].id).catch(showError);
    if (view === "bertunas" && !activeBertunas && me.bertunas?.length) loadBertunas(me.bertunas[0].id).catch(showError);
    if (view === "galeri" && !activeGallery && me.galeri?.length) loadGallery(me.galeri[0].id).catch(showError);
  }

  function showError(error) { alert(error?.message || String(error)); }

  // ---------- KAS ----------
  async function loadKas(id) {
    activeKas = id;
    $("kas-select").value = id;
    const data = await api(`/api/kas/${encodeURIComponent(id)}`);
    activeKasDetail = data.kas;
    $("kas-name").textContent = data.kas.nama;
    $("kas-balance").textContent = rupiah.format(data.kas.saldo.akhir || 0);
    $("kas-in").textContent = rupiah.format(data.kas.saldo.masuk || 0);
    $("kas-out").textContent = rupiah.format(data.kas.saldo.keluar || 0);
    $("kas-content").hidden = false;
    await loadKasTransactions(true);
  }

  async function loadKasTransactions(reset = false) {
    if (!activeKas) return;
    const offset = reset ? 0 : kasRows.length;
    const search = $("search").value.trim();
    const data = await api(`/api/kas/${encodeURIComponent(activeKas)}/transaksi?limit=${kasPage}&offset=${offset}&search=${encodeURIComponent(search)}`);
    kasTotal = data.total;
    kasRows = reset ? data.transaksi : kasRows.concat(data.transaksi);
    renderKasTransactions();
  }

  function renderKasTransactions() {
    const list = $("tx-list");
    list.replaceChildren();
    if (!kasRows.length) list.appendChild(emptyBox("Belum ada transaksi."));
    for (const tx of kasRows) {
      const card = document.createElement("article"); card.className = "item-card";
      const top = document.createElement("div"); top.className = "item-top";
      const left = document.createElement("div");
      const title = document.createElement("h3"); title.textContent = `${tx.nomor} · ${tx.keterangan}`;
      const meta = document.createElement("div"); meta.className = "item-meta"; meta.textContent = `${dateFmt.format(new Date(tx.tanggal))} · ${tx.kategori}`;
      left.append(title, meta);
      const amount = document.createElement("div"); amount.className = `amount ${tx.jenis === "masuk" ? "in" : "out"}`; amount.textContent = `${tx.jenis === "masuk" ? "+" : "−"}${rupiah.format(tx.nominal)}`;
      top.append(left, amount); card.appendChild(top);
      if (tx.catatan) { const note = document.createElement("div"); note.className = "item-meta"; note.style.marginTop = "6px"; note.textContent = tx.catatan; card.appendChild(note); }
      for (const tag of tx.label || []) { const span = document.createElement("span"); span.className = "tag"; span.textContent = `#${tag}`; card.appendChild(span); }
      const actions = document.createElement("div"); actions.className = "item-actions";
      actions.append(button("Edit", "ghost", () => openKasEdit(tx)), button("Hapus", "danger-soft", () => deleteKasTx(tx)));
      card.appendChild(actions); list.appendChild(card);
    }
    $("load-more").hidden = kasRows.length >= kasTotal;
  }

  function updateKasCategories() {
    const type = $("tx-type").value;
    const categories = activeKasDetail?.kategori?.[type] || [];
    const current = $("tx-category").value;
    $("tx-category").replaceChildren();
    for (const category of categories) { const opt = document.createElement("option"); opt.value = category; opt.textContent = category.charAt(0).toUpperCase() + category.slice(1); $("tx-category").appendChild(opt); }
    if (categories.includes(current)) $("tx-category").value = current;
  }

  function openKasCreate(type) {
    $("tx-form").reset(); $("tx-ref").value = ""; $("form-mode").textContent = "Transaksi baru"; $("form-title").textContent = type === "masuk" ? "Tambah pemasukan" : "Tambah pengeluaran"; $("tx-type").value = type; $("tx-date").value = todayJakarta(); $("edit-reason-wrap").hidden = true; updateKasCategories(); setStatus($("form-status")); $("tx-dialog").showModal();
  }

  function openKasEdit(tx) {
    $("tx-form").reset(); $("tx-ref").value = tx.nomor; $("form-mode").textContent = `Edit ${tx.nomor}`; $("form-title").textContent = tx.keterangan; $("tx-type").value = tx.jenis; updateKasCategories(); $("tx-category").value = tx.kategori; $("tx-amount").value = tx.nominal; $("tx-description").value = tx.keterangan; $("tx-note").value = tx.catatan || ""; $("tx-tags").value = (tx.label || []).map(x => `#${x}`).join(" "); $("tx-date").value = timestampToDate(tx.tanggal); $("edit-reason-wrap").hidden = false; setStatus($("form-status")); $("tx-dialog").showModal();
  }

  async function deleteKasTx(tx) {
    const reason = prompt(`Hapus transaksi ${tx.nomor} — ${tx.keterangan}?\n\nAlasan:`, "Dihapus melalui Web PROxyz");
    if (reason === null) return;
    if (!reason.trim()) return alert("Alasan hapus wajib diisi.");
    await api(`/api/kas/${encodeURIComponent(activeKas)}/transaksi/${encodeURIComponent(tx.nomor)}`, { method: "DELETE", body: JSON.stringify({ alasan: reason.trim() }) });
    await loadKas(activeKas);
  }

  // ---------- BERTUNAS ----------
  const BT_ALL_CROPS = "__all__";

  function btSelectedSeason() {
    return $("bt-season").value || btDetail?.activeSeasonId || "";
  }

  function btCurrentSeason() {
    const id = btSelectedSeason();
    return (btDetail?.seasons || []).find(row => row.id === id) || btDetail?.seasons?.[0] || null;
  }

  function btCurrentCrop() {
    if (btCropScope === BT_ALL_CROPS) return null;
    return (btCurrentSeason()?.crops || []).find(row => row.id === btCropScope) || null;
  }

  function btIsAllCrops() {
    return btCropScope === BT_ALL_CROPS;
  }

  function btQuery() {
    const q = new URLSearchParams();
    const season = btSelectedSeason();
    if (season) q.set("season", season);
    if (btIsAllCrops()) q.set("allCrops", "1");
    else if (btCropScope) q.set("crop", btCropScope);
    return q.toString();
  }

  function btRowContextBody(row = null) {
    return {
      seasonId: String(row?.seasonId || btSelectedSeason() || ""),
      cropId: row && Object.prototype.hasOwnProperty.call(row, "cropId")
        ? String(row.cropId || "")
        : (btIsAllCrops() ? "" : String(btCropScope || ""))
    };
  }

  function btScopeLabel() {
    const season = btCurrentSeason();
    if (!season) return "Belum ada Musim Tanam";
    const crop = btCurrentCrop();
    return crop
      ? `${crop.komoditas} · Tanaman ${crop.id}`
      : `Semua tanaman · ${season.nama}`;
  }

  async function loadBertunas(id, preserve = false) {
    activeBertunas = id;
    $("bertunas-select").value = id;
    const previousSeason = preserve ? $("bt-season").value : "";
    const previousScope = preserve ? btCropScope : BT_ALL_CROPS;
    const q = new URLSearchParams();
    if (previousSeason) q.set("season", previousSeason);
    if (previousScope === BT_ALL_CROPS) q.set("allCrops", "1");
    else if (previousScope) q.set("crop", previousScope);
    if (!q.has("allCrops") && !q.has("crop")) q.set("allCrops", "1");

    const data = await api(`/api/bertunas/${encodeURIComponent(id)}?${q}`);
    btDetail = data.bertunas;
    btCropScope = previousScope || BT_ALL_CROPS;
    renderBertunasContext();
    await loadBertunasLists();
    $("bertunas-content").hidden = false;
  }

  function renderBertunasContext() {
    $("bt-name").textContent = btDetail.nama;
    $("bt-place").textContent = [btDetail.lokasi, btDetail.luas].filter(Boolean).join(" · ");
    $("bt-role").textContent = btDetail.role;

    const seasonSelect = $("bt-season");
    const wantedSeason = btDetail.activeSeasonId || seasonSelect.value;
    seasonSelect.replaceChildren();
    for (const season of btDetail.seasons || []) {
      const option = document.createElement("option");
      option.value = season.id;
      option.textContent = `${season.nama} · ${season.status}`;
      seasonSelect.appendChild(option);
    }
    seasonSelect.value = wantedSeason || (btDetail.seasons?.[0]?.id || "");

    const season = btCurrentSeason();
    if (btCropScope !== BT_ALL_CROPS && !(season?.crops || []).some(row => row.id === btCropScope)) {
      btCropScope = BT_ALL_CROPS;
    }

    const cropSelect = $("bt-crop");
    cropSelect.replaceChildren();
    const allOption = document.createElement("option");
    allOption.value = BT_ALL_CROPS;
    allOption.textContent = "Semua tanaman";
    cropSelect.appendChild(allOption);
    for (const crop of season?.crops || []) {
      const option = document.createElement("option");
      option.value = crop.id;
      option.textContent = `${crop.komoditas} · ${crop.id}`;
      cropSelect.appendChild(option);
    }
    cropSelect.value = btCropScope;

    const scopeSummary = btIsAllCrops()
      ? (btDetail.summary || {})
      : (btDetail.cropSummary || btCurrentCrop()?.summary || {});
    $("bt-expense").textContent = rupiah.format(scopeSummary.expense || 0);
    $("bt-revenue").textContent = rupiah.format(scopeSummary.revenue ?? scopeSummary.harvestRevenue ?? 0);
    $("bt-profit").textContent = rupiah.format(scopeSummary.profit ?? scopeSummary.profitBeforeShared ?? 0);
    $("bt-weight").textContent = `${number.format(scopeSummary.weightKg || 0)} kg`;
    $("bt-scope-label").textContent = btScopeLabel();
    renderBtCropOverview();
  }

  function makeBtCropCard({ id, title, subtitle, active, summary = {}, scheduleSummary = {}, activityCount = 0, all = false }) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `crop-card${active ? " active" : ""}${all ? " crop-card-all" : ""}`;
    const top = document.createElement("div");
    top.className = "crop-card-top";
    const names = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = title;
    const meta = document.createElement("span");
    meta.textContent = subtitle;
    names.append(name, meta);
    const badge = document.createElement("span");
    badge.className = "crop-status";
    badge.textContent = active ? "Dilihat" : (all ? "Semua" : "Buka");
    top.append(names, badge);

    const stats = document.createElement("div");
    stats.className = "crop-card-stats";
    const s1 = document.createElement("span");
    s1.innerHTML = `<small>Biaya</small><b>${rupiah.format(summary.expense || 0)}</b>`;
    const s2 = document.createElement("span");
    s2.innerHTML = `<small>Hasil</small><b>${rupiah.format(summary.revenue ?? summary.harvestRevenue ?? 0)}</b>`;
    stats.append(s1, s2);

    const foot = document.createElement("div");
    foot.className = "crop-card-foot";
    const pending = Number(scheduleSummary.pending || 0);
    const overdue = Number(scheduleSummary.overdue || 0);
    foot.textContent = all
      ? `${activityCount} tanaman · ${pending} jadwal aktif${overdue ? ` · ${overdue} terlambat` : ""}`
      : `${activityCount} aktivitas · ${pending} jadwal aktif${overdue ? ` · ${overdue} terlambat` : ""}`;

    card.append(top, stats, foot);
    card.addEventListener("click", async () => {
      if (btCropScope === id) return;
      btCropScope = id;
      try { await reloadBertunasForContext(); } catch (error) { showError(error); }
    });
    return card;
  }

  function renderBtCropOverview() {
    const grid = $("bt-crop-grid");
    grid.replaceChildren();
    const season = btCurrentSeason();
    const crops = season?.crops || [];
    const seasonSummary = btDetail.summary || {};
    grid.appendChild(makeBtCropCard({
      id: BT_ALL_CROPS,
      title: "Semua tanaman",
      subtitle: `${crops.length} tanaman · ${season?.nama || "Musim Tanam"}`,
      active: btIsAllCrops(),
      summary: seasonSummary,
      scheduleSummary: btDetail.scheduleSummary || {},
      activityCount: crops.length,
      all: true
    }));
    for (const crop of crops) {
      const planting = crop.plantingDate ? ` · tanam ${crop.plantingDate}` : "";
      grid.appendChild(makeBtCropCard({
        id: crop.id,
        title: crop.komoditas,
        subtitle: `Tanaman ${crop.id} · ${crop.status}${planting}`,
        active: btCropScope === crop.id,
        summary: crop.summary || {},
        scheduleSummary: crop.scheduleSummary || {},
        activityCount: Number(crop.activityCount || 0)
      }));
    }
    if (!crops.length) grid.appendChild(emptyBox("Belum ada tanaman pada Musim Tanam ini."));
  }

  async function reloadBertunasForContext({ resetCrop = false } = {}) {
    if (resetCrop) btCropScope = BT_ALL_CROPS;
    const q = new URLSearchParams();
    const season = $("bt-season").value;
    if (season) q.set("season", season);
    if (btIsAllCrops()) q.set("allCrops", "1");
    else q.set("crop", btCropScope);
    const data = await api(`/api/bertunas/${encodeURIComponent(activeBertunas)}?${q}`);
    btDetail = data.bertunas;
    renderBertunasContext();
    await loadBertunasLists();
  }

  async function loadBertunasLists() {
    const q = btQuery();
    const [tx, act, sch] = await Promise.all([
      api(`/api/bertunas/${encodeURIComponent(activeBertunas)}/transaksi?${q}`),
      api(`/api/bertunas/${encodeURIComponent(activeBertunas)}/aktivitas?${q}`),
      api(`/api/bertunas/${encodeURIComponent(activeBertunas)}/jadwal?${q}`)
    ]);
    btTransactions = tx.transaksi || [];
    btActivities = act.aktivitas || [];
    btSchedules = sch.jadwal || [];
    $("bt-tx-count").textContent = `${btTransactions.length} data`;
    $("bt-activity-count").textContent = `${btActivities.length} aktivitas`;
    $("bt-schedule-count").textContent = `${btSchedules.length} jadwal`;
    renderBtTransactions();
    renderBtActivities();
    renderBtSchedules();
  }

  function renderBtTransactions() {
    const list = $("bt-transactions"); list.replaceChildren();
    if (!btTransactions.length) list.appendChild(emptyBox("Belum ada transaksi pada lingkup ini."));
    for (const row of btTransactions) {
      const card = document.createElement("article"); card.className = "item-card";
      const titleText = row.type === "harvest" ? `${row.ref} · Panen ${number.format(row.weightKg)} kg` : `${row.ref} · ${row.description || row.sourceName || row.category || row.type}`;
      const top = document.createElement("div"); top.className = "item-top";
      const left = document.createElement("div"); const title = document.createElement("h3"); title.textContent = titleText; const meta = document.createElement("div"); meta.className = "item-meta"; meta.textContent = `${row.date || ""} · ${row.cropName || "Umum / Lahan"}`; left.append(title, meta);
      const amount = document.createElement("div"); amount.className = `amount ${row.type === "harvest" || row.type === "income" ? "in" : "out"}`; amount.textContent = rupiah.format(row.amount || 0); top.append(left, amount); card.appendChild(top);
      if (row.note) { const n = document.createElement("div"); n.className = "item-meta"; n.style.marginTop = "6px"; n.textContent = row.note; card.appendChild(n); }
      const actions = document.createElement("div"); actions.className = "item-actions"; actions.append(button("Edit", "ghost", () => openBtEdit("transaksi", row)), button("Hapus", "danger-soft", () => deleteBt("transaksi", row))); card.appendChild(actions); list.appendChild(card);
    }
  }

  function renderBtActivities() {
    const list = $("bt-activities"); list.replaceChildren();
    if (!btActivities.length) list.appendChild(emptyBox("Belum ada aktivitas budidaya."));
    for (const row of btActivities) {
      const card = document.createElement("article"); card.className = "item-card";
      const title = document.createElement("h3"); title.textContent = `${row.ref} · ${row.description}`;
      const meta = document.createElement("div"); meta.className = "item-meta"; meta.textContent = `${row.date || ""}${row.hst === null || row.hst === undefined ? "" : ` · ${row.hst} HST`} · ${row.category} · ${row.cropName || ""}`;
      card.append(title, meta);
      if (row.note) { const n = document.createElement("div"); n.className = "item-meta"; n.style.marginTop = "6px"; n.textContent = row.note; card.appendChild(n); }
      const actions = document.createElement("div"); actions.className = "item-actions"; actions.append(button("Edit", "ghost", () => openBtEdit("aktivitas", row)), button("Hapus", "danger-soft", () => deleteBt("aktivitas", row))); card.appendChild(actions); list.appendChild(card);
    }
  }

  function renderBtSchedules() {
    const list = $("bt-schedules"); list.replaceChildren();
    if (!btSchedules.length) list.appendChild(emptyBox("Belum ada jadwal."));
    for (const row of btSchedules) {
      const card = document.createElement("article"); card.className = "item-card";
      const title = document.createElement("h3"); title.textContent = `${row.ref} · ${row.description}`;
      const meta = document.createElement("div"); meta.className = "item-meta"; meta.textContent = `${row.targetDate || ""} · ${row.category} · ${row.cropName || ""} · ${row.status}`;
      card.append(title, meta);
      if (row.note) { const n = document.createElement("div"); n.className = "item-meta"; n.style.marginTop = "6px"; n.textContent = row.note; card.appendChild(n); }
      const actions = document.createElement("div"); actions.className = "item-actions";
      if (row.status !== "done") actions.append(button("Edit", "ghost", () => openBtEdit("jadwal", row)));
      if (row.status === "pending" || row.status === "late") actions.append(button("Selesai", "success-soft", () => btScheduleAction(row, "selesai")), button("Lewati", "ghost", () => btScheduleAction(row, "lewati")));
      if (row.status === "skipped") actions.append(button("Aktifkan", "success-soft", () => btScheduleAction(row, "aktifkan")));
      if (row.status !== "done") actions.append(button("Hapus", "danger-soft", () => deleteBt("jadwal", row)));
      card.appendChild(actions); list.appendChild(card);
    }
  }

  function fieldHtml(name, label, type = "text", options = []) {
    const wrap = document.createElement("label"); wrap.textContent = label;
    let input;
    if (type === "select") {
      input = document.createElement("select");
      for (const item of options) {
        const value = typeof item === "object" ? item.value : item;
        const labelText = typeof item === "object" ? item.label : item;
        const option = document.createElement("option"); option.value = value; option.textContent = labelText; input.appendChild(option);
      }
    } else if (type === "textarea") { input = document.createElement("textarea"); input.rows = 3; }
    else { input = document.createElement("input"); input.type = type; if (type === "number") input.inputMode = "decimal"; }
    input.id = `bt-field-${name}`; input.dataset.name = name; wrap.appendChild(input); return wrap;
  }

  function btTargetCropOptions(type) {
    const crops = btCurrentSeason()?.crops || [];
    const rows = crops.map(crop => ({ value: crop.id, label: `${crop.komoditas} · Tanaman ${crop.id}` }));
    if (type === "expense") rows.unshift({ value: "__shared__", label: "Umum / Lahan · biaya bersama" });
    return rows;
  }

  function openBtCreate(type) {
    const crops = btCurrentSeason()?.crops || [];
    if (btIsAllCrops() && type !== "expense" && !crops.length) return alert("Belum ada tanaman untuk mencatat data ini.");
    btFormState = { mode: "create", type };
    const fields = $("bt-fields"); fields.replaceChildren();
    const catsA = btDetail.activityCategories || [];
    const catsE = btDetail.expenseCategories || [];
    const add = (...nodes) => nodes.forEach(node => fields.appendChild(node));
    if (btIsAllCrops()) add(fieldHtml("targetCrop", type === "expense" ? "Untuk tanaman / lahan" : "Tanaman", "select", btTargetCropOptions(type)));
    if (type === "expense") { $("bt-form-title").textContent = "Tambah biaya"; add(fieldHtml("amount","Nominal","number"), fieldHtml("category","Kategori","select",catsE), fieldHtml("description","Keterangan"), fieldHtml("note","Catatan","textarea"), fieldHtml("date","Tanggal","date")); }
    if (type === "harvest") { $("bt-form-title").textContent = "Tambah panen"; add(fieldHtml("weight","Berat (kg)","number"), fieldHtml("amount","Total penjualan","number"), fieldHtml("description","Keterangan"), fieldHtml("note","Catatan","textarea"), fieldHtml("date","Tanggal","date")); }
    if (type === "activity") { $("bt-form-title").textContent = "Tambah aktivitas"; add(fieldHtml("category","Kategori","select",catsA), fieldHtml("description","Kegiatan"), fieldHtml("note","Catatan","textarea"), fieldHtml("date","Tanggal","date"), fieldHtml("expenseRef","Nomor biaya terkait (opsional)")); }
    if (type === "schedule") { $("bt-form-title").textContent = "Tambah jadwal"; add(fieldHtml("category","Kategori","select",catsA), fieldHtml("description","Kegiatan"), fieldHtml("target","Target (contoh: 14 HST / 30-08-2026)"), fieldHtml("note","Catatan","textarea")); }
    const date = $("bt-field-date"); if (date) date.value = todayJakarta();
    $("bt-form-mode").textContent = btScopeLabel(); setStatus($("bt-form-status")); $("bt-dialog").showModal();
  }

  function btFieldCurrent(row, field) {
    const f = field.toLowerCase();
    if (["nominal","total"].includes(f)) return row.amount || "";
    if (f === "berat") return row.weightKg || "";
    if (f === "sumber") return row.sourceName || "";
    if (f === "kategori") return row.category || "";
    if (["keterangan","kegiatan","aktivitas"].includes(f)) return row.description || "";
    if (f === "catatan") return row.note || "";
    if (f === "tanggal") return row.date || "";
    if (f === "target") return row.targetDate || (row.targetHst ? `${row.targetHst} HST` : "");
    if (f.includes("biaya")) return row.expenseTransactionId || "";
    return "";
  }

  function openBtEdit(kind, row) {
    const fieldsAllowed = row.editableFields || [];
    if (!fieldsAllowed.length) return alert("Data ini tidak memiliki bagian yang dapat diedit.");
    btFormState = { mode: "edit", type: kind, row };
    $("bt-form-title").textContent = `Edit ${row.ref || "data"}`;
    $("bt-form-mode").textContent = row.cropName || btScopeLabel();
    const fields = $("bt-fields"); fields.replaceChildren();
    const select = fieldHtml("editField", "Bagian", "select", fieldsAllowed); fields.appendChild(select);
    const value = fieldHtml("editValue", "Nilai baru"); fields.appendChild(value);
    const sel = $("bt-field-editField"), input = $("bt-field-editValue");
    const sync = () => { input.value = btFieldCurrent(row, sel.value); };
    sel.addEventListener("change", sync); sync(); setStatus($("bt-form-status")); $("bt-dialog").showModal();
  }

  async function deleteBt(kind, row) {
    if (!confirm(`Hapus ${kind} ${row.ref || ""} dari ${row.cropName || "Bertunas"}?`)) return;
    const endpoint = kind === "transaksi" ? "transaksi" : kind === "aktivitas" ? "aktivitas" : "jadwal";
    await api(`/api/bertunas/${encodeURIComponent(activeBertunas)}/${endpoint}/${encodeURIComponent(row.ref || row.nomor)}`, { method: "DELETE", body: JSON.stringify(btRowContextBody(row)) });
    await reloadBertunasForContext();
  }

  async function btScheduleAction(row, action) {
    if (action === "selesai" && !confirm(`Tandai ${row.ref} selesai hari ini?`)) return;
    await api(`/api/bertunas/${encodeURIComponent(activeBertunas)}/jadwal/${encodeURIComponent(row.ref || row.nomor)}/${action}`, { method: "POST", body: JSON.stringify({ ...btRowContextBody(row), date: "hari ini" }) });
    await reloadBertunasForContext();
  }

  // ---------- GALERI ----------
  async function loadGallery(id) {
    activeGallery = id; $("gallery-select").value = id;
    const data = await api(`/api/galeri/${encodeURIComponent(id)}`);
    galleryDetail = data.galeri;
    $("gallery-name").textContent = galleryDetail.nama;
    $("gallery-id").textContent = `ID: ${galleryDetail.id}`;
    $("gallery-role").textContent = galleryDetail.role;
    $("gallery-photo-total").textContent = galleryDetail.foto;
    $("gallery-group-total").textContent = `${galleryDetail.grup} grup`;
    $("gallery-public-link").href = galleryDetail.publicUrl;
    $("rename-gallery").hidden = galleryDetail.role !== "owner";
    $("add-gallery-admin").hidden = galleryDetail.role !== "owner";
    $("gallery-content").hidden = false;
    await Promise.all([loadGalleryPhotos(true), loadGalleryAdmins()]);
  }

  async function loadGalleryPhotos(reset = false) {
    if (!activeGallery) return;
    const offset = reset ? 0 : galleryPhotos.length;
    const search = $("gallery-search").value.trim();
    const data = await api(`/api/galeri/${encodeURIComponent(activeGallery)}/foto?limit=${galleryPage}&offset=${offset}&search=${encodeURIComponent(search)}`);
    galleryPhotoTotal = data.total;
    galleryPhotos = reset ? data.foto : galleryPhotos.concat(data.foto);
    renderGalleryPhotos();
  }

  function renderGalleryPhotos() {
    const list = $("gallery-photo-list"); list.replaceChildren();
    $("gallery-photo-count").textContent = `${galleryPhotoTotal} foto`;
    if (!galleryPhotos.length) list.appendChild(emptyBox("Belum ada foto."));
    for (const photo of galleryPhotos) {
      const card = document.createElement("article"); card.className = "photo-card";
      const img = document.createElement("img"); img.className = "photo-thumb"; img.loading = "lazy"; img.src = photo.url; img.alt = photo.id;
      const body = document.createElement("div"); body.className = "photo-body";
      const title = document.createElement("div"); title.className = "photo-title"; title.textContent = photo.id;
      const caption = document.createElement("div"); caption.className = "photo-caption"; caption.textContent = photo.keterangan || "Tanpa keterangan";
      const meta = document.createElement("div"); meta.className = "photo-meta"; meta.textContent = `${photo.grupAsal} · ${photo.uploader} · ${dateTimeFmt.format(new Date(photo.tanggal || Date.now()))}`;
      const actions = document.createElement("div"); actions.className = "photo-actions"; actions.append(button("Edit", "ghost", () => openGalleryPhotoEdit(photo)), button("Hapus", "danger-soft", () => deleteGalleryPhoto(photo)));
      body.append(title, caption, meta, actions); card.append(img, body); list.appendChild(card);
    }
    $("gallery-load-more").hidden = galleryPhotos.length >= galleryPhotoTotal;
  }

  function openGalleryPhotoEdit(photo) {
    $("gallery-edit-number").value = photo.nomor; $("gallery-edit-id").textContent = photo.id; $("gallery-edit-caption").value = photo.keterangan || ""; setStatus($("gallery-edit-status")); $("gallery-edit-dialog").showModal();
  }

  async function deleteGalleryPhoto(photo) {
    if (!confirm(`Hapus ${photo.id} dari Galeri ${galleryDetail?.nama || activeGallery}?\n\nFile juga akan dihapus dari R2.`)) return;
    await api(`/api/galeri/${encodeURIComponent(activeGallery)}/foto/${encodeURIComponent(photo.nomor)}`, { method: "DELETE", body: "{}" });
    await loadGallery(activeGallery);
  }

  async function loadGalleryAdmins() {
    const data = await api(`/api/galeri/${encodeURIComponent(activeGallery)}/admin`);
    const list = $("gallery-admin-list"); list.replaceChildren();
    const owner = document.createElement("div"); owner.className = "admin-row"; const om = document.createElement("div"); om.className = "admin-meta"; const os = document.createElement("strong"); os.textContent = data.owner?.label || "Owner"; const or = document.createElement("span"); or.textContent = "Owner Galeri"; om.append(os,or); owner.appendChild(om); list.appendChild(owner);
    for (const admin of data.admins || []) {
      const row = document.createElement("div"); row.className = "admin-row"; const meta = document.createElement("div"); meta.className = "admin-meta"; const strong = document.createElement("strong"); strong.textContent = admin.label || admin.phone || "Admin"; const role = document.createElement("span"); role.textContent = "Admin Galeri"; meta.append(strong, role); row.appendChild(meta);
      if (data.role === "owner") row.appendChild(button("Hapus", "danger-soft compact", () => removeGalleryAdmin(admin)));
      list.appendChild(row);
    }
    if (!(data.admins || []).length) { const note = document.createElement("div"); note.className = "empty"; note.textContent = "Belum ada Admin Galeri tambahan."; list.appendChild(note); }
  }

  async function removeGalleryAdmin(admin) {
    if (!confirm(`Hapus ${admin.label || admin.phone} dari Admin Galeri?`)) return;
    await api(`/api/galeri/${encodeURIComponent(activeGallery)}/admin/${encodeURIComponent(admin.ref)}`, { method: "DELETE", body: "{}" });
    await loadGalleryAdmins();
  }

  // ---------- EVENTS ----------
  $("phone-form").addEventListener("submit", async event => {
    event.preventDefault(); setStatus($("auth-status"), "Mengirim kode…");
    try { const result = await api("/api/auth/request", { method: "POST", body: JSON.stringify({ phone: $("phone").value }) }); challengeId = result.challengeId; challengeExpiresAt = Number(result.expiresAt) || Date.now() + 300000; saveOtpChallenge($("phone").value); $("phone-form").hidden = true; $("otp-form").hidden = false; $("otp").value = ""; $("otp").focus(); setStatus($("auth-status"), "Kode OTP sudah dikirim ke WhatsApp.", "success"); } catch (error) { setStatus($("auth-status"), error.message, "error"); }
  });

  $("otp-form").addEventListener("submit", async event => {
    event.preventDefault(); setStatus($("auth-status"), "Memeriksa kode…");
    try { if (!challengeId) throw new Error("Kirim kode OTP terlebih dahulu."); await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ challengeId, code: $("otp").value }) }); clearOtpChallenge(); setStatus($("auth-status")); await bootstrapSession(); } catch (error) { if (/kedaluwarsa|tidak ditemukan|berakhir/i.test(error.message)) clearOtpChallenge(); setStatus($("auth-status"), error.message, "error"); }
  });
  $("change-phone").addEventListener("click", () => { clearOtpChallenge(); setStatus($("auth-status")); });
  $("logout").addEventListener("click", async () => { try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch (_) {} clearSession(); });
  document.querySelectorAll(".app-tab").forEach(el => el.addEventListener("click", () => switchView(el.dataset.view)));

  // Kas events
  $("kas-select").addEventListener("change", () => loadKas($("kas-select").value).catch(showError));
  $("refresh").addEventListener("click", () => loadKas(activeKas).catch(showError));
  $("add-income").addEventListener("click", () => openKasCreate("masuk")); $("add-expense").addEventListener("click", () => openKasCreate("keluar")); $("tx-type").addEventListener("change", updateKasCategories); $("close-dialog").addEventListener("click", () => $("tx-dialog").close()); $("load-more").addEventListener("click", () => loadKasTransactions(false).catch(showError));
  let kasSearchTimer; $("search").addEventListener("input", () => { clearTimeout(kasSearchTimer); kasSearchTimer = setTimeout(() => loadKasTransactions(true).catch(showError), 300); });
  $("tx-form").addEventListener("submit", async event => { event.preventDefault(); const ref = $("tx-ref").value; const payload = { jenis: $("tx-type").value, nominal: Number($("tx-amount").value), kategori: $("tx-category").value, keterangan: $("tx-description").value.trim(), catatan: $("tx-note").value.trim(), label: parseTags($("tx-tags").value), tanggal: dateToTimestamp($("tx-date").value) }; if (ref) payload.alasan = $("tx-reason").value.trim() || "Edit melalui Web PROxyz"; setStatus($("form-status"), "Menyimpan…"); try { await api(ref ? `/api/kas/${encodeURIComponent(activeKas)}/transaksi/${encodeURIComponent(ref)}` : `/api/kas/${encodeURIComponent(activeKas)}/transaksi`, { method: ref ? "PUT" : "POST", body: JSON.stringify(payload) }); $("tx-dialog").close(); await loadKas(activeKas); } catch (error) { setStatus($("form-status"), error.message, "error"); } });

  // Bertunas events
  $("bertunas-select").addEventListener("change", () => loadBertunas($("bertunas-select").value).catch(showError));
  $("bt-season").addEventListener("change", () => reloadBertunasForContext({ resetCrop: true }).catch(showError));
  $("bt-refresh").addEventListener("click", () => reloadBertunasForContext().catch(showError));
  $("bt-add-expense").addEventListener("click", () => openBtCreate("expense"));
  $("bt-add-harvest").addEventListener("click", () => openBtCreate("harvest"));
  $("bt-add-activity").addEventListener("click", () => openBtCreate("activity"));
  $("bt-add-schedule").addEventListener("click", () => openBtCreate("schedule"));
  $("bt-close-dialog").addEventListener("click", () => $("bt-dialog").close());
  document.querySelectorAll(".subtab").forEach(el => el.addEventListener("click", () => {
    document.querySelectorAll(".subtab").forEach(x => x.classList.toggle("active", x === el));
    for (const name of ["transaksi","aktivitas","jadwal"]) $("bt-"+name+"-panel").hidden = name !== el.dataset.btTab;
  }));
  $("bt-form").addEventListener("submit", async event => {
    event.preventDefault(); if (!btFormState) return; setStatus($("bt-form-status"), "Menyimpan…");
    try {
      if (btFormState.mode === "create") {
        const body = { seasonId: btSelectedSeason(), cropId: btIsAllCrops() ? "" : btCropScope };
        if (btIsAllCrops()) {
          const target = $("bt-field-targetCrop")?.value || "";
          if (target === "__shared__") { body.cropId = ""; body.shared = true; }
          else { body.cropId = target; body.shared = false; }
        } else if (btFormState.type === "expense") {
          body.shared = false;
        }
        document.querySelectorAll("#bt-fields [data-name]").forEach(el => {
          if (el.dataset.name === "targetCrop") return;
          body[el.dataset.name] = el.type === "number" ? Number(el.value) : el.value.trim();
        });
        if (btFormState.type !== "expense") delete body.shared;
        if (["harvest","activity","schedule"].includes(btFormState.type) && !body.cropId) throw new Error("Pilih tanaman terlebih dahulu.");
        const endpoint = btFormState.type === "expense" ? "biaya" : btFormState.type === "harvest" ? "panen" : btFormState.type === "activity" ? "aktivitas" : "jadwal";
        await api(`/api/bertunas/${encodeURIComponent(activeBertunas)}/${endpoint}`, { method: "POST", body: JSON.stringify(body) });
      } else {
        const field = $("bt-field-editField").value;
        const value = $("bt-field-editValue").value;
        const row = btFormState.row;
        const endpoint = btFormState.type === "transaksi" ? "transaksi" : btFormState.type === "aktivitas" ? "aktivitas" : "jadwal";
        await api(`/api/bertunas/${encodeURIComponent(activeBertunas)}/${endpoint}/${encodeURIComponent(row.ref || row.nomor)}`, { method: "PUT", body: JSON.stringify({ ...btRowContextBody(row), changes: { [field]: value } }) });
      }
      $("bt-dialog").close(); await reloadBertunasForContext();
    } catch (error) { setStatus($("bt-form-status"), error.message, "error"); }
  });

  // Galeri events
  $("gallery-select").addEventListener("change", () => loadGallery($("gallery-select").value).catch(showError)); $("refresh-gallery").addEventListener("click", () => loadGallery(activeGallery).catch(showError));
  $("rename-gallery").addEventListener("click", async () => { const next = prompt("Nama Galeri baru:", galleryDetail?.nama || ""); if (next === null || !next.trim()) return; try { await api(`/api/galeri/${encodeURIComponent(activeGallery)}`, { method: "PUT", body: JSON.stringify({ nama: next.trim() }) }); const meData = await api("/api/me"); me = meData.user; fillSelect($("gallery-select"), me.galeri || [], row => `${row.nama} · ${row.role}`); await loadGallery(activeGallery); } catch (error) { showError(error); } });
  $("add-gallery-admin").addEventListener("click", async () => { const phone = prompt("Nomor WhatsApp Admin Galeri:", "08"); if (phone === null || !phone.trim()) return; try { await api(`/api/galeri/${encodeURIComponent(activeGallery)}/admin`, { method: "POST", body: JSON.stringify({ phone: phone.trim() }) }); await loadGalleryAdmins(); } catch (error) { showError(error); } });
  $("gallery-load-more").addEventListener("click", () => loadGalleryPhotos(false).catch(showError)); let gallerySearchTimer; $("gallery-search").addEventListener("input", () => { clearTimeout(gallerySearchTimer); gallerySearchTimer = setTimeout(() => loadGalleryPhotos(true).catch(showError), 300); });
  $("close-gallery-edit").addEventListener("click", () => $("gallery-edit-dialog").close()); $("gallery-edit-form").addEventListener("submit", async event => { event.preventDefault(); const nomor = $("gallery-edit-number").value; setStatus($("gallery-edit-status"), "Menyimpan…"); try { await api(`/api/galeri/${encodeURIComponent(activeGallery)}/foto/${encodeURIComponent(nomor)}`, { method: "PUT", body: JSON.stringify({ keterangan: $("gallery-edit-caption").value.trim() }) }); $("gallery-edit-dialog").close(); await loadGalleryPhotos(true); } catch (error) { setStatus($("gallery-edit-status"), error.message, "error"); } });

  restoreOtpChallenge();
  bootstrapSession();
})();
