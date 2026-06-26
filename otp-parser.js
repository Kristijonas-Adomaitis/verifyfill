const AUTH_KEYWORDS =
  /\b(code|otp|pin|verification|verify|authenticate|login|log\s*in|sign[\s-]?in|password|security|token|magic|confirm|passcode|2fa|two[\s-]?factor|one[\s-]?time)\b/i;

const CONTEXT_KEYWORDS =
  /\b(enter|use|copy|paste|type|following|your|provided|below|above|expires?|valid)\b/i;

const NEGATIVE_CONTEXT =
  /\b(phone|mobile|call|order|invoice|tracking|shipment|coupon|unsubscribe|sale)\b/i;

const COMMON_WORDS = new Set([
  "CODE", "LOGIN", "VERIFY", "PIN", "OTP", "EMAIL", "CLICK", "HERE", "FROM",
  "YOUR", "THE", "THIS", "THAT", "WITH", "HTTP", "HTTPS", "TRUE", "FALSE",
  "SIGN", "ACCOUNT", "HELP", "SUPPORT", "NOT", "LINEAR", "TWITCH", "DISCORD",
]);

// Only reject obviously-too-short; no upper bound — each site picks its own length
const MIN_CODE_LEN = 4;
const MAX_CODE_LEN = 64;
const MIN_SCORE = 8;

export function extractOtpFromText(text) {
  if (!text?.trim()) return null;
  if (!looksLikeAuthEmail(text)) return null;

  const candidates = collectCandidates(text);
  if (!candidates.length) return null;

  let best = null;
  let bestScore = MIN_SCORE;

  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, text);
    if (score > bestScore) {
      bestScore = score;
      best = candidate.value;
    }
  }

  return best;
}

function looksLikeAuthEmail(text) {
  if (AUTH_KEYWORDS.test(text)) return true;
  const subject = text.split("\n")[0] || "";
  return /\b(login|sign[\s-]?in|verify|verification|security|otp|code|authenticate)\b/i.test(
    subject
  );
}

const FRAGMENT_WORDS = [
  "LOGIN", "LOG", "SIGN", "VERIFY", "VERIFICATION", "CODE", "LINEAR", "TWITCH",
  "DISCORD", "GITHUB", "GOOGLE", "APPLE", "ACCOUNT", "SECURE", "SECURITY",
  "PASSWORD", "CONFIRM", "AUTHENTICATE", "FOR", "YOUR", "THE", "FROM", "WITH",
  "EMAIL", "NOTIFICATION", "WELCOME", "TEAM", "HELP", "SUPPORT", "OTP",
];

function collectCandidates(text) {
  const found = new Map();
  const subjectEnd = text.indexOf("\n");
  const bodyStart = subjectEnd === -1 ? text.length : subjectEnd + 1;

  function add(raw, index, sourceLine = "", { fromLine = false } = {}) {
    const bare = raw.replace(/[\s-]/g, "").toUpperCase();
    if (bare.length < MIN_CODE_LEN || bare.length > MAX_CODE_LEN) return;
    if (!/^[A-Z0-9]+$/.test(bare)) return;
    if (sourceLine && isDictionaryPhrase(sourceLine, bare)) return;
    if (looksLikeComposedPhrase(bare)) return;

    const hasDigit = /\d/.test(bare);
    const inBody = index >= bodyStart;

    if (!hasDigit) {
      // Letter-only codes: must be alone on a body line, not a title or prose fragment
      if (!fromLine || !inBody) return;
      if (!lineIsOnlyBare(sourceLine, bare)) return;
    } else if (!inBody && !/\d{4,}/.test(bare)) {
      // Digit codes on subject need a substantial numeric part (e.g. Twitch subject prefix)
      return;
    }

    if (!found.has(bare)) {
      found.set(bare, { value: bare, index, raw, sourceLine, hasDigit, fromLine });
    }
  }

  const lines = text.split(/\n+/);
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const lineStart = offset;

    if (trimmed) {
      const compact = trimmed.replace(/[\s-]/g, "");
      if (compact.length >= MIN_CODE_LEN && compact.length <= MAX_CODE_LEN) {
        if (/^[A-Za-z0-9]+$/.test(compact)) {
          add(trimmed, lineStart, trimmed, { fromLine: true });
        }
      }
    }

    offset += line.length + 1;
  }

  for (const match of text.matchAll(/(?<![A-Za-z0-9])(\d{4,32})(?![A-Za-z0-9])/g)) {
    add(match[1], match.index);
  }

  for (const match of text.matchAll(/(?<![A-Za-z0-9])([A-Za-z0-9]*\d[A-Za-z0-9]{3,31})(?![A-Za-z0-9])/g)) {
    add(match[1], match.index);
  }

  for (const match of text.matchAll(
    /(?<![A-Za-z0-9])((?:[A-Za-z0-9][\s-]+){3,31}[A-Za-z0-9])(?![A-Za-z0-9])/g
  )) {
    add(match[1], match.index);
  }

  return [...found.values()];
}

function lineIsOnlyBare(line, bare) {
  return line.trim().replace(/[\s-]/g, "").toUpperCase() === bare;
}

/** "LOGINFORLINEAR" built from LOGIN + FOR + LINEAR */
function looksLikeComposedPhrase(bare) {
  if (!/^[A-Z]+$/.test(bare) || bare.length < 6) return false;

  const words = [...FRAGMENT_WORDS].sort((a, b) => b.length - a.length);
  let remaining = bare;
  let wordCount = 0;

  while (remaining.length > 0) {
    const match = words.find((w) => remaining.startsWith(w));
    if (!match) return false;
    remaining = remaining.slice(match.length);
    wordCount++;
  }

  return wordCount >= 2;
}

