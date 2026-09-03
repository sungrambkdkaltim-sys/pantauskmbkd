// Konstanta & fungsi murni yang dipakai bersama oleh App.jsx dan exportReport.js
// (dipisah supaya tidak terjadi circular import antar modul).

/* ============================================================================
   Daftar email yang boleh mengunggah/reset data (mode cloud). Ini HANYA
   untuk kenyamanan tampilan (supaya pesan errornya jelas) — keamanan
   sesungguhnya tetap ditegakkan oleh Firestore Security Rules di server,
   BUKAN oleh pengecekan ini. Kalau daftar berubah, cocokkan juga isi Rules
   di Firebase Console (lihat README bagian "Batasi email").
   ============================================================================ */
export const ALLOWED_UPLOADER_EMAILS = ["sungram.bkdkaltim@gmail.com"];

/* ============================================================================
   REFERENSI RESMI
   - 9 unsur & interval mutu: Permenpan RB No. 14/2017, Lampiran Tabel II
     (diverifikasi langsung dari dokumen regulasi)
   - Pemetaan 19 pertanyaan mentah SKM Online -> 9 unsur IKM + 5 unsur IPAK:
     "Paparan Konsolidasi Data SKM Online Lingkup K/L", 23 Juni 2026, hal. 5
     (diverifikasi langsung dari dokumen paparan, bukan asumsi)
   ============================================================================ */
export const UNSUR_LABELS = [
  "Persyaratan",
  "Sistem, Mekanisme & Prosedur",
  "Waktu Penyelesaian",
  "Biaya/Tarif",
  "Produk Spesifikasi Layanan",
  "Kompetensi Pelaksana",
  "Perilaku Pelaksana",
  "Penanganan Pengaduan",
  "Sarana dan Prasarana",
];

export const IPAK_LABELS = [
  "Kepatuhan Prosedur",
  "Bebas Pungutan Liar",
  "Bebas Percaloan",
  "Keadilan Layanan",
  "Bebas Gratifikasi",
];

export const MUTU_TABLE = [
  { code: "D", label: "Tidak Baik", min: 25.0, max: 64.99, tone: "bad" },
  { code: "C", label: "Kurang Baik", min: 65.0, max: 76.6, tone: "warn" },
  { code: "B", label: "Baik", min: 76.61, max: 88.3, tone: "good" },
  { code: "A", label: "Sangat Baik", min: 88.31, max: 100.0, tone: "great" },
];

export function kategoriMutu(ikm) {
  if (ikm == null || Number.isNaN(ikm)) return { code: "-", label: "Data tidak cukup", tone: "muted" };
  const hit = MUTU_TABLE.find((m) => ikm >= m.min && ikm <= m.max);
  if (hit) return hit;
  return ikm > 100 ? MUTU_TABLE[3] : MUTU_TABLE[0];
}

/* ============================================================================
   Klasifikasi pertanyaan mentah -> unsur IKM (U1-U9) atau unsur IPAK.
   Dicocokkan lewat kata kunci (bukan posisi kolom) supaya tetap bekerja pada
   beberapa varian kuesioner SKM Online (Online/Hybrid/Manual) yang jumlah &
   urutan pertanyaannya sedikit berbeda, sesuai tabel resmi Kemenpan RB.
   ============================================================================ */
export const QUESTION_MAP = [
  { test: (q) => q.includes("informasi pelayanan tersedia"), unsur: 0 },
  { test: (q) => q.includes("persyaratan yang diminta"), unsur: 0 },
  { test: (q) => q.includes("standar dan prosedur"), unsur: 1 },
  { test: (q) => q.includes("prosedur") && q.includes("alur") && q.includes("mudah dipahami"), unsur: 1 },
  { test: (q) => q.includes("jangka waktu layanan"), unsur: 2 },
  { test: (q) => q.includes("biaya layanan sesuai"), unsur: 3 },
  { test: (q) => q.includes("produk layanan yang diterima"), unsur: 4 },
  { test: (q) => q.includes("aplikasi sistem pelayanan merespon"), unsur: 5 },
  { test: (q) => q.includes("petugas merespon kebutuhan"), unsur: 5 },
  { test: (q) => q.includes("fitur pada aplikasi"), unsur: 6 },
  { test: (q) => q.includes("petugas melayani saya dengan ramah"), unsur: 6 },
  { test: (q) => q.includes("layanan konsultasi dan pengaduan"), unsur: 7 },
  { test: (q) => q.includes("sistem layanan online nyaman"), unsur: 8 },
  { test: (q) => q.includes("sarana prasarana nyaman"), unsur: 8 },
  // --- IPAK (Indeks Persepsi Anti Korupsi) — di luar 9 unsur IKM inti ---
  { test: (q) => q.includes("sesuai prosedur tanpa adanya kecurangan"), ipak: 0 },
  { test: (q) => q.includes("tidak ada pungutan liar"), ipak: 1 },
  { test: (q) => q.includes("tidak ada percaloan"), ipak: 2 },
  { test: (q) => q.includes("dilayani secara adil tanpa diskriminasi"), ipak: 3 },
  { test: (q) => q.includes("tanpa imbalan uang, barang"), ipak: 4 },
];

export function classifyQuestion(headerText) {
  const q = String(headerText || "").toLowerCase();
  for (const rule of QUESTION_MAP) {
    if (rule.test(q)) return rule;
  }
  return null;
}

/* Skala Likert 4 poin resmi SKM: Tidak Baik(1) < Kurang Baik(2) < Baik(3) < Sangat Baik(4) */
export const TEXT_SCORE = { "tidak baik": 1, "kurang baik": 2, "baik": 3, "sangat baik": 4 };
export function textToScore(v) {
  if (typeof v === "number") return v;
  const s = String(v || "").trim().toLowerCase();
  return TEXT_SCORE[s] ?? null;
}

/* ============================================================================
   PII masking — internal team tetap perlu jaga privasi responden by default
   ============================================================================ */
export function maskName(name) {
  if (!name || name === "-") return "-";
  const parts = String(name).trim().split(/\s+/);
  return parts.map((p) => (p.length <= 2 ? p[0] + "*" : p[0] + "*".repeat(p.length - 1))).join(" ");
}

export const EMPTY_KRITIK = new Set(["-", ".", "-.", "tidak ada", "tdk ada", "nihil", "none", "kosong", ""]);
export function isMeaningfulText(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s.length > 2 && !EMPTY_KRITIK.has(s);
}
export function avg(arr) {
  const clean = arr.filter((v) => v != null && !Number.isNaN(v));
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
}
