// src/utils/chatWidget.ts
//
// The floating 💬 chat bubble in the bottom-right corner, present on
// every home page (member, borrower, admin). Clicking it opens a small
// panel over whatever page is currently showing — this is NOT a
// separate routed page, so it works regardless of which dashboard/page
// is active. Initialized once per session from main.ts after the
// signed-in user's role is known.

import type { Unsubscribe } from "firebase/firestore";
import {
  ensureSupportThread,
  ensureDirectThread,
  ensureBroadcastThread,
  listenToMyThreads,
  listenToBroadcastThread,
  listenToAllSupportThreads,
  listenToMessages,
  sendChatMessage,
  editChatMessage,
  deleteChatMessage,
  toggleMessageReaction,
  uploadChatAttachment,
  markThreadRead,
  threadHasUnread,
  supportThreadId,
  getChatContacts,
  BROADCAST_THREAD_ID,
  QUICK_REACTIONS,
  type ChatThread,
  type ChatMessage,
  type ChatContact,
} from "../services/chatService";

// A slightly wider grid than the 6 quick-reactions, for inserting an
// emoji into the text box itself (Messenger-style emoji picker).
const EMOJI_PICKER_OPTIONS = [
  "😀", "😂", "😊", "😍", "😘", "😉", "😢", "😭",
  "😡", "😱", "😴", "🤔", "👍", "👎", "🙏", "👏",
  "❤️", "🔥", "🎉", "✅", "❌", "😅", "🥳", "😎",
];

type Role = "admin" | "member" | "borrower";
type Tab = "support" | "group" | "direct" | "inbox";

interface WidgetState {
  uid: string;
  name: string;
  role: Role;
  tab: Tab;
  openThreadId: string | null;
  myThreads: ChatThread[];
  broadcastThread: ChatThread | null;
  supportThreads: ChatThread[]; // admin inbox
}

let state: WidgetState | null = null;
let unsubs: Unsubscribe[] = [];
let messagesUnsub: Unsubscribe | null = null;
let initialized = false;

// Message-list interaction state, kept outside WidgetState/renderMessages
// so a re-render triggered by a live Firestore snapshot (e.g. someone
// else's reaction landing) doesn't blow away an in-progress edit or an
// open reaction/emoji picker.
let lastRenderedMessages: ChatMessage[] = [];
let currentThreadId: string | null = null;
let editingMessageId: string | null = null;
let reactionPickerForId: string | null = null;
let emojiPickerOpen = false;
let isUploadingAttachment = false;

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function cleanupListeners() {
  unsubs.forEach((u) => u());
  unsubs = [];
  if (messagesUnsub) {
    messagesUnsub();
    messagesUnsub = null;
  }
}

function removeInputRow() {
  document.getElementById("chat-input-row")?.remove();
  document.getElementById("chat-emoji-picker")?.remove();
  editingMessageId = null;
  reactionPickerForId = null;
  emojiPickerOpen = false;
  isUploadingAttachment = false;
}

/** Public entry point — call once per signed-in session. */
export function initChatWidget(uid: string, name: string, role: Role) {
  // Tear down any previous session's widget/listeners (e.g. logout -> login as someone else).
  cleanupListeners();
  document.getElementById("chat-fab")?.remove();
  document.getElementById("chat-panel")?.remove();

  state = {
    uid,
    name,
    role,
    tab: role === "admin" ? "inbox" : "support",
    openThreadId: null,
    myThreads: [],
    broadcastThread: null,
    supportThreads: [],
  };

  buildDom();
  wireBadgeListeners();

  if (role !== "admin") {
    ensureSupportThread(uid, name).catch((err) => console.warn("⚠️ ensureSupportThread failed:", err));
  }
  ensureBroadcastThread().catch((err) => console.warn("⚠️ ensureBroadcastThread failed:", err));

  initialized = true;
}

