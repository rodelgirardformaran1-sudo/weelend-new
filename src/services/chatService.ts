// src/services/chatService.ts
//
// Three kinds of conversation, one collection ("chatThreads"):
//   - "support"   — a member/borrower's private line to admin. Doc id is
//                   deterministic: "<uid>_support". Any admin can see and
//                   reply to any support thread.
//   - "direct"    — member<->member 1-on-1 (e.g. a guarantor messaging
//                   the person they're vouching for). Doc id is the two
//                   uids sorted and joined with "_".
//   - "broadcast" — one shared group channel replacing the Facebook
//                   group chat. Fixed doc id "broadcast-general".
//
// No backend — everything here is plain client-side Firestore reads/
// writes, same as the rest of the app. Read receipts are a per-user
// `lastReadAt` map on the thread doc rather than a decrementing unread
// counter, so "has unread" is just `lastMessageAt > lastReadAt[uid]`.

import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  deleteField,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db } from "../firebaseConfig";

export const BROADCAST_THREAD_ID = "broadcast-general";
const THREADS_COLLECTION = "chatThreads";

export type ChatThreadType = "support" | "direct" | "broadcast";

export interface ChatThread {
  id: string;
  type: ChatThreadType;
  participantIds: string[];
  participantNames?: Record<string, string>;
  lastMessageText?: string;
  lastMessageAt?: any;
  lastMessageSenderId?: string;
  lastReadAt?: Record<string, any>;
  createdAt?: any;
}

export type ChatAttachmentType = "image" | "file";

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: any;
  editedAt?: any;
  deleted?: boolean;
  attachmentUrl?: string;
  attachmentType?: ChatAttachmentType;
  attachmentName?: string;
  /** uid -> emoji. One reaction per person per message, same pattern as a "like" toggle. */
  reactions?: Record<string, string>;
}

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// =======================================================
// 🆔 DETERMINISTIC THREAD IDS
// =======================================================
export function supportThreadId(memberUid: string): string {
  return `${memberUid}_support`;
}

export function directThreadId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join("_");
}

// =======================================================
// 🏗️ ENSURE A THREAD EXISTS (create-if-missing)
// =======================================================
export async function ensureSupportThread(memberUid: string, memberName: string): Promise<string> {
  const id = supportThreadId(memberUid);
  const ref = doc(db, THREADS_COLLECTION, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      type: "support",
      participantIds: [memberUid],
      participantNames: { [memberUid]: memberName },
      lastMessageText: "",
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: null,
      lastReadAt: {},
      createdAt: serverTimestamp(),
    });
  }
  return id;
}

export async function ensureDirectThread(
  uidA: string,
  nameA: string,
  uidB: string,
  nameB: string
): Promise<string> {
  const id = directThreadId(uidA, uidB);
  const ref = doc(db, THREADS_COLLECTION, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      type: "direct",
      participantIds: [uidA, uidB],
      participantNames: { [uidA]: nameA, [uidB]: nameB },
      lastMessageText: "",
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: null,
      lastReadAt: {},
      createdAt: serverTimestamp(),
    });
  }
  return id;
}

export async function ensureBroadcastThread(): Promise<string> {
  const ref = doc(db, THREADS_COLLECTION, BROADCAST_THREAD_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      type: "broadcast",
      participantIds: [],
      lastMessageText: "",
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: null,
      lastReadAt: {},
      createdAt: serverTimestamp(),
    });
  }
  return BROADCAST_THREAD_ID;
}

// =======================================================
// ✉️ SEND / READ
// =======================================================
export async function sendChatMessage(
  threadId: string,
  sender: { uid: string; name: string },
  text: string,
  attachment?: { url: string; type: ChatAttachmentType; name: string }
): Promise<void> {
  const clean = text.trim();
  if (!clean && !attachment) return;

  const threadRef = doc(db, THREADS_COLLECTION, threadId);
  await addDoc(collection(threadRef, "messages"), {
    senderId: sender.uid,
    senderName: sender.name,
    text: clean,
    createdAt: serverTimestamp(),
    ...(attachment
      ? {
          attachmentUrl: attachment.url,
          attachmentType: attachment.type,
          attachmentName: attachment.name,
        }
      : {}),
  });

  const preview = attachment
    ? clean || (attachment.type === "image" ? "📷 Photo" : `📎 ${attachment.name}`)
    : clean;

  await updateDoc(threadRef, {
    lastMessageText: preview,
    lastMessageAt: serverTimestamp(),
    lastMessageSenderId: sender.uid,
    [`lastReadAt.${sender.uid}`]: serverTimestamp(),
  });
}

// =======================================================
// ✏️ EDIT / 🗑️ DELETE (soft-delete, same pattern as the rest of the
// app's immutable-ledger records — the row stays, its content is
// blanked and flagged so history/audit trails aren't silently erased)
// =======================================================
export async function editChatMessage(
  threadId: string,
  messageId: string,
  newText: string
): Promise<void> {
  const clean = newText.trim();
  if (!clean) throw new Error("Message can't be empty");

  const msgRef = doc(db, THREADS_COLLECTION, threadId, "messages", messageId);
  await updateDoc(msgRef, {
    text: clean,
    editedAt: serverTimestamp(),
  });
}

