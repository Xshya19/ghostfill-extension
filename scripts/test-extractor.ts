import { extractAll } from '../src/services/intelligentExtractor';

// Test 1: Firefox email
const result1 = extractAll(
    'Confirm your account',
    'Use 252122 to confirm your account',
    '<html>Use 252122 to confirm your account</html>',
    'accounts@firefox.com'
);
console.log('=== Test 1: Firefox OTP ===');
console.log('Provider:', result1.debugInfo.provider);
console.log('OTP:', result1.otp ? result1.otp.code + ' (' + result1.otp.confidence + '%)' : 'NULL');
console.log('Link:', result1.link ? result1.link.url : 'NULL');
console.log('');

// Test 2: Generic OTP
const result2 = extractAll(
    'Your verification code',
    'Your verification code is 847291. Enter this code to verify your account.',
    '<html>Your verification code is 847291. Enter this code to verify your account.</html>',
    'noreply@example.com'
);
console.log('=== Test 2: Generic OTP ===');
console.log('Provider:', result2.debugInfo.provider);
console.log('OTP:', result2.otp ? result2.otp.code + ' (' + result2.otp.confidence + '%)' : 'NULL');
console.log('');

// Test 3: Short OTP
const result3 = extractAll(
    'Confirm your account',
    '252122',
    '<html>252122</html>',
    'accounts@firefox.com'
);
console.log('=== Test 3: Standalone number ===');
console.log('OTP:', result3.otp ? result3.otp.code + ' (' + result3.otp.confidence + '%)' : 'NULL');
