const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { ZipArchive } = require('archiver');

if (process.platform !== 'win32') {
  console.log('SKIP: automatic-update checks require Windows PowerShell and a Windows user SID.');
  process.exit(0);
}

// Every Task Scheduler command is replaced by a fixture-only function. These
// checks must never register, remove, or inspect a real scheduled task.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostfill-auto-check-'));
const install = path.join(root, 'GhostFill & spaces');
const taskFile = path.join(root, 'mock-task.json');
const callFile = path.join(root, 'mock-calls.jsonl');
const packagePath = path.join(root, 'ghostfill-extension-v2.0.1.zip');
const markerName = 'ghostfill-update-state.json';
const helpers = [
  'auto-update-common.ps1',
  'auto-update-extension.ps1',
  'setup-auto-updates.ps1',
  'update-extension.ps1',
];
const builtFiles = [
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
  key: 'fixture-fixed-extension-identity',
  oauth2: { client_id: 'test.apps.googleusercontent.com' },
};
const initialState = {
  schemaVersion: 1,
  autoUpdateEnabled: false,
  taskName: null,
  installedVersion: '2.0.0',
  updatedAt: null,
  lastCheckedAt: null,
  updateId: null,
  source: 'windows-helper',
};

function powershell(code, env = {}) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', code],
    {
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
      env: {
        ...process.env,
        GHOSTFILL_CHECK_INSTALL: install,
        GHOSTFILL_CHECK_TASK: taskFile,
        GHOSTFILL_CHECK_CALLS: callFile,
        GHOSTFILL_CHECK_ZIP: packagePath,
        ...env,
      },
    }
  );
  if (result.error) throw result.error;
  return result;
}
function success(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
function failure(result) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
}
function json(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function state() {
  return json(path.join(install, markerName));
}
function calls() {
  return fs.existsSync(callFile)
    ? fs.readFileSync(callFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : [];
}
function reset() {
  fs.mkdirSync(path.join(install, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(install, 'manifest.json'), JSON.stringify(manifest));
  for (const name of builtFiles) fs.writeFileSync(path.join(install, name), 'old');
  for (const name of helpers)
    fs.copyFileSync(path.join(__dirname, name), path.join(install, 'scripts', name));
  for (const name of ['Enable Automatic Updates.cmd', 'Disable Automatic Updates.cmd']) {
    fs.copyFileSync(path.join(__dirname, '..', name), path.join(install, name));
  }
  fs.writeFileSync(path.join(install, markerName), JSON.stringify(initialState));
  fs.rmSync(taskFile, { force: true });
  fs.rmSync(callFile, { force: true });
}

const taskMocks = `
function Record-FixtureCall($Value) {
  [IO.File]::AppendAllText($env:GHOSTFILL_CHECK_CALLS, (($Value | ConvertTo-Json -Depth 10 -Compress) + "\n"))
}
function Check-FixtureTask($TaskName, $TaskPath) {
  if ($TaskName -notmatch '^GhostFill-AutoUpdate-[a-f0-9]{16}$' -or $TaskPath -cne '\\') { throw 'Unexpected task target' }
}
function Get-ScheduledTask {
  [CmdletBinding()] param($TaskName, $TaskPath)
  Check-FixtureTask $TaskName $TaskPath
  Record-FixtureCall @{ api='get'; taskName=$TaskName; taskPath=$TaskPath }
  if (Test-Path -LiteralPath $env:GHOSTFILL_CHECK_TASK) {
    $record = Get-Content -LiteralPath $env:GHOSTFILL_CHECK_TASK -Raw | ConvertFrom-Json
    if ($record.taskName -eq $TaskName) { return $record.definition }
  }
}
function New-ScheduledTaskAction {
  param($Execute, $Argument, $WorkingDirectory)
  return @{ Execute=$Execute; Arguments=$Argument; WorkingDirectory=$WorkingDirectory }
}
function New-ScheduledTaskTrigger {
  param([switch]$Once, $At, $RepetitionInterval)
  return @{ Once=[bool]$Once; At=$At.ToUniversalTime().ToString('o'); IntervalHours=$RepetitionInterval.TotalHours }
}
function New-ScheduledTaskPrincipal {
  param($UserId, $LogonType, $RunLevel)
  return @{ UserId=$UserId; LogonType=$LogonType; RunLevel=$RunLevel }
}
function New-ScheduledTaskSettingsSet {
  param([switch]$Hidden, $MultipleInstances, $ExecutionTimeLimit, [switch]$StartWhenAvailable,
    [switch]$RunOnlyIfNetworkAvailable, [switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries)
  return @{ Hidden=[bool]$Hidden; MultipleInstances=$MultipleInstances;
    ExecutionMinutes=$ExecutionTimeLimit.TotalMinutes; StartWhenAvailable=[bool]$StartWhenAvailable;
    RunOnlyIfNetworkAvailable=[bool]$RunOnlyIfNetworkAvailable; AllowStartIfOnBatteries=[bool]$AllowStartIfOnBatteries;
    DontStopIfGoingOnBatteries=[bool]$DontStopIfGoingOnBatteries }
}
function New-ScheduledTask {
  param($Action, $Trigger, $Principal, $Settings, $Description)
  return @{ Actions=$Action; Triggers=$Trigger; Principal=$Principal; Settings=$Settings; Description=$Description }
}
function Register-ScheduledTask {
  [CmdletBinding()] param($TaskName, $TaskPath, $InputObject, [switch]$Force)
  Check-FixtureTask $TaskName $TaskPath
  Record-FixtureCall @{ api='register'; taskName=$TaskName; taskPath=$TaskPath; force=[bool]$Force }
  if ($env:GHOSTFILL_CHECK_REGISTER_FAIL -eq '1') { throw 'Fixture registration denied' }
  @{ taskName=$TaskName; taskPath=$TaskPath; definition=$InputObject } | ConvertTo-Json -Depth 10 |
    Set-Content -LiteralPath $env:GHOSTFILL_CHECK_TASK -Encoding UTF8
  if ($env:GHOSTFILL_CHECK_LOCK_MARKER -eq '1') {
    $global:fixtureMarkerLock = [IO.File]::Open((Join-Path $env:GHOSTFILL_CHECK_INSTALL 'ghostfill-update-state.json'), 'Open', 'Read', 'None')
  }
}
function Unregister-ScheduledTask {
  [CmdletBinding()] param($TaskName, $TaskPath, [switch]$Confirm)
  Check-FixtureTask $TaskName $TaskPath
  Record-FixtureCall @{ api='unregister'; taskName=$TaskName; taskPath=$TaskPath }
  if (Test-Path -LiteralPath $env:GHOSTFILL_CHECK_TASK) { Remove-Item -LiteralPath $env:GHOSTFILL_CHECK_TASK }
}
`;
function setup(disable = false, env = {}) {
  return powershell(
    taskMocks +
      `
  try { & (Join-Path $env:GHOSTFILL_CHECK_INSTALL 'scripts/setup-auto-updates.ps1') -InstallDirectory $env:GHOSTFILL_CHECK_INSTALL ${disable ? '-Disable' : ''}; exit $LASTEXITCODE }
  finally { if ($global:fixtureMarkerLock) { $global:fixtureMarkerLock.Dispose() } }`,
    env
  );
}
const networkMocks = `
function Record-FixtureCall($Value) {
  [IO.File]::AppendAllText($env:GHOSTFILL_CHECK_CALLS, (($Value | ConvertTo-Json -Depth 6 -Compress) + "\n"))
}
function Invoke-RestMethod {
  param($Uri, $UserAgent, $TimeoutSec)
  if ($Uri -cne 'https://api.github.com/repos/Xshya19/ghostfill-extension/releases/latest' -or $TimeoutSec -ne 20) { throw 'Unexpected release endpoint' }
  Record-FixtureCall @{ api='release'; uri=$Uri }
  if ($env:GHOSTFILL_CHECK_OFFLINE -eq '1') { throw 'Fixture unavailable release server' }
  return @{ tag_name='v2.0.1'; draft=$false; prerelease=$false;
    assets=@(@{name='ghostfill-extension-v2.0.1.zip'}, @{name='ghostfill-extension-v2.0.1.zip.sha256'}) }
}
function Invoke-WebRequest {
  param($Uri, $OutFile, $TimeoutSec, [switch]$UseBasicParsing)
  $base = 'https://github.com/Xshya19/ghostfill-extension/releases/download/v2.0.1/ghostfill-extension-v2.0.1.zip'
  Record-FixtureCall @{ api='download'; uri=$Uri }
  if ($Uri -ceq $base -and $TimeoutSec -eq 60) { Copy-Item -LiteralPath $env:GHOSTFILL_CHECK_ZIP -Destination $OutFile }
  elseif ($Uri -ceq "$base.sha256" -and $TimeoutSec -eq 30) { Copy-Item -LiteralPath "$env:GHOSTFILL_CHECK_ZIP.sha256" -Destination $OutFile }
  else { throw 'Unexpected download endpoint' }
}
`;
function automatic(env = {}, prefix = '') {
  return powershell(
    networkMocks +
      '\n' +
      prefix +
      `
    & (Join-Path $env:GHOSTFILL_CHECK_INSTALL 'scripts/auto-update-extension.ps1') -InstallDirectory $env:GHOSTFILL_CHECK_INSTALL
    exit $LASTEXITCODE`,
    env
  );
}
function checksum() {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(packagePath)).digest('hex');
  fs.writeFileSync(packagePath + '.sha256', digest + ' *' + path.basename(packagePath) + '\n');
}
async function zip(overrides = {}, omitHelper = null) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(packagePath);
    const archive = new ZipArchive();
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(JSON.stringify({ ...manifest, version: '2.0.1', ...overrides }), {
      name: 'manifest.json',
    });
    for (const name of builtFiles) archive.append('new', { name });
    archive.append(JSON.stringify({ ...initialState, installedVersion: '2.0.1' }), {
      name: markerName,
    });
    for (const name of helpers) {
      if (name !== omitHelper)
        archive.file(path.join(__dirname, name), { name: `scripts/${name}` });
    }
    archive.finalize();
  });
  checksum();
}
function unchanged(previousSuccess = { updateId: null, updatedAt: null }) {
  assert.equal(json(path.join(install, 'manifest.json')).version, '2.0.0');
  assert.equal(fs.readFileSync(path.join(install, 'background.js'), 'utf8'), 'old');
  assert.equal(state().installedVersion, '2.0.0');
  assert.equal(state().updateId, previousSuccess.updateId);
  if (previousSuccess.updatedAt === null) assert.equal(state().updatedAt, null);
  else assert.equal(Date.parse(state().updatedAt), Date.parse(previousSuccess.updatedAt));
}