function buildDom() {
  const fab = document.createElement("button");
  fab.id = "chat-fab";
  fab.className = "chat-fab";
  fab.type = "button";
  fab.title = "Chat";
  fab.innerHTML = `💬<span id="chat-fab-badge" class="chat-fab-badge" style="display:none;">0</span>`;
  fab.onclick = () => togglePanel();
  document.body.appendChild(fab);

  const panel = document.createElement("div");
  panel.id = "chat-panel";
  panel.className = "chat-panel";
  panel.innerHTML = `
    <div class="chat-panel-header">
      <strong id="chat-panel-title">Chat</strong>
      <button id="chat-panel-close" type="button" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
    </div>
    <div id="chat-panel-tabs" class="chat-panel-tabs"></div>
    <div id="chat-panel-body" class="chat-panel-body"></div>
  `;
  document.body.appendChild(panel);

  el("chat-panel-close")!.onclick = () => togglePanel(false);

  // Only build the tab bar now — the tab body (and its side effect of
  // marking a thread as read) is rendered lazily when the panel is
  // actually opened, not the instant the widget is created on page load.
  renderTabs();
}

function togglePanel(force?: boolean) {
  const panel = el("chat-panel")!;
  const shouldOpen = force !== undefined ? force : !panel.classList.contains("open");
  panel.classList.toggle("open", shouldOpen);
  if (shouldOpen) {
    renderTabBody();
  } else {
    if (messagesUnsub) {
      messagesUnsub();
      messagesUnsub = null;
    }
    if (state) state.openThreadId = null;
    removeInputRow();
  }
}

function renderTabs() {
  if (!state) return;
  const tabsEl = el("chat-panel-tabs")!;
  const tabs: { key: Tab; label: string }[] =
    state.role === "admin"
      ? [
          { key: "inbox", label: "Member Chats" },
          { key: "group", label: "Group Chat" },
        ]
      : [
          { key: "support", label: "Admin" },
          { key: "group", label: "Group Chat" },
          { key: "direct", label: "Direct" },
        ];

  tabsEl.innerHTML = tabs
    .map((t) => `<button class="chat-panel-tab${state!.tab === t.key ? " active" : ""}" data-tab="${t.key}">${t.label}</button>`)
    .join("");

  tabsEl.querySelectorAll<HTMLButtonElement>(".chat-panel-tab").forEach((btn) => {
    btn.onclick = () => {
      if (!state) return;
      state.tab = btn.dataset.tab as Tab;
      state.openThreadId = null;
      if (messagesUnsub) {
        messagesUnsub();
        messagesUnsub = null;
      }
      currentThreadId = null;
      removeInputRow();
      renderTabs();
      renderTabBody();
    };
  });
}

function renderTabBody() {
  if (!state) return;
  const body = el("chat-panel-body")!;

  if (state.openThreadId) {
    renderThreadView(body, state.openThreadId);
    return;
  }

  if (state.tab === "group") {
    // Group chat has no thread list — open it directly.
    openThread(BROADCAST_THREAD_ID, "Group Chat");
    return;
  }

  if (state.tab === "support") {
    openThread(supportThreadId(state.uid), "Admin Support");
    return;
  }

  if (state.tab === "inbox") {
    renderInboxList(body);
    return;
  }

  if (state.tab === "direct") {
    renderDirectList(body);
    return;
  }
}

function renderInboxList(body: HTMLElement) {
  if (!state) return;
  if (!state.supportThreads.length) {
    body.innerHTML = `<p class="muted" style="font-size:13px;">No member conversations yet.</p>`;
    return;
  }
  body.innerHTML = state.supportThreads
    .map((t) => {
      const memberName = t.participantNames?.[t.participantIds[0]] || t.participantIds[0];
      const unread = threadHasUnread(t, state!.uid);
      return `
        <div class="chat-thread-row" data-thread-id="${t.id}" data-name="${memberName}">
          <span>${memberName}</span>
          ${unread ? `<span class="dot"></span>` : ""}
        </div>
      `;
    })
    .join("");

  body.querySelectorAll<HTMLElement>(".chat-thread-row").forEach((row) => {
    row.onclick = () => openThread(row.dataset.threadId!, row.dataset.name || "Chat");
  });
}

