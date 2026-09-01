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
- Panel ringkasan hasil unggah otomatis **ringkas** (collapsed) kalau semua file mulus — klik untuk buka rincian per file. Kalau ada file gagal atau ada kolom pertanyaan tak dikenali, panel otomatis terbuka supaya langsung terlihat.

## Data tersimpan otomatis di browser (localStorage)

- Setelah upload berhasil, data **otomatis tersimpan di browser** perangkat itu — jadi kalau halaman di-refresh, data TIDAK hilang/balik ke data contoh.
- **Penting**: penyimpanan ini per-browser/per-perangkat, bukan database bersama di server. Kalau dashboard dibuka dari komputer atau browser lain, yang tampil adalah data terakhir yang diunggah **DI PERANGKAT ITU** (atau data contoh kalau belum pernah upload di perangkat tersebut) — bukan data yang sama untuk semua orang.
- Kalau tim butuh semua orang melihat data yang sama secara real-time dari perangkat berbeda, itu perlu backend/database sungguhan (di luar cakupan situs statis ini) — beri tahu saya kalau ke depannya butuh ini, supaya bisa direncanakan.
- Membersihkan cache/data situs di browser, atau membuka via mode private/incognito, akan mengembalikan ke data contoh.

## Catatan penting

- Data yang diunggah **hanya diproses di browser pengguna** (tidak dikirim ke server mana pun) — cocok untuk hosting statis seperti GitHub Pages karena tidak butuh backend.
- Nama, email, dan no. telepon responden **disembunyikan secara default** di bagian Kritik & Saran; ada tombol untuk menampilkannya bila diperlukan tim internal.
- Rumus IKM: Σ(rata-rata per unsur × 0,11) × 25 — mengikuti konvensi Kepmenpan 25/2004 yang dipakai pada template Permenpan RB 14/2017 (sudah diverifikasi cocok dengan laporan resmi BKD Semester I 2026).

## Setup Firebase (real-time & multi-perangkat) — OPSIONAL

Tanpa langkah ini, dashboard tetap jalan normal dalam **mode lokal** (data tersimpan per-browser). Ikuti langkah ini kalau Anda butuh data yang **sama secara instan di semua perangkat**, diunggah oleh beberapa staf dari lokasi berbeda.

### 1. Buat project Firebase (gratis, akun Google pribadi juga bisa)
1. Buka [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → beri nama (mis. "skm-bkd-kaltim") → lanjutkan sampai selesai (boleh matikan Google Analytics, tidak perlu).
2. Di halaman project, klik ikon **`</>`** (Web app) → beri nickname → **Register app**. Anda akan diberi objek `firebaseConfig` — **salin semua isinya**.

### 2. Isi `firebase-config.js`
Buka file `firebase-config.js` di repo Anda, ganti isi `window.FIREBASE_CONFIG` dengan nilai yang barusan disalin. Simpan & push ke GitHub — situs otomatis pindah ke mode cloud.

### 3. Aktifkan Firestore Database
1. Di Firebase Console → menu **Build → Firestore Database** → **Create database** → pilih lokasi server (terdekat: `asia-southeast2` / Jakarta) → mode **Production**.
2. Buka tab **Rules**, ganti isinya dengan ini, lalu **Publish**:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /skmDashboard/{doc} {
         allow read: if true;                    // semua orang bisa memantau
         allow write: if request.auth != null;   // hanya yang sudah login Google yang bisa unggah/reset
       }
     }
   }
   ```
   *(Opsional, lebih ketat: kalau mau membatasi hanya email tertentu yang boleh unggah, ganti baris `allow write` menjadi `allow write: if request.auth.token.email in ["staf1@gmail.com", "staf2@gmail.com"];`)*

### 4. Aktifkan login Google
1. Firebase Console → **Build → Authentication** → **Get started** → tab **Sign-in method** → aktifkan **Google**.
2. Masih di Authentication → tab **Settings → Authorized domains** → **Add domain** → masukkan domain GitHub Pages Anda (mis. `sungrambkdkaltim-sys.github.io`). **Langkah ini wajib** — kalau lewat, tombol "Masuk dengan Google" akan gagal.

### 5. Selesai
Buka situsnya — badge di pojok kiri atas akan berubah jadi **"Real-time"**. Siapa pun yang buka link akan melihat data yang sama; hanya yang sudah **"Masuk dengan Google"** yang bisa mengunggah/reset data, dan begitu diunggah, semua orang yang sedang membuka dashboard langsung melihat perubahannya tanpa refresh.

**Catatan skala**: Firestore membatasi 1 dokumen maksimal ±1 MB. Untuk ukuran data BKD saat ini (ratusan responden) ini jauh dari batas — tapi kalau suatu saat datanya sangat besar (ribuan responden dengan kritik/saran panjang), beri tahu saya supaya strukturnya disesuaikan (dipecah per-layanan, bukan 1 dokumen besar).

## Kalau update tidak muncul setelah commit (masalah cache)

Browser (dan kadang GitHub Pages) bisa nge-cache file `.js` cukup agresif. Kalau setelah update `firebase-config.js` atau `bundle.js` situsnya masih menampilkan versi lama:

1. **Cara paling pasti**: buka di jendela Incognito/Private baru — kalau di sana sudah benar, berarti situsnya sudah update, cuma browser normal Anda yang masih cache versi lama.
2. **Bersihkan cache paksa**: buka DevTools (F12) → klik-kanan tombol refresh (↻) di address bar → pilih **"Empty Cache and Hard Reload"**.
3. **Pencegahan untuk update berikutnya**: di `index.html`, dua baris `<script src="...">` punya akhiran `?v=2`. Setiap kali Anda (atau Claude) mengganti isi `firebase-config.js` atau `bundle.js`, naikkan angka ini (`?v=3`, `?v=4`, dst) supaya browser siapa pun otomatis mengambil versi baru tanpa perlu clear cache manual.
