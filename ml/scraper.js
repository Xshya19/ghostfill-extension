const fs = require('fs');
const puppeteer = require('puppeteer');

const TARGETS = [
  'https://github.com/login',
  'https://www.reddit.com/login',
  'https://twitter.com/i/flow/login',
  'https://www.instagram.com/accounts/login/',
  'https://www.linkedin.com/login',
  'https://account.microsoft.com/account',
];

(async () => {
  console.log('🤖 GhostFill ML Scraper Initializing...');
  const browser = await puppeteer.launch({ headless: 'new' });
  let allData = [];
  
  // Load the compiled extractor logic
  let extractorSrc = '';
  try {
    extractorSrc = fs.readFileSync('./ml/extractor.js', 'utf8');
  } catch (err) {
    console.error('Failed to read ml/extractor.js. Run: npx tsc src/content/extractor.ts --outDir ml/ --target ES2022 --module CommonJS');
    process.exit(1);
  }

  // Wrap CommonJS output so it can run in the browser
  extractorSrc = `
    var exports = {};
    ${extractorSrc}
    window.ghostfillExtractor = exports.extractFeatures;
  `;

  for (const url of TARGETS) {
    try {
      console.log(`\n🌎 Scraping ${url}...`);
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Inject the extractor logic
      await page.addScriptTag({ content: extractorSrc });

      // Run extraction in the browser context
      const siteData = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea'));
        const results = [];
        for (const inp of inputs) {
           if (!window.ghostfillExtractor) continue;
           
           const features = window.ghostfillExtractor(inp);
           if (!features) continue;
           
           // Heuristic auto-labeling for demonstration/bootstrapping (real labels would be done manually or via robust ML)
           let label = "Unknown";
           const type = inp.type.toLowerCase();
           const nameId = (inp.name + ' ' + inp.id).toLowerCase();
           
           if (type === 'email' || nameId.includes('email')) label = "Email";
           else if (type === 'password' && (nameId.includes('confirm') || nameId.includes('verify'))) label = "Target_Password_Confirm";
           else if (type === 'password') label = "Password";
           else if (nameId.includes('first') && nameId.includes('name')) label = "First_Name";
           else if (nameId.includes('last') && nameId.includes('name')) label = "Last_Name";
           else if (nameId.includes('user') || nameId.includes('login')) label = "Username";
           else if (type === 'tel' || nameId.includes('phone')) label = "Phone";
           
           // Convert TypedArrays to normal arrays for JSON serialization
           const { element, ...savable } = features;
           const structArr = Array.from(savable.structural);
           const textArrs = savable.textChannels.map(tc => Array.from(tc));
           
           results.push({
             features: { structural: structArr, textChannels: textArrs },
             label: label,
             timestamp: Date.now(),
             source: window.location.hostname
           });
        }
        return results;
      });
      
      console.log(`  ✅ Found ${siteData.length} inputs labeled automatically.`);
      allData.push(...siteData);
      await page.close();
    } catch (err) {
      console.error(`  ❌ Failed on ${url}:`, err.message);
    }
  }

  await browser.close();
  
  if (allData.length > 0) {
    fs.writeFileSync('./ml/scraped_data.json', JSON.stringify(allData, null, 2));
    console.log(`\n🎉 Done! Scraped ${allData.length} total fields across ${TARGETS.length} sites.`);
    console.log(`📦 Saved features and pseudo-labels to ml/scraped_data.json`);
    console.log(`🧠 Run 'python ml/train_ghostfill_model.py' to ingest this Continuous Learning data!`);
  } else {
    console.log(`\n⚠️ No data collected.`);
  }
})();
