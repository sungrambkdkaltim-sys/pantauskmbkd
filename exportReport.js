import * as XLSX from "xlsx";
import { UNSUR_LABELS, maskName } from "./shared.js";

/* ============================================================================
   Ekspor laporan Excel (.xlsx) dari dataset yang sedang tampil di dashboard.
   Menghormati status "Tampilkan nama" saat ini — kalau nama sedang
   disembunyikan di layar, nama di file yang diunduh juga tetap disamarkan
   (supaya file yang dibagikan tidak diam-diam membocorkan PII yang sedang
   disembunyikan pengguna).
   ============================================================================ */
export function exportExcelReport(dataset, meta, { showPII = false, hasNama = false } = {}) {
  const wb = XLSX.utils.book_new();

  // --- Sheet 1: Ringkasan ---
  const ringkasan = [
    ["Dashboard Survei Kepuasan Masyarakat — BKD"],
    ["Periode / label", meta.label || "-"],
    ["Diunggah pada", meta.uploadedAt ? new Date(meta.uploadedAt).toLocaleString("id-ID") : "-"],
    ["Diunduh pada", new Date().toLocaleString("id-ID")],
    [],
    ["Nilai IKM Keseluruhan", +dataset.overall.ikm.toFixed(2)],
    ["Kategori Mutu", `${dataset.overall.mutu.code} — ${dataset.overall.mutu.label}`],
    ["Jumlah Responden", dataset.overall.n],
    ["Jumlah Jenis Layanan", dataset.perLayanan.length],
  ];
  if (dataset.ipak?.score != null) {
    ringkasan.push(["Indeks Persepsi Anti Korupsi (skala 1–4)", +dataset.ipak.score.toFixed(2)]);
  }
  if (dataset.trust?.pusat != null) {
    ringkasan.push(["Kepercayaan Pemerintah Pusat (skala 1–10)", +dataset.trust.pusat.toFixed(1)]);
    ringkasan.push(["Kepercayaan Pemerintah Daerah (skala 1–10)", +dataset.trust.daerah.toFixed(1)]);
  }
  const wsRingkasan = XLSX.utils.aoa_to_sheet(ringkasan);
  wsRingkasan["!cols"] = [{ wch: 34 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsRingkasan, "Ringkasan");

  // --- Sheet 2: Per Unsur ---
  const perUnsur = [["Kode", "Nama Unsur", "Rata-rata (skala 1–4)"]];
  UNSUR_LABELS.forEach((label, i) => perUnsur.push([`U${i + 1}`, label, +dataset.overall.uAvg[i].toFixed(2)]));
  const wsUnsur = XLSX.utils.aoa_to_sheet(perUnsur);
  wsUnsur["!cols"] = [{ wch: 6 }, { wch: 34 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsUnsur, "Per Unsur");

  // --- Sheet 3: Per Layanan ---
  const hasIpak = !!dataset.ipak?.avg;
  const header3 = ["Jenis Layanan", "Jumlah Responden", "NRR", "Nilai IKM", "Kategori Mutu"];
  if (hasIpak) header3.push("IPAK (skala 1–4)");
  const perLayanan = [header3];
  dataset.perLayanan.forEach((d) => {
    const row = [d.layanan, d.n, +d.nrr.toFixed(2), +d.ikm.toFixed(2), `${d.mutu.code} — ${d.mutu.label}`];
    if (hasIpak) row.push(d.ipakAvg != null ? +d.ipakAvg.toFixed(2) : "-");
    perLayanan.push(row);
  });
  const wsLayanan = XLSX.utils.aoa_to_sheet(perLayanan);
  wsLayanan["!cols"] = [{ wch: 46 }, { wch: 16 }, { wch: 8 }, { wch: 10 }, { wch: 16 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsLayanan, "Per Layanan");

  // --- Sheet 4: Demografi ---
  const demografi = [];
  if (dataset.demografi.pendidikan) {
    demografi.push(["Pendidikan Terakhir"]);
    demografi.push(["Kategori", "Jumlah"]);
    dataset.demografi.pendidikan.forEach((d) => demografi.push([d.name, d.value]));
    demografi.push([]);
  }
  if (dataset.demografi.pekerjaan) {
    demografi.push(["Pekerjaan"]);
    demografi.push(["Kategori", "Jumlah"]);
    dataset.demografi.pekerjaan.forEach((d) => demografi.push([d.name, d.value]));
  }
  if (demografi.length) {
    const wsDemo = XLSX.utils.aoa_to_sheet(demografi);
    wsDemo["!cols"] = [{ wch: 30 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsDemo, "Demografi");
  }

  // --- Sheet 5: Kritik & Saran (nama ikut status "Tampilkan nama" saat ini) ---
  const kritik = [["Jenis Layanan", "Nama Responden", "Kritik / Saran"]];
  dataset.kritikList.forEach((k) => {
    const nama = hasNama ? (showPII ? (k.nama || "-") : maskName(k.nama)) : "-";
    kritik.push([k.layanan, nama, k.teks]);
  });
  const wsKritik = XLSX.utils.aoa_to_sheet(kritik);
  wsKritik["!cols"] = [{ wch: 40 }, { wch: 20 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsKritik, "Kritik dan Saran");

  const tanggal = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Laporan-SKM-${tanggal}.xlsx`);
}
