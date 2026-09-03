(() => {
  "use strict";

  const body = document.body;
  const idKas = String(body.dataset.kasId || "").trim().toLowerCase();
  const visibility = String(body.dataset.kasVisibility || "public").trim().toLowerCase();
  const API = String(window.PROXYZ_ADMIN_CONFIG?.apiBase || "").replace(/\/$/, "");
  const PAGE_SIZE = 30;
  const SESSION_TOKEN_KEY = "proxyz_admin_session_token";
  const OTP_KEY = `proxyz_kas_otp:${idKas}`;

  const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
  const dateLong = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric" });
  const dateTime = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const monthLabel = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", month: "long", year: "numeric" });

  const els = {
    content: document.getElementById("dashboard-content"),
    unlockPanel: document.getElementById("unlock-panel"),
    phoneForm: document.getElementById("kas-phone-form"),
    phone: document.getElementById("kas-phone"),
    sendOtp: document.getElementById("kas-send-otp"),
    otpForm: document.getElementById("kas-otp-form"),
    otp: document.getElementById("kas-otp"),
    verifyOtp: document.getElementById("kas-verify-otp"),
    changePhone: document.getElementById("kas-change-phone"),
    authStatus: document.getElementById("kas-auth-status"),
    title: document.getElementById("kas-title"),
    saldo: document.getElementById("saldo-akhir"),
    totalMasuk: document.getElementById("total-masuk"),
    totalKeluar: document.getElementById("total-keluar"),
    bulanMasuk: document.getElementById("bulan-masuk"),
    bulanKeluar: document.getElementById("bulan-keluar"),
    updated: document.getElementById("updated-at"),
    search: document.getElementById("search"),
    month: document.getElementById("month-filter"),
    type: document.getElementById("type-filter"),
    list: document.getElementById("transaction-list"),
    count: document.getElementById("transaction-count"),
    loadMore: document.getElementById("load-more")
  };

  let all = [];
  let visibleLimit = PAGE_SIZE;
  let challengeId = "";
  let challengeExpiresAt = 0;

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function storedToken() {
    try { return String(localStorage.getItem(SESSION_TOKEN_KEY) || "").trim(); } catch (_) { return ""; }
  }

  function saveToken(token) {
    try {
      if (token) localStorage.setItem(SESSION_TOKEN_KEY, String(token));
      else localStorage.removeItem(SESSION_TOKEN_KEY);
    } catch (_) {}
  }

  function authHeaders(extra = {}) {
    const headers = { ...extra };
    const token = storedToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  function setAuthStatus(message = "", type = "") {
    if (!els.authStatus) return;
    els.authStatus.textContent = message;
    els.authStatus.className = `unlock-error ${type}`.trim();
  }

  async function api(path, options = {}) {
    if (!API) throw new Error("Alamat API PROxyz belum dikonfigurasi.");
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        ...options,
        headers: authHeaders({ "Content-Type": "application/json", ...(options.headers || {}) }),
        credentials: "include",
        cache: "no-store"
      });
    } catch (_) {
      const error = new Error("PROxyz belum dapat dihubungi. Pastikan bot dan tunnel aktif.");
      error.status = 0;
      throw error;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Permintaan gagal (${response.status}).`);
      error.status = response.status;
      if (response.status === 401) saveToken("");
      throw error;
    }
    return data;
  }

  function dateParts(timestamp) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(number(timestamp)));
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return { day: `${map.year}-${map.month}-${map.day}`, month: `${map.year}-${map.month}` };
  }

  function currentJakartaMonth() { return dateParts(Date.now()).month; }
  function formatAmount(tx) { return `${tx.jenis === "keluar" ? "−" : "+"}${rupiah.format(number(tx.nominal))}`; }

  function monthSummary(transactions) {
    const current = currentJakartaMonth();
    let masuk = 0;
    let keluar = 0;
    for (const tx of transactions) {
      if (dateParts(tx.tanggal).month !== current) continue;
      if (tx.jenis === "masuk") masuk += number(tx.nominal);
      if (tx.jenis === "keluar") keluar += number(tx.nominal);
    }
    return { masuk, keluar };
  }

  function create(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function populateMonths(transactions) {
    while (els.month.options.length > 1) els.month.remove(1);
    const months = [...new Set(transactions.map(tx => dateParts(tx.tanggal).month).filter(Boolean))].sort().reverse();
    for (const value of months) {
      const [year, month] = value.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, 1, 12));
      const option = document.createElement("option");
      option.value = value;
      option.textContent = monthLabel.format(date);
      els.month.appendChild(option);
    }
  }

  function filteredTransactions() {
    const query = String(els.search.value || "").trim().toLocaleLowerCase("id-ID");
    const month = els.month.value;
    const type = els.type.value;
    return all.filter(tx => {
      if (month !== "all" && dateParts(tx.tanggal).month !== month) return false;
      if (type !== "all" && tx.jenis !== type) return false;
      if (!query) return true;
      return [tx.keterangan, tx.catatan, tx.kategoriNama, tx.kategori, tx.nomor, ...(Array.isArray(tx.label) ? tx.label : [])]
        .join(" ").toLocaleLowerCase("id-ID").includes(query);
    });
  }

  function renderTransactions() {
    const filtered = filteredTransactions();
    const shown = filtered.slice(0, visibleLimit);
    els.list.replaceChildren();
    els.count.textContent = `${filtered.length.toLocaleString("id-ID")} transaksi`;

    if (!shown.length) {
      els.list.appendChild(create("div", "empty-state", "Tidak ada transaksi yang cocok."));
      els.loadMore.hidden = true;
      return;
    }

    let currentDay = "";
    let currentGroup = null;
    for (const tx of shown) {
      const day = dateParts(tx.tanggal).day;
      if (day !== currentDay) {
        currentDay = day;
        currentGroup = create("section", "date-group");
        currentGroup.appendChild(create("h3", "date-heading", dateLong.format(new Date(number(tx.tanggal)))));
        els.list.appendChild(currentGroup);
      }

      const row = create("article", `transaction ${tx.jenis}`);
      const main = create("div", "transaction-main");
      const categoryCard = create("div", "transaction-category-card");
      categoryCard.appendChild(create("span", "transaction-category-label", tx.jenis === "masuk" ? "Pemasukan" : "Pengeluaran"));
      categoryCard.appendChild(create("strong", "transaction-category-name", tx.kategoriNama || tx.kategori || "Lainnya"));
      main.appendChild(categoryCard);
      main.appendChild(create("p", "transaction-title", tx.keterangan || "Tanpa keterangan"));
      const meta = create("div", "transaction-meta");
      if (tx.nomor) meta.appendChild(create("span", "", `No. ${tx.nomor}`));
      main.appendChild(meta);
      if (tx.catatan) {
        const note = create("p", "transaction-note");
        note.appendChild(create("strong", "", "Catatan: "));
        note.appendChild(document.createTextNode(String(tx.catatan)));
        main.appendChild(note);
      }
      if (Array.isArray(tx.label) && tx.label.length) {
        const tags = create("div", "tags");
        tx.label.slice(0, 5).forEach(label => tags.appendChild(create("span", "tag", `#${String(label).replace(/^#/, "")}`)));
        main.appendChild(tags);
      }
      if (Array.isArray(tx.bukti) && tx.bukti.length) {
        const evidence = create("div", "transaction-evidence");
        for (const proof of tx.bukti) {
          if (!proof?.url) continue;
          const link = create("a", "transaction-evidence-link");
          link.href = proof.url;
          link.target = "_blank";
          link.rel = "noopener";
          link.setAttribute("aria-label", `Buka ${proof.id || "foto bukti"}`);
          const img = create("img", "transaction-evidence-image");
          img.src = proof.url;
          img.alt = proof.id || "Foto bukti transaksi";
          img.loading = "lazy";
          link.appendChild(img);
          evidence.appendChild(link);
        }
        if (evidence.childElementCount) main.appendChild(evidence);
      }
      row.appendChild(main);
      row.appendChild(create("div", "transaction-amount", formatAmount(tx)));
      currentGroup.appendChild(row);
    }
    els.loadMore.hidden = filtered.length <= visibleLimit;
  }

  function resetAndRender() { visibleLimit = PAGE_SIZE; renderTransactions(); }

  function showDashboard(data) {
    all = Array.isArray(data.transactions) ? data.transactions : [];
    els.title.textContent = data.nama || data.idKas || idKas;
    document.title = `${els.title.textContent} · Multi Kas PROxyz`;
    els.saldo.textContent = rupiah.format(number(data.saldo?.akhir));
    els.totalMasuk.textContent = rupiah.format(number(data.saldo?.masuk));
    els.totalKeluar.textContent = rupiah.format(number(data.saldo?.keluar));
    const bulan = monthSummary(all);
    els.bulanMasuk.textContent = rupiah.format(bulan.masuk);
    els.bulanKeluar.textContent = rupiah.format(bulan.keluar);
    els.updated.textContent = `Diperbarui ${dateTime.format(new Date(number(data.updatedAt) || Date.now()))} WIB`;
    populateMonths(all);
    renderTransactions();
    if (els.unlockPanel) els.unlockPanel.hidden = true;
    els.content.hidden = false;
  }

  async function fetchPublicJson() {
    const response = await fetch(`../../data/kas/${encodeURIComponent(idKas)}.json`, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 404 ? "Data dashboard belum tersedia." : "Data dashboard gagal dimuat.");
    return response.json();
  }

  function showLogin(message = "") {
    els.content.hidden = true;
    if (els.unlockPanel) els.unlockPanel.hidden = false;
    if (message) setAuthStatus(message, "error");
  }

  function resetOtpForm() {
    challengeId = "";
    challengeExpiresAt = 0;
    try { sessionStorage.removeItem(OTP_KEY); } catch (_) {}
    if (els.phoneForm) els.phoneForm.hidden = false;
    if (els.otpForm) els.otpForm.hidden = true;
    if (els.otp) els.otp.value = "";
  }

  function saveOtpState(phone) {
    try { sessionStorage.setItem(OTP_KEY, JSON.stringify({ challengeId, expiresAt: challengeExpiresAt, phone })); } catch (_) {}
  }

  function restoreOtpState() {
    try {
      const row = JSON.parse(sessionStorage.getItem(OTP_KEY) || "null");
      if (!row?.challengeId || Number(row.expiresAt) <= Date.now()) return false;
      challengeId = String(row.challengeId);
      challengeExpiresAt = Number(row.expiresAt);
      if (row.phone && els.phone) els.phone.value = row.phone;
      if (els.phoneForm) els.phoneForm.hidden = true;
      if (els.otpForm) els.otpForm.hidden = false;
      return true;
    } catch (_) { return false; }
  }

  async function loadPrivate() {
    try {
      const result = await api(`/api/public/kas/${encodeURIComponent(idKas)}/data`);
      showDashboard(result.data);
      return true;
    } catch (error) {
      showLogin(error.status === 403
        ? "Sesi ditemukan, tetapi nomor ini belum memiliki akses ke Kas ini. Masuk dengan nomor lain yang terdaftar."
        : error.status === 401
          ? "Silakan masuk dengan nomor WhatsApp yang terdaftar."
          : error.message);
      return false;
    }
  }

  async function requestOtp(event) {
    event.preventDefault();
    const phone = String(els.phone?.value || "").trim();
    if (!phone) return;
    els.sendOtp.disabled = true;
    els.sendOtp.textContent = "Mengirim…";
    setAuthStatus("Mengirim kode OTP…");
    try {
      const result = await api("/api/auth/request", { method: "POST", body: JSON.stringify({ phone, kasId: idKas }) });
      challengeId = result.challengeId;
      challengeExpiresAt = Number(result.expiresAt) || Date.now() + 5 * 60 * 1000;
      saveOtpState(phone);
      els.phoneForm.hidden = true;
      els.otpForm.hidden = false;
      setAuthStatus("Kode OTP sudah dikirim ke WhatsApp Anda.", "success");
      els.otp?.focus();
    } catch (error) {
      setAuthStatus(error.message, "error");
    } finally {
      els.sendOtp.disabled = false;
      els.sendOtp.textContent = "Kirim OTP";
    }
  }

  async function verifyOtp(event) {
    event.preventDefault();
    if (!challengeId || challengeExpiresAt <= Date.now()) {
      resetOtpForm();
      return setAuthStatus("Kode OTP sudah berakhir. Kirim kode baru.", "error");
    }
    const code = String(els.otp?.value || "").replace(/\D/g, "");
    if (code.length !== 6) return setAuthStatus("Masukkan 6 digit kode OTP.", "error");

    els.verifyOtp.disabled = true;
    els.verifyOtp.textContent = "Masuk…";
    try {
      const result = await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ challengeId, code }) });
      saveToken(result.token);
      resetOtpForm();
      setAuthStatus("");
      await loadPrivate();
    } catch (error) {
      setAuthStatus(error.message, "error");
    } finally {
      els.verifyOtp.disabled = false;
      els.verifyOtp.textContent = "Masuk";
    }
  }

  els.search?.addEventListener("input", resetAndRender);
  els.month?.addEventListener("change", resetAndRender);
  els.type?.addEventListener("change", resetAndRender);
  els.loadMore?.addEventListener("click", () => { visibleLimit += PAGE_SIZE; renderTransactions(); });
  els.phoneForm?.addEventListener("submit", requestOtp);
  els.otpForm?.addEventListener("submit", verifyOtp);
  els.changePhone?.addEventListener("click", () => { resetOtpForm(); setAuthStatus(""); els.phone?.focus(); });

  if (!idKas) {
    if (els.updated) els.updated.textContent = "ID Kas tidak ditemukan";
    return;
  }

  if (visibility === "private") {
    restoreOtpState();
    loadPrivate();
  } else {
    fetchPublicJson().then(showDashboard).catch(error => {
      els.updated.textContent = "Data tidak dapat dimuat";
      els.list.replaceChildren(create("div", "empty-state error-state", error.message));
      els.loadMore.hidden = true;
    });
  }
})();
