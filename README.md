# Dashboard SKM Online — BKD

Situs statis, siap hosting di GitHub Pages. Hanya 2 file: `index.html` dan `bundle.js` (berisi seluruh React, chart, dan logika parsing — tidak perlu Node.js/build tool di sisi server).

## Cara deploy ke GitHub Pages

1. Buat repository baru di GitHub (bisa publik atau privat, tapi GitHub Pages gratis hanya jalan otomatis di repo publik kecuali punya GitHub Pro/Enterprise).
2. Upload `index.html` dan `bundle.js` ke **root repository** (bukan di dalam folder).
3. Buka **Settings → Pages** di repo tersebut.
4. Pada **Source**, pilih branch `main` dan folder `/ (root)`, lalu **Save**.
5. Tunggu 1-2 menit, situs akan aktif di `https://<username>.github.io/<nama-repo>/`.

## Cara update kode (kalau ada revisi dari Claude di kemudian hari)

File `bundle.js` sudah di-*minify* dan digabung dari source `App.jsx` — jangan diedit langsung. Kalau perlu revisi, minta source `.jsx`-nya lalu build ulang dengan esbuild, atau minta saya build ulang setelah revisi.

## Cara pakai dashboard

- Saat pertama dibuka, dashboard menampilkan **data contoh** (1 layanan, 10 responden) dari hasil ekspor SKM Online.
- Klik **"Unggah data periode baru"** untuk memilih banyak file `.xlsx` sekaligus (format ekspor mentah "Hasil Survey" dari SKM Online — 1 file = 1 jenis layanan).
- Setiap kali unggah, seluruh data lama **diganti total**, tidak ditambah/ditumpuk.
- Tombol **"Reset ke data contoh"** muncul setelah upload pertama, untuk kembali ke data contoh awal kapan saja.

## Catatan penting

- Data yang diunggah **hanya diproses di browser pengguna** (tidak dikirim ke server mana pun) — cocok untuk hosting statis seperti GitHub Pages karena tidak butuh backend.
- Nama, email, dan no. telepon responden **disembunyikan secara default** di bagian Kritik & Saran; ada tombol untuk menampilkannya bila diperlukan tim internal.
- Rumus IKM: Σ(rata-rata per unsur × 0,11) × 25 — mengikuti konvensi Kepmenpan 25/2004 yang dipakai pada template Permenpan RB 14/2017 (sudah diverifikasi cocok dengan laporan resmi BKD Semester I 2026).
