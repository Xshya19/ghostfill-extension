import { harvestPageJsonl } from '../../intelligence/harvest';
import { createLogger } from '../../utils/logger';
import { pageStatus } from '../pageStatus';

const log = createLogger('TrainingDataHarvester');

/**
 * Copy text to clipboard using modern API with fallback
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      return successful;
    } catch {
      document.body.removeChild(textarea);
      return false;
    }
  }
}

/**
 * Harvests privacy-safe fields, copies to clipboard, and triggers background download.
 */
export async function collectTrainingData(): Promise<void> {
  try {
    const jsonl = harvestPageJsonl();
    if (!jsonl) {
      pageStatus.error('No fillable fields found to harvest.', 2500);
      return;
    }

    const fieldCount = jsonl.split('\n').filter(Boolean).length;
    if (fieldCount === 0) {
      pageStatus.error('No fillable fields found to harvest.', 2500);
      return;
    }

    const copied = await copyToClipboard(jsonl);

    let downloadSuccess = false;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const resp = await chrome.runtime.sendMessage({
          action: 'DOWNLOAD_TRAINING_DATA',
          payload: { data: jsonl },
        });
        if (resp?.success) {
          downloadSuccess = true;
        }
      }
    } catch (err) {
      log.debug('Background download messaging failed', err);
    }

    if (copied && downloadSuccess) {
      pageStatus.success(`Harvested ${fieldCount} fields! Copied & Downloaded.`, 3000);
    } else if (copied) {
      pageStatus.success(`Harvested ${fieldCount} fields! Copied to clipboard.`, 3000);
    } else if (downloadSuccess) {
      pageStatus.success(`Harvested ${fieldCount} fields! Download started.`, 3000);
    } else {
      pageStatus.error('Failed to copy or download training data.', 3000);
    }
  } catch (err) {
    log.error('Training data collection failed', err);
    pageStatus.error('Error collecting training data', 3000);
  }
}
