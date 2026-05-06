import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAOq-ucyKVgebl9dmBLHDXSL47rUIKjcUA",
  authDomain: "financas-9e802.firebaseapp.com",
  projectId: "financas-9e802",
  storageBucket: "financas-9e802.firebasestorage.app",
  messagingSenderId: "1010572219115",
  appId: "1:1010572219115:web:b5b8b6a68e05731b3b64ae"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
const provider = new GoogleAuthProvider();

export function observarLogin(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function entrarComGoogle() {
  return signInWithPopup(auth, provider);
}

export async function sairDoGoogle() {
  return signOut(auth);
}

function novoId(prefix = "grp") {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function codigoConvite() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "FIN-";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function garantirWorkspace(user) {
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists() && userSnap.data().currentWorkspaceId) {
    return userSnap.data().currentWorkspaceId;
  }

  const workspaceId = novoId("finance");
  await setDoc(doc(db, "financeGroups", workspaceId), {
    name: "Meu controle financeiro",
    ownerUid: user.uid,
    members: { [user.uid]: true },
    memberEmails: { [user.uid]: user.email || "" },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await setDoc(userRef, {
    uid: user.uid,
    name: user.displayName || "",
    email: user.email || "",
    photoURL: user.photoURL || "",
    currentWorkspaceId: workspaceId,
    updatedAt: serverTimestamp()
  }, { merge: true });

  return workspaceId;
}

export async function carregarDadosWorkspace(workspaceId) {
  const snap = await getDoc(doc(db, "financeGroups", workspaceId, "app", "state"));
  if (!snap.exists()) return null;
  return snap.data().state || null;
}

export async function salvarDadosWorkspace(workspaceId, state) {
  if (!workspaceId) return;
  await setDoc(doc(db, "financeGroups", workspaceId, "app", "state"), {
    state,
    updatedAt: serverTimestamp()
  }, { merge: true });
  await setDoc(doc(db, "financeGroups", workspaceId), { updatedAt: serverTimestamp() }, { merge: true });
}

export async function criarConvite(workspaceId, user) {
  const code = codigoConvite();
  await setDoc(doc(db, "invites", code), {
    code,
    workspaceId,
    createdBy: user.uid,
    createdByEmail: user.email || "",
    createdAt: serverTimestamp(),
    active: true
  });
  await setDoc(doc(db, "financeGroups", workspaceId), {
    lastInviteCode: code,
    updatedAt: serverTimestamp()
  }, { merge: true });
  return code;
}

export function extrairCodigoConvite(texto) {
  const raw = String(texto || "").trim().toUpperCase();
  const found = raw.match(/FIN-[A-Z0-9]{8}/);
  return found ? found[0] : raw;
}

export async function entrarPorConvite(texto, user) {
  const code = extrairCodigoConvite(texto);
  const inviteSnap = await getDoc(doc(db, "invites", code));
  if (!inviteSnap.exists() || inviteSnap.data().active === false) {
    throw new Error("Convite não encontrado ou desativado.");
  }

  const workspaceId = inviteSnap.data().workspaceId;
  await updateDoc(doc(db, "financeGroups", workspaceId), {
    [`members.${user.uid}`]: true,
    [`memberEmails.${user.uid}`]: user.email || "",
    updatedAt: serverTimestamp()
  });

  await setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    name: user.displayName || "",
    email: user.email || "",
    photoURL: user.photoURL || "",
    currentWorkspaceId: workspaceId,
    updatedAt: serverTimestamp()
  }, { merge: true });

  return workspaceId;
}


export async function carregarPerfilUsuario(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function salvarPerfilUsuario(user, profile = {}) {
  if (!user) throw new Error("Usuário não logado.");

  const clean = {
    uid: user.uid,
    name: profile.name || user.displayName || "",
    email: user.email || "",
    photoURL: profile.photoURL || user.photoURL || "",
    nickname: profile.nickname || "",
    theme: profile.theme || "dark",
    compactMode: !!profile.compactMode,
    updatedAt: serverTimestamp()
  };

  await setDoc(doc(db, "users", user.uid), clean, { merge: true });

  try {
    await updateProfile(user, {
      displayName: clean.name,
      photoURL: clean.photoURL || null
    });
  } catch (err) {
    console.warn("Perfil salvo no Firestore, mas não consegui atualizar Auth.", err);
  }

  return clean;
}

export async function carregarMembrosWorkspace(workspaceId) {
  if (!workspaceId) return [];
  const groupSnap = await getDoc(doc(db, "financeGroups", workspaceId));
  if (!groupSnap.exists()) return [];

  const group = groupSnap.data();
  const memberIds = Object.keys(group.members || {});
  const members = [];

  for (const uid of memberIds) {
    const profile = await carregarPerfilUsuario(uid);
    members.push({
      uid,
      name: profile?.name || profile?.email || group.memberEmails?.[uid] || "Membro",
      email: profile?.email || group.memberEmails?.[uid] || "",
      photoURL: profile?.photoURL || "",
      nickname: profile?.nickname || ""
    });
  }

  return members;
}


export async function carregarGrupoWorkspace(workspaceId) {
  if (!workspaceId) return null;
  const snap = await getDoc(doc(db, "financeGroups", workspaceId));
  if (!snap.exists()) return null;
  return { id: workspaceId, ...snap.data() };
}

export async function sairDoWorkspaceAtual(user, workspaceId) {
  if (!user || !workspaceId) throw new Error("Usuário ou grupo não encontrado.");

  const groupRef = doc(db, "financeGroups", workspaceId);
  const groupSnap = await getDoc(groupRef);
  if (groupSnap.exists()) {
    const group = groupSnap.data();
    const members = Object.keys(group.members || {}).filter(uid => uid !== user.uid);
    const patch = {
      [`members.${user.uid}`]: deleteField(),
      [`memberEmails.${user.uid}`]: deleteField(),
      updatedAt: serverTimestamp()
    };
    if (group.ownerUid === user.uid && members.length) {
      patch.ownerUid = members[0];
    }
    await updateDoc(groupRef, patch);
  }

  const newWorkspaceId = novoId("finance");
  await setDoc(doc(db, "financeGroups", newWorkspaceId), {
    name: "Meu controle financeiro",
    ownerUid: user.uid,
    members: { [user.uid]: true },
    memberEmails: { [user.uid]: user.email || "" },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    name: user.displayName || "",
    email: user.email || "",
    photoURL: user.photoURL || "",
    currentWorkspaceId: newWorkspaceId,
    updatedAt: serverTimestamp()
  }, { merge: true });

  return newWorkspaceId;
}
