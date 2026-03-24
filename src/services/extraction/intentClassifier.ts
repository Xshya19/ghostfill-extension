import intentModel from './knowledge/intent_model.json';

interface ModelData {
  priors: Record<string, number>;
  likelihoods: Record<string, Record<string, number>>;
  vocabSize: number;
}

const model = intentModel as unknown as ModelData;

export class IntentClassifier {
  private static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  static classify(subject: string, body: string): { intent: string; confidence: number } {
    const tokens = this.tokenize(`${subject} ${body}`);
    const results: Record<string, number> = {};

    for (const label in model.priors) {
      // Start with log of prior to avoid underflow
      let logProb = Math.log(model.priors[label]);

      tokens.forEach(token => {
        if (model.likelihoods[label][token]) {
          logProb += Math.log(model.likelihoods[label][token]);
        } else {
          // If token not in model's class-specific likelihoods, 
          // use a small epsilon for fallback (Laplacian smoothing baseline)
          logProb += Math.log(1 / (model.vocabSize * 10)); 
        }
      });

      results[label] = logProb;
    }

    // Convert log probs back to normalized probabilities
    const maxLogProb = Math.max(...Object.values(results));
    const expProbs = Object.fromEntries(
        Object.entries(results).map(([label, logProb]) => [label, Math.exp(logProb - maxLogProb)])
    );
    
    const sumExpProbs = Object.values(expProbs).reduce((a, b) => a + b, 0);
    const finalProbs = Object.fromEntries(
        Object.entries(expProbs).map(([label, prob]) => [label, prob / sumExpProbs])
    );

    const [bestIntent, confidence] = Object.entries(finalProbs).sort((a, b) => b[1] - a[1])[0];

    return {
      intent: bestIntent,
      confidence
    };
  }
}
