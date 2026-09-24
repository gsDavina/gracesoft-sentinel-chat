const TOKEN_KEY = "gracesoft-assistant-demo-token";
const SESSION_KEY = "gracesoft-assistant-session-id";

const STARTER_QUESTIONS = [
  "What's overdue?",
  "What's due today?",
  "How many billable hours did I log in August?",
  "What's my cash position now?",
  "Is anything pending or outstanding?",
  "How is Project 4 performing?",
  "What did I spend on SaaS last month?",
  "Which project took the most time in the last 30 days?",
];

const tokenGate = document.getElementById("token-gate");
const chatApp = document.getElementById("chat-app");
const tokenInput = document.getElementById("token-input");
const messagesEl = document.getElementById("messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const startersEl = document.getElementById("starters");

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function addMessage(role, text, caveats) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.textContent = text; // never innerHTML — snapshot/model text must never execute as markup
  if (caveats && caveats.length > 0) {
    const caveatsEl = document.createElement("div");
    caveatsEl.className = "caveats";
    caveatsEl.textContent = caveats.join(" ");
    el.appendChild(caveatsEl);
  }
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

async function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  addMessage("user", trimmed);
  const thinking = addMessage("assistant", "Thinking...");

  try {
    const res = await fetch("/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` },
      body: JSON.stringify({ sessionId: getSessionId(), message: trimmed }),
    });

    if (res.status === 401) {
      thinking.remove();
      localStorage.removeItem(TOKEN_KEY);
      showTokenGate();
      addMessage("error", "That demo token was rejected — please re-enter it.");
      return;
    }
    if (!res.ok) {
      thinking.remove();
      const body = await res.json().catch(() => ({}));
      addMessage("error", body.error || `Something went wrong (HTTP ${res.status}).`);
      return;
    }

    const result = await res.json();
    thinking.remove();
    addMessage("assistant", result.answer, result.capped ? [] : undefined);
  } catch (err) {
    thinking.remove();
    addMessage("error", "Couldn't reach the assistant — check your connection and try again.");
    console.error(err);
  }
}

function showTokenGate() {
  tokenGate.classList.remove("hidden");
  chatApp.classList.add("hidden");
}

function showChat() {
  tokenGate.classList.add("hidden");
  chatApp.classList.remove("hidden");
}

document.getElementById("token-save").addEventListener("click", () => {
  const value = tokenInput.value.trim();
  if (!value) return;
  localStorage.setItem(TOKEN_KEY, value);
  showChat();
});

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value;
  chatInput.value = "";
  void sendMessage(text);
});

for (const question of STARTER_QUESTIONS) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = question;
  btn.addEventListener("click", () => void sendMessage(question));
  startersEl.appendChild(btn);
}

if (localStorage.getItem(TOKEN_KEY)) {
  showChat();
} else {
  showTokenGate();
}

fetch("/meta")
  .then((r) => r.json())
  .then((meta) => {
    const banner = document.getElementById("scope-banner");
    banner.textContent = `Data: ${meta.snapshotStart} to ${meta.snapshotEnd}, redacted (as of ${meta.asOfDate})`;
  })
  .catch(() => {});
