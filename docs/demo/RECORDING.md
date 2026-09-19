# Recording a safe GhostFill demonstration

No recording was produced in this workspace. The removed historical GIF showed a personalised browser profile and must not be reused.

## Preparation

1. Use a new Chrome profile with no signed-in accounts, saved passwords, autofill records, bookmarks, or extensions beyond GhostFill.
2. Build the public package with `npm run build:zip`, then load the extracted package through `chrome://extensions` with Developer mode enabled.
3. From the repository root, serve the local demo page with `python -m http.server 4173 --directory docs/demo`.
4. Open `http://localhost:4173/mock-signup.html`. Confirm the page displays the local-demo notice.
5. Use a disposable provider and a sender you control for a single test message. Do not record a personal mailbox, customer data, a third-party product signup, or a saved browser profile.

## Record one real sequence

1. Generate a disposable address in GhostFill.
2. Use GhostFill to fill the local email and password fields, then continue to the code form.
3. Send a verification-style email to that disposable address from the controlled sender.
4. Wait for it to appear in GhostFill's inbox. Show only non-sensitive fixture text.
5. Open the message, inspect the suggested code, then use the explicit OTP fill control.
6. Show the local page receiving the code. Do not edit frames or paste a code outside the extension to imply a successful fill.

Use a short clip, include captions, and provide a static poster. Before publishing, review every frame for browser avatars, email addresses, tokens, profile names, tabs, downloaded filenames, and autofill suggestions. The local page deliberately does not fabricate inbound email or a remote-account success state.
