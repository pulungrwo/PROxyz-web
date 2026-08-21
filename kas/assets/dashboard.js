(() => {
  "use strict";

  const body = document.body;
  const idKas = String(body.dataset.kasId || "").trim().toLowerCase();
  const visibility = String(body.dataset.kasVisibility || "public").trim().toLowerCase();
  const PAGE_SIZE = 30;

  const rupiah = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  });

  const dateLong = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  const dateTime = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  const monthLabel = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    month: "long",
    year: "numeric"
  });

  const els = {
    content: document.getElementById("dashboard-content"),
    unlockPanel: document.getElementById("unlock-panel"),
    unlockForm: document.getElementById("unlock-form"),
    password: document.getElementById("kas-password"),
    unlockButton: document.getElementById("unlock-button"),
    unlockError: document.getElementById("unlock-error"),
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

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function dateParts(timestamp) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(number(timestamp)));
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return {
      day: `${map.year}-${map.month}-${map.day}`,
      month: `${map.year}-${map.month}`
    };
  }

  function currentJakartaMonth() {
    return dateParts(Date.now()).month;
  }

  function formatAmount(tx) {
    const sign = tx.jenis === "keluar" ? "−" : "+";
    return `${sign}${rupiah.format(number(tx.nominal))}`;
  }

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
    const months = [...new Set(
      transactions.map(tx => dateParts(tx.tanggal).month).filter(Boolean)
    )].sort().reverse();

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
      const haystack = [
        tx.keterangan,
        tx.kategori,
        tx.nomor,
        ...(Array.isArray(tx.label) ? tx.label : [])
      ].join(" ").toLocaleLowerCase("id-ID");
      return haystack.includes(query);
    });
  }

  function renderTransactions() {
    const filtered = filteredTransactions();
    const shown = filtered.slice(0, visibleLimit);
    els.list.replaceChildren();
    els.count.textContent = `${filtered.length.toLocaleString("id-ID")} transaksi`;

    if (shown.length === 0) {
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
      main.appendChild(create("p", "transaction-title", tx.keterangan || "Tanpa keterangan"));

      const meta = create("div", "transaction-meta");
      meta.appendChild(create("span", "", tx.kategori || "lainnya"));
      if (tx.nomor) meta.appendChild(create("span", "", `No. ${tx.nomor}`));
      main.appendChild(meta);

      if (Array.isArray(tx.label) && tx.label.length) {
        const tags = create("div", "tags");
        tx.label.slice(0, 5).forEach(label => {
          tags.appendChild(create("span", "tag", `#${String(label).replace(/^#/, "")}`));
        });
        main.appendChild(tags);
      }

      row.appendChild(main);
      row.appendChild(create("div", "transaction-amount", formatAmount(tx)));
      currentGroup.appendChild(row);
    }

    els.loadMore.hidden = filtered.length <= visibleLimit;
  }

  function resetAndRender() {
    visibleLimit = PAGE_SIZE;
    renderTransactions();
  }

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
    els.unlockPanel.hidden = true;
    els.content.hidden = false;
  }

  function b64ToBytes(value) {
    const raw = atob(value);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function decryptPayload(envelope, password) {
    if (!window.crypto?.subtle) {
      throw new Error("Browser ini tidak mendukung pembukaan dashboard privat.");
    }

    const salt = b64ToBytes(envelope.kdf?.salt || "");
    const iv = b64ToBytes(envelope.cipher?.iv || "");
    const ciphertext = b64ToBytes(envelope.data || "");
    const iterations = Number(envelope.kdf?.iterations) || 210000;

    const passwordKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256"
      },
      passwordKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );

    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      key,
      ciphertext
    );

    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(response.status === 404
        ? "Data dashboard belum tersedia."
        : "Data dashboard gagal dimuat.");
    }
    return response.json();
  }

  async function unlock(password) {
    els.unlockError.textContent = "";
    els.unlockButton.disabled = true;
    els.unlockButton.textContent = "Membuka…";

    try {
      const envelope = await fetchJson(`../../data/kas/${encodeURIComponent(idKas)}.enc.json`);
      const data = await decryptPayload(envelope, password);
      sessionStorage.setItem(`proxyz-kas-pass:${idKas}`, password);
      showDashboard(data);
    } catch (error) {
      sessionStorage.removeItem(`proxyz-kas-pass:${idKas}`);
      els.unlockError.textContent = error.name === "OperationError"
        ? "Sandi salah. Silakan coba lagi."
        : error.message;
      els.password.focus();
    } finally {
      els.unlockButton.disabled = false;
      els.unlockButton.textContent = "Buka";
    }
  }

  async function loadPublic() {
    const data = await fetchJson(`../../data/kas/${encodeURIComponent(idKas)}.json`);
    showDashboard(data);
  }

  els.search.addEventListener("input", resetAndRender);
  els.month.addEventListener("change", resetAndRender);
  els.type.addEventListener("change", resetAndRender);
  els.loadMore.addEventListener("click", () => {
    visibleLimit += PAGE_SIZE;
    renderTransactions();
  });

  if (els.unlockForm) {
    els.unlockForm.addEventListener("submit", event => {
      event.preventDefault();
      const password = String(els.password.value || "");
      if (!password) return;
      unlock(password);
    });
  }

  if (!idKas) {
    if (els.updated) els.updated.textContent = "ID kas tidak ditemukan";
    return;
  }

  if (visibility === "private") {
    const saved = sessionStorage.getItem(`proxyz-kas-pass:${idKas}`);
    if (saved) unlock(saved);
    else els.password?.focus();
  } else {
    loadPublic().catch(error => {
      els.updated.textContent = "Data tidak dapat dimuat";
      els.list.replaceChildren(create("div", "empty-state error-state", error.message));
      els.loadMore.hidden = true;
    });
  }
})();
