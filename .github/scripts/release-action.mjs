#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { verifyReleaseSecurity } from './verify-release-security.mjs';
export const REPOSITORY = 'Zemdomu/ZemDomu-action';
export const WORKFLOW = '.github/workflows/release-action.yml';
export const WORKFLOWS = Object.freeze({
    ci: { id: 400703575, path: '.github/workflows/ci.yml' },
    codeql: { id: 400703577, path: '.github/workflows/codeql.yml' },
    signing: { id: 401563011, path: '.github/workflows/sign-release-artifacts.yml' },
});
const PREFIX = `repos/${REPOSITORY}`;
const MAX_BYTES = 16 * 1024 * 1024;
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const positive = value => Number.isSafeInteger(value) && value > 0;
const fail = message => { const error = new Error(message); error.releaseBoundary = true; throw error; };
const identity = `https://github.com/${REPOSITORY}/${WORKFLOW}@refs/heads/main`;
export function validateInputs({ expectedCommit, version, publish }) {
    if (!/^[a-f0-9]{40}$/.test(expectedCommit ?? ''))
        fail('An exact lowercase public commit SHA is required.');
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '') || !version.split('.').every(p => Number.isSafeInteger(Number(p))))
        fail('A stable numeric package version is required.');
    if (typeof publish !== 'boolean')
        fail('publish must be an explicit boolean; validation is the default.');
}
export function assertContext(env, expectedCommit) {
    if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_WORKFLOW_REF !== `${REPOSITORY}/${WORKFLOW}@refs/heads/main` ||
        !['workflow_dispatch', 'repository_dispatch'].includes(env.GITHUB_EVENT_NAME) || env.GITHUB_SHA !== expectedCommit ||
        !positive(Number(env.GITHUB_RUN_ID)) || !positive(Number(env.GITHUB_RUN_ATTEMPT)))
        fail('Release validation must run in the public main workflow on the exact approved source.');
}
export function githubApi(endpoint, { method = 'GET', body, binary = false } = {}) {
    const args = ['api', '--hostname', 'github.com', '--method', method, endpoint];
    if (body !== undefined)
        args.push('--input', '-');
    if (binary)
        args.push('-H', 'Accept: application/octet-stream');
    const result = spawnSync('gh', args, { input: body === undefined ? undefined : JSON.stringify(body), encoding: binary ? null : 'utf8', maxBuffer: MAX_BYTES, timeout: 60000 });
    if (result.error || result.status !== 0) {
        const status = result.stderr?.toString().match(/\(HTTP (\d{3})\)/)?.[1];
        const error = new Error(`GitHub ${method} request failed${status ? ` (HTTP ${status})` : ''}; release remains blocked.`);
        if (status)
            error.status = Number(status);
        throw error;
    }
    if (binary)
        return result.stdout;
    if (!result.stdout.trim())
        return null;
    try {
        return JSON.parse(result.stdout);
    }
    catch {
        fail('GitHub returned malformed JSON.');
    }
}
export function extractNotes(markdown, version) {
    if (typeof markdown !== 'string' || markdown.includes('\\n'))
        fail('Changelog must contain real Markdown newlines.');
    const sections = new Map();
    let current;
    for (const line of markdown.replaceAll('\r\n', '\n').split('\n')) {
        const heading = /^## (.+)$/.exec(line);
        if (heading) {
            if (sections.has(heading[1]))
                fail('Duplicate changelog version.');
            current = [];
            sections.set(heading[1], current);
        }
        else if (current)
            current.push(line);
        else if (line.trim())
            fail('Changelog must begin with its version headings.');
    }
    if (!sections.has('Unreleased') || sections.get('Unreleased').some(line => line.trim()))
        fail('Unreleased must be empty before release validation.');
    const lines = sections.get(version);
    if (!lines || !lines.some(line => line.trim()))
        fail('Matching nonempty changelog version is required.');
    const categories = new Set(['Bugfix', 'Feature', 'Hotfix', 'Security', 'Docs', 'Breaking', 'Chore', 'Performance', 'Refactor']);
    const seen = new Set();
    let category;
    let bullets = 0;
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line.trim())
            continue;
        const heading = /^### (.+)$/.exec(line);
        if (heading) {
            if (category && bullets === 0)
                fail('Changelog category cannot be empty.');
            category = heading[1];
            bullets = 0;
            if (!categories.has(category) || seen.has(category) || lines[i + 1] !== '')
                fail('Changelog category or spacing is invalid.');
            seen.add(category);
        }
        else {
            if (!category || !line.startsWith(`- ${category}: `) || line.length <= category.length + 4)
                fail('Changelog requires matching customer-facing category bullets.');
            bullets += 1;
        }
    }
    if (!category || bullets === 0)
        fail('Changelog category cannot be empty.');
    return `## ${version}\n\n${lines.join('\n').trim()}\n`;
}
function content(response, name) {
    if (response?.type !== 'file' || response.path !== name || response.encoding !== 'base64' || typeof response.content !== 'string')
        fail(`Missing public source file ${name}.`);
    return Buffer.from(response.content, 'base64').toString('utf8');
}
function workflow(value, spec) {
    if (value?.id !== spec.id || value.path !== spec.path || value.state !== 'active')
        fail('Required public workflow identity changed.');
}
function runIdentity(run, spec, commit) {
    if (!positive(run?.id) || !positive(run.run_number) || !positive(run.run_attempt) || run.workflow_id !== spec.id || run.path !== spec.path ||
        run.event !== 'push' || run.head_branch !== 'main' || run.head_sha !== commit || run.repository?.full_name !== REPOSITORY || run.head_repository?.full_name !== REPOSITORY ||
        run.html_url !== `https://github.com/${REPOSITORY}/actions/runs/${run.id}`)
        fail('Public check run identity differs from the exact approved push/main source.');
}
async function latest(github, spec, commit) {
    const response = await github(`${PREFIX}/actions/workflows/${spec.id}/runs?branch=main&event=push&head_sha=${commit}&per_page=100`);
    if (!Array.isArray(response?.workflow_runs) || response.workflow_runs.length === 0 || response.total_count !== response.workflow_runs.length || response.total_count > 100)
        fail('Public check history is missing or incomplete.');
    const ids = new Set();
    const numbers = new Set();
    for (const run of response.workflow_runs) {
        runIdentity(run, spec, commit);
        if (ids.has(run.id) || numbers.has(run.run_number))
            fail('Ambiguous public check history.');
        ids.add(run.id);
        numbers.add(run.run_number);
    }
    const run = response.workflow_runs.reduce((a, b) => a.run_number > b.run_number ? a : b);
    if (run.status !== 'completed' || run.conclusion !== 'success')
        fail('Latest exact-source public check has not completed successfully.');
    return run;
}
function successfulStep(job, name) {
    const steps = job.steps?.filter(step => step.name === name);
    if (steps?.length !== 1 || steps[0].status !== 'completed' || steps[0].conclusion !== 'success')
        fail(`Required public step did not succeed: ${name}.`);
}
async function checkedJobs(github, run, spec) {
    const response = await github(`${PREFIX}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
    const names = spec === WORKFLOWS.ci ? ['Test and build (Node 22)', 'Test and build (Node 24)'] : ['Analyze (actions)', 'Analyze (javascript-typescript)'];
    if (!Array.isArray(response?.jobs) || response.total_count !== names.length || response.jobs.length !== names.length || new Set(response.jobs.map(j => j.id)).size !== names.length || new Set(response.jobs.map(j => j.name)).size !== names.length)
        fail('Required public job inventory is incomplete or ambiguous.');
    for (const job of response.jobs) {
        if (!names.includes(job.name) || !positive(job.id) || job.run_id !== run.id || job.run_attempt !== run.run_attempt || job.head_sha !== run.head_sha || job.status !== 'completed' || job.conclusion !== 'success')
            fail('Required public job identity/attempt or conclusion differs.');
        if (spec === WORKFLOWS.ci) {
            for (const name of ['Install dependencies and build bundle', 'Check TypeScript', 'Run tests and rebuild bundle', 'Verify committed bundle is up to date', 'Test release boundaries'])
                successfulStep(job, name);
            if (job.name.endsWith('24)'))
                successfulStep(job, 'Measure direct TypeScript source coverage');
        }
        else
            successfulStep(job, 'Analyze source');
    }
}
export async function verifyGates({ expectedCommit, version, publish, github = githubApi }) {
    validateInputs({ expectedCommit, version, publish });
    const main = async () => {
        const b = await github(`${PREFIX}/branches/main`);
        if (b?.name !== 'main' || b.protected !== true || b.commit?.sha !== expectedCommit)
            fail('Protected public main moved from the approved commit.');
    };
    await main();
    const manifest = JSON.parse(content(await github(`${PREFIX}/contents/package.json?ref=${expectedCommit}`), 'package.json'));
    const lock = JSON.parse(content(await github(`${PREFIX}/contents/package-lock.json?ref=${expectedCommit}`), 'package-lock.json'));
    if (manifest.name !== 'zemdomu-action' || manifest.version !== version || manifest.repository?.url !== `git+https://github.com/${REPOSITORY}.git` || manifest.license !== 'MIT' || lock.name !== manifest.name || lock.version !== version || lock.packages?.['']?.version !== version || lock.packages?.['']?.name !== manifest.name)
        fail('Public package/lock identity or version does not match.');
    const notes = extractNotes(content(await github(`${PREFIX}/contents/CHANGELOG.md?ref=${expectedCommit}`), 'CHANGELOG.md'), version);
    const evidence = {};
    for (const [name, spec] of Object.entries(WORKFLOWS).filter(([name]) => name !== 'signing')) {
        workflow(await github(`${PREFIX}/actions/workflows/${spec.id}`), spec);
        const first = await latest(github, spec, expectedCommit);
        await checkedJobs(github, first, spec);
        const current = await github(`${PREFIX}/actions/runs/${first.id}`);
        runIdentity(current, spec, expectedCommit);
        if (current.status !== 'completed' || current.conclusion !== 'success' || current.run_attempt !== first.run_attempt)
            fail('Public check attempt changed during validation.');
        if (!isDeepStrictEqual(await latest(github, spec, expectedCommit), first))
            fail('A newer or changed public check blocks release.');
        workflow(await github(`${PREFIX}/actions/workflows/${spec.id}`), spec);
        evidence[name] = { id: first.id, attempt: first.run_attempt, url: first.html_url };
    }
    await verifyReleaseSecurity({ repository: REPOSITORY, expectedCommit, github });
    workflow(await github(`${PREFIX}/actions/workflows/${WORKFLOWS.signing.id}`), WORKFLOWS.signing);
    await main();
    return { repository: REPOSITORY, expectedCommit, version, publish, notes, evidence };
}
export function readRegular(file, limit = MAX_BYTES, io = fs) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BYTES || typeof fs.constants.O_NOFOLLOW !== 'number')
        fail('A bounded no-follow file read is required on this platform.');
    const descriptor = io.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
        const stat = io.fstatSync(descriptor);
        if (!stat.isFile() || stat.size < 1 || stat.size > limit)
            fail('Release file is not a bounded regular file.');
        const buffer = Buffer.allocUnsafe(limit + 1);
        let length = 0;
        while (length < buffer.length) {
            const count = io.readSync(descriptor, buffer, length, buffer.length - length, null);
            if (count === 0)
                break;
            length += count;
        }
        if (length < 1 || length > limit)
            fail('Release file grew beyond its read bound.');
        return buffer.subarray(0, length);
    }
    finally {
        io.closeSync(descriptor);
    }
}
export function inspectArchive({ archivePath, rootDirectory, version, exec = execFileSync }) {
    const bytes = readRegular(archivePath);
    const members = exec('tar', ['-tzf', archivePath], { encoding: 'utf8', maxBuffer: 64 * 1024, timeout: 30000 }).trim().split('\n').sort();
    const expected = ['package/LICENSE', 'package/README.md', 'package/dist/index.js', 'package/dist/licenses.txt', 'package/package.json'];
    if (!isDeepStrictEqual(members, expected))
        fail('Packed Action member inventory differs from the release contract.');
    let total = 0;
    for (const member of members) {
        const value = exec('tar', ['-xOf', archivePath, member], { maxBuffer: MAX_BYTES, timeout: 30000 });
        total += value.length;
        if (total > MAX_BYTES || !value.equals(readRegular(path.join(rootDirectory, member.slice('package/'.length)))))
            fail('Packed member differs from the tested public checkout.');
    }
    const manifest = JSON.parse(exec('tar', ['-xOf', archivePath, 'package/package.json'], { encoding: 'utf8', maxBuffer: 64 * 1024, timeout: 30000 }));
    if (manifest.name !== 'zemdomu-action' || manifest.version !== version)
        fail('Packed package identity differs.');
    return { name: `zemdomu-action-${version}.tgz`, size: bytes.length, digest: digest(bytes) };
}
export function smokeArchive({ archivePath, exec = execFileSync, spawn = spawnSync }) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'action-release-smoke-'));
    try {
        const entry = path.join(temporary, 'action.cjs');
        fs.writeFileSync(entry, exec('tar', ['-xOf', archivePath, 'package/dist/index.js'], { maxBuffer: MAX_BYTES, timeout: 30000 }));
        const valid = '<html lang="en"><head><title>Release smoke</title></head><body><main><h1>Page</h1></main></body></html>';
        for (const invalid of [false, true]) {
            fs.writeFileSync(path.join(temporary, 'page.html'), invalid ? valid.replace('</main>', '<img></main>') : valid);
            const output = path.join(temporary, 'output');
            fs.writeFileSync(output, '');
            const result = spawn(process.execPath, [entry], { cwd: temporary, env: { PATH: process.env.PATH, INPUT_FILES: 'page.html', RUNNER_TEMP: temporary, GITHUB_OUTPUT: output }, encoding: 'utf8', timeout: 15000, maxBuffer: MAX_BYTES });
            if (result.error || result.signal || result.status !== (invalid ? 1 : 0))
                fail('Packed Action smoke produced an unexpected process status.');
            const sarif = JSON.parse(readRegular(path.join(temporary, 'zemdomu.sarif'), 1024 * 1024));
            const findings = sarif.runs?.[0]?.results;
            if (sarif.version !== '2.1.0' || !Array.isArray(findings) || (!invalid && findings.length !== 0) || (invalid && (findings.length !== 1 || findings[0].ruleId !== 'ZMD004' || findings[0].level !== 'error')) || !fs.readFileSync(output, 'utf8').includes('zemdomu.sarif'))
                fail('Packed Action smoke lost expected diagnostics or SARIF output.');
        }
    }
    finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}
