# 👻 GhostFill

<p align="center">
  <img src="src/assets/logo.png" alt="GhostFill Logo" width="100" height="100" />
</p>

<h3 align="center">GhostFill</h3>

<p align="center">
  <strong>Stop Spam, Secure Your Passwords, and Auto-Fill Verification Codes Instantly</strong>
</p>

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/Version-v1.1.0-blue.svg?style=flat-square" alt="Version" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Manifest-MV3-orange.svg?style=flat-square" alt="Manifest" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Status-Perfect-brightgreen.svg?style=flat-square" alt="Status" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Security-Local_Encryption-blueviolet.svg?style=flat-square" alt="Security" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="License" /></a>
</p>

---

## 🌟 What is GhostFill? (Explained Simply)

Have you ever wanted to sign up for a website but didn't want to receive constant spam emails? Or have you found it annoying to copy and paste verification codes (OTPs) from your email when logging in? 

**GhostFill** is a free, privacy-first browser extension that solves this. It runs completely on your computer to:
1.  **Generate temporary email addresses** so you never have to share your real one.
2.  **Create strong, secure passwords** to keep your accounts safe.
3.  **Detect and auto-fill verification codes (OTPs) and magic links** directly into forms, saving you from copy-pasting.

---

## 🚀 Core Features & Why You'll Love Them

### 1. 📧 Throwaway Temporary Emails
*   **What it does:** Generates a temporary, random email address for you to use on sign-up pages.
*   **Why it's useful:** You can receive sign-up confirmations and activation emails without giving away your real inbox. All spam goes to the throwaway account.
*   **Self-Healing:** If one temporary mail server is slow or goes down, GhostFill automatically switches to another one instantly.

### 2. ✉️ Gmail Scrambler (Dot & Plus Alias)
*   **What it does:** Scrambles your real Gmail address so websites cannot link your accounts together or track you.
*   **How it works:** Gmail ignores periods (`.`) and text after a plus sign (`+`) in your username. GhostFill generates addresses like `j.o.h.n.d.o.e+github@gmail.com`. All mail still goes to your main Gmail inbox, but your real address remains hidden.
*   **Automated Sync:** GhostFill connects securely to your Gmail inbox (locally on your browser) to extract verification codes automatically.

### 3. 🧠 Smart OTP & Link Finder
*   **What it does:** Scans incoming registration emails to find verification codes (like `483920` or `TLM-492`) or login buttons.
*   **Why it's useful:** You don't need to open your email client, find the email, copy the code, and switch back. GhostFill finds it and types it for you.
*   **Dual-Engine Smart Search:** Uses a "cognitive" layout scanner (looking for bold headers, table cells, or highlighted text) and a "heuristic" scanner (validating formats and excluding noise like phone numbers, years, and prices) to ensure it gets the right code every time.

### 4. 🔒 Locked-Down Local Security
*   **What it does:** Keeps your generated passwords and settings safe using encryption.
*   **Why it's useful:** Your data is encrypted using native browser keys that are non-extractable. Even if a malicious website tries to hack your browser, it cannot extract your stored credentials.

### 5. ✨ Pulsing Action Button (FAB)
*   **What it does:** A clean, minimal button floats next to your email and password fields.
*   **Why it's useful:** It pulses blue when creating an email or waiting for an OTP, and turns green when a code is found, letting you autofill in a single click.

---

## 🔒 Is My Data Safe?

**Yes, 100%.** 
*   **No Cloud Storage:** GhostFill does not use a central database to store your passwords or emails. Everything stays encrypted on your device.
*   **Local Processing:** Email scanning and code extraction happen entirely inside your browser. No email bodies are uploaded to external tracking servers.
*   **No Trackers:** GhostFill is free, open-source, and does not contain advertisements or analytics trackers.

---

## 🎮 How to Use GhostFill

### 1. Generating Emails & Passwords
1.  Click on any email input field on a website.
2.  Click the **GhostFill button (FAB)** that floats next to the field.
3.  Select **Generate Temp Email** or **Generate Secure Password**.
4.  GhostFill will create it and type it in automatically!

### 2. Auto-Filling Verification Codes (OTPs)
1.  When a website asks you to enter a code, wait for the email to arrive.
2.  GhostFill will scan the incoming message in the background.
3.  The floating button next to the input field will pulse blue, then turn green when the code is found.
4.  Click the green button to auto-fill the code instantly!

---

## 🛠️ Installation & Setup (For Beginners)

1.  Download the project files to your computer.
2.  Open Google Chrome and type `chrome://extensions/` in the address bar.
3.  Turn on **Developer Mode** using the switch in the top-right corner.
4.  Click **Load unpacked** in the top-left corner.
5.  Select the project's `dist/` directory.
6.  You are done! You'll see the GhostFill icon in your toolbar.

---

## ⌨️ Keyboard Shortcuts

Press these keys together to trigger actions instantly:

*   `Ctrl+Shift+E` (or `Cmd+Shift+E` on Mac): Open the GhostFill Control Panel.
*   `Ctrl+Shift+M` (or `Cmd+Shift+M` on Mac): Generate a new disposable email.
*   `Ctrl+Shift+G` (or `Cmd+Shift+G` on Mac): Generate a secure password.
*   `Ctrl+Shift+F` (or `Cmd+Shift+F` on Mac): Autofill the current form.

---

## ❓ Frequently Asked Questions (FAQ)

### Q: How do I install GhostFill?
1.  Download or clone the files to your computer.
2.  Open your browser (Chrome, Edge, Brave, or Opera) and go to the Extensions page (`chrome://extensions/`).
3.  Turn on **Developer Mode** in the top-right corner.
4.  Click **Load unpacked** in the top-left corner.
5.  Select the `dist/` folder inside the GhostFill directory (make sure you run `npm run build` first to create this folder!).

### Q: Does GhostFill cost any money or have ads?
No. GhostFill is 100% free, ad-free, and open-source. There are no subscriptions, paywalls, or hidden charges.

### Q: Is my personal email content safe?
Yes. GhostFill processes all emails locally inside your browser sandbox. None of your emails are sent or uploaded to third-party databases. It only monitors temporary throwaway accounts or optional Gmail aliases that you configure.

### Q: Why does it say "GhostFill running in sandboxed environment" in the console?
This is a built-in safety feature. On certain web pages with strict security restrictions, the browser blocks standard extension storage. When this happens, GhostFill automatically falls back to a secure in-memory cache, keeping the extension active without crashing.

### Q: Does it work on banking or financial websites?
No. To protect your financial security, GhostFill explicitly ignores major banking and financial domains (like Chase, Citibank, SunTrust, Bank of America, etc.) and password managers. The content script is disabled on these portals.

### Q: Do I need a Google Account to use GhostFill?
No. Connecting a Google Account is completely optional. You can use the built-in, free temporary email addresses right out of the box with zero setup.

### Q: What happens if a temporary email provider goes down?
GhostFill's Provider Health Manager constantly tracks the status of all supported temporary email systems. If one gets blocked or runs slow, GhostFill dynamically switches to the next active mail provider in the background with zero user input.

---

## 📜 License
Distributed under the MIT License. See `LICENSE` for details.
