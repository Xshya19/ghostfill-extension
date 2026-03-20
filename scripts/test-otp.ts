import { extractOTP } from '../src/services/extraction/otpExtractor';
const result = extractOTP(
    'Confirm your account. Use 252122 to confirm your account.',
    '<html>Use 252122 to confirm your account</html>',
    null,
    [{ type: 'body-primary', text: 'Confirm your account. Use 252122 to confirm your account.' }],
    { intent: 'verification', confidence: 0, signals: [], scores: {}, secondaryIntent: null }
);
console.log(JSON.stringify(result, null, 2));
