(() => {
  "use strict";

  const list = document.getElementById("kas-list");
  const updated = document.getElementById("updated-at");
  const rupiah = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  });
  const dateTime = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  function create(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  fetch("../data/kas/index.json", { cache: "no-store" })
    .then(response => {
      if (!response.ok) throw new Error("Daftar kas gagal dimuat.");
      return response.json();
    })
    .then(data => {
      const kas = Array.isArray(data.kas) ? data.kas : [];
      list.replaceChildren();

      if (!kas.length) {
        list.appendChild(create("div", "empty-state", "Belum ada dashboard kas."));
      }

      for (const item of kas) {
        const card = create("a", `kas-card ${item.visibility === "private" ? "private" : "public"}`);
        card.href = item.url || `./${encodeURIComponent(item.idKas)}/`;

        const text = create("div", "");
        text.appendChild(create("h2", "", item.nama || item.idKas));

        if (item.visibility === "private") {
          text.appendChild(create(
            "p",
            "",
            item.configured === false
              ? "🔒 Privat · sandi belum dikonfigurasi"
              : "🔒 Privat · masukkan sandi untuk melihat"
          ));
        } else {
          text.appendChild(create(
            "p",
            "",
            `${rupiah.format(Number(item.saldo) || 0)} · ${Number(item.jumlahTransaksi || 0).toLocaleString("id-ID")} transaksi`
          ));
        }

        card.appendChild(text);
        card.appendChild(create("span", "arrow", "›"));
        list.appendChild(card);
      }

      updated.textContent = `Diperbarui ${dateTime.format(new Date(Number(data.updatedAt) || Date.now()))} WIB`;
    })
    .catch(error => {
      list.replaceChildren(create("div", "empty-state error-state", error.message));
      updated.textContent = "Data tidak dapat dimuat";
    });
})();
