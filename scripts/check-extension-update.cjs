const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const archiver = require('archiver');

const updater = path.join(__dirname, 'update-extension.ps1');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostfill-update-check-'));
const install = path.join(root, 'GhostFill & spaces');
const packagePath = path.join(root, 'ghostfill-extension-v2.0.1.zip');
const files = [
  'background.js',
  'content.js',
  'content.css',
  'popup.html',
  'popup.js',
  'popup.css',
  'options.html',
  'options.js',
  'options.css',
  'offscreen.html',
  'offscreen.js',
  'vendor.js',
];
const manifest = {
  manifest_version: 3,
  name: '__MSG_extensionName__',
  version: '2.0.0',
  background: { service_worker: 'background.js' },
  action: { default_popup: 'popup.html' },
  oauth2: { client_id: 'test.apps.googleusercontent.com' },
};

function powershell(code, extraEnv = {}) {
  const result = spawnSync(
    process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', code],
    {
      encoding: 'utf8',
      timeout: 20000,
      env: {
        ...process.env,
        GHOSTFILL_CHECK_UPDATER: updater,
        GHOSTFILL_CHECK_INSTALL: install,
        GHOSTFILL_CHECK_ZIP: packagePath,
        ...extraEnv,
      },
    }
  );
  if (result.error) throw result.error;
  return result;
}

const invoke =
  '& $env:GHOSTFILL_CHECK_UPDATER -InstallDirectory $env:GHOSTFILL_CHECK_INSTALL -PackagePath $env:GHOSTFILL_CHECK_ZIP; exit $LASTEXITCODE';
const run = (prefix = '') => powershell(prefix + '\n' + invoke);
function reset() {
  fs.mkdirSync(install, { recursive: true });
  fs.writeFileSync(path.join(install, 'manifest.json'), JSON.stringify(manifest));
  for (const name of files) fs.writeFileSync(path.join(install, name), 'old');
  fs.writeFileSync(path.join(install, 'local-marker.txt'), 'keep in backup');
}
function checksum() {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(packagePath)).digest('hex');
  fs.writeFileSync(packagePath + '.sha256', digest + ' *' + path.basename(packagePath) + '\n');
}
async function zip(overrides = {}, omit = null) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(packagePath);
    const archive = archiver('zip');
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(JSON.stringify({ ...manifest, version: '2.0.1', ...overrides }), {
      name: 'manifest.json',
    });
    for (const name of files) if (name !== omit) archive.append('new', { name });
    archive.file(path.join(__dirname, '..', 'Update GhostFill.cmd'), {
      name: 'Update GhostFill.cmd',
    });
    archive.file(updater, { name: 'scripts/update-extension.ps1' });
    archive.finalize();
  });
  checksum();
}
function unchanged(result) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(install, 'manifest.json'))).version, '2.0.0');
  assert.equal(fs.readFileSync(path.join(install, 'background.js'), 'utf8'), 'old');
}

