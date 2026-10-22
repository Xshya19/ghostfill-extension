/** Chrome host patterns cover a host, including all paths and ports. */
export function getCustomEndpointPermission(endpoint: string): chrome.permissions.Permissions {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Use an HTTPS endpoint without embedded credentials or a fragment.');
  }
  return { origins: [`https://${url.hostname}/*`] };
}

// Called directly by a click handler so Chrome retains the user gesture.
export function requestCustomEndpointPermission(endpoint: string): Promise<boolean> {
  const permission = getCustomEndpointPermission(endpoint);
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) {
    throw new Error('Allow endpoint access from the installed extension settings.');
  }
  return chrome.permissions.request(permission);
}

export async function assertCustomEndpointPermission(endpoint: string): Promise<void> {
  const permission = getCustomEndpointPermission(endpoint);
  if (
    typeof chrome === 'undefined' ||
    !chrome.permissions?.contains ||
    !(await chrome.permissions.contains(permission))
  ) {
    throw new Error(
      'Choose Allow endpoint access in Email settings before using this custom service.'
    );
  }
}
