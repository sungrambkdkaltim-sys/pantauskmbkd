import React, { useState, useMemo, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";
import { Upload, TrendingUp, TrendingDown, Users, ClipboardList, Eye, EyeOff, Search, AlertTriangle, CheckCircle2, Info, FileCheck2, FileX2, ShieldCheck, ChevronDown, ChevronUp, X, Cloud, CloudOff, LogIn, LogOut, History, ArrowLeftCircle } from "lucide-react";
import { isCloudConfigured, subscribeCloudData, writeCloudData, subscribeAuth, signInWithGoogle, signOutCloud, listCloudHistory } from "./firebaseSync.js";

/* ============================================================================
   REFERENSI RESMI
   - 9 unsur & interval mutu: Permenpan RB No. 14/2017, Lampiran Tabel II
     (diverifikasi langsung dari dokumen regulasi)
   - Pemetaan 19 pertanyaan mentah SKM Online -> 9 unsur IKM + 5 unsur IPAK:
     "Paparan Konsolidasi Data SKM Online Lingkup K/L", 23 Juni 2026, hal. 5
     (diverifikasi langsung dari dokumen paparan, bukan asumsi)
   ============================================================================ */
const UNSUR_LABELS = [
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

const IPAK_LABELS = [
  "Kepatuhan Prosedur",
  "Bebas Pungutan Liar",
  "Bebas Percaloan",
  "Keadilan Layanan",
  "Bebas Gratifikasi",
];

const MUTU_TABLE = [
  { code: "D", label: "Tidak Baik", min: 25.0, max: 64.99, tone: "bad" },
  { code: "C", label: "Kurang Baik", min: 65.0, max: 76.6, tone: "warn" },
  { code: "B", label: "Baik", min: 76.61, max: 88.3, tone: "good" },
  { code: "A", label: "Sangat Baik", min: 88.31, max: 100.0, tone: "great" },
];

function kategoriMutu(ikm) {
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
const QUESTION_MAP = [
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

function classifyQuestion(headerText) {
  const q = String(headerText || "").toLowerCase();
  for (const rule of QUESTION_MAP) {
    if (rule.test(q)) return rule;
  }
  return null;
}

/* Skala Likert 4 poin resmi SKM: Tidak Baik(1) < Kurang Baik(2) < Baik(3) < Sangat Baik(4) */
const TEXT_SCORE = { "tidak baik": 1, "kurang baik": 2, "baik": 3, "sangat baik": 4 };
function textToScore(v) {
  if (typeof v === "number") return v;
  const s = String(v || "").trim().toLowerCase();
  return TEXT_SCORE[s] ?? null;
}

/* ============================================================================
   PII masking — internal team tetap perlu jaga privasi responden by default
   ============================================================================ */
function maskName(name) {
  if (!name || name === "-") return "-";
  const parts = String(name).trim().split(/\s+/);
  return parts.map((p) => (p.length <= 2 ? p[0] + "*" : p[0] + "*".repeat(p.length - 1))).join(" ");
}

const EMPTY_KRITIK = new Set(["-", ".", "-.", "tidak ada", "tdk ada", "nihil", "none", "kosong", ""]);
function isMeaningfulText(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s.length > 2 && !EMPTY_KRITIK.has(s);
}
function avg(arr) {
  const clean = arr.filter((v) => v != null && !Number.isNaN(v));
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
}

/* ============================================================================
   Cari sheet "Hasil Survey" (case-insensitive) di dalam satu file mentah.
   ============================================================================ */
function findAnswerSheetName(workbook) {
  const hit = workbook.SheetNames.find((n) => n.toLowerCase().includes("hasil survey") || n.toLowerCase().includes("hasil survei"));
  return hit || workbook.SheetNames[0];
}

function findColumn(headers, keywords, exact = null) {
  if (exact) {
    const i = headers.findIndex((h) => String(h || "").trim().toLowerCase() === exact);
    if (i !== -1) return i;
  }
  return headers.findIndex((h) => {
    const low = String(h || "").toLowerCase();
    return keywords.every((k) => low.includes(k));
  });
}

/* ============================================================================
   Parse SATU file export mentah "Hasil Survey" (format SKM Online, 1 file =
   1 jenis layanan) menjadi { layanan, respondents[], unclassified[] }.

   Struktur file: beberapa baris metadata di atas (Nama Survei, Jenis
   Layanan, dst), lalu baris header dimulai dari sel "No", lalu data per
   responden. Jawaban tiap pertanyaan berupa teks ("Baik"/"Sangat Baik"/dst)
   dan perlu dipetakan ke 9 unsur IKM + 5 unsur IPAK lewat classifyQuestion().
   ============================================================================ */
function parseHasilSurveyFile(workbook, fallbackName) {
  const sheetName = findAnswerSheetName(workbook);
  const rows2d = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });

  // --- metadata: nama layanan ---
  let layanan = null;
  for (let r = 0; r < Math.min(10, rows2d.length); r++) {
    const label = String(rows2d[r]?.[0] || "").trim().toLowerCase();
    if (label === "jenis layanan" && rows2d[r]?.[2]) layanan = String(rows2d[r][2]).trim();
    if (!layanan && label === "nama survei" && rows2d[r]?.[2]) {
      layanan = String(rows2d[r][2]).trim().replace(/^survei kepuasan masyarakat\s*/i, "");
    }
  }
  if (!layanan) layanan = fallbackName.replace(/\.[^.]+$/, "");

  // --- header row ("No") ---
  let headerRow = -1;
  for (let r = 0; r < Math.min(15, rows2d.length); r++) {
    if (String(rows2d[r]?.[0] || "").trim() === "No") { headerRow = r; break; }
  }
  if (headerRow === -1) throw new Error(`Baris header ("No") tidak ditemukan pada sheet "${sheetName}".`);
  let headers = rows2d[headerRow].map((h) => (h == null ? "" : String(h)));
  while (headers.length && !headers[headers.length - 1]) headers.pop();

  // --- kolom metadata (dicari via kata kunci, bukan posisi tetap) ---
  const col = {
    pendidikan: findColumn(headers, ["pendidikan"]),
    pekerjaan: findColumn(headers, ["pekerjaan"]),
    kritik: findColumn(headers, ["kritik"]),
    nama: findColumn(headers, [], "nama"),
    email: findColumn(headers, [], "email"),
    telp: findColumn(headers, ["telepon"]),
    trustPusat: findColumn(headers, ["pemerintah pusat"]),
    trustDaerah: findColumn(headers, ["pemerintah daerah"]),
  };

  // --- klasifikasikan setiap kolom pertanyaan ke unsur IKM / IPAK ---
  const unsurCols = Array.from({ length: 9 }, () => []);
  const ipakCols = Array.from({ length: 5 }, () => []);
  const unclassified = [];
  headers.forEach((h, idx) => {
    const known = [col.pendidikan, col.pekerjaan, col.kritik, col.nama, col.email, col.telp, col.trustPusat, col.trustDaerah].includes(idx);
    if (known || idx === 0) return; // lewati kolom metadata & No
    const rule = classifyQuestion(h);
    if (rule && rule.unsur != null) unsurCols[rule.unsur].push(idx);
    else if (rule && rule.ipak != null) ipakCols[rule.ipak].push(idx);
    else if (h && !["waktu pengisian", "hasil import", "menyetujui persyaratan"].some((k) => h.toLowerCase().includes(k)) && !h.toLowerCase().includes("tanggal menerima") && !h.toLowerCase().includes("usia") && !h.toLowerCase().includes("disabilitas")) {
      unclassified.push(h);
    }
  });

  // --- baris data ---
  const respondents = [];
  for (let r = headerRow + 1; r < rows2d.length; r++) {
    const no = rows2d[r]?.[0];
    if (no === null || no === undefined || no === "") break;
    const row = rows2d[r];
    const u = unsurCols.map((idxs) => avg(idxs.map((i) => textToScore(row[i]))));
    const ipak = ipakCols.map((idxs) => avg(idxs.map((i) => textToScore(row[i]))));
    if (u.some((v) => v == null)) continue; // lewati responden dengan unsur tak lengkap
    respondents.push({
      layanan,
      pendidikan: col.pendidikan !== -1 ? String(row[col.pendidikan] ?? "-").trim() : null,
      pekerjaan: col.pekerjaan !== -1 ? String(row[col.pekerjaan] ?? "-").trim() : null,
      kritik: col.kritik !== -1 ? row[col.kritik] : null,
      nama: col.nama !== -1 ? row[col.nama] : null,
      email: col.email !== -1 ? row[col.email] : null,
      telp: col.telp !== -1 ? row[col.telp] : null,
      trustPusat: col.trustPusat !== -1 ? Number(row[col.trustPusat]) : null,
      trustDaerah: col.trustDaerah !== -1 ? Number(row[col.trustDaerah]) : null,
      u,
      ipak: ipak.every((v) => v == null) ? null : ipak,
    });
  }

  return { layanan, respondents, unclassified: Array.from(new Set(unclassified)) };
}

/* ============================================================================
   Bangun seluruh model dashboard dari kumpulan respondents (gabungan lintas
   file/layanan). Rumus resmi Permenpan 14/2017 + konvensi bobot 0,11/unsur
   (Kepmenpan 25/2004, diverifikasi cocok dengan angka resmi laporan 82,93).
   ============================================================================ */
const BOBOT_UNSUR = 0.11;

function ikmFromUAvg(uAvg) {
  return uAvg.reduce((a, b) => a + b * BOBOT_UNSUR, 0) * 25;
}

function buildDataset(respondents) {
  if (!respondents.length) throw new Error("Tidak ada data responden yang valid untuk diproses.");

  const uAvgOverall = UNSUR_LABELS.map((_, k) => avg(respondents.map((r) => r.u[k])));
  const nrrOverall = avg(uAvgOverall);
  const ikmOverall = ikmFromUAvg(uAvgOverall);

  const withIpak = respondents.filter((r) => r.ipak);
  const ipakAvgOverall = withIpak.length ? IPAK_LABELS.map((_, k) => avg(withIpak.map((r) => r.ipak[k]))) : null;

  const byLayanan = new Map();
  respondents.forEach((r) => {
    if (!byLayanan.has(r.layanan)) byLayanan.set(r.layanan, []);
    byLayanan.get(r.layanan).push(r);
  });
  const perLayanan = Array.from(byLayanan.entries()).map(([layanan, list]) => {
    const uAvg = UNSUR_LABELS.map((_, k) => avg(list.map((r) => r.u[k])));
    const nrr = avg(uAvg);
    const ikm = ikmFromUAvg(uAvg);
    const listIpak = list.filter((r) => r.ipak);
    const ipakAvg = listIpak.length ? avg(listIpak.map((r) => avg(r.ipak))) : null;
    return { layanan, n: list.length, uAvg, nrr, ikm, mutu: kategoriMutu(ikm), ipakAvg, ipakN: listIpak.length };
  }).sort((a, b) => b.ikm - a.ikm);

  const countBy = (key) => {
    const m = new Map();
    respondents.forEach((r) => {
      const v = r[key] || "-";
      m.set(v, (m.get(v) || 0) + 1);
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };
  const demografi = {
    pendidikan: respondents.some((r) => r.pendidikan != null) ? countBy("pendidikan") : null,
    pekerjaan: respondents.some((r) => r.pekerjaan != null) ? countBy("pekerjaan") : null,
  };

  const trust = {
    pusat: avg(respondents.map((r) => r.trustPusat)),
    daerah: avg(respondents.map((r) => r.trustDaerah)),
  };

  const kritikList = respondents
    .filter((r) => isMeaningfulText(r.kritik))
    .map((r) => ({ layanan: r.layanan, teks: String(r.kritik).trim(), nama: r.nama }));

  return {
    respondents,
    overall: { n: respondents.length, uAvg: uAvgOverall, nrr: nrrOverall, ikm: ikmOverall, mutu: kategoriMutu(ikmOverall) },
    ipak: { avg: ipakAvgOverall, n: withIpak.length, score: ipakAvgOverall ? avg(ipakAvgOverall) : null },
    perLayanan,
    demografi,
    trust,
    kritikList,
    hasNama: respondents.some((r) => r.nama),
  };
}
const DEFAULT_RESPONDENTS_RAW = `[{"layanan":"Fasilitasi Pemberian Tanda Kehormatan Satyalancana Karya Satya","pendidikan":"D4/S1","pekerjaan":"ASN (PNS/PPPK)","kritik":"Lebih ditiingkatkan kembali dalam pelayanan kepegawaian","nama":"-","email":"-","telp":"-","trustPusat":9,"trustDaerah":9,"u":[3,3,3,3,3,3,3,3,3],"ipak":[3,3,3,3,3]},{"layanan":"Fasilitasi Pemberian Tanda Kehormatan Satyalancana Karya Satya","pendidikan":"S2","pekerjaan":"ASN (PNS/PPPK)","kritik":"Semoga seluruh ASN yang mengajukan Satyalancana karya Satya selalu dimudahkan beserta persyaratannya, dan dilancarkan dan perbaiki layanan publik melalui SKM, ","nama":"-","email":"-","telp":"-","trustPusat":9,"trustDaerah":9,"u":[4,4,4,4,4,4,4,4,4],"ipak":[4,4,4,4,4]},{"layanan":"Fasilitasi Pemberian Tanda Kehormatan Satyalancana Karya Satya","pendidikan":"D4/S1","pekerjaan":"ASN (PNS/PPPK)","kritik":"Semoga menjadi BKD yang terdepan di nasional.","nama":"RUDI ELPRIAN","email":"ibnusadikin4@gmail.com","telp":"082111220916","trustPusat":10,"trustDaerah":10,"u":[4,4,4,4,4,4,4,4,4],"ipak":[4,4,4,4,4]},{"layanan":"Fasilitasi Pemberian Tanda Kehormatan Satyalancana Karya Satya","pendidikan":"D4/S1","pekerjaan":"ASN (PNS/PPPK)","kritik":"Tingkatkan lagi pelayanan secara maksimal untuk pengusulan satyalencana","nama":"-","email":"-","telp":"-","trustPusat":7,"trustDaerah":8,"u":[3,3,3,1,3,3,3,3,3],"ipak":[3,3,3,3,3]},{"layanan":"Fasilitasi Pemberian Tanda Kehormatan Satyalancana Karya Satya","pendidikan":"D4/S1","pekerjaan":"ASN (PNS/PPPK)","kritik":"Untuk pengajuan penerimaan satya lencana sudah mengajukan yang 20 tahun tertolak karena belum pengajuan 10 tahun. Tapi sebelumnya sudah menanyakan untuk pengajuan apakah 10 dulu atau 20 arahan langsung 20 karena masa kerja sudah melebihi 20 tahun. Ini proses pengulangan pengajuan kembali","nama":"-","email":"-","telp":"-","trustPusat":7,"trustDaerah":8,"u":[3,3,3,3,3,3,3,3,3],"ipak":[3,3,3,3,3]},{"layanan":"Fasilitasi Pemberian Tanda Kehormatan Satyalancana Karya Satya","pendidikan":"D4/S1","pekerjaan":"ASN (PNS/PPPK)","kritik":"Pelayanan yang telah diberikan sudah baik dan diharapkan dapat terus dipertahankan serta ditingkatkan","nama":"-","email":"-","telp":"-","trustPusat":8,"trustDaerah":8,"u":[3,3,3,3,3,3,3,3,3],"ipak":[3,4,4,3,4]},{"layanan":"Fasilitasi Pemberian Tanda Kehormatan Satyalancana Karya Satya","pendidikan":"D4/S1","pekerjaan":"ASN (PNS/PPPK)","kritik":"Pengabdian yang sudah 30 Tahun dan sudah mendapatkan Sertifikat , namun sertifikat langsung di kirim ke Sim ASN , tidak ada penyerahan secara khusus","nama":"Harni, S.E.","email":"harni050169@gmail.com","telp":"082255205866","trustPusat":10,"trustDaerah":10,"u":[3,3,3,3,3,3,3,3,3],"ipak":[3,3,3,3,3]},{"layanan":"Fasilitasi Pemberian Tanda Kehormatan Satyalancana Karya Satya","pendidikan":"D4/S1","pekerjaan":"ASN (PNS/PPPK)","kritik":"Informasi terkait penganugerahan tanda jasa diinformasikan lengkap 1 bulan sebelumnya agar bisa dipersiapkan dgn matang","nama":"-","email":"-","telp":"-","trustPusat":8,"trustDaerah":9,"u":[3,4,3,3,3,3,3,3,3],"ipak":[3,3,3,3,3]},{"layanan":"Fasilitasi Pemberian Tanda Kehormatan Satyalancana Karya Satya","pendidikan":"D4/S1","pekerjaan":"ASN (PNS/PPPK)","kritik":"Agar layanan penerbitan Piagam Penghargaan Satya Lencana Karya Satya dipercepat lagi.","nama":"-","email":"-","telp":"-","trustPusat":10,"trustDaerah":10,"u":[3,3,3,3,3,3,3,3,3],"ipak":[3,3,3,3,3]},{"layanan":"Fasilitasi Pemberian Tanda Kehormatan Satyalancana Karya Satya","pendidikan":"D4/S1","pekerjaan":"ASN (PNS/PPPK)","kritik":"Mohon agar kapasitas ukuran unggah untuk kelengkapan berkas yang digabung menjadi satu file pada persyaratan  DRH dapat ditambahkan. Saat ini batas ukuran unggah yang hanya sebesar 1 MB menyebabkan file hasil kompresi sering kali harus diperkecil secara berlebihan, sehingga kualitas dokumen menurun atau file menjadi tidak optimal. Selain itu, dokumen yang sebelumnya dapat dengan mudah diunduh dari SIMASN dan digabungkan dalam satu file sering kali tidak dapat langsung diunggah karena ukuran file melebihi batas yang ditentukan. Peningkatan kapasitas unggah diharapkan dapat mempermudah proses pengajuan dan menjaga kualitas dokumen yang diunggah.","nama":"-","email":"-","telp":"-","trustPusat":8,"trustDaerah":7,"u":[4,4,3,3,3,3.5,4,4,4],"ipak":[4,4,4,4,4]}]`;

/* ============================================================================
   Data contoh awal: hasil SKM Online untuk layanan "Fasilitasi Pemberian Tanda
   Kehormatan Satyalancana Karya Satya" (10 responden). Diganti otomatis
   begitu Anda mengunggah data periode berjalan.
   ============================================================================ */
function loadDefaultDataset() {
  const respondents = JSON.parse(DEFAULT_RESPONDENTS_RAW);
  return buildDataset(respondents);
}

/* ============================================================================
   Persistensi lokal (localStorage) — supaya data hasil unggah TIDAK hilang
   saat halaman di-refresh. Ini situs statis mandiri (bukan artifact Claude),
   jadi localStorage aman & tepat dipakai di sini.
   CATATAN: penyimpanan ini per-browser/per-perangkat, bukan database bersama
   — kalau dibuka dari komputer/browser lain, yang tampil tetap data terakhir
   yang diunggah DI PERANGKAT ITU (atau data contoh kalau belum pernah upload).
   ============================================================================ */
const STORAGE_KEY = "skm-dashboard-bkd:v1";

function saveToStorage(dataset, meta) {
  try {
    const payload = { dataset, meta: { ...meta, uploadedAt: meta.uploadedAt ? meta.uploadedAt.toISOString() : null } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    // localStorage penuh/tidak tersedia (mis. mode private browsing) — abaikan,
    // dashboard tetap jalan normal, hanya tidak persist antar-refresh.
    console.warn("Gagal menyimpan data ke localStorage:", err);
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.dataset?.respondents?.length) return null;
    return { dataset: parsed.dataset, meta: { ...parsed.meta, uploadedAt: parsed.meta.uploadedAt ? new Date(parsed.meta.uploadedAt) : null } };
  } catch (err) {
    return null;
  }
}

function clearStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* abaikan */ }
}

// Dibaca sekali saat modul dimuat (saat halaman dibuka/refresh)
const PERSISTED = typeof window !== "undefined" ? loadFromStorage() : null;

const TONE_COLORS = { great: "#2F6D4F", good: "#3D8361", warn: "#C58A2E", bad: "#B3432B", muted: "#8A8D85" };

function MutuBadge({ mutu }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 4,
      fontSize: 12.5, fontWeight: 600, color: TONE_COLORS[mutu.tone], background: `${TONE_COLORS[mutu.tone]}1A`,
      border: `1px solid ${TONE_COLORS[mutu.tone]}55`,
    }}>
      {mutu.code !== "-" && <span>{mutu.code}</span>}
      {mutu.label}
    </span>
  );
}

