/**
 * PNG Icon Generator for GhostFill Extension
 * Requires sharp: npm install --save-dev sharp
 *
 * Usage: node scripts/generate-icons-png.js
 */

const fs = require('fs');
const path = require('path');

// Check if sharp is installed
let sharp;
try {
  sharp = require('sharp');
} catch (error) {
  console.error('❌ sharp is not installed. Please run: npm install --save-dev sharp');
  process.exit(1);
}

const svgPath = path.join(__dirname, '..', 'src', 'assets', 'icons', 'icon.svg');
const outputDir = path.join(__dirname, '..', 'src', 'assets', 'icons');

// Required icon sizes for Chrome Extension
const ICON_SIZES = [16, 32, 48, 128];

async function generatePngIcons() {
  if (!fs.existsSync(svgPath)) {
    console.error('❌ SVG icon not found. Please run: node scripts/generate-icons.js first');
    process.exit(1);
  }

  const svgBuffer = fs.readFileSync(svgPath);

  console.log(' Generating PNG icons from SVG...\n');

  for (const size of ICON_SIZES) {
    const outputPath = path.join(outputDir, `icon-${size}.png`);

    await sharp(svgBuffer).resize(size, size).png().toFile(outputPath);

    console.log(`✅ Created: icon-${size}.png (${size}x${size})`);
  }

  console.log('\n✅ All PNG icons generated successfully!');
  console.log('\n📝 Next steps:');
  console.log('   Update manifest.json to use the new icon files:');
  console.log('   "icons": {');
  console.log('     "16": "assets/icons/icon-16.png",');
  console.log('     "32": "assets/icons/icon-32.png",');
  console.log('     "48": "assets/icons/icon-48.png",');
  console.log('     "128": "assets/icons/icon-128.png"');
  console.log('   }');
}

generatePngIcons().catch((error) => {
  console.error('❌ Error generating icons:', error.message);
  process.exit(1);
});