export function inspectCandidate({ directory, expectedCommit, version, publish, env = process.env }) {
    validateInputs({ expectedCommit, version, publish });
    assertContext(env, expectedCommit);
    const candidate = JSON.parse(readRegular(path.join(directory, 'candidate.json'), 256 * 1024));
    if (candidate.format !== 1 || candidate.repository !== REPOSITORY || candidate.expectedCommit !== expectedCommit || candidate.version !== version || candidate.publish !== publish ||
        candidate.build?.runId !== Number(env.GITHUB_RUN_ID) || candidate.build?.attempt !== Number(env.GITHUB_RUN_ATTEMPT) || candidate.build?.workflow !== identity ||
        candidate.artifact?.name !== `zemdomu-action-${version}.tgz` || !positive(candidate.artifact.size) || !/^sha256:[a-f0-9]{64}$/.test(candidate.artifact.digest ?? ''))
        fail('Artifact record is not bound to this exact public source/run/attempt and mode.');
    const bytes = readRegular(path.join(directory, candidate.artifact.name));
    if (bytes.length !== candidate.artifact.size || digest(bytes) !== candidate.artifact.digest)
        fail('Release archive bytes differ from the tested candidate.');
    return candidate;
}
export async function prepareCandidate({ directory, rootDirectory, expectedCommit, version, publish, env = process.env, github = githubApi, exec = execFileSync }) {
    const gate = await verifyGates({ expectedCommit, version, publish, github });
    assertContext(env, expectedCommit);
    if (exec('git', ['rev-parse', 'HEAD'], { cwd: rootDirectory, encoding: 'utf8' }).trim() !== expectedCommit || exec('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: rootDirectory, encoding: 'utf8' }).trim())
        fail('Packed release checkout must be the clean exact public source.');
    const notes = extractNotes(fs.readFileSync(path.join(rootDirectory, 'CHANGELOG.md'), 'utf8'), version);
    if (notes !== gate.notes)
        fail('Local release notes differ from public source.');
    const artifact = inspectArchive({ archivePath: path.join(directory, `zemdomu-action-${version}.tgz`), rootDirectory, version, exec });
    smokeArchive({ archivePath: path.join(directory, artifact.name), exec });
    const candidate = { format: 1, repository: REPOSITORY, expectedCommit, version, publish, notes, artifact, build: { runId: Number(env.GITHUB_RUN_ID), attempt: Number(env.GITHUB_RUN_ATTEMPT), workflow: identity } };
    fs.writeFileSync(path.join(directory, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
    return inspectCandidate({ directory, expectedCommit, version, publish, env });
}
export function verifyStatement(bundle, candidate) {
    if (!bundle || !bundle.dsseEnvelope || !bundle.verificationMaterial || !Array.isArray(bundle.dsseEnvelope.signatures) || bundle.dsseEnvelope.signatures.length !== 1 || typeof bundle.dsseEnvelope.signatures[0].sig !== 'string' || !bundle.dsseEnvelope.signatures[0].sig || bundle.dsseEnvelope.payloadType !== 'application/vnd.in-toto+json')
        fail('Expected an original signed Sigstore DSSE bundle.');
    let statement;
    try {
        statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
    }
    catch {
        fail('Invalid SLSA statement payload.');
    }
    const predicate = statement.predicate;
    const build = predicate?.buildDefinition;
    if (statement._type !== 'https://in-toto.io/Statement/v1' || statement.predicateType !== 'https://slsa.dev/provenance/v1' ||
        !isDeepStrictEqual(statement.subject, [{ name: candidate.artifact.name, digest: { sha256: candidate.artifact.digest.slice(7) } }]) ||
        build?.buildType !== 'https://actions.github.io/buildtypes/workflow/v1' || build.externalParameters?.workflow?.repository !== `https://github.com/${REPOSITORY}` || build.externalParameters.workflow.path !== WORKFLOW || build.externalParameters.workflow.ref !== 'refs/heads/main' ||
        !build.resolvedDependencies?.some(d => d.uri === `git+https://github.com/${REPOSITORY}@refs/heads/main` && d.digest?.gitCommit === candidate.expectedCommit) ||
        predicate.runDetails?.builder?.id !== identity || predicate.runDetails.metadata?.invocationId !== `https://github.com/${REPOSITORY}/actions/runs/${candidate.build.runId}/attempts/${candidate.build.attempt}`)
        fail('Attestation subject, source, workflow or invocation does not match the exact tested build.');
    return statement;
}
export function verifyProvenance({ directory, candidate, exec = execFileSync }) {
    const bundlePath = path.join(directory, 'provenance.sigstore.json');
    const bytes = readRegular(bundlePath, 1024 * 1024);
    const bundle = JSON.parse(bytes);
    verifyStatement(bundle, candidate);
    exec('cosign', ['verify-blob-attestation', '--bundle', bundlePath, '--type', 'slsaprovenance1', '--certificate-identity', identity, '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com', '--certificate-github-workflow-sha', candidate.expectedCommit, path.join(directory, candidate.artifact.name)], { encoding: 'utf8', maxBuffer: MAX_BYTES, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { bundle, bytes };
}
export function exportProvenance({ directory, candidate, bundlePath, exec = execFileSync }) {
    const bytes = readRegular(bundlePath, 1024 * 1024);
    fs.writeFileSync(path.join(directory, 'provenance.sigstore.json'), bytes, { flag: 'wx' });
    const verified = verifyProvenance({ directory, candidate, exec });
    fs.writeFileSync(path.join(directory, 'provenance.intoto.jsonl'), JSON.stringify(verified.bundle.dsseEnvelope) + '\n', { flag: 'wx' });
}
async function optional(github, endpoint) {
    try {
        return await github(endpoint);
    }
    catch (e) {
        if (e.status === 404)
            return null;
        throw e;
    }
}
async function tagCommit(github, tag) {
    const ref = await optional(github, `${PREFIX}/git/ref/tags/${tag}`);
    if (!ref)
        return null;
    if (ref.ref !== `refs/tags/${tag}`)
        fail('Unexpected release tag ref.');
    let obj = ref.object;
    const seen = new Set();
    while (obj?.type === 'tag') {
        if (seen.has(obj.sha) || seen.size >= 4)
            fail('Invalid tag chain.');
        seen.add(obj.sha);
        obj = (await github(`${PREFIX}/git/tags/${obj.sha}`)).object;
    }
    if (obj?.type !== 'commit' || !/^[a-f0-9]{40}$/.test(obj.sha ?? ''))
        fail('Tag does not resolve to a commit.');
    return obj.sha;
}
export async function publishRelease({ directory, expectedCommit, version, publish, env = process.env, github = githubApi, exec = execFileSync }) {
    const input = { directory, expectedCommit, version, publish, env };
    let candidate = inspectCandidate(input);
    if (publish !== true)
        fail('Build-only validation cannot publish a release.');
    const gate = await verifyGates({ expectedCommit, version, publish, github });
    if (gate.notes !== candidate.notes)
        fail('Candidate release notes differ from fresh public source.');
    verifyProvenance({ directory, candidate, exec });
    const envelope = readRegular(path.join(directory, 'provenance.intoto.jsonl'), 1024 * 1024);
    if (envelope.toString('utf8') !== JSON.stringify(JSON.parse(readRegular(path.join(directory, 'provenance.sigstore.json'), 1024 * 1024)).dsseEnvelope) + '\n')
        fail('DSSE export differs from the original verified bundle.');
    const files = [candidate.artifact.name, 'provenance.sigstore.json', 'provenance.intoto.jsonl'].map(name => { const bytes = readRegular(path.join(directory, name)); return { name, bytes, size: bytes.length, digest: digest(bytes) }; });
    const tag = `v${version}`;
    const existingTag = await tagCommit(github, tag);
    if (existingTag && existingTag !== expectedCommit)
        fail('Existing immutable tag points at another source commit.');
    const previous = await optional(github, `${PREFIX}/releases/tags/${tag}`);
    if (previous && (previous.tag_name !== tag || previous.name !== tag || previous.draft !== false || previous.prerelease !== false || previous.body !== candidate.notes || !positive(previous.id) || !Array.isArray(previous.assets)))
        fail('Existing release identity, channel or notes conflict.');
    const existingAssets = new Map();
    for (const a of previous?.assets ?? []) {
        if (existingAssets.has(a.name) || !positive(a.id) || !positive(a.size) || !/^sha256:[a-f0-9]{64}$/.test(a.digest ?? ''))
            fail('Existing release assets have ambiguous metadata.');
        existingAssets.set(a.name, a);
    }
    for (const file of files) {
        const old = existingAssets.get(file.name);
        if (old && (old.size !== file.size || old.digest !== file.digest || !(await github(`${PREFIX}/releases/assets/${old.id}`, { binary: true })).equals(file.bytes)))
            fail('Existing immutable release asset differs from tested bytes.');
    }
    const latest = await optional(github, `${PREFIX}/releases/latest`);
    if (latest && (!/^v\d+\.\d+\.\d+$/.test(latest.tag_name) || compareVersion(latest.tag_name.slice(1), version) > 0))
        fail('An older release cannot replace Latest.');
    // Recheck source/run attempts and local bytes immediately before the first mutation.
    const finalGate = await verifyGates({ expectedCommit, version, publish, github });
    if (finalGate.notes !== candidate.notes || !isDeepStrictEqual(inspectCandidate(input), candidate))
        fail('Release candidate changed before publication.');
    for (const file of files)
        if (!readRegular(path.join(directory, file.name)).equals(file.bytes))
            fail('Release bytes changed before publication.');
    if (await tagCommit(github, tag) !== existingTag || !isDeepStrictEqual(await optional(github, `${PREFIX}/releases/tags/${tag}`), previous))
        fail('Existing tag or release changed before publication.');
    if (!existingTag)
        await github(`${PREFIX}/git/refs`, { method: 'POST', body: { ref: `refs/tags/${tag}`, sha: expectedCommit } });
    if (await tagCommit(github, tag) !== expectedCommit)
        fail('Tag identity changed during publication.');
    const body = { tag_name: tag, name: tag, body: candidate.notes, draft: false, prerelease: false, make_latest: 'true' };
    const release = await github(previous ? `${PREFIX}/releases/${previous.id}` : `${PREFIX}/releases`, { method: previous ? 'PATCH' : 'POST', body: previous ? body : { ...body, target_commitish: expectedCommit } });
    if (!positive(release?.id))
        fail('Missing published release ID.');
    for (const file of files) {
        if (!existingAssets.has(file.name))
            exec('gh', ['release', 'upload', tag, path.join(directory, file.name), '--repo', REPOSITORY], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: MAX_BYTES });
    }
    const current = await github(`${PREFIX}/releases/tags/${tag}`);
    if (current?.id !== release.id || current.tag_name !== tag || current.name !== tag || current.body !== candidate.notes || current.draft !== false || current.prerelease !== false || !Array.isArray(current.assets))
        fail('Published release metadata changed.');
    if (new Set(current.assets.map(a => a.name)).size !== current.assets.length)
        fail('Published asset names are ambiguous.');
    if (!isDeepStrictEqual(current.assets.map(a => a.name).sort(), [...new Set([...existingAssets.keys(), ...files.map(f => f.name)])].sort()))
        fail('Release asset inventory changed during publication.');
    for (const file of files) {
        const remote = current.assets.find(a => a.name === file.name);
        if (!remote || !positive(remote.id) || remote.size !== file.size || remote.digest !== file.digest || !(await github(`${PREFIX}/releases/assets/${remote.id}`, { binary: true })).equals(file.bytes))
            fail('Published release download differs from the exact tested artifact.');
    }
    for (const [name, old] of existingAssets) {
        const next = current.assets.find(a => a.name === name);
        if (!next || next.id !== old.id || next.size !== old.size || next.digest !== old.digest)
            fail('An existing asset changed during publication.');
    }
    if (await tagCommit(github, tag) !== expectedCommit || (await github(`${PREFIX}/releases/latest`))?.tag_name !== tag)
        fail('Published tag or stable Latest identity is incorrect.');
    workflow(await github(`${PREFIX}/actions/workflows/${WORKFLOWS.signing.id}`), WORKFLOWS.signing);
    await github(`${PREFIX}/dispatches`, { method: 'POST', body: { event_type: 'zemdomu-sign-release', client_payload: { tag } } });
    return { repository: REPOSITORY, commit: expectedCommit, version, release: `https://github.com/${REPOSITORY}/releases/tag/${tag}`, artifact: candidate.artifact, reusedAssets: files.filter(f => existingAssets.has(f.name)).map(f => f.name), signing: 'dispatched; verify separate signing run before claiming signatures' };
}
function compareVersion(a, b) {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < 3; i++)
        if (x[i] !== y[i])
            return x[i] - y[i];
    return 0;
}
export function readOnlyEnvironment(env, allowReadToken = true) {
    const child = { ...env };
    for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_READ_TOKEN', 'VSCE_PAT', 'MIRROR_SYNC_PAT', 'SYNC_TOKEN', 'REGISTRY_TOKEN', 'CORE_SYNC_PAT', 'EXTENSION_SYNC_PAT', 'ACTIONS_SYNC_PAT'])
        delete child[name];
    if (allowReadToken && (env.GH_READ_TOKEN || env.GH_TOKEN))
        child.GH_TOKEN = env.GH_READ_TOKEN || env.GH_TOKEN;
    return child;
}
export function createReadOnlyGithubApi({ env = process.env, spawn = spawnSync } = {}) {
    return (endpoint, options = {}) => {
        if ((options.method && options.method !== 'GET') || options.body !== undefined || !endpoint.startsWith(`${PREFIX}/`))
            fail('Published verification only allows fixed public-repository GET requests.');
        const args = ['api', '--hostname', 'github.com', '--method', 'GET', endpoint];
        if (options.binary)
            args.push('-H', 'Accept: application/octet-stream');
        const result = spawn('gh', args, { env: readOnlyEnvironment(env), encoding: options.binary ? null : 'utf8', timeout: 60000, maxBuffer: MAX_BYTES });
        if (result.error || result.status !== 0)
            fail('Cannot read public Action release verification evidence.');
        if (options.binary) {
            if (!Buffer.isBuffer(result.stdout))
                fail('Expected binary public release download.');
            return result.stdout;
        }
        try {
            return JSON.parse(result.stdout);
        }
        catch {
            fail('Malformed public verification metadata.');
        }
    };
}
export async function verifyPublished({ expectedCommit, version, env = process.env, github, exec = execFileSync }) {
    validateInputs({ expectedCommit, version, publish: true });
    github ??= createReadOnlyGithubApi({ env });
    const tag = `v${version}`;
    const manifest = JSON.parse(content(await github(`${PREFIX}/contents/package.json?ref=${expectedCommit}`), 'package.json'));
    const lock = JSON.parse(content(await github(`${PREFIX}/contents/package-lock.json?ref=${expectedCommit}`), 'package-lock.json'));
    if (manifest.name !== 'zemdomu-action' || manifest.version !== version || manifest.license !== 'MIT' || manifest.repository?.url !== `git+https://github.com/${REPOSITORY}.git` || lock.name !== manifest.name || lock.version !== version || lock.packages?.['']?.version !== version || lock.packages?.['']?.name !== manifest.name)
        fail('Published package/lock identity differs from approved source.');
    const notes = extractNotes(content(await github(`${PREFIX}/contents/CHANGELOG.md?ref=${expectedCommit}`), 'CHANGELOG.md'), version);
    if (await tagCommit(github, tag) !== expectedCommit)
        fail('Published tag does not resolve to the approved source.');
    const release = await github(`${PREFIX}/releases/tags/${tag}`);
    const releaseIdentity = value => {
        if (!positive(value?.id) || value.tag_name !== tag || value.name !== tag || value.body !== notes || value.draft !== false || value.prerelease !== false || !Array.isArray(value.assets) || new Set(value.assets.map(a => a.name)).size !== value.assets.length)
            fail('Published release identity, notes or channel differs.');
    };
    releaseIdentity(release);
    const names = [`zemdomu-action-${version}.tgz`, 'provenance.sigstore.json', 'provenance.intoto.jsonl'];
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-action-release-'));
    try {
        const assets = [];
        for (const name of names) {
            const asset = release.assets.find(a => a.name === name);
            if (!asset || !positive(asset.id) || !positive(asset.size) || asset.size > MAX_BYTES || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? ''))
                fail('Published artifact/provenance metadata is missing or invalid.');
            const bytes = await github(`${PREFIX}/releases/assets/${asset.id}`, { binary: true });
            if (!Buffer.isBuffer(bytes) || bytes.length !== asset.size || digest(bytes) !== asset.digest)
                fail('Published bytes differ from immutable API metadata.');
            fs.writeFileSync(path.join(temp, name), bytes, { flag: 'wx' });
            assets.push(asset);
        }
        const bundle = JSON.parse(readRegular(path.join(temp, 'provenance.sigstore.json'), 1024 * 1024));
        let payload;
        try {
            payload = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
        }
        catch {
            fail('Published attestation payload is malformed.');
        }
        const invocation = payload.predicate?.runDetails?.metadata?.invocationId;
        const match = new RegExp(`^https://github\\.com/${REPOSITORY}/actions/runs/([1-9][0-9]*)/attempts/([1-9][0-9]*)$`).exec(invocation ?? '');
        if (!match || !positive(Number(match[1])) || !positive(Number(match[2])))
            fail('Published provenance must identify one public build run and attempt.');
        const candidate = { format: 1, repository: REPOSITORY, expectedCommit, version, publish: true, notes, artifact: { name: names[0], size: assets[0].size, digest: assets[0].digest }, build: { runId: Number(match[1]), attempt: Number(match[2]), workflow: identity } };
        const safeExec = (command, args, options) => exec(command, args, { ...options, env: readOnlyEnvironment(env, false) });
        verifyProvenance({ directory: temp, candidate, exec: safeExec });
        if (readRegular(path.join(temp, names[2]), 1024 * 1024).toString('utf8') !== JSON.stringify(bundle.dsseEnvelope) + '\n')
            fail('Published DSSE export differs from original signed bundle.');
        const workflowMetadata = await github(`${PREFIX}/actions/workflows/release-action.yml`);
        if (!positive(workflowMetadata?.id) || workflowMetadata.path !== WORKFLOW || workflowMetadata.state !== 'active')
            fail('Published builder workflow identity is invalid.');
        const run = await github(`${PREFIX}/actions/runs/${candidate.build.runId}`);
        const assertRun = value => {
            if (value?.id !== candidate.build.runId || value.workflow_id !== workflowMetadata.id || value.path !== WORKFLOW || value.head_sha !== expectedCommit || value.head_branch !== 'main' || value.repository?.full_name !== REPOSITORY || value.head_repository?.full_name !== REPOSITORY || !['workflow_dispatch', 'repository_dispatch'].includes(value.event) || value.run_attempt !== candidate.build.attempt || value.status !== 'completed' || value.conclusion !== 'success' || value.html_url !== `https://github.com/${REPOSITORY}/actions/runs/${candidate.build.runId}`)
                fail('Attested public publisher run has not completed successfully on the exact source/attempt.');
        };
        assertRun(run);
        const response = await github(`${PREFIX}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
        if (!Array.isArray(response?.jobs) || response.total_count !== 3 || response.jobs.length !== 3 || new Set(response.jobs.map(j => j.id)).size !== 3 || new Set(response.jobs.map(j => j.name)).size !== 3)
            fail('Published build/attestation/publication jobs are incomplete.');
        const steps = { build: ['Build, audit and test the actual Action archive without write permissions', 'Smoke-test packed bytes and bind the public build record', 'Retain exact original build bytes'], attest: ['Recheck original build record before attestation', 'Attest the exact built tarball', 'Verify and retain the original signed SLSA bundle and DSSE envelope', 'Retain attested release or build-only validation evidence'], publish: ['Publish exact verified bytes and dispatch signatures after every asset is final'] };
        for (const job of response.jobs) {
            if (!Object.hasOwn(steps, job.name) || !positive(job.id) || job.run_id !== run.id || job.run_attempt !== run.run_attempt || job.head_sha !== expectedCommit || job.status !== 'completed' || job.conclusion !== 'success')
                fail('Public publisher job source, attempt or conclusion differs.');
            for (const name of steps[job.name])
                successfulStep(job, name);
        }
        // Re-read mutable API identities after crypto and original run validation.
        assertRun(await github(`${PREFIX}/actions/runs/${run.id}`));
        const current = await github(`${PREFIX}/releases/tags/${tag}`);
        releaseIdentity(current);
        if (current.id !== release.id || await tagCommit(github, tag) !== expectedCommit || (await github(`${PREFIX}/releases/latest`))?.id !== release.id)
            fail('Published release/tag/Latest changed during verification.');
        for (const asset of assets) {
            const currentAsset = current.assets.find(a => a.name === asset.name);
            if (!currentAsset || ['id', 'name', 'size', 'digest'].some(key => currentAsset[key] !== asset[key]))
                fail('Published immutable asset identity changed during verification.');
        }
        return { repository: REPOSITORY, commit: expectedCommit, version, release: release.html_url ?? `https://github.com/${REPOSITORY}/releases/tag/${tag}`, run: run.html_url, runAttempt: run.run_attempt, artifact: candidate.artifact, provenanceVerified: true, signing: 'dispatched separately; inspect and verify artifact signature before claiming completion' };
    }
    finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
}
async function cli() {
    const [command, expectedCommit, version, rawPublish, directory, bundlePath, ...extra] = process.argv.slice(2);
    if (command === 'verify-published') {
        if (rawPublish !== undefined)
            fail('Expected verify-published <commit> <version>.');
        return console.log(JSON.stringify(await verifyPublished({ expectedCommit, version })));
    }
    if (!['gate', 'prepare', 'check', 'verify', 'export', 'publish'].includes(command) || !['true', 'false'].includes(rawPublish) || extra.length || (command !== 'gate' && !directory) || (command === 'export' && !bundlePath) || (command !== 'export' && bundlePath))
        fail('Expected command, exact commit, version, explicit boolean mode and required artifact paths.');
    const publish = rawPublish === 'true';
    validateInputs({ expectedCommit, version, publish });
    assertContext(process.env, expectedCommit);
    if (command === 'gate')
        return console.log(JSON.stringify(await verifyGates({ expectedCommit, version, publish })));
    const input = { directory, expectedCommit, version, publish };
    if (command === 'prepare') {
        const candidate = await prepareCandidate({ ...input, rootDirectory: process.cwd() });
        if (process.env.GITHUB_OUTPUT)
            fs.appendFileSync(process.env.GITHUB_OUTPUT, `asset_name=${candidate.artifact.name}\npublish=${publish}\n`);
        return console.log(JSON.stringify(candidate));
    }
    const candidate = inspectCandidate(input);
    if (['check', 'verify', 'publish'].includes(command)) {
        if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== expectedCommit)
            fail('Verification checkout differs from approved source.');
        const packed = inspectArchive({ archivePath: path.join(directory, candidate.artifact.name), rootDirectory: process.cwd(), version });
        if (!isDeepStrictEqual(packed, candidate.artifact))
            fail('Transferred archive differs from the fresh public checkout.');
    }
    if (command === 'export') {
        exportProvenance({ directory, candidate, bundlePath });
        return;
    }
    if (command === 'check' || command === 'verify') {
        const gates = await verifyGates({ expectedCommit, version, publish });
        if (gates.notes !== candidate.notes)
            fail('Candidate notes differ from current public source.');
        if (command === 'verify')
            verifyProvenance({ directory, candidate });
        return;
    }
    console.log(JSON.stringify(await publishRelease(input)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
    cli().catch(error => { console.error(error.releaseBoundary ? error.message : 'Action release operation failed; credential-bearing subprocess output was not printed.'); process.exitCode = 1; });