function renderDirectList(body: HTMLElement) {
  if (!state) return;
  const directThreads = state.myThreads.filter((t) => t.type === "direct");

  const listHtml = directThreads.length
    ? directThreads
        .map((t) => {
          const otherUid = t.participantIds.find((id) => id !== state!.uid) || "";
          const otherName = t.participantNames?.[otherUid] || otherUid;
          const unread = threadHasUnread(t, state!.uid);
          return `
            <div class="chat-thread-row" data-thread-id="${t.id}" data-name="${otherName}">
              <span>${otherName}</span>
              ${unread ? `<span class="dot"></span>` : ""}
            </div>
          `;
        })
        .join("")
    : `<p class="muted" style="font-size:13px;">No direct messages yet.</p>`;

  body.innerHTML = `
    <button id="chat-new-direct-btn" type="button" class="request-loan-btn" style="width:100%;margin-bottom:10px;">➕ New Message</button>
    ${listHtml}
  `;

  body.querySelectorAll<HTMLElement>(".chat-thread-row").forEach((row) => {
    row.onclick = () => openThread(row.dataset.threadId!, row.dataset.name || "Chat");
  });

  el("chat-new-direct-btn")!.onclick = async () => {
    body.innerHTML = `<p class="muted" style="font-size:13px;">Loading contacts...</p>`;
    let contacts: ChatContact[] = [];
    try {
      contacts = await getChatContacts(state!.uid);
    } catch (err) {
      console.error("❌ Failed to load chat contacts:", err);
    }
    if (!contacts.length) {
      body.innerHTML = `<p class="muted" style="font-size:13px;">No one else to message yet.</p><button id="chat-back-to-direct" type="button" class="request-loan-btn" style="width:100%;margin-top:8px;">⬅ Back</button>`;
      el("chat-back-to-direct")!.onclick = () => renderDirectList(body);
      return;
    }
    body.innerHTML = contacts
      .map((c) => `<div class="chat-thread-row" data-uid="${c.uid}" data-name="${c.name}"><span>${c.name}</span></div>`)
      .join("");
    body.querySelectorAll<HTMLElement>(".chat-thread-row").forEach((row) => {
      row.onclick = async () => {
        const otherUid = row.dataset.uid!;
        const otherName = row.dataset.name || "Member";
        row.style.opacity = "0.5";
        try {
          const threadId = await ensureDirectThread(state!.uid, state!.name, otherUid, otherName);
          openThread(threadId, otherName);
        } catch (err: any) {
          console.error("❌ Failed to start direct chat:", err);
          body.innerHTML =
            `<p style="color:#c0392b;font-size:13px;">❌ Couldn't open this chat: ${err?.message || "permission error"}.` +
            ` If this keeps happening, the app's chat permissions may need to be redeployed.</p>` +
            `<button id="chat-back-to-direct-err" type="button" class="request-loan-btn" style="width:100%;margin-top:8px;">⬅ Back</button>`;
          document.getElementById("chat-back-to-direct-err")!.onclick = () => renderDirectList(body);
        }
      };
    });
  };
}

function openThread(threadId: string, title: string) {
  if (!state) return;
  state.openThreadId = threadId;
  el("chat-panel-title")!.textContent = title;
  markThreadRead(threadId, state.uid);
  renderThreadView(el("chat-panel-body")!, threadId);
}

