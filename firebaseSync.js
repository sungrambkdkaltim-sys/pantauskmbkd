import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";

/* ============================================================================
   Integrasi Firebase (opsional). Situs ini TETAP JALAN NORMAL tanpa Firebase
   (fallback ke localStorage per-browser seperti sebelumnya) kalau
   window.FIREBASE_CONFIG belum diisi — lihat firebase-config.js di root.

   Kalau window.FIREBASE_CONFIG terisi valid, dashboard otomatis:
   - Menampilkan data yang sama secara real-time ke semua orang yang buka
     situs ini (lewat Firestore onSnapshot), di perangkat mana pun.
   - Mewajibkan login Google sebelum bisa mengunggah/reset data (supaya
     data resmi tidak bisa diubah sembarang orang), sesuai Firestore
     Security Rules yang disertakan di README.
   ============================================================================ */

const DOC_PATH = ["skmDashboard", "current"]; // koleksi "skmDashboard", 1 dokumen "current"

let app = null;
let db = null;
let auth = null;

export function isCloudConfigured() {
  const cfg = typeof window !== "undefined" ? window.FIREBASE_CONFIG : null;
  return !!(cfg && cfg.apiKey && cfg.projectId && cfg.apiKey !== "GANTI_DENGAN_API_KEY_ANDA");
}

function ensureInit() {
  if (app) return;
  app = initializeApp(window.FIREBASE_CONFIG);
  db = getFirestore(app);
  auth = getAuth(app);
}

/* Berlangganan perubahan data real-time. Memanggil callback(null) kalau
   dokumen belum pernah ada (situs baru pertama kali dipakai). */
export function subscribeCloudData(callback) {
  if (!isCloudConfigured()) return () => {};
  ensureInit();
  const ref = doc(db, ...DOC_PATH);
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? snap.data() : null),
    (err) => {
      console.error("Gagal sinkron dari Firestore:", err);
      callback(null, err);
    }
  );
}

/* Tulis dataset+meta baru ke Firestore — otomatis terdorong real-time ke
   semua orang yang sedang membuka dashboard ini di perangkat mana pun. */
export async function writeCloudData(dataset, meta) {
  ensureInit();
  const ref = doc(db, ...DOC_PATH);
  await setDoc(ref, {
    dataset,
    meta: { ...meta, uploadedAt: meta.uploadedAt ? meta.uploadedAt.toISOString() : null },
    updatedAt: serverTimestamp(),
    updatedByEmail: auth.currentUser ? auth.currentUser.email : null,
  });
}

export function subscribeAuth(callback) {
  if (!isCloudConfigured()) return () => {};
  ensureInit();
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle() {
  ensureInit();
  await signInWithPopup(auth, new GoogleAuthProvider());
}

export async function signOutCloud() {
  ensureInit();
  await signOut(auth);
}
