/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  DATASET GENERATOR — Bridge to PyTorch Training               ║
 * ║  Uses JSDOM to simulate browser environment for extraction.    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { FormSimulatorV2 } from '../src/training/FormSimulatorV2';
import { FeatureExtractorV2, FieldType } from '../src/intelligence/ml/FeatureExtractorV2';

async function generate() {
  const COUNT = 20000; // Optimized for memory stability
  const OUTPUT_PATH = path.join(__dirname, '../training/data/sentinel_v2_seed.jsonl');
  
  console.log(`🚀 Starting generation of ${COUNT} samples...`);
  
  const simulator = new FormSimulatorV2();
  const extractor = new FeatureExtractorV2();
  const streams = fs.createWriteStream(OUTPUT_PATH);

  const fieldTypeToIndex: Record<FieldType, number> = {
    username: 0, email: 1, password: 2, confirm_password: 3, 
    otp_digit: 4, phone: 5, submit_button: 6, honeypot: 7, unknown: 8
  };

  // 1. Setup virtual DOM ONCE
  const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`);
  const document = dom.window.document;
  const body = document.body;
  
  // Shim globals for the feature extractor
  global.document = document as any;
  global.window = dom.window as any;
  global.HTMLElement = dom.window.HTMLElement;
  global.HTMLInputElement = dom.window.HTMLInputElement;
  global.ShadowRoot = dom.window.ShadowRoot;
  global.HTMLDocument = dom.window.HTMLDocument;
  global.Node = dom.window.Node;
  global.Element = dom.window.Element;
  global.DOMRect = dom.window.DOMRect;

  for (let i = 0; i < COUNT; i++) {
    // 2. Clear and generate synthetic form content
    body.innerHTML = ''; 
    const tierDist = [0.4, 0.3, 0.1, 0.1, 0.1];
    const sample = simulator.generateBatch(1, tierDist)[0];
    body.innerHTML = sample.html;

    const context = {
      url: 'https://synthetic.ghostfill.com/auth',
      domain: 'ghostfill.com',
      isAuthPage: true,
      totalVisibleInputs: sample.labels.length
    };

    // 3. Extract features for each labeled element
    for (const label of sample.labels) {
      const element = document.querySelector(label.selector) as HTMLElement;
      if (!element) continue;

      const features = Array.from(extractor.extract(element, context));
      const entry = {
        features,
        label_idx: fieldTypeToIndex[label.fieldType],
        metadata: { ...sample.metadata, fieldType: label.fieldType }
      };

      streams.write(JSON.stringify(entry) + '\n');
    }

    if (i % 1000 === 0) console.log(`  Processed ${i}/${COUNT}...`);
  }

  streams.end();
  console.log(`✅ Done! Dataset saved to ${OUTPUT_PATH}`);
}

generate().catch(err => {
  console.error('Generation failed:', err);
  process.exit(1);
});