function KpiCard({ label, value, sub, accent, icon: Icon }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E3E1D8", borderLeft: `3px solid ${accent}`, borderRadius: 6, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#6B6E64", fontSize: 12.5, fontWeight: 600, letterSpacing: 0.2 }}>
        {Icon && <Icon size={14} strokeWidth={2} />}
        {label}
      </div>
      <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 30, fontWeight: 600, color: "#1B1D18", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: "#8A8D85" }}>{sub}</div>}
    </div>
  );
}

function UnsurChart({ uAvg }) {
  const data = UNSUR_LABELS.map((label, i) => ({ label: `U${i + 1}`, full: label, nilai: +uAvg[i].toFixed(2) }));
  const weakest = Math.min(...uAvg);
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#EAE8DF" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6B6E64" }} axisLine={{ stroke: "#D8D6CB" }} tickLine={false} />
        <YAxis domain={[0, 4]} tick={{ fontSize: 12, fill: "#6B6E64" }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v) => [v, "Rata-rata (skala 1–4)"]} labelFormatter={(l, p) => p?.[0]?.payload?.full || l} contentStyle={{ borderRadius: 6, border: "1px solid #E3E1D8", fontSize: 13 }} />
        <Bar dataKey="nilai" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.nilai === +weakest.toFixed(2) ? "#B3432B" : "#2F6D4F"} />)}
          <LabelList dataKey="nilai" position="top" style={{ fontSize: 11, fill: "#4A4C45" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function LayananBarChart({ perLayanan }) {
  const data = perLayanan.map((d) => ({ name: d.layanan, ikm: +d.ikm.toFixed(1), tone: d.mutu.tone }));
  const height = Math.max(280, data.length * 26);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#EAE8DF" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "#6B6E64" }} axisLine={{ stroke: "#D8D6CB" }} tickLine={false} />
        <YAxis type="category" dataKey="name" width={230} tick={{ fontSize: 11.5, fill: "#3A3C36" }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v) => [v, "Nilai IKM"]} contentStyle={{ borderRadius: 6, border: "1px solid #E3E1D8", fontSize: 13 }} />
        <Bar dataKey="ikm" radius={[0, 3, 3, 0]}>
          {data.map((d, i) => <Cell key={i} fill={TONE_COLORS[d.tone]} />)}
          <LabelList dataKey="ikm" position="right" style={{ fontSize: 11, fill: "#4A4C45" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DemografiChart({ title, data }) {
  if (!data) return null;
  const rows = data.slice(0, 8);
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#3A3C36", marginBottom: 10 }}>{title}</div>
      <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 30)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 30, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#EAE8DF" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#6B6E64" }} axisLine={{ stroke: "#D8D6CB" }} tickLine={false} />
          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11.5, fill: "#3A3C36" }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ borderRadius: 6, border: "1px solid #E3E1D8", fontSize: 13 }} />
          <Bar dataKey="value" fill="#4A6FA5" radius={[0, 3, 3, 0]}>
            <LabelList dataKey="value" position="right" style={{ fontSize: 11, fill: "#4A4C45" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function readFileAsWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try { resolve(XLSX.read(e.target.result, { type: "array", cellDates: false })); }
      catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error("Gagal membaca file."));
    reader.readAsArrayBuffer(file);
  });
}

