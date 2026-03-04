/**
 * Icon Generator Script for GhostFill Extension
 * Generates properly sized PNG icons from SVG source
 * 
 * Usage: npm run generate-icons
 */

const fs = require('fs');
const path = require('path');

// SVG icon content - GhostFill brand icon
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="ghostGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366f1;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:1" />
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  
  <!-- Ghost body -->
  <path d="M256 64C164 64 96 140 96 240v176c0 13.3 10.7 24 24 24s24-10.7 24-24v-32c0-17.7 14.3-32 32-32s32 14.3 32 32v32c0 13.3 10.7 24 24 24s24-10.7 24-24v-32c0-17.7 14.3-32 32-32s32 14.3 32 32v32c0 13.3 10.7 24 24 24s24-10.7 24-24V240c0-100-68-176-160-176z" fill="url(#ghostGradient)" filter="url(#glow)"/>
  
  <!-- Eyes -->
  <ellipse cx="216" cy="200" rx="28" ry="36" fill="#ffffff"/>
  <ellipse cx="296" cy="200" rx="28" ry="36" fill="#ffffff"/>
  <circle cx="224" cy="208" r="14" fill="#1a1a2e"/>
  <circle cx="304" cy="208" r="14" fill="#1a1a2e"/>
  
  <!-- Sparkle accents -->
  <path d="M380 140l8 16 16 8-16 8-8 16-8-16-16-8 16-8z" fill="#fbbf24" opacity="0.8"/>
  <path d="M120 280l6 12 12 6-12 6-6 12-6-12-12-6 12-6z" fill="#fbbf24" opacity="0.6"/>
  <path d="M420 320l5 10 10 5-10 5-5 10-5-10-10-5 10-5z" fill="#fbbf24" opacity="0.5"/>
</svg>`;

// Required icon sizes for Chrome Extension
const ICON_SIZES = [16, 32, 48, 128];

// Output directory
const outputDir = path.join(__dirname, '..', 'src', 'assets', 'icons');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Save SVG icon (Chrome MV3 supports SVG directly)
const svgPath = path.join(outputDir, 'icon.svg');
fs.writeFileSync(svgPath, svgContent);
console.log(`✅ Created SVG icon: ${svgPath}`);

// Create PNG placeholders with instructions
// Note: For production, use a tool like sharp to convert SVG to PNG
// npm install sharp
// Then run: node scripts/generate-icons.js

console.log('\n📝 Icon Generation Instructions:');
console.log('================================');
console.log('The SVG icon has been created. For PNG icons, you have two options:');
console.log('');
console.log('Option 1: Use sharp (recommended)');
console.log('  npm install --save-dev sharp');
console.log('  node scripts/generate-icons-png.js');
console.log('');
console.log('Option 2: Use Chrome directly (SVG is supported in MV3)');
console.log('  The icon.svg file can be used directly in manifest.json');
console.log('');
console.log('Option 3: Use an online converter');
console.log('  Convert icon.svg to PNG at sizes: 16, 32, 48, 128');
console.log('  Save as: icon-16.png, icon-32.png, icon-48.png, icon-128.png');
console.log('');

// Create a simple PNG generator script
const pngGeneratorScript = `/**
 * PNG Icon Generator - Requires sharp
 * npm install --save-dev sharp
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const svgPath = path.join(__dirname, '..', 'src', 'assets', 'icons', 'icon.svg');
const outputDir = path.join(__dirname, '..', 'src', 'assets', 'icons');

const ICON_SIZES = [16, 32, 48, 128];

async function generatePngIcons() {
    const svgBuffer = fs.readFileSync(svgPath);
    
    for (const size of ICON_SIZES) {
        const outputPath = path.join(outputDir, \`icon-\${size}.png\`);
        
        await sharp(svgBuffer)
            .resize(size, size)
            .png()
            .toFile(outputPath);
        
        console.log(\`✅ Created: icon-\${size}.png\`);
    }
    
    console.log('\\n✅ All PNG icons generated successfully!');
}

generatePngIcons().catch(console.error);
`;

const pngGeneratorPath = path.join(__dirname, 'generate-icons-png.js');
fs.writeFileSync(pngGeneratorPath, pngGeneratorScript);
console.log(`✅ Created PNG generator script: ${pngGeneratorPath}`);

console.log('\n✨ Icon setup complete!');
