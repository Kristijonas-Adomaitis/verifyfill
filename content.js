let lastFocusedInput = null;
let activeOverlay = null;
let dismissTimer = null;
let pollTimer = null;
let stopWatchTimer = null;
let isWatching = false;
const shownMessageIds = new Set();

const POLL_MS = 8000;
const WATCH_GRACE_MS = 120000;

function isExtensionValid() {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function invalidateExtension() {
  isWatching = false;
  clearInterval(pollTimer);
  pollTimer = null;
  clearTimeout(stopWatchTimer);
  stopWatchTimer = null;
  dismissOverlay();
}

function safeSendMessage(message) {
  if (!isExtensionValid()) {
    invalidateExtension();
    return;
  }

  try {
    chrome.runtime.sendMessage(message, () => {
      if (chrome.runtime.lastError) {
        invalidateExtension();
      }
    });
  } catch {
    invalidateExtension();
  }
}

document.addEventListener(
  "focusin",
  (e) => {
    const el = e.target;
    if (isOtpInput(el)) {
      lastFocusedInput = el;
      startWatch();
    }
  },
  true
);

document.addEventListener(
  "focusout",
  (e) => {
    if (!isOtpInput(e.target)) return;
    clearTimeout(stopWatchTimer);
    stopWatchTimer = setTimeout(stopWatch, WATCH_GRACE_MS);
  },
  true
);

document.addEventListener(
  "input",
  (e) => {
    if (!isOtpInput(e.target) && !isMultiBoxOtp(e.target)) return;
    const input = isMultiBoxOtp(e.target) ? e.target : findBestOtpInput();
    if (!input) return;

    if (isMultiBoxOtp(input)) {
      const parent = input.closest("form, div, fieldset");
      const boxes = [...parent.querySelectorAll('input[maxlength="1"]')];
      const value = boxes.map((b) => b.value).join("");
      if (boxes.every((b) => b.value) && value.length >= 4) {
        markOtpUsed(null, value);
        stopWatch();
        dismissOverlay();
      }
      return;
    }

    const value = (e.target.value || "").replace(/\s/g, "");
    const maxLen = e.target.maxLength;
    const isComplete =
      (maxLen > 0 && value.length === maxLen) ||
      (maxLen <= 0 && value.length >= 4);
    if (isComplete) {
      markOtpUsed(null, value);
      stopWatch();
      dismissOverlay();
    }
  },
  true
);

chrome.runtime.onMessage.addListener((message) => {
  if (!isExtensionValid()) {
    invalidateExtension();
    return;
  }
  if (message.type === "OTP_DETECTED") {
    showOverlay(message.payload);
  }
});

if (isExtensionValid()) {
  initAutoWatch();
}

function initAutoWatch() {
  if (!isExtensionValid()) return;

  scanForOtpFields();
  scanForVerifyEmailPage();

  const observer = new MutationObserver(() => {
    if (!isExtensionValid()) {
      observer.disconnect();
      invalidateExtension();
      return;
    }
    if (!isWatching) {
      scanForOtpFields();
      scanForVerifyEmailPage();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function scanForVerifyEmailPage() {
  if (isWatching) return;
  const text = document.body?.innerText?.slice(0, 4000)?.toLowerCase() || "";
  if (
    /\b(check your email|verify your email|confirmation email|link we sent|email to verify|click the link|sent you an email|confirm your email|we('ve| have) sent|magic link)\b/.test(
      text
    )
  ) {
    startWatch();
  }
}

function scanForOtpFields() {
  const input = findBestOtpInput();
  if (input) {
    lastFocusedInput = input;
    startWatch();
  }
}

function startWatch() {
  if (!isExtensionValid()) return;

  clearTimeout(stopWatchTimer);
  if (isWatching) return;
  isWatching = true;

  safeSendMessage({ type: "WATCH_START" });
  pollGmail();
  pollTimer = setInterval(pollGmail, POLL_MS);
}

function stopWatch() {
  if (!isWatching) return;
  isWatching = false;
  clearInterval(pollTimer);
  pollTimer = null;
  safeSendMessage({ type: "WATCH_STOP" });
}

function pollGmail() {
  if (!isExtensionValid()) {
    invalidateExtension();
    return;
  }
  safeSendMessage({ type: "WATCH_POLL" });
}

function isLikelyOtpField(el) {
  if (!el || el.tagName !== "INPUT") return false;

  const autocomplete = (el.autocomplete || "").toLowerCase();
  if (autocomplete === "one-time-code") return true;

  const inputMode = (el.inputMode || "").toLowerCase();
  const maxLen = el.maxLength;
  const type = (el.type || "text").toLowerCase();

  if (inputMode === "numeric" && maxLen > 0) return true;
  if (type === "tel" && maxLen > 0) return true;
  if (maxLen >= 4) return true;
  if (maxLen === 1 && isMultiBoxOtp(el)) return true;

  const hint = `${el.name} ${el.id} ${el.placeholder} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
  if (/\b(otp|code|pin|verify|verification|token)\b/.test(hint)) return true;

  return false;
}

function isOtpInput(el) {
  if (!el || !(el instanceof HTMLElement)) return false;

  if (el.tagName === "INPUT") {
    const type = (el.type || "text").toLowerCase();
    if (["hidden", "checkbox", "radio", "submit", "button", "file", "image"].includes(type)) {
      return false;
    }
    return isLikelyOtpField(el) || isMultiBoxOtp(el);
  }

  return false;
}

function showOverlay(payload) {
  const { type, code, url, linkLabel, sender, subject, messageId } = payload;
  const isLink = type === "link" || Boolean(url);

  if (messageId && shownMessageIds.has(messageId)) return;
  if (!isLink && isCodeAlreadyFilled(code)) {
    markEntryUsed(messageId, code, null);
    return;
  }

  dismissOverlay();
  if (messageId) shownMessageIds.add(messageId);

  const overlay = document.createElement("div");
  overlay.className = isLink ? "vf-prompt vf-prompt-link" : "vf-prompt";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", isLink ? "Email link" : "Verification code");

  const row = document.createElement("div");
  row.className = "vf-row";

  const main = document.createElement("div");
  main.className = "vf-main";

  const mainEl = document.createElement("span");
  mainEl.className = isLink ? "vf-link-text" : "vf-code";
  mainEl.textContent = isLink ? (linkLabel || "Verification link") : code;

  const meta = document.createElement("span");
  meta.className = "vf-meta";
  meta.textContent = subject ? `${sender || "Gmail"} · ${truncate(subject, 36)}` : (sender || "Gmail");

  main.appendChild(mainEl);
  main.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "vf-actions";

  const actionBtn = document.createElement("button");
  actionBtn.type = "button";
  actionBtn.className = "vf-fill";
  actionBtn.textContent = isLink ? "Open" : "Fill";
  actionBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isLink) {
      openVerificationLink(url, messageId);
    } else {
      autofillCode(code, messageId);
    }
    dismissOverlay();
  });

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "vf-close";
  dismissBtn.textContent = "×";
  dismissBtn.setAttribute("aria-label", "Dismiss");
  dismissBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissOverlay();
  });

  actions.appendChild(actionBtn);
  actions.appendChild(dismissBtn);

  row.appendChild(main);
  row.appendChild(actions);
  overlay.appendChild(row);

  if (!isLink) {
    overlay.addEventListener("click", () => {
      autofillCode(code, messageId);
      dismissOverlay();
    });
  }

  const root = document.body || document.documentElement;
  root.appendChild(overlay);
  positionOverlay(overlay);
  activeOverlay = overlay;

  dismissTimer = setTimeout(dismissOverlay, 120000);
}

function openVerificationLink(url, messageId) {
  if (!url) return;
  markEntryUsed(messageId, null, url);
  stopWatch();
  window.location.assign(url);
}

function positionOverlay(overlay) {
  if (lastFocusedInput && document.contains(lastFocusedInput)) {
    const rect = lastFocusedInput.getBoundingClientRect();
    const overlayHeight = 56;
    let top = rect.bottom + 8;
    let left = rect.left;

    if (rect.bottom + overlayHeight > window.innerHeight) {
      top = rect.top - overlayHeight - 8;
    }

    left = Math.max(8, Math.min(left, window.innerWidth - 280));
    top = Math.max(8, top);

    overlay.style.top = `${top}px`;
    overlay.style.left = `${left}px`;
    overlay.style.right = "auto";
  } else {
    overlay.classList.add("vf-prompt-fallback");
  }
}

function dismissOverlay() {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
  }
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function autofillCode(code, messageId) {
  const target = lastFocusedInput && document.contains(lastFocusedInput)
    ? lastFocusedInput
    : findBestOtpInput();

  if (!target) {
    navigator.clipboard?.writeText(code);
    markOtpUsed(messageId, code);
    stopWatch();
    return;
  }

  target.focus();

  if (isMultiBoxOtp(target)) {
    fillMultiBox(target, code);
  } else {
    fillSingleInput(target, code);
  }

  navigator.clipboard?.writeText(code).catch(() => {});
  markOtpUsed(messageId, code);
  stopWatch();
}

function markEntryUsed(messageId, code, url) {
  if (messageId) shownMessageIds.add(messageId);
  safeSendMessage({ type: "OTP_USED", messageId, code, url });
}

function markOtpUsed(messageId, code) {
  markEntryUsed(messageId, code, null);
}

function isCodeAlreadyFilled(code) {
  const input = lastFocusedInput && document.contains(lastFocusedInput)
    ? lastFocusedInput
    : findBestOtpInput();

  if (!input) return false;

  if (isMultiBoxOtp(input)) {
    const parent = input.closest("form, div, fieldset");
    if (!parent) return false;
    const boxes = [...parent.querySelectorAll('input[maxlength="1"]')];
    const value = boxes.map((b) => b.value).join("");
    return value === code;
  }

  return (input.value || "").replace(/\s/g, "") === code;
}

function findBestOtpInput() {
  const inputs = [...document.querySelectorAll("input, textarea, [contenteditable=true]")];
  return inputs.find((el) => isLikelyOtpField(el) || isMultiBoxOtp(el)) || null;
}

function isMultiBoxOtp(el) {
  if (el.tagName !== "INPUT") return false;
  if (el.maxLength === 1) {
    const parent = el.closest("form, div, fieldset");
    if (!parent) return false;
    const siblings = parent.querySelectorAll('input[maxlength="1"]');
    return siblings.length >= 4;
  }
  return false;
}

function fillMultiBox(startInput, code) {
  const parent = startInput.closest("form, div, fieldset");
  const boxes = [...parent.querySelectorAll('input[maxlength="1"]')];
  const startIdx = Math.max(0, boxes.indexOf(startInput));

  for (let i = 0; i < code.length && startIdx + i < boxes.length; i++) {
    const box = boxes[startIdx + i];
    setInputValue(box, code[i]);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const lastBox = boxes[Math.min(startIdx + code.length - 1, boxes.length - 1)];
  lastBox?.focus();
}

function fillSingleInput(el, code) {
  if (el.isContentEditable) {
    el.textContent = code;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  setInputValue(el, code);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function setInputValue(el, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )?.set;

  if (nativeSetter && el.tagName === "INPUT") {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }
}
