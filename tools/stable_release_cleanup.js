const { spawnSync } = require('child_process');

const CONFIRMATION = 'DELETE-BETA-RELEASES';
const STABLE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
const BETA_TAG_PATTERN = /^v\d+\.\d+\.\d+-beta(?:\.\d+)?$/i;

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit'
  });

  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0 && !options.allowFailure) {
    const detail = options.capture ? (result.stderr || result.stdout || '').trim() : '';
    fail(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function output(command, args, options = {}) {
  return run(command, args, { ...options, capture: true }).stdout.trim();
}

function parseArgs(argv) {
  const options = {
    stableTag: '',
    repo: '',
    execute: false,
    confirm: '',
    help: false,
    selfTest: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--execute') options.execute = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--self-test') options.selfTest = true;
    else if (argument === '--stable-tag') options.stableTag = argv[++index] || '';
    else if (argument.startsWith('--stable-tag=')) options.stableTag = argument.slice('--stable-tag='.length);
    else if (argument === '--repo') options.repo = argv[++index] || '';
    else if (argument.startsWith('--repo=')) options.repo = argument.slice('--repo='.length);
    else if (argument === '--confirm') options.confirm = argv[++index] || '';
    else if (argument.startsWith('--confirm=')) options.confirm = argument.slice('--confirm='.length);
    else fail(`unknown argument: ${argument}`);
  }
  return options;
}

function repositoryFromRemote(remote) {
  const normalized = remote.trim().replace(/\\/g, '/');
  const match = normalized.match(/(?:github\.com[/:])([^/]+)\/([^/]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}` : '';
}

function isBetaTag(tag) {
  return BETA_TAG_PATTERN.test(tag);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
}

function printHelp() {
  console.log(`Usage:
  node tools/stable_release_cleanup.js --stable-tag v1.0.0 [--repo owner/name]
  node tools/stable_release_cleanup.js --stable-tag v1.0.0 --execute --confirm ${CONFIRMATION}

Default mode is a read-only preview. Execution requires a published stable GitHub
Release, its remote tag, and the exact confirmation phrase.`);
}

function selfTest() {
  const cases = [
    ['v1.0.0-beta.1', true],
    ['v12.34.56-beta', true],
    ['v1.0.0', false],
    ['v1.0.0-rc.1', false],
    ['not-a-tag', false]
  ];
  for (const [tag, expected] of cases) {
    if (isBetaTag(tag) !== expected) fail(`beta tag classification failed for ${tag}`);
  }
  if (repositoryFromRemote('https://github.com/WSL043/loudease.git') !== 'WSL043/loudease') {
    fail('HTTPS GitHub remote parsing failed');
  }
  if (repositoryFromRemote('git@github.com:WSL043/loudease.git') !== 'WSL043/loudease') {
    fail('SSH GitHub remote parsing failed');
  }
  if (uniqueSorted(['b', 'a', 'b']).join(',') !== 'a,b') fail('tag deduplication failed');
  console.log('OK   stable release cleanup self-test');
}

function releaseList(repo) {
  const raw = output('gh', [
    'release', 'list', '--repo', repo, '--limit', '100',
    '--json', 'tagName,isDraft,isPrerelease'
  ]);
  return JSON.parse(raw || '[]');
}

function remoteTags() {
  const raw = output('git', ['ls-remote', '--tags', '--refs', 'origin']);
  return raw.split(/\r?\n/).filter(Boolean).map((line) => line.split('refs/tags/')[1]).filter(Boolean);
}

function localTags() {
  const raw = output('git', ['tag', '--list']);
  return raw.split(/\r?\n/).filter(Boolean);
}

function verifyStableRelease(repo, stableTag, releases, tags) {
  const stable = releases.find((release) => release.tagName === stableTag);
  if (!stable) fail(`published GitHub Release ${stableTag} was not found`);
  if (stable.isDraft || stable.isPrerelease) fail(`${stableTag} must be a published stable release`);
  if (!tags.includes(stableTag)) fail(`remote stable tag ${stableTag} was not found`);
  console.log(`OK   verified stable release ${stableTag} in ${repo}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.selfTest) {
    selfTest();
    return;
  }
  if (!STABLE_TAG_PATTERN.test(options.stableTag)) {
    fail('--stable-tag must use the stable form vMAJOR.MINOR.PATCH');
  }

  const repo = options.repo || repositoryFromRemote(output('git', ['remote', 'get-url', 'origin']));
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    fail('could not resolve a valid GitHub owner/repository name');
  }

  const releases = releaseList(repo);
  const remote = remoteTags();
  const local = localTags();
  verifyStableRelease(repo, options.stableTag, releases, remote);

  const betaReleases = releases.filter((release) => release.isPrerelease && isBetaTag(release.tagName));
  const betaTags = uniqueSorted([
    ...remote.filter(isBetaTag),
    ...local.filter(isBetaTag),
    ...betaReleases.map((release) => release.tagName)
  ]);

  console.log(`MODE ${options.execute ? 'execute' : 'preview'}`);
  console.log(`Beta releases: ${betaReleases.length ? betaReleases.map((release) => release.tagName).join(', ') : 'none'}`);
  console.log(`Beta tags: ${betaTags.length ? betaTags.join(', ') : 'none'}`);

  if (!options.execute) {
    console.log(`PREVIEW complete; rerun with --execute --confirm ${CONFIRMATION} after reviewing this list`);
    return;
  }
  if (options.confirm !== CONFIRMATION) {
    fail(`execution requires --confirm ${CONFIRMATION}`);
  }

  for (const release of betaReleases) {
    run('gh', ['release', 'delete', release.tagName, '--repo', repo, '--yes']);
    console.log(`OK   deleted GitHub Beta Release ${release.tagName}`);
  }
  for (const tag of betaTags) {
    if (remote.includes(tag)) {
      run('git', ['push', 'origin', `:refs/tags/${tag}`]);
      console.log(`OK   deleted remote Beta tag ${tag}`);
    }
  }
  const localSet = new Set(local);
  for (const tag of betaTags) {
    if (localSet.has(tag)) {
      run('git', ['tag', '--delete', tag]);
      console.log(`OK   deleted local Beta tag ${tag}`);
    }
  }

  const remainingReleases = releaseList(repo).filter((release) => release.isPrerelease && isBetaTag(release.tagName));
  const remainingTags = remoteTags().filter(isBetaTag);
  if (remainingReleases.length || remainingTags.length) {
    fail(`cleanup incomplete: releases=${remainingReleases.length}, tags=${remainingTags.length}`);
  }
  console.log('OK   Beta release surface is clean');
}

main();
