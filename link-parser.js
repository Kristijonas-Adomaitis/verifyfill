import { decodeBase64Url } from "./otp-parser.js";

const AUTH_KEYWORDS =
  /\b(code|otp|pin|verification|verify|authenticate|login|log\s*in|sign[\s-]?in|password|security|token|magic|confirm|passcode|activate|activation|welcome)\b/i;

const LINK_PATH_KEYWORDS =
  /(verify|confirm|activation|activate|magic|auth|token|validate|email[-_]?verif|account\/confirm|signup\/confirm|sign[-_]?up|password\/reset|reset[-_]?password|continue|callback|oauth)/i;

const LINK_ANCHOR_KEYWORDS =
  /\b(verify|confirm|activate|click|continue|complete|sign\s*in|log\s*in|get\s*started|access\s*account)\b/i;

const LINK_NEGATIVE =
  /(unsubscribe|preferences|privacy|terms|policy|manage\s*subscription|list-manage|mailto:|facebook\.com|twitter\.com|instagram\.com|linkedin\.com\/(?!login)|youtube\.com|google\.com\/maps|play\.google\.com|apps\.apple\.com|trustpilot|survey|feedback)/i;

const MIN_SCORE = 5;

export function extractVerificationLink(subject, plainText, html) {
  const combined = `${subject}\n${plainText}`;
  if (!AUTH_KEYWORDS.test(combined) && !isVerifySubject(subject)) return null;

  const candidates = collectLinks(plainText, html);
  if (!candidates.length) return null;

  let best = null;
  let bestScore = MIN_SCORE;

  for (const link of candidates) {
    const score = scoreLink(link, subject, plainText);
    if (score > bestScore) {
      bestScore = score;
      best = link;
    }
  }

  return best?.url || null;
}

function isVerifySubject(subject) {
  return /\b(verify|confirm|activate|welcome|sign\s*in|login|complete\s*your)\b/i.test(subject || "");
}

function collectLinks(plainText, html) {
  const found = new Map();

  function add(url, anchorText = "", source = "text") {
    const normalized = normalizeUrl(url);
    if (!normalized || found.has(normalized)) return;
    found.set(normalized, { url: normalized, anchorText: anchorText.trim(), source });
  }

  if (html) {
    for (const match of html.matchAll(
      /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
    )) {
      const anchorText = stripTags(match[2]);
      add(match[1], anchorText, "html");
    }
  }

  if (plainText) {
    for (const match of plainText.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
      add(match[0]);
    }
  }

  return [...found.values()];
}

function scoreLink(link, subject, plainText) {
  let score = 0;
  const { url, anchorText } = link;

  try {
    const parsed = new URL(url);
    const full = `${parsed.pathname}${parsed.search}`.toLowerCase();

    if (LINK_PATH_KEYWORDS.test(full)) score += 10;
    if (parsed.search.length > 20) score += 4;
    if (LINK_ANCHOR_KEYWORDS.test(anchorText)) score += 8;
    if (link.source === "html" && anchorText.length > 0) score += 3;

    if (AUTH_KEYWORDS.test(anchorText)) score += 4;
    if (isVerifySubject(subject)) score += 3;

    if (LINK_NEGATIVE.test(url)) score -= 25;
    if (LINK_NEGATIVE.test(anchorText)) score -= 20;
    if (parsed.hostname.includes("google.com") && parsed.pathname === "/url") {
      // Gmail redirect wrapper — unwrap scores like the real link
      score += 2;
    }
    if (url.length > 500) score -= 5;
  } catch {
    return -99;
  }

  return score;
}

function normalizeUrl(raw) {
  if (!raw) return null;

  let url = raw
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();

  // Gmail / Google redirect wrappers
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname.includes("google.com") &&
      parsed.pathname === "/url" &&
      parsed.searchParams.has("q")
    ) {
      url = parsed.searchParams.get("q");
    }
  } catch {
    return null;
  }

  if (!/^https?:\/\//i.test(url)) return null;
  if (LINK_NEGATIVE.test(url)) return null;

  return url;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function extractHtmlFromPayload(payload) {
  if (!payload) return "";

  const parts = [];

  function walk(part) {
    if (!part) return;
    if (part.mimeType === "text/html" && part.body?.data) {
      parts.push(decodeBase64Url(part.body.data));
    }
    if (part.parts) {
      for (const child of part.parts) {
        walk(child);
      }
    }
  }

  walk(payload);
  return parts.join("\n");
}

export function getLinkLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host;
  } catch {
    return "verification link";
  }
}