export async function deleteChatMessage(threadId: string, messageId: string): Promise<void> {
  const msgRef = doc(db, THREADS_COLLECTION, threadId, "messages", messageId);
  await updateDoc(msgRef, {
    deleted: true,
    text: "",
    editedAt: serverTimestamp(),
  });
}

// =======================================================
// 🙂 REACTIONS — one emoji per person per message (tap the same one
// again to remove it), rendered as a grouped-count strip under the bubble.
// =======================================================
export async function toggleMessageReaction(
  threadId: string,
  messageId: string,
  userId: string,
  emoji: string
): Promise<void> {
  const msgRef = doc(db, THREADS_COLLECTION, threadId, "messages", messageId);
  const snap = await getDoc(msgRef);
  if (!snap.exists()) return;

  const current = ((snap.data() as any).reactions || {}) as Record<string, string>;
  const alreadyThisEmoji = current[userId] === emoji;

  await updateDoc(msgRef, {
    [`reactions.${userId}`]: alreadyThisEmoji ? deleteField() : emoji,
  });
}

// =======================================================
// 📎 ATTACHMENTS — image or any file, uploaded to Firebase Storage
// under the thread's own folder, same uploadBytes/getDownloadURL
// pattern used everywhere else in the app (profile photos, loan docs).
// =======================================================
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB

export async function uploadChatAttachment(
  threadId: string,
  file: File
): Promise<{ url: string; type: ChatAttachmentType; name: string }> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("File is too large (max 10MB).");
  }

  const storage = getStorage();
  const isImage = file.type.startsWith("image/");
  const safeName = file.name.replace(/[^\w.\-]/g, "_");
  const path = `chatAttachments/${threadId}/${Date.now()}_${safeName}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file);
  const url = await getDownloadURL(fileRef);

  return { url, type: isImage ? "image" : "file", name: file.name };
}

export async function markThreadRead(threadId: string, userId: string): Promise<void> {
  try {
    await updateDoc(doc(db, THREADS_COLLECTION, threadId), {
      [`lastReadAt.${userId}`]: serverTimestamp(),
    });
  } catch (err) {
    console.warn("⚠️ Failed to mark chat thread read:", threadId, err);
  }
}

// =======================================================
// 👂 LIVE LISTENERS
// =======================================================
export function listenToMessages(
  threadId: string,
  cb: (messages: ChatMessage[]) => void
): Unsubscribe {
  const q = query(
    collection(db, THREADS_COLLECTION, threadId, "messages"),
    orderBy("createdAt", "asc"),
    limit(300)
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
  });
}

/** My own threads — my support thread with admin, plus any direct threads I'm part of. */
export function listenToMyThreads(
  userId: string,
  cb: (threads: ChatThread[]) => void
): Unsubscribe {
  const q = query(
    collection(db, THREADS_COLLECTION),
    where("participantIds", "array-contains", userId)
  );
  return onSnapshot(q, (snap) => {
    const threads = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as ChatThread));
    threads.sort((a, b) => toMillis(b.lastMessageAt) - toMillis(a.lastMessageAt));
    cb(threads);
  });
}

export function listenToBroadcastThread(cb: (thread: ChatThread | null) => void): Unsubscribe {
  return onSnapshot(doc(db, THREADS_COLLECTION, BROADCAST_THREAD_ID), (snap) => {
    cb(snap.exists() ? ({ id: snap.id, ...(snap.data() as any) } as ChatThread) : null);
  });
}

/** Admin-only — every member/borrower's support thread, for the admin inbox. */
export function listenToAllSupportThreads(cb: (threads: ChatThread[]) => void): Unsubscribe {
  const q = query(collection(db, THREADS_COLLECTION), where("type", "==", "support"));
  return onSnapshot(q, (snap) => {
    const threads = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as ChatThread));
    threads.sort((a, b) => toMillis(b.lastMessageAt) - toMillis(a.lastMessageAt));
    cb(threads);
  });
}

export function toMillis(ts: any): number {
  return ts?.toMillis ? ts.toMillis() : 0;
}

export function threadHasUnread(thread: ChatThread, userId: string): boolean {
  if (!thread.lastMessageAt) return false;
  if (thread.lastMessageSenderId === userId) return false; // don't flag your own last message
  const lastRead = thread.lastReadAt?.[userId];
  return toMillis(thread.lastMessageAt) > toMillis(lastRead);
}

// =======================================================
// 👤 CONTACT PICKER (for starting a new direct chat)
// =======================================================
export interface ChatContact {
  uid: string;
  name: string;
  role: string;
}

export async function getChatContacts(excludeUid: string): Promise<ChatContact[]> {
  const q = query(collection(db, "users"), where("status", "==", "approved"));
  const { getDocs } = await import("firebase/firestore");
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => {
      const data = d.data() as any;
      return {
        uid: d.id,
        name: data.fullName || `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim() || data.email || d.id,
        role: data.role || "",
      };
    })
    .filter((u) => u.uid !== excludeUid && (u.role === "member" || u.role === "borrower"))
    .sort((a, b) => a.name.localeCompare(b.name));
}