export default function SkmDashboard() {
  const cloudMode = isCloudConfigured();
  const [dataset, setDataset] = useState(() => PERSISTED?.dataset || loadDefaultDataset());
  const [meta, setMeta] = useState(() => PERSISTED?.meta || { label: "Data contoh — SKM Online", uploadedAt: null, files: [] });
  const [busy, setBusy] = useState(false);
  const [showPII, setShowPII] = useState(false);
  const [filterLayanan, setFilterLayanan] = useState("");
  const [search, setSearch] = useState("");
  const [fileDetailsOpen, setFileDetailsOpen] = useState(false); // rincian per-file: ringkas by default
  const [uploadPanelDismissed, setUploadPanelDismissed] = useState(false);
  const [cloudUser, setCloudUser] = useState(null);
  const [cloudSynced, setCloudSynced] = useState(false); // sudah pernah terima snapshot pertama dari Firestore?
  const [cloudError, setCloudError] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [viewingHistory, setViewingHistory] = useState(null); // { id, dataset, meta } saat sedang lihat arsip lama, null = tampilan live

  // --- Mode cloud: berlangganan data real-time dari Firestore ---
  // Begitu window.FIREBASE_CONFIG terisi valid (lihat firebase-config.js),
  // dashboard ini otomatis menampilkan data yang SAMA ke semua orang yang
  // membuka situsnya, di perangkat mana pun, dan update begitu ada yang
  // mengunggah data baru — tanpa perlu refresh manual.
  useEffect(() => {
    if (!cloudMode) return;
    const unsubData = subscribeCloudData((data, err) => {
      if (err) { setCloudError("Gagal tersambung ke server real-time. Menampilkan data lokal terakhir."); return; }
      setCloudError(null);
      if (data) {
        setDataset(data.dataset);
        setMeta({ ...data.meta, uploadedAt: data.meta.uploadedAt ? new Date(data.meta.uploadedAt) : null });
      }
      setCloudSynced(true);
    });
    const unsubAuth = subscribeAuth((u) => { setCloudUser(u); if (!u) setShowPII(false); });
    return () => { unsubData(); unsubAuth(); };
  }, [cloudMode]);

  const handleSignIn = useCallback(async () => {
    try { await signInWithGoogle(); } catch (err) { setCloudError("Gagal masuk dengan Google: " + err.message); }
  }, []);
  const handleSignOut = useCallback(async () => {
    try { await signOutCloud(); setShowPII(false); } catch (err) { /* abaikan */ }
  }, []);

  // PENTING: setiap kali fungsi ini dipanggil, dataset LAMA (baik data bawaan
  // maupun hasil upload sebelumnya) TIDAK ikut dibawa — allRespondents selalu
  // mulai dari array kosong dan dataset diganti total lewat setDataset(ds).
  // Jadi upload periode baru MENGGANTI, bukan MENUMPUK, data sebelumnya.
  // Di mode cloud, hasilnya juga didorong ke Firestore agar semua orang
  // yang sedang membuka dashboard melihat perubahan secara real-time.
  const handleFiles = useCallback(async (fileList) => {
    if (cloudMode && !cloudUser) { setCloudError("Anda harus masuk dengan Google dulu sebelum mengunggah data."); return; }
    setBusy(true);
    setCloudError(null);
    const files = Array.from(fileList);
    const results = [];
    let allRespondents = []; // <- selalu direset, tidak digabung dengan dataset sebelumnya
    const unclassifiedAll = new Set();
    for (const file of files) {
      try {
        const wb = await readFileAsWorkbook(file);
        const parsed = parseHasilSurveyFile(wb, file.name);
        allRespondents = allRespondents.concat(parsed.respondents);
        parsed.unclassified.forEach((u) => unclassifiedAll.add(u));
        results.push({ file: file.name, layanan: parsed.layanan, n: parsed.respondents.length, ok: true, unclassified: parsed.unclassified });
      } catch (err) {
        results.push({ file: file.name, ok: false, error: err.message || "Gagal diproses." });
      }
    }
    let ds = null;
    if (allRespondents.length) {
      try {
        ds = buildDataset(allRespondents); // <- dataset lama ditimpa total di sini
      } catch (err) {
        results.push({ file: "(gabungan)", ok: false, error: err.message });
        ds = null;
      }
    } else {
      results.push({ file: "(semua file)", ok: false, error: "Tidak ada responden valid terbaca — dataset yang tampil TIDAK diubah." });
    }
    const newMeta = { label: `${files.length} file diunggah`, uploadedAt: new Date(), files: results };
    if (ds) {
      if (cloudMode) {
        try {
          await writeCloudData(ds, newMeta, `Unggah ${files.length} file`); // <- didorong real-time + tercatat di riwayat
          // setDataset/setMeta akan terisi otomatis lewat onSnapshot di atas
        } catch (err) {
          setCloudError("Gagal menyimpan ke server: " + err.message);
        }
      } else {
        setDataset(ds);
        setMeta(newMeta);
        setFilterLayanan("");
        saveToStorage(ds, newMeta); // <- mode lokal: persist di browser ini saja
      }
    } else {
      setMeta((m) => ({ ...m, files: results })); // tampilkan info error tanpa mengubah dataset
    }
    // Ringkas otomatis kalau semua file mulus; buka otomatis kalau ada yang perlu diperhatikan.
    const hasIssues = results.some((r) => !r.ok) || unclassifiedAll.size > 0;
    setFileDetailsOpen(hasIssues);
    setUploadPanelDismissed(false);
    setBusy(false);
  }, [cloudMode, cloudUser]);

  const handleReset = useCallback(async () => {
    if (cloudMode && !cloudUser) { setCloudError("Anda harus masuk dengan Google dulu sebelum mereset data."); return; }
    const def = loadDefaultDataset();
    const defMeta = { label: "Data contoh — SKM Online", uploadedAt: null, files: [] };
    if (cloudMode) {
      try { await writeCloudData(def, defMeta, "Reset ke data contoh"); } catch (err) { setCloudError("Gagal mereset di server: " + err.message); }
    } else {
      setDataset(def);
      setMeta(defMeta);
      clearStorage(); // <- hapus data tersimpan juga, supaya refresh berikutnya tetap kembali ke data contoh
    }
    setFilterLayanan("");
    setFileDetailsOpen(false);
    setUploadPanelDismissed(false);
  }, [cloudMode, cloudUser]);

  // --- Riwayat / arsip per periode ---
  const handleOpenHistory = useCallback(async () => {
    setHistoryOpen((s) => !s);
    if (!historyOpen && historyList.length === 0) {
      setHistoryLoading(true);
      try {
        const list = await listCloudHistory(20);
        setHistoryList(list);
      } catch (err) {
        setCloudError("Gagal memuat riwayat: " + err.message);
      }
      setHistoryLoading(false);
    }
  }, [historyOpen, historyList.length]);

  const handleViewHistoryEntry = useCallback((entry) => {
    setViewingHistory({
      id: entry.id,
      dataset: entry.dataset,
      meta: { ...entry.meta, uploadedAt: entry.meta.uploadedAt ? new Date(entry.meta.uploadedAt) : null },
      actionLabel: entry.actionLabel,
      updatedByEmail: entry.updatedByEmail,
      updatedAt: entry.updatedAt,
    });
    setHistoryOpen(false);
  }, []);

  const handleBackToLive = useCallback(() => setViewingHistory(null), []);

  // Saat melihat arsip lama, tampilkan data arsip itu; kalau tidak, tampilkan data live.
  const displayDataset = viewingHistory ? viewingHistory.dataset : dataset;
  const displayMeta = viewingHistory ? viewingHistory.meta : meta;

  const filteredKritik = useMemo(() => displayDataset.kritikList.filter((k) => {
    if (filterLayanan && k.layanan !== filterLayanan) return false;
    if (search && !k.teks.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [displayDataset, filterLayanan, search]);

  const trendUnsur = useMemo(() => {
    const idxMin = displayDataset.overall.uAvg.indexOf(Math.min(...displayDataset.overall.uAvg));
    const idxMax = displayDataset.overall.uAvg.indexOf(Math.max(...displayDataset.overall.uAvg));
    return { weakest: UNSUR_LABELS[idxMin], weakestVal: displayDataset.overall.uAvg[idxMin], strongest: UNSUR_LABELS[idxMax], strongestVal: displayDataset.overall.uAvg[idxMax] };
  }, [displayDataset]);

  const failedFiles = meta.files.filter((f) => !f.ok);
  const okFiles = meta.files.filter((f) => f.ok);
  const allUnclassified = Array.from(new Set(okFiles.flatMap((f) => f.unclassified || [])));

  return (
    <div style={{ fontFamily: "'IBM Plex Sans', -apple-system, sans-serif", background: "#F5F4EF", minHeight: "100%", color: "#1B1D18", padding: "0 0 40px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        table { border-collapse: collapse; width: 100%; }
        th, td { text-align: left; padding: 9px 12px; font-size: 13px; }
        th { font-weight: 600; color: #6B6E64; border-bottom: 1px solid #E3E1D8; font-size: 12px; letter-spacing: 0.2px; }
        tbody tr { border-bottom: 1px solid #EFEEE7; }
        tbody tr:hover { background: #FAF9F5; }
        ::placeholder { color: #A8AA9F; }
      `}</style>

      {/* Header */}
      <div style={{ background: "#14213D", color: "#fff", padding: "22px 28px" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 12, letterSpacing: 0.4, color: "#C99A2E", fontWeight: 600 }}>BADAN KEPEGAWAIAN DAERAH</span>
              {cloudMode ? (
                <span title={cloudSynced ? "Tersambung real-time — data sama di semua perangkat" : "Menyambungkan…"} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 600, color: cloudSynced ? "#7FD8A0" : "#B7BDCC", background: "rgba(255,255,255,0.08)", padding: "2px 7px", borderRadius: 999 }}>
                  <Cloud size={11} /> {cloudSynced ? "Real-time" : "Menyambungkan…"}
                </span>
              ) : (
                <span title="Mode lokal — data hanya tersimpan di browser ini (belum terhubung Firestore)" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 600, color: "#B7BDCC", background: "rgba(255,255,255,0.08)", padding: "2px 7px", borderRadius: 999 }}>
                  <CloudOff size={11} /> Mode lokal
                </span>
              )}
            </div>
            <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 24, fontWeight: 600, margin: 0 }}>Dashboard Survei Kepuasan Masyarakat</h1>
            <div style={{ fontSize: 13, color: "#B7BDCC", marginTop: 3 }}>
              {displayDataset.overall.n} responden · {displayDataset.perLayanan.length} jenis layanan · {displayMeta.label}
              {displayMeta.uploadedAt && ` · ${displayMeta.uploadedAt.toLocaleString("id-ID")}`}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            {cloudMode && (
              <div>
                {cloudUser ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#B7BDCC" }}>
                    Masuk sebagai <b style={{ color: "#fff" }}>{cloudUser.email}</b>
                    <button onClick={handleSignOut} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "1px solid #34406B", color: "#B7BDCC", padding: "4px 8px", borderRadius: 4, fontSize: 11.5, cursor: "pointer" }}>
                      <LogOut size={12} /> Keluar
                    </button>
                  </div>
                ) : (
                  <button onClick={handleSignIn} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: "#14213D", border: "none", padding: "6px 12px", borderRadius: 4, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                    <LogIn size={13} /> Masuk dengan Google untuk mengunggah
                  </button>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#1F2E52", border: "1px solid #34406B", color: "#fff", padding: "9px 16px", borderRadius: 5, fontSize: 13.5, fontWeight: 500, cursor: busy || (cloudMode && !cloudUser) || viewingHistory ? "not-allowed" : "pointer", opacity: busy || (cloudMode && !cloudUser) || viewingHistory ? 0.5 : 1 }}>
                <Upload size={15} />
                {busy ? "Memproses…" : viewingHistory ? "Kembali ke live untuk mengunggah" : "Unggah data periode baru (banyak file .xlsx)"}
                <input
                  type="file" accept=".xlsx,.xls" multiple disabled={busy || (cloudMode && !cloudUser) || !!viewingHistory} style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files.length) handleFiles(e.target.files);
                    e.target.value = ""; // reset supaya file/set file yang sama bisa dipilih ulang & tetap memicu penggantian data
                  }}
                />
              </label>
              {meta.uploadedAt && (
                <button onClick={handleReset} disabled={busy || (cloudMode && !cloudUser)} title="Kembali ke data contoh SKM Online" style={{ background: "transparent", border: "1px solid #34406B", color: "#B7BDCC", padding: "9px 14px", borderRadius: 5, fontSize: 13, cursor: busy || (cloudMode && !cloudUser) ? "not-allowed" : "pointer", opacity: busy || (cloudMode && !cloudUser) ? 0.5 : 1 }}>
                  Reset ke data contoh
                </button>
              )}
              {cloudMode && (
                <button onClick={handleOpenHistory} title="Lihat arsip data periode-periode sebelumnya" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid #34406B", color: "#B7BDCC", padding: "9px 14px", borderRadius: 5, fontSize: 13, cursor: "pointer" }}>
                  <History size={14} /> Riwayat
                </button>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: "#8891A8", textAlign: "right" }}>
              Setiap unggahan baru <b>mengganti seluruh</b> data yang sedang tampil, bukan menambah.
              {cloudMode ? " Tersinkron real-time ke semua perangkat." : meta.uploadedAt && " Tersimpan otomatis di browser ini — akan tetap ada meski di-refresh."}
            </div>
          </div>
        </div>
        {cloudError && (
          <div style={{ maxWidth: 1180, margin: "10px auto 0", padding: "8px 12px", background: "rgba(179,67,43,0.2)", border: "1px solid rgba(179,67,43,0.5)", borderRadius: 5, fontSize: 12.5, color: "#FFD7CC" }}>
            {cloudError}
          </div>
        )}
        {historyOpen && (
          <div style={{ maxWidth: 1180, margin: "10px auto 0" }}>
            <div style={{ background: "#1F2E52", border: "1px solid #34406B", borderRadius: 6, padding: "12px 16px", maxHeight: 320, overflowY: "auto" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", marginBottom: 8 }}>Riwayat unggahan (20 terakhir)</div>
              {historyLoading && <div style={{ fontSize: 12.5, color: "#B7BDCC" }}>Memuat…</div>}
              {!historyLoading && historyList.length === 0 && <div style={{ fontSize: 12.5, color: "#B7BDCC" }}>Belum ada riwayat.</div>}
              <div style={{ display: "grid", gap: 4 }}>
                {historyList.map((h) => (
                  <button key={h.id} onClick={() => handleViewHistoryEntry(h)} style={{ display: "flex", justifyContent: "space-between", gap: 12, textAlign: "left", background: "rgba(255,255,255,0.05)", border: "none", borderRadius: 4, padding: "8px 10px", cursor: "pointer", color: "#fff" }}>
                    <span style={{ fontSize: 12.5 }}>
                      <b>{h.actionLabel || h.meta?.label}</b>
                      <span style={{ color: "#B7BDCC" }}> · {h.dataset?.overall?.n ?? "?"} responden · IKM {h.dataset?.overall?.ikm?.toFixed(1) ?? "-"}</span>
                    </span>
                    <span style={{ fontSize: 11.5, color: "#8891A8", whiteSpace: "nowrap" }}>
                      {h.updatedByEmail || "-"} · {h.updatedAt?.toDate ? h.updatedAt.toDate().toLocaleString("id-ID") : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {viewingHistory && (
        <div style={{ background: "#FFF6E0", borderBottom: "1px solid #E8D8A8", padding: "10px 28px", display: "flex", justifyContent: "center", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "#7A5B12" }}>
            📁 Melihat arsip: <b>{viewingHistory.actionLabel || viewingHistory.meta.label}</b> — diunggah {viewingHistory.updatedAt?.toDate ? viewingHistory.updatedAt.toDate().toLocaleString("id-ID") : ""} oleh {viewingHistory.updatedByEmail || "-"}. Ini <b>bukan</b> tampilan live.
          </span>
          <button onClick={handleBackToLive} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#7A5B12", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 5, fontSize: 12.5, cursor: "pointer" }}>
            <ArrowLeftCircle size={13} /> Kembali ke tampilan live
          </button>
        </div>
      )}

      {/* Ringkasan hasil unggah — ringkas default, bisa dibuka untuk rincian per file */}
      {meta.files.length > 0 && !uploadPanelDismissed && (
        <div style={{ maxWidth: 1180, margin: "16px auto 0", padding: "0 28px" }}>
          <div style={{ background: "#fff", border: "1px solid #E3E1D8", borderRadius: 6, padding: "12px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <button
                onClick={() => setFileDetailsOpen((s) => !s)}
                style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#1B1D18" }}
              >
                <FileCheck2 size={15} color="#2F6D4F" />
                {okFiles.length} file berhasil diproses
                {failedFiles.length > 0 && <span style={{ color: "#B3432B" }}>· {failedFiles.length} gagal</span>}
                {allUnclassified.length > 0 && <span style={{ color: "#C58A2E" }}>· {allUnclassified.length} kolom tak dikenali</span>}
                {fileDetailsOpen ? <ChevronUp size={15} color="#9A9C92" /> : <ChevronDown size={15} color="#9A9C92" />}
              </button>
              <button onClick={() => setUploadPanelDismissed(true)} title="Tutup ringkasan ini" style={{ background: "none", border: "none", cursor: "pointer", color: "#9A9C92", padding: 4 }}>
                <X size={15} />
              </button>
            </div>

            {fileDetailsOpen && (
              <div style={{ display: "grid", gap: 6, marginTop: 12, paddingTop: 12, borderTop: "1px solid #EFEEE7" }}>
                {meta.files.map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, color: f.ok ? "#3A3C36" : "#B3432B" }}>
                    {f.ok ? <FileCheck2 size={13} style={{ flexShrink: 0 }} /> : <FileX2 size={13} style={{ flexShrink: 0 }} />}
                    <span style={{ fontWeight: 500 }}>{f.file}</span>
                    {f.ok ? <span style={{ color: "#8A8D85" }}>→ {f.layanan} ({f.n} responden)</span> : <span>{f.error}</span>}
                  </div>
                ))}
              </div>
            )}

            {allUnclassified.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #EFEEE7", fontSize: 12, color: "#C58A2E", display: "flex", gap: 8 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>Ada {allUnclassified.length} kolom pertanyaan yang tidak dikenali sistem (tidak cocok dengan 9 unsur IKM / 5 unsur IPAK resmi), jadi diabaikan dari perhitungan: {allUnclassified.slice(0, 3).join("; ")}{allUnclassified.length > 3 ? ", …" : ""}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 28px 0" }}>
        {/* KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 24 }}>
          <KpiCard label="Nilai IKM Keseluruhan" value={displayDataset.overall.ikm.toFixed(2)} sub={<MutuBadge mutu={displayDataset.overall.mutu} />} accent={TONE_COLORS[displayDataset.overall.mutu.tone]} icon={CheckCircle2} />
          <KpiCard label="Jumlah Responden" value={displayDataset.overall.n} sub="periode berjalan" accent="#4A6FA5" icon={Users} />
          <KpiCard label="Unsur Terlemah" value={`U${UNSUR_LABELS.indexOf(trendUnsur.weakest) + 1}`} sub={`${trendUnsur.weakest} (${trendUnsur.weakestVal.toFixed(2)})`} accent="#B3432B" icon={TrendingDown} />
          <KpiCard label="Unsur Terkuat" value={`U${UNSUR_LABELS.indexOf(trendUnsur.strongest) + 1}`} sub={`${trendUnsur.strongest} (${trendUnsur.strongestVal.toFixed(2)})`} accent="#2F6D4F" icon={TrendingUp} />
          {displayDataset.ipak.score != null && (
            <KpiCard label="Indeks Persepsi Anti Korupsi" value={displayDataset.ipak.score.toFixed(2)} sub={`skala 1–4 · ${displayDataset.ipak.n} responden`} accent="#6B4FA0" icon={ShieldCheck} />
          )}
        </div>

        {/* Unsur + Layanan charts */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, marginBottom: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #E3E1D8", borderRadius: 6, padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 600 }}>Nilai Rata-rata per Unsur Pelayanan</div>
              <div style={{ fontSize: 12, color: "#8A8D85" }}>skala 1–4, 9 unsur Permenpan RB 14/2017</div>
            </div>
            <UnsurChart uAvg={displayDataset.overall.uAvg} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginTop: 6, fontSize: 12, color: "#6B6E64" }}>
              {UNSUR_LABELS.map((l, i) => <span key={i}><b>U{i + 1}</b> {l}</span>)}
            </div>
          </div>

          <div style={{ background: "#fff", border: "1px solid #E3E1D8", borderRadius: 6, padding: "18px 20px" }}>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 600, marginBottom: 14 }}>Nilai IKM per Jenis Layanan</div>
            <LayananBarChart perLayanan={displayDataset.perLayanan} />
          </div>
        </div>

        {/* Table per layanan */}
        <div style={{ background: "#fff", border: "1px solid #E3E1D8", borderRadius: 6, padding: "18px 20px", marginBottom: 16, overflowX: "auto" }}>
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 600, marginBottom: 14 }}>Rincian per Layanan</div>
          <table>
            <thead><tr><th>Jenis Layanan</th><th>Responden</th><th>NRR</th><th>Nilai IKM</th><th>Mutu</th>{displayDataset.ipak.avg && <th>IPAK</th>}</tr></thead>
            <tbody>
              {displayDataset.perLayanan.map((d) => (
                <tr key={d.layanan}>
                  <td>{d.layanan}</td>
                  <td>{d.n}</td>
                  <td>{d.nrr.toFixed(2)}</td>
                  <td style={{ fontWeight: 600 }}>{d.ikm.toFixed(2)}</td>
                  <td><MutuBadge mutu={d.mutu} /></td>
                  {displayDataset.ipak.avg && <td>{d.ipakAvg != null ? d.ipakAvg.toFixed(2) : "-"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Demografi + Mutu table */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #E3E1D8", borderRadius: 6, padding: "18px 20px" }}>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 600, marginBottom: 14 }}>Profil Responden</div>
            <div style={{ display: "grid", gap: 20 }}>
              <DemografiChart title="Pendidikan terakhir" data={displayDataset.demografi.pendidikan} />
              <DemografiChart title="Pekerjaan" data={displayDataset.demografi.pekerjaan} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16, padding: "10px 12px", background: "#F5F4EF", borderRadius: 5, fontSize: 12, color: "#6B6E64" }}>
              <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Jenis kelamin tidak ditampilkan — kolom ini tidak tersedia pada data mentah SKM Online.</span>
            </div>
          </div>

          <div style={{ background: "#fff", border: "1px solid #E3E1D8", borderRadius: 6, padding: "18px 20px" }}>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 600, marginBottom: 14 }}>Kategori Mutu Pelayanan</div>
            <table>
              <thead><tr><th>Kode</th><th>Interval IKM</th><th>Kinerja</th></tr></thead>
              <tbody>
                {MUTU_TABLE.map((m) => (
                  <tr key={m.code} style={{ background: displayDataset.overall.mutu.code === m.code ? "#F5F4EF" : "transparent" }}>
                    <td style={{ fontWeight: 700, color: TONE_COLORS[m.tone] }}>{m.code}</td>
                    <td>{m.min.toFixed(2)} – {m.max.toFixed(2)}</td>
                    <td>{m.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {displayDataset.trust.pusat != null && (
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #EFEEE7" }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Tingkat Kepercayaan (skala 1–10)</div>
                <div style={{ display: "flex", gap: 24, fontSize: 13 }}>
                  <div>Pemerintah Pusat <b style={{ fontSize: 16 }}>{displayDataset.trust.pusat.toFixed(1)}</b></div>
                  <div>Pemerintah Daerah <b style={{ fontSize: 16 }}>{displayDataset.trust.daerah.toFixed(1)}</b></div>
                </div>
              </div>
            )}
            {displayDataset.ipak.avg && (
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #EFEEE7" }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Indeks Persepsi Anti Korupsi (skala 1–4)</div>
                <div style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
                  {IPAK_LABELS.map((l, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#6B6E64" }}>{l}</span><b>{displayDataset.ipak.avg[i].toFixed(2)}</b>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "#9A9C92", marginTop: 6 }}>Ditampilkan skala mentah 1–4 — belum ditemukan rumus konversi resmi IPAK ke skala 0–100 pada dokumen yang tersedia.</div>
              </div>
            )}
            <div style={{ marginTop: 16, fontSize: 11.5, color: "#9A9C92" }}>Sumber: Permenpan RB No. 14/2017 &amp; Paparan Konsolidasi SKM Online, 23 Juni 2026.</div>
          </div>
        </div>

        {/* Kritik & Saran */}
        <div style={{ background: "#fff", border: "1px solid #E3E1D8", borderRadius: 6, padding: "18px 20px", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 600 }}>Kritik &amp; Saran ({filteredKritik.length})</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ position: "relative" }}>
                <Search size={14} style={{ position: "absolute", left: 9, top: 9, color: "#9A9C92" }} />
                <input type="text" placeholder="Cari kata kunci…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: "7px 10px 7px 30px", border: "1px solid #D8D6CB", borderRadius: 5, fontSize: 13, width: 190 }} />
              </div>
              <select value={filterLayanan} onChange={(e) => setFilterLayanan(e.target.value)} style={{ padding: "7px 10px", border: "1px solid #D8D6CB", borderRadius: 5, fontSize: 13, background: "#fff" }}>
                <option value="">Semua layanan</option>
                {displayDataset.perLayanan.map((d) => <option key={d.layanan} value={d.layanan}>{d.layanan}</option>)}
              </select>
              {displayDataset.hasNama && (
                // Di mode cloud, tombol ini WAJIB login Google — mencegah pengunjung
                // publik (tanpa akun) melihat nama/email/telepon responden.
                // Di mode lokal (belum pakai Firebase), tetap bebas seperti semula
                // karena datanya memang hanya ada di browser milik orang itu sendiri.
                (!cloudMode || cloudUser) ? (
                  <button onClick={() => setShowPII((s) => !s)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid #D8D6CB", borderRadius: 5, fontSize: 13, background: showPII ? "#FBEAE5" : "#fff", color: showPII ? "#8A3620" : "#3A3C36", cursor: "pointer" }}>
                    {showPII ? <EyeOff size={14} /> : <Eye size={14} />}
                    {showPII ? "Sembunyikan nama" : "Tampilkan nama"}
                  </button>
                ) : (
                  <button onClick={handleSignIn} title="Data pribadi responden hanya bisa dilihat oleh staf yang sudah masuk" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid #D8D6CB", borderRadius: 5, fontSize: 13, background: "#fff", color: "#9A9C92", cursor: "pointer" }}>
                    <LogIn size={14} /> Masuk untuk lihat nama
                  </button>
                )
              )}
            </div>
          </div>
          <div style={{ maxHeight: 420, overflowY: "auto", display: "grid", gap: 10 }}>
            {filteredKritik.length === 0 && <div style={{ padding: "24px 0", textAlign: "center", color: "#9A9C92", fontSize: 13.5 }}>Tidak ada masukan yang cocok.</div>}
            {filteredKritik.map((k, i) => (
              <div key={i} style={{ padding: "10px 14px", background: "#FAF9F5", border: "1px solid #EFEEE7", borderRadius: 5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#4A6FA5" }}>{k.layanan}</span>
                  {displayDataset.hasNama && <span style={{ fontSize: 12, color: "#9A9C92" }}>{showPII ? (k.nama || "-") : maskName(k.nama)}</span>}
                </div>
                <div style={{ fontSize: 13.5, color: "#2B2D27", lineHeight: 1.5 }}>{k.teks}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 11.5, color: "#9A9C92", textAlign: "center", padding: "8px 0 0" }}>
          <ClipboardList size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
          IKM = Σ(rata-rata unsur × 0,11) × 25 — konvensi Kepmenpan 25/2004 pada template Permenpan RB 14/2017. Data pribadi responden disembunyikan secara default.
        </div>
      </div>
    </div>
  );
}