async function main() {
  reset();
  success(automatic());
  assert.equal(calls().length, 0, 'disabled runner must not access the release server');
  success(setup());
  const enabled = state();
  const task = json(taskFile);
  assert.equal(enabled.autoUpdateEnabled, true);
  assert.match(enabled.taskName, /^GhostFill-AutoUpdate-[a-f0-9]{16}$/);
  assert.equal(task.taskName, enabled.taskName);
  assert.equal(task.taskPath, '\\');
  assert.equal(task.definition.Description, `GhostFill automatic updates for ${install}`);
  const {
    Principal: principal,
    Actions: action,
    Triggers: trigger,
    Settings: settings,
  } = task.definition;
  assert.match(principal.UserId, /^S-1-5-/);
  assert.equal(principal.LogonType, 'Interactive');
  assert.equal(principal.RunLevel, 'Limited');
  assert.equal(
    action.Execute.toLowerCase(),
    path
      .join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      .toLowerCase()
  );
  assert.equal(action.WorkingDirectory, root);
  assert.ok(
    action.Arguments.includes(
      '-WindowStyle Hidden -File "' +
        path.join(install, 'scripts', 'auto-update-extension.ps1') +
        '"'
    )
  );
  assert.ok(action.Arguments.includes('-InstallDirectory "' + install + '"'));
  assert.ok(!/password|-Command/i.test(action.Arguments));
  assert.equal(trigger.Once, true);
  assert.equal(trigger.IntervalHours, 6);
  assert.ok(
    Date.parse(trigger.At) > Date.now() + 60000 && Date.parse(trigger.At) < Date.now() + 180000
  );
  assert.equal(settings.Hidden, true);
  assert.equal(settings.MultipleInstances, 'IgnoreNew');
  assert.equal(settings.ExecutionMinutes, 4);
  assert.equal(settings.RunOnlyIfNetworkAvailable, true);
  assert.equal(settings.AllowStartIfOnBatteries, true);
  assert.equal(settings.DontStopIfGoingOnBatteries, true);
  success(setup());
  assert.equal(
    state().taskName,
    enabled.taskName,
    're-enabling must reuse the same installation task'
  );
  success(setup(true));
  assert.equal(fs.existsSync(taskFile), false);
  assert.equal(state().autoUpdateEnabled, false);
  assert.equal(state().taskName, null);
  success(setup(true));

  reset();
  failure(setup(false, { GHOSTFILL_CHECK_REGISTER_FAIL: '1' }));
  assert.deepEqual(state(), initialState);
  failure(setup(false, { GHOSTFILL_CHECK_LOCK_MARKER: '1' }));
  assert.equal(
    fs.existsSync(taskFile),
    false,
    'marker failure must remove only the newly registered task'
  );
  assert.deepEqual(state(), initialState);
  success(setup());
  const foreign = json(taskFile);
  foreign.definition.Description = 'A different application';
  fs.writeFileSync(taskFile, JSON.stringify(foreign));
  failure(setup(true));
  assert.equal(json(taskFile).definition.Description, 'A different application');
  assert.equal(
    state().autoUpdateEnabled,
    true,
    'foreign task rejection must leave the original marker unchanged'
  );

  reset();
  fs.writeFileSync(
    path.join(install, 'manifest.json'),
    JSON.stringify({ ...manifest, oauth2: null })
  );
  failure(setup());
  assert.equal(calls().length, 0, 'temporary-email profile must not access Task Scheduler');
  reset();
  success(setup());
  const originalTask = state().taskName;
  const otherInstall = path.join(root, 'Another GhostFill');
  fs.cpSync(install, otherInstall, { recursive: true });
  success(setup(false, { GHOSTFILL_CHECK_INSTALL: otherInstall }));
  assert.notEqual(json(path.join(otherInstall, markerName)).taskName, originalTask);

  reset();
  success(setup());
  const autoTask = state().taskName;
  await zip();
  success(automatic());
  assert.equal(json(path.join(install, 'manifest.json')).version, '2.0.1');
  assert.equal(state().installedVersion, '2.0.1');
  assert.equal(state().autoUpdateEnabled, true);
  assert.equal(state().taskName, autoTask);
  assert.match(state().updateId, /^[a-f0-9]{32}$/);
  assert.ok(Number.isFinite(Date.parse(state().updatedAt)));
  assert.ok(Number.isFinite(Date.parse(state().lastCheckedAt)));
  const installedState = state();
  const networkCount = calls().filter((call) => call.api === 'release').length;
  success(automatic());
  assert.equal(calls().filter((call) => call.api === 'release').length, networkCount);
  assert.deepEqual(state(), installedState, 'cadence skip must not produce a success marker');

  fs.writeFileSync(
    path.join(install, markerName),
    JSON.stringify({
      ...installedState,
      lastCheckedAt: new Date(Date.now() - 7 * 3600000).toISOString(),
    })
  );
  success(automatic());
  assert.equal(calls().filter((call) => call.api === 'release').length, networkCount + 1);
  assert.equal(
    state().updateId,
    installedState.updateId,
    'an already-current release must retain its previous success ID'
  );
  assert.equal(state().updatedAt, installedState.updatedAt);

  reset();
  success(setup());
  failure(automatic({ GHOSTFILL_CHECK_OFFLINE: '1' }));
  unchanged();
  assert.ok(Number.isFinite(Date.parse(state().lastCheckedAt)));
  const offlineCount = calls().filter((call) => call.api === 'release').length;
  success(automatic());
  assert.equal(
    calls().filter((call) => call.api === 'release').length,
    offlineCount,
    'offline failures must respect the six-hour cadence'
  );

  reset();
  success(setup());
  await zip();
  fs.writeFileSync(packagePath + '.sha256', '0'.repeat(64) + ' *' + path.basename(packagePath));
  failure(automatic());
  unchanged();
  reset();
  success(setup());
  await zip({ oauth2: {} });
  failure(automatic());
  unchanged();
  reset();
  success(setup());
  await zip({}, 'auto-update-extension.ps1');
  failure(automatic());
  unchanged();

  reset();
  success(setup());
  await zip();
  const previousSuccess = {
    updateId: 'a'.repeat(32),
    updatedAt: new Date(Date.now() - 24 * 3600000).toISOString(),
  };
  fs.writeFileSync(
    path.join(install, markerName),
    JSON.stringify({ ...state(), ...previousSuccess })
  );
  const markerFailure = automatic(
    {},
    `
    function Move-Item { param($LiteralPath, $Destination)
      Microsoft.PowerShell.Management\\Move-Item -LiteralPath $LiteralPath -Destination $Destination
      if ((Split-Path -Leaf $LiteralPath) -eq 'payload') {
        [IO.File]::SetAttributes((Join-Path $Destination 'ghostfill-update-state.json'), [IO.FileAttributes]::ReadOnly)
      }
    }`
  );
  failure(markerFailure);
  unchanged(previousSuccess);
  assert.equal(state().autoUpdateEnabled, true);
  assert.ok(
    !fs.readdirSync(root).some((name) => name.startsWith('.ghostfill-update-')),
    'failed promotions must remove their verified staging folder'
  );

  const logResult = powershell(`
    . (Join-Path $env:GHOSTFILL_CHECK_INSTALL 'scripts/auto-update-common.ps1')
    for ($i=0; $i -lt 120; $i++) { Write-GhostFillAutomaticLog $env:GHOSTFILL_CHECK_INSTALL ('Bounded fixture line '+$i+' '+('x'*500)) }
  `);
  success(logResult);
  const log = fs
    .readdirSync(root)
    .find((name) => name.startsWith('.ghostfill-auto-GhostFill-AutoUpdate-'));
  assert.ok(log);
  const logContent = fs.readFileSync(path.join(root, log), 'utf8');
  assert.ok(logContent.trim().split(/\r?\n/).length <= 80);
  assert.ok(Buffer.byteLength(logContent) < 64 * 1024);

  // Run the real CMD shortcuts with a harmless fixture setup script. This
  // verifies quoting and flags without calling Task Scheduler.
  fs.writeFileSync(
    path.join(install, 'scripts', 'setup-auto-updates.ps1'),
    `
    param([string]$InstallDirectory, [switch]$Disable)
    @{ Directory=$InstallDirectory; Disabled=[bool]$Disable } | ConvertTo-Json |
      Set-Content -LiteralPath (Join-Path $InstallDirectory 'launcher-proof.json') -Encoding UTF8
    exit 0
  `
  );
  for (const disabled of [false, true]) {
    const launcher = path.join(
      install,
      disabled ? 'Disable Automatic Updates.cmd' : 'Enable Automatic Updates.cmd'
    );
    const launched = spawnSync('cmd.exe', ['/d', '/s', '/c', `""${launcher}""`], {
      cwd: install,
      encoding: 'utf8',
      input: '\r\n',
      timeout: 20000,
      windowsVerbatimArguments: true,
      windowsHide: true,
    });
    if (launched.error) throw launched.error;
    success(launched);
    const proof = json(path.join(install, 'launcher-proof.json'));
    assert.equal(path.resolve(proof.Directory), install);
    assert.equal(proof.Disabled, disabled);
  }
  console.log(
    'PASS: mocked current-user task setup/removal, hidden limited six-hour cadence, ownership/profile guards, native verified automatic promotion, marker failure rollback, bounded offline checks/logs, and real Windows shortcut quoting. No real task was registered.'
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (
      !path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'ghostfill-auto-check-')
    ) {
      throw new Error('Unsafe automatic-update check cleanup target');
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
