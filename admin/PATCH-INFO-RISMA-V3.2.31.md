# PROxyz RISMA V3.2.31

## Perbaikan

### Card Kupon
- Nama kupon langsung: Ngaji, Jumat, Tarawih, Tadarus tanpa awalan "Kupon".
- Nama dan angka rata tengah.
- 0 kupon: `belum ada penerima`.
- Kupon > 0 dan seluruhnya selesai: `selesai dibagikan`.
- Masih ada pembagian: `belum dibagi X kupon • X orang`.
- Hanya status `belum dibagi ...` yang berwarna merah.
- Layout card diperketat agar status tidak terpotong/berantakan di layar mobile.

### PDF Daftar Hadir
- A4 portrait, dua kartu atas-bawah pada setiap halaman.
- Header kiri: `Nama :` dengan ruang nama yang lebih panjang.
- Header tengah: `RISMA POIN`, lalu `RAMADAN 1448 H`.
- Header kanan: `RISMA AL-HUDA`, lalu `Berakhlak • Berilmu • Visioner`.
- Sel minggu diturunkan dan diperbesar.
- `jumlah hadir:` tanpa garis bantu.
- Lingkaran besar di bawah `jumlah hadir:` untuk coretan total hadir.
- Tanggal ditulis `1 RAMADAN` sampai `28 RAMADAN` sesuai minggu.
- Garis potong horizontal diberi ruang aman agar kartu mudah dipisahkan.

### Cache & versi
- Admin Web build: `1.5.22`.
- Cache-buster Admin Web: `3.2.31`.

## Validasi
- `node --check` untuk file JavaScript terkait: lulus.
- Admin Web Checker V1.4.0: lulus.
- `npm test` harus dijalankan oleh installer di Termux setelah dependency proyek tersedia; jika gagal installer melakukan rollback.
