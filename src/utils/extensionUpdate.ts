import { fetchWithTimeout, isObject } from './core';

export const EXTENSION_RELEASES_URL = 'https://github.com/Xshya19/ghostfill-extension/releases';

export type ExtensionUpdate = {
  status: 'available' | 'current' | 'ahead';
  version: string;
  releaseUrl: string;
  zipUrl: string;
  checksumUrl: string;
};

function validateVersion(version: string): void {
  const parts = version.split('.').map(Number);
  if (
    !/^\d{1,5}(?:\.\d{1,5}){2}$/.test(version) ||
    parts.some((part) => part > 65535) ||
    parts.every((part) => part === 0) ||
    parts.join('.') !== version
  ) {
    throw new Error('The release has an unsupported version. Check the releases page.');
  }
}

export async function checkExtensionUpdate(
  installedVersion: string,
  signal?: AbortSignal
): Promise<ExtensionUpdate> {
  validateVersion(installedVersion);
  const response = await fetchWithTimeout(
    'https://api.github.com/repos/Xshya19/ghostfill-extension/releases/latest',
    {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit',
      cache: 'no-store',
      timeout: 10_000,
      signal: signal ?? null,
    }
  );
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('No stable release is published yet. Check the releases page.');
    }
    if (response.status === 403 || response.status === 429) {
      throw new Error(
        'GitHub limited the update check. Try again later or open the releases page.'
      );
    }
    throw new Error(`The update check failed (HTTP ${response.status}). Try again later.`);
  }
  const release: unknown = await response.json();
  if (
    !isObject(release) ||
    release.draft !== false ||
    release.prerelease !== false ||
    typeof release.tag_name !== 'string' ||
    !release.tag_name.startsWith('v') ||
    !Array.isArray(release.assets)
  ) {
    throw new Error('The release details are incomplete. Check the releases page.');
  }
  const version = release.tag_name.slice(1);
  validateVersion(version);
  const releaseUrl = `${EXTENSION_RELEASES_URL}/tag/v${version}`;
  const zipName = `ghostfill-extension-v${version}.zip`;
  const zipUrl = `${EXTENSION_RELEASES_URL}/download/v${version}/${zipName}`;
  const checksumUrl = `${zipUrl}.sha256`;
  // Offer only built packages from this repository, never source archives or redirected asset URLs.
  for (const [name, url] of [
    [zipName, zipUrl],
    [`${zipName}.sha256`, checksumUrl],
  ]) {
    if (
      !release.assets.some(
        (asset: unknown) =>
          isObject(asset) && asset.name === name && asset.browser_download_url === url
      )
    ) {
      throw new Error('The built ZIP or its checksum is missing. Check the releases page.');
    }
  }
  const comparison = installedVersion.localeCompare(version, 'en', { numeric: true });
  const status = comparison === 0 ? 'current' : comparison < 0 ? 'available' : 'ahead';
  return { status, version, releaseUrl, zipUrl, checksumUrl };
}