function renderThreadView(body: HTMLElement, threadId: string) {
  if (!state) return;

  body.innerHTML = `
    <button id="chat-thread-back" type="button" style="background:none;border:none;color:#7a1130;font-size:12px;cursor:pointer;margin-bottom:6px;">⬅ Back</button>
    <div id="chat-messages" class="chat-messages"></div>
  `;

  el("chat-thread-back")!.onclick = () => {
    if (!state) return;
    state.openThreadId = null;
    if (messagesUnsub) {
      messagesUnsub();
      messagesUnsub = null;
    }
    currentThreadId = null;
    removeInputRow();
    el("chat-panel-title")!.textContent =
      state.role === "admin" ? (state.tab === "inbox" ? "Member Chats" : "Group Chat") : "Chat";
    renderTabBody();
  };

  // The message input row lives outside chat-panel-body (fixed at the
  // bottom of the panel), appended once per thread open.
  currentThreadId = threadId;
  editingMessageId = null;
  reactionPickerForId = null;
  emojiPickerOpen = false;

  let inputRow = document.getElementById("chat-input-row");
  inputRow?.remove();
  document.getElementById("chat-emoji-picker")?.remove();
  inputRow = document.createElement("div");
  inputRow.id = "chat-input-row";
  inputRow.className = "chat-input-row";
  inputRow.innerHTML = `
    <button id="chat-attach-btn" type="button" class="icon-btn" title="Attach photo or file">📎</button>
    <input id="chat-attach-file" type="file" accept="image/*,.pdf,.doc,.docx,.xlsx" style="display:none;" />
    <button id="chat-emoji-btn" type="button" class="icon-btn" title="Emoji">😀</button>
    <input id="chat-input-text" type="text" placeholder="Type a message..." />
    <button id="chat-input-send" type="button">➤</button>
  `;
  document.getElementById("chat-panel")!.appendChild(inputRow);

  const sendBtn = document.getElementById("chat-input-send") as HTMLButtonElement;
  const inputEl = document.getElementById("chat-input-text") as HTMLInputElement;
  const attachBtn = document.getElementById("chat-attach-btn") as HTMLButtonElement;
  const attachFileEl = document.getElementById("chat-attach-file") as HTMLInputElement;
  const emojiBtn = document.getElementById("chat-emoji-btn") as HTMLButtonElement;

  const doSend = async () => {
    const text = inputEl.value;
    if (!text.trim() || !state) return;
    inputEl.value = "";
    sendBtn.setAttribute("disabled", "true");
    try {
      await sendChatMessage(threadId, { uid: state.uid, name: state.name }, text);
    } catch (err: any) {
      console.error("❌ Failed to send chat message:", err);
      inputEl.value = text; // don't silently lose what they typed
      alert(`❌ Message didn't send: ${err?.message || "permission error"}. If this keeps happening, the app's chat permissions may need to be redeployed.`);
    } finally {
      sendBtn.removeAttribute("disabled");
    }
  };
  sendBtn.onclick = doSend;
  inputEl.onkeydown = (e) => {
    if (e.key === "Enter") doSend();
  };

  attachBtn.onclick = () => attachFileEl.click();
  attachFileEl.onchange = async () => {
    const file = attachFileEl.files?.[0];
    attachFileEl.value = "";
    if (!file || !state || isUploadingAttachment) return;

    isUploadingAttachment = true;
    attachBtn.textContent = "⏳";
    attachBtn.setAttribute("disabled", "true");
    try {
      const uploaded = await uploadChatAttachment(threadId, file);
      await sendChatMessage(threadId, { uid: state.uid, name: state.name }, "", uploaded);
    } catch (err: any) {
      console.error("❌ Failed to send attachment:", err);
      alert(`❌ Couldn't send that file: ${err?.message || "upload error"}.`);
    } finally {
      isUploadingAttachment = false;
      attachBtn.textContent = "📎";
      attachBtn.removeAttribute("disabled");
    }
  };

  emojiBtn.onclick = () => {
    emojiPickerOpen = !emojiPickerOpen;
    renderEmojiPicker(inputEl);
  };

  if (messagesUnsub) messagesUnsub();
  messagesUnsub = listenToMessages(threadId, (messages: ChatMessage[]) => {
    lastRenderedMessages = messages;
    renderMessages(messages);
    markThreadRead(threadId, state!.uid);
  });
}

function renderEmojiPicker(inputEl: HTMLInputElement) {
  document.getElementById("chat-emoji-picker")?.remove();
  if (!emojiPickerOpen) return;

  const picker = document.createElement("div");
  picker.id = "chat-emoji-picker";
  picker.className = "chat-emoji-picker";
  picker.innerHTML = EMOJI_PICKER_OPTIONS.map((e) => `<button type="button" class="chat-emoji-opt" data-emoji="${e}">${e}</button>`).join("");
  document.getElementById("chat-panel")!.appendChild(picker);

  picker.querySelectorAll<HTMLButtonElement>(".chat-emoji-opt").forEach((btn) => {
    btn.onclick = () => {
      inputEl.value += btn.dataset.emoji;
      inputEl.focus();
    };
  });
}

