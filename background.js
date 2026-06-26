import {
  extractOtpFromText,
  extractTextFromPayload,
  getHeader,
  parseSender,
} from "./otp-parser.js";
import {
  extractVerificationLink,
  extractHtmlFromPayload,
  getLinkLabel,
} from "./link-parser.js";

const POLL_ALARM = "gmail-otp-poll";
const POLL_INTERVAL_MINUTES = 1;
const CODE_MAX_AGE_MS = 15 * 60 * 1000;
const seenMessageIds = new Set();
const usedMessageIds = new Set();
const usedCodes = new Set();
const usedUrls = new Set();
const watchingTabs = new Map();

let lastDetectedCode = null;
let storageLoaded = loadStoredIds();

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_INTERVAL_MINUTES });
});

chrome.runtime.onStartup.addListener(() => {
  storageLoaded = loadStoredIds();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) {
    checkGmailForOtps();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  watchingTabs.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SIGN_IN") {
    signIn().then(sendResponse);
    return true;
  }
  if (message.type === "SIGN_OUT") {
    signOut().then(sendResponse);
    return true;
  }
  if (message.type === "GET_STATUS") {
    getStatus().then(sendResponse);
    return true;
  }
  if (message.type === "CHECK_NOW") {
    checkGmailForOtps({ forceShow: true, targetTabId: sender.tab?.id }).then(sendResponse);
    return true;
  }
  if (message.type === "SHOW_ON_PAGE") {
    showOnTab(sender.tab?.id, message.payload || lastDetectedCode).then(sendResponse);
    return true;
  }
  if (message.type === "WATCH_START") {
    if (sender.tab?.id) {
      watchingTabs.set(sender.tab.id, { startedAt: Date.now() });
      checkGmailForOtps({ targetTabId: sender.tab.id });
    }
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === "WATCH_STOP") {
    if (sender.tab?.id) watchingTabs.delete(sender.tab.id);
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === "WATCH_POLL") {
    checkGmailForOtps({ targetTabId: sender.tab?.id }).then(sendResponse);
    return true;
  }
  if (message.type === "OTP_USED") {
    markEntryUsed(message.messageId, message.code, message.url).then(() =>
      sendResponse({ ok: true })
    );
    return true;
  }
});

async function getAuthToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(token);
    });
  });
}

async function signIn() {
  try {
    const token = await getAuthToken(true);
    const email = await fetchUserEmail(token);
    await chrome.storage.local.set({ signedIn: true, email });
    await checkGmailForOtps();
    return { ok: true, email };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function signOut() {
  try {
    const token = await getAuthToken(false);
    if (token) {
      await new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token }, resolve);
      });
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
    }
  } catch {
    // ignore revoke errors
  }
  await chrome.storage.local.set({ signedIn: false, email: null });
  lastDetectedCode = null;
  watchingTabs.clear();
  seenMessageIds.clear();
  usedMessageIds.clear();
  usedCodes.clear();
  usedUrls.clear();
  await chrome.storage.local.remove([
    "seenOtpMessageIds",
    "usedOtpMessageIds",
    "usedOtpCodes",
    "usedVerificationUrls",
  ]);
  return { ok: true };
}

async function getStatus() {
  const { signedIn, email, monitoring } = await chrome.storage.local.get([
    "signedIn",
    "email",
    "monitoring",
  ]);

  let hasToken = false;
  try {
    await getAuthToken(false);
    hasToken = true;
  } catch {
    hasToken = false;
  }

  return {
    signedIn: signedIn && hasToken,
    email: email || null,
    monitoring: monitoring !== false,
    lastCode: lastDetectedCode && !isEntryUsed(lastDetectedCode) ? lastDetectedCode : null,
  };
}

async function loadStoredIds() {
  const { seenOtpMessageIds = [], usedOtpMessageIds = [], usedOtpCodes = [], usedVerificationUrls = [] } =
    await chrome.storage.local.get([
      "seenOtpMessageIds",
      "usedOtpMessageIds",
      "usedOtpCodes",
      "usedVerificationUrls",
    ]);
  seenMessageIds.clear();
  usedMessageIds.clear();
  usedCodes.clear();
  usedUrls.clear();
  seenOtpMessageIds.forEach((id) => seenMessageIds.add(id));
  usedOtpMessageIds.forEach((id) => usedMessageIds.add(id));
  usedOtpCodes.forEach((code) => usedCodes.add(code));
  usedVerificationUrls.forEach((url) => usedUrls.add(url));
}

async function persistStoredIds() {
  await chrome.storage.local.set({
    seenOtpMessageIds: [...seenMessageIds].slice(-300),
    usedOtpMessageIds: [...usedMessageIds].slice(-300),
    usedOtpCodes: [...usedCodes].slice(-100),
    usedVerificationUrls: [...usedUrls].slice(-100),
  });
}

function isEntryUsed(entry) {
  if (entry?.messageId && usedMessageIds.has(entry.messageId)) return true;
  if (entry?.code && usedCodes.has(entry.code)) return true;
  if (entry?.url && usedUrls.has(entry.url)) return true;
  return false;
}

