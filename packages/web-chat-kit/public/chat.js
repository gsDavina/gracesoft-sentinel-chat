/* global window, document, fetch, FileReader */
// web-chat-kit browser client. No framework, no build step. Every piece of
// text from the server is rendered with textContent, never innerHTML, so
// nothing an agent or a tool result says can execute as markup.
(function () {
  "use strict";

  var root = document.getElementById("chat");
  if (!root) return;

  var themeId = root.dataset.themeId || "chat";
  var requiresToken = root.dataset.requiresToken === "true";
  var keys = { session: themeId + ":session", token: themeId + ":token", scheme: themeId + ":scheme" };

  var log = document.getElementById("chat-log");
  var form = document.getElementById("chat-form");
  var input = document.getElementById("chat-input");
  var send = document.getElementById("chat-send");
  var fileInput = document.getElementById("chat-file");
  var attachment = document.getElementById("chat-attachment");
  var tokenDialog = document.getElementById("chat-token-dialog");
  var tokenForm = document.getElementById("chat-token-form");
  var tokenInput = document.getElementById("chat-token-input");

  var MAX_IMAGE_BYTES = 4 * 1024 * 1024;
  var pendingImage = null;
  var busy = false;
  var queuedAfterToken = null;

  // localStorage can throw (private mode, blocked storage) — the chat must still work without it.
  function load(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function save(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }

  function newSessionId() {
    var bytes = new Uint8Array(18);
    window.crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  var sessionId = load(keys.session) || newSessionId();
  save(keys.session, sessionId);
  var token = load(keys.token);

  // ---- colour scheme toggle ----
  var html = document.documentElement;
  var storedScheme = load(keys.scheme);
  if (storedScheme === "light" || storedScheme === "dark") html.dataset.theme = storedScheme;

  function currentScheme() {
    if (html.dataset.theme) return html.dataset.theme;
    var def = root.dataset.defaultScheme;
    if (def === "light" || def === "dark") return def;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.getElementById("chat-scheme").addEventListener("click", function () {
    var next = currentScheme() === "dark" ? "light" : "dark";
    html.dataset.theme = next;
    save(keys.scheme, next);
  });

  // ---- rendering ----
  function scrollToEnd() {
    log.scrollTop = log.scrollHeight;
  }

  function addRow(who) {
    var row = document.createElement("div");
    row.className = "chat-row chat-row--" + who;
    log.appendChild(row);
    return row;
  }

  function addBubble(row, who, text, extraClass) {
    var p = document.createElement("p");
    p.className = "chat-bubble chat-bubble--" + who + (extraClass ? " " + extraClass : "");
    p.textContent = text;
    row.appendChild(p);
  }

  function addImage(row, src, alt) {
    var img = document.createElement("img");
    img.className = "chat-image";
    img.src = src;
    img.alt = alt;
    row.appendChild(img);
  }

  function renderUser(text, imageDataUri) {
    var row = addRow("user");
    if (imageDataUri) addImage(row, imageDataUri, "Photo you sent");
    if (text) addBubble(row, "user", text);
    scrollToEnd();
  }

  function renderReply(reply) {
    var row = addRow("bot");
    if (reply.text) addBubble(row, "bot", reply.text);
    (reply.images || []).forEach(function (src) {
      if (/^https:\/\//.test(src) || /^data:image\//.test(src)) addImage(row, src, "Image from the assistant");
    });
    if (reply.quickReplies && reply.quickReplies.length) {
      var wrap = document.createElement("div");
      wrap.className = "chat-quick-replies";
      reply.quickReplies.forEach(function (qr) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chat-chip";
        chip.textContent = qr.label;
        chip.addEventListener("click", function () {
          if (busy) return;
          Array.prototype.forEach.call(wrap.querySelectorAll("button"), function (b) { b.disabled = true; });
          submit({ text: qr.label, quickReplyId: qr.id });
        });
        wrap.appendChild(chip);
      });
      row.appendChild(wrap);
    }
    scrollToEnd();
  }

  function renderError(text) {
    addBubble(addRow("bot"), "bot", text, "chat-bubble--error");
    scrollToEnd();
  }

  function showTyping() {
    var row = addRow("bot");
    var dots = document.createElement("div");
    dots.className = "chat-bubble chat-bubble--bot chat-typing";
    dots.setAttribute("aria-label", "Assistant is typing");
    for (var i = 0; i < 3; i++) dots.appendChild(document.createElement("span"));
    row.appendChild(dots);
    scrollToEnd();
    return row;
  }

  function setBusy(value) {
    busy = value;
    send.disabled = value;
  }

  // ---- sending ----
  function askForToken(message) {
    queuedAfterToken = message;
    tokenInput.value = "";
    if (typeof tokenDialog.showModal === "function") tokenDialog.showModal();
    else {
      var entered = window.prompt("Access code");
      if (entered) onToken(entered);
    }
  }

  function onToken(value) {
    token = value.trim();
    save(keys.token, token);
    if (queuedAfterToken) {
      var message = queuedAfterToken;
      queuedAfterToken = null;
      post(message);
    }
  }

  tokenForm.addEventListener("submit", function () {
    if (tokenInput.value.trim()) onToken(tokenInput.value);
  });

  function post(message) {
    setBusy(true);
    var typing = showTyping();
    var headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;

    fetch("api/messages", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ sessionId: sessionId, text: message.text, quickReplyId: message.quickReplyId, image: message.image }),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) { return { status: res.status, body: body }; });
      })
      .then(function (result) {
        typing.remove();
        if (result.status === 401) {
          save(keys.token, null);
          token = null;
          askForToken(message);
          return;
        }
        if (result.status === 429) return renderError("You're sending messages a bit quickly — please wait a moment and try again.");
        if (result.status === 413) return renderError("That photo is too large — please try a smaller one.");
        if (result.body && result.body.reply) return renderReply(result.body.reply);
        renderError("That message couldn't be sent. Please try again.");
      })
      .catch(function () {
        typing.remove();
        renderError("Can't reach the server right now — check your connection and try again.");
      })
      .then(function () {
        setBusy(false);
        input.focus();
      });
  }

  function submit(message) {
    if (!message.quickReplyId) renderUser(message.text, message.image);
    else renderUser(message.text);
    if (requiresToken && !token) return askForToken(message);
    post(message);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (busy) return;
    var text = input.value.trim();
    if (!text && !pendingImage) return;
    var message = { text: text || undefined, image: pendingImage || undefined };
    input.value = "";
    autosize();
    clearAttachment();
    submit(message);
  });

  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  function autosize() {
    input.style.height = "auto";
    // scrollHeight excludes the border, but box-sizing is border-box — add it back or the text is clipped by 2px and scrolls.
    var borders = input.offsetHeight - input.clientHeight;
    var wanted = input.scrollHeight + borders;
    input.style.height = Math.min(wanted, 160) + "px";
    input.style.overflowY = wanted > 160 ? "auto" : "hidden";
  }
  input.addEventListener("input", autosize);
  autosize();

  // ---- image attachment ----
  function clearAttachment() {
    pendingImage = null;
    fileInput.value = "";
    attachment.hidden = true;
    attachment.textContent = "";
  }

  fileInput.addEventListener("change", function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      clearAttachment();
      renderError("That photo is over 4 MB — please pick a smaller one.");
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      pendingImage = String(reader.result);
      attachment.hidden = false;
      attachment.textContent = "📎 " + file.name;
      var remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "remove";
      remove.addEventListener("click", clearAttachment);
      attachment.appendChild(remove);
    };
    reader.readAsDataURL(file);
  });

  // ---- new conversation ----
  document.getElementById("chat-reset").addEventListener("click", function () {
    if (busy) return;
    sessionId = newSessionId();
    save(keys.session, sessionId);
    Array.prototype.slice.call(log.children, 1).forEach(function (node) { node.remove(); });
    clearAttachment();
    input.focus();
  });
})();
