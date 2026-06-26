# Gmail OTP Autofill

A Chrome extension that detects OTP / verification codes in your Gmail and offers one-click autofill — similar to Apple's security code autofill on iPhone, iPad, and Mac.

When a verification email arrives, a floating overlay appears near the input field you're typing in:

> **From Google** · `847291` · Your verification code

Click it and the code is filled in automatically.

## How it works

```
Gmail (new OTP email)
        ↓
Background worker polls Gmail API every 30s
        ↓
OTP parser extracts code from subject + body
        ↓
Content script shows overlay near focused input
        ↓
You click → code autofilled + copied to clipboard
```

| File | Role |
|------|------|
| `background.js` | Polls Gmail API, parses emails, broadcasts detected codes |
| `otp-parser.js` | Regex-based OTP extraction with false-positive filtering |
| `content.js` | Tracks focused inputs, renders overlay, handles autofill |
| `overlay.css` | Apple-inspired dark floating card styles |
| `popup.html/js` | Sign in, status, manual check, test overlay |

## Setup

### 1. Load the extension (get your Extension ID)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Copy the **Extension ID** (e.g. `abcdefghijklmnop...`)

### 2. Create Google Cloud OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (e.g. "Gmail OTP Autofill")
3. Enable the **Gmail API** (APIs & Services → Library → search "Gmail API")
4. Configure the **OAuth consent screen**:
   - User type: **External** (or Internal if using Google Workspace)
   - Add scopes: `gmail.readonly`, `userinfo.email`
   - Add yourself as a **Test user**
5. Create credentials:
   - APIs & Services → Credentials → **Create Credentials** → **OAuth client ID**
   - Application type: **Chrome Extension**
   - Item ID: paste your Extension ID from step 1
6. Copy the **Client ID**

### 3. Add your Client ID to the manifest

Open `manifest.json` and replace the placeholder:

```json
"client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com"
```

Reload the extension in `chrome://extensions`.

### 4. Sign in

1. Click the extension icon in the toolbar
2. Click **Sign in with Google**
3. Grant read-only Gmail access

## Usage

1. Go to a website that asks for a verification code
2. Click into the code input field
3. Trigger the OTP email (e.g. click "Send code")
4. Within ~30 seconds, the overlay appears above the input
5. Click **Autofill** (or click anywhere on the card)

### Test without a real email

1. Sign in and open any page with an input field (e.g. google.com)
2. Click into the search box
3. Open the extension popup → **Test overlay**
4. A test code `847291` should appear — click Autofill

## Privacy

- Only requests **read-only** Gmail access (`gmail.readonly`)
- Email content is processed **entirely in your browser**
- No data is sent to any third-party server
- OAuth tokens are stored in Chrome's identity cache

## Supported OTP formats

- 4–8 digit numeric codes (`123456`, `8392`)
- Alphanumeric codes (`AB3F92`, `G-123456`)
- Multi-box OTP inputs (6 separate single-character fields)
- Standard text, number, password, and contenteditable inputs

## Limitations

- Polls Gmail every 30 seconds (not instant push) — use **Check now** for immediate scan
- Only checks **unread inbox** messages from the last 5 minutes
- Requires your own Google Cloud OAuth app (Google policy for Gmail access)
- Chrome only (uses `chrome.identity` API)

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Sign in failed" | Verify Client ID in manifest matches your Chrome Extension OAuth credential |
| "Access blocked" | Add yourself as a Test user on the OAuth consent screen |
| Overlay doesn't appear | Click into the OTP input first, then wait or hit **Check now** |
| Code not detected | Email must contain keywords like "code", "OTP", "verification" |
| Session expired | Sign out and sign in again from the popup |
