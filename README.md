# 👻 GhostFill - AI Privacy Toolkit

<div align="center">

![GhostFill Banner](https://img.shields.io/badge/👻_GhostFill-AI_Privacy_Toolkit-6366f1?style=for-the-badge&labelColor=1a1a2e)

[![GitHub stars](https://img.shields.io/github/stars/Xshya19/ghostfill-extension?style=for-the-badge&logo=github&color=yellow)](https://github.com/Xshya19/ghostfill-extension/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/Xshya19/ghostfill-extension?style=for-the-badge&logo=github&color=blue)](https://github.com/Xshya19/ghostfill-extension/network)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://github.com/Xshya19/ghostfill-extension)

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Groq](https://img.shields.io/badge/Groq-LLM_Powered-F55036?style=flat-square&logo=lightning&logoColor=white)](https://groq.com/)
[![Webpack](https://img.shields.io/badge/Webpack-8DD6F9?style=flat-square&logo=webpack&logoColor=black)](https://webpack.js.org/)

**🛡️ AI-powered auto-fill for disposable emails, secure passwords, and automatic OTP detection. 100% Free & Open Source!**

[Features](#features) • [Installation](#installation) • [Usage](#usage) • [Contributing](#contributing)

</div>

---

## Features

### 📧 Temporary Email

- Generate unlimited disposable email addresses
- Support for multiple providers (1secmail.com, mail.tm)
- Real-time inbox monitoring
- Auto-refresh every 5 seconds

### 🔐 Secure Passwords

- Cryptographically secure generation using Web Crypto API
- Customizable length (4-128 characters)
- Character type options (uppercase, lowercase, numbers, symbols)
- Password strength meter with crack time estimation
- Preset templates (Standard, Strong, PIN, Passphrase)

### 🔢 OTP Auto-Detection

- Automatic extraction from emails using AI patterns
- Support for 4-8 digit numeric codes
- Alphanumeric code support
- One-click auto-fill to OTP fields
- Multi-field OTP input support

### ✨ Smart Auto-Fill

- AI-powered form detection
- Intelligent field type recognition
- Login/Signup form classification
- Context menu integration
- Floating action button on input fields

### ⌨️ Keyboard Shortcuts

- `Ctrl+Shift+E` - Open GhostFill
- `Ctrl+Shift+M` - Generate new email
- `Ctrl+Shift+P` - Generate new password
- `Ctrl+Shift+F` - Auto-fill form

## Installation

### From Source (Development)

1. Clone the repository:

```bash
cd ghostfill-extension
```

2. Install dependencies:

```bash
npm install
```

3. Build the extension:

```bash
npm run build
```

4. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

5. **Setup AI Features (Required for OTP extraction):**
   - Click the GhostFill extension icon
   - You'll see a banner: "Enable AI Features"
   - Click it to open Settings
   - Go to [console.groq.com](https://console.groq.com) and create a free account
   - Generate an API key
   - Paste it in the "Groq API Key" field
   - Done! AI-powered OTP extraction is now enabled

### Development Mode

```bash
npm run dev
```

This will watch for changes and rebuild automatically.

## Project Structure

```
ghostfill-extension/
├── src/
│   ├── background/        # Service worker scripts
│   ├── content/           # Content scripts for page interaction
│   ├── popup/             # React popup UI
│   ├── options/           # Settings page
│   ├── services/          # Core services (email, password, storage)
│   ├── ai/                # AI/heuristic features
│   ├── types/             # TypeScript type definitions
│   ├── utils/             # Utility functions
│   └── assets/            # Icons and images
├── public/                # Static files and localization
├── manifest.json          # Chrome extension manifest
├── webpack.config.js      # Build configuration
└── package.json           # Dependencies
```

## API Services Used (Free)

| Service      | API            | Rate Limit |
| ------------ | -------------- | ---------- |
| 1secmail.com | REST API       | Unlimited  |
| Mail.tm      | REST API + JWT | 100/min    |

## Technology Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Webpack 5** - Build system
- **Chrome Extensions API** - Manifest V3
- **Web Crypto API** - Secure random generation

## Security

- ✅ Cryptographically secure password generation (never Math.random())
- ✅ AES-256-GCM encryption for stored data
- ✅ PBKDF2 key derivation
- ✅ Shadow DOM isolation for floating button
- ✅ All data stored locally (no external analytics)
- ✅ Clipboard auto-clear after 30 seconds

## Scripts

| Command          | Description                 |
| ---------------- | --------------------------- |
| `npm run dev`    | Development mode with watch |
| `npm run build`  | Production build            |
| `npm run test`   | Run tests                   |
| `npm run lint`   | Run ESLint                  |
| `npm run format` | Format with Prettier        |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

---

Made with ❤️ by the GhostFill Team
