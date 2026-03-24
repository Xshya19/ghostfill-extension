import fs from 'fs';
import path from 'path';

const GHOSTFILL_DATASET = path.join(__dirname, '../ghostfill_dataset.json');
const CSV_DATASET = path.join(__dirname, '../email_dataset_100k.csv');
const OUTPUT_MODEL = path.join(__dirname, '../src/services/extraction/knowledge/intent_model.json');

import { parse } from 'csv-parse/sync';

interface DatasetEntry {
  rawInput: {
    subject: string;
    textBody: string;
  };
  labeledGroundTruth: {
    expectedIntent: string;
  };
}

class IntentTrainer {
  private wordCounts: Record<string, Record<string, number>> = {};
  private classCounts: Record<string, number> = {};
  private totalDocs = 0;
  private vocabulary = new Set<string>();

  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  train(text: string, label: string) {
    const tokens = this.tokenize(text);
    if (!this.wordCounts[label]) {
      this.wordCounts[label] = {};
      this.classCounts[label] = 0;
    }

    this.classCounts[label]++;
    this.totalDocs++;

    tokens.forEach(token => {
      this.wordCounts[label][token] = (this.wordCounts[label][token] || 0) + 1;
      this.vocabulary.add(token);
    });
  }

  exportModel() {
    const model = {
      priors: {} as Record<string, number>,
      likelihoods: {} as Record<string, Record<string, number>>,
      vocabSize: this.vocabulary.size
    };

    for (const label in this.classCounts) {
      model.priors[label] = this.classCounts[label] / this.totalDocs;
      model.likelihoods[label] = {};
      
      const totalWordsInClass = Object.values(this.wordCounts[label]).reduce((a, b) => a + b, 0);
      
      // Laplacian smoothing
      for (const word of this.vocabulary) {
          const count = this.wordCounts[label][word] || 0;
          model.likelihoods[label][word] = (count + 1) / (totalWordsInClass + this.vocabulary.size);
      }
    }

    // Optimization: Keep only top 2000 words per class to keep model small
    for (const label in model.likelihoods) {
        const sortedWords = Object.entries(model.likelihoods[label])
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2000);
        model.likelihoods[label] = Object.fromEntries(sortedWords);
    }

    fs.writeFileSync(OUTPUT_MODEL, JSON.stringify(model, null, 2));
    console.log(`Model exported to ${OUTPUT_MODEL}`);
    console.log(`Vocab Size: ${this.vocabulary.size}`);
  }
}

async function run() {
  const trainer = new IntentTrainer();
  
  console.log('Training on GhostFill Dataset...');
  const gfData = JSON.parse(fs.readFileSync(GHOSTFILL_DATASET, 'utf-8')) as DatasetEntry[];
  gfData.forEach(entry => {
    const text = `${entry.rawInput.subject} ${entry.rawInput.textBody}`;
    const label = entry.labeledGroundTruth.expectedIntent === 'otp' ? 'verification' : entry.labeledGroundTruth.expectedIntent;
    trainer.train(text, label);
  });

  console.log('Training on 100k CSV (Ham subset)...');
  const csvContent = fs.readFileSync(CSV_DATASET, 'utf-8');
  const csvRecords = parse(csvContent, { 
      columns: true, 
      skip_empty_lines: true,
      relax_column_count: true 
  }) as any[];
  
  // Take 10,000 Ham samples to balance the model
  const hamSamples = csvRecords.filter(r => r.label === '0').slice(0, 10000);
  hamSamples.forEach(r => {
      trainer.train(`${r.subject} ${r.body_plain}`, 'other');
  });

  trainer.exportModel();
}

run().catch(console.error);
