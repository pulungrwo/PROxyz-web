(() => {
  "use strict";

  const ADMIN_BUILD = "0.9.5";
  const config = window.PROXYZ_ADMIN_CONFIG || {};

  async function checkAdminBuild() {
    try {
      const response = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      const info = await response.json();
      const latest = String(info?.version || "").trim();
      if (!latest || latest === ADMIN_BUILD) return;
      const next = new URL(window.location.href);
      const normalizedLatest = latest.replace(/[^0-9A-Za-z._-]/g, "");
      // Jangan reload tanpa akhir bila CDN/browser masih menyajikan JS lama.
      // Jika URL sudah meminta build terbaru, cukup hentikan refresh loop.
      if (next.searchParams.get("v") === normalizedLatest) {
        console.warn(`[Admin Web] Build JS ${ADMIN_BUILD} berbeda dari ${latest}, reload paksa dihentikan agar tidak terjadi loop.`);
        return;
      }
      next.searchParams.set("v", normalizedLatest);
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

  const ADMIN_APP_KEYS = ["kas", "bertunas", "galeri", "risma", "ternak", "kompetisi", "users"];
  let me = null;
  let sessionViewInitialized = false;
  let adminSettingsDraftOrder = [];
  let challengeId = "";
  let challengeExpiresAt = 0;
  let activeView = ["kas", "bertunas", "galeri", "risma", "ternak", "kompetisi", "users"].includes(adminDeepLink.view) ? adminDeepLink.view : "";
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

  // RISMA
  let rismaDetail = null;
  let activeRismaTab = "rank";
  let rismaCouponType = "ngaji";
  let rismaWeekDraft = [];
  let rismaWeekEditIndex = -1;
  let rismaWeekNewParticipantMode = true;
  let rismaPublicationPreviewKind = "";
  let rismaLogs = [];
  let rismaArchives = [];
  let rismaLogSourceFilter = "all";
  let rismaPendingPublishWeek = 0;

  // Kompetisi
  let activeCompetition = "";
  let competitionDetail = null;
  let competitionRows = [];
  let activeCompetitionTab = "peserta";

  // Ternak
  let activeTernak = "";
  let ternakDetail = null;
  let ternakList = [];
  let ternakJenis = [];
  let activeTernakTab = "populasi";
  let ternakSearch = "";

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
    sessionViewInitialized = false;
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

  const ADMIN_BUTTON_ICONS = [
    [/^\+?\s*Bukti\b/i, "fa-paperclip"], [/^Edit$/i, "fa-pen"], [/^Ubah$/i, "fa-pen"], [/^Beri nama$/i, "fa-user-pen"], [/^Nama$/i, "fa-user-pen"],
    [/^Hapus(?:\s|$)/i, "fa-trash-can"], [/^Bayar$/i, "fa-circle-check"], [/^Selesai$/i, "fa-circle-check"], [/^Lewati$/i, "fa-forward-step"],
    [/^Aktifkan$/i, "fa-toggle-on"], [/^Nonaktifkan$/i, "fa-toggle-off"], [/^Jual$/i, "fa-money-bill-transfer"], [/^Status$/i, "fa-pen-to-square"],
    [/^Pilih(?:\s|$)/i, "fa-check-double"], [/^Kosongkan/i, "fa-eraser"], [/^Ganti nama$/i, "fa-pen"], [/^Proses ulang$/i, "fa-rotate-right"],
    [/^Cek status$/i, "fa-rotate"], [/^Lihat(?:\s|$)/i, "fa-eye"], [/^Pulihkan$/i, "fa-rotate-left"], [/^Kirim(?:\s|$)/i, "fa-paper-plane"],
    [/^PDF$/i, "fa-file-pdf"], [/^↑$/, "fa-arrow-up"], [/^↓$/, "fa-arrow-down"]
  ];

  function decorateButtonIcon(el, text) {
    const label = String(text || "").trim();
    const match = ADMIN_BUTTON_ICONS.find(([pattern]) => pattern.test(label));
    if (!match) return el;
    const icon = match[1];
    el.classList.add("has-fa");
    el.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${escapeText(label)}</span>`;
    return el;
  }

  function button(text, className, onClick) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = className;
    el.textContent = text;
    decorateButtonIcon(el, text);
    el.addEventListener("click", onClick);
    return el;
  }

  function rismaIconButton(text, icon, className, onClick) {
    const el = button(text, className, onClick);
    el.innerHTML = `<i class="fa-solid ${icon}"></i><span>${text}</span>`;
    return el;
  }

  const STATIC_ADMIN_ICONS = new Map([
    ["refresh","fa-rotate"],["load-more","fa-angles-down"],["kas-report-load","fa-chart-pie"],["kas-schedule-add","fa-calendar-plus"],
    ["kas-category-add","fa-tags"],["kas-manager-add","fa-user-plus"],["kas-viewer-add","fa-user-plus"],["kas-web-access-save","fa-floppy-disk"],
    ["bt-refresh","fa-rotate"],["rename-gallery","fa-pen"],["gallery-access","fa-lock"],["refresh-gallery","fa-rotate"],["add-gallery-admin","fa-user-plus"],
    ["gallery-upload-open","fa-image"],["gallery-bulk-toggle","fa-check-double"],["gallery-bulk-select-loaded","fa-check-double"],["gallery-bulk-clear","fa-eraser"],
    ["gallery-bulk-edit","fa-layer-group"],["gallery-load-more","fa-angles-down"],["gallery-video-submit","fa-cloud-arrow-up"],["gallery-video-refresh","fa-rotate"],
    ["gallery-video-close-review","fa-xmark"],["gallery-video-select-all","fa-check-double"],["gallery-video-clear-all","fa-eraser"],["gallery-video-publish","fa-floppy-disk"],
    ["ternak-refresh","fa-rotate"],["ternak-repro-add","fa-plus"],["ternak-manager-add","fa-user-plus"],["users-refresh","fa-rotate"],
    ["risma-week-new-toggle","fa-user-plus"],["risma-week-publish-skip","fa-xmark"]
  ]);

  function hydrateAdminIcons() {
    document.querySelectorAll(".icon-button").forEach(el => {
      if (el.querySelector("i")) return;
      el.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
      el.setAttribute("aria-label", el.getAttribute("aria-label") || "Tutup");
    });
    for (const [id, icon] of STATIC_ADMIN_ICONS.entries()) {
      const el = $(id);
      if (!el || el.querySelector("i")) continue;
      const label = String(el.textContent || "").trim();
      el.classList.add("has-fa");
      el.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${escapeText(label)}</span>`;
    }
    document.querySelectorAll('button[type="submit"].primary:not(.risma-mini-action)').forEach(el => {
      if (el.querySelector("i")) return;
      const label = String(el.textContent || "").trim();
      if (!label) return;
      el.classList.add("has-fa");
      el.innerHTML = `<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i><span>${escapeText(label)}</span>`;
    });
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

  async function consumeWhatsAppLoginLink() {
    const token = String(deepLinkParams.get("wa_login") || "").trim();
    if (!token) return false;

    const incomingExpiresAt = Number(deepLinkParams.get("expires") || 0);
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("wa_login");
    cleanUrl.searchParams.delete("expires");
    window.history.replaceState({}, "", cleanUrl.toString());

    if (!/^[a-f0-9]{64}$/i.test(token) || !Number.isFinite(incomingExpiresAt) || incomingExpiresAt <= Date.now()) {
      setStatus($("auth-status"), "Link login sudah tidak valid atau kedaluwarsa. Ketik login lagi di WhatsApp.", "error");
      return true;
    }

    setStatus($("auth-status"), "Membuka sesi Admin PROxyz…");
    try {
      const result = await api("/api/auth/whatsapp-link", { method: "POST", body: JSON.stringify({ token }) });
      saveSessionToken(result.token || "");
      clearOtpChallenge();
      setStatus($("auth-status"), "Login berhasil. Membuka Admin PROxyz…", "success");
    } catch (error) {
      setStatus($("auth-status"), error.message || "Link login tidak dapat digunakan.", "error");
    }
    return true;
  }

  function restoreWhatsAppLoginLink() {
    const incomingChallenge = String(deepLinkParams.get("login") || "").trim();
    if (!incomingChallenge) return false;

    const incomingExpiresAt = Number(deepLinkParams.get("expires") || 0);
    const validChallenge = /^[a-f0-9]{36}$/i.test(incomingChallenge);
    const validExpiry = Number.isFinite(incomingExpiresAt) && incomingExpiresAt > Date.now();

    // Challenge dari URL langsung dipindahkan ke sessionStorage lalu dibuang
    // dari address bar agar tidak ikut tersalin/terkirim sebagai referrer.
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("login");
    cleanUrl.searchParams.delete("expires");
    window.history.replaceState({}, "", cleanUrl.toString());

    if (!validChallenge || !validExpiry) {
      setStatus($("auth-status"), "Link login sudah tidak valid atau kedaluwarsa. Ketik login lagi di WhatsApp.", "error");
      return false;
    }

    challengeId = incomingChallenge;
    challengeExpiresAt = incomingExpiresAt;
    saveOtpChallenge("");
    $("phone-form").hidden = true;
    $("otp-form").hidden = false;
    $("otp").value = "";
    setStatus($("auth-status"), "Masukkan kode OTP yang dikirim bot PROxyz ke WhatsApp kamu.", "success");
    setTimeout(() => $("otp")?.focus(), 80);
    return true;
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

      if (challengeId && challengeExpiresAt > Date.now()) {
        setStatus($("auth-status"), "Masukkan kode OTP yang dikirim bot PROxyz ke WhatsApp kamu.", "success");
      } else {
        setStatus($("auth-status"), error?.message || "Sesi Admin belum tersedia.", "error");
      }
    }
  }

  function appAvailability() {
    return {
      kas: (me?.kas || []).length > 0,
      bertunas: (me?.bertunas || []).length > 0,
      galeri: (me?.galeri || []).length > 0,
      risma: (me?.risma || []).length > 0 || Boolean(me?.isOwner),
      ternak: (me?.ternak || []).length > 0 || Boolean(me?.isOwner),
      kompetisi: (me?.kompetisi || []).length > 0 || Boolean(me?.isOwner),
      users: Boolean(me?.isOwner)
    };
  }

  function normalizedAdminAppOrder(availability = appAvailability()) {
    const saved = Array.isArray(me?.adminWebPreferences?.appOrder) ? me.adminWebPreferences.appOrder : [];
    const source = [...saved, ...ADMIN_APP_KEYS];
    const seen = new Set();
    return source.filter(key => {
      if (!availability[key] || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function applyAdminAppOrder(order = normalizedAdminAppOrder()) {
    const menu = $("app-switcher-menu");
    if (!menu) return;
    const clean = [...new Set(order)].filter(key => ADMIN_APP_KEYS.includes(key));
    for (const key of clean) {
      const tab = $("tab-" + key);
      if (tab) menu.appendChild(tab);
    }
    for (const key of ADMIN_APP_KEYS) {
      const tab = $("tab-" + key);
      if (tab && !clean.includes(key)) menu.appendChild(tab);
    }
  }

  function adminAppMeta(key) {
    const tab = $("tab-" + key);
    return {
      key,
      label: tab?.querySelector(".app-tab-label")?.textContent?.trim() || tab?.title || key,
      iconClass: tab?.querySelector("i")?.className || "fa-solid fa-grid-2"
    };
  }

  function renderAdminSettingsAppOrder() {
    const list = $("admin-settings-app-list");
    if (!list) return;
    list.replaceChildren();
    adminSettingsDraftOrder.forEach((key, index) => {
      const meta = adminAppMeta(key);
      const row = document.createElement("div");
      row.className = "admin-settings-app-row";
      row.dataset.appKey = key;
      const lead = document.createElement("div"); lead.className = "admin-settings-app-lead";
      const icon = document.createElement("span"); icon.className = "admin-settings-app-icon"; icon.innerHTML = `<i class="${meta.iconClass}"></i>`;
      const copy = document.createElement("div");
      const name = document.createElement("strong"); name.textContent = meta.label;
      const sub = document.createElement("span"); sub.textContent = index === 0 ? "Aplikasi default" : `Urutan ${index + 1}`;
      copy.append(name, sub); lead.append(icon, copy);
      const actions = document.createElement("div"); actions.className = "admin-settings-app-actions";
      const up = document.createElement("button"); up.type = "button"; up.className = "icon-button admin-order-btn"; up.dataset.move = "up"; up.disabled = index === 0; up.title = "Naik"; up.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
      const down = document.createElement("button"); down.type = "button"; down.className = "icon-button admin-order-btn"; down.dataset.move = "down"; down.disabled = index === adminSettingsDraftOrder.length - 1; down.title = "Turun"; down.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
      actions.append(up, down); row.append(lead, actions); list.append(row);
    });
  }

  function openAdminSettings() {
    adminSettingsDraftOrder = normalizedAdminAppOrder();
    $("admin-settings-name").textContent = me?.name || "Pengguna PROxyz";
    renderAdminSettingsAppOrder();
    setStatus($("admin-settings-status"));
    $("admin-settings-dialog").showModal();
  }

  function renderMe() {
    $("login-view").hidden = true;
    $("app-view").hidden = false;
    $("welcome").textContent = me.name || "Pengguna PROxyz";

    const counts = [
      (me.kas || []).length ? `${me.kas.length} Kas` : "",
      (me.bertunas || []).length ? `${me.bertunas.length} Bertunas` : "",
      (me.galeri || []).length ? `${me.galeri.length} Galeri` : "",
      (me.risma || []).length ? "RISMA" : "",
      (me.ternak || []).length ? `${me.ternak.length} Ternak` : "",
      (me.kompetisi || []).length ? `${me.kompetisi.length} Kompetisi` : ""
    ].filter(Boolean);
    $("access-summary").textContent = counts.join(" · ") || "Tidak ada akses aplikasi.";

    const availability = appAvailability();
    for (const [name, available] of Object.entries(availability)) $("tab-" + name).hidden = !available;
    const orderedApps = normalizedAdminAppOrder(availability);
    applyAdminAppOrder(orderedApps);

    fillSelect($("kas-select"), me.kas || [], row => `${row.nama} · ${row.role}`);
    fillSelect($("bertunas-select"), me.bertunas || [], row => `${row.nama} · ${row.role}`);
    fillSelect($("gallery-select"), me.galeri || [], row => `${row.nama} · ${row.role}`);
    fillSelect($("ternak-select"), me.ternak || [], row => `${row.nama} · ${row.jenis || "Ternak"} · ${row.role}`);
    fillSelect($("competition-select"), me.kompetisi || [], row => `${row.nama} · ${row.cabang || "Kompetisi"} · ${row.role}`);

    const requestedGallery = adminDeepLink.gallery && (me.galeri || []).some(row => row.id === adminDeepLink.gallery)
      ? adminDeepLink.gallery
      : "";
    if (requestedGallery) {
      activeGallery = requestedGallery;
      $("gallery-select").value = requestedGallery;
    }

    const preferred = sessionViewInitialized && activeView && availability[activeView] ? activeView : "";
    const deepLinked = !sessionViewInitialized && activeView && availability[activeView] ? activeView : "";
    const configuredDefault = String(me?.adminWebPreferences?.defaultApp || "").trim().toLowerCase();
    const first = preferred || deepLinked || (availability[configuredDefault] ? configuredDefault : "") || orderedApps[0];
    if (first) switchView(first);
    sessionViewInitialized = true;

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

  function appDockTopPx() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--admin-dock-top").trim();
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 8;
  }

  function syncAppDockFloating() {
    const dock = $("app-tabs");
    const sentinel = $("app-tabs-sentinel");
    const toggle = $("app-tabs-toggle");
    const bar = $("app-switcher-bar");
    if (!dock || !sentinel || !toggle || $("app-view")?.hidden) return;
    const floating = sentinel.getBoundingClientRect().top <= appDockTopPx() + 1 && window.scrollY > 0;
    dock.classList.toggle("is-floating", floating);
    toggle.hidden = false;
    if (!floating) dock.classList.remove("is-expanded");
    const expanded = floating && dock.classList.contains("is-expanded");
    toggle.setAttribute("aria-expanded", String(expanded));
    bar?.setAttribute("aria-expanded", String(expanded));
  }

  function collapseAppDock() {
    const dock = $("app-tabs");
    const toggle = $("app-tabs-toggle");
    if (!dock) return;
    dock.classList.remove("is-expanded");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    $("app-switcher-bar")?.setAttribute("aria-expanded", "false");
  }

  function switchView(view) {
    activeView = view;
    for (const name of ["kas", "bertunas", "galeri", "risma", "ternak", "kompetisi", "users"]) {
      $(`${name}-view`).hidden = name !== view;
      $("tab-" + name).classList.toggle("active", name === view);
    }
    collapseAppDock();
    syncProxyzAppSwitcherLabel();
    requestAnimationFrame(syncAppDockFloating);
    if (view === "kas" && !activeKas && me.kas?.length) loadKas(me.kas[0].id).catch(showError);
    if (view === "bertunas" && !activeBertunas && me.bertunas?.length) loadBertunas(me.bertunas[0].id).catch(showError);
    if (view === "galeri" && !activeGallery && me.galeri?.length) loadGallery(me.galeri[0].id).catch(showError);
    if (view === "risma") loadRisma().catch(showError);
    if (view === "ternak") loadTernakIndex().catch(showError);
    if (view === "kompetisi") loadCompetitionIndex().catch(showError);
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

  // ---------- KOMPETISI ----------
  const COMPETITION_FORMATS = [
    ["round_robin","Round Robin / Liga"],
    ["groups_knockout","Grup → Sistem Gugur"],
    ["single_elimination","Sistem Gugur"],
    ["double_elimination","Double Elimination"],
    ["swiss","Swiss System / League Phase"],
    ["custom","Campuran / Custom"]
  ];
  const COMPETITION_SPORTS = [
    ["voli","Voli"],["takraw","Sepak Takraw"],["badminton","Badminton"],["sepakbola","Sepak Bola"],["futsal","Futsal"],["tenismeja","Tenis Meja"],["esport","E-Sport"],["tradisional","Permainan Tradisional"],["lainnya","Lainnya"]
  ];
  function fillCompetitionOptionList(select, rows) {
    if (!select) return;
    select.replaceChildren();
    for (const [id,label] of rows) { const option=document.createElement("option"); option.value=id; option.textContent=label; select.appendChild(option); }
  }
  function participantNameCompetition(id) {
    return (competitionDetail?.participants || []).find(row => row.id === id)?.name || "TBD";
  }
  async function refreshCompetitionProfile() {
    const data = await api("/api/me"); me = data.user;
    fillSelect($("competition-select"), me.kompetisi || [], row => `${row.nama} · ${row.cabang || "Kompetisi"} · ${row.role}`);
    $("tab-kompetisi").hidden = !((me.kompetisi || []).length || me.isOwner);
  }
  async function loadCompetitionIndex() {
    $("competition-create").hidden = !me?.isOwner;
    const data = await api("/api/kompetisi"); competitionRows = data.kompetisi || [];
    fillSelect($("competition-select"), competitionRows, row => `${row.nama} · ${row.cabang} · ${row.role}`);
    if (!competitionRows.length) {
      activeCompetition=""; competitionDetail=null; $("competition-content").hidden=true;
      if (me?.isOwner) { $("competition-select").replaceChildren(); const o=document.createElement("option");o.value="";o.textContent="Belum ada kompetisi";$("competition-select").appendChild(o); }
      return;
    }
    const id = activeCompetition && competitionRows.some(row=>row.id===activeCompetition) ? activeCompetition : competitionRows[0].id;
    await loadCompetition(id);
  }
  async function loadCompetition(id) {
    if (!id) return;
    activeCompetition=id; $("competition-select").value=id;
    const data=await api(`/api/kompetisi/${encodeURIComponent(id)}`); competitionDetail=data.kompetisi;
    renderCompetition(); $("competition-content").hidden=false;
  }
  function switchCompetitionTab(tab) {
    activeCompetitionTab=["peserta","pertandingan","klasemen","bagan","pengaturan"].includes(tab)?tab:"peserta";
    document.querySelectorAll("[data-competition-tab]").forEach(btn=>btn.classList.toggle("active",btn.dataset.competitionTab===activeCompetitionTab));
    for (const name of ["peserta","pertandingan","klasemen","bagan","pengaturan"]) $("competition-"+name+"-panel").hidden=name!==activeCompetitionTab;
  }
  function renderCompetition() {
    const d=competitionDetail;if(!d)return;
    $("competition-name").textContent=d.nama||d.id; $("competition-sport").textContent=d.cabangNama||"Kompetisi"; $("competition-format").textContent=`${d.formatLabel || d.format} · ${d.participantType==="individual"?"Perorangan":"Tim"}`; $("competition-role").textContent=String(d.role||"member").toUpperCase();
    $("competition-participant-count").textContent=wholeNumber.format((d.participants||[]).length); $("competition-participant-pill").textContent=`${(d.participants||[]).length} peserta`;
    $("competition-match-count").textContent=wholeNumber.format((d.matches||[]).length); $("competition-finished-count").textContent=wholeNumber.format((d.matches||[]).filter(row=>row.status==="finished").length); $("competition-stage-count").textContent=wholeNumber.format((d.stages||[]).length);
    const canManage=d.role!=="member"; $("competition-generate").hidden=!canManage; $("competition-participant-form").hidden=!canManage; $("competition-settings-form").querySelectorAll("input,select,button").forEach(el=>el.disabled=d.role!=="owner"); $("competition-manager-add").hidden=d.role!=="owner";
    fillCompetitionOptionList($("competition-setting-format"),COMPETITION_FORMATS); $("competition-setting-name").value=d.nama||""; $("competition-setting-sport-name").value=d.cabangNama||""; $("competition-setting-format").value=d.format||"single_elimination"; $("competition-setting-groups").value=String(d.groupCount||2); $("competition-setting-advance").value=String(d.advancePerGroup||2); $("competition-setting-custom-advance").value=String(d.customAdvanceCount||4); $("competition-setting-legs").value=String(d.legs||1); $("competition-setting-scoring").value=d.scoringMode||"score"; $("competition-setting-bestof").value=String(d.bestOf||1); $("competition-setting-draw").checked=d.allowDraw!==false; $("competition-setting-third").checked=d.thirdPlace!==false;
    renderCompetitionParticipants(); renderCompetitionMatches(); renderCompetitionStandings(); renderCompetitionBracket(); renderCompetitionManagers(); switchCompetitionTab(activeCompetitionTab);
  }
  function renderCompetitionParticipants() {
    const list=$("competition-participant-list");list.replaceChildren();const rows=competitionDetail?.participants||[];if(!rows.length){list.appendChild(emptyBox("Belum ada peserta/tim."));return;}
    for(const row of rows){const card=document.createElement("article");card.className="competition-row";const main=document.createElement("div");main.className="competition-row-main";const icon=document.createElement("span");icon.className="competition-icon";icon.innerHTML=`<i class="fa-solid ${competitionDetail.participantType==="individual"?"fa-user":"fa-people-group"}"></i>`;const copy=document.createElement("div");const name=document.createElement("strong");name.textContent=`${row.no}. ${row.name}`;const meta=document.createElement("span");meta.textContent=[row.groupId?row.groupId:"Belum masuk grup",`Seed ${row.seed||row.no}`].join(" · ");copy.append(name,meta);main.append(icon,copy);card.append(main);
      if(competitionDetail.role!=="member"){const actions=document.createElement("div");actions.className="competition-row-actions";actions.append(rismaIconButton("Edit","fa-pen","ghost compact",async()=>{const next=prompt("Nama peserta/tim:",row.name);if(next===null||!next.trim())return;await api(`/api/kompetisi/${encodeURIComponent(activeCompetition)}/participant/${encodeURIComponent(row.id)}`,{method:"PATCH",body:JSON.stringify({name:next.trim(),seed:row.seed})});await loadCompetition(activeCompetition);}),rismaIconButton("Hapus","fa-trash-can","danger-soft compact",async()=>{if(!confirm(`Hapus ${row.name}?`))return;try{await api(`/api/kompetisi/${encodeURIComponent(activeCompetition)}/participant/${encodeURIComponent(row.id)}`,{method:"DELETE",body:"{}"});await loadCompetition(activeCompetition);}catch(error){showError(error);}}));card.append(actions);} list.append(card);}
  }
  function competitionMatchScoreText(row){if(row.status!=="finished")return "vs";if((row.sets||[]).length)return `${row.scoreA}–${row.scoreB} set`;return `${row.scoreA}–${row.scoreB}`;}
  function renderCompetitionMatches() {
    const actions=$("competition-phase-actions");actions.replaceChildren();const d=competitionDetail;const canManage=d.role!=="member";
    if(canManage && d.format==="groups_knockout"){const hasKo=(d.stages||[]).some(s=>s.type==="single_elimination"&&s.status!=="waiting");const groupDone=(d.matches||[]).filter(m=>m.groupId).length>0 && (d.matches||[]).filter(m=>m.groupId).every(m=>m.status==="finished");if(groupDone&&!hasKo)actions.append(rismaIconButton("Buat fase gugur","fa-diagram-project","primary compact",()=>competitionAction("knockout")));}
    if(canManage && d.format==="custom"){const stages=d.stages||[];const first=stages[0],second=stages[1];const firstRows=(d.matches||[]).filter(m=>m.stageId===first?.id);const ready=firstRows.length>0&&firstRows.every(m=>m.status==="finished")&&second?.status==="waiting";if(ready)actions.append(rismaIconButton("Lanjut ke fase gugur","fa-code-branch","primary compact",()=>competitionAction("knockout")));}
    if(canManage && d.format==="swiss" && (d.matches||[]).length && (d.matches||[]).every(m=>m.status==="finished"))actions.append(rismaIconButton("Putaran Swiss berikutnya","fa-forward-step","primary compact",()=>competitionAction("swiss-next")));
    const list=$("competition-match-list");list.replaceChildren();const rows=d.matches||[];if(!rows.length){list.appendChild(emptyBox("Belum ada jadwal. Tekan Generate setelah peserta siap."));return;}
    for(const row of rows){const card=document.createElement("article");card.className=`competition-match ${row.status}`;const tag=document.createElement("div");tag.className="competition-match-tag";tag.textContent=[`#${row.matchNo}`,row.groupId,row.roundLabel].filter(Boolean).join(" · ");const score=document.createElement("div");score.className="competition-scoreline";const a=document.createElement("strong");a.textContent=participantNameCompetition(row.participantAId);const mid=document.createElement("b");mid.textContent=competitionMatchScoreText(row);const b=document.createElement("strong");b.textContent=participantNameCompetition(row.participantBId);score.append(a,mid,b);card.append(tag,score);if((row.sets||[]).length){const sets=document.createElement("div");sets.className="competition-setline";sets.textContent=row.sets.map((set,i)=>`S${i+1} ${set.a}-${set.b}`).join(" · ");card.append(sets);}if(canManage&&row.participantAId&&row.participantBId){const btn=rismaIconButton(row.status==="finished"?"Ubah skor":"Input skor","fa-pen-to-square","ghost compact",async()=>{const wins=Math.floor(Number(competitionDetail.bestOf||1)/2)+1;const example=competitionDetail.scoringMode!=="sets"?"2-1":wins>=3?"25-20,20-25,25-22,25-18":"21-18,18-21,21-19";const value=prompt(`Skor pertandingan #${row.matchNo}\n${participantNameCompetition(row.participantAId)} vs ${participantNameCompetition(row.participantBId)}\n\nFormat: ${example}`,"");if(value===null||!value.trim())return;try{await api(`/api/kompetisi/${encodeURIComponent(activeCompetition)}/score`,{method:"POST",body:JSON.stringify({matchNo:row.matchNo,score:value.trim()})});await loadCompetition(activeCompetition);}catch(error){showError(error);}});card.append(btn);}list.append(card);}
  }
  function standingsTable(rows,title="Klasemen") {const wrap=document.createElement("section");wrap.className="competition-table-card";const h=document.createElement("h3");h.textContent=title;wrap.append(h);const table=document.createElement("div");table.className="competition-table";const swiss=competitionDetail?.format==="swiss";const head=document.createElement("div");head.className="competition-table-row head";["#","Peserta","M","W","D","L",swiss?"Buchholz":"+/−","Poin"].forEach(x=>{const span=document.createElement("span");span.textContent=x;head.append(span);});table.append(head);rows.forEach((r,i)=>{const row=document.createElement("div");row.className="competition-table-row";[i+1,r.name,r.main,r.win,r.draw,r.loss,swiss?(r.buchholz||0):r.diff,r.points].forEach((x,j)=>{const span=document.createElement("span");span.textContent=x;if(j===1)span.className="name";row.append(span);});table.append(row);});wrap.append(table);return wrap;}
  function renderCompetitionStandings(){const box=$("competition-standing-list");box.replaceChildren();const d=competitionDetail;if((d.groups||[]).length){for(const group of d.groups)box.append(standingsTable(group.standings||[],group.id));}else box.append(standingsTable(d.standings||[],"Klasemen umum"));}
  function renderCompetitionBracket(){const box=$("competition-bracket");box.replaceChildren();const d=competitionDetail;const knockout=(d.matches||[]).filter(m=>!m.groupId);const source=knockout.length?knockout:(d.matches||[]);if(!source.length){box.appendChild(emptyBox("Bagan belum dibuat."));return;}const groups=new Map();for(const m of source){const key=[m.bracketSide?({W:"Winners",L:"Losers",F:"Final",R:"Reset"}[m.bracketSide]||m.bracketSide):"",m.roundLabel||`R${m.round}`].filter(Boolean).join(" · ");if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);}for(const [title,rows] of groups){const col=document.createElement("section");col.className="bracket-column";const h=document.createElement("h3");h.textContent=title;col.append(h);for(const m of rows){const card=document.createElement("div");card.className="bracket-match";const no=document.createElement("span");no.textContent=`#${m.matchNo}`;const a=document.createElement("strong");a.textContent=participantNameCompetition(m.participantAId);const sa=document.createElement("b");sa.textContent=m.status==="finished"?m.scoreA:"–";const b=document.createElement("strong");b.textContent=participantNameCompetition(m.participantBId);const sb=document.createElement("b");sb.textContent=m.status==="finished"?m.scoreB:"–";card.append(no,a,sa,b,sb);col.append(card);}box.append(col);}}
  function renderCompetitionManagers(){const list=$("competition-manager-list");list.replaceChildren();const m=competitionDetail?.managers;if(!m)return;const owner=document.createElement("article");owner.className="competition-row";const ownerMain=document.createElement("div");ownerMain.className="competition-row-main";const ownerIcon=document.createElement("span");ownerIcon.className="competition-icon";ownerIcon.innerHTML='<i class="fa-solid fa-crown"></i>';const ownerCopy=document.createElement("div");const ownerName=document.createElement("strong");ownerName.textContent=m.owner?.name||"Owner";const ownerRole=document.createElement("span");ownerRole.textContent="Owner Kompetisi";ownerCopy.append(ownerName,ownerRole);ownerMain.append(ownerIcon,ownerCopy);owner.append(ownerMain);list.append(owner);for(const row of m.admins||[]){const card=document.createElement("article");card.className="competition-row";const main=document.createElement("div");main.className="competition-row-main";const icon=document.createElement("span");icon.className="competition-icon";icon.innerHTML='<i class="fa-solid fa-user-shield"></i>';const copy=document.createElement("div");const nm=document.createElement("strong");nm.textContent=row.name||row.phone||"Admin";const role=document.createElement("span");role.textContent="Admin Kompetisi";copy.append(nm,role);main.append(icon,copy);card.append(main);if(competitionDetail.role==="owner")card.append(rismaIconButton("Hapus","fa-trash-can","danger-soft compact",async()=>{if(!confirm(`Hapus ${row.name} dari Admin Kompetisi?`))return;await api(`/api/kompetisi/${encodeURIComponent(activeCompetition)}/admin/${encodeURIComponent(row.ref)}`,{method:"DELETE",body:"{}"});await loadCompetition(activeCompetition);}));list.append(card);}}
  async function competitionAction(action){setStatus($("competition-match-status"),"Memproses…");try{await api(`/api/kompetisi/${encodeURIComponent(activeCompetition)}/${action}`,{method:"POST",body:"{}"});await loadCompetition(activeCompetition);setStatus($("competition-match-status"),"Berhasil.","success");}catch(error){setStatus($("competition-match-status"),error.message,"error");}}
  function openCompetitionCreate(){fillCompetitionOptionList($("competition-create-format"),COMPETITION_FORMATS);fillCompetitionOptionList($("competition-create-sport"),COMPETITION_SPORTS);$("competition-create-name").value="";$("competition-create-format").value="groups_knockout";$("competition-create-sport").value="voli";syncCompetitionCreateOptions();setStatus($("competition-create-status"));$("competition-create-dialog").showModal();}
  function syncCompetitionCreateOptions(){$("competition-create-group-options").hidden=$("competition-create-format").value!=="groups_knockout";$("competition-create-custom-advance-wrap").hidden=$("competition-create-format").value!=="custom";$("competition-create-custom-sport-wrap").hidden=$("competition-create-sport").value!=="lainnya";}

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
      if (Number(tx.buktiCount || 0) > 0) { const proof = document.createElement("button"); proof.type = "button"; proof.className = "evidence-badge has-fa"; proof.innerHTML = `<i class="fa-solid fa-paperclip" aria-hidden="true"></i><span>${tx.buktiCount} bukti</span>`; proof.addEventListener("click", () => openEvidence(tx)); card.appendChild(proof); }
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


  // ---------- RISMA ----------
  async function loadRisma() {
    const data = await api("/api/risma");
    rismaDetail = data.risma;
    renderRisma();
  }

  function switchRismaTab(tab) {
    const owner = rismaDetail?.role === "owner";
    const allowed = ["rank","poin","kupon","publikasi","pengaturan","pengelola","log"];
    activeRismaTab = allowed.includes(tab) ? tab : "rank";
    if (activeRismaTab === "log" && !owner) activeRismaTab = "rank";
    document.querySelectorAll("[data-risma-tab]").forEach(el => el.classList.toggle("active", el.dataset.rismaTab === activeRismaTab));
    for (const name of allowed) $("risma-"+name+"-panel").hidden = name !== activeRismaTab;
    if (activeRismaTab === "log" && owner) loadRismaLogs().catch(error => setStatus($("risma-log-status"), error.message, "error"));
    if (activeRismaTab === "publikasi" && !rismaArchives.length) loadRismaArchives().catch(error => setStatus($("risma-archive-status"), error.message, "error"));
  }

  function renderRisma() {
    if (!rismaDetail) return;
    const period = rismaDetail.activePeriod;
    const hasScores = Boolean((rismaDetail.scores || []).length);
    const owner = rismaDetail.role === "owner";
    const simulation = Boolean(period?.isSimulation);
    $("risma-name").textContent = rismaDetail.nama || "RISMA";
    $("risma-period").textContent = period ? `Ramadan ${period.hijriYear} H${simulation ? " · Simulasi" : ""}` : "Belum ada periode aktif";
    $("risma-role").textContent = rismaDetail.role || "admin";
    $("risma-participants").textContent = wholeNumber.format(rismaDetail.summary?.participants || 0);
    $("risma-weeks").textContent = `${rismaDetail.summary?.weeks || 0}/4`;
    $("risma-teams").textContent = wholeNumber.format(rismaDetail.summary?.teams || 0);
    const couponParts=(rismaDetail.summary?.couponBreakdown||[]).map(row=>Number(row.coupons||0)).filter(value=>value>0);
    $("risma-coupons").textContent = couponParts.length ? couponParts.map(value=>wholeNumber.format(value)).join(" + ") : "0";
    $("risma-total-points").textContent = `${number.format(rismaDetail.summary?.totalPoints || 0)} poin`;

    // Pengaturan periode dipindah ke tab Pengaturan agar hero tetap bersih.
    $("risma-period-new").hidden = true;
    $("risma-period-close").hidden = true;
    $("risma-manager-add").hidden = !owner;
    $("risma-log-tab").hidden = !owner;
    $("risma-owner-period-box").hidden = !owner;
    $("risma-owner-simulation-box").hidden = !owner;
    $("risma-signature-box").hidden = !owner;
    $("risma-period-history-box").hidden = !owner;
    $("risma-coupon-add").disabled = !period;
    $("risma-print-coupon-pdf").disabled = !period;

    const groupBlocked = simulation;
    $("risma-publish-rank-preview").disabled = !period || !hasScores;
    $("risma-publish-rank").disabled = !period || !hasScores || groupBlocked;
    $("risma-publish-rank-pdf").disabled = !period || !hasScores;
    $("risma-publish-rules-preview").disabled = !period;
    $("risma-publish-rules-send").disabled = !period || groupBlocked;
    $("risma-publish-rules-pdf").disabled = !period;
    for (const id of ["risma-publish-announce-send","risma-publish-invite-send"]) $(id).disabled = groupBlocked;

    if (owner) {
      $("risma-owner-period-year").value = period && !simulation ? String(period.hijriYear || "") : String((rismaDetail.periods || []).find(x => !x.isSimulation && x.status === "active")?.hijriYear || "");
      $("risma-owner-simulation-year").value = simulation ? String(period.hijriYear || "") : String(period?.hijriYear || "");
      $("risma-owner-period-note").textContent = simulation
        ? `Simulasi Ramadan ${period.hijriYear} H sedang aktif. Akhiri simulasi untuk kembali ke data asli.`
        : period ? `Periode aktif: Ramadan ${period.hijriYear} H.` : "Belum ada periode Ramadan aktif.";
      $("risma-owner-period-create").disabled = Boolean(period);
      $("risma-owner-period-close").disabled = !period || simulation;
      $("risma-owner-simulation-note").textContent = simulation
        ? `Simulasi Ramadan ${period.hijriYear} H aktif. Data asli tidak berubah dan pesan ke grup tidak dikirim.`
        : "Coba semua menu tanpa mengubah data asli. Pesan ke grup tidak dikirim selama simulasi.";
      $("risma-simulation-start").disabled = simulation;
      $("risma-simulation-seed").disabled = false;
      $("risma-simulation-reset").disabled = !simulation;
      $("risma-simulation-end").disabled = !simulation;
      $("risma-signature-chair").value = rismaDetail.signatures?.chair?.name || "";
      $("risma-signature-secretary").value = rismaDetail.signatures?.secretary?.name || "";
      renderRismaPeriodHistory();
    }
    updateRismaCouponPrintSummary();

    renderRismaRankings();
    renderRismaScores();
    renderRismaWeeks();
    renderRismaCoupons();
    renderRismaSettings();
    renderManagerList($("risma-manager-list"), rismaDetail.managers, { remove: removeRismaManager });
    switchRismaTab(activeRismaTab);
  }

  function participantWeekSummary(row) {
    const parts=[];
    for(let week=1;week<=4;week++) {
      const data=row.weeks?.[week];
      if(!data){parts.push(`M${week}: –`);continue;}
      const bonus=Number(data.excused||0);
      parts.push(`M${week}: ${data.attendance}${bonus?` +${bonus}`:""}`);
    }
    return parts.join(" · ");
  }

  function renderRismaRankMark(el, index) {
    if (index < 3) {
      el.classList.add(`rank-medal-${index + 1}`);
      el.innerHTML = '<i class="fa-solid fa-medal" aria-hidden="true"></i>';
      el.setAttribute("aria-label", `Peringkat ${index + 1}`);
      return;
    }
    el.textContent = String(index + 1);
  }

  function renderRismaRankings() {
    const participantList = $("risma-rank-participants");
    const teamList = $("risma-rank-teams");
    participantList.replaceChildren();
    teamList.replaceChildren();

    const scores = rismaDetail?.scores || [];
    const teams = rismaDetail?.teams || [];
    $("risma-rank-participant-count").textContent = wholeNumber.format(scores.length);
    $("risma-rank-team-count").textContent = wholeNumber.format(teams.length);

    if (!scores.length) participantList.appendChild(emptyBox("Belum ada peserta yang masuk peringkat."));
    else scores.forEach((row,index) => {
      const card = document.createElement("article");
      card.className = `risma-rank-card participant risma-rank-row-card${row.disqualified?" disqualified":""}`;
      const rank = document.createElement("span"); rank.className = "risma-rank-number"; renderRismaRankMark(rank,index);
      const info = document.createElement("div"); info.className = "risma-rank-info";
      const headline = document.createElement("div"); headline.className = "risma-rank-name-line";
      const title = document.createElement("strong"); title.textContent = row.name; if(row.disqualified) title.className="risma-disqualified-name";
      const points = document.createElement("b"); points.className = "risma-rank-points"; points.textContent = `${number.format(row.totalPoints || 0)} poin`;
      headline.append(title,points);
      if(row.disqualified){const badge=document.createElement("span");badge.className="risma-dq-badge";badge.textContent="DISKUALIFIKASI";headline.appendChild(badge);}
      const meta = document.createElement("span"); meta.textContent = participantWeekSummary(row);
      info.append(headline,meta);
      card.append(rank,info);
      participantList.appendChild(card);
    });

    if (!teams.length) teamList.appendChild(emptyBox("Tim belum disusun. Tim awal dibuat setelah input Minggu 1."));
    else teams.forEach((row,index) => {
      const card = document.createElement("article");
      card.className = "risma-rank-card team risma-rank-row-card risma-team-row-card";
      const rank = document.createElement("span"); rank.className = "risma-rank-number"; renderRismaRankMark(rank,index);
      const info = document.createElement("div"); info.className = "risma-rank-info";
      const headline = document.createElement("div"); headline.className = "risma-rank-name-line";
      const title = document.createElement("strong"); title.textContent = row.name;
      const average = document.createElement("b"); average.className = "risma-rank-points risma-team-average"; average.textContent = `Ø ${number.format(row.averagePoints || 0)} poin`;
      headline.append(title,average);
      const memberNames = (row.members || []).map(x => x.name).join(" · ") || "Belum ada anggota";
      const meta = document.createElement("span"); meta.textContent = `Total ${number.format(row.totalPoints || 0)} poin · ${memberNames}`;
      info.append(headline,meta);
      card.append(rank,info);
      teamList.appendChild(card);
    });
  }

  function renderRismaScores() {
    const full=$("risma-score-list");
    full.replaceChildren();
    const rows=rismaDetail?.scores || [];
    const masterLocked = rismaDetail?.role !== "owner" && (rismaDetail?.weeks || []).some(row=>Number(row.week)>=2);
    if(!rows.length){ full.appendChild(emptyBox("Belum ada peserta RISMA Poin.")); return; }
    rows.forEach((row,index)=>{
      const card=document.createElement("article"); card.className=`item-card risma-score-card compact${row.disqualified?" disqualified":""}`;
      const line=document.createElement("div"); line.className="risma-score-line";
      const name=document.createElement("strong"); name.className=`risma-row-name${row.disqualified?" risma-disqualified-name":""}`; name.textContent=`${index+1}. ${row.name}`;
      const pts=document.createElement("span"); pts.className="score-pill"; pts.textContent=row.disqualified?`${number.format(row.totalPoints || 0)} poin · DQ`:`${number.format(row.totalPoints || 0)} poin`;
      const edit=rismaIconButton("Ubah","fa-pen","ghost compact risma-mini-action",()=>openRismaParticipant(row));
      const del=rismaIconButton("Hapus","fa-trash-can","danger-soft compact risma-mini-action",()=>deleteRismaParticipant(row));
      edit.disabled=masterLocked;del.disabled=masterLocked;
      if(masterLocked){edit.title="Data peserta dikunci setelah Minggu 2. Hanya Owner yang dapat mengubah.";del.title=edit.title;}
      line.append(name,pts,edit,del);
      const meta=document.createElement("div"); meta.className="item-meta risma-row-meta"; meta.textContent=`${participantWeekSummary(row)}${row.gender?` · ${row.gender}`:""}${row.excusedUsed?` · kelonggaran ${row.excusedUsed}/7 hari`:""}`;
      card.append(line,meta); full.appendChild(card);
    });
  }

  function renderRismaWeeks() {
    const wrap=$("risma-week-grid"); wrap.replaceChildren();
    const period=rismaDetail?.activePeriod;
    const latest=(rismaDetail?.weeks||[]).reduce((m,row)=>Math.max(m,Number(row.week)||0),0);
    const owner=rismaDetail?.role==="owner";
    for(let week=1;week<=4;week++){
      const data=(rismaDetail?.weeks||[]).find(row=>Number(row.week)===week);
      const locked=Boolean(data) && latest>week && !owner;
      const card=document.createElement("article"); card.className=`week-card${data ? " done" : ""}${locked?" locked":""}`;
      const top=document.createElement("div");
      const title=document.createElement("strong"); title.textContent=`Minggu ${week}`;
      const meta=document.createElement("span"); meta.textContent=locked?`Terkunci · Minggu ${latest} sudah diinput`:data?`${data.entryCount || 0} peserta · tersimpan`:(period?"Belum diinput":"Tidak ada periode aktif");
      top.append(title,meta);
      const action=rismaIconButton(locked?"Terkunci":data?"Edit":"Input",locked?"fa-lock":data?"fa-pen":"fa-plus",locked?"ghost compact":""+(data?"ghost compact":"primary compact"),()=>openRismaWeek(week));
      action.disabled=!period || locked || (week>1 && !(rismaDetail.weeks||[]).some(x=>Number(x.week)===1));
      card.append(top,action); wrap.appendChild(card);
    }
  }

  function rismaPointForAttendance(attendance) {
    const map = rismaDetail?.activePeriod?.scoring || {0:0,1:1,2:2,3:3,4:4,5:6,6:7.5,7:9};
    return Number(map[Number(attendance)] ?? 0);
  }

  function rismaParticipantById(id) {
    return (rismaDetail?.scores || []).find(row => String(row.id) === String(id)) || null;
  }

  function resetRismaWeekBuilder({ keepMode = false } = {}) {
    const week = Number($("risma-week-number").value || 1);
    rismaWeekEditIndex = -1;
    if (!keepMode) rismaWeekNewParticipantMode = week === 1;
    $("risma-week-person-name").value = "";
    $("risma-week-attendance").value = "0";
    $("risma-week-gender").value = "";
    $("risma-week-excused").value = "0";
    syncRismaWeekBuilder();
  }

  function syncRismaWeekBuilder() {
    const week = Number($("risma-week-number").value || 1);
    const nameInput = $("risma-week-person-name");
    const select = $("risma-week-person-select");
    const toggle = $("risma-week-new-toggle");
    const label = $("risma-week-person-label");
    const genderWrap=$("risma-week-gender-wrap");
    const excusedWrap=$("risma-week-excused-wrap");
    let selectedParticipant=null;

    if (week === 1) {
      rismaWeekNewParticipantMode = true;
      nameInput.hidden = false; select.hidden = true; toggle.hidden = true;
      genderWrap.hidden=false;
      const editing=rismaWeekEditIndex>=0?rismaWeekDraft[rismaWeekEditIndex]:null;
      selectedParticipant=editing?.participantId?rismaParticipantById(editing.participantId):null;
      excusedWrap.hidden=String(selectedParticipant?.gender||editing?.gender||"")!=="perempuan" || !editing?.participantId;
      label.firstChild.textContent = "Nama peserta\n            ";
      $("risma-week-entry-hint").textContent = excusedWrap.hidden
        ? "Masukkan nama, jenis peserta, dan jumlah hadir. Kelonggaran dapat diatur setelah peserta tersimpan."
        : "Peserta perempuan. Anda dapat menambahkan hari kelonggaran berhalangan.";
    } else {
      toggle.hidden = false;
      if (rismaWeekNewParticipantMode) {
        nameInput.hidden = false; select.hidden = true; genderWrap.hidden=false; excusedWrap.hidden=true;
        toggle.textContent = "Pilih peserta lama";
        label.firstChild.textContent = "Nama peserta baru\n            ";
        $("risma-week-entry-hint").textContent = "Peserta baru akan dibuatkan tim baru agar tim lama tidak berubah.";
      } else {
        nameInput.hidden = true; select.hidden = false; genderWrap.hidden=true;
        toggle.textContent = "+ Peserta baru";
        label.firstChild.textContent = "Pilih peserta\n            ";
        fillRismaWeekParticipantSelect();
        selectedParticipant=rismaParticipantById(select.value);
        excusedWrap.hidden=String(selectedParticipant?.gender||"")!=="perempuan";
        $("risma-week-entry-hint").textContent = excusedWrap.hidden
          ? "Pilih nama peserta, lalu pilih jumlah hadir."
          : `Peserta perempuan. Kelonggaran tersisa ${Math.max(0,7-Number(selectedParticipant?.excusedUsed||0))} hari.`;
      }
    }
    if(!excusedWrap.hidden){
      const oldExcused=rismaWeekEditIndex>=0?Number(rismaWeekDraft[rismaWeekEditIndex]?.excused||0):0;
      const remaining=Math.max(0,7-(Number(selectedParticipant?.excusedUsed||0)-oldExcused));
      [...$("risma-week-excused").options].forEach(opt=>opt.disabled=Number(opt.value)>remaining);
      if(Number($("risma-week-excused").value)>remaining) $("risma-week-excused").value="0";
    }
    $("risma-week-add-entry").innerHTML = rismaWeekEditIndex >= 0 ? `<i class="fa-solid fa-floppy-disk"></i> Simpan` : `<i class="fa-solid fa-plus"></i> Tambahkan`;
  }

  function fillRismaWeekParticipantSelect() {
    const select = $("risma-week-person-select");
    const current = rismaWeekEditIndex >= 0 ? rismaWeekDraft[rismaWeekEditIndex]?.participantId : select.value;
    const used = new Set(rismaWeekDraft.map((row,index) => index === rismaWeekEditIndex ? "" : String(row.participantId || "")).filter(Boolean));
    select.replaceChildren();
    const placeholder = document.createElement("option"); placeholder.value=""; placeholder.textContent="Pilih peserta…"; select.appendChild(placeholder);
    for (const row of (rismaDetail?.scores || []).filter(row=>!row.disqualified)) {
      if (used.has(String(row.id))) continue;
      const option=document.createElement("option"); option.value=String(row.id); option.textContent=row.name; select.appendChild(option);
    }
    if (current && [...select.options].some(opt=>opt.value===String(current))) select.value=String(current);
  }

  function renderRismaWeekDraft() {
    const list=$("risma-week-draft-list"); list.replaceChildren();
    $("risma-week-draft-count").textContent=`${rismaWeekDraft.length} peserta`;
    if(!rismaWeekDraft.length){ list.appendChild(emptyBox("Belum ada peserta di daftar input.")); return; }
    rismaWeekDraft.forEach((row,index)=>{
      const card=document.createElement("article"); card.className="risma-week-draft-card";
      const info=document.createElement("div");
      const title=document.createElement("strong"); title.textContent=row.name;
      const effective=Math.min(7,Number(row.attendance||0)+Number(row.excused||0));
      const meta=document.createElement("span"); meta.textContent=`${row.attendance}x hadir${row.excused?` + ${row.excused} hari kelonggaran`:""} → ${number.format(rismaPointForAttendance(effective))} poin${row.isNew ? " · peserta baru" : ""}`;
      info.append(title,meta);
      const actions=document.createElement("div"); actions.className="risma-draft-actions";
      actions.append(rismaIconButton("Ubah","fa-pen","ghost compact",()=>editRismaWeekDraft(index)),rismaIconButton("Hapus","fa-trash-can","danger-soft compact",()=>removeRismaWeekDraft(index)));
      card.append(info,actions); list.appendChild(card);
    });
  }

  function openRismaWeek(week) {
    const existing=(rismaDetail?.weeks||[]).find(row=>Number(row.week)===Number(week));
    const latest=(rismaDetail?.weeks||[]).reduce((m,row)=>Math.max(m,Number(row.week)||0),0);
    if(existing && latest>Number(week) && rismaDetail?.role!=="owner"){
      alert(`Minggu ${week} sudah dikunci karena Minggu ${latest} sudah diinput. Hanya Owner yang dapat memperbaikinya.`);return;
    }
    $("risma-week-number").value=String(week);
    $("risma-week-title").textContent=`${existing?"Edit":"Input"} Minggu ${week}`;
    $("risma-week-submit-number").textContent=String(week);
    $("risma-week-zero-note").hidden=Number(week)===1;
    rismaWeekDraft = [];
    rismaWeekEditIndex = -1;
    rismaWeekNewParticipantMode = Number(week) === 1;

    if(existing){
      rismaWeekDraft=(existing.entries||[]).map(entry=>{
        const participant=rismaParticipantById(entry.participantId);
        return { participantId:String(entry.participantId||""), name:participant?.name || `Peserta ${entry.participantId}`, attendance:Number(entry.attendance||0), excused:Number(entry.excused||0), gender:participant?.gender||"", isNew:false };
      });
    }
    setStatus($("risma-week-status"));
    resetRismaWeekBuilder();
    renderRismaWeekDraft();
    $("risma-week-dialog").showModal();
  }

  function addRismaWeekDraft() {
    const week=Number($("risma-week-number").value||1);
    const attendance=Number($("risma-week-attendance").value);
    let participantId="", name="", isNew=false, gender="", excused=0;

    if(week===1 || rismaWeekNewParticipantMode){
      name=String($("risma-week-person-name").value||"").trim().replace(/\s+/g," ");
      if(!name){ setStatus($("risma-week-status"),"Nama peserta belum diisi.","error"); return; }
      const known=(rismaDetail?.scores||[]).find(row=>row.name.trim().toLowerCase()===name.toLowerCase());
      participantId=known?.id || "";
      if(known) name=known.name;
      isNew=!known;
      gender=known?.gender || $("risma-week-gender").value || "";
      if(rismaWeekEditIndex>=0 && participantId && String(gender)==="perempuan") excused=Number($("risma-week-excused").value||0);
    } else {
      participantId=String($("risma-week-person-select").value||"");
      const participant=rismaParticipantById(participantId);
      if(!participant){ setStatus($("risma-week-status"),"Pilih peserta terlebih dahulu.","error"); return; }
      name=participant.name;gender=participant.gender||"";
      excused=String(gender)==="perempuan"?Number($("risma-week-excused").value||0):0;
      const remaining=Math.max(0,7-Number(participant.excusedUsed||0)+Number(rismaWeekDraft[rismaWeekEditIndex]?.excused||0));
      if(excused>remaining){setStatus($("risma-week-status"),`Kelonggaran ${name} tersisa ${remaining} hari.`,"error");return;}
    }

    const duplicate=rismaWeekDraft.findIndex((row,index)=>index!==rismaWeekEditIndex && ((participantId && String(row.participantId)===participantId) || row.name.trim().toLowerCase()===name.toLowerCase()));
    if(duplicate>=0){ setStatus($("risma-week-status"),`${name} sudah ada di daftar input.`,"error"); return; }

    const item={participantId,name,attendance,excused,gender,isNew};
    if(rismaWeekEditIndex>=0) rismaWeekDraft.splice(rismaWeekEditIndex,1,item);
    else rismaWeekDraft.unshift(item);
    setStatus($("risma-week-status"));
    resetRismaWeekBuilder();
    renderRismaWeekDraft();
  }

  function editRismaWeekDraft(index) {
    const row=rismaWeekDraft[index]; if(!row)return;
    const week=Number($("risma-week-number").value||1);
    rismaWeekEditIndex=index;
    $("risma-week-attendance").value=String(row.attendance);
    $("risma-week-excused").value=String(row.excused||0);
    $("risma-week-gender").value=row.gender||"";
    if(week===1){ rismaWeekNewParticipantMode=true; $("risma-week-person-name").value=row.name; }
    else if(row.participantId && !row.isNew){ rismaWeekNewParticipantMode=false; }
    else { rismaWeekNewParticipantMode=true; $("risma-week-person-name").value=row.name; }
    syncRismaWeekBuilder();
    if(!rismaWeekNewParticipantMode && row.participantId){ $("risma-week-person-select").value=String(row.participantId); syncRismaWeekBuilder(); $("risma-week-excused").value=String(row.excused||0); }
    if(rismaWeekNewParticipantMode) $("risma-week-person-name").value=row.name;
  }

  function removeRismaWeekDraft(index) {
    rismaWeekDraft.splice(index,1);
    if(rismaWeekEditIndex===index) resetRismaWeekBuilder();
    else if(rismaWeekEditIndex>index) rismaWeekEditIndex--;
    renderRismaWeekDraft();
    syncRismaWeekBuilder();
  }

  function rismaWeekPayloadEntries() {
    const week=Number($("risma-week-number").value||1);
    return rismaWeekDraft.map(row => week === 1
      ? { name:row.name, attendance:Number(row.attendance), excused:Number(row.excused||0), gender:row.gender||"" }
      : (row.participantId && !row.isNew
          ? { participantId:row.participantId, attendance:Number(row.attendance), excused:Number(row.excused||0), gender:row.gender||"" }
          : { name:row.name, attendance:Number(row.attendance), excused:Number(row.excused||0), gender:row.gender||"" }));
  }

  function openRismaParticipant(row){
    $("risma-participant-id").value=row.id;
    $("risma-participant-name").value=row.name||"";
    $("risma-participant-gender").value=row.gender||"";
    const owner=rismaDetail?.role==="owner";
    $("risma-participant-dq-box").hidden=!owner;
    $("risma-participant-disqualified").checked=Boolean(row.disqualified);
    $("risma-participant-dq-reason").value=row.disqualifiedReason||"";
    $("risma-participant-dq-reason-wrap").hidden=!owner || !row.disqualified;
    setStatus($("risma-participant-status"));
    $("risma-participant-dialog").showModal();
  }
  async function deleteRismaParticipant(row){ if(!confirm(`Hapus ${row.name} dari peserta RISMA Poin? Data poin peserta ini ikut dibersihkan.`))return; await api(`/api/risma/participant/${encodeURIComponent(row.id)}`,{method:"DELETE",body:"{}"}); await loadRisma(); }

  function activeCouponGroup(){ return (rismaDetail?.couponTypes||[]).find(row=>row.type===rismaCouponType) || null; }
  function renderRismaCoupons(){
    const group=activeCouponGroup() || (rismaDetail?.couponTypes||[])[0];
    if(group){ rismaCouponType=group.type; $("risma-coupon-type").value=group.type; }
    const summary=$("risma-coupon-summary"), list=$("risma-coupon-list"); summary.replaceChildren(); list.replaceChildren();
    if(!group){ summary.appendChild(emptyBox("Aktifkan periode untuk mengelola kupon.")); return; }
    for(const [label,value] of [["Penerima",group.stats.recipients],["Kupon",group.stats.coupons],["Sudah dibagi",group.stats.done],["Menunggu",group.stats.pending]]){
      const card=document.createElement("article"); card.className="metric-card"; card.innerHTML=`<span>${label}</span><b>${wholeNumber.format(value||0)}</b>`; summary.appendChild(card);
    }
    if(!(group.rows||[]).length){ list.appendChild(emptyBox("Belum ada penerima kupon.")); return; }
    for(const row of group.rows){
      const card=document.createElement("article"); card.className="item-card risma-coupon-card compact";
      const line=document.createElement("div"); line.className="risma-coupon-line";
      const name=document.createElement("strong"); name.className="risma-row-name"; name.textContent=`${row.no} · ${row.name}`;
      const count=document.createElement("span"); count.className=`risma-coupon-count-inline ${row.status==="done"?"done":"pending"}`; count.textContent=`${wholeNumber.format(row.count||1)} kupon`;
      const done=rismaIconButton(row.status==="done"?"Batal":"Selesai",row.status==="done"?"fa-rotate-left":"fa-check",row.status==="done"?"ghost compact risma-mini-action":"success-soft compact risma-mini-action",()=>toggleRismaCoupon(row));
      const edit=rismaIconButton("Edit","fa-pen","ghost compact risma-mini-action",()=>openRismaCouponEdit(row));
      const del=rismaIconButton("Hapus","fa-trash-can","danger-soft compact risma-mini-action",()=>deleteRismaCoupon(row));
      line.append(name,count,done,edit,del);
      const meta=document.createElement("div"); meta.className="item-meta risma-row-meta"; meta.textContent=row.status==="done"?"Sudah dibagikan":"Belum dibagikan";
      card.append(line,meta); list.appendChild(card);
    }
  }
  async function toggleRismaCoupon(row){ await api(`/api/risma/coupon/${encodeURIComponent(rismaCouponType)}/${row.no}`,{method:"PATCH",body:JSON.stringify({done:row.status!=="done"})}); await loadRisma(); }
  function openRismaCouponEdit(row){ $("risma-coupon-edit-no").value=row.no; $("risma-coupon-edit-name").value=row.name; fillRismaCouponCountSelect($("risma-coupon-edit-count"),row.count||1); setStatus($("risma-coupon-edit-status")); $("risma-coupon-edit-dialog").showModal(); }
  async function deleteRismaCoupon(row){ if(!confirm(`Hapus ${row.name} dari ${activeCouponGroup()?.label || "Kupon THR"}?`))return; await api(`/api/risma/coupon/${encodeURIComponent(rismaCouponType)}/${row.no}`,{method:"DELETE",body:"{}"}); await loadRisma(); }

  function syncRismaTemplateForm(){
    const settings=rismaDetail?.settings; const type=$("risma-template-type").value || "ngaji"; const tpl=settings?.couponTemplates?.[type] || {};
    $("risma-template-title").value=tpl.title||""; $("risma-template-slogan").value=tpl.slogan||""; $("risma-template-footer").value=tpl.footer||""; $("risma-template-palette").value=tpl.palette||"hijau";
  }

  function rismaCouponMax(){
    const value=Number(rismaDetail?.settings?.maxCouponsPerRecipient||3);
    return Number.isInteger(value)&&value>=1&&value<=20?value:3;
  }

  function fillRismaCouponCountSelect(select, selected=1){
    if(!select)return;
    const max=rismaCouponMax(); const wanted=Math.max(1,Math.min(max,Number(selected)||1));
    select.innerHTML="";
    for(let count=1;count<=max;count++){const option=document.createElement("option");option.value=String(count);option.textContent=`${count} kupon`;select.appendChild(option);}
    select.value=String(wanted);
  }

  function syncRismaCouponCountSelects(){
    fillRismaCouponCountSelect($("risma-coupon-add-count"), Number($("risma-coupon-add-count")?.value||1));
    fillRismaCouponCountSelect($("risma-coupon-edit-count"), Number($("risma-coupon-edit-count")?.value||1));
  }

  function renderRismaSettings(){
    const settings=rismaDetail?.settings; const owner=rismaDetail?.role==="owner"; const period=rismaDetail?.activePeriod;
    const form=$("risma-settings-form"), template=$("risma-template-form");
    for(const el of [...form.elements,...template.elements]) el.disabled=!owner || !period;
    $("risma-template-reset").disabled=!owner || !period;
    $("risma-team-rebuild-box").hidden=!owner;
    const week2Done=(rismaDetail?.weeks||[]).some(row=>Number(row.week)===2);
    const rebuild=$("risma-team-rebuild");
    rebuild.disabled=!owner || !period || week2Done || (rismaDetail?.scores||[]).length<3;
    $("risma-team-rebuild-note").textContent = week2Done
      ? "Minggu 2 sudah diinput. Susunan tim dikunci dan tidak dapat diacak ulang."
      : "Hanya Owner. Acak ulang tersedia sampai sebelum Minggu 2 diinput.";
    if(!settings){ $("risma-setting-rank").value="10"; $("risma-setting-team").value="3"; $("risma-setting-coupon-max").value="3"; $("risma-setting-ngaji").checked=true; $("risma-setting-taraweh").checked=true; $("risma-setting-tadarus").checked=true; syncRismaCouponCountSelects(); syncRismaTemplateForm(); return; }
    $("risma-setting-rank").value=String(settings.individualWinnerCount||10); $("risma-setting-team").value=String(settings.teamWinnerCount||3); $("risma-setting-coupon-max").value=String(settings.maxCouponsPerRecipient||3);
    $("risma-setting-ngaji").checked=settings.couponEnabled?.ngaji!==false; $("risma-setting-taraweh").checked=settings.couponEnabled?.taraweh!==false; $("risma-setting-tadarus").checked=settings.couponEnabled?.tadarus!==false;
    syncRismaCouponCountSelects(); syncRismaTemplateForm();
  }

  function rismaPublicationPayload(kind){
    if(kind==="announcement") return { title:$("risma-publish-announce-title").value, body:$("risma-publish-announce-body").value };
    if(kind==="invitation") return { recipient:$("risma-publish-invite-recipient").value, event:$("risma-publish-invite-event").value, date:$("risma-publish-invite-date").value, time:$("risma-publish-invite-time").value, place:$("risma-publish-invite-place").value, note:$("risma-publish-invite-note").value };
    return {};
  }

  function placeRismaPublicationPreview(anchor){
    const box=$("risma-publication-preview-box");
    if(!box)return;
    const item=anchor?.closest?.(".risma-pub-item,.risma-archive-card");
    if(item) item.insertAdjacentElement("afterend",box);
    box.hidden=false;
    setTimeout(()=>{try{box.scrollIntoView({behavior:"smooth",block:"nearest"});}catch(_){ }},60);
  }

  function showRismaPublicationPreview(title, text, kind="", anchor=null){
    rismaPublicationPreviewKind = kind || "";
    $("risma-publication-preview-title").textContent = title || "Pratinjau publikasi";
    $("risma-publication-preview-text").value = String(text || "").trim();
    $("risma-publication-copy").disabled = !String(text || "").trim();
    if(anchor) placeRismaPublicationPreview(anchor);
    else $("risma-publication-preview-box").hidden=false;
  }

  function openRismaWeekPublishPrompt(week){
    rismaPendingPublishWeek=Number(week)||0;
    $("risma-week-publish-message").textContent=`Edit Minggu ${rismaPendingPublishWeek} sudah disimpan. Kirim update RISMA Poin terbaru ke grup?`;
    setStatus($("risma-week-publish-status"));
    $("risma-week-publish-send").disabled=Boolean(rismaDetail?.activePeriod?.isSimulation);
    if(rismaDetail?.activePeriod?.isSimulation) setStatus($("risma-week-publish-status"),"Mode simulasi: pesan ke grup tidak dikirim.","error");
    $("risma-week-publish-dialog").showModal();
  }

  async function sendRismaWeekUpdateToGroup(){
    const week=rismaPendingPublishWeek;
    setStatus($("risma-week-publish-status"),"Mengirim update RISMA Poin…");
    $("risma-week-publish-send").disabled=true;
    try{
      const data=await api("/api/risma/publication/send",{method:"POST",body:JSON.stringify({kind:"rank",data:{}})});
      setStatus($("risma-week-publish-status"),data.message||"Update RISMA Poin berhasil dikirim.","success");
      setStatus($("risma-publish-status"),data.message||`Update Minggu ${week} berhasil dikirim.`,"success");
      setTimeout(()=>{if($("risma-week-publish-dialog").open) $("risma-week-publish-dialog").close();},650);
    }catch(error){
      setStatus($("risma-week-publish-status"),error.message,"error");
      $("risma-week-publish-send").disabled=false;
    }
  }

  async function previewRismaPublication(kind, statusId){
    const el = statusId ? $(statusId) : $("risma-publication-preview-status");
    setStatus(el, "Membuat pratinjau…");
    setStatus($("risma-publication-preview-status"), "Membuat pratinjau…");
    try {
      const data = await api("/api/risma/publication/preview", { method:"POST", body:JSON.stringify({ kind, data: rismaPublicationPayload(kind) }) });
      showRismaPublicationPreview(data.title, data.text, kind, el);
      setStatus(el, "Pratinjau siap.", "success");
      setStatus($("risma-publication-preview-status"), `${data.title || "Publikasi"} siap ditinjau.`, "success");
      switchRismaTab("publikasi");
    } catch (error) {
      setStatus(el, error.message, "error");
      setStatus($("risma-publication-preview-status"), error.message, "error");
    }
  }

  async function sendRismaPublication(kind, statusId, confirmText){
    if(confirmText && !confirm(confirmText)) return;
    const el = statusId ? $(statusId) : $("risma-publication-preview-status");
    setStatus(el, "Mengirim ke grup…");
    try {
      const data = await api("/api/risma/publication/send", { method:"POST", body:JSON.stringify({ kind, data: rismaPublicationPayload(kind) }) });
      showRismaPublicationPreview(data.title, data.text, kind);
      setStatus(el, data.message || "Publikasi berhasil dikirim.", "success");
      setStatus($("risma-publication-preview-status"), data.message || "Publikasi berhasil dikirim.", "success");
    } catch (error) {
      setStatus(el, error.message, "error");
      setStatus($("risma-publication-preview-status"), error.message, "error");
    }
  }

  async function publishRismaRank(){
    if(!rismaDetail?.activePeriod)return;
    await sendRismaPublication("rank", "risma-publish-status", "Kirim ranking lengkap peserta dan tim ke semua grup yang terinstal RISMA?");
  }

  async function sendRismaPublicationPdf(kind, statusId){
    const el = statusId ? $(statusId) : $("risma-publication-preview-status");
    setStatus(el, "Membuat PDF dan mengirim ke WhatsApp Anda…");
    try {
      const data = await api("/api/risma/publication/pdf-self", { method:"POST", body:JSON.stringify({ kind, data: rismaPublicationPayload(kind) }) });
      showRismaPublicationPreview(data.title, data.text, kind);
      setStatus(el, data.message || "PDF berhasil dikirim ke WhatsApp Anda.", "success");
      setStatus($("risma-publication-preview-status"), `${data.fileName || "PDF"} berhasil dikirim.`, "success");
    } catch (error) {
      setStatus(el, error.message, "error");
      setStatus($("risma-publication-preview-status"), error.message, "error");
    }
  }

  async function rismaOwnerCreatePeriod(){
    const year = Number($("risma-owner-period-year").value);
    if(!Number.isInteger(year) || year < 1400 || year > 1600){setStatus($("risma-owner-period-status"),"Tahun Hijriah harus 1400-1600.","error");return;}
    if(!confirm(`Aktifkan periode Ramadan ${year} H?`))return;
    setStatus($("risma-owner-period-status"),"Membuat periode…");
    try{const data=await api("/api/risma/period",{method:"POST",body:JSON.stringify({hijriYear:year})});rismaDetail=data.risma;renderRisma();setStatus($("risma-owner-period-status"),`Ramadan ${year} H aktif.`,"success");}
    catch(error){setStatus($("risma-owner-period-status"),error.message,"error");}
  }

  async function rismaOwnerClosePeriod(){
    const period=rismaDetail?.activePeriod;
    if(!period || period.isSimulation)return;
    if(!confirm(`Tutup periode Ramadan ${period.hijriYear} H? Data tetap tersimpan.`))return;
    setStatus($("risma-owner-period-status"),"Menutup periode…");
    try{const data=await api(`/api/risma/period/${encodeURIComponent(period.id)}/close`,{method:"POST",body:"{}"});rismaDetail=data.risma;renderRisma();setStatus($("risma-owner-period-status"),"Periode ditutup. Data tetap tersimpan.","success");}
    catch(error){setStatus($("risma-owner-period-status"),error.message,"error");}
  }

  async function rismaSimulationAction(action){
    const year = Number($("risma-owner-simulation-year").value || rismaDetail?.activePeriod?.hijriYear || 1448);
    const labels={start:"Memulai simulasi…",seed:"Mengisi data contoh…",reset:"Mereset simulasi…",end:"Mengakhiri simulasi…"};
    const endpoint={start:"start",seed:"seed",reset:"reset",end:"end"}[action];
    if(!endpoint)return;
    if(action==="reset" && !confirm("Kosongkan seluruh data simulasi? Data asli tidak berubah."))return;
    if(action==="end" && !confirm("Selesaikan simulasi dan kembali ke data asli?"))return;
    setStatus($("risma-owner-simulation-status"),labels[action]||"Memproses…");
    try{
      const body=["start","seed"].includes(action)?JSON.stringify({hijriYear:year}):"{}";
      const data=await api(`/api/risma/simulation/${endpoint}`,{method:"POST",body});
      rismaDetail=data.risma;
      renderRisma();
      const message=action==="start"?`Simulasi Ramadan ${year} H aktif.`:action==="seed"?"Data contoh simulasi berhasil dibuat.":action==="reset"?"Data simulasi sudah dikosongkan.":"Simulasi selesai. Kembali ke data asli.";
      setStatus($("risma-owner-simulation-status"),message,"success");
    }catch(error){setStatus($("risma-owner-simulation-status"),error.message,"error");}
  }

  function updateRismaCouponPrintSummary(){
    const group = rismaDetail?.couponTypes || [];
    const selector = $("risma-print-coupon-type")?.value || "semua";
    const perPage = Number($("risma-print-coupon-layout")?.value || 6);
    const sheets = Math.max(1, Number($("risma-print-coupon-sheets")?.value || 1));
    const activeTypes = selector === "semua" ? group.filter(x=>x.enabled) : group.filter(x=>x.type===selector && x.enabled);
    const pages = activeTypes.length * sheets;
    const total = pages * perPage;
    const dataCount = activeTypes.reduce((sum,row)=>sum+Number(row.stats?.coupons||0),0);
    if ($("risma-print-coupon-summary")) $("risma-print-coupon-summary").textContent = activeTypes.length
      ? `${activeTypes.map(x=>x.label).join(" · ")} • ${pages} lembar A4 • ${perPage} kupon/lembar • ${total} kupon kosong. Data penerima saat ini: ${dataCount} kupon.`
      : "Jenis kupon ini sedang tidak aktif pada periode sekarang.";
  }

  async function printRismaCouponsPdf(){
    const selector=$("risma-print-coupon-type").value;
    const perPage=Number($("risma-print-coupon-layout").value||6);
    const sheets=Number($("risma-print-coupon-sheets").value||1);
    if(!Number.isInteger(sheets)||sheets<1||sheets>100){setStatus($("risma-print-coupon-status"),"Jumlah lembar harus 1-100.","error");return;}
    setStatus($("risma-print-coupon-status"),"Membuat PDF Kupon THR…");
    try{
      const data=await api("/api/risma/coupon-print/pdf-self",{method:"POST",body:JSON.stringify({selector,perPage,sheets})});
      setStatus($("risma-print-coupon-status"),`${data.message} ${data.totalSheets||0} lembar · ${data.totalCoupons||0} kupon.`,"success");
    }catch(error){setStatus($("risma-print-coupon-status"),error.message,"error");}
  }

  async function loadRismaArchives(){
    setStatus($("risma-archive-status"),"Memuat arsip…");
    const data=await api("/api/risma/publications?limit=30");
    rismaArchives=data.archives||[];
    renderRismaArchives();
    setStatus($("risma-archive-status"),rismaArchives.length?`${rismaArchives.length} arsip terbaru.`:"Belum ada publikasi yang diarsipkan.");
  }

  function rismaArchiveIcon(kind){
    if(kind==="undangan")return "fa-envelope-open-text";
    if(kind==="pengumuman")return "fa-bullhorn";
    if(kind==="poin_rules")return "fa-moon";
    if(["poin","poin_full"].includes(kind))return "fa-ranking-star";
    if(kind.includes("coupon"))return "fa-ticket";
    return "fa-file-lines";
  }

  function renderRismaArchives(){
    const list=$("risma-archive-list"); list.replaceChildren();
    $("risma-archive-count").textContent=`${rismaArchives.length} arsip`;
    if(!rismaArchives.length){list.appendChild(emptyBox("Belum ada arsip publikasi."));return;}
    for(const row of rismaArchives){
      const card=document.createElement("article");card.className="risma-archive-card";
      const icon=document.createElement("span");icon.className="risma-log-icon";icon.innerHTML=`<i class="fa-solid ${rismaArchiveIcon(row.kind||"")}"></i>`;
      const info=document.createElement("div");info.className="risma-archive-info";
      const title=document.createElement("strong");title.textContent=row.title||"Publikasi RISMA";
      const meta=document.createElement("span");meta.textContent=`${row.hijriYear?`Ramadan ${row.hijriYear} H · `:""}${row.dibuatPada?dateTimeFmt.format(new Date(row.dibuatPada)):"—"}`;
      info.append(title,meta);
      const actions=document.createElement("div");actions.className="risma-archive-actions";
      const preview=button("Lihat","ghost compact",()=>rismaArchiveAction(row,"preview",card));preview.innerHTML='<i class="fa-solid fa-eye"></i> Lihat';
      const send=button("Kirim","ghost compact",()=>rismaArchiveAction(row,"send",card));send.innerHTML='<i class="fa-brands fa-whatsapp"></i> Kirim';
      const pdf=button("PDF","ghost compact",()=>rismaArchiveAction(row,"pdf-self",card));pdf.innerHTML='<i class="fa-solid fa-file-pdf"></i> PDF';
      actions.append(preview,send,pdf);
      if(rismaDetail?.role==="owner" && row.kind==="undangan"){
        const del=button("Hapus","danger-soft compact",()=>deleteRismaArchive(row));del.innerHTML='<i class="fa-solid fa-trash-can"></i> Hapus';actions.append(del);
      }
      card.append(icon,info,actions);list.appendChild(card);
    }
  }

  async function rismaArchiveAction(row,action,anchor=null){
    if(action==="send"&&!confirm(`Kirim ulang arsip ini ke semua grup RISMA?\n\n${row.title}`))return;
    setStatus($("risma-archive-status"),action==="preview"?"Membuka arsip…":action==="send"?"Mengirim ulang arsip…":"Membuat PDF arsip…");
    try{
      const data=await api(`/api/risma/publications/${encodeURIComponent(row.id)}/${action}`,{method:"POST",body:"{}"});
      if(data.text)showRismaPublicationPreview(data.title,data.text,"archive",anchor);
      setStatus($("risma-archive-status"),data.message||"Arsip siap.","success");
    }catch(error){setStatus($("risma-archive-status"),error.message,"error");}
  }

  async function deleteRismaArchive(row){
    if(!confirm(`Hapus arsip undangan ini?

${row.title}

Nomor surat yang terhapus dapat dipakai kembali jika menjadi nomor terakhir.`))return;
    setStatus($("risma-archive-status"),"Menghapus arsip undangan…");
    try{
      const data=await api(`/api/risma/publications/${encodeURIComponent(row.id)}`,{method:"DELETE",body:"{}"});
      await loadRismaArchives();
      setStatus($("risma-archive-status"),data.message||"Arsip undangan dihapus.","success");
    }catch(error){setStatus($("risma-archive-status"),error.message,"error");}
  }

  async function saveRismaSignatures(){
    const chair=$("risma-signature-chair").value.trim();
    const secretary=$("risma-signature-secretary").value.trim();
    setStatus($("risma-signature-status"),"Menyimpan penandatangan…");
    try{
      const data=await api("/api/risma/signatures",{method:"PUT",body:JSON.stringify({chair,secretary})});
      rismaDetail=data.risma;renderRisma();setStatus($("risma-signature-status"),"Penandatangan PDF tersimpan.","success");
    }catch(error){setStatus($("risma-signature-status"),error.message,"error");}
  }

  function renderRismaPeriodHistory(){
    const list=$("risma-period-history-list"); if(!list)return; list.replaceChildren();
    const rows=(rismaDetail?.periodHistory||[]).slice().sort((a,b)=>Number(b.hijriYear||0)-Number(a.hijriYear||0));
    if(!rows.length){list.appendChild(emptyBox("Belum ada riwayat periode Ramadan."));return;}
    for(const row of rows){
      const card=document.createElement("article");card.className="risma-period-history-card";
      const info=document.createElement("div");info.className="risma-period-history-info";
      const title=document.createElement("strong");title.textContent=`Ramadan ${row.hijriYear} H`;
      const meta=document.createElement("span");meta.textContent=`${row.status==="active"?"Aktif":"Ditutup"} · ${row.participants||0} peserta · ${row.weeks||0}/4 minggu · ${row.coupons||0} kupon`;
      info.append(title,meta);
      const side=document.createElement("div");side.className="risma-period-history-side";
      const chip=document.createElement("span");chip.className=row.status==="active"?"status-chip done":"status-chip pending";chip.textContent=row.status==="active"?"Aktif":"Arsip";
      const view=button("Lihat rekap","ghost compact",()=>openRismaPeriodHistory(row));view.innerHTML='<i class="fa-solid fa-chart-simple"></i> Lihat rekap';
      side.append(chip,view);card.append(info,side);list.appendChild(card);
    }
  }

  async function openRismaPeriodHistory(row){
    setStatus($("risma-period-history-status"),"Memuat rekap periode…");
    try{
      const data=await api(`/api/risma/periods/${encodeURIComponent(row.id)}/summary`);
      renderRismaHistoricalSummary(data.period);$("risma-period-summary-dialog").showModal();setStatus($("risma-period-history-status"));
    }catch(error){setStatus($("risma-period-history-status"),error.message,"error");}
  }

  function renderRismaHistoricalSummary(period){
    $("risma-period-summary-title").textContent=`Ramadan ${period.hijriYear} H`;
    const metrics=$("risma-period-summary-metrics");metrics.replaceChildren();
    for(const [label,value] of [["Peserta",period.participants],["Minggu",`${period.weeks}/4`],["Tim",period.teams],["Kupon",period.coupons]]){const card=document.createElement("article");card.className="metric-card";card.innerHTML=`<span>${label}</span><b>${value}</b>`;metrics.appendChild(card);}
    const participants=$("risma-period-summary-participants");participants.replaceChildren();
    if(!(period.scores||[]).length)participants.appendChild(emptyBox("Belum ada data peserta."));
    else(period.scores||[]).forEach((row,index)=>{const card=document.createElement("article");card.className=`risma-history-rank-row${row.disqualified?" disqualified":""}`;card.innerHTML=`<b class="${row.disqualified?"risma-disqualified-name":""}">${index+1}. ${row.name}</b><span>${participantWeekSummary(row)}${row.disqualified?" · DISKUALIFIKASI":""}</span><strong>${number.format(row.totalPoints||0)} poin</strong>`;participants.appendChild(card);});
    const teams=$("risma-period-summary-teams");teams.replaceChildren();
    if(!(period.teamRows||[]).length)teams.appendChild(emptyBox("Belum ada data tim."));
    else(period.teamRows||[]).forEach((row,index)=>{const card=document.createElement("article");card.className="risma-history-team-row";const names=(row.members||[]).map(x=>x.name).join(" · ");card.innerHTML=`<b>${index+1}. ${row.name}</b><span>Ø ${number.format(row.averagePoints||0)} poin · Total ${number.format(row.totalPoints||0)} poin</span><small>${names}</small>`;teams.appendChild(card);});
    const coupons=$("risma-period-summary-coupons");coupons.replaceChildren();
    for(const row of period.couponTypes||[]){const card=document.createElement("article");card.className="metric-card";card.innerHTML=`<span>${row.label}</span><b>${wholeNumber.format(row.stats?.coupons||0)}</b><small>${wholeNumber.format(row.stats?.recipients||0)} penerima</small>`;coupons.appendChild(card);}
    setStatus($("risma-period-summary-status"),period.status==="active"?"Periode ini masih aktif.":"Data lama hanya ditampilkan dan tidak diubah.");
  }

  async function loadRismaLogs(){
    if(rismaDetail?.role!=="owner")return;
    setStatus($("risma-log-status"),"Memuat aktivitas…");
    const data=await api("/api/risma/logs?limit=120");
    rismaLogs=data.logs||[];
    renderRismaLogs();
    setStatus($("risma-log-status"),rismaLogs.length?`${rismaLogs.length} perubahan terbaru.`:"Belum ada perubahan yang tercatat.");
  }

  function rismaLogIcon(action){
    if(action.includes("delete"))return "fa-trash-can";
    if(action.includes("restore"))return "fa-rotate-left";
    if(action.includes("publication"))return "fa-paper-plane";
    if(action.includes("week"))return "fa-star";
    if(action.includes("coupon"))return "fa-ticket";
    if(action.includes("simulation"))return "fa-flask";
    if(action.includes("period"))return "fa-calendar-days";
    if(action.includes("settings"))return "fa-sliders";
    return "fa-clock-rotate-left";
  }

  function renderRismaLogs(){
    const list=$("risma-log-list"); list.replaceChildren();
    const rows=rismaLogs.filter(row=>rismaLogSourceFilter==="all"||String(row.source||"web")==rismaLogSourceFilter);
    if(!rows.length){list.appendChild(emptyBox(rismaLogs.length?"Tidak ada perubahan dari pilihan ini.":"Belum ada perubahan RISMA."));return;}
    for(const row of rows){
      const card=document.createElement("article"); card.className="risma-log-card";
      const icon=document.createElement("span"); icon.className="risma-log-icon"; icon.innerHTML=`<i class="fa-solid ${rismaLogIcon(row.action||"")}"></i>`;
      const info=document.createElement("div"); info.className="risma-log-info";
      const title=document.createElement("strong"); title.textContent=row.label||"Aktivitas RISMA";
      const meta=document.createElement("span");
      const source=String(row.source||"web")==="wa"?"WhatsApp":"Web";
      meta.textContent=`${source} · ${row.actorName||"Admin"} · ${row.dibuatPada?dateTimeFmt.format(new Date(row.dibuatPada)):"—"}`;
      const detail=document.createElement("p"); detail.textContent=row.detail||"";
      info.append(title,meta); if(row.detail)info.append(detail);
      card.append(icon,info);
      const side=document.createElement("div"); side.className="risma-log-side";
      if(row.dipulihkanPada){const chip=document.createElement("span");chip.className="status-chip done";chip.textContent="Dipulihkan";side.appendChild(chip);}
      else if(row.reversible){const restore=button("Pulihkan","ghost compact",()=>restoreRismaLog(row));restore.innerHTML='<i class="fa-solid fa-rotate-left"></i> Pulihkan';side.appendChild(restore);}
      card.appendChild(side);list.appendChild(card);
    }
  }

  async function restoreRismaLog(row){
    if(!confirm(`Pulihkan aktivitas ini?

${row.label}`))return;
    setStatus($("risma-log-status"),"Memulihkan aktivitas…");
    try{
      const data=await api(`/api/risma/logs/${encodeURIComponent(row.id)}/restore`,{method:"POST",body:"{}"});
      rismaLogs=data.logs||[]; rismaDetail=data.risma||rismaDetail; renderRisma(); renderRismaLogs();
      setStatus($("risma-log-status"),"Aktivitas berhasil dipulihkan.","success");
    }catch(error){setStatus($("risma-log-status"),error.message,"error");}
  }

  async function saveRismaSettings(event){ event.preventDefault(); setStatus($("risma-settings-status"),"Menyimpan pengaturan…"); try{ const data=await api("/api/risma/settings",{method:"PUT",body:JSON.stringify({individualWinnerCount:Number($("risma-setting-rank").value),teamWinnerCount:Number($("risma-setting-team").value),maxCouponsPerRecipient:Number($("risma-setting-coupon-max").value),couponEnabled:{ngaji:$("risma-setting-ngaji").checked,taraweh:$("risma-setting-taraweh").checked,tadarus:$("risma-setting-tadarus").checked}})}); rismaDetail=data.risma; renderRisma(); setStatus($("risma-settings-status"),"Pengaturan tersimpan.","success"); }catch(error){setStatus($("risma-settings-status"),error.message,"error");} }
  async function saveRismaTemplate(event){ event.preventDefault(); const type=$("risma-template-type").value; setStatus($("risma-template-status"),"Menyimpan template…"); try{const data=await api(`/api/risma/coupon-template/${encodeURIComponent(type)}`,{method:"PUT",body:JSON.stringify({title:$("risma-template-title").value,slogan:$("risma-template-slogan").value,footer:$("risma-template-footer").value,palette:$("risma-template-palette").value})});rismaDetail=data.risma;renderRisma();setStatus($("risma-template-status"),"Template tersimpan.","success");}catch(error){setStatus($("risma-template-status"),error.message,"error");}}
  async function resetRismaTemplate(){ const type=$("risma-template-type").value;if(!confirm("Kembalikan template kupon ini ke desain bawaan?"))return;setStatus($("risma-template-status"),"Mengembalikan template…");try{const data=await api(`/api/risma/coupon-template/${encodeURIComponent(type)}`,{method:"POST",body:"{}"});rismaDetail=data.risma;renderRisma();setStatus($("risma-template-status"),"Template kembali ke default.","success");}catch(error){setStatus($("risma-template-status"),error.message,"error");}}

  function openRismaManager(){ $("risma-manager-form").reset(); setStatus($("risma-manager-status")); $("risma-manager-dialog").showModal(); }
  async function removeRismaManager(person){ if(!confirm(`Hapus ${person.name} dari Admin RISMA?`))return; await api(`/api/risma/admin/${encodeURIComponent(person.ref)}`,{method:"DELETE",body:"{}"}); await loadRisma(); }


  // ---------- TERNAK ----------
  async function loadTernakIndex(forceDetail=false){
    const data=await api("/api/ternak"); ternakList=data.ternak||[]; ternakJenis=data.jenis||[];
    fillSelect($("ternak-select"),ternakList,row=>`${row.nama} · ${row.jenis} · ${row.role}`);
    $("ternak-create").hidden=!me?.isOwner; $("ternak-kind-create").hidden=!(data.canCreateJenis ?? me?.isOwner);
    if(!ternakList.length){ activeTernak=""; ternakDetail=null; $("ternak-content").hidden=true; return; }
    const wanted=activeTernak && ternakList.some(x=>x.id===activeTernak)?activeTernak:ternakList[0].id;
    $("ternak-select").value=wanted;
    if(forceDetail || !ternakDetail || activeTernak!==wanted) await loadTernak(wanted); else renderTernak();
  }

  async function loadTernak(id){ activeTernak=id; $("ternak-select").value=id; const data=await api(`/api/ternak/${encodeURIComponent(id)}`); ternakDetail=data.ternak; $("ternak-content").hidden=false; renderTernak(); }

  function switchTernakTab(tab){ activeTernakTab=["populasi","aktivitas","keuangan","reproduksi","pengelola"].includes(tab)?tab:"populasi"; document.querySelectorAll("[data-ternak-tab]").forEach(el=>el.classList.toggle("active",el.dataset.ternakTab===activeTernakTab)); for(const name of ["populasi","aktivitas","keuangan","reproduksi","pengelola"]) $("ternak-"+name+"-panel").hidden=name!==activeTernakTab; }

  function renderTernak(){
    if(!ternakDetail)return; const d=ternakDetail; $("ternak-name").textContent=d.nama; $("ternak-kind").textContent=d.jenisNama||"Ternak"; $("ternak-mode").textContent=`${d.mode==="individu"?"Pencatatan per ekor":"Pencatatan kelompok/batch"} · ${d.grup||0} grup`; $("ternak-role").textContent=d.role;
    $("ternak-active").textContent=wholeNumber.format(d.stats?.totalAktif||0); $("ternak-income").textContent=rupiah.format(d.finance?.totalMasuk||0); $("ternak-expense").textContent=rupiah.format(d.finance?.totalKeluar||0); $("ternak-profit").textContent=rupiah.format(d.finance?.selisih||0);
    $("ternak-pop-title").textContent=d.mode==="individu"?"Ternak per ekor":"Batch/populasi"; $("ternak-feed-total").textContent=rupiah.format(d.activity?.pakan?.totalBiaya||0); $("ternak-health-total").textContent=rupiah.format(d.activity?.kesehatan?.totalBiaya||0); $("ternak-manager-add").hidden=d.role!=="owner";
    renderTernakItems(); renderTernakActivities(); renderTernakFinance(); renderTernakReproduction(); renderManagerList($("ternak-manager-list"),d.managers,{remove:removeTernakManager}); switchTernakTab(activeTernakTab);
  }

  function renderManagerList(list, managers, {remove}={}){
    list.replaceChildren(); if(!managers){list.appendChild(emptyBox("Data pengelola belum tersedia."));return;}
    const rows=[{...(managers.owner||{}),roleLabel:"Owner",owner:true},...(managers.admins||[]).map(x=>({...x,roleLabel:"Admin",owner:false}))];
    for(const person of rows){ const card=document.createElement("article"); card.className="manager-card"; const avatar=document.createElement("div"); avatar.className="manager-avatar"; avatar.textContent=String(person.name||"P").slice(0,1).toUpperCase(); const meta=document.createElement("div"); meta.className="manager-meta"; const name=document.createElement("strong"); name.textContent=person.name||"Pengguna PROxyz"; const detail=document.createElement("span"); detail.textContent=`${person.roleLabel}${person.phone?` · +${person.phone}`:""}`; meta.append(name,detail); card.append(avatar,meta); if(managers.role==="owner"&&!person.owner&&remove){ const actions=document.createElement("div"); actions.className="manager-actions"; actions.append(button("Hapus","danger-soft compact",()=>remove(person))); card.append(actions); } list.appendChild(card); }
    if(!(managers.admins||[]).length){ const note=document.createElement("div"); note.className="empty"; note.textContent="Belum ada Admin tambahan."; list.appendChild(note); }
  }

  function itemLabel(item){ return `ID ${item.kode}${item.nama?` · ${item.nama}`:""}`; }
  function renderTernakItems(){ const list=$("ternak-item-list"); list.replaceChildren(); const q=String(ternakSearch||"").toLowerCase(); let rows=(ternakDetail?.items||[]).filter(x=>[x.kode,x.nama,x.fungsi,x.status].some(v=>String(v||"").toLowerCase().includes(q))); rows.sort((a,b)=>Number(b.jumlahAktif>0)-Number(a.jumlahAktif>0)||Number(a.kode)-Number(b.kode)); if(!rows.length){list.appendChild(emptyBox("Data populasi tidak ditemukan."));return;} for(const item of rows){ const card=document.createElement("article"); card.className="item-card ternak-item-card"; const head=document.createElement("div"); head.className="item-top"; const info=document.createElement("div"); const title=document.createElement("strong"); title.textContent=itemLabel(item); const meta=document.createElement("div"); meta.className="item-meta"; meta.textContent=`${item.fungsi||"Belum ditentukan"} · ${item.tipe==="batch"?`${wholeNumber.format(item.jumlahAktif||0)} aktif`:(item.kelamin||"—")} · ${item.status||"aktif"}`; info.append(title,meta); const badge=document.createElement("span"); badge.className=Number(item.jumlahAktif||0)>0&&item.status==="aktif"?"status-chip done":"status-chip pending"; badge.textContent=item.tipe==="batch"?wholeNumber.format(item.jumlahAktif||0):(item.status||"aktif"); head.append(info,badge); card.append(head); if((item.status==="aktif"||Number(item.jumlahAktif||0)>0)){ const actions=document.createElement("div"); actions.className="item-actions"; actions.append(button("Edit","ghost",()=>openTernakEdit(item)),button("Jual","success-soft",()=>openTernakSale(item)),button("Status","ghost",()=>openTernakStatus(item))); card.append(actions); } list.appendChild(card); } }

  function renderRecordCard(row,type){ const card=document.createElement("article"); card.className="item-card"; const head=document.createElement("div"); head.className="item-top"; const info=document.createElement("div"); const title=document.createElement("strong"); title.textContent=type==="feed"?(row.namaPakan||"Pakan"):(row.kategori||"Kesehatan"); const meta=document.createElement("div"); meta.className="item-meta"; const target=row.targetNama||row.kode?` · ${row.targetNama||`ID ${row.kode}`}`:""; meta.textContent=`${row.tanggal||"—"}${target}${type==="feed"&&row.jumlah?` · ${number.format(row.jumlah)} ${row.satuan||""}`:""}`; info.append(title,meta); const cost=document.createElement("span"); cost.className="amount out"; cost.textContent=rupiah.format(row.biaya||0); head.append(info,cost); card.append(head); if(type==="health"&&row.keterangan){ const note=document.createElement("p"); note.className="muted small record-note"; note.textContent=row.keterangan; card.append(note); } return card; }
  function renderTernakActivities(){ const feed=$("ternak-feed-list"),health=$("ternak-health-list"); feed.replaceChildren(); health.replaceChildren(); const fr=ternakDetail?.feed||[],hr=ternakDetail?.health||[]; if(!fr.length)feed.appendChild(emptyBox("Belum ada catatan pakan.")); else fr.forEach(x=>feed.appendChild(renderRecordCard(x,"feed"))); if(!hr.length)health.appendChild(emptyBox("Belum ada catatan kesehatan.")); else hr.forEach(x=>health.appendChild(renderRecordCard(x,"health"))); }
  function renderTernakFinance(){ const metrics=$("ternak-finance-metrics"),list=$("ternak-finance-list"); metrics.replaceChildren(); list.replaceChildren(); const f=ternakDetail?.finance||{}; for(const [label,value,kind] of [["Pemasukan",f.totalMasuk,"in"],["Pengeluaran",f.totalKeluar,"out"],["Selisih",f.selisih,(f.selisih||0)>=0?"in":"out"],["Bulan ini",f.selisihBulan,(f.selisihBulan||0)>=0?"in":"out"]]){ const card=document.createElement("article"); card.className="metric-card"; const l=document.createElement("span");l.textContent=label;const b=document.createElement("b");b.className=`amount ${kind}`;b.textContent=rupiah.format(value||0);card.append(l,b);metrics.appendChild(card); } const rows=ternakDetail?.financeRows||[]; if(!rows.length){list.appendChild(emptyBox("Belum ada transaksi keuangan."));return;} for(const row of rows){ const card=document.createElement("article");card.className="item-card";const head=document.createElement("div");head.className="item-top";const info=document.createElement("div");const t=document.createElement("strong");t.textContent=row.kategori||"Keuangan";const m=document.createElement("div");m.className="item-meta";m.textContent=`${row.tanggal||"—"} · ${row.keterangan||""}`;info.append(t,m);const a=document.createElement("span");a.className=`amount ${row.arah==="masuk"?"in":"out"}`;a.textContent=`${row.arah==="masuk"?"+":"−"}${rupiah.format(row.nominal||0)}`;head.append(info,a);card.append(head);list.appendChild(card); } }
  function renderTernakReproduction(){ const summary=$("ternak-repro-summary"),list=$("ternak-repro-list"); summary.replaceChildren(); list.replaceChildren(); const r=ternakDetail?.reproduction||{}; const st=r.stats||{}; if(r.mode==="individu"){ for(const [label,value] of [["Dikawinkan",st.dikawinkan||0],["Bunting",st.bunting||0],["Menyusui",st.menyusui||0],["Kosong",st.kosong||0],["Lahir tahun ini",st.lahirTahunIni||0]]){const c=document.createElement("article");c.className="metric-card";c.innerHTML=`<span>${label}</span><b>${wholeNumber.format(value)}</b>`;summary.appendChild(c);} } else if(st){ const entries=st.type==="ayam"?[["Indukan",st.indukanAktif],["Anak/DOC",st.anakAktif],["Menetas",st.menetas],["Kejadian",st.events]]:[["Indukan",st.indukanAktif],["Benih aktif",st.benihAktif],["Benih lahir",st.benih],["Kejadian",st.events]]; for(const [label,value] of entries){const c=document.createElement("article");c.className="metric-card";c.innerHTML=`<span>${label}</span><b>${wholeNumber.format(value||0)}</b>`;summary.appendChild(c);} } else summary.appendChild(emptyBox("Reproduksi batch belum tersedia untuk jenis ini.")); const rows=r.recent||[]; if(!rows.length){list.appendChild(emptyBox("Belum ada riwayat reproduksi."));return;} for(const row of rows){ const card=document.createElement("article");card.className="item-card";const title=document.createElement("strong");title.textContent=row.aksi?String(row.aksi).replace(/_/g," "):row.jenis||"Reproduksi";const meta=document.createElement("div");meta.className="item-meta";meta.textContent=`${row.tanggal||"—"} · ID ${row.sumberBatchKode||row.indukKode||row.kode||"—"}`;card.append(title,meta);list.appendChild(card);} }

  function fillSelectOptions(select, rows, labeler=x=>x){ select.replaceChildren(); rows.forEach((row,index)=>{const o=document.createElement("option");o.value=typeof row==="string"?row:(row.value??row.id??row.kode??index);o.textContent=labeler(row,index);select.appendChild(o);}); }
  function openTernakKind(){ $("ternak-kind-form").reset(); setStatus($("ternak-kind-status")); $("ternak-kind-dialog").showModal(); }
  function syncTernakEditFunctions(){ if(!ternakDetail)return; const sex=$("ternak-edit-sex").value; fillSelectOptions($("ternak-edit-function"),sex==="jantan"?ternakDetail.options.maleFunctions:ternakDetail.options.femaleFunctions); }
  function openTernakEdit(item){ if(!ternakDetail)return; $("ternak-edit-form").reset(); $("ternak-edit-code").value=item.kode; $("ternak-edit-title").textContent=`Edit ${itemLabel(item)}`; const individual=item.tipe==="individu"; $("ternak-edit-individual").hidden=!individual; $("ternak-edit-batch").hidden=individual; if(individual){ $("ternak-edit-name").value=item.nama||""; $("ternak-edit-sex").value=String(item.kelamin||"betina").toLowerCase(); syncTernakEditFunctions(); $("ternak-edit-function").value=item.fungsi||$("ternak-edit-function").value; } else { $("ternak-edit-batch-name").value=item.nama||""; fillSelectOptions($("ternak-edit-batch-function"),ternakDetail.options.batchFunctions||[]); $("ternak-edit-batch-function").value=item.fungsi||$("ternak-edit-batch-function").value; } $("ternak-edit-origin").value=item.asal==="Menetas/Lahir"?"Lahir":(item.asal||"Beli"); $("ternak-edit-date").value=String(item.tanggalMasuk||"").match(/^\d{4}-\d{2}-\d{2}$/)?item.tanggalMasuk:todayJakarta(); $("ternak-edit-cost").value=String(individual?(item.hargaBeli||0):(item.modalAwal||0)); setStatus($("ternak-edit-status")); $("ternak-edit-dialog").showModal(); }

  function openTernakCreate(){ $("ternak-create-form").reset(); fillSelectOptions($("ternak-create-kind"),ternakJenis,row=>`${row.label} · ${row.mode==="individu"?"per ekor":"batch"}`); setStatus($("ternak-create-status")); $("ternak-create-dialog").showModal(); }
  function syncTernakItemFunctions(){ if(!ternakDetail)return; const sex=$("ternak-item-sex").value; const rows=sex==="jantan"?ternakDetail.options.maleFunctions:ternakDetail.options.femaleFunctions; fillSelectOptions($("ternak-item-function"),rows); }
  function openTernakItem(){ if(!ternakDetail)return; $("ternak-item-form").reset(); const individual=ternakDetail.mode==="individu"; $("ternak-item-individual").hidden=!individual; $("ternak-item-batch").hidden=individual; $("ternak-item-title").textContent=individual?"Tambah ternak":"Tambah batch"; $("ternak-item-date").value=todayJakarta(); if(individual)syncTernakItemFunctions(); else fillSelectOptions($("ternak-batch-function"),ternakDetail.options.batchFunctions||[]); setStatus($("ternak-item-status")); $("ternak-item-dialog").showModal(); }
  function activityTargetOptions(){ return [{kode:"0",nama:"Seluruh ternak"},...(ternakDetail?.items||[]).filter(x=>x.status==="aktif"&&Number(x.jumlahAktif||0)>0)]; }
  function openTernakActivity(type){ $("ternak-activity-form").reset(); $("ternak-activity-type").value=type; const feed=type==="feed"; $("ternak-feed-fields").hidden=!feed; $("ternak-health-fields").hidden=feed; $("ternak-activity-eyebrow").textContent=feed?"Pakan":"Kesehatan"; $("ternak-activity-title").textContent=feed?"Catat pakan":"Catat kesehatan"; fillSelectOptions($("ternak-activity-target"),activityTargetOptions(),row=>row.kode==="0"?row.nama:`ID ${row.kode}${row.nama?` · ${row.nama}`:""}`); if(!feed)fillSelectOptions($("ternak-health-category"),ternakDetail.options.healthCategories||[]); $("ternak-activity-date").value=todayJakarta(); setStatus($("ternak-activity-status")); $("ternak-activity-dialog").showModal(); }
  function syncTernakFinanceCategories(){ const direction=$("ternak-finance-direction").value; const rows=direction==="masuk"?ternakDetail.options.financeIncome:ternakDetail.options.financeExpense; fillSelectOptions($("ternak-finance-category"),rows); $("ternak-finance-custom-wrap").hidden=$("ternak-finance-category").value!=="Lainnya"; }
  function openTernakFinance(){ $("ternak-finance-form").reset(); $("ternak-finance-date").value=todayJakarta(); syncTernakFinanceCategories(); setStatus($("ternak-finance-status")); $("ternak-finance-dialog").showModal(); }
  function openTernakSale(item){ $("ternak-sale-form").reset(); $("ternak-sale-code").value=item.kode; $("ternak-sale-title").textContent=`Jual ${itemLabel(item)}`; $("ternak-sale-count-wrap").hidden=item.tipe!=="batch"; $("ternak-sale-count").max=String(item.jumlahAktif||1); $("ternak-sale-count").value="1"; $("ternak-sale-date").value=todayJakarta(); setStatus($("ternak-sale-status")); $("ternak-sale-dialog").showModal(); }
  function openTernakStatus(item){ $("ternak-status-form").reset(); $("ternak-status-code").value=item.kode; $("ternak-status-title").textContent=`Status ${itemLabel(item)}`; $("ternak-status-count-wrap").hidden=item.tipe!=="batch"; $("ternak-status-count").max=String(item.jumlahAktif||1); $("ternak-status-count").value="1"; setStatus($("ternak-status-status")); $("ternak-status-dialog").showModal(); }
  function openTernakReproduction(){ if(!ternakDetail)return; $("ternak-repro-form").reset(); $("ternak-repro-date").value=todayJakarta(); const individual=ternakDetail.mode==="individu"; let actions; if(individual)actions=[{value:"kawin",label:"Perkawinan"},{value:"bunting",label:"Konfirmasi bunting"},{value:"lahir",label:"Kelahiran"},{value:"sapih",label:"Penyapihan"}]; else if(ternakDetail.jenis==="ayam")actions=[{value:"tetas",label:"Penetasan"}]; else if(["lele","nila"].includes(ternakDetail.jenis))actions=[{value:"pijah",label:"Pemijahan"}]; else actions=[]; if(!actions.length){showError(new Error("Jenis ternak ini belum memiliki alur reproduksi khusus."));return;} fillSelectOptions($("ternak-repro-action"),actions,row=>row.label); syncTernakReproFields(); setStatus($("ternak-repro-status")); $("ternak-repro-dialog").showModal(); }
  function syncTernakReproFields(){ const action=$("ternak-repro-action").value; const items=ternakDetail?.items||[]; let targets=[]; if(["kawin","bunting","lahir"].includes(action))targets=items.filter(x=>x.tipe==="individu"&&x.status==="aktif"&&String(x.kelamin||"").toLowerCase()==="betina"&&x.fungsi==="Induk"); else if(action==="sapih")targets=items.filter(x=>x.tipe==="individu"&&x.status==="aktif"&&x.fungsi==="Anak"&&!x.disapih); else targets=items.filter(x=>x.tipe==="batch"&&x.status==="aktif"&&Number(x.jumlahAktif||0)>0&&String(x.fungsi||"").toLowerCase()==="indukan"); fillSelectOptions($("ternak-repro-target"),targets,row=>itemLabel(row)); const male=action==="kawin"; $("ternak-repro-male-wrap").hidden=!male; if(male)fillSelectOptions($("ternak-repro-male"),items.filter(x=>x.tipe==="individu"&&x.status==="aktif"&&String(x.kelamin||"").toLowerCase()==="jantan"&&x.fungsi==="Pejantan"),row=>itemLabel(row)); $("ternak-repro-birth-wrap").hidden=action!=="lahir"; $("ternak-repro-hatch-wrap").hidden=action!=="tetas"; $("ternak-repro-spawn-wrap").hidden=action!=="pijah"; $("ternak-repro-name-wrap").hidden=!["tetas","pijah"].includes(action); }
  function openTernakManager(){ $("ternak-manager-form").reset(); setStatus($("ternak-manager-status")); $("ternak-manager-dialog").showModal(); }
  async function removeTernakManager(person){ if(!confirm(`Hapus ${person.name} dari Admin ${ternakDetail?.nama}?`))return; await api(`/api/ternak/${encodeURIComponent(activeTernak)}/admin/${encodeURIComponent(person.ref)}`,{method:"DELETE",body:"{}"}); await loadTernak(activeTernak); }

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
    $("gallery-public-link").innerHTML = `${galleryDetail.visibility === "private" ? "Buka Galeri privat" : "Buka Galeri publik"} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>`;
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
    const rows = [{ ...data.owner, roleLabel:"Owner Galeri", owner:true }, ...(data.admins || []).map(row => ({ ...row, roleLabel:"Admin Galeri", owner:false }))];
    for (const person of rows) {
      const row = document.createElement("article"); row.className = "manager-card";
      const avatar = document.createElement("div"); avatar.className = "manager-avatar"; avatar.textContent = String(person.name || "P").trim().slice(0,1).toUpperCase();
      const meta = document.createElement("div"); meta.className = "manager-meta";
      const name = document.createElement("strong"); name.textContent = person.name || person.label || "Pengguna PROxyz";
      const detail = document.createElement("span"); detail.textContent = `${person.roleLabel}${person.phone ? ` · +${person.phone}` : ""}`;
      meta.append(name,detail); row.append(avatar,meta);
      if (data.role === "owner") {
        const actions = document.createElement("div"); actions.className = "manager-actions";
        actions.append(button("Nama", "ghost compact", () => openGalleryManagerName(person)));
        if (!person.owner) actions.append(button("Hapus", "danger-soft compact", () => removeGalleryAdmin(person)));
        row.append(actions);
      }
      list.appendChild(row);
    }
    if (!(data.admins || []).length) { const note = document.createElement("div"); note.className = "empty"; note.textContent = "Belum ada Admin Galeri tambahan."; list.appendChild(note); }
  }

  function openGalleryAdminDialog() {
    $("gallery-admin-form").reset();
    setStatus($("gallery-admin-status"));
    $("gallery-admin-dialog").showModal();
    setTimeout(() => $("gallery-admin-phone").focus(), 80);
  }

  function openGalleryManagerName(person) {
    $("gallery-manager-name-ref").value = person.ref || "";
    $("gallery-manager-name-input").value = person.name && !String(person.name).startsWith("+") ? person.name : "";
    setStatus($("gallery-manager-name-status"));
    $("gallery-manager-name-dialog").showModal();
    setTimeout(() => $("gallery-manager-name-input").focus(), 80);
  }

  async function removeGalleryAdmin(admin) {
    if (!confirm(`Hapus ${admin.name || admin.label || admin.phone} dari Admin Galeri?`)) return;
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
        mark.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i>';
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
  hydrateAdminIcons();
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
  // Kompetisi events
  $("competition-select").addEventListener("change",()=>loadCompetition($("competition-select").value).catch(showError));
  $("competition-refresh").addEventListener("click",()=>loadCompetition(activeCompetition).catch(showError));
  $("competition-create").addEventListener("click",openCompetitionCreate);
  $("close-competition-create").addEventListener("click",()=>$("competition-create-dialog").close());
  $("competition-create-format").addEventListener("change",syncCompetitionCreateOptions);
  $("competition-create-sport").addEventListener("change",syncCompetitionCreateOptions);
  $("competition-create-form").addEventListener("submit",async event=>{event.preventDefault();setStatus($("competition-create-status"),"Membuat kompetisi…");try{const body={nama:$("competition-create-name").value,sport:$("competition-create-sport").value,cabangNama:$("competition-create-custom-sport").value.trim(),participantType:$("competition-create-participant-type").value,format:$("competition-create-format").value,groupCount:Number($("competition-create-groups").value||4),advancePerGroup:Number($("competition-create-advance").value||2),customAdvanceCount:Number($("competition-create-custom-advance").value||4),thirdPlace:true};const data=await api("/api/kompetisi",{method:"POST",body:JSON.stringify(body)});$("competition-create-dialog").close();await refreshCompetitionProfile();await loadCompetitionIndex();if(data.kompetisi?.id){activeCompetition=data.kompetisi.id;await loadCompetition(activeCompetition);}}catch(error){setStatus($("competition-create-status"),error.message,"error");}});
  $("competition-participant-form").addEventListener("submit",async event=>{event.preventDefault();const text=$("competition-participant-input").value.trim();if(!text)return;setStatus($("competition-participant-status"),"Menambahkan…");try{await api(`/api/kompetisi/${encodeURIComponent(activeCompetition)}/participants`,{method:"POST",body:JSON.stringify({text})});$("competition-participant-input").value="";await loadCompetition(activeCompetition);setStatus($("competition-participant-status"),"Peserta ditambahkan.","success");}catch(error){setStatus($("competition-participant-status"),error.message,"error");}});
  $("competition-generate").addEventListener("click",async()=>{if((competitionDetail?.matches||[]).length&&!confirm("Generate ulang hanya dapat dilakukan bila belum ada skor pertandingan. Lanjutkan?"))return;await competitionAction("generate");});
  document.querySelectorAll("[data-competition-tab]").forEach(el=>el.addEventListener("click",()=>switchCompetitionTab(el.dataset.competitionTab)));
  $("competition-settings-form").addEventListener("submit",async event=>{event.preventDefault();setStatus($("competition-settings-status"),"Menyimpan…");try{await api(`/api/kompetisi/${encodeURIComponent(activeCompetition)}`,{method:"PATCH",body:JSON.stringify({nama:$("competition-setting-name").value.trim(),cabangNama:$("competition-setting-sport-name").value.trim(),format:$("competition-setting-format").value,groupCount:Number($("competition-setting-groups").value||2),advancePerGroup:Number($("competition-setting-advance").value||2),customAdvanceCount:Number($("competition-setting-custom-advance").value||4),legs:Number($("competition-setting-legs").value||1),scoringMode:$("competition-setting-scoring").value,bestOf:Number($("competition-setting-bestof").value||1),allowDraw:$("competition-setting-draw").checked,thirdPlace:$("competition-setting-third").checked})});await refreshCompetitionProfile();await loadCompetition(activeCompetition);setStatus($("competition-settings-status"),"Pengaturan disimpan.","success");}catch(error){setStatus($("competition-settings-status"),error.message,"error");}});
  $("competition-reset").addEventListener("click",async()=>{if(!confirm("Reset semua jadwal, skor, fase, dan pembagian grup? Peserta tetap disimpan."))return;try{await api(`/api/kompetisi/${encodeURIComponent(activeCompetition)}/reset-schedule`,{method:"POST",body:"{}"});await loadCompetition(activeCompetition);}catch(error){showError(error);}});
  $("competition-manager-add").addEventListener("click",()=>{setStatus($("competition-manager-status"));$("competition-manager-phone").value="";$("competition-manager-name").value="";$("competition-manager-dialog").showModal();});
  $("close-competition-manager").addEventListener("click",()=>$("competition-manager-dialog").close());
  $("competition-manager-form").addEventListener("submit",async event=>{event.preventDefault();setStatus($("competition-manager-status"),"Menambahkan…");try{await api(`/api/kompetisi/${encodeURIComponent(activeCompetition)}/admin`,{method:"POST",body:JSON.stringify({phone:$("competition-manager-phone").value,name:$("competition-manager-name").value})});$("competition-manager-dialog").close();await loadCompetition(activeCompetition);}catch(error){setStatus($("competition-manager-status"),error.message,"error");}});

  document.querySelectorAll(".app-tab").forEach(el => el.addEventListener("click", () => switchView(el.dataset.view)));
  $("app-tabs-toggle").addEventListener("click", () => {
    const dock = $("app-tabs");
    const expanded = !dock.classList.contains("is-expanded");
    dock.classList.toggle("is-expanded", expanded);
    $("app-tabs-toggle").setAttribute("aria-expanded", String(expanded));
  });
  window.addEventListener("scroll", syncAppDockFloating, { passive: true });
  window.addEventListener("resize", syncAppDockFloating, { passive: true });
  $("admin-settings-open").addEventListener("click", openAdminSettings);
  $("admin-settings-close").addEventListener("click", () => $("admin-settings-dialog").close());
  $("admin-settings-edit-name").addEventListener("click", () => { $("admin-settings-dialog").close(); openUserNameDialog(null, true); });
  $("admin-settings-reset-order").addEventListener("click", () => { adminSettingsDraftOrder = ADMIN_APP_KEYS.filter(key => appAvailability()[key]); renderAdminSettingsAppOrder(); });
  $("admin-settings-app-list").addEventListener("click", event => {
    const button = event.target.closest("[data-move]");
    const row = event.target.closest("[data-app-key]");
    if (!button || !row) return;
    const index = adminSettingsDraftOrder.indexOf(row.dataset.appKey);
    if (index < 0) return;
    const nextIndex = button.dataset.move === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= adminSettingsDraftOrder.length) return;
    [adminSettingsDraftOrder[index], adminSettingsDraftOrder[nextIndex]] = [adminSettingsDraftOrder[nextIndex], adminSettingsDraftOrder[index]];
    renderAdminSettingsAppOrder();
  });
  $("admin-settings-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!adminSettingsDraftOrder.length) return;
    setStatus($("admin-settings-status"), "Menyimpan pengaturan…");
    try {
      const data = await api("/api/me/preferences", { method:"PATCH", body:JSON.stringify({ appOrder:adminSettingsDraftOrder, defaultApp:adminSettingsDraftOrder[0] }) });
      me.adminWebPreferences = data.preferences;
      applyAdminAppOrder(normalizedAdminAppOrder());
      syncProxyzAppSwitcherLabel();
      setStatus($("admin-settings-status"), "Pengaturan disimpan.", "success");
      setTimeout(() => { if ($("admin-settings-dialog").open) $("admin-settings-dialog").close(); }, 350);
    } catch (error) { setStatus($("admin-settings-status"), error.message, "error"); }
  });
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


  function keepRismaInputVisible(dialogId) {
    const dialog=$(dialogId);
    if(!dialog)return;
    dialog.addEventListener("focusin",event=>{
      const target=event.target;
      if(!target?.matches?.("input,select,textarea"))return;
      setTimeout(()=>{
        try{ target.scrollIntoView({block:"center",behavior:"smooth"}); }catch(_){ }
      },180);
    });
  }
  keepRismaInputVisible("risma-week-dialog");
  keepRismaInputVisible("risma-coupon-add-dialog");
  keepRismaInputVisible("risma-participant-dialog");

  // RISMA events
  document.querySelectorAll("[data-risma-tab]").forEach(el => el.addEventListener("click", () => switchRismaTab(el.dataset.rismaTab)));
  $("risma-refresh").addEventListener("click", () => loadRisma().catch(showError));
  $("risma-period-new").addEventListener("click", () => { $("risma-period-form").reset(); setStatus($("risma-period-status")); $("risma-period-dialog").showModal(); });
  $("risma-period-close").addEventListener("click", async () => { if(!rismaDetail?.activePeriod || !confirm(`Tutup periode Ramadan ${rismaDetail.activePeriod.hijriYear} H? Data tetap tersimpan.`))return; try{ await api(`/api/risma/period/${encodeURIComponent(rismaDetail.activePeriod.id)}/close`,{method:"POST",body:"{}"}); await loadRisma(); }catch(error){showError(error);} });
  $("close-risma-period").addEventListener("click",()=>$("risma-period-dialog").close());
  $("risma-period-form").addEventListener("submit",async event=>{event.preventDefault();setStatus($("risma-period-status"),"Membuat periode…");try{await api("/api/risma/period",{method:"POST",body:JSON.stringify({hijriYear:$("risma-period-year").value})});$("risma-period-dialog").close();await loadRisma();}catch(error){setStatus($("risma-period-status"),error.message,"error");}});

  $("close-risma-week").addEventListener("click",()=>$("risma-week-dialog").close());
  $("risma-week-publish-skip").addEventListener("click",()=>{rismaPendingPublishWeek=0;$("risma-week-publish-dialog").close();});
  $("risma-week-publish-send").addEventListener("click",sendRismaWeekUpdateToGroup);
  $("risma-week-new-toggle").addEventListener("click",()=>{rismaWeekNewParticipantMode=!rismaWeekNewParticipantMode;rismaWeekEditIndex=-1;$("risma-week-person-name").value="";syncRismaWeekBuilder();});
  $("risma-week-person-select").addEventListener("change",()=>{$("risma-week-excused").value="0";syncRismaWeekBuilder();});
  $("risma-week-gender").addEventListener("change",syncRismaWeekBuilder);
  $("risma-week-add-entry").addEventListener("click",addRismaWeekDraft);
  $("risma-week-form").addEventListener("submit",async event=>{
    event.preventDefault();
    const week=$("risma-week-number").value;
    if(!rismaWeekDraft.length){setStatus($("risma-week-status"),"Tambahkan minimal satu peserta sebelum menyimpan.","error");return;}
    setStatus($("risma-week-status"),"Menyimpan poin…");
    try{
      const data=await api(`/api/risma/week/${week}`,{method:"PUT",body:JSON.stringify({entries:rismaWeekPayloadEntries()})});
      const auto=data.autoPublication;
      $("risma-week-dialog").close();
      await loadRisma();
      if(auto?.attempted){
        const message=auto.sent>0
          ? `Minggu ${week} tersimpan. Update otomatis terkirim ke ${auto.sent} grup${auto.failed?`, ${auto.failed} gagal`:""}.`
          : `Minggu ${week} tersimpan, tetapi update otomatis belum terkirim${auto.message?`: ${auto.message}`:"."}`;
        setStatus($("risma-publish-status"),message,auto.sent>0?"success":"error");
        setStatus($("risma-auto-status"),message,auto.sent>0?"success":"error");
      }
      if(data.publicationPrompt) openRismaWeekPublishPrompt(week);
    }catch(error){setStatus($("risma-week-status"),error.message,"error");}
  });

  $("close-risma-participant").addEventListener("click",()=>$("risma-participant-dialog").close());
  $("risma-participant-disqualified").addEventListener("change",()=>{$("risma-participant-dq-reason-wrap").hidden=!$("risma-participant-disqualified").checked;});
  $("risma-participant-form").addEventListener("submit",async event=>{
    event.preventDefault();setStatus($("risma-participant-status"),"Menyimpan…");
    try{
      await api(`/api/risma/participant/${encodeURIComponent($("risma-participant-id").value)}`,{method:"PATCH",body:JSON.stringify({
        name:$("risma-participant-name").value,
        gender:$("risma-participant-gender").value,
        disqualified:rismaDetail?.role==="owner"?$("risma-participant-disqualified").checked:undefined,
        disqualifiedReason:$("risma-participant-dq-reason").value
      })});
      $("risma-participant-dialog").close();await loadRisma();
    }catch(error){setStatus($("risma-participant-status"),error.message,"error");}
  });

  $("risma-coupon-type").addEventListener("change",()=>{rismaCouponType=$("risma-coupon-type").value;renderRismaCoupons();});
  $("risma-coupon-add").addEventListener("click",()=>{$("risma-coupon-add-form").reset();fillRismaCouponCountSelect($("risma-coupon-add-count"),1);setStatus($("risma-coupon-add-status"));$("risma-coupon-add-dialog").showModal();});
  $("close-risma-coupon-add").addEventListener("click",()=>$("risma-coupon-add-dialog").close());
  $("risma-coupon-add-form").addEventListener("submit",async event=>{
    event.preventDefault();
    let allowSimilar=false;
    while(true){
      setStatus($("risma-coupon-add-status"),"Memeriksa penerima…");
      try{
        const name=String($("risma-coupon-add-name").value||"").trim();
        const count=Number($("risma-coupon-add-count").value||1);
        const data=await api(`/api/risma/coupon/${encodeURIComponent(rismaCouponType)}`,{method:"POST",body:JSON.stringify({text:`${name} ${count}`,allowSimilar})});
        if(data.needsConfirmation&&!allowSimilar){const names=(data.similar||[]).map(x=>x.input?.name).filter(Boolean).join(", ");if(!confirm(`Ada nama yang mirip${names?`: ${names}`:""}. Tetap tambahkan?`))return;allowSimilar=true;continue;}
        $("risma-coupon-add-dialog").close();await loadRisma();break;
      }catch(error){setStatus($("risma-coupon-add-status"),error.message,"error");break;}
    }
  });
  $("close-risma-coupon-edit").addEventListener("click",()=>$("risma-coupon-edit-dialog").close());
  $("risma-coupon-edit-form").addEventListener("submit",async event=>{event.preventDefault();const no=$("risma-coupon-edit-no").value;setStatus($("risma-coupon-edit-status"),"Menyimpan…");try{await api(`/api/risma/coupon/${encodeURIComponent(rismaCouponType)}/${no}`,{method:"PATCH",body:JSON.stringify({name:$("risma-coupon-edit-name").value,count:Number($("risma-coupon-edit-count").value),allowSimilar:true})});$("risma-coupon-edit-dialog").close();await loadRisma();}catch(error){setStatus($("risma-coupon-edit-status"),error.message,"error");}});

  $("risma-publish-rank-preview").addEventListener("click",()=>previewRismaPublication("rank","risma-publish-status"));
  $("risma-publish-rank").addEventListener("click",publishRismaRank);
  $("risma-publish-rank-pdf").addEventListener("click",()=>sendRismaPublicationPdf("rank","risma-publish-status"));
  $("risma-publish-rules-preview").addEventListener("click",()=>previewRismaPublication("rules","risma-publish-rules-status"));
  $("risma-publish-rules-send").addEventListener("click",()=>sendRismaPublication("rules","risma-publish-rules-status","Kirim Pengumuman Program Ramadan ke semua grup yang terinstal RISMA?"));
  $("risma-publish-rules-pdf").addEventListener("click",()=>sendRismaPublicationPdf("rules","risma-publish-rules-status"));
  $("risma-publish-announce-preview").addEventListener("click",()=>previewRismaPublication("announcement","risma-publish-announce-status"));
  $("risma-publish-announce-send").addEventListener("click",()=>sendRismaPublication("announcement","risma-publish-announce-status","Kirim pengumuman ini ke semua grup yang terinstal RISMA?"));
  $("risma-publish-announce-pdf").addEventListener("click",()=>sendRismaPublicationPdf("announcement","risma-publish-announce-status"));
  $("risma-publish-invite-preview").addEventListener("click",()=>previewRismaPublication("invitation","risma-publish-invite-status"));
  $("risma-publish-invite-send").addEventListener("click",()=>sendRismaPublication("invitation","risma-publish-invite-status","Kirim undangan ini ke semua grup yang terinstal RISMA?"));
  $("risma-publish-invite-pdf").addEventListener("click",()=>sendRismaPublicationPdf("invitation","risma-publish-invite-status"));
  $("risma-publication-copy").addEventListener("click",async()=>{const text=$("risma-publication-preview-text").value.trim(); if(!text){setStatus($("risma-publication-preview-status"),"Belum ada teks untuk disalin.","error"); return;} try{await navigator.clipboard.writeText(text); setStatus($("risma-publication-preview-status"),"Teks publikasi berhasil disalin.","success");}catch(error){setStatus($("risma-publication-preview-status"),"Gagal menyalin teks.","error");}});
  $("risma-publication-clear").addEventListener("click",()=>{showRismaPublicationPreview("Pratinjau publikasi","",""); $("risma-publication-preview-box").hidden=true; setStatus($("risma-publication-preview-status"));});
  $("risma-owner-period-create").addEventListener("click",rismaOwnerCreatePeriod);
  $("risma-owner-period-close").addEventListener("click",rismaOwnerClosePeriod);
  $("risma-simulation-start").addEventListener("click",()=>rismaSimulationAction("start"));
  $("risma-simulation-seed").addEventListener("click",()=>rismaSimulationAction("seed"));
  $("risma-simulation-reset").addEventListener("click",()=>rismaSimulationAction("reset"));
  $("risma-simulation-end").addEventListener("click",()=>rismaSimulationAction("end"));
  $("risma-print-coupon-type").addEventListener("change",updateRismaCouponPrintSummary);
  $("risma-print-coupon-layout").addEventListener("change",updateRismaCouponPrintSummary);
  $("risma-print-coupon-sheets").addEventListener("input",updateRismaCouponPrintSummary);
  $("risma-print-coupon-pdf").addEventListener("click",printRismaCouponsPdf);
  $("risma-archive-refresh").addEventListener("click",()=>loadRismaArchives().catch(error=>setStatus($("risma-archive-status"),error.message,"error")));
  $("risma-signature-save").addEventListener("click",saveRismaSignatures);
  $("close-risma-period-summary").addEventListener("click",()=>$("risma-period-summary-dialog").close());
  $("risma-log-source-filter").addEventListener("change",()=>{rismaLogSourceFilter=$("risma-log-source-filter").value;renderRismaLogs();});
  $("risma-log-refresh").addEventListener("click",()=>loadRismaLogs().catch(error=>setStatus($("risma-log-status"),error.message,"error")));
  $("risma-team-rebuild").addEventListener("click",async()=>{if(!confirm("Acak ulang tim berdasarkan poin terbaru? Setelah Minggu 2 diinput fitur ini akan terkunci."))return;setStatus($("risma-team-rebuild-status"),"Menyusun ulang tim…");try{const data=await api("/api/risma/teams/rebuild",{method:"POST",body:"{}"});rismaDetail=data.risma;renderRisma();setStatus($("risma-team-rebuild-status"),"Tim berhasil diacak ulang.","success");}catch(error){setStatus($("risma-team-rebuild-status"),error.message,"error");}});
  $("risma-settings-form").addEventListener("submit",saveRismaSettings);
  $("risma-template-type").addEventListener("change",syncRismaTemplateForm);
  $("risma-template-form").addEventListener("submit",saveRismaTemplate);
  $("risma-template-reset").addEventListener("click",resetRismaTemplate);
  $("risma-manager-add").addEventListener("click",openRismaManager);
  $("close-risma-manager").addEventListener("click",()=>$("risma-manager-dialog").close());
  $("risma-manager-form").addEventListener("submit",async event=>{event.preventDefault();setStatus($("risma-manager-status"),"Menambahkan Admin…");try{await api("/api/risma/admin",{method:"POST",body:JSON.stringify({phone:$("risma-manager-phone").value,name:$("risma-manager-name").value})});$("risma-manager-dialog").close();await loadRisma();}catch(error){setStatus($("risma-manager-status"),error.message,"error");}});


  // Ternak events
  document.querySelectorAll("[data-ternak-tab]").forEach(el=>el.addEventListener("click",()=>switchTernakTab(el.dataset.ternakTab)));
  $("ternak-select").addEventListener("change",()=>loadTernak($("ternak-select").value).catch(showError));
  $("ternak-refresh").addEventListener("click",()=>loadTernak(activeTernak).catch(showError));
  $("ternak-search").addEventListener("input",()=>{ternakSearch=$("ternak-search").value.trim();renderTernakItems();});
  $("ternak-kind-create").addEventListener("click",openTernakKind); $("close-ternak-kind").addEventListener("click",()=>$("ternak-kind-dialog").close());
  $("ternak-kind-form").addEventListener("submit",async event=>{event.preventDefault();setStatus($("ternak-kind-status"),"Menambahkan jenis…");try{const data=await api("/api/ternak/jenis",{method:"POST",body:JSON.stringify({label:$("ternak-kind-name").value,usahaPrefix:$("ternak-kind-prefix").value,mode:$("ternak-kind-mode").value})});ternakJenis=data.daftar||ternakJenis;$("ternak-kind-dialog").close();await loadTernakIndex(false);}catch(error){setStatus($("ternak-kind-status"),error.message,"error");}});
  $("ternak-create").addEventListener("click",openTernakCreate); $("close-ternak-create").addEventListener("click",()=>$("ternak-create-dialog").close());
  $("ternak-create-form").addEventListener("submit",async event=>{event.preventDefault();setStatus($("ternak-create-status"),"Membuat usaha…");try{const data=await api("/api/ternak",{method:"POST",body:JSON.stringify({jenis:$("ternak-create-kind").value,nama:$("ternak-create-name").value})});$("ternak-create-dialog").close();activeTernak=data.ternak.id;const meData=await api("/api/me");me=meData.user;await loadTernakIndex(true);}catch(error){setStatus($("ternak-create-status"),error.message,"error");}});
  $("ternak-add-item").addEventListener("click",openTernakItem); $("close-ternak-item").addEventListener("click",()=>$("ternak-item-dialog").close()); $("ternak-item-sex").addEventListener("change",syncTernakItemFunctions);
  $("ternak-item-form").addEventListener("submit",async event=>{event.preventDefault();const d=ternakDetail;const body=d.mode==="individu"?{nama:$("ternak-item-name").value||"-",kelamin:$("ternak-item-sex").value,fungsi:$("ternak-item-function").value,asal:$("ternak-item-origin").value,tanggalMasuk:$("ternak-item-date").value,hargaBeli:parseNominalText($("ternak-item-cost").value)}:{nama:$("ternak-batch-name").value,fungsi:$("ternak-batch-function").value,jumlahAwal:Number($("ternak-batch-count").value),asal:$("ternak-item-origin").value,tanggalMasuk:$("ternak-item-date").value,modalAwal:parseNominalText($("ternak-item-cost").value)};setStatus($("ternak-item-status"),"Menyimpan populasi…");try{await api(`/api/ternak/${encodeURIComponent(activeTernak)}/item`,{method:"POST",body:JSON.stringify(body)});$("ternak-item-dialog").close();await loadTernak(activeTernak);}catch(error){setStatus($("ternak-item-status"),error.message,"error");}});
  $("close-ternak-edit").addEventListener("click",()=>$("ternak-edit-dialog").close()); $("ternak-edit-sex").addEventListener("change",syncTernakEditFunctions);
  $("ternak-edit-form").addEventListener("submit",async event=>{event.preventDefault();const item=(ternakDetail?.items||[]).find(x=>String(x.kode)===String($("ternak-edit-code").value));if(!item)return;const individual=item.tipe==="individu";const body=individual?{nama:$("ternak-edit-name").value||"-",kelamin:$("ternak-edit-sex").value,fungsi:$("ternak-edit-function").value,asal:$("ternak-edit-origin").value,tanggalMasuk:$("ternak-edit-date").value,hargaBeli:parseNominalText($("ternak-edit-cost").value)}:{nama:$("ternak-edit-batch-name").value,fungsi:$("ternak-edit-batch-function").value,asal:$("ternak-edit-origin").value,tanggalMasuk:$("ternak-edit-date").value,modalAwal:parseNominalText($("ternak-edit-cost").value)};setStatus($("ternak-edit-status"),"Menyimpan perubahan…");try{await api(`/api/ternak/${encodeURIComponent(activeTernak)}/item/${encodeURIComponent(item.kode)}`,{method:"PATCH",body:JSON.stringify(body)});$("ternak-edit-dialog").close();await loadTernak(activeTernak);}catch(error){setStatus($("ternak-edit-status"),error.message,"error");}});
  $("ternak-add-feed").addEventListener("click",()=>openTernakActivity("feed")); $("ternak-add-health").addEventListener("click",()=>openTernakActivity("health")); $("close-ternak-activity").addEventListener("click",()=>$("ternak-activity-dialog").close());
  $("ternak-activity-form").addEventListener("submit",async event=>{event.preventDefault();const type=$("ternak-activity-type").value;const body=type==="feed"?{target:$("ternak-activity-target").value,namaPakan:$("ternak-feed-name").value,quantity:$("ternak-feed-quantity").value||"-",biaya:parseNominalText($("ternak-activity-cost").value),tanggal:$("ternak-activity-date").value}:{target:$("ternak-activity-target").value,kategori:$("ternak-health-category").value,keterangan:$("ternak-health-description").value,biaya:parseNominalText($("ternak-activity-cost").value),tanggal:$("ternak-activity-date").value};setStatus($("ternak-activity-status"),"Menyimpan aktivitas…");try{await api(`/api/ternak/${encodeURIComponent(activeTernak)}/${type==="feed"?"feed":"health"}`,{method:"POST",body:JSON.stringify(body)});$("ternak-activity-dialog").close();await loadTernak(activeTernak);}catch(error){setStatus($("ternak-activity-status"),error.message,"error");}});
  $("ternak-add-finance").addEventListener("click",openTernakFinance); $("close-ternak-finance").addEventListener("click",()=>$("ternak-finance-dialog").close()); $("ternak-finance-direction").addEventListener("change",syncTernakFinanceCategories); $("ternak-finance-category").addEventListener("change",()=>$("ternak-finance-custom-wrap").hidden=$("ternak-finance-category").value!=="Lainnya");
  $("ternak-finance-form").addEventListener("submit",async event=>{event.preventDefault();const body={direction:$("ternak-finance-direction").value,category:$("ternak-finance-category").value,rawCategory:$("ternak-finance-custom").value,description:$("ternak-finance-description").value,amount:parseNominalText($("ternak-finance-amount").value),tanggal:$("ternak-finance-date").value};setStatus($("ternak-finance-status"),"Menyimpan transaksi…");try{await api(`/api/ternak/${encodeURIComponent(activeTernak)}/finance`,{method:"POST",body:JSON.stringify(body)});$("ternak-finance-dialog").close();await loadTernak(activeTernak);}catch(error){setStatus($("ternak-finance-status"),error.message,"error");}});
  $("close-ternak-sale").addEventListener("click",()=>$("ternak-sale-dialog").close()); $("ternak-sale-form").addEventListener("submit",async event=>{event.preventDefault();const code=$("ternak-sale-code").value;setStatus($("ternak-sale-status"),"Menyimpan penjualan…");try{await api(`/api/ternak/${encodeURIComponent(activeTernak)}/item/${encodeURIComponent(code)}/sale`,{method:"POST",body:JSON.stringify({jumlah:Number($("ternak-sale-count").value||1),totalHarga:parseNominalText($("ternak-sale-price").value),tanggal:$("ternak-sale-date").value})});$("ternak-sale-dialog").close();await loadTernak(activeTernak);}catch(error){setStatus($("ternak-sale-status"),error.message,"error");}});
  $("close-ternak-status").addEventListener("click",()=>$("ternak-status-dialog").close()); $("ternak-status-form").addEventListener("submit",async event=>{event.preventDefault();const code=$("ternak-status-code").value;setStatus($("ternak-status-status"),"Menyimpan status…");try{await api(`/api/ternak/${encodeURIComponent(activeTernak)}/item/${encodeURIComponent(code)}/status`,{method:"POST",body:JSON.stringify({status:$("ternak-status-value").value,jumlah:Number($("ternak-status-count").value||1)})});$("ternak-status-dialog").close();await loadTernak(activeTernak);}catch(error){setStatus($("ternak-status-status"),error.message,"error");}});
  $("ternak-repro-add").addEventListener("click",openTernakReproduction); $("close-ternak-repro").addEventListener("click",()=>$("ternak-repro-dialog").close()); $("ternak-repro-action").addEventListener("change",syncTernakReproFields);
  $("ternak-repro-form").addEventListener("submit",async event=>{event.preventDefault();const action=$("ternak-repro-action").value;const body={action,target:$("ternak-repro-target").value,male:$("ternak-repro-male").value,jantan:Number($("ternak-repro-male-count").value||0),betina:Number($("ternak-repro-female-count").value||0),jumlahTelur:$("ternak-repro-eggs").value?Number($("ternak-repro-eggs").value):null,jumlahMenetas:Number($("ternak-repro-hatched").value||0),jumlahBenih:Number($("ternak-repro-seeds").value||0),nama:$("ternak-repro-child-name").value,tanggal:$("ternak-repro-date").value};setStatus($("ternak-repro-status"),"Menyimpan reproduksi…");try{await api(`/api/ternak/${encodeURIComponent(activeTernak)}/reproduction`,{method:"POST",body:JSON.stringify(body)});$("ternak-repro-dialog").close();await loadTernak(activeTernak);}catch(error){setStatus($("ternak-repro-status"),error.message,"error");}});
  $("ternak-manager-add").addEventListener("click",openTernakManager); $("close-ternak-manager").addEventListener("click",()=>$("ternak-manager-dialog").close()); $("ternak-manager-form").addEventListener("submit",async event=>{event.preventDefault();setStatus($("ternak-manager-status"),"Menambahkan Admin…");try{await api(`/api/ternak/${encodeURIComponent(activeTernak)}/admin`,{method:"POST",body:JSON.stringify({phone:$("ternak-manager-phone").value,name:$("ternak-manager-name").value})});$("ternak-manager-dialog").close();await loadTernak(activeTernak);}catch(error){setStatus($("ternak-manager-status"),error.message,"error");}});

  // Gallery manager dialogs
  $("close-gallery-admin").addEventListener("click",()=>$("gallery-admin-dialog").close());
  $("gallery-admin-form").addEventListener("submit",async event=>{event.preventDefault();setStatus($("gallery-admin-status"),"Menambahkan Admin…");try{await api(`/api/galeri/${encodeURIComponent(activeGallery)}/admin`,{method:"POST",body:JSON.stringify({phone:$("gallery-admin-phone").value,name:$("gallery-admin-name").value})});$("gallery-admin-dialog").close();await loadGalleryAdmins();}catch(error){setStatus($("gallery-admin-status"),error.message,"error");}});
  $("close-gallery-manager-name").addEventListener("click",()=>$("gallery-manager-name-dialog").close());
  $("gallery-manager-name-form").addEventListener("submit",async event=>{event.preventDefault();setStatus($("gallery-manager-name-status"),"Menyimpan nama…");try{await api(`/api/galeri/${encodeURIComponent(activeGallery)}/admin/${encodeURIComponent($("gallery-manager-name-ref").value)}/name`,{method:"PATCH",body:JSON.stringify({name:$("gallery-manager-name-input").value})});$("gallery-manager-name-dialog").close();await loadGalleryAdmins();}catch(error){setStatus($("gallery-manager-name-status"),error.message,"error");}});

  // Galeri events
  document.querySelectorAll("[data-gallery-tab]").forEach(el => el.addEventListener("click", () => switchGalleryTab(el.dataset.galleryTab)));
  $("gallery-video-form").addEventListener("submit", submitGalleryVideo);
  $("gallery-video-refresh").addEventListener("click", () => loadGalleryVideoJobs().catch(showError));
  $("gallery-video-close-review").addEventListener("click", closeGalleryVideoReview);
  $("gallery-video-select-all").addEventListener("click", () => { if (!activeGalleryVideoJob) return; galleryVideoSelected = new Set((activeGalleryVideoJob.candidates || []).map(row => row.id)); updateGalleryVideoSelection(); });
  $("gallery-video-clear-all").addEventListener("click", () => { galleryVideoSelected.clear(); updateGalleryVideoSelection(); });
  $("gallery-video-publish").addEventListener("click", publishGalleryVideoSelection);
  $("gallery-select").addEventListener("change", () => loadGallery($("gallery-select").value).catch(showError)); $("refresh-gallery").addEventListener("click", () => loadGallery(activeGallery).catch(showError));
  $("rename-gallery").addEventListener("click", async () => { const next = prompt("Nama Galeri baru:", galleryDetail?.nama || ""); if (next === null || !next.trim()) return; try { await api(`/api/galeri/${encodeURIComponent(activeGallery)}`, { method: "PUT", body: JSON.stringify({ nama: next.trim() }) }); const meData = await api("/api/me"); me = meData.user; fillSelect($("gallery-select"), me.galeri || [], row => `${row.nama} · ${row.role}`);
    fillSelect($("ternak-select"), me.ternak || [], row => `${row.nama} · ${row.jenis || "Ternak"} · ${row.role}`); await loadGallery(activeGallery); } catch (error) { showError(error); } });
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
  $("add-gallery-admin").addEventListener("click", openGalleryAdminDialog);
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

  (async () => {
    const usedWhatsAppLink = await consumeWhatsAppLoginLink();
    if (!usedWhatsAppLink && !restoreWhatsAppLoginLink()) restoreOtpChallenge();
    await bootstrapSession();
  })();
  setTimeout(checkAdminBuild, 1500);
  window.addEventListener("pageshow", event => { if (event.persisted) checkAdminBuild(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkAdminBuild(); });


  /* BEGIN PROxyz NAVBAR JS V092 */
  function syncProxyzAppSwitcherLabel() {
    const label = $("app-active-label");
    if (!label) return;
    const active = document.querySelector("#app-switcher-menu .app-tab.active") || document.querySelector("#app-switcher-menu .app-tab:not([hidden])");
    const text = active?.querySelector(".app-tab-label")?.textContent?.trim() || active?.getAttribute("title") || "Aplikasi";
    label.textContent = text;
  }

  function closeProxyzAppSwitcher() {
    const dock = $("app-tabs");
    const bar = $("app-switcher-bar");
    const toggle = $("app-tabs-toggle");
    if (!dock) return;
    dock.classList.remove("is-expanded");
    bar?.setAttribute("aria-expanded", "false");
    toggle?.setAttribute("aria-expanded", "false");
  }

  function toggleProxyzAppSwitcher() {
    const dock = $("app-tabs");
    const bar = $("app-switcher-bar");
    const toggle = $("app-tabs-toggle");
    if (!dock) return;
    const open = !dock.classList.contains("is-expanded");
    dock.classList.toggle("is-expanded", open);
    bar?.setAttribute("aria-expanded", String(open));
    toggle?.setAttribute("aria-expanded", String(open));
    syncProxyzAppSwitcherLabel();
  }

  const proxyzSwitcherBar = $("app-switcher-bar");
  if (proxyzSwitcherBar) {
    proxyzSwitcherBar.addEventListener("click", event => {
      if (event.target.closest("#app-tabs-toggle")) return;
      toggleProxyzAppSwitcher();
    });
    proxyzSwitcherBar.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleProxyzAppSwitcher();
    });
  }

  document.addEventListener("click", event => {
    const dock = $("app-tabs");
    if (dock?.classList.contains("is-expanded") && !dock.contains(event.target)) closeProxyzAppSwitcher();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeProxyzAppSwitcher();
  });

  const proxyzAppMenu = $("app-switcher-menu");
  if (proxyzAppMenu) {
    proxyzAppMenu.addEventListener("click", event => {
      if (!event.target.closest(".app-tab")) return;
      queueMicrotask(() => {
        syncProxyzAppSwitcherLabel();
        closeProxyzAppSwitcher();
      });
    });
    const observer = new MutationObserver(syncProxyzAppSwitcherLabel);
    observer.observe(proxyzAppMenu, { subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
  }
  syncProxyzAppSwitcherLabel();
  /* END PROxyz NAVBAR JS V092 */

})();