function renderAttachmentHtml(m: ChatMessage): string {
  if (!m.attachmentUrl) return "";
  if (m.attachmentType === "image") {
    return `<a href="${m.attachmentUrl}" target="_blank" rel="noopener"><img src="${m.attachmentUrl}" class="chat-attachment-img" alt="attachment" /></a>`;
  }
  return `<a href="${m.attachmentUrl}" target="_blank" rel="noopener" class="chat-attachment-file">📎 ${escapeHtml(m.attachmentName || "File")}</a>`;
}

function renderReactionsStrip(m: ChatMessage): string {
  const reactions = m.reactions || {};
  const counts: Record<string, number> = {};
  Object.values(reactions).forEach((emoji) => {
    counts[emoji] = (counts[emoji] || 0) + 1;
  });
  const entries = Object.entries(counts);
  if (!entries.length) return "";

  return `
    <div class="chat-reactions-strip">
      ${entries.map(([emoji, count]) => `<span class="chat-reaction-pill">${emoji} ${count}</span>`).join("")}
    </div>
  `;
}

function renderMessages(messages: ChatMessage[]) {
  const container = document.getElementById("chat-messages");
  if (!container || !state) return;

  container.innerHTML = messages
    .map((m) => {
      const mine = m.senderId === state!.uid;
      const isEditing = editingMessageId === m.id;
      const isReacting = reactionPickerForId === m.id;

      let bubbleInner: string;
      if (m.deleted) {
        bubbleInner = `<em style="opacity:.65;">This message was deleted</em>`;
      } else if (isEditing) {
        bubbleInner = `
          <input class="chat-edit-input" data-id="${m.id}" type="text" value="${escapeAttr(m.text)}" />
          <div class="chat-edit-actions">
            <button type="button" class="chat-edit-save" data-id="${m.id}">Save</button>
            <button type="button" class="chat-edit-cancel">Cancel</button>
          </div>
        `;
      } else {
        bubbleInner = `${renderAttachmentHtml(m)}${m.text ? escapeHtml(m.text) : ""}${m.editedAt ? `<span class="chat-edited-tag"> (edited)</span>` : ""}`;
      }

      return `
        <div class="chat-msg-wrap ${mine ? "mine" : "theirs"}" data-msg-id="${m.id}">
          ${!mine ? `<span class="sender">${m.senderName}</span>` : ""}
          <div class="chat-bubble ${mine ? "mine" : "theirs"}${m.deleted ? " deleted" : ""}">${bubbleInner}</div>
          ${m.deleted ? "" : renderReactionsStrip(m)}
          ${
            m.deleted || isEditing
              ? ""
              : `
            <div class="chat-msg-toolbar">
              <button type="button" class="chat-react-btn" data-id="${m.id}" title="React">🙂</button>
              ${mine ? `<button type="button" class="chat-edit-btn" data-id="${m.id}" title="Edit">✏️</button><button type="button" class="chat-delete-btn" data-id="${m.id}" title="Delete">🗑️</button>` : ""}
            </div>
          `
          }
          ${
            isReacting
              ? `<div class="chat-reaction-picker">${QUICK_REACTIONS.map((e) => `<button type="button" class="chat-reaction-opt" data-id="${m.id}" data-emoji="${e}">${e}</button>`).join("")}</div>`
              : ""
          }
        </div>
      `;
    })
    .join("");

  container.scrollTop = container.scrollHeight;
  wireMessageActions(container);
}