async function main() {
  reset();
  await zip();
  const applied = run();
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(install, 'manifest.json'))).version, '2.0.1');
  assert.equal(fs.readFileSync(path.join(install, 'background.js'), 'utf8'), 'new');
  const backup = fs.readdirSync(root).find((name) => name.startsWith('.ghostfill-backup-'));
  assert.ok(backup);
  assert.equal(
    fs.readFileSync(path.join(root, backup, 'local-marker.txt'), 'utf8'),
    'keep in backup'
  );

  reset();
  fs.writeFileSync(packagePath + '.sha256', '0'.repeat(64) + ' *' + path.basename(packagePath));
  unchanged(run());
  fs.unlinkSync(packagePath + '.sha256');
  unchanged(run());
  await zip({}, 'popup.js');
  unchanged(run());
  await zip({ oauth2: null });
  unchanged(run());
  await zip({ key: 'different-extension-id' });
  unchanged(run());
  await zip({ version: '1.9.0' });
  unchanged(run());

  await zip();
  const malicious = powershell(
    'Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::Open($env:GHOSTFILL_CHECK_ZIP,"Update"); try { $w=[IO.StreamWriter]::new($z.CreateEntry("../escaped.txt").Open()); $w.Write("bad"); $w.Dispose() } finally { $z.Dispose() }'
  );
  assert.equal(malicious.status, 0, malicious.stderr);
  checksum();
  unchanged(run());
  assert.equal(fs.existsSync(path.join(root, 'escaped.txt')), false);

  await zip();
  const failure = run(
    'function Move-Item { param($LiteralPath,$Destination) if ((Split-Path -Leaf $LiteralPath) -eq "payload") { throw "Simulated promotion failure" }; Microsoft.PowerShell.Management\\Move-Item -LiteralPath $LiteralPath -Destination $Destination }'
  );
  unchanged(failure);
  assert.equal(fs.readFileSync(path.join(install, 'local-marker.txt'), 'utf8'), 'keep in backup');

  const current = powershell(
    'function Invoke-RestMethod { @{tag_name="v2.0.0";draft=$false;prerelease=$false} }; ' + invoke,
    { GHOSTFILL_CHECK_ZIP: '' }
  );
  assert.equal(current.status, 0, current.stdout + current.stderr);
  assert.match(current.stdout, /No newer published version/);
  const offline = powershell(
    'function Invoke-RestMethod { throw "Simulated unavailable release server" }; ' + invoke,
    { GHOSTFILL_CHECK_ZIP: '' }
  );
  unchanged(offline);

  const download = powershell(
    `
    function Invoke-RestMethod { @{tag_name="v2.0.1";draft=$false;prerelease=$false;assets=@(@{name="ghostfill-extension-v2.0.1.zip"},@{name="ghostfill-extension-v2.0.1.zip.sha256"})} }
    function Invoke-WebRequest { param($Uri,$OutFile,$TimeoutSec,[switch]$UseBasicParsing)
      $base="https://github.com/Xshya19/ghostfill-extension/releases/download/v2.0.1/ghostfill-extension-v2.0.1.zip"
      if ($Uri -eq $base) { Copy-Item -LiteralPath $env:GHOSTFILL_CHECK_DOWNLOAD -Destination $OutFile }
      elseif ($Uri -eq "$base.sha256") { Copy-Item -LiteralPath "$env:GHOSTFILL_CHECK_DOWNLOAD.sha256" -Destination $OutFile }
      else { throw "Unexpected download URL" }
    }
    ${invoke}`,
    { GHOSTFILL_CHECK_ZIP: '', GHOSTFILL_CHECK_DOWNLOAD: packagePath }
  );
  assert.equal(download.status, 0, download.stdout + download.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(install, 'manifest.json'))).version, '2.0.1');

  reset();
  const busy = powershell(`
    $lockPath=Join-Path (Split-Path -Parent $env:GHOSTFILL_CHECK_INSTALL) (".ghostfill-"+(Split-Path -Leaf $env:GHOSTFILL_CHECK_INSTALL)+"-update.lock")
    $held=[IO.File]::Open($lockPath,"OpenOrCreate","ReadWrite","None")
    try { ${invoke} } finally { $held.Dispose() }`);
  unchanged(busy);
  assert.match(busy.stdout, /Another update is running/);

  if (process.platform === 'win32') {
    const launcher = path.join(install, 'Update GhostFill.cmd');
    const launched = spawnSync('cmd.exe', ['/d', '/s', '/c', `""${launcher}" "${packagePath}""`], {
      cwd: install,
      encoding: 'utf8',
      input: '\r\n',
      timeout: 20000,
      windowsVerbatimArguments: true,
      windowsHide: true,
    });
    if (launched.error) throw launched.error;
    assert.equal(launched.status, 0, launched.stdout + launched.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(install, 'manifest.json'))).version, '2.0.1');
  }
  assert.equal(
    fs.readdirSync(root).some((name) => name.startsWith('.ghostfill-update-')),
    false
  );
  console.log(
    'PASS: local/release updates, real Windows shortcut, backups, integrity/profile/ID/version guards, unsafe ZIP, rollback, offline/current checks, and concurrent update lock'
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (
      !path
        .resolve(root)
        .startsWith(path.resolve(os.tmpdir()) + path.sep + 'ghostfill-update-check-')
    )
      throw new Error('Unsafe test cleanup target');
    fs.rmSync(root, { recursive: true, force: true });
  });
