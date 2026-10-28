import "./auth.css";
const googleIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.2h5.4a4.7 4.7 0 0 1-2 3.1V20h3.3c1.9-1.8 2.9-4.4 2.9-7.8Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.5l-3.3-2.6c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.7-5.6-4H3v2.7A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.8A6 6 0 0 1 6 12c0-.6.1-1.2.3-1.8V7.5H3A10 10 0 0 0 2 12c0 1.6.4 3.1 1 4.5l3.4-2.7Z"/><path fill="#EA4335" d="M12 6.2c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9 5.5l3.4 2.7C7.2 7.9 9.4 6.2 12 6.2Z"/></svg>';
export function accountPage({ root, api, bindForm, message }) {
  document.body.classList.add("auth-page");
  const route = location.pathname.split("/").pop(),
    signup = route === "signup",
    recovery = route === "recover",
    reset = route === "reset",
    confirm = route === "confirm";
  const params = new URLSearchParams(location.hash.slice(1)),
    token = params.get("token_hash"),
    type = params.get("type");
  if (location.hash)
    history.replaceState(null, "", location.pathname + location.search);
  const checkout =
      new URLSearchParams(location.search).get("next") === "checkout",
    next = checkout ? "?next=checkout" : "";
  const title = signup
    ? "Create your account"
    : recovery
      ? "Reset your password"
      : reset
        ? "Choose a new password"
        : confirm
          ? "Confirm your email"
          : "Welcome back";
  document.title = `${title} — SonkoFlow`;
  root.innerHTML = `<div class="auth-layout"><aside class="auth-visual"><div class="auth-visual-copy"><p class="auth-eyebrow">YOUR ORIGINAL. A NEW PERSPECTIVE.</p><h1>Your next image<br>starts <em>with you.</em></h1><p>Products, portraits and the photographs you keep.<br>A thoughtful home for your next collection.</p></div><div class="auth-moodboard"><img class="auth-main-photo" src="/images/serum.webp" alt="Illustrative amber skincare bottle and packaging in natural light" width="1536" height="1024"><img class="auth-person-photo" src="/images/portrait-small.webp" alt="Illustrative professional portrait" width="640" height="427"><div class="auth-note"><img src="/brand/mark-ink.svg" width="46" height="46" alt=""><span>YOUR PERSPECTIVE.<br>YOUR PRIVATE COLLECTION.</span></div><span class="auth-swatches" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div><p class="auth-disclosure">Illustrative artwork, not a customer result. AI processing and purchasing depend on service activation.</p></aside><section class="auth-form-panel" aria-labelledby="account-title"><div class="auth-form-inner"><a class="auth-back" href="/"><svg class="public-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M18 18 6 6M6 18V6h12"/></svg> Back to website</a><p class="auth-eyebrow">${checkout ? "YOUR PLAN SELECTION IS COMING WITH YOU" : recovery || reset ? "A FRESH START, SECURELY" : confirm ? "ONE LAST STEP" : "A SPACE FOR YOUR PERSPECTIVE"}</p><h2 id="account-title">${title}</h2><p class="auth-subtitle">${signup ? "One private workspace. A world of possibilities. Verify your email to get started." : recovery ? "Enter your account email. We’ll send a single-use recovery link." : reset ? "Choose a strong password with at least 12 characters. You’ll sign in again after updating." : confirm ? "Verify this single-use email link to continue securely." : "Good to see you again. Sign in to your projects and photographs."}</p><button class="auth-google" type="button" hidden>${googleIcon}<span>Continue with Google</span></button><div class="auth-divider" hidden><span>or continue with email</span></div><form id="account-form">${!reset && !confirm ? '<label for="auth-email">Email address<input id="auth-email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required maxlength="254"></label>' : ""}${!recovery && !confirm ? `<label for="auth-password">Password</label><div class="auth-password-field"><input id="auth-password" name="password" type="password" minlength="12" maxlength="128" autocomplete="${signup || reset ? "new-password" : "current-password"}" ${signup || reset ? 'aria-describedby="password-guidance"' : ""} required><button class="password-toggle" type="button" aria-label="Show password" aria-controls="auth-password" aria-pressed="false">Show</button></div>` : ""}${signup || reset ? '<p class="auth-help" id="password-guidance">At least 12 characters. A unique passphrase works well.</p>' : ""}${!signup && !recovery && !reset && !confirm ? `<a class="auth-forgot" href="/account/recover${next}">Forgot password?</a>` : ""}<div class="notice" role="status" aria-live="polite"></div><button type="submit" class="auth-submit">${signup ? "Create account" : recovery ? "Send recovery email" : reset ? "Save password" : confirm ? "Confirm email" : "Sign in"} <span aria-hidden="true"><svg class="public-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span></button></form><div id="auth-provider-notice" role="status" class="auth-provider-notice"></div><p class="auth-switch">${signup ? `Already have an account? <a href="/account/signin${next}">Sign in</a>` : recovery || reset || confirm ? `Ready to continue? <a href="/account/signin${next}">Sign in</a>` : `New to SonkoFlow? <a href="/account/signup${next}">Create an account</a>`}</p><div class="auth-security"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z"/></svg><p>${signup ? "Email verification protects your workspace. Creating an account does not take a payment." : "Your account uses a secure server-managed session. Provider credentials stay on the server."}</p></div><p class="auth-legal">Legal documents are being prepared: <a href="/terms">Terms & Conditions</a> · <a href="/privacy">Privacy Policy</a>. <a href="/cookies">Cookie Policy</a>.</p><nav class="account-links" aria-label="Account options"><a href="/account/${signup ? "signin" : "signup"}${next}">${signup ? "Already have an account? Sign in" : "Registration"}</a><a href="/account/recover${next}">${signup || recovery || reset || confirm ? "Forgot password?" : "Account recovery"}</a><a href="/">Back to SONKOFLOW</a></nav></div></section></div><footer class="auth-footer"><p>All rights reserved © 2026 SonkoFlow, a product of AaronPrime PTY LTD.</p><a href="/legal">Legal Information</a></footer>`;
  const toggle = root.querySelector(".password-toggle");
  toggle?.addEventListener("click", () => {
    const field = root.querySelector("#auth-password"),
      show = field.type === "password";
    field.type = show ? "text" : "password";
    toggle.textContent = show ? "Hide" : "Show";
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    toggle.setAttribute("aria-pressed", String(show));
  });
  const providerNotice = root.querySelector("#auth-provider-notice");
  if (new URLSearchParams(location.search).get("auth_error") === "google") {
    message(
      root.querySelector(".notice"),
      "Google sign-in was cancelled, expired or could not be verified. Start again or use email and password.",
      true,
    );
    history.replaceState(null, "", location.pathname + next);
  }
  if (!recovery && !reset && !confirm) {
    api("/public/auth")
      .then((cap) => {
        if (!cap.google) return;
        const button = root.querySelector(".auth-google");
        button.hidden = false;
        root.querySelector(".auth-divider").hidden = false;
        button.onclick = async () => {
          if (button.disabled) return;
          button.disabled = true;
          providerNotice.textContent = "Opening secure Google sign-in…";
          try {
            const result = await api("/auth/google", {
              method: "POST",
              body: "{}",
            });
            const url = new URL(result.url);
            if (url.protocol !== "https:" && url.hostname !== "localhost")
              throw Error("Secure sign-in is unavailable.");
            location.assign(url.href);
          } catch (e) {
            providerNotice.textContent = e.message;
            button.disabled = false;
          }
        };
      })
      .catch(() => {});
  }
  bindForm(root.querySelector("form"), async (data, notice) => {
    if (confirm) {
      if (!token || !type)
        throw Error(
          "This link is missing its confirmation token. Request a new email.",
        );
      const result = await api("/auth/confirm", {
        method: "POST",
        body: JSON.stringify({ token_hash: token, type }),
      });
      location.assign(
        result.recovery
          ? "/account/reset"
          : result.next === "/app/checkout"
            ? result.next
            : "/app",
      );
      return;
    }
    const endpoint = signup
      ? "signup"
      : recovery
        ? "recover"
        : reset
          ? "password"
          : "signin";
    const result = await api(`/auth/${endpoint}`, {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(data)),
    });
    if (signup || recovery) {
      message(notice, result.message);
      notice.classList.add("auth-success");
      return;
    }
    location.assign(
      reset
        ? "/account/signin"
        : result.next === "/app/checkout"
          ? result.next
          : "/app",
    );
  });
}
