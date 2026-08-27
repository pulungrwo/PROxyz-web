(() => {
  "use strict";

  const ADMIN_BUILD = "0.7.3";
  const config = window.PROXYZ_ADMIN_CONFIG || {};

  async function checkAdminBuild() {
    try {
      const response = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      const info = await response.json();
      const latest = String(info?.version || "").trim();
      if (!latest || latest === ADMIN_BUILD) return;
      const next = new URL(window.location.href);
      next.searchParams.set("v", latest.replace(/[^0-9A-Za-z._-]/g, ""));
      window.location.replace(next.toString());
    } catch (_) {}
  }

  const API = String(config.apiBase || "").replace(/\/$/, "");
  const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
  const wholeNumber = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
  const dateFmt = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  const dateTimeFmt = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const $ = id => document.getElementById(id);
  const OTP_STORAGE_KEY = "proxyz_admin_otp_challenge";
  const SESSION_TOKEN_KEY = "proxyz_admin_session_token";
  const deepLinkParams = new URLSearchParams(window.location.search);
  const adminDeepLink = {
    view: deepLinkParams.get("view") || "",
    gallery: String(deepLinkParams.get("gallery") || "").trim().toLowerCase(),
    videoJob: String(deepLinkParams.get("videoJob") || "").trim()
  };

  let me = null;
  let challengeId = "";
  let challengeExpiresAt = 0;
  let activeView = ["kas", "bertunas", "galeri", "users"].includes(adminDeepLink.view) ? adminDeepLink.view : "";
  let deepLinkHandled = false;

  // Kas
  let activeKas = "";
  let activeKasDetail = null;
  let kasRows = [];
  let kasTotal = 0;
  const kasPage = 50;
  let activeEvidenceTx = null;
  let evidenceRows = [];
  let activeKasTab = "transaksi";
  let kasSchedules = [];
  let kasReportData = null;
  let kasCategoryEditing = null;
  let kasScheduleEditing = null;
  let kasManagerData = null;

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

  // Pengguna (khusus Owner)
  let usersDirectory = [];
  let galleryDetail = null;
  let galleryPhotos = [];
  let galleryPhotoTotal = 0;
  const galleryPage = 48;
  let galleryVideoJobs = [];
  let activeGalleryVideoJob = null;
  let galleryVideoSelected = new Set();
  let galleryVideoObjectUrls = [];
  let galleryVideoPollTimer = null;
  let galleryVideoImageLoadToken = 0;
  let galleryVideoUploadBusy = false;
  let galleryVideoProcessingJobId = "";
  let galleryVideoReviewBusy = false;
  let galleryBulkMode = false;
  let galleryBulkSelected = new Set();

  function setStatus(el, message = "", type = "") {
    if (!el) return;
    el.textContent = message;
    el.className = `status ${type}`.trim();
  }

  function storedSessionToken() {
    try { return String(localStorage.getItem(SESSION_TOKEN_KEY) || "").trim(); } catch (_) { return ""; }
  }

  function saveSessionToken(token) {
    try {
      if (token) localStorage.setItem(SESSION_TOKEN_KEY, String(token));
      else localStorage.removeItem(SESSION_TOKEN_KEY);
    } catch (_) {}
  }

  function authHeaders(headers = {}) {
    const result = { ...headers };
    const token = storedSessionToken();
    if (token && !result.Authorization && !result.authorization) result.Authorization = `Bearer ${token}`;
    return result;
  }

  async function api(path, options = {}) {
    if (!API) throw new Error("Alamat API Admin belum dikonfigurasi.");
    const headers = authHeaders({ "Content-Type": "application/json", ...(options.headers || {}) });
    let response;
    try {
      response = await fetch(`${API}${path}`, { ...options, headers, credentials: "include", cache: "no-store" });
    } catch (_) {
      throw new Error("API PROxyz belum dapat dihubungi. Pastikan bot dan tunnel aktif.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && !path.includes("/auth/")) { saveSessionToken(""); clearSession(); }
      const error = new Error(data.error || `Permintaan gagal (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function apiRaw(path, options = {}) {
    if (!API) throw new Error("Alamat API Admin belum dikonfigurasi.");
    const headers = authHeaders(options.headers || {});
    let response;
    try {
      response = await fetch(`${API}${path}`, { ...options, headers, credentials: "include", cache: "no-store" });
    } catch (_) {
      throw new Error("API PROxyz belum dapat dihubungi. Pastikan bot dan tunnel aktif.");
    }
    if (!response.ok) {
      let message = `Permintaan gagal (${response.status}).`;
      try { message = (await response.json()).error || message; } catch (_) {}
      if (response.status === 401 && !path.includes("/auth/")) { saveSessionToken(""); clearSession(); }
      throw new Error(message);
    }
    return response;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function clearSession() {
    stopGalleryVideoPolling();
    deepLinkHandled = false;
    clearGalleryVideoObjectUrls();
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

  function nominalDigits(value) {
    return String(value ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  }

  function formatNominalText(value) {
    const digits = nominalDigits(value);
    if (!digits) return "";
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function parseNominalText(value) {
    const digits = nominalDigits(value);
    if (!digits) return 0;
    const amount = Number(digits);
    return Number.isSafeInteger(amount) ? amount : 0;
  }

  function formatNominalInput(el) {
    if (el) el.value = formatNominalText(el.value);
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
    } catch (error) {
      if (error?.status !== 403) clearSession();
      else {
        me = null;
        $("login-view").hidden = false;
        $("app-view").hidden = true;
      }
      setStatus($("auth-status"), error?.message || "Sesi Admin belum tersedia.", "error");
    }
  }

  function renderMe() {
    $("login-view").hidden = true;
    $("app-view").hidden = false;
    $("welcome").textContent = me.name || "Pengguna PROxyz";

    const counts = [
      (me.kas || []).length ? `${me.kas.length} Kas` : "",
      (me.bertunas || []).length ? `${me.bertunas.length} Bertunas` : "",
      (me.galeri || []).length ? `${me.galeri.length} Galeri` : ""
    ].filter(Boolean);
    $("access-summary").textContent = counts.join(" · ") || "Tidak ada akses aplikasi.";

    const availability = {
      kas: (me.kas || []).length > 0,
      bertunas: (me.bertunas || []).length > 0,
      galeri: (me.galeri || []).length > 0,
      users: Boolean(me.isOwner)
    };
    for (const [name, available] of Object.entries(availability)) $("tab-" + name).hidden = !available;

    fillSelect($("kas-select"), me.kas || [], row => `${row.nama} · ${row.role}`);
    fillSelect($("bertunas-select"), me.bertunas || [], row => `${row.nama} · ${row.role}`);
    fillSelect($("gallery-select"), me.galeri || [], row => `${row.nama} · ${row.role}`);

    const requestedGallery = adminDeepLink.gallery && (me.galeri || []).some(row => row.id === adminDeepLink.gallery)
      ? adminDeepLink.gallery
      : "";
    if (requestedGallery) {
      activeGallery = requestedGallery;
      $("gallery-select").value = requestedGallery;
    }

    const preferred = activeView && availability[activeView] ? activeView : "";
    const first = preferred || ["kas", "bertunas", "galeri", "users"].find(name => availability[name]);
    if (first) switchView(first);

    if (requestedGallery && first === "galeri") {
      setTimeout(() => handleAdminDeepLink().catch(showError), 0);
    }
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
    for (const name of ["kas", "bertunas", "galeri", "users"]) {
      $(`${name}-view`).hidden = name !== view;
      $("tab-" + name).classList.toggle("active", name === view);
    }
    if (view === "kas" && !activeKas && me.kas?.length) loadKas(me.kas[0].id).catch(showError);
    if (view === "bertunas" && !activeBertunas && me.bertunas?.length) loadBertunas(me.bertunas[0].id).catch(showError);
    if (view === "galeri" && !activeGallery && me.galeri?.length) loadGallery(me.galeri[0].id).catch(showError);
    if (view === "users" && me.isOwner) loadUsers().catch(showError);
  }

  async function handleAdminDeepLink() {
    if (deepLinkHandled || !me || !adminDeepLink.gallery) return;
    const allowed = (me.galeri || []).some(row => row.id === adminDeepLink.gallery);
    if (!allowed) return;

    deepLinkHandled = true;
    switchView("galeri");
    await loadGallery(adminDeepLink.gallery);

    if (!adminDeepLink.videoJob) return;

    switchGalleryTab("video");
    const job = await refreshGalleryVideoJob(adminDeepLink.videoJob);
    if (!job) return;

    if (job.status === "review") {
      switchGalleryTab("draft");
      await openGalleryVideoReview(job);
      return;
    }

    if (["uploading", "queued", "processing"].includes(job.status)) {
      startGalleryVideoPolling(job.id);
      return;
    }

    switchGalleryTab("draft");
  }

  function showError(error) { alert(error?.message || String(error)); }

  // ---------- PENGGUNA ----------
  function openUserNameDialog(user = null, self = false) {
    const dialog = $("user-name-dialog");
    const isSelf = self || !user;
    const row = isSelf ? { id: me.userId, name: me.name, maskedIdentity: "Nama Anda sendiri" } : user;
    $("user-name-id").value = row?.id || "";
    $("user-name-input").value = row?.name === "Pengguna PROxyz" ? "" : (row?.name || "");
    $("user-name-dialog-title").textContent = isSelf ? "Edit nama Anda" : "Edit nama pengguna";
    const editNumber = whatsappNumberFromUserId(row?.id);
    $("user-name-help").textContent = isSelf ? "Nama ini akan dipakai sebagai identitas tampilan Anda di PROxyz." : (editNumber ? `WhatsApp +${editNumber}` : "Nomor WhatsApp tidak tersedia");
    setStatus($("user-name-status"));
    dialog.showModal();
    setTimeout(() => $("user-name-input").focus(), 80);
  }

  async function loadUsers() {
    if (!me?.isOwner) return;
    setStatus($("users-status"), "Memuat pengguna…");
    const data = await api("/api/users");
    usersDirectory = data.users || [];
    renderUsers();
    setStatus($("users-status"), usersDirectory.length ? `${usersDirectory.length} pengguna ditemukan.` : "Belum ada pengguna.", "success");
  }

  function whatsappNumberFromUserId(value) {
    const raw = String(value || "").split("@")[0].split(":")[0].replace(/\D/g, "");
    return raw || "";
  }

  function renderUsers() {
    const list = $("users-list");
    const query = String($("users-search").value || "").trim().toLowerCase();
    const rows = usersDirectory.filter(row => {
      if (!query) return true;
      const number = whatsappNumberFromUserId(row.id);
      return [row.name, number, `+${number}`, ...(row.access || [])].join(" ").toLowerCase().includes(query);
    });
    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "Pengguna tidak ditemukan."; list.appendChild(empty); return;
    }
    for (const row of rows) {
      const card = document.createElement("div");
      card.className = `user-directory-row${row.hasDisplayName ? "" : " user-no-name"}`;
      const main = document.createElement("div"); main.className = "user-directory-main";
      const name = document.createElement("strong"); name.textContent = row.hasDisplayName ? row.name : (row.name && row.name !== "Pengguna PROxyz" ? row.name : "Belum diberi nama");
      const access = document.createElement("span"); access.textContent = (row.access || ["Pengguna PROxyz"]).join(" · ");
      const number = whatsappNumberFromUserId(row.id);
      const ident = document.createElement(number ? "a" : "span");
      ident.className = number ? "user-wa-link" : "";
      if (number) {
        ident.textContent = `WhatsApp +${number}`;
        ident.href = `https://wa.me/${number}`;
        ident.target = "_blank";
        ident.rel = "noopener noreferrer";
        ident.title = "Buka chat WhatsApp";
      } else {
        ident.textContent = "Nomor WhatsApp tidak tersedia";
      }
      main.append(name);
      if (row.isOwner) { const badge = document.createElement("span"); badge.className = "user-owner-badge"; badge.textContent = "Owner"; main.append(badge); }
      main.append(access, ident);
      const edit = button(row.hasDisplayName ? "Edit" : "Beri nama", "ghost", () => openUserNameDialog(row, false));
      card.append(main, edit); list.appendChild(card);
    }
  }

  // ---------- KAS ----------
  async function loadKas(id) {
    const previousKas = activeKas;
    activeKas = id;
    if (previousKas && previousKas !== id && $("kas-report-note")) $("kas-report-note").value = "";
    $("kas-select").value = id;
    const data = await api(`/api/kas/${encodeURIComponent(id)}`);
    activeKasDetail = data.kas;
    updateKasReportTargetButtons();
    $("kas-name").textContent = data.kas.nama;
    $("kas-balance").textContent = rupiah.format(data.kas.saldo.akhir || 0);
    $("kas-in").textContent = wholeNumber.format(data.kas.saldo.masuk || 0);
    $("kas-out").textContent = wholeNumber.format(data.kas.saldo.keluar || 0);
    $("kas-content").hidden = false;
    renderKasCategories();
    await loadKasTransactions(true);
    await refreshKasActivePanel();
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
      const meta = document.createElement("div"); meta.className = "item-meta"; meta.textContent = `${dateFmt.format(new Date(tx.tanggal))} · ${tx.kategoriNama || tx.kategori}`;
      left.append(title, meta);
      const amount = document.createElement("div"); amount.className = `amount ${tx.jenis === "masuk" ? "in" : "out"}`; amount.textContent = `${tx.jenis === "masuk" ? "+" : "−"}${rupiah.format(tx.nominal)}`;
      top.append(left, amount); card.appendChild(top);
      if (tx.catatan) { const note = document.createElement("div"); note.className = "item-meta"; note.style.marginTop = "6px"; note.textContent = tx.catatan; card.appendChild(note); }
      if (Number(tx.buktiCount || 0) > 0) { const proof = document.createElement("button"); proof.type = "button"; proof.className = "evidence-badge"; proof.textContent = `📎 ${tx.buktiCount} bukti`; proof.addEventListener("click", () => openEvidence(tx)); card.appendChild(proof); }
      for (const tag of tx.label || []) { const span = document.createElement("span"); span.className = "tag"; span.textContent = `#${tag}`; card.appendChild(span); }
      const actions = document.createElement("div"); actions.className = "item-actions";
      actions.append(button(Number(tx.buktiCount || 0) ? `Bukti · ${tx.buktiCount}` : "+ Bukti", "evidence-soft", () => openEvidence(tx)), button("Edit", "ghost", () => openKasEdit(tx)), button("Hapus", "danger-soft", () => deleteKasTx(tx)));
      card.appendChild(actions); list.appendChild(card);
    }
    $("load-more").hidden = kasRows.length >= kasTotal;
  }

  function kasCategoryRows(type, includeInactive = false) {
    const rows = activeKasDetail?.kategoriDetail?.[type] || [];
    return includeInactive ? rows : rows.filter(row => row.aktif !== false);
  }

  function updateKasCategories() {
    const type = $("tx-type").value;
    const current = $("tx-category").value;
    const categories = kasCategoryRows(type, true);
    $("tx-category").replaceChildren();
    for (const category of categories) {
      if (category.aktif === false && category.id !== current) continue;
      const opt = document.createElement("option");
      opt.value = category.id;
      opt.textContent = category.nama + (category.aktif === false ? " · nonaktif" : "");
      $("tx-category").appendChild(opt);
    }
    if ([...$("tx-category").options].some(opt => opt.value === current)) $("tx-category").value = current;
  }


  function setKasTab(tab, load = true) {
    activeKasTab = ["transaksi", "laporan", "jadwal", "kategori", "pengelola"].includes(tab) ? tab : "transaksi";
    document.querySelectorAll("[data-kas-tab]").forEach(btn => btn.classList.toggle("active", btn.dataset.kasTab === activeKasTab));
    ["transaksi", "laporan", "jadwal", "kategori", "pengelola"].forEach(name => {
      const panel = $(`kas-${name}-panel`);
      if (panel) panel.hidden = name !== activeKasTab;
    });
    if (load) refreshKasActivePanel().catch(showError);
  }

  async function refreshKasActivePanel() {
    if (!activeKas) return;
    if (activeKasTab === "jadwal") await loadKasSchedules();
    else if (activeKasTab === "kategori") renderKasCategories();
    else if (activeKasTab === "pengelola") await loadKasManagers();
    else if (activeKasTab === "laporan") {
      if (!$("kas-report-start").value) { setupKasReportPeriodPicker(); setKasReportMonth(); }
      await loadKasReport();
    }
  }

  const KAS_MONTH_NAMES = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

  function setupKasReportPeriodPicker() {
    const monthSelect = $("kas-report-month-select");
    const yearSelect = $("kas-report-year-select");
    const today = todayJakarta().split("-").map(Number);
    const monthWasEmpty = !monthSelect.options.length;
    const yearWasEmpty = !yearSelect.options.length;
    if (monthWasEmpty) {
      KAS_MONTH_NAMES.forEach((name, index) => {
        const opt = document.createElement("option"); opt.value = String(index + 1); opt.textContent = name; monthSelect.appendChild(opt);
      });
    }
    if (yearWasEmpty) {
      const currentYear = Number(today[0]);
      for (let year = currentYear + 1; year >= currentYear - 15; year -= 1) {
        const opt = document.createElement("option"); opt.value = String(year); opt.textContent = String(year); yearSelect.appendChild(opt);
      }
    }
    if (monthWasEmpty) monthSelect.value = String(today[1]);
    if (yearWasEmpty) yearSelect.value = String(today[0]);
    updateKasReportShortcutLabels();
  }

  function updateKasReportShortcutLabels() {
    const month = Number($("kas-report-month-select").value || 1);
    const year = Number($("kas-report-year-select").value || todayJakarta().slice(0, 4));
    $("kas-report-month").textContent = `${KAS_MONTH_NAMES[month - 1] || "Bulan"} ${year}`;
    $("kas-report-year").textContent = `Tahun ${year}`;
  }

  function setKasReportMonth() {
    setupKasReportPeriodPicker();
    const year = Number($("kas-report-year-select").value);
    const month = Number($("kas-report-month-select").value);
    const last = new Date(year, month, 0).getDate();
    $("kas-report-start").value = `${year}-${String(month).padStart(2, "0")}-01`;
    $("kas-report-end").value = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    updateKasReportShortcutLabels();
  }

  function setKasReportYear() {
    setupKasReportPeriodPicker();
    const year = Number($("kas-report-year-select").value);
    $("kas-report-start").value = `${year}-01-01`;
    $("kas-report-end").value = `${year}-12-31`;
    updateKasReportShortcutLabels();
  }

  async function loadKasReport() {
    if (!activeKas) return;
    const start = $("kas-report-start").value;
    const end = $("kas-report-end").value;
    if (!start || !end) return setStatus($("kas-report-status"), "Pilih tanggal laporan.", "error");
    setStatus($("kas-report-status"), "Menyusun laporan…");
    $("kas-report-actions").hidden = true;
    const data = await api(`/api/kas/${encodeURIComponent(activeKas)}/laporan?mulai=${dateToTimestamp(start)}&selesai=${dateToTimestamp(end)}`);
    kasReportData = data.laporan;
    renderKasReport();
    $("kas-report-actions").hidden = false;
    setStatus($("kas-report-status"), `${kasReportData.jumlahTransaksi || 0} transaksi ditemukan.`, "success");
  }

  function renderKasReport() {
    const report = kasReportData;
    if (!report) return;
    $("kas-report-summary").hidden = false;
    $("kas-report-opening").textContent = rupiah.format(report.saldoAwal || 0);
    $("kas-report-in").textContent = rupiah.format(report.totalMasuk || 0);
    $("kas-report-out").textContent = rupiah.format(report.totalKeluar || 0);
    $("kas-report-closing").textContent = rupiah.format(report.saldoAkhir || 0);

    const groups = $("kas-report-categories"); groups.replaceChildren();
    for (const jenis of ["masuk", "keluar"]) {
      const rows = (report.ringkasan || []).filter(row => row.jenis === jenis);
      if (!rows.length) continue;
      const totals = new Map();
      for (const row of rows) {
        const name = row.kategoriNama || row.kategori || "Lainnya";
        totals.set(name, (totals.get(name) || 0) + Number(row.totalNominal || 0));
      }
      const section = document.createElement("section"); section.className = "report-category-section";
      const head = document.createElement("div"); head.className = "mini-section-title";
      const label = document.createElement("span"); label.textContent = jenis === "masuk" ? "Pemasukan" : "Pengeluaran";
      const total = document.createElement("b"); total.textContent = rupiah.format(jenis === "masuk" ? report.totalMasuk : report.totalKeluar);
      head.append(label, total); section.appendChild(head);
      for (const [name, amount] of totals) {
        const row = document.createElement("div"); row.className = "report-category-row";
        const left = document.createElement("span"); left.textContent = name;
        const right = document.createElement("b"); right.textContent = rupiah.format(amount);
        row.append(left, right); section.appendChild(row);
      }
      groups.appendChild(section);
    }

    const list = $("kas-report-transactions"); list.replaceChildren();
    if (!(report.transaksi || []).length) list.appendChild(emptyBox("Tidak ada transaksi pada periode ini."));
    for (const tx of report.transaksi || []) {
      const card = document.createElement("article"); card.className = "item-card report-tx-card";
      const top = document.createElement("div"); top.className = "item-top";
      const info = document.createElement("div");
      const title = document.createElement("h3"); title.textContent = `${tx.keterangan || "Transaksi"}`;
      const meta = document.createElement("div"); meta.className = "item-meta"; meta.textContent = `${dateFmt.format(new Date(tx.tanggal))} · ${tx.kategoriNama || tx.kategori}`;
      info.append(title, meta);
      const amount = document.createElement("div"); amount.className = `amount ${tx.jenis === "masuk" ? "in" : "out"}`; amount.textContent = `${tx.jenis === "masuk" ? "+" : "−"}${rupiah.format(tx.nominal || 0)}`;
      top.append(info, amount); card.appendChild(top); list.appendChild(card);
    }
  }

  function kasReportIsPrivate() {
    return activeKasDetail?.webAccess?.visibility === "private";
  }

  function updateKasReportTargetButtons() {
    const isPrivate = kasReportIsPrivate();
    const pdfTarget = $("kas-report-wa-pdf-target");
    const complete = $("kas-report-wa-complete");
    const simple = $("kas-report-wa-simple");
    if (pdfTarget) pdfTarget.textContent = isPrivate ? "Kirim PDF ke pengakses web" : "Kirim PDF ke grup";
    if (complete) complete.textContent = isPrivate ? "Kirim laporan lengkap ke pengakses web" : "Kirim laporan lengkap ke grup";
    if (simple) simple.textContent = isPrivate ? "Kirim laporan singkat ke pengakses web" : "Kirim laporan singkat ke grup";
  }

  function kasReportActionButtons() {
    return [
      $("kas-report-wa-pdf"),
      $("kas-report-wa-pdf-target"),
      $("kas-report-wa-complete"),
      $("kas-report-wa-simple")
    ].filter(Boolean);
  }

  async function sendKasReportWhatsApp(action) {
    if (!activeKas) return;
    const start = $("kas-report-start").value;
    const end = $("kas-report-end").value;
    if (!start || !end) return alert("Buat laporan terlebih dahulu.");

    const isPrivate = kasReportIsPrivate();
    const destination = isPrivate ? "pengakses web" : "grup";
    const labels = {
      pdf_self: "Mengirim PDF ke WhatsApp Anda…",
      pdf_group: `Mengirim PDF ke ${destination}…`,
      complete_group: `Mengirim laporan lengkap ke ${destination}…`,
      simple_group: `Mengirim laporan singkat ke ${destination}…`
    };
    const buttons = kasReportActionButtons();
    buttons.forEach(button => { button.disabled = true; });
    setStatus($("kas-report-status"), labels[action] || "Mengirim laporan ke WhatsApp…");

    try {
      const result = await api(`/api/kas/${encodeURIComponent(activeKas)}/laporan/wa`, {
        method: "POST",
        body: JSON.stringify({
          mulai: dateToTimestamp(start),
          selesai: dateToTimestamp(end),
          action,
          catatan: $("kas-report-note")?.value.trim() || ""
        })
      });
      setStatus($("kas-report-status"), result.message || "Laporan berhasil dikirim.", "success");
    } catch (error) {
      setStatus($("kas-report-status"), error.message, "error");
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  async function loadKasSchedules() {
    if (!activeKas) return;
    const data = await api(`/api/kas/${encodeURIComponent(activeKas)}/jadwal`);
    kasSchedules = data.jadwal || [];
    renderKasSchedules();
  }

  function renderKasSchedules() {
    const list = $("kas-schedule-list"); list.replaceChildren();
    if (!kasSchedules.length) return list.appendChild(emptyBox("Belum ada jadwal pembayaran rutin."));
    for (const row of kasSchedules) {
      const card = document.createElement("article"); card.className = "item-card schedule-card";
      const top = document.createElement("div"); top.className = "item-top";
      const info = document.createElement("div");
      const title = document.createElement("h3"); title.textContent = row.nama;
      const meta = document.createElement("div"); meta.className = "item-meta"; meta.textContent = `${row.frekuensiNama || "Mingguan"} · ${row.jadwalLabel || ""} · ${row.kategoriNama || row.kategori}`;
      info.append(title, meta);
      const amount = document.createElement("div"); amount.className = "amount out"; amount.textContent = rupiah.format(row.nominal || 0);
      top.append(info, amount); card.appendChild(top);
      if (row.catatan) { const note = document.createElement("p"); note.className = "muted small schedule-note"; note.textContent = row.catatan; card.appendChild(note); }
      const status = document.createElement("div"); status.className = "schedule-status";
      const overdue = Number(row.tertunggak?.length || 0);
      const nextText = row.berikutnya ? dateFmt.format(new Date(row.berikutnya)) : "—";
      status.textContent = overdue ? `${overdue} periode belum diselesaikan · berikutnya ${nextText}` : `Berikutnya ${nextText}`;
      card.appendChild(status);
      const actions = document.createElement("div"); actions.className = "item-actions schedule-actions";
      actions.append(
        button("Bayar", "success-soft", () => payKasSchedule(row)),
        button("Lewati", "ghost", () => skipKasSchedule(row)),
        button("Edit", "ghost", () => openKasScheduleDialog(row)),
        button("Hapus", "danger-soft", () => deleteKasSchedule(row))
      );
      card.appendChild(actions); list.appendChild(card);
    }
  }

  function fillKasScheduleCategories() {
    const select = $("kas-schedule-category"); select.replaceChildren();
    for (const row of kasCategoryRows("keluar")) {
      const opt = document.createElement("option"); opt.value = row.id; opt.textContent = row.nama; select.appendChild(opt);
    }
  }

  function openKasScheduleDialog(row = null) {
    kasScheduleEditing = row || null;
    $("kas-schedule-form").reset();
    fillKasScheduleCategories();
    setStatus($("kas-schedule-status"));
    $("kas-schedule-dialog-title").textContent = row ? "Edit jadwal" : "Tambah jadwal";
    $("kas-schedule-id").value = row?.id || "";
    $("kas-schedule-name").value = row?.nama || "";
    $("kas-schedule-amount").value = row ? formatNominalText(row.nominal) : "";
    $("kas-schedule-frequency").value = row?.frekuensi || "mingguan";
    $("kas-schedule-start").value = row?.mulai ? timestampToDate(row.mulai) : todayJakarta();
    if (row?.kategori) $("kas-schedule-category").value = row.kategori;
    $("kas-schedule-note").value = row?.catatan || "";
    $("kas-schedule-dialog").showModal();
  }

  async function payKasSchedule(row) {
    if (!confirm(`Bayar satu periode ${row.nama} sebesar ${rupiah.format(row.nominal)}?`)) return;
    await api(`/api/kas/${encodeURIComponent(activeKas)}/jadwal/${encodeURIComponent(row.id)}/bayar`, { method: "POST", body: JSON.stringify({ count: 1 }) });
    await loadKas(activeKas); setKasTab("jadwal", true);
  }

  async function skipKasSchedule(row) {
    const alasan = prompt(`Lewati periode ${row.nama}?\nAlasan:`, "Tidak dibayar periode ini");
    if (alasan === null) return;
    await api(`/api/kas/${encodeURIComponent(activeKas)}/jadwal/${encodeURIComponent(row.id)}/lewati`, { method: "POST", body: JSON.stringify({ alasan: alasan.trim() }) });
    await loadKasSchedules();
  }

  async function deleteKasSchedule(row) {
    if (!confirm(`Hapus jadwal ${row.nama}?\n\nRiwayat pembayaran yang sudah tercatat tetap aman.`)) return;
    await api(`/api/kas/${encodeURIComponent(activeKas)}/jadwal/${encodeURIComponent(row.id)}`, { method: "DELETE", body: "{}" });
    await loadKasSchedules();
  }

  async function loadKasManagers() {
    if (!activeKas) return;
    const data = await api(`/api/kas/${encodeURIComponent(activeKas)}/pengelola`);
    kasManagerData = data;
    renderKasManagers();
  }

  function renderKasManagers() {
    const data = kasManagerData || {};
    const list = $("kas-manager-list"); list.replaceChildren();
    const canEdit = Boolean(data.canEdit);
    $("kas-manager-add").hidden = !canEdit;
    $("kas-manager-owner-note").hidden = canEdit;

    const web = data.webAccess || { visibility: "public", viewers: [] };
    const visibility = web.visibility === "private" ? "private" : "public";
    $("kas-web-visibility").value = visibility;
    $("kas-web-visibility").disabled = !canEdit;
    $("kas-web-access-save").hidden = !canEdit;
    $("kas-web-access-badge").textContent = visibility === "private" ? "Privat" : "Umum";
    $("kas-web-access-badge").className = visibility === "private" ? "status-badge private" : "status-badge public";
    $("kas-viewer-add").hidden = !canEdit;

    const viewerList = $("kas-viewer-list"); viewerList.replaceChildren();
    const viewers = Array.isArray(web.viewers) ? web.viewers : [];
    if (!viewers.length) viewerList.appendChild(emptyBox(visibility === "private" ? "Belum ada Pengakses Web tambahan. Owner/Admin Kas tetap dapat masuk." : "Pengakses tambahan hanya diperlukan jika Kas dibuat privat."));
    for (const row of viewers) {
      const card = document.createElement("article"); card.className = "item-card manager-card viewer-card";
      const top = document.createElement("div"); top.className = "item-top";
      const info = document.createElement("div");
      const title = document.createElement("h3"); title.textContent = row.name || "Pengakses Kas";
      const meta = document.createElement("div"); meta.className = "item-meta"; meta.textContent = "Pengakses Web · hanya lihat";
      info.append(title, meta); top.appendChild(info);
      const badge = document.createElement("span"); badge.className = "role-pill viewer-role"; badge.textContent = "Viewer"; top.appendChild(badge);
      card.appendChild(top);
      if (canEdit) {
        const actions = document.createElement("div"); actions.className = "item-actions";
        actions.append(button("Hapus akses", "danger-soft", () => removeKasViewer(row)));
        card.appendChild(actions);
      }
      viewerList.appendChild(card);
    }

    const manager = data.pengelola || {};
    const rows = [manager.owner, ...(manager.admins || [])].filter(Boolean);
    if (!rows.length) list.appendChild(emptyBox("Belum ada data pengelola."));
    for (const row of rows) {
      const card = document.createElement("article"); card.className = "item-card manager-card";
      const top = document.createElement("div"); top.className = "item-top";
      const info = document.createElement("div");
      const title = document.createElement("h3"); title.textContent = row.name || (row.role === "owner" ? "Owner" : "Admin");
      const meta = document.createElement("div"); meta.className = "item-meta"; meta.textContent = row.role === "owner" ? "Owner Kas · otomatis dapat melihat Web Kas privat" : "Admin Kas · otomatis dapat melihat Web Kas privat";
      info.append(title, meta); top.appendChild(info);
      if (row.role === "owner") {
        const badge = document.createElement("span"); badge.className = "role-pill manager-role"; badge.textContent = "Owner"; top.appendChild(badge);
      }
      card.appendChild(top);
      if (canEdit && row.role === "admin") {
        const actions = document.createElement("div"); actions.className = "item-actions";
        actions.append(button("Hapus Admin", "danger-soft", () => removeKasManager(row)));
        card.appendChild(actions);
      }
      list.appendChild(card);
    }
  }

  function openKasManagerDialog() {
    $("kas-manager-form").reset();
    setStatus($("kas-manager-status"));
    $("kas-manager-dialog").showModal();
  }

  async function removeKasManager(row) {
    if (!confirm(`Hapus ${row.name || "Admin"} dari Admin Kas?`)) return;
    await api(`/api/kas/${encodeURIComponent(activeKas)}/pengelola/admin/${encodeURIComponent(row.id)}`, { method: "DELETE", body: "{}" });
    await loadKasManagers();
  }

  async function saveKasWebAccess() {
    const visibility = $("kas-web-visibility").value;
    const control = $("kas-web-access-save");
    const original = control.textContent;
    control.disabled = true;
    control.textContent = "Menyimpan…";
    try {
      await api(`/api/kas/${encodeURIComponent(activeKas)}/web-access`, { method: "PUT", body: JSON.stringify({ visibility }) });
      await loadKasManagers();
      await loadKas(activeKas);
    } catch (error) {
      alert(error.message);
    } finally {
      control.disabled = false;
      control.textContent = original;
    }
  }

  function openKasViewerDialog() {
    $("kas-viewer-form").reset();
    setStatus($("kas-viewer-status"));
    $("kas-viewer-dialog").showModal();
  }

  async function removeKasViewer(row) {
    if (!confirm(`Hapus akses lihat Web Kas untuk ${row.name || "pengguna ini"}?`)) return;
    await api(`/api/kas/${encodeURIComponent(activeKas)}/web-access/viewer/${encodeURIComponent(row.id)}`, { method: "DELETE", body: "{}" });
    await loadKasManagers();
  }

  async function submitKasViewer(event) {
    event.preventDefault();
    setStatus($("kas-viewer-status"), "Menambahkan pengakses…");
    try {
      await api(`/api/kas/${encodeURIComponent(activeKas)}/web-access/viewer`, {
        method: "POST",
        body: JSON.stringify({ phone: $("kas-viewer-phone").value.trim(), name: $("kas-viewer-name").value.trim() })
      });
      $("kas-viewer-dialog").close();
      await loadKasManagers();
    } catch (error) {
      setStatus($("kas-viewer-status"), error.message, "error");
    }
  }

  function renderKasCategories() {
    if (!activeKasDetail) return;
    const isOwner = activeKasDetail.role === "owner";
    $("kas-category-add").hidden = !isOwner;
    $("kas-category-owner-note").hidden = isOwner;
    const renderType = (type, listId, countId) => {
      const rows = kasCategoryRows(type, true);
      $(countId).textContent = String(rows.filter(row => row.aktif !== false).length);
      const list = $(listId); list.replaceChildren();
      rows.forEach((row, index) => {
        const card = document.createElement("div"); card.className = `category-row${row.aktif === false ? " category-inactive" : ""}`;
        const info = document.createElement("div"); info.className = "category-copy";
        const label = document.createElement("strong"); label.textContent = row.nama;
        const meta = document.createElement("span"); meta.textContent = `${index + 1}. ${row.id}${row.bawaan ? " · bawaan" : " · tambahan"}${row.aktif === false ? " · nonaktif" : ""}`;
        info.append(label, meta); card.appendChild(info);
        if (isOwner) {
          const actions = document.createElement("div"); actions.className = "category-actions";
          const up = button("↑", "ghost compact category-order", () => moveKasCategory(type, index, -1));
          const down = button("↓", "ghost compact category-order", () => moveKasCategory(type, index, 1));
          up.disabled = index === 0;
          down.disabled = index === rows.length - 1;
          up.title = "Naikkan posisi";
          down.title = "Turunkan posisi";
          actions.append(up, down, button("Edit", "ghost compact", () => openKasCategoryDialog(type, row)), button(row.aktif === false ? "Aktifkan" : "Nonaktifkan", row.aktif === false ? "success-soft compact" : "danger-soft compact", () => toggleKasCategory(type, row)));
          card.appendChild(actions);
        }
        list.appendChild(card);
      });
    };
    renderType("masuk", "kas-category-in-list", "kas-category-in-count");
    renderType("keluar", "kas-category-out-list", "kas-category-out-count");
  }

  async function moveKasCategory(type, index, direction) {
    const rows = kasCategoryRows(type, true);
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const ids = rows.map(row => row.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await api(`/api/kas/${encodeURIComponent(activeKas)}/kategori/${type}/urutan`, { method: "PUT", body: JSON.stringify({ ids }) });
    await loadKas(activeKas);
    setKasTab("kategori", false);
  }

  function categoryDefaultLabel(id) {
    return String(id || "").split(/([ /&.-]+)/).map(part => /[a-z0-9]/i.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part).join("");
  }

  function openKasCategoryDialog(type = "keluar", row = null) {
    kasCategoryEditing = row ? { type, row } : null;
    $("kas-category-form").reset(); setStatus($("kas-category-status"));
    $("kas-category-dialog-title").textContent = row ? "Edit kategori" : "Tambah kategori";
    $("kas-category-original-id").value = row?.id || "";
    $("kas-category-type").value = type;
    $("kas-category-type").disabled = Boolean(row);
    $("kas-category-id").value = row?.id || "";
    $("kas-category-id").disabled = Boolean(row);
    $("kas-category-label").value = row && row.nama !== categoryDefaultLabel(row.id) ? row.nama : "";
    $("kas-category-dialog").showModal();
  }

  async function toggleKasCategory(type, row) {
    const action = row.aktif === false ? "aktifkan" : "nonaktifkan";
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} kategori ${row.nama}?`)) return;
    await api(`/api/kas/${encodeURIComponent(activeKas)}/kategori/${type}/${encodeURIComponent(row.id)}`, { method: "PUT", body: JSON.stringify({ aktif: row.aktif === false, nama: row.nama }) });
    await loadKas(activeKas); setKasTab("kategori", false);
  }

  function openKasCreate(type) {
    $("tx-form").reset();
    $("tx-ref").value = "";
    $("form-mode").textContent = type === "masuk" ? "Pemasukan" : "Pengeluaran";
    $("form-title").textContent = type === "masuk" ? "Tambah pemasukan" : "Tambah pengeluaran";
    $("tx-type").value = type;
    $("tx-type-wrap").hidden = true;
    $("tx-date").value = todayJakarta();
    $("edit-reason-wrap").hidden = true;
    updateKasCategories();
    setStatus($("form-status"));
    $("tx-dialog").showModal();
    setTimeout(() => $("tx-amount").focus(), 50);
  }

  function openKasEdit(tx) {
    $("tx-form").reset();
    $("tx-ref").value = tx.nomor;
    $("form-mode").textContent = `Edit ${tx.nomor}`;
    $("form-title").textContent = tx.keterangan;
    $("tx-type").value = tx.jenis;
    $("tx-type-wrap").hidden = false;
    updateKasCategories();
    if (![...$("tx-category").options].some(opt => opt.value === tx.kategori)) { const opt = document.createElement("option"); opt.value = tx.kategori; opt.textContent = tx.kategoriNama || tx.kategori; $("tx-category").appendChild(opt); }
    $("tx-category").value = tx.kategori;
    $("tx-amount").value = formatNominalText(tx.nominal);
    $("tx-description").value = tx.keterangan;
    $("tx-note").value = tx.catatan || "";
    $("tx-tags").value = (tx.label || []).map(x => `#${x}`).join(" ");
    $("tx-date").value = timestampToDate(tx.tanggal);
    $("edit-reason-wrap").hidden = false;
    setStatus($("form-status"));
    $("tx-dialog").showModal();
  }

  async function deleteKasTx(tx) {
    const reason = prompt(`Hapus transaksi ${tx.nomor} — ${tx.keterangan}?\n\nAlasan:`, "Dihapus melalui Web PROxyz");
    if (reason === null) return;
    if (!reason.trim()) return alert("Alasan hapus wajib diisi.");
    await api(`/api/kas/${encodeURIComponent(activeKas)}/transaksi/${encodeURIComponent(tx.nomor)}`, { method: "DELETE", body: JSON.stringify({ alasan: reason.trim() }) });
    await loadKas(activeKas);
  }

  function evidenceBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = String(reader.result || "");
        resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
      };
      reader.onerror = () => reject(new Error("Foto tidak dapat dibaca."));
      reader.readAsDataURL(blob);
    });
  }

  async function prepareEvidenceFile(file) {
    if (!file || !String(file.type || "").startsWith("image/")) throw new Error("Pilih file gambar.");
    const MAX_DIMENSION = 1800;
    const QUALITY = 0.84;

    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", QUALITY));
      if (!blob) throw new Error("Kompresi gagal.");
      if (blob.size > 5 * 1024 * 1024) throw new Error("Foto masih terlalu besar setelah diproses.");
      return { name: String(file.name || "foto.jpg").replace(/\.[^.]+$/, "") + ".jpg", mimeType: "image/jpeg", width, height, data: await evidenceBase64(blob) };
    } catch (error) {
      if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name}: lebih dari 5 MB dan tidak dapat diperkecil.`);
      return { name: file.name || "foto", mimeType: file.type || "image/jpeg", width: 0, height: 0, data: await evidenceBase64(file) };
    }
  }

  async function openEvidence(tx) {
    activeEvidenceTx = tx;
    $("evidence-title").textContent = `Transaksi ${tx.nomor}`;
    $("evidence-subtitle").textContent = `${tx.keterangan} · ${rupiah.format(tx.nominal)}`;
    $("evidence-files").value = "";
    setStatus($("evidence-status"));
    $("evidence-dialog").showModal();
    await loadEvidence();
  }

  async function loadEvidence() {
    if (!activeKas || !activeEvidenceTx) return;
    const data = await api(`/api/kas/${encodeURIComponent(activeKas)}/transaksi/${encodeURIComponent(activeEvidenceTx.nomor)}/bukti`);
    evidenceRows = data.bukti || [];
    activeEvidenceTx.buktiCount = evidenceRows.length;
    renderEvidence();
  }

  function renderEvidence() {
    const list = $("evidence-list");
    list.replaceChildren();
    $("evidence-count").textContent = `${evidenceRows.length} bukti`;
    if (!evidenceRows.length) { list.appendChild(emptyBox("Belum ada bukti transaksi.")); return; }

    for (const row of evidenceRows) {
      const card = document.createElement("article"); card.className = "evidence-card";
      const link = document.createElement("a"); link.href = row.url; link.target = "_blank"; link.rel = "noopener"; link.className = "evidence-thumb-link";
      const img = document.createElement("img"); img.src = row.url; img.alt = row.id; img.loading = "lazy"; img.className = "evidence-thumb";
      link.appendChild(img); card.appendChild(link);
      const body = document.createElement("div"); body.className = "evidence-card-body";
      const title = document.createElement("strong"); title.textContent = row.id;
      const meta = document.createElement("span"); meta.textContent = `${row.uploaderName || "Pengguna"} · ${row.createdAt ? dateTimeFmt.format(new Date(row.createdAt)) : ""}`;
      const remove = button("Hapus", "danger-soft evidence-delete", () => deleteEvidence(row));
      body.append(title, meta, remove); card.appendChild(body); list.appendChild(card);
    }
  }

  async function uploadEvidence() {
    if (!activeEvidenceTx) return;
    const files = [...($("evidence-files").files || [])];
    if (!files.length) return setStatus($("evidence-status"), "Pilih foto terlebih dahulu.", "error");
    if (files.length > 10) return setStatus($("evidence-status"), "Maksimal 10 foto sekali upload.", "error");

    const uploadButton = $("upload-evidence");
    uploadButton.disabled = true;
    setStatus($("evidence-status"), `Menyiapkan ${files.length} foto…`);
    try {
      const prepared = [];
      for (let i = 0; i < files.length; i++) {
        setStatus($("evidence-status"), `Memproses foto ${i + 1}/${files.length}…`);
        prepared.push(await prepareEvidenceFile(files[i]));
      }
      setStatus($("evidence-status"), "Mengunggah ke penyimpanan…");
      const result = await api(`/api/kas/${encodeURIComponent(activeKas)}/transaksi/${encodeURIComponent(activeEvidenceTx.nomor)}/bukti`, { method: "POST", body: JSON.stringify({ files: prepared }) });
      const notes = [];
      if (result.saved?.length) notes.push(`${result.saved.length} foto tersimpan`);
      if (result.duplicate) notes.push(`${result.duplicate} duplikat dilewati`);
      if (result.failed) notes.push(`${result.failed} gagal`);
      setStatus($("evidence-status"), notes.join(" · ") || "Selesai.", result.failed ? "error" : "success");
      $("evidence-files").value = "";
      await loadEvidence();
      await loadKasTransactions(true);
    } catch (error) {
      setStatus($("evidence-status"), error.message, "error");
    } finally {
      uploadButton.disabled = false;
    }
  }

  async function deleteEvidence(row) {
    if (!activeEvidenceTx || !confirm(`Hapus ${row.id} dari Transaksi ${activeEvidenceTx.nomor}?\n\nFile bukti juga akan dihapus dari penyimpanan Galeri.`)) return;
    try {
      await api(`/api/kas/${encodeURIComponent(activeKas)}/transaksi/${encodeURIComponent(activeEvidenceTx.nomor)}/bukti/${encodeURIComponent(row.id)}`, { method: "DELETE", body: "{}" });
      await loadEvidence();
      await loadKasTransactions(true);
    } catch (error) { showError(error); }
  }


  async function submitKasSchedule(event) {
    event.preventDefault();
    const ref = $("kas-schedule-id").value;
    const nominal = parseNominalText($("kas-schedule-amount").value);
    if (!nominal) return setStatus($("kas-schedule-status"), "Nominal belum valid.", "error");
    setStatus($("kas-schedule-status"), "Menyimpan…");
    try {
      const payload = {
        nama: $("kas-schedule-name").value.trim(),
        nominal,
        frekuensi: $("kas-schedule-frequency").value,
        mulai: dateToTimestamp($("kas-schedule-start").value),
        kategori: $("kas-schedule-category").value,
        catatan: $("kas-schedule-note").value.trim(),
        label: []
      };
      await api(ref ? `/api/kas/${encodeURIComponent(activeKas)}/jadwal/${encodeURIComponent(ref)}` : `/api/kas/${encodeURIComponent(activeKas)}/jadwal`, { method: ref ? "PUT" : "POST", body: JSON.stringify(payload) });
      $("kas-schedule-dialog").close();
      kasScheduleEditing = null;
      await loadKasSchedules();
    } catch (error) { setStatus($("kas-schedule-status"), error.message, "error"); }
  }

  async function submitKasManager(event) {
    event.preventDefault();
    setStatus($("kas-manager-status"), "Menambahkan Admin…");
    try {
      await api(`/api/kas/${encodeURIComponent(activeKas)}/pengelola/admin`, {
        method: "POST",
        body: JSON.stringify({ phone: $("kas-manager-phone").value.trim(), name: $("kas-manager-name").value.trim() })
      });
      $("kas-manager-dialog").close();
      await loadKasManagers();
    } catch (error) { setStatus($("kas-manager-status"), error.message, "error"); }
  }

  async function submitKasCategory(event) {
    event.preventDefault();
    setStatus($("kas-category-status"), "Menyimpan…");
    try {
      const original = $("kas-category-original-id").value;
      const type = kasCategoryEditing?.type || $("kas-category-type").value;
      const payload = { jenis: type, id: original || $("kas-category-id").value.trim().toLowerCase(), nama: $("kas-category-label").value.trim(), aktif: kasCategoryEditing?.row?.aktif !== false };
      if (original) await api(`/api/kas/${encodeURIComponent(activeKas)}/kategori/${type}/${encodeURIComponent(original)}`, { method: "PUT", body: JSON.stringify(payload) });
      else await api(`/api/kas/${encodeURIComponent(activeKas)}/kategori`, { method: "POST", body: JSON.stringify(payload) });
      $("kas-category-dialog").close(); kasCategoryEditing = null; await loadKas(activeKas); setKasTab("kategori", false);
    } catch (error) { setStatus($("kas-category-status"), error.message, "error"); }
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

  function btDayDiff(fromDate, toDate) {
    const from = String(fromDate || "").trim();
    const to = String(toDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
    const a = Date.parse(`${from}T00:00:00Z`);
    const b = Date.parse(`${to}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  function btHstForDate(plantingDate, date) {
    return btDayDiff(plantingDate, date);
  }

  function btHstLabel(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
    return `${Number(value)} HST`;
  }

  function btCropCurrentHst(crop) {
    return crop?.plantingDate ? btHstForDate(crop.plantingDate, todayJakarta()) : null;
  }

  function btScheduleHst(row) {
    if (row?.targetHst !== null && row?.targetHst !== undefined && Number.isFinite(Number(row.targetHst))) {
      return Number(row.targetHst);
    }
    if (row?.plantingDate && row?.targetDate) {
      return btHstForDate(row.plantingDate, row.targetDate);
    }
    return null;
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
    if (!crop) return `Semua tanaman · ${season.nama}`;
    const hst = btCropCurrentHst(crop);
    return `${crop.komoditas} · Tanaman ${crop.id}${hst === null ? "" : ` · ${btHstLabel(hst)}`}`;
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
      const currentHst = btCropCurrentHst(crop);
      const planting = crop.plantingDate
        ? ` · tanam ${crop.plantingDate}${currentHst === null ? "" : ` · ${btHstLabel(currentHst)}`}`
        : "";
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
      const scheduleHst = btScheduleHst(row);
      const targetParts = [];
      if (scheduleHst !== null) targetParts.push(btHstLabel(scheduleHst));
      if (row.targetDate) targetParts.push(row.targetDate);
      const meta = document.createElement("div");
      meta.className = "item-meta";
      meta.textContent = `${targetParts.join(" · ")} · ${row.category} · ${row.cropName || ""} · ${row.status}`;
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
    if (activeGallery && activeGallery !== id) {
      stopGalleryVideoPolling();
      closeGalleryVideoReview();
      galleryBulkMode = false;
      galleryBulkSelected.clear();
    }
    activeGallery = id; $("gallery-select").value = id;
    const data = await api(`/api/galeri/${encodeURIComponent(id)}`);
    galleryDetail = data.galeri;
    $("gallery-name").textContent = galleryDetail.nama;
    $("gallery-id").textContent = `ID: ${galleryDetail.id}`;
    $("gallery-role").textContent = galleryDetail.role;
    $("gallery-photo-total").textContent = galleryDetail.foto;
    $("gallery-group-total").textContent = `${galleryDetail.grup} grup`;
    $("gallery-public-link").href = galleryDetail.publicUrl;
    $("gallery-public-link").textContent = galleryDetail.visibility === "private" ? "Buka Galeri privat ↗" : "Buka Galeri publik ↗";
    $("rename-gallery").hidden = galleryDetail.role !== "owner";
    $("gallery-access").hidden = galleryDetail.role !== "owner";
    $("add-gallery-admin").hidden = galleryDetail.role !== "owner";
    $("gallery-content").hidden = false;
    await Promise.all([loadGalleryPhotos(true), loadGalleryAdmins(), loadGalleryVideoJobs()]);
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

  function updateGalleryBulkUi() {
    $("gallery-bulk-toolbar").hidden = !galleryBulkMode;
    $("gallery-bulk-toggle").textContent = galleryBulkMode ? "Selesai memilih" : "Pilih beberapa";
    $("gallery-bulk-count").textContent = String(galleryBulkSelected.size);
    $("gallery-bulk-edit").disabled = galleryBulkSelected.size <= 0;
  }

  function setGalleryBulkMode(enabled, { clear = false } = {}) {
    galleryBulkMode = Boolean(enabled);
    if (clear || !galleryBulkMode) galleryBulkSelected.clear();
    renderGalleryPhotos();
  }

  function toggleGalleryBulkPhoto(photo, selected) {
    const number = Number(photo.nomor);
    if (selected) galleryBulkSelected.add(number);
    else galleryBulkSelected.delete(number);
    updateGalleryBulkUi();
    const card = document.querySelector(`[data-gallery-photo-number="${number}"]`);
    if (card) card.classList.toggle("bulk-selected", galleryBulkSelected.has(number));
  }

  function renderGalleryPhotos() {
    const list = $("gallery-photo-list"); list.replaceChildren();
    $("gallery-photo-count").textContent = `${galleryPhotoTotal} foto`;
    if (!galleryPhotos.length) list.appendChild(emptyBox("Belum ada foto."));
    for (const photo of galleryPhotos) {
      const number = Number(photo.nomor);
      const card = document.createElement("article");
      card.className = `photo-card${galleryBulkMode ? " bulk-mode" : ""}${galleryBulkSelected.has(number) ? " bulk-selected" : ""}`;
      card.dataset.galleryPhotoNumber = String(number);

      if (galleryBulkMode) {
        const picker = document.createElement("label"); picker.className = "photo-select-wrap"; picker.title = `Pilih ${photo.id}`;
        const check = document.createElement("input"); check.type = "checkbox"; check.checked = galleryBulkSelected.has(number); check.setAttribute("aria-label", `Pilih ${photo.id}`);
        check.addEventListener("change", () => toggleGalleryBulkPhoto(photo, check.checked));
        picker.appendChild(check); card.appendChild(picker);
      }

      const img = document.createElement("img"); img.className = "photo-thumb"; img.loading = "lazy"; img.src = photo.url; img.alt = photo.id;
      if (galleryBulkMode) img.addEventListener("click", () => toggleGalleryBulkPhoto(photo, !galleryBulkSelected.has(number)));
      const body = document.createElement("div"); body.className = "photo-body";
      const title = document.createElement("div"); title.className = "photo-title"; title.textContent = photo.id;
      const caption = document.createElement("div"); caption.className = "photo-caption"; caption.textContent = photo.keterangan || "Tanpa keterangan";
      const meta = document.createElement("div"); meta.className = "photo-meta"; meta.textContent = `${photo.grupAsal} · ${photo.uploader} · ${dateTimeFmt.format(new Date(photo.tanggal || Date.now()))}`;
      const actions = document.createElement("div"); actions.className = "photo-actions"; actions.append(button("Edit", "ghost", () => openGalleryPhotoEdit(photo)), button("Hapus", "danger-soft", () => deleteGalleryPhoto(photo)));
      body.append(title, caption, meta, actions); card.append(img, body); list.appendChild(card);
    }
    $("gallery-load-more").hidden = galleryPhotos.length >= galleryPhotoTotal;
    updateGalleryBulkUi();
  }

  function setGalleryUploadProgress(percent, label = "") {
    const wrap = $("gallery-upload-progress");
    if (!wrap) return;
    const value = Math.max(0, Math.min(100, Math.round(Number(percent || 0))));
    wrap.hidden = false;
    $("gallery-upload-progress-bar").style.width = `${value}%`;
    $("gallery-upload-progress-percent").textContent = `${value}%`;
    if (label) $("gallery-upload-progress-label").textContent = label;
  }

  function openGalleryPhotoUpload() {
    if (!activeGallery) return;
    $("gallery-upload-form").reset();
    $("gallery-upload-date").value = todayJakarta();
    $("gallery-upload-progress").hidden = true;
    $("gallery-upload-progress-bar").style.width = "0%";
    $("gallery-upload-progress-percent").textContent = "0%";
    setStatus($("gallery-upload-status"));
    $("gallery-upload-dialog").showModal();
  }

  async function submitGalleryPhotoUpload(event) {
    event.preventDefault();
    if (!activeGallery) return;
    const files = [...($("gallery-upload-files").files || [])];
    const caption = $("gallery-upload-caption").value.trim();
    const date = $("gallery-upload-date").value;
    if (!caption) return setStatus($("gallery-upload-status"), "Judul/keterangan wajib diisi.", "error");
    if (!date) return setStatus($("gallery-upload-status"), "Tanggal dokumentasi wajib diisi.", "error");
    if (!files.length) return setStatus($("gallery-upload-status"), "Pilih minimal satu foto.", "error");
    if (files.length > 50) return setStatus($("gallery-upload-status"), "Maksimal 50 foto sekali tambah.", "error");

    const submit = $("gallery-upload-submit");
    submit.disabled = true;
    const chunkSize = 10;
    let batchId = "";
    let savedTotal = 0;
    let duplicateTotal = 0;
    let failedTotal = 0;
    let processed = 0;

    try {
      for (let offset = 0; offset < files.length; offset += chunkSize) {
        const chunk = files.slice(offset, offset + chunkSize);
        const prepared = [];
        for (let i = 0; i < chunk.length; i++) {
          const absolute = offset + i + 1;
          const progress = 5 + Math.round((absolute / files.length) * 45);
          setGalleryUploadProgress(progress, `Menyiapkan foto ${absolute}/${files.length}…`);
          prepared.push(await prepareEvidenceFile(chunk[i]));
        }

        const isLast = offset + chunk.length >= files.length;
        setGalleryUploadProgress(
          50 + Math.round(((offset + chunk.length) / files.length) * 35),
          `Mengunggah ${Math.min(offset + chunk.length, files.length)}/${files.length} foto…`
        );
        setStatus($("gallery-upload-status"), "Mengirim foto ke penyimpanan Galeri…");
        const result = await api(`/api/galeri/${encodeURIComponent(activeGallery)}/foto`, {
          method: "POST",
          body: JSON.stringify({
            files: prepared,
            keterangan: caption,
            tanggal: date,
            batchId,
            finalize: isLast
          })
        });
        batchId = result.batchId || batchId;
        savedTotal += Number(result.jumlah || 0);
        duplicateTotal += Number(result.duplicate || 0);
        failedTotal += Number(result.failed || 0);
        processed += chunk.length;
        setGalleryUploadProgress(
          50 + Math.round((processed / files.length) * 35),
          `${processed}/${files.length} foto diproses…`
        );
      }

      setGalleryUploadProgress(92, "Memperbarui Galeri publik…");
      await loadGallery(activeGallery);
      const notes = [];
      if (savedTotal) notes.push(`${savedTotal} foto berhasil ditambahkan`);
      if (duplicateTotal) notes.push(`${duplicateTotal} foto yang sama dilewati`);
      if (failedTotal) notes.push(`${failedTotal} gagal`);
      setGalleryUploadProgress(100, "Selesai");
      setStatus($("gallery-upload-status"), notes.join(" · ") || "Selesai.", failedTotal ? "error" : "success");
      setTimeout(() => { if ($("gallery-upload-dialog").open) $("gallery-upload-dialog").close(); }, 650);
    } catch (error) {
      setStatus($("gallery-upload-status"), `${error.message}${savedTotal ? ` · ${savedTotal} foto sudah tersimpan` : ""}`, "error");
    } finally {
      submit.disabled = false;
    }
  }

  function openGalleryPhotoEdit(photo) {
    $("gallery-edit-number").value = photo.nomor;
    $("gallery-edit-id").textContent = photo.id;
    $("gallery-edit-caption").value = photo.keterangan || "";
    $("gallery-edit-date").value = timestampToDate(photo.tanggal || Date.now());
    setStatus($("gallery-edit-status"));
    $("gallery-edit-dialog").showModal();
  }

  function openGalleryBulkEdit() {
    if (!galleryBulkSelected.size) return;
    const first = galleryPhotos.find(photo => galleryBulkSelected.has(Number(photo.nomor)));
    $("gallery-bulk-dialog-count").textContent = `${galleryBulkSelected.size} foto`;
    $("gallery-bulk-caption").value = first?.keterangan || "";
    $("gallery-bulk-date").value = first ? timestampToDate(first.tanggal || Date.now()) : todayJakarta();
    setStatus($("gallery-bulk-status"));
    $("gallery-bulk-dialog").showModal();
  }

  function syncGalleryAccessOptions() {
    const isPrivate = $("gallery-access-visibility").value === "private";
    $("gallery-private-options").hidden = !isPrivate;
  }

  function openGalleryAccessDialog() {
    if (!galleryDetail) return;
    $("gallery-access-visibility").value = galleryDetail.visibility === "private" ? "private" : "public";
    $("gallery-access-hours").value = String(galleryDetail.privateSessionHours || 12);
    $("gallery-access-password").value = "";
    $("gallery-access-password").placeholder = galleryDetail.hasPrivatePassword ? "Kosongkan untuk memakai sandi yang sekarang" : "Buat sandi Galeri";
    $("gallery-private-note").textContent = galleryDetail.hasPrivatePassword
      ? "Galeri sudah memiliki sandi. Kosongkan kolom sandi jika tidak ingin menggantinya."
      : "Saat pertama kali menjadikan Galeri privat, Anda wajib membuat sandi.";
    syncGalleryAccessOptions();
    setStatus($("gallery-access-status"));
    $("gallery-access-dialog").showModal();
  }

  async function deleteGalleryPhoto(photo) {
    if (!confirm(`Hapus ${photo.id} dari Galeri ${galleryDetail?.nama || activeGallery}?\n\nFile juga akan dihapus dari penyimpanan Galeri.`)) return;
    await api(`/api/galeri/${encodeURIComponent(activeGallery)}/foto/${encodeURIComponent(photo.nomor)}`, { method: "DELETE", body: "{}" });
    galleryBulkSelected.delete(Number(photo.nomor));
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



  function setGalleryVideoFormLocked(locked) {
    const form = $("gallery-video-form");
    if (!form) return;
    form.hidden = Boolean(locked);
    form.querySelectorAll("input, select, textarea, button").forEach(el => {
      el.disabled = Boolean(locked);
    });
  }

  function showGalleryVideoBusyCard({ stage = "Memproses", title = "PROxyz sedang bekerja…", detail = "", percent = 0, indeterminate = false } = {}) {
    const card = $("gallery-video-busy-card");
    if (!card) return;
    card.hidden = false;
    $("gallery-video-busy-stage").textContent = stage;
    $("gallery-video-busy-title").textContent = title;
    $("gallery-video-busy-detail").textContent = detail;
    const value = Math.max(0, Math.min(100, Number(percent || 0)));
    $("gallery-video-busy-percent").textContent = indeterminate ? "…" : `${Math.round(value)}%`;
    const track = $("gallery-video-busy-track");
    track.classList.toggle("indeterminate", Boolean(indeterminate));
    $("gallery-video-busy-bar").style.width = indeterminate ? "38%" : `${value}%`;
  }

  function hideGalleryVideoBusyCard() {
    const card = $("gallery-video-busy-card");
    if (card) card.hidden = true;
  }

  function resetGalleryVideoProgress() {
    const wrap = $("gallery-video-progress-wrap");
    if (wrap) wrap.hidden = true;
    if ($("gallery-video-progress-bar")) $("gallery-video-progress-bar").style.width = "0%";
    if ($("gallery-video-progress-percent")) $("gallery-video-progress-percent").textContent = "0%";
    if ($("gallery-video-progress-label")) $("gallery-video-progress-label").textContent = "Menyiapkan…";
  }

  function finishGalleryVideoProcessing({ clearFile = true, clearStatus = true } = {}) {
    galleryVideoProcessingJobId = "";
    galleryVideoUploadBusy = false;
    setGalleryVideoFormLocked(false);
    hideGalleryVideoBusyCard();
    resetGalleryVideoProgress();
    if (clearStatus) setStatus($("gallery-video-status"));
    const submit = $("gallery-video-submit");
    if (submit) submit.disabled = false;
    if (clearFile && $("gallery-video-file")) $("gallery-video-file").value = "";
  }

  function showGalleryReviewLoader(title = "Menyiapkan pilihan foto…", detail = "", percent = 0, indeterminate = false) {
    const loader = $("gallery-video-review-loader");
    if (!loader) return;
    loader.hidden = false;
    $("gallery-video-review-loader-title").textContent = title;
    $("gallery-video-review-loader-detail").textContent = detail;
    const value = Math.max(0, Math.min(100, Number(percent || 0)));
    $("gallery-video-review-loader-percent").textContent = indeterminate ? "…" : `${Math.round(value)}%`;
    const track = $("gallery-video-review-loader-track");
    track.classList.toggle("indeterminate", Boolean(indeterminate));
    $("gallery-video-review-loader-bar").style.width = indeterminate ? "38%" : `${value}%`;
  }

  function hideGalleryReviewLoader() {
    const loader = $("gallery-video-review-loader");
    if (loader) loader.hidden = true;
  }


  function clearGalleryVideoObjectUrls() {
    galleryVideoImageLoadToken += 1;
    for (const url of galleryVideoObjectUrls) URL.revokeObjectURL(url);
    galleryVideoObjectUrls = [];
  }

  function stopGalleryVideoPolling() {
    if (galleryVideoPollTimer) clearInterval(galleryVideoPollTimer);
    galleryVideoPollTimer = null;
  }

  function galleryVideoStatusLabel(status) {
    return ({
      uploading: "Upload",
      queued: "Antrean",
      processing: "Memproses",
      publishing: "Menyimpan",
      review: "Siap dipilih",
      published: "Sudah disimpan",
      failed: "Gagal"
    })[status] || status || "—";
  }

  function galleryVideoStatusClass(status) {
    if (status === "review") return "ready";
    if (status === "published") return "published";
    if (status === "failed") return "failed";
    if (["uploading", "queued", "processing", "publishing"].includes(status)) return "working";
    return "";
  }

  function upsertGalleryVideoJob(job) {
    if (!job) return;
    const index = galleryVideoJobs.findIndex(row => row.id === job.id);
    if (index >= 0) galleryVideoJobs[index] = job;
    else galleryVideoJobs.unshift(job);
    galleryVideoJobs.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }

  function switchGalleryTab(tab) {
    const wanted = ["foto", "video", "draft"].includes(tab) ? tab : "foto";
    document.querySelectorAll("[data-gallery-tab]").forEach(el => el.classList.toggle("active", el.dataset.galleryTab === wanted));
    for (const name of ["foto", "video", "draft"]) $("gallery-" + name + "-panel").hidden = name !== wanted;
    if (wanted === "video" && !$("gallery-video-date").value) $("gallery-video-date").value = todayJakarta();
    if (wanted === "draft") loadGalleryVideoJobs().catch(showError);
  }

  function updateGalleryDraftBadge() {
    const active = galleryVideoJobs.filter(job => !["published"].includes(job.status)).length;
    const badge = $("gallery-draft-badge");
    badge.textContent = String(active);
    badge.hidden = active <= 0;
  }

  async function loadGalleryVideoJobs() {
    if (!activeGallery) return;
    const data = await api(`/api/galeri/${encodeURIComponent(activeGallery)}/video-review`);
    galleryVideoJobs = Array.isArray(data.draft) ? data.draft : [];
    updateGalleryDraftBadge();
    renderGalleryVideoJobs();
    if (activeGalleryVideoJob) {
      const fresh = galleryVideoJobs.find(row => row.id === activeGalleryVideoJob.id);
      if (fresh) activeGalleryVideoJob = fresh;
    }
  }

  function renderGalleryVideoJobs() {
    const list = $("gallery-video-draft-list");
    list.replaceChildren();
    if (!galleryVideoJobs.length) {
      list.appendChild(emptyBox("Belum ada hasil video sementara. Buat dari tab Video → Foto."));
      return;
    }

    for (const job of galleryVideoJobs) {
      const card = document.createElement("article");
      card.className = "video-draft-card";

      const top = document.createElement("div");
      top.className = "video-draft-top";
      const titleWrap = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = job.title || "Dokumentasi video";
      const sub = document.createElement("span");
      const dateText = job.eventDate ? dateFmt.format(new Date(`${job.eventDate}T12:00:00+07:00`)) : "Tanpa tanggal";
      sub.textContent = `${dateText} · ${job.sourceFileName || "video"} · ${formatBytes(job.sourceSize)}`;
      titleWrap.append(title, sub);
      const status = document.createElement("span");
      status.className = `video-status ${galleryVideoStatusClass(job.status)}`.trim();
      status.textContent = galleryVideoStatusLabel(job.status);
      top.append(titleWrap, status);

      const progress = document.createElement("div");
      progress.className = "draft-progress";
      const bar = document.createElement("span");
      const visibleProgress = job.status === "publishing" ? Number(job.publishProgress || 0) : Number(job.progress || 0);
      bar.style.width = `${Math.max(0, Math.min(100, visibleProgress))}%`;
      progress.appendChild(bar);

      const info = document.createElement("p");
      info.className = "video-draft-message";
      const faceClusters = new Set((job.candidates || []).map(row => row.faceCluster).filter(Boolean)).size;
      const faceInfo = job.faceMode === "event-face-diversity"
        ? ` · ${faceClusters || "?"} kelompok orang/subjek`
        : job.faceMode && job.faceMode !== "pending" ? " · variasi waktu dan gambar" : "";
      const eventInfo = job.eventCount ? ` · ${job.eventCount} kejadian` : "";
      const perFaceInfo = job.maxPerFace ? ` · maks ${job.maxPerFace} pilihan/orang` : "";
      info.textContent = `${job.message || ""}${eventInfo}${job.candidateCount ? ` · ${job.candidateCount} pilihan foto` : ""}${faceInfo}${perFaceInfo}`;

      const actions = document.createElement("div");
      actions.className = "item-actions";
      if (job.status === "review") actions.appendChild(button("Pilih foto", "primary compact", () => openGalleryVideoReview(job).catch(showError)));
      if (job.status === "failed") actions.appendChild(button("Proses ulang", "ghost compact", () => retryGalleryVideoJob(job).catch(showError)));
      if (["review", "failed", "published", "uploading"].includes(job.status) && !galleryVideoUploadBusy) {
        actions.appendChild(button("Hapus hasil sementara", "danger-soft compact", () => deleteGalleryVideoJob(job).catch(showError)));
      }
      if (["queued", "processing", "uploading", "publishing"].includes(job.status)) {
        const refresh = button("Cek status", "ghost compact", () => refreshGalleryVideoJob(job.id).catch(showError));
        actions.appendChild(refresh);
      }

      card.append(top, progress, info, actions);
      list.appendChild(card);
    }
  }

  async function refreshGalleryVideoJob(jobId) {
    if (!activeGallery || !jobId) return null;
    const data = await api(`/api/galeri/${encodeURIComponent(activeGallery)}/video-review/${encodeURIComponent(jobId)}`);
    const job = data.draft;
    upsertGalleryVideoJob(job);
    updateGalleryDraftBadge();
    renderGalleryVideoJobs();
    return job;
  }

  function startGalleryVideoPolling(jobId) {
    stopGalleryVideoPolling();
    galleryVideoProcessingJobId = jobId;
    const poll = async () => {
      try {
        const job = await refreshGalleryVideoJob(jobId);
        if (!job) return;
        const progress = Math.max(36, Number(job.progress || 36));
        const detail = job.message || (job.status === "queued" ? "Menunggu giliran pemrosesan…" : "Menganalisis video dan mencari momen terbaik…");
        setGalleryVideoProgress(progress, detail);
        showGalleryVideoBusyCard({
          stage: job.status === "queued" ? "Antrean pemrosesan" : "Analisis video",
          title: job.status === "queued" ? "Video sudah diterima PROxyz" : "Mencari kejadian & foto terbaik…",
          detail,
          percent: progress,
          indeterminate: false
        });
        if (job.status === "review") {
          stopGalleryVideoPolling();
          setGalleryVideoProgress(100, "Foto siap dipilih.");
          finishGalleryVideoProcessing({ clearFile: true });
          switchGalleryTab("draft");
          await openGalleryVideoReview(job);
        } else if (job.status === "failed") {
          stopGalleryVideoPolling();
          setStatus($("gallery-video-status"), job.message || "Pemrosesan video gagal.", "error");
          finishGalleryVideoProcessing({ clearFile: false, clearStatus: false });
        }
      } catch (error) {
        stopGalleryVideoPolling();
        setStatus($("gallery-video-status"), `${error.message} Hasil mungkin masih diproses; cek tab Foto sementara.`, "error");
        finishGalleryVideoProcessing({ clearFile: false, clearStatus: false });
      }
    };
    poll();
    galleryVideoPollTimer = setInterval(poll, 2200);
  }

  function setGalleryVideoProgress(percent, label) {
    const value = Math.max(0, Math.min(100, Number(percent || 0)));
    $("gallery-video-progress-wrap").hidden = false;
    $("gallery-video-progress-bar").style.width = `${value}%`;
    $("gallery-video-progress-percent").textContent = `${Math.round(value)}%`;
    $("gallery-video-progress-label").textContent = label || "Memproses…";
  }

  async function uploadGalleryVideoChunk(job, index, blob, attempt = 1) {
    try {
      const response = await apiRaw(`/api/galeri/${encodeURIComponent(activeGallery)}/video-review/${encodeURIComponent(job.id)}/chunk?index=${index}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob
      });
      return await response.json();
    } catch (error) {
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 800 * attempt));
        return uploadGalleryVideoChunk(job, index, blob, attempt + 1);
      }
      throw error;
    }
  }

  async function submitGalleryVideo(event) {
    event.preventDefault();
    if (galleryVideoUploadBusy || galleryVideoProcessingJobId) return;
    const file = $("gallery-video-file").files?.[0];
    const title = $("gallery-video-title").value.trim();
    const eventDate = $("gallery-video-date").value;
    const targetPerEvent = Number($("gallery-video-target").value || 30);
    const maxPerFace = Number($("gallery-video-max-per-face").value || 3);
    const maxTotalPhotos = Number($("gallery-video-max-total").value || 250);
    const intervalSec = Number($("gallery-video-interval").value || 0.5);
    if (!activeGallery) return setStatus($("gallery-video-status"), "Pilih Galeri terlebih dahulu.", "error");
    if (!file) return setStatus($("gallery-video-status"), "Pilih video terlebih dahulu.", "error");
    if (!title) return setStatus($("gallery-video-status"), "Nama kegiatan wajib diisi.", "error");
    if (!eventDate) return setStatus($("gallery-video-status"), "Tanggal kegiatan wajib diisi.", "error");

    galleryVideoUploadBusy = true;
    const submit = $("gallery-video-submit");
    submit.disabled = true;
    setStatus($("gallery-video-status"));
    setGalleryVideoFormLocked(true);
    showGalleryVideoBusyCard({
      stage: "Menyiapkan upload",
      title: "Mengirim video ke PROxyz…",
      detail: `${file.name} · ${formatBytes(file.size)}`,
      percent: 0
    });
    setGalleryVideoProgress(0, "Menyiapkan upload…");

    try {
      const created = await api(`/api/galeri/${encodeURIComponent(activeGallery)}/video-review`, {
        method: "POST",
        body: JSON.stringify({
          title,
          eventDate,
          fileName: file.name,
          mimeType: file.type || "video/mp4",
          fileSize: file.size,
          targetPerEvent,
          maxPerFace,
          maxTotalPhotos,
          intervalSec
        })
      });
      const job = created.draft;
      galleryVideoProcessingJobId = job.id;
      upsertGalleryVideoJob(job);
      renderGalleryVideoJobs();
      const chunkSize = Math.max(1024 * 1024, Number(created.chunkMaxBytes || 12 * 1024 * 1024));
      const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));

      for (let index = 0; index < totalChunks; index += 1) {
        const start = index * chunkSize;
        const end = Math.min(file.size, start + chunkSize);
        const blob = file.slice(start, end);
        await uploadGalleryVideoChunk(job, index, blob);
        const ratio = end / Math.max(1, file.size);
        const percent = Math.min(35, ratio * 35);
        const label = `Bagian ${index + 1}/${totalChunks} · ${formatBytes(end)} / ${formatBytes(file.size)}`;
        setGalleryVideoProgress(percent, `Upload ${label}`);
        showGalleryVideoBusyCard({
          stage: "Upload video",
          title: "Mengirim video ke PROxyz…",
          detail: label,
          percent
        });
      }

      showGalleryVideoBusyCard({
        stage: "Upload selesai",
        title: "Menyiapkan analisis video…",
        detail: "Video sudah terkirim. PROxyz mulai memisahkan kejadian dan mencari foto terbaik.",
        percent: 36,
        indeterminate: false
      });

      const completed = await api(`/api/galeri/${encodeURIComponent(activeGallery)}/video-review/${encodeURIComponent(job.id)}/complete`, {
        method: "POST",
        body: "{}"
      });
      upsertGalleryVideoJob(completed.draft);
      updateGalleryDraftBadge();
      renderGalleryVideoJobs();
      const progress = Math.max(36, completed.draft.progress || 36);
      setGalleryVideoProgress(progress, "Upload selesai. PROxyz memproses video…");
      showGalleryVideoBusyCard({
        stage: "Analisis video",
        title: "Mencari kejadian & foto terbaik…",
        detail: completed.draft.message || "Mendeteksi perpindahan kejadian, wajah/subjek, dan variasi momen.",
        percent: progress,
        indeterminate: false
      });
      galleryVideoUploadBusy = false;
      startGalleryVideoPolling(job.id);
    } catch (error) {
      galleryVideoUploadBusy = false;
      galleryVideoProcessingJobId = "";
      setGalleryVideoFormLocked(false);
      hideGalleryVideoBusyCard();
      submit.disabled = false;
      setStatus($("gallery-video-status"), error.message, "error");
      renderGalleryVideoJobs();
    }
  }

  async function fetchGalleryCandidateBlob(jobId, candidateId) {
    const response = await apiRaw(`/api/galeri/${encodeURIComponent(activeGallery)}/video-review/${encodeURIComponent(jobId)}/candidate/${encodeURIComponent(candidateId)}`);
    return response.blob();
  }

  function updateGalleryVideoSelection() {
    $("gallery-video-selected-count").textContent = String(galleryVideoSelected.size);
    const publish = $("gallery-video-publish");
    publish.disabled = galleryVideoSelected.size <= 0;
    publish.textContent = galleryVideoSelected.size > 0
      ? `Simpan ${galleryVideoSelected.size} foto terpilih`
      : "Pilih foto untuk disimpan";
    document.querySelectorAll(".candidate-card[data-candidate-id]").forEach(card => {
      const selected = galleryVideoSelected.has(card.dataset.candidateId);
      card.classList.toggle("selected", selected);
      const input = card.querySelector("input[type=checkbox]");
      if (input) input.checked = selected;
    });
  }

  async function loadGalleryCandidateImages(job, token) {
    const cards = [...document.querySelectorAll(".candidate-card[data-candidate-id]")];
    let cursor = 0;
    let completed = 0;
    const total = cards.length;
    if (!total) {
      showGalleryReviewLoader("Review siap", "Tidak ada pilihan foto pada hasil sementara ini.", 100);
      return;
    }
    showGalleryReviewLoader("Memuat pilihan foto…", `0 dari ${total} foto`, 0);
    const worker = async () => {
      while (cursor < cards.length) {
        const card = cards[cursor++];
        if (token !== galleryVideoImageLoadToken) return;
        const id = card.dataset.candidateId;
        const img = card.querySelector("img");
        try {
          const blob = await fetchGalleryCandidateBlob(job.id, id);
          if (token !== galleryVideoImageLoadToken) return;
          const url = URL.createObjectURL(blob);
          galleryVideoObjectUrls.push(url);
          img.src = url;
          img.classList.remove("loading");
          card.classList.remove("is-loading");
        } catch (_) {
          img.alt = "Gagal memuat foto";
          img.classList.remove("loading");
          card.classList.remove("is-loading");
          card.classList.add("image-error");
        } finally {
          completed += 1;
          const percent = (completed / Math.max(1, total)) * 100;
          showGalleryReviewLoader(
            completed >= total ? "Foto siap dipilih" : "Memuat pilihan foto…",
            `${completed} dari ${total} foto${completed >= total ? " sudah siap dipilih" : ""}`,
            percent
          );
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, cards.length) }, worker));
  }

  function formatVideoTime(seconds) {
    const total = Math.max(0, Math.round(Number(seconds || 0)));
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  async function renameGalleryVideoEvent(job, eventRow) {
    const current = eventRow?.label || eventRow?.id || "Kejadian";
    const next = prompt("Nama kejadian:", current);
    if (next === null || !next.trim() || next.trim() === current) return;
    const data = await api(`/api/galeri/${encodeURIComponent(activeGallery)}/video-review/${encodeURIComponent(job.id)}/event/${encodeURIComponent(eventRow.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ label: next.trim() })
    });
    upsertGalleryVideoJob(data.draft);
    activeGalleryVideoJob = data.draft;
    renderGalleryVideoJobs();
    await openGalleryVideoReview(data.draft);
  }

  async function openGalleryVideoReview(job) {
    if (!job || job.status !== "review") throw new Error("Foto sementara belum siap dipilih.");
    if (galleryVideoReviewBusy) return;
    galleryVideoReviewBusy = true;
    activeGalleryVideoJob = job;
    clearGalleryVideoObjectUrls();
    $("gallery-video-review").hidden = false;
    showGalleryReviewLoader("Menyiapkan pilihan foto…", "Menyusun kejadian dan pilihan foto.", 0, false);
    const token = galleryVideoImageLoadToken;
    galleryVideoSelected = new Set((job.candidates || []).map(row => row.id));

    $("gallery-video-review-title").textContent = job.title || "Dokumentasi video";
    const faceClusters = new Set((job.candidates || []).map(row => row.faceCluster).filter(Boolean));
    const mode = job.faceMode === "event-face-diversity"
      ? `Maks ${job.maxPerFace || 3} pilihan/orang per kejadian`
      : "Variasi waktu dan gambar";
    $("gallery-video-review-meta").textContent = `${job.eventDate || ""} · ${mode} · ${job.sourceWidth || "?"}×${job.sourceHeight || "?"} · ${number.format(job.durationSec || 0)} dtk`;
    $("gallery-video-event-count").textContent = String(job.eventCount || (job.events || []).length || 1);
    $("gallery-video-candidate-count").textContent = String(job.candidateCount || (job.candidates || []).length);
    $("gallery-video-face-count").textContent = job.faceMode === "event-face-diversity" ? String(faceClusters.size || 0) : "—";
    $("gallery-video-publish-caption").value = job.title || "Dokumentasi video";
    $("gallery-video-publish-date").value = job.eventDate || todayJakarta();
    setStatus($("gallery-video-publish-status"));

    const list = $("gallery-video-candidates");
    list.replaceChildren();

    const events = Array.isArray(job.events) && job.events.length
      ? [...job.events].sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      : [{ id: "E01", order: 1, label: "Kejadian 01", startSec: 0, endSec: job.durationSec || 0 }];

    for (const eventRow of events) {
      const eventCandidates = (job.candidates || [])
        .filter(row => (row.eventId || "E01") === eventRow.id)
        .sort((a, b) => Number(a.timestampSec || 0) - Number(b.timestampSec || 0));
      if (!eventCandidates.length) continue;

      const group = document.createElement("section");
      group.className = "candidate-event-group";
      group.dataset.eventId = eventRow.id;

      const head = document.createElement("div");
      head.className = "candidate-event-head";
      const text = document.createElement("div");
      const heading = document.createElement("h3");
      heading.textContent = eventRow.label || eventRow.id;
      const meta = document.createElement("p");
      const eventFaces = new Set(eventCandidates.map(row => row.faceCluster).filter(Boolean));
      meta.className = "muted small";
      meta.textContent = `${formatVideoTime(eventRow.startSec)}–${formatVideoTime(eventRow.endSec)} · ${eventCandidates.length} pilihan foto${eventFaces.size ? ` · ${eventFaces.size} orang/subjek` : ""}`;
      text.append(heading, meta);

      const tools = document.createElement("div");
      tools.className = "candidate-event-tools";
      tools.append(
        button("Pilih kejadian", "ghost compact", () => {
          for (const row of eventCandidates) galleryVideoSelected.add(row.id);
          updateGalleryVideoSelection();
        }),
        button("Kosongkan", "ghost compact", () => {
          for (const row of eventCandidates) galleryVideoSelected.delete(row.id);
          updateGalleryVideoSelection();
        }),
        button("Ganti nama", "ghost compact", () => renameGalleryVideoEvent(job, eventRow).catch(showError))
      );
      head.append(text, tools);

      const grid = document.createElement("div");
      grid.className = "candidate-grid candidate-event-grid";

      for (const candidate of eventCandidates) {
        const card = document.createElement("label");
        card.className = "candidate-card selected is-loading";
        card.dataset.candidateId = candidate.id;

        const media = document.createElement("div");
        media.className = "candidate-media";
        const img = document.createElement("img");
        img.className = "candidate-thumb loading";
        img.alt = candidate.id;
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = true;
        check.addEventListener("change", () => {
          if (check.checked) galleryVideoSelected.add(candidate.id);
          else galleryVideoSelected.delete(candidate.id);
          updateGalleryVideoSelection();
        });
        const mark = document.createElement("span");
        mark.className = "candidate-check";
        mark.textContent = "✓";
        media.append(img, check, mark);

        const body = document.createElement("div");
        body.className = "candidate-body";
        const title = document.createElement("strong");
        title.textContent = `${candidate.id} · ${formatVideoTime(candidate.timestampSec)}`;
        const metaLine = document.createElement("span");
        metaLine.textContent = Number(candidate.faceCount || 0) > 0
          ? `${candidate.faceCount} orang/subjek terdeteksi`
          : "Momen atau objek berbeda";
        const reason = document.createElement("small");
        reason.textContent = candidate.reason || "Momen unik";
        body.append(title, metaLine, reason);
        card.append(media, body);
        grid.appendChild(card);
      }

      group.append(head, grid);
      list.appendChild(group);
    }

    updateGalleryVideoSelection();
    $("gallery-video-review").scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      await loadGalleryCandidateImages(job, token);
      if (token === galleryVideoImageLoadToken) {
        await new Promise(resolve => setTimeout(resolve, 180));
        hideGalleryReviewLoader();
      }
    } finally {
      galleryVideoReviewBusy = false;
    }
  }

  function closeGalleryVideoReview() {
    activeGalleryVideoJob = null;
    galleryVideoSelected.clear();
    galleryVideoReviewBusy = false;
    hideGalleryReviewLoader();
    clearGalleryVideoObjectUrls();
    $("gallery-video-candidates").replaceChildren();
    $("gallery-video-review").hidden = true;
  }

  async function publishGalleryVideoSelection() {
    const job = activeGalleryVideoJob;
    if (!job || job.status !== "review") return;
    const ids = [...galleryVideoSelected];
    if (!ids.length) return setStatus($("gallery-video-publish-status"), "Pilih minimal satu foto.", "error");
    if (!confirm(`Simpan ${ids.length} foto ke Galeri ${galleryDetail?.nama || activeGallery}?\n\nFoto akan disimpan dan kemudian tampil di Galeri publik.`)) return;

    const buttonEl = $("gallery-video-publish");
    buttonEl.disabled = true;
    buttonEl.dataset.originalText = buttonEl.textContent;
    buttonEl.textContent = `Menyimpan ${ids.length} foto…`;
    showGalleryReviewLoader("Menyimpan ke Galeri…", `Menyiapkan ${ids.length} foto terpilih.`, 0, false);
    setStatus($("gallery-video-publish-status"), "Menyiapkan penyimpanan foto…");

    try {
      const started = await api(`/api/galeri/${encodeURIComponent(activeGallery)}/video-review/${encodeURIComponent(job.id)}/publish`, {
        method: "POST",
        body: JSON.stringify({
          selectedIds: ids,
          caption: $("gallery-video-publish-caption").value.trim() || job.title,
          eventDate: $("gallery-video-publish-date").value || job.eventDate
        })
      });
      if (started.draft) {
        upsertGalleryVideoJob(started.draft);
        activeGalleryVideoJob = started.draft;
        renderGalleryVideoJobs();
      }

      let finished = null;
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 650));
        const data = await api(`/api/galeri/${encodeURIComponent(activeGallery)}/video-review/${encodeURIComponent(job.id)}`);
        const fresh = data.draft;
        if (!fresh) throw new Error("Status penyimpanan tidak ditemukan.");
        upsertGalleryVideoJob(fresh);
        activeGalleryVideoJob = fresh;
        renderGalleryVideoJobs();

        const progress = Math.max(0, Math.min(100, Number(fresh.publishProgress || 0)));
        const total = Number(fresh.publishTotal || ids.length);
        const done = Number(fresh.publishDone || 0);
        const detail = fresh.publishMessage || `${done} dari ${total} foto diproses.`;
        showGalleryReviewLoader("Menyimpan ke Galeri…", detail, progress, false);
        setStatus($("gallery-video-publish-status"), `${detail} ${Math.round(progress)}%`);

        if (fresh.status === "published" || fresh.publishStatus === "done") {
          finished = fresh;
          break;
        }
        if (fresh.publishStatus === "failed") {
          throw new Error(fresh.publishMessage || "Penyimpanan foto gagal.");
        }
      }

      showGalleryReviewLoader("Selesai", finished.publishMessage || "Foto berhasil disimpan ke Galeri.", 100, false);
      setStatus($("gallery-video-publish-status"), finished.publishMessage || "Foto berhasil disimpan ke Galeri.", "success");
      await new Promise(resolve => setTimeout(resolve, 450));
      // Setelah berhasil disimpan, hasil sementara tidak lagi diperlukan.
      // Hapus job + file sementara, sementara foto yang sudah masuk Galeri tetap aman.
      try {
        await api(`/api/galeri/${encodeURIComponent(activeGallery)}/video-review/${encodeURIComponent(job.id)}`, { method: "DELETE", body: "{}" });
      } catch (cleanupError) {
        console.warn("[Admin Galeri] Hasil sementara belum dapat dibersihkan otomatis:", cleanupError.message);
      }
      closeGalleryVideoReview();
      resetGalleryVideoProgress();
      setStatus($("gallery-video-status"));
      await loadGallery(activeGallery);
      await loadGalleryVideoJobs();
      switchGalleryTab("foto");
    } catch (error) {
      hideGalleryReviewLoader();
      setStatus($("gallery-video-publish-status"), error.message, "error");
      buttonEl.disabled = false;
      buttonEl.textContent = buttonEl.dataset.originalText || "Simpan foto terpilih";
      updateGalleryVideoSelection();
    }
  }

  async function retryGalleryVideoJob(job) {
    if (!confirm(`Proses ulang draft “${job.title || job.id}”?`)) return;
    const data = await api(`/api/galeri/${encodeURIComponent(activeGallery)}/video-review/${encodeURIComponent(job.id)}/retry`, { method: "POST", body: "{}" });
    upsertGalleryVideoJob(data.draft);
    renderGalleryVideoJobs();
    startGalleryVideoPolling(job.id);
  }

  async function deleteGalleryVideoJob(job) {
    if (!confirm(`Hapus draft video “${job.title || job.id}”?\n\nVideo sumber dan foto sementara akan dihapus. Foto yang sudah disimpan di Galeri tidak ikut dihapus.`)) return;
    await api(`/api/galeri/${encodeURIComponent(activeGallery)}/video-review/${encodeURIComponent(job.id)}`, { method: "DELETE", body: "{}" });
    if (activeGalleryVideoJob?.id === job.id) closeGalleryVideoReview();
    await loadGalleryVideoJobs();
  }
  // ---------- EVENTS ----------
  $("phone-form").addEventListener("submit", async event => {
    event.preventDefault(); setStatus($("auth-status"), "Mengirim kode…");
    try { const result = await api("/api/auth/request", { method: "POST", body: JSON.stringify({ phone: $("phone").value }) }); challengeId = result.challengeId; challengeExpiresAt = Number(result.expiresAt) || Date.now() + 300000; saveOtpChallenge($("phone").value); $("phone-form").hidden = true; $("otp-form").hidden = false; $("otp").value = ""; $("otp").focus(); setStatus($("auth-status"), "Kode OTP sudah dikirim ke WhatsApp.", "success"); } catch (error) { setStatus($("auth-status"), error.message, "error"); }
  });

  $("otp-form").addEventListener("submit", async event => {
    event.preventDefault(); setStatus($("auth-status"), "Memeriksa kode…");
    try { if (!challengeId) throw new Error("Kirim kode OTP terlebih dahulu."); const verified = await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ challengeId, code: $("otp").value }) }); saveSessionToken(verified.token || ""); clearOtpChallenge(); setStatus($("auth-status")); await bootstrapSession(); } catch (error) { if (/kedaluwarsa|tidak ditemukan|berakhir/i.test(error.message)) clearOtpChallenge(); setStatus($("auth-status"), error.message, "error"); }
  });
  $("change-phone").addEventListener("click", () => { clearOtpChallenge(); setStatus($("auth-status")); });
  $("logout").addEventListener("click", async () => { try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch (_) {} saveSessionToken(""); clearSession(); });
  document.querySelectorAll(".app-tab").forEach(el => el.addEventListener("click", () => switchView(el.dataset.view)));
  $("edit-my-name").addEventListener("click", () => openUserNameDialog(null, true));
  $("close-user-name").addEventListener("click", () => $("user-name-dialog").close());
  $("users-refresh").addEventListener("click", () => loadUsers().catch(showError));
  $("users-search").addEventListener("input", renderUsers);
  $("user-name-form").addEventListener("submit", async event => {
    event.preventDefault();
    const userId = $("user-name-id").value;
    const name = $("user-name-input").value.trim();
    const isSelf = userId === me.userId;
    setStatus($("user-name-status"), "Menyimpan…");
    try {
      if (isSelf) {
        const data = await api("/api/me/name", { method: "PATCH", body: JSON.stringify({ name }) });
        me = data.user;
        renderMe();
      } else {
        await api("/api/users/name", { method: "PATCH", body: JSON.stringify({ userId, name }) });
        await loadUsers();
      }
      $("user-name-dialog").close();
    } catch (error) { setStatus($("user-name-status"), error.message, "error"); }
  });

  // Kas events
  $("kas-select").addEventListener("change", () => loadKas($("kas-select").value).catch(showError));
  document.querySelectorAll("[data-kas-tab]").forEach(btn => btn.addEventListener("click", () => setKasTab(btn.dataset.kasTab)));
  $("kas-report-month").addEventListener("click", () => { setKasReportMonth(); loadKasReport().catch(showError); });
  $("kas-report-year").addEventListener("click", () => { setKasReportYear(); loadKasReport().catch(showError); });
  $("kas-report-month-select").addEventListener("change", updateKasReportShortcutLabels);
  $("kas-report-year-select").addEventListener("change", updateKasReportShortcutLabels);
  $("kas-report-load").addEventListener("click", () => loadKasReport().catch(showError));
  $("kas-report-wa-pdf").addEventListener("click", () => sendKasReportWhatsApp("pdf_self").catch(showError));
  $("kas-report-wa-pdf-target").addEventListener("click", () => sendKasReportWhatsApp("pdf_group").catch(showError));
  $("kas-report-wa-complete").addEventListener("click", () => sendKasReportWhatsApp("complete_group").catch(showError));
  $("kas-report-wa-simple").addEventListener("click", () => sendKasReportWhatsApp("simple_group").catch(showError));
  $("kas-schedule-add").addEventListener("click", () => openKasScheduleDialog());
  $("close-kas-schedule").addEventListener("click", () => { kasScheduleEditing = null; $("kas-schedule-dialog").close(); });
  $("kas-schedule-form").addEventListener("submit", submitKasSchedule);
  $("kas-schedule-amount").addEventListener("input", () => formatNominalInput($("kas-schedule-amount")));
  $("kas-manager-add").addEventListener("click", openKasManagerDialog);
  $("close-kas-manager").addEventListener("click", () => $("kas-manager-dialog").close());
  $("kas-manager-form").addEventListener("submit", submitKasManager);
  $("kas-web-access-save").addEventListener("click", () => saveKasWebAccess().catch(showError));
  $("kas-viewer-add").addEventListener("click", openKasViewerDialog);
  $("close-kas-viewer").addEventListener("click", () => $("kas-viewer-dialog").close());
  $("kas-viewer-form").addEventListener("submit", submitKasViewer);
  $("kas-category-add").addEventListener("click", () => openKasCategoryDialog("keluar"));
  $("close-kas-category").addEventListener("click", () => { kasCategoryEditing = null; $("kas-category-dialog").close(); });
  $("kas-category-form").addEventListener("submit", submitKasCategory);
  $("close-evidence-dialog").addEventListener("click", () => $("evidence-dialog").close());
  $("upload-evidence").addEventListener("click", uploadEvidence);
  $("refresh").addEventListener("click", () => loadKas(activeKas).catch(showError));
  $("add-income").addEventListener("click", () => openKasCreate("masuk"));
  $("add-expense").addEventListener("click", () => openKasCreate("keluar"));
  $("tx-type").addEventListener("change", updateKasCategories);
  $("tx-amount").addEventListener("input", () => formatNominalInput($("tx-amount")));
  $("tx-amount-thousand").addEventListener("click", () => {
    const digits = nominalDigits($("tx-amount").value);
    if (!digits) { $("tx-amount").focus(); return; }
    $("tx-amount").value = formatNominalText(`${digits}000`);
    $("tx-amount").focus();
  });
  $("close-dialog").addEventListener("click", () => $("tx-dialog").close());
  $("load-more").addEventListener("click", () => loadKasTransactions(false).catch(showError));
  let kasSearchTimer; $("search").addEventListener("input", () => { clearTimeout(kasSearchTimer); kasSearchTimer = setTimeout(() => loadKasTransactions(true).catch(showError), 300); });
  $("tx-form").addEventListener("submit", async event => {
    event.preventDefault();
    const ref = $("tx-ref").value;
    const nominal = parseNominalText($("tx-amount").value);
    if (!nominal) return setStatus($("form-status"), "Nominal belum valid.", "error");
    const payload = { jenis: $("tx-type").value, nominal, kategori: $("tx-category").value, keterangan: $("tx-description").value.trim(), catatan: $("tx-note").value.trim(), label: parseTags($("tx-tags").value), tanggal: dateToTimestamp($("tx-date").value) };
    if (ref) payload.alasan = $("tx-reason").value.trim() || "Edit melalui Web PROxyz";
    setStatus($("form-status"), "Menyimpan…");
    try {
      await api(ref ? `/api/kas/${encodeURIComponent(activeKas)}/transaksi/${encodeURIComponent(ref)}` : `/api/kas/${encodeURIComponent(activeKas)}/transaksi`, { method: ref ? "PUT" : "POST", body: JSON.stringify(payload) });
      $("tx-dialog").close(); await loadKas(activeKas);
    } catch (error) { setStatus($("form-status"), error.message, "error"); }
  });

  // Bertunas events
  $("bertunas-select").addEventListener("change", () => loadBertunas($("bertunas-select").value).catch(showError));
  $("bt-season").addEventListener("change", () => reloadBertunasForContext({ resetCrop: true }).catch(showError));
  $("bt-refresh").addEventListener("click", () => reloadBertunasForContext().catch(showError));
  $("bt-add-expense").addEventListener("click", () => openBtCreate("expense"));
  $("bt-add-harvest").addEventListener("click", () => openBtCreate("harvest"));
  $("bt-add-activity").addEventListener("click", () => openBtCreate("activity"));
  $("bt-add-schedule").addEventListener("click", () => openBtCreate("schedule"));
  $("bt-close-dialog").addEventListener("click", () => $("bt-dialog").close());
  document.querySelectorAll(".subtab[data-bt-tab]").forEach(el => el.addEventListener("click", () => {
    document.querySelectorAll(".subtab[data-bt-tab]").forEach(x => x.classList.toggle("active", x === el));
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
  document.querySelectorAll("[data-gallery-tab]").forEach(el => el.addEventListener("click", () => switchGalleryTab(el.dataset.galleryTab)));
  $("gallery-video-form").addEventListener("submit", submitGalleryVideo);
  $("gallery-video-refresh").addEventListener("click", () => loadGalleryVideoJobs().catch(showError));
  $("gallery-video-close-review").addEventListener("click", closeGalleryVideoReview);
  $("gallery-video-select-all").addEventListener("click", () => { if (!activeGalleryVideoJob) return; galleryVideoSelected = new Set((activeGalleryVideoJob.candidates || []).map(row => row.id)); updateGalleryVideoSelection(); });
  $("gallery-video-clear-all").addEventListener("click", () => { galleryVideoSelected.clear(); updateGalleryVideoSelection(); });
  $("gallery-video-publish").addEventListener("click", publishGalleryVideoSelection);
  $("gallery-select").addEventListener("change", () => loadGallery($("gallery-select").value).catch(showError)); $("refresh-gallery").addEventListener("click", () => loadGallery(activeGallery).catch(showError));
  $("rename-gallery").addEventListener("click", async () => { const next = prompt("Nama Galeri baru:", galleryDetail?.nama || ""); if (next === null || !next.trim()) return; try { await api(`/api/galeri/${encodeURIComponent(activeGallery)}`, { method: "PUT", body: JSON.stringify({ nama: next.trim() }) }); const meData = await api("/api/me"); me = meData.user; fillSelect($("gallery-select"), me.galeri || [], row => `${row.nama} · ${row.role}`); await loadGallery(activeGallery); } catch (error) { showError(error); } });
  $("gallery-access").addEventListener("click", openGalleryAccessDialog);
  $("gallery-access-visibility").addEventListener("change", syncGalleryAccessOptions);
  $("close-gallery-access").addEventListener("click", () => $("gallery-access-dialog").close());
  $("gallery-access-form").addEventListener("submit", async event => {
    event.preventDefault();
    const visibility = $("gallery-access-visibility").value;
    const password = $("gallery-access-password").value;
    setStatus($("gallery-access-status"), "Menyimpan aturan akses…");
    try {
      const data = await api(`/api/galeri/${encodeURIComponent(activeGallery)}/access`, { method: "PATCH", body: JSON.stringify({ visibility, password, sessionHours: Number($("gallery-access-hours").value || 12) }) });
      galleryDetail = data.galeri;
      $("gallery-access-dialog").close();
      await loadGallery(activeGallery);
    } catch (error) { setStatus($("gallery-access-status"), error.message, "error"); }
  });
  $("add-gallery-admin").addEventListener("click", async () => { const phone = prompt("Nomor WhatsApp Admin Galeri:", "08"); if (phone === null || !phone.trim()) return; try { await api(`/api/galeri/${encodeURIComponent(activeGallery)}/admin`, { method: "POST", body: JSON.stringify({ phone: phone.trim() }) }); await loadGalleryAdmins(); } catch (error) { showError(error); } });
  $("gallery-upload-open").addEventListener("click", openGalleryPhotoUpload);
  $("close-gallery-upload").addEventListener("click", () => $("gallery-upload-dialog").close());
  $("gallery-upload-form").addEventListener("submit", submitGalleryPhotoUpload);
  $("gallery-load-more").addEventListener("click", () => loadGalleryPhotos(false).catch(showError)); let gallerySearchTimer; $("gallery-search").addEventListener("input", () => { clearTimeout(gallerySearchTimer); gallerySearchTimer = setTimeout(() => loadGalleryPhotos(true).catch(showError), 300); });
  $("gallery-bulk-toggle").addEventListener("click", () => setGalleryBulkMode(!galleryBulkMode, { clear: true }));
  $("gallery-bulk-select-loaded").addEventListener("click", () => { for (const photo of galleryPhotos) galleryBulkSelected.add(Number(photo.nomor)); renderGalleryPhotos(); });
  $("gallery-bulk-clear").addEventListener("click", () => { galleryBulkSelected.clear(); renderGalleryPhotos(); });
  $("gallery-bulk-edit").addEventListener("click", openGalleryBulkEdit);
  $("close-gallery-bulk").addEventListener("click", () => $("gallery-bulk-dialog").close());
  $("gallery-bulk-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!galleryBulkSelected.size) return setStatus($("gallery-bulk-status"), "Pilih minimal satu foto.", "error");
    const title = $("gallery-bulk-caption").value.trim();
    const date = $("gallery-bulk-date").value;
    setStatus($("gallery-bulk-status"), `Menyimpan ${galleryBulkSelected.size} foto…`);
    try {
      const result = await api(`/api/galeri/${encodeURIComponent(activeGallery)}/foto/bulk`, {
        method: "PUT",
        body: JSON.stringify({ nomor: [...galleryBulkSelected], keterangan: title, tanggal: date })
      });
      setStatus($("gallery-bulk-status"), `${result.jumlah || galleryBulkSelected.size} foto berhasil dikelompokkan.`, "success");
      $("gallery-bulk-dialog").close();
      galleryBulkMode = false;
      galleryBulkSelected.clear();
      await loadGallery(activeGallery);
    } catch (error) {
      setStatus($("gallery-bulk-status"), error.message, "error");
    }
  });
  $("close-gallery-edit").addEventListener("click", () => $("gallery-edit-dialog").close());
  $("gallery-edit-form").addEventListener("submit", async event => {
    event.preventDefault();
    const nomor = $("gallery-edit-number").value;
    setStatus($("gallery-edit-status"), "Menyimpan…");
    try {
      await api(`/api/galeri/${encodeURIComponent(activeGallery)}/foto/${encodeURIComponent(nomor)}`, {
        method: "PUT",
        body: JSON.stringify({
          keterangan: $("gallery-edit-caption").value.trim(),
          tanggal: $("gallery-edit-date").value
        })
      });
      $("gallery-edit-dialog").close();
      await loadGalleryPhotos(true);
    } catch (error) {
      setStatus($("gallery-edit-status"), error.message, "error");
    }
  });

  restoreOtpChallenge();
  bootstrapSession();
  setTimeout(checkAdminBuild, 1500);
  window.addEventListener("pageshow", event => { if (event.persisted) checkAdminBuild(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkAdminBuild(); });
})();
