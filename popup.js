const $ = (id) => document.getElementById(id);

const statusDot = $("status-dot");
const statusText = $("status-text");
const statusEmail = $("status-email");
const lastCodeEl = $("last-code");
const lastCodeValue = $("last-code-value");
const lastCodeSender = $("last-code-sender");
const btnSignIn = $("btn-sign-in");
const btnSignOut = $("btn-sign-out");
const btnCheck = $("btn-check");
const btnShowOnPage = $("btn-show-on-page");
const errorEl = $("error");

btnSignIn.addEventListener("click", async () => {
  showError("");
  btnSignIn.disabled = true;
  btnSignIn.textContent = "Signing in…";

  const result = await sendMessage({ type: "SIGN_IN" });

  btnSignIn.disabled = false;
  btnSignIn.textContent = "Sign in with Google";

  if (!result.ok) {
    showError(result.error || "Sign in failed");
    return;
  }

  await refreshStatus();
});

btnSignOut.addEventListener("click", async () => {
  await sendMessage({ type: "SIGN_OUT" });
  await refreshStatus();
});

btnCheck.addEventListener("click", async () => {
  btnCheck.disabled = true;
  btnCheck.textContent = "Checking…";

  const result = await sendMessage({ type: "CHECK_NOW" });

  btnCheck.disabled = false;
  btnCheck.textContent = "Check now";

  if (result.error) {
    showError(result.error);
  } else if (result.codes?.length) {
    showError("");
    await refreshStatus();
    window.close();
  } else if (result.checked > 0) {
    showError("No code in recent mail yet.");
    setTimeout(() => showError(""), 4000);
  } else {
    showError("No mail in the last 15 minutes.");
    setTimeout(() => showError(""), 4000);
  }
});

btnShowOnPage.addEventListener("click", async () => {
  const result = await sendMessage({ type: "SHOW_ON_PAGE" });
  if (result?.error) {
    showError(result.error);
    return;
  }
  window.close();
});

async function refreshStatus() {
  const status = await sendMessage({ type: "GET_STATUS" });

  if (status.signedIn) {
    statusDot.className = "dot active";
    statusText.textContent = "Connected";
    statusEmail.textContent = status.email || "";
    btnSignIn.classList.add("hidden");
    btnSignOut.classList.remove("hidden");
    btnCheck.classList.remove("hidden");
  } else {
    statusDot.className = "dot inactive";
    statusText.textContent = "Not signed in";
    statusEmail.textContent = "Sign in with your Gmail account.";
    btnSignIn.classList.remove("hidden");
    btnSignOut.classList.add("hidden");
    btnCheck.classList.add("hidden");
  }

  if (status.lastCode) {
    lastCodeEl.classList.remove("hidden");
    if (status.lastCode.type === "link" || status.lastCode.url) {
      lastCodeValue.textContent = status.lastCode.linkLabel || "Verification link";
      lastCodeSender.textContent = status.lastCode.sender;
    } else {
      lastCodeValue.textContent = status.lastCode.code;
      lastCodeSender.textContent = status.lastCode.sender;
    }
    btnShowOnPage.classList.remove("hidden");
  } else {
    lastCodeEl.classList.add("hidden");
    btnShowOnPage.classList.add("hidden");
  }
}

function showError(msg) {
  if (msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
  } else {
    errorEl.classList.add("hidden");
  }
}

function sendMessage(msg) {
  return chrome.runtime.sendMessage(msg);
}

refreshStatus();