function wireMessageActions(container: HTMLElement) {
  if (!state) return;
  const threadId = currentThreadId;
  if (!threadId) return;

  container.querySelectorAll<HTMLButtonElement>(".chat-react-btn").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.id!;
      reactionPickerForId = reactionPickerForId === id ? null : id;
      renderMessages(lastRenderedMessages);
    };
  });

  container.querySelectorAll<HTMLButtonElement>(".chat-reaction-opt").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.id!;
      const emoji = btn.dataset.emoji!;
      reactionPickerForId = null;
      renderMessages(lastRenderedMessages);
      try {
        await toggleMessageReaction(threadId, id, state!.uid, emoji);
      } catch (err) {
        console.error("❌ Failed to react to message:", err);
      }
    };
  });

  container.querySelectorAll<HTMLButtonElement>(".chat-edit-btn").forEach((btn) => {
    btn.onclick = () => {
      editingMessageId = btn.dataset.id!;
      reactionPickerForId = null;
      renderMessages(lastRenderedMessages);
      const input = container.querySelector<HTMLInputElement>(`.chat-edit-input[data-id="${editingMessageId}"]`);
      input?.focus();
      input?.select();
    };
  });

  container.querySelectorAll<HTMLButtonElement>(".chat-delete-btn").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.id!;
      if (!confirm("Delete this message? This can't be undone.")) return;
      try {
        await deleteChatMessage(threadId, id);
      } catch (err: any) {
        console.error("❌ Failed to delete message:", err);
        alert(`❌ Couldn't delete this message: ${err?.message || "permission error"}.`);
      }
    };
  });

  const saveEdit = async (id: string) => {
    const input = container.querySelector<HTMLInputElement>(`.chat-edit-input[data-id="${id}"]`);
    if (!input) return;
    const newText = input.value;
    if (!newText.trim()) return;
    try {
      await editChatMessage(threadId, id, newText);
      editingMessageId = null;
    } catch (err: any) {
      console.error("❌ Failed to edit message:", err);
      alert(`❌ Couldn't save that edit: ${err?.message || "permission error"}.`);
    }
  };

  container.querySelectorAll<HTMLButtonElement>(".chat-edit-save").forEach((btn) => {
    btn.onclick = () => saveEdit(btn.dataset.id!);
  });

  container.querySelectorAll<HTMLButtonElement>(".chat-edit-cancel").forEach((btn) => {
    btn.onclick = () => {
      editingMessageId = null;
      renderMessages(lastRenderedMessages);
    };
  });

  container.querySelectorAll<HTMLInputElement>(".chat-edit-input").forEach((input) => {
    input.onkeydown = (e) => {
      if (e.key === "Enter") saveEdit(input.dataset.id!);
      if (e.key === "Escape") {
        editingMessageId = null;
        renderMessages(lastRenderedMessages);
      }
    };
  });
}

function escapeHtml(text: string): string {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

function escapeAttr(text: string): string {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML.replace(/"/g, "&quot;");
}

function updateBadge() {
  if (!state) return;
  const badge = document.getElementById("chat-fab-badge");
  if (!badge) return;

  let unreadCount = 0;
  state.myThreads.forEach((t) => {
    if (threadHasUnread(t, state!.uid)) unreadCount++;
  });
  if (state.broadcastThread && threadHasUnread(state.broadcastThread, state.uid)) unreadCount++;
  if (state.role === "admin") {
    state.supportThreads.forEach((t) => {
      if (threadHasUnread(t, state!.uid)) unreadCount++;
    });
  }

  if (unreadCount > 0) {
    badge.textContent = String(unreadCount);
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }
}

function wireBadgeListeners() {
  if (!state) return;

  unsubs.push(
    listenToMyThreads(state.uid, (threads) => {
      if (!state) return;
      state.myThreads = threads;
      updateBadge();
      // Live-refresh whichever list view is currently open.
      if (!state.openThreadId && state.tab === "direct") renderDirectList(el("chat-panel-body")!);
    })
  );

  unsubs.push(
    listenToBroadcastThread((thread) => {
      if (!state) return;
      state.broadcastThread = thread;
      updateBadge();
    })
  );

  if (state.role === "admin") {
    unsubs.push(
      listenToAllSupportThreads((threads) => {
        if (!state) return;
        state.supportThreads = threads;
        updateBadge();
        if (!state.openThreadId && state.tab === "inbox") renderInboxList(el("chat-panel-body")!);
      })
    );
  }
}

export function isChatWidgetInitialized(): boolean {
  return initialized;
}

/** Call on logout — tears down listeners and removes the floating bubble/panel. */
export function destroyChatWidget() {
  cleanupListeners();
  document.getElementById("chat-fab")?.remove();
  document.getElementById("chat-panel")?.remove();
  document.getElementById("chat-input-row")?.remove();
  document.getElementById("chat-emoji-picker")?.remove();
  state = null;
  initialized = false;
  lastRenderedMessages = [];
  currentThreadId = null;
  editingMessageId = null;
  reactionPickerForId = null;
  emojiPickerOpen = false;
  isUploadingAttachment = false;
}