/** "Login for Linear" → LOGINFORLINEAR — a title, not a code */
function isDictionaryPhrase(line, bare) {
  const words = line.trim().split(/\s+/);
  if (words.length < 2) return false;
  if (!words.every((w) => /^[a-zA-Z]{2,}$/.test(w))) return false;
  return words.join("").toUpperCase() === bare;
}

function scoreCandidate(candidate, text) {
  const { value, index } = candidate;
  let score = 0;

  const ctxBefore = text.slice(Math.max(0, index - 120), index);
  const ctxAfter = text.slice(index, index + value.length + 120);
  const context = `${ctxBefore} ${ctxAfter}`;

  // --- Positive: how prominently is this presented as THE code? ---

  if (lineIsOnlyToken(text, index, value)) score += 15;
  else if (isOnOwnLine(text, index, value)) score += 10;

  const authDist = distanceToKeyword(context, AUTH_KEYWORDS);
  if (authDist !== null) score += Math.max(0, 10 - Math.floor(authDist / 15));

  const ctxDist = distanceToKeyword(context, CONTEXT_KEYWORDS);
  if (ctxDist !== null) score += Math.max(0, 6 - Math.floor(ctxDist / 20));

  if (isIsolated(text, index, value.length)) score += 2;

  // --- Negative: obviously not a human-facing OTP ---

  if (COMMON_WORDS.has(value)) score -= 25;
  if (!candidate.hasDigit && /^[A-Z]+$/.test(value)) {
    // Letter-only codes need stronger "copy this" context
    if (!CONTEXT_KEYWORDS.test(context)) score -= 10;
  }
  if (candidate.sourceLine && isDictionaryPhrase(candidate.sourceLine, value)) score -= 30;
  if (looksLikeComposedPhrase(value)) score -= 30;

  // Subject lines are titles, not codes — require strong body context
  const subjectEnd = text.indexOf("\n");
  if (subjectEnd !== -1 && index < subjectEnd) score -= 20;

  if (isYear(value)) score -= 25;
  if (isInUrl(text, index, value)) score -= 25;
  if (isInEmailAddress(text, index, value)) score -= 25;
  if (isInIpAddress(text, index, value)) score -= 20;
  if (isInDateContext(context)) score -= 12;
  if (NEGATIVE_CONTEXT.test(context)) score -= 8;
  if (/^0+$/.test(value) || /^(\d)\1{3,}$/.test(value)) score -= 15;

  // UUIDs / long hex session tokens — not copy-paste OTPs
  if (/^[A-F0-9]{20,}$/i.test(value)) score -= 20;

  // No length-based scoring — 4, 6, 8, 10, 12 are all equally valid

  return score;
}

function distanceToKeyword(text, pattern) {
  const match = pattern.exec(text);
  if (!match) return null;
  return match.index;
}

function lineIsOnlyToken(text, index, value) {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const lineEnd = text.indexOf("\n", index);
  const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
  return line.replace(/[\s-]/g, "").toUpperCase() === value;
}

function isOnOwnLine(text, index, value) {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const lineEnd = text.indexOf("\n", index);
  const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
  const lineBare = line.replace(/[\s-]/g, "").toUpperCase();
  const tokenRatio = value.length / Math.max(lineBare.length, 1);
  return tokenRatio >= 0.6;
}

function isIsolated(text, index, length) {
  const before = text[index - 1] || " ";
  const after = text[index + length] || " ";
  return !/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after);
}

function isYear(value) {
  if (!/^\d{4}$/.test(value)) return false;
  const n = parseInt(value, 10);
  return n >= 1990 && n <= 2039;
}

function isInUrl(text, index, value) {
  const start = Math.max(0, index - 40);
  const chunk = text.slice(start, index + value.length + 10);
  const localIdx = index - start;
  const before = chunk.slice(0, localIdx);
  return /https?:\/\/\S*$/.test(before) || /[?&]\w*=\S*$/.test(before);
}

function isInEmailAddress(text, index, value) {
  const window = text.slice(Math.max(0, index - 30), index + value.length + 30);
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(window) && window.includes(value);
}

function isInIpAddress(text, index, value) {
  const window = text.slice(Math.max(0, index - 10), index + value.length + 10);
  return /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(window);
}

function isInDateContext(context) {
  return (
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}/i.test(context) ||
    /\d{1,2}:\d{2}(:\d{2})?/.test(context)
  );
}

export function decodeBase64Url(data) {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

export function extractTextFromPayload(payload) {
  if (!payload) return "";

  const plainParts = [];
  const htmlParts = [];

  function walk(part) {
    if (!part) return;

    if (part.body?.data) {
      const decoded = decodeBase64Url(part.body.data);
      if (part.mimeType === "text/plain") {
        plainParts.push(decoded);
      } else if (part.mimeType === "text/html") {
        htmlParts.push(decoded);
      } else if (!part.mimeType) {
        plainParts.push(decoded);
      }
    }

    if (part.parts) {
      for (const child of part.parts) {
        walk(child);
      }
    }
  }

  walk(payload);

  if (plainParts.length) {
    return plainParts.join("\n");
  }

  return htmlParts.map(stripHtml).join("\n");
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "\n")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|td|tr|li|h\d|table|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function getHeader(headers, name) {
  const header = headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || "";
}

export function parseSender(fromHeader) {
  const match = fromHeader.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  const emailMatch = fromHeader.match(/@([^.]+)/);
  if (emailMatch) return emailMatch[1];
  return fromHeader.split("@")[0] || "Unknown";
}
