"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var otpExtractor_1 = require("../src/services/extraction/otpExtractor");
var result = (0, otpExtractor_1.extractOTP)('Confirm your account. Use 252122 to confirm your account.', '<html>Use 252122 to confirm your account</html>', null, [{ type: 'body-primary', text: 'Confirm your account. Use 252122 to confirm your account.' }], { intent: 'verification', confidence: 0, signals: [], scores: {}, secondaryIntent: null });
console.log(JSON.stringify(result, null, 2));
