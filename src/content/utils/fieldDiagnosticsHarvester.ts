import { harvestPageJsonl } from '../../intelligence/harvest';
import { createLogger } from '../../utils/logger';
import { pageStatus } from '../pageStatus';

const log = createLogger('FieldDiagnosticsHarvester');

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
 * Harvests privacy-safe field diagnostics and copies them to the clipboard.
 */
export async function collectFieldDiagnostics(): Promise<void> {
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

    if (copied) {
      pageStatus.success(`Captured ${fieldCount} field diagnostics. Copied to clipboard.`, 3000);
    } else {
      pageStatus.error('Failed to copy field diagnostics.', 3000);
    }
  } catch (err) {
    log.error('Field diagnostic collection failed', err);
    pageStatus.error('Error collecting field diagnostics', 3000);
  }
}