async function markEntryUsed(messageId, code, url) {
  if (messageId) {
    usedMessageIds.add(messageId);
    seenMessageIds.add(messageId);
  }
  if (code) usedCodes.add(code);
  if (url) usedUrls.add(url);
  if (
    lastDetectedCode &&
    (lastDetectedCode.messageId === messageId ||
      lastDetectedCode.code === code ||
      lastDetectedCode.url === url)
  ) {
    lastDetectedCode = null;
  }
  await persistStoredIds();
}

async function markOtpSeen(messageId) {
  if (!messageId) return;
  seenMessageIds.add(messageId);
  await persistStoredIds();
}

async function fetchUserEmail(token) {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch user info");
  const data = await res.json();
  return data.email;
}

async function checkGmailForOtps({ forceShow = false, targetTabId = null } = {}) {
  await storageLoaded;

  const { monitoring } = await chrome.storage.local.get("monitoring");
  if (monitoring === false) return { codes: [] };

  let token;
  try {
    token = await getAuthToken(false);
  } catch {
    return { codes: [], error: "Not signed in" };
  }

  const afterEpoch = Math.floor((Date.now() - CODE_MAX_AGE_MS) / 1000);
  const query = `in:inbox after:${afterEpoch}`;

  try {
    const listRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!listRes.ok) {
      if (listRes.status === 401) {
        await signOut();
        return { codes: [], error: "Session expired" };
      }
      throw new Error(`Gmail API error: ${listRes.status}`);
    }

    const listData = await listRes.json();
    const messages = listData.messages || [];
    const detected = [];
    let newEntry = null;

    for (const msg of messages) {
      if (usedMessageIds.has(msg.id)) continue;

      const alreadySeen = seenMessageIds.has(msg.id);

      const detailRes = await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!detailRes.ok) continue;

      const detail = await detailRes.json();
      const headers = detail.payload?.headers || [];
      const subject = getHeader(headers, "Subject");
      const from = getHeader(headers, "From");
      const bodyText = extractTextFromPayload(detail.payload);
      const html = extractHtmlFromPayload(detail.payload);
      const combined = `${subject}\n${bodyText}`;

      const messageAge = Date.now() - Number(detail.internalDate || 0);
      if (messageAge > CODE_MAX_AGE_MS) continue;

      const code = extractOtpFromText(combined);
      const url = code ? null : extractVerificationLink(subject, bodyText, html);
      if (!code && !url) continue;

      const entry = {
        type: url ? "link" : "otp",
        code: code || null,
        url: url || null,
        linkLabel: url ? getLinkLabel(url) : null,
        sender: parseSender(from),
        subject,
        messageId: msg.id,
        detectedAt: Date.now(),
      };

      if (isEntryUsed(entry)) continue;

      detected.push(entry);
      lastDetectedCode = entry;

      if (!alreadySeen) {
        await markOtpSeen(msg.id);
        newEntry = entry;
      }
    }

    let toShow = null;
    if (newEntry) {
      toShow = newEntry;
    } else if (forceShow && lastDetectedCode && !isEntryUsed(lastDetectedCode)) {
      toShow = lastDetectedCode;
    }

    if (toShow) {
      await showOnWatchingTabs(toShow, targetTabId);
    }

    const returnedCodes = detected.filter((e) => !isEntryUsed(e));
    if (returnedCodes.length === 0 && forceShow && lastDetectedCode && !isEntryUsed(lastDetectedCode)) {
      returnedCodes.push(lastDetectedCode);
    }

    return { codes: returnedCodes, checked: messages.length };
  } catch (err) {
    return { codes: [], error: err.message };
  }
}

async function showOnWatchingTabs(entry, preferredTabId) {
  const tabIds = new Set();

  if (preferredTabId) tabIds.add(preferredTabId);
  for (const tabId of watchingTabs.keys()) tabIds.add(tabId);

  if (tabIds.size > 0) {
    for (const tabId of tabIds) {
      await showOnTab(tabId, entry);
    }
    return;
  }

  await showOnTab(null, entry);
}

async function showOnTab(tabId, entry) {
  if (!entry || isEntryUsed(entry)) {
    return { ok: false, error: "No code to show" };
  }

  let tab;
  if (tabId) {
    tab = await chrome.tabs.get(tabId).catch(() => null);
  } else {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = active;
  }

  if (!tab?.id || !tab.url?.startsWith("http")) {
    return { ok: false, error: "Open a website tab first" };
  }

  const payload = { type: "OTP_DETECTED", payload: entry };
  const sent = await sendOtpToTab(tab.id, payload);
  return sent ? { ok: true } : { ok: false, error: "Could not reach page — try refreshing the tab" };
}

async function sendOtpToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId, allFrames: true },
        files: ["overlay.css"],
      });
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(tabId, message);
      return true;
    } catch {
      return false;
    }
  }
}

storageLoaded.then(() => checkGmailForOtps());
