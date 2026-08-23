(() => {
  "use strict";

  const config = window.PROXYZ_ADMIN_CONFIG || {};
  const API = String(config.apiBase || "").replace(/\/$/, "");
  const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
  const dateFmt = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" });

  const $ = id => document.getElementById(id);
  const loginView = $("login-view");
  const appView = $("app-view");
  const phoneForm = $("phone-form");
  const otpForm = $("otp-form");
  const authStatus = $("auth-status");
  const kasSelect = $("kas-select");
  const kasContent = $("kas-content");
  const txList = $("tx-list");
  const dialog = $("tx-dialog");
  const txForm = $("tx-form");

  const OTP_STORAGE_KEY = "proxyz_admin_otp_challenge";
  let challengeId = "";
  let challengeExpiresAt = 0;
  let me = null;
  let activeKas = null;
  let activeKasDetail = null;
  let transactions = [];
  let totalTransactions = 0;
  let offset = 0;
  const pageSize = 50;

  function setStatus(el, message = "", type = "") {
    el.textContent = message;
    el.className = `status ${type}`.trim();
  }

  async function api(path, options = {}) {
    if (!API) throw new Error("Alamat API Admin belum dikonfigurasi.");
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    let response;
    try {
      response = await fetch(`${API}${path}`, { ...options, headers, cache: "no-store", credentials: "include" });
    } catch (_) {
      throw new Error("API PROxyz belum dapat dihubungi.");
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
    appView.hidden = true;
    loginView.hidden = false;
  }

  function clearOtpChallenge() {
    challengeId = "";
    challengeExpiresAt = 0;
    try { sessionStorage.removeItem(OTP_STORAGE_KEY); } catch (_) {}
    otpForm.hidden = true;
    phoneForm.hidden = false;
  }

  function saveOtpChallenge(phone) {
    try {
      sessionStorage.setItem(OTP_STORAGE_KEY, JSON.stringify({
        challengeId,
        expiresAt: challengeExpiresAt,
        phone: String(phone || "")
      }));
    } catch (_) {}
  }

  function restoreOtpChallenge() {
    try {
      const raw = sessionStorage.getItem(OTP_STORAGE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved?.challengeId || Number(saved.expiresAt) <= Date.now()) {
        clearOtpChallenge();
        return false;
      }
      challengeId = String(saved.challengeId);
      challengeExpiresAt = Number(saved.expiresAt);
      if (saved.phone) $("phone").value = saved.phone;
      phoneForm.hidden = true;
      otpForm.hidden = false;
      return true;
    } catch (_) {
      clearOtpChallenge();
      return false;
    }
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
    const d = new Date(Number(value) || Date.now());
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  function parseTags(value) {
    return [...new Set(String(value || "").split(/\s+/).map(x => x.replace(/^#/, "").trim().toLowerCase()).filter(Boolean))];
  }

  async function bootstrapSession() {
    try {
      const data = await api("/api/me");
      me = data.user;
      renderMe();
    } catch (_) {
      clearSession();
      setStatus(authStatus);
    }
  }

  function renderMe() {
    loginView.hidden = true;
    appView.hidden = false;
    $("welcome").textContent = `Admin · ${me.phone}`;
    kasSelect.replaceChildren();

    for (const kas of me.kas || []) {
      const option = document.createElement("option");
      option.value = kas.id;
      option.textContent = `${kas.nama} · ${kas.role}`;
      kasSelect.appendChild(option);
    }

    if (me.kas?.length) {
      loadKas(me.kas[0].id);
    } else {
      kasContent.hidden = true;
    }
  }

  async function loadKas(id) {
    activeKas = id;
    offset = 0;
    transactions = [];
    const data = await api(`/api/kas/${encodeURIComponent(id)}`);
    activeKasDetail = data.kas;
    $("kas-name").textContent = data.kas.nama;
    $("kas-balance").textContent = rupiah.format(data.kas.saldo.akhir || 0);
    $("kas-in").textContent = rupiah.format(data.kas.saldo.masuk || 0);
    $("kas-out").textContent = rupiah.format(data.kas.saldo.keluar || 0);
    kasContent.hidden = false;
    await loadTransactions(true);
  }

  async function loadTransactions(reset = false) {
    if (!activeKas) return;
    if (reset) {
      offset = 0;
      transactions = [];
    }
    const search = $("search").value.trim();
    const data = await api(`/api/kas/${encodeURIComponent(activeKas)}/transaksi?limit=${pageSize}&offset=${offset}&search=${encodeURIComponent(search)}`);
    totalTransactions = data.total;
    transactions = reset ? data.transaksi : transactions.concat(data.transaksi);
    offset = transactions.length;
    renderTransactions();
  }

  function renderTransactions() {
    txList.replaceChildren();
    if (!transactions.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Belum ada transaksi.";
      txList.appendChild(empty);
    }

    for (const tx of transactions) {
      const card = document.createElement("article");
      card.className = "tx";
      const top = document.createElement("div");
      top.className = "tx-top";
      const left = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = `${tx.nomor} · ${tx.keterangan}`;
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${dateFmt.format(new Date(tx.tanggal))} · ${tx.kategori}`;
      left.append(title, meta);
      const amount = document.createElement("div");
      amount.className = `amount ${tx.jenis === "masuk" ? "in" : "out"}`;
      amount.textContent = `${tx.jenis === "masuk" ? "+" : "−"}${rupiah.format(tx.nominal)}`;
      top.append(left, amount);
      card.appendChild(top);

      if (tx.catatan) {
        const note = document.createElement("div");
        note.className = "meta";
        note.style.marginTop = "7px";
        note.textContent = tx.catatan;
        card.appendChild(note);
      }
      for (const tag of tx.label || []) {
        const span = document.createElement("span");
        span.className = "tag";
        span.textContent = `#${tag}`;
        card.appendChild(span);
      }

      const actions = document.createElement("div");
      actions.className = "tx-actions";
      const edit = document.createElement("button");
      edit.className = "ghost";
      edit.type = "button";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => openEdit(tx));
      const del = document.createElement("button");
      del.className = "danger-soft";
      del.type = "button";
      del.textContent = "Hapus";
      del.addEventListener("click", () => deleteTx(tx));
      actions.append(edit, del);
      card.appendChild(actions);
      txList.appendChild(card);
    }

    $("load-more").hidden = transactions.length >= totalTransactions;
  }

  function updateCategories() {
    const type = $("tx-type").value;
    const categories = activeKasDetail?.kategori?.[type] || [];
    const current = $("tx-category").value;
    $("tx-category").replaceChildren();
    for (const category of categories) {
      const opt = document.createElement("option");
      opt.value = category;
      opt.textContent = category.charAt(0).toUpperCase() + category.slice(1);
      $("tx-category").appendChild(opt);
    }
    if (categories.includes(current)) $("tx-category").value = current;
  }

  function openCreate(type) {
    txForm.reset();
    $("tx-ref").value = "";
    $("form-mode").textContent = "Transaksi baru";
    $("form-title").textContent = type === "masuk" ? "Tambah pemasukan" : "Tambah pengeluaran";
    $("tx-type").value = type;
    $("tx-date").value = todayJakarta();
    $("edit-reason-wrap").hidden = true;
    updateCategories();
    setStatus($("form-status"));
    dialog.showModal();
  }

  function openEdit(tx) {
    txForm.reset();
    $("tx-ref").value = tx.nomor;
    $("form-mode").textContent = `Edit #${tx.nomor}`;
    $("form-title").textContent = tx.keterangan;
    $("tx-type").value = tx.jenis;
    updateCategories();
    $("tx-category").value = tx.kategori;
    $("tx-amount").value = tx.nominal;
    $("tx-description").value = tx.keterangan;
    $("tx-note").value = tx.catatan || "";
    $("tx-tags").value = (tx.label || []).map(x => `#${x}`).join(" ");
    $("tx-date").value = timestampToDate(tx.tanggal);
    $("edit-reason-wrap").hidden = false;
    setStatus($("form-status"));
    dialog.showModal();
  }

  async function deleteTx(tx) {
    const reason = prompt(`Hapus transaksi ${tx.nomor} — ${tx.keterangan}?\n\nTuliskan alasan hapus:`, "Dihapus melalui Web PROxyz");
    if (reason === null) return;
    if (!reason.trim()) return alert("Alasan hapus wajib diisi.");
    try {
      await api(`/api/kas/${encodeURIComponent(activeKas)}/transaksi/${encodeURIComponent(tx.nomor)}`, {
        method: "DELETE",
        body: JSON.stringify({ alasan: reason.trim() })
      });
      await loadKas(activeKas);
    } catch (error) {
      alert(error.message);
    }
  }

  phoneForm.addEventListener("submit", async event => {
    event.preventDefault();
    setStatus(authStatus, "Mengirim kode…");
    try {
      const result = await api("/api/auth/request", { method: "POST", body: JSON.stringify({ phone: $("phone").value }) });
      challengeId = result.challengeId;
      challengeExpiresAt = Number(result.expiresAt) || (Date.now() + (Number(result.expiresInSeconds) || 300) * 1000);
      saveOtpChallenge($("phone").value);
      phoneForm.hidden = true;
      otpForm.hidden = false;
      $("otp").value = "";
      $("otp").focus();
      setStatus(authStatus, "Kode OTP sudah dikirim ke WhatsApp dan berlaku 5 menit.", "success");
    } catch (error) {
      setStatus(authStatus, error.message, "error");
    }
  });

  otpForm.addEventListener("submit", async event => {
    event.preventDefault();
    setStatus(authStatus, "Memeriksa kode…");
    try {
      if (!challengeId) throw new Error("Tekan Kirim kode OTP terlebih dahulu.");
      await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ challengeId, code: $("otp").value }) });
      clearOtpChallenge();
      setStatus(authStatus);
      await bootstrapSession();
    } catch (error) {
      if (/kedaluwarsa|sesi otp tidak ditemukan|sudah berakhir/i.test(error.message)) {
        clearOtpChallenge();
      }
      setStatus(authStatus, error.message, "error");
    }
  });

  $("change-phone").addEventListener("click", () => {
    clearOtpChallenge();
    setStatus(authStatus);
  });

  $("logout").addEventListener("click", async () => {
    try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch (_) {}
    clearSession();
  });

  kasSelect.addEventListener("change", () => loadKas(kasSelect.value).catch(error => alert(error.message)));
  $("refresh").addEventListener("click", () => loadKas(activeKas).catch(error => alert(error.message)));
  $("add-income").addEventListener("click", () => openCreate("masuk"));
  $("add-expense").addEventListener("click", () => openCreate("keluar"));
  $("tx-type").addEventListener("change", updateCategories);
  $("close-dialog").addEventListener("click", () => dialog.close());
  $("load-more").addEventListener("click", () => loadTransactions(false).catch(error => alert(error.message)));

  let searchTimer;
  $("search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadTransactions(true).catch(error => alert(error.message)), 350);
  });

  txForm.addEventListener("submit", async event => {
    event.preventDefault();
    const ref = $("tx-ref").value;
    const payload = {
      jenis: $("tx-type").value,
      nominal: Number($("tx-amount").value),
      kategori: $("tx-category").value,
      keterangan: $("tx-description").value.trim(),
      catatan: $("tx-note").value.trim(),
      label: parseTags($("tx-tags").value),
      tanggal: dateToTimestamp($("tx-date").value)
    };
    if (ref) payload.alasan = $("tx-reason").value.trim() || "Edit melalui Web PROxyz";

    setStatus($("form-status"), "Menyimpan…");
    try {
      await api(
        ref
          ? `/api/kas/${encodeURIComponent(activeKas)}/transaksi/${encodeURIComponent(ref)}`
          : `/api/kas/${encodeURIComponent(activeKas)}/transaksi`,
        { method: ref ? "PUT" : "POST", body: JSON.stringify(payload) }
      );
      dialog.close();
      await loadKas(activeKas);
    } catch (error) {
      setStatus($("form-status"), error.message, "error");
    }
  });

  restoreOtpChallenge();
  bootstrapSession();
})();
