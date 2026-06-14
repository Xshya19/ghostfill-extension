/**
 * Prevent duplicate full Gmail body fetch + duplicate extractor run.
 *
 * Add this guard around the code paths that call gmailApiService.fetchMessage()
 * and extractAll().
 */

export type ExtractionPayload = {
  code?: string | null | undefined;
  link?: string | null | undefined;
  intent?: string | undefined;
  [key: string]: unknown;
};

const activeExtractionsByEmailId = new Map<string, Promise<ExtractionPayload>>();
const extractionCacheByEmailId = new Map<string, { result: ExtractionPayload; savedAt: number }>();

const EXTRACTION_CACHE_TTL_MS = 30_000;

export async function extractEmailOnce(
  emailId: string,
  run: () => Promise<ExtractionPayload>
): Promise<ExtractionPayload> {
  const cached = extractionCacheByEmailId.get(emailId);
  if (cached && Date.now() - cached.savedAt < EXTRACTION_CACHE_TTL_MS) {
    return cached.result;
  }

  const active = activeExtractionsByEmailId.get(emailId);
  if (active) {
    return active;
  }

  const promise = run()
    .then((result) => {
      extractionCacheByEmailId.set(emailId, { result, savedAt: Date.now() });

      // Tiny bounded cache.
      if (extractionCacheByEmailId.size > 100) {
        const first = extractionCacheByEmailId.keys().next().value;
        if (first) {
          extractionCacheByEmailId.delete(first);
        }
      }

      return result;
    })
    .finally(() => {
      activeExtractionsByEmailId.delete(emailId);
    });

  activeExtractionsByEmailId.set(emailId, promise);
  return promise;
}
