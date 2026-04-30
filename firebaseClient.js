import { initializeApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  collection,
  query,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey
    && firebaseConfig.authDomain
    && firebaseConfig.projectId
    && firebaseConfig.appId,
  );
}

let app;
let auth;
let db;

function ensureInit() {
  if (!isFirebaseConfigured()) {
    return null;
  }
  if (!app) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  }
  return { auth, db };
}

export function subscribeAuth(callback) {
  const ctx = ensureInit();
  if (!ctx) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(ctx.auth, callback);
}

export async function signUpEmail(email, password) {
  const ctx = ensureInit();
  if (!ctx) throw new Error('Firebase is not configured');
  return createUserWithEmailAndPassword(ctx.auth, email, password);
}

export async function signInEmail(email, password) {
  const ctx = ensureInit();
  if (!ctx) throw new Error('Firebase is not configured');
  return signInWithEmailAndPassword(ctx.auth, email, password);
}

export async function signOutUser() {
  const ctx = ensureInit();
  if (!ctx) return;
  await signOut(ctx.auth);
}

function wishlistItemRef(firestore, uid, productId) {
  const safeId = String(productId || 'item').replace(/[/\s]/g, '_').slice(0, 200);
  return doc(firestore, 'users', uid, 'wishlist', safeId);
}

export function subscribeWishlistItems(uid, callback) {
  const ctx = ensureInit();
  if (!ctx || !uid) {
    callback([]);
    return () => {};
  }

  const wishCol = collection(ctx.db, 'users', uid, 'wishlist');
  const q = query(wishCol);

  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    callback(items);
  }, () => {
    callback([]);
  });
}

export async function saveWishlistItem(uid, payload) {
  const ctx = ensureInit();
  if (!ctx || !uid) throw new Error('Not signed in');
  const ref = wishlistItemRef(ctx.db, uid, payload.id);
  await setDoc(ref, {
    ...payload,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function removeWishlistItem(uid, productId) {
  const ctx = ensureInit();
  if (!ctx || !uid) return;
  const ref = wishlistItemRef(ctx.db, uid, productId);
  await deleteDoc(ref).catch(() => {});
}
