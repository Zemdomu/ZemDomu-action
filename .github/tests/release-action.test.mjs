import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { REPOSITORY, WORKFLOW, WORKFLOWS, validateInputs, assertContext, extractNotes, verifyGates, inspectCandidate, inspectArchive, readRegular, smokeArchive, verifyPublished, createReadOnlyGithubApi, readOnlyEnvironment, verifyStatement, verifyProvenance, exportProvenance, publishRelease } from '../scripts/release-action.mjs';
const commit = 'a'.repeat(40), version = '0.3.9', prefix = `repos/${REPOSITORY}`;
const notes = `## ${version}\n\n### Bugfix\n\n- Bugfix: preserve the verified Action behavior.\n`;
const changelog = `## Unreleased\n\n${notes}`;
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const env = { GITHUB_REPOSITORY: REPOSITORY, GITHUB_REF: 'refs/heads/main', GITHUB_SHA: commit, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_WORKFLOW_REF: `${REPOSITORY}/${WORKFLOW}@refs/heads/main`, GITHUB_RUN_ID: '500', GITHUB_RUN_ATTEMPT: '1' };
const identity = `https://github.com/${REPOSITORY}/${WORKFLOW}@refs/heads/main`;
function statement(candidate) { return { _type: 'https://in-toto.io/Statement/v1', subject: [{ name: candidate.artifact.name, digest: { sha256: candidate.artifact.digest.slice(7) } }], predicateType: 'https://slsa.dev/provenance/v1', predicate: { buildDefinition: { buildType: 'https://actions.github.io/buildtypes/workflow/v1', externalParameters: { workflow: { repository: `https://github.com/${REPOSITORY}`, path: WORKFLOW, ref: 'refs/heads/main' } }, resolvedDependencies: [{ uri: `git+https://github.com/${REPOSITORY}@refs/heads/main`, digest: { gitCommit: commit } }] }, runDetails: { builder: { id: identity }, metadata: { invocationId: `https://github.com/${REPOSITORY}/actions/runs/${candidate.build.runId}/attempts/${candidate.build.attempt}` } } } }; }
function bundle(candidate) { return { mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json', verificationMaterial: { certificate: { rawBytes: 'fixture' } }, dsseEnvelope: { payloadType: 'application/vnd.in-toto+json', payload: Buffer.from(JSON.stringify(statement(candidate))).toString('base64'), signatures: [{ sig: 'fixture-signature' }] } }; }
function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'action-release-contract-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const bytes = Buffer.from('exact tested tarball fixture');
    const artifact = { name: `zemdomu-action-${version}.tgz`, size: bytes.length, digest: sha(bytes) };
    const candidate = { format: 1, repository: REPOSITORY, expectedCommit: commit, version, publish: true, notes, artifact, build: { runId: 500, attempt: 1, workflow: identity } };
    fs.writeFileSync(path.join(directory, artifact.name), bytes);
    fs.writeFileSync(path.join(directory, 'candidate.json'), JSON.stringify(candidate));
    fs.writeFileSync(path.join(directory, 'provenance.sigstore.json'), JSON.stringify(bundle(candidate)) + '\n');
    fs.writeFileSync(path.join(directory, 'provenance.intoto.jsonl'), JSON.stringify(bundle(candidate).dsseEnvelope) + '\n');
    const manifest = { name: 'zemdomu-action', version, license: 'MIT', repository: { url: `git+https://github.com/${REPOSITORY}.git` } };
    const lock = { name: manifest.name, version, packages: { '': { name: manifest.name, version } } };
    const state = { writes: [], reads: [], uploads: [], crypto: [], manifest, lock, changelog, branch: { name: 'main', protected: true, commit: { sha: commit } }, runs: {}, histories: {}, jobs: {}, tag: null, release: null, latest: null, hook: () => { }, nextAssetId: 200 };
    for (const [name, spec] of Object.entries(WORKFLOWS).filter(([name]) => name !== 'signing')) {
        const run = { id: name === 'ci' ? 10 : 20, run_number: 10, run_attempt: 1, workflow_id: spec.id, path: spec.path, event: 'push', head_branch: 'main', head_sha: commit, repository: { full_name: REPOSITORY }, head_repository: { full_name: REPOSITORY }, status: 'completed', conclusion: 'success' };
        run.html_url = `https://github.com/${REPOSITORY}/actions/runs/${run.id}`;
        state.runs[name] = run;
        state.histories[spec.id] = [run];
        const names = name === 'ci' ? ['Test and build (Node 22)', 'Test and build (Node 24)'] : ['Analyze (actions)', 'Analyze (javascript-typescript)'];
        state.jobs[run.id] = names.map((jobName, index) => ({ id: run.id * 10 + index + 1, name: jobName, run_id: run.id, run_attempt: 1, head_sha: commit, status: 'completed', conclusion: 'success', steps: (name === 'ci' ? ['Install dependencies and build bundle', 'Check TypeScript', 'Run tests and rebuild bundle', 'Verify committed bundle is up to date', 'Test release boundaries', ...(index === 1 ? ['Measure direct TypeScript source coverage'] : [])] : ['Analyze source']).map(name => ({ name, status: 'completed', conclusion: 'success' })) }));
    }
    const notFound = () => { const e = new Error('404'); e.status = 404; throw e; };
    const github = async (endpoint, options = {}) => {
        state.hook(endpoint, options);
        state.reads.push(endpoint);
        if (options.method) {
            state.writes.push({ endpoint, ...structuredClone(options) });
            if (endpoint === `${prefix}/git/refs`) {
                state.tag = { ref: options.body.ref, object: { type: 'commit', sha: options.body.sha } };
                return structuredClone(state.tag);
            }
            if (endpoint === `${prefix}/releases` || endpoint === `${prefix}/releases/90`) {
                state.release = { id: 90, assets: state.release?.assets ?? [], ...options.body };
                state.latest = state.release;
                return structuredClone(state.release);
            }
            if (endpoint === `${prefix}/dispatches`)
                return null;
            assert.fail(`Unexpected mutation ${endpoint}`);
        }
        if (endpoint === `${prefix}/branches/main`)
            return structuredClone(state.branch);
        if (endpoint.startsWith(`${prefix}/contents/`)) {
            const name = endpoint.split('/contents/')[1].split('?')[0];
            const value = name === 'package.json' ? JSON.stringify(state.manifest) : name === 'package-lock.json' ? JSON.stringify(state.lock) : state.changelog;
            return { type: 'file', path: name, encoding: 'base64', content: Buffer.from(value).toString('base64') };
        }
        const wf = endpoint.match(/\/actions\/workflows\/(\d+|codeql\.yml|release-action\.yml)$/);
        if (wf) {
            if (wf[1] === 'release-action.yml')
                return { id: 30, path: WORKFLOW, state: 'active' };
            const spec = Object.values(WORKFLOWS).find(s => String(s.id) === wf[1] || s.path.endsWith('/' + wf[1]));
            return { id: spec.id, path: spec.path, state: 'active' };
        }
        const histories = endpoint.match(/\/actions\/workflows\/(\d+)\/runs\?/);
        if (histories) {
            const values = state.histories[histories[1]];
            return { total_count: values.length, workflow_runs: structuredClone(values) };
        }
        const jobs = endpoint.match(/\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs\?/);
        if (jobs)
            return { total_count: state.jobs[jobs[1]].length, jobs: structuredClone(state.jobs[jobs[1]]) };
        const run = endpoint.match(/\/actions\/runs\/(\d+)$/);
        if (run && run[1] === '500')
            return structuredClone(state.releaseRun);
        if (run)
            return structuredClone(Object.values(state.runs).find(r => String(r.id) === run[1]));
        if (endpoint === `${prefix}/git/ref/tags/v${version}`)
            return state.tag ? structuredClone(state.tag) : notFound();
        if (endpoint === `${prefix}/releases/tags/v${version}`)
            return state.release ? structuredClone(state.release) : notFound();
        if (endpoint === `${prefix}/releases/latest`)
            return state.latest ? structuredClone(state.latest) : notFound();
        const asset = endpoint.match(/\/releases\/assets\/(\d+)$/);
        if (asset) {
            assert.equal(options.binary, true);
            return Buffer.from(state.release.assets.find(a => String(a.id) === asset[1]).bytes);
        }
        assert.fail(`Unexpected read ${endpoint}`);
    };
    const exec = (command, args, options) => {
        if (command === 'cosign') {
            state.crypto.push(args);
            assert.ok(args.includes('--certificate-github-workflow-sha'));
            assert.ok(args.includes(commit));
            assert.ok(args.includes(identity));
            assert.ok(args.includes('https://token.actions.githubusercontent.com'));
            assert.ok(!args.some(a => a.includes('insecure') || a === '--check-claims=false'));
            return '';
        }
        assert.equal(command, 'gh');
        assert.deepEqual(args.slice(0, 3), ['release', 'upload', `v${version}`]);
        assert.ok(!args.includes('--clobber'));
        const name = path.basename(args[3]);
        const data = fs.readFileSync(args[3]);
        state.uploads.push(name);
        state.release.assets.push({ id: state.nextAssetId++, name, size: data.length, digest: sha(data), bytes: [...data] });
        return '';
    };
    const input = { directory, expectedCommit: commit, version, publish: true, env: { ...env }, github, exec };
    return { directory, candidate, bytes, state, github, exec, input };
}
const gateInput = f => ({ expectedCommit: commit, version, publish: false, github: f.github });
test('release inputs and context reject branch, source and nonboolean publication requests before use', () => {
    validateInputs({ expectedCommit: commit, version, publish: false });
    assertContext(env, commit);
    for (const value of ['true', 'false', undefined, 1])
        assert.throws(() => validateInputs({ expectedCommit: commit, version, publish: value }));
    for (const patch of [{ GITHUB_REPOSITORY: 'other/repo' }, { GITHUB_REF: 'refs/tags/v0.3.9' }, { GITHUB_SHA: 'b'.repeat(40) }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_WORKFLOW_REF: 'other/workflow' }])
        assert.throws(() => assertContext({ ...env, ...patch }, commit));
});
test('release notes preserve exact customer Markdown and reject unpromoted, duplicated or malformed sections', () => {
    assert.equal(extractNotes(changelog, version), notes);
    for (const text of [changelog.replace('## Unreleased', '## Unreleased\n\n- pending'), changelog + notes, changelog.replace('- Bugfix:', '- Security:'), changelog.replace('### Bugfix\n\n', '### Bugfix\n'), changelog.replaceAll('\n', '\\n')])
        assert.throws(() => extractNotes(text, version));
});
test('build-only qualification checks exact protected main, both Node jobs and both CodeQL jobs without mutations', async (t) => { const f = fixture(t); const result = await verifyGates(gateInput(f)); assert.equal(result.notes, notes); assert.deepEqual(Object.keys(result.evidence), ['ci', 'codeql']); assert.deepEqual(f.state.writes, []); });
for (const [name, mutate] of [
    ['unprotected main', f => { f.state.branch.protected = false; }], ['source drift', f => { f.state.branch.commit.sha = 'b'.repeat(40); }], ['lock drift', f => { f.state.lock.packages[''].version = '0.3.8'; }], ['version drift', f => { f.state.manifest.version = '0.3.8'; }], ['notes drift', f => { f.state.changelog = changelog.replace('## Unreleased', '## Unreleased\n\n- pending'); }],
    ['missing Node job', f => { f.state.jobs[10].pop(); }], ['missing CodeQL language', f => { f.state.jobs[20].pop(); }], ['skipped CI step', f => { f.state.jobs[10][0].steps[0].conclusion = 'skipped'; }], ['skipped coverage', f => { f.state.jobs[10][1].steps.at(-1).conclusion = 'skipped'; }], ['wrong job attempt', f => { f.state.jobs[10][0].run_attempt = 2; }], ['wrong CodeQL SHA', f => { f.state.jobs[20][0].head_sha = 'b'.repeat(40); }],
    ['newer failed run', f => { const next = { ...f.state.runs.ci, id: 11, run_number: 11, status: 'completed', conclusion: 'failure', html_url: `https://github.com/${REPOSITORY}/actions/runs/11` }; f.state.histories[WORKFLOWS.ci.id].push(next); }], ['newer pending run', f => { f.state.runs.codeql.status = 'queued'; }], ['foreign run', f => { f.state.runs.ci.head_repository.full_name = 'other/repo'; }],
])
    test(`gate fails closed on ${name}`, async (t) => { const f = fixture(t); mutate(f); await assert.rejects(verifyGates(gateInput(f))); assert.deepEqual(f.state.writes, []); });
test('a changed latest run attempt blocks otherwise successful job evidence', async (t) => {
    const f = fixture(t);
    f.state.hook = endpoint => {
        if (endpoint === `${prefix}/actions/runs/10`)
            f.state.runs.ci.run_attempt = 2;
    };
    await assert.rejects(verifyGates(gateInput(f)), /attempt changed/);
});
test('record binds the exact archive, public source, mode and originating run attempt', t => {
    const f = fixture(t);
    assert.equal(inspectCandidate(f.input).artifact.digest, sha(f.bytes));
    for (const patch of [{ publish: false }, { expectedCommit: 'b'.repeat(40) }, { env: { ...env, GITHUB_RUN_ATTEMPT: '2' } }])
        assert.throws(() => inspectCandidate({ ...f.input, ...patch }));
    fs.appendFileSync(path.join(f.directory, f.candidate.artifact.name), 'changed');
    assert.throws(() => inspectCandidate(f.input), /bytes differ/);
});
for (const [name, mutate] of [
    ['subject digest', s => { s.subject[0].digest.sha256 = '0'.repeat(64); }], ['subject name', s => { s.subject[0].name = 'different.tgz'; }], ['predicate', s => { s.predicateType = 'https://example.invalid/claim'; }], ['source SHA', s => { s.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = 'b'.repeat(40); }], ['workflow path', s => { s.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/other.yml'; }], ['workflow branch', s => { s.predicate.buildDefinition.externalParameters.workflow.ref = 'refs/heads/other'; }], ['builder', s => { s.predicate.runDetails.builder.id = 'https://example.invalid/builder'; }], ['run attempt', s => { s.predicate.runDetails.metadata.invocationId = s.predicate.runDetails.metadata.invocationId.replace('/attempts/1', '/attempts/2'); }],
])
    test(`provenance rejects mismatched ${name}`, t => { const f = fixture(t); const b = bundle(f.candidate), s = statement(f.candidate); mutate(s); b.dsseEnvelope.payload = Buffer.from(JSON.stringify(s)).toString('base64'); assert.throws(() => verifyStatement(b, f.candidate)); });
test('original bundle is cryptographically checked before its unchanged signed envelope is exported', t => { const f = fixture(t); const original = path.join(f.directory, 'original.json'); const bytes = fs.readFileSync(path.join(f.directory, 'provenance.sigstore.json')); fs.writeFileSync(original, bytes); fs.rmSync(path.join(f.directory, 'provenance.sigstore.json')); fs.rmSync(path.join(f.directory, 'provenance.intoto.jsonl')); exportProvenance({ directory: f.directory, candidate: f.candidate, bundlePath: original, exec: f.exec }); assert.deepEqual(fs.readFileSync(path.join(f.directory, 'provenance.sigstore.json')), bytes); assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.directory, 'provenance.intoto.jsonl'))), bundle(f.candidate).dsseEnvelope); assert.equal(f.state.crypto.length, 1); });
test('failed cryptographic verification blocks publication before any API mutation', async (t) => { const f = fixture(t); f.input.exec = () => { throw new Error('invalid signature'); }; await assert.rejects(publishRelease(f.input), /invalid signature/); assert.deepEqual(f.state.writes, []); });
test('publishes exact three assets, exact tag/notes/Latest and dispatches signatures only after downloads verify', async (t) => { const f = fixture(t); const result = await publishRelease(f.input); assert.equal(result.commit, commit); assert.deepEqual(f.state.uploads, [f.candidate.artifact.name, 'provenance.sigstore.json', 'provenance.intoto.jsonl']); assert.equal(f.state.tag.object.sha, commit); assert.equal(f.state.release.body, notes); assert.equal(f.state.latest.tag_name, `v${version}`); assert.equal(f.state.writes.at(-1).endpoint, `${prefix}/dispatches`); assert.equal(f.state.writes.at(-1).body.event_type, 'zemdomu-sign-release'); assert.deepEqual(f.state.writes.at(-1).body.client_payload, { tag: `v${version}` }); });
test('identical immutable assets are reused without uploading or replacing them', async (t) => { const f = fixture(t); await publishRelease(f.input); const ids = f.state.release.assets.map(a => a.id); f.state.uploads = []; const result = await publishRelease(f.input); assert.deepEqual(f.state.uploads, []); assert.deepEqual(f.state.release.assets.map(a => a.id), ids); assert.equal(result.reusedAssets.length, 3); });
for (const [name, mutate] of [
    ['build-only mode', f => { f.input.publish = false; f.candidate.publish = false; fs.writeFileSync(path.join(f.directory, 'candidate.json'), JSON.stringify(f.candidate)); }],
    ['conflicting existing tag', f => { f.state.tag = { ref: `refs/tags/v${version}`, object: { type: 'commit', sha: 'b'.repeat(40) } }; }],
    ['different notes', f => { f.candidate.notes = notes + 'unapproved'; fs.writeFileSync(path.join(f.directory, 'candidate.json'), JSON.stringify(f.candidate)); }],
    ['altered DSSE export', f => { fs.appendFileSync(path.join(f.directory, 'provenance.intoto.jsonl'), ' '); }],
])
    test(`publication rejects ${name} without mutations`, async (t) => { const f = fixture(t); mutate(f); await assert.rejects(publishRelease(f.input)); assert.deepEqual(f.state.writes, []); });
test('existing changed asset bytes are never overwritten', async (t) => { const f = fixture(t); await publishRelease(f.input); f.state.writes = []; f.state.release.assets[0].bytes = [0]; await assert.rejects(publishRelease(f.input), /immutable release asset differs/); assert.deepEqual(f.state.writes, []); });
test('an upload failure leaves signatures undispatched and never invokes clobber', async (t) => {
    const f = fixture(t);
    const exec = f.input.exec;
    f.input.exec = (command, ...args) => {
        if (command === 'gh')
            throw new Error('upload failed');
        return exec(command, ...args);
    };
    await assert.rejects(publishRelease(f.input), /upload failed/);
    assert.ok(!f.state.writes.some(w => w.endpoint.endsWith('/dispatches')));
});
test('real tar inventory and byte comparison detect a changed bundled runtime', t => {
    const f = fixture(t);
    const root = path.join(f.directory, 'source');
    const pack = path.join(f.directory, 'pack');
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(pack, 'package/dist'), { recursive: true });
    const files = { 'LICENSE': 'MIT\n', 'README.md': 'Release instructions\n', 'dist/index.js': 'console.log("original runtime");\n', 'dist/licenses.txt': 'MIT dependencies\n', 'package.json': JSON.stringify({ name: 'zemdomu-action', version }) };
    for (const [name, value] of Object.entries(files)) {
        fs.writeFileSync(path.join(root, name), value);
        fs.writeFileSync(path.join(pack, 'package', name), value);
    }
    const archive = path.join(f.directory, 'real.tgz');
    execFileSync('tar', ['-czf', archive, ...Object.keys(files).map(n => 'package/' + n)], { cwd: pack });
    assert.equal(inspectArchive({ archivePath: archive, rootDirectory: root, version }).name, `zemdomu-action-${version}.tgz`);
    fs.writeFileSync(path.join(root, 'dist/index.js'), 'changed runtime');
    assert.throws(() => inspectArchive({ archivePath: archive, rootDirectory: root, version }), /member differs/);
});
test('CLI rejects implicit publication or malformed arguments without network', () => { const file = fileURLToPath(new URL('../scripts/release-action.mjs', import.meta.url)); const result = spawnSync(process.execPath, [file, 'gate', commit, version, '"true"'], { encoding: 'utf8' }); assert.equal(result.status, 1); assert.match(result.stderr, /explicit boolean/); });
test('workflow separates read-only build, attestation, explicit publication and pinned immutable artifact transfer', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const workflow = fs.readFileSync(path.join(root, WORKFLOW), 'utf8');
    assert.match(workflow, /default: false/);
    assert.match(workflow, /types: \[zemdomu-action-release\]/);
    assert.doesNotMatch(workflow, /secrets\.|pull_request_target|--clobber|npm publish/);
    for (const [, action] of workflow.matchAll(/uses: ([^\s]+)/g))
        assert.match(action, /^(?:actions\/(?:checkout|setup-node|upload-artifact|download-artifact|attest)|sigstore\/cosign-installer)@[a-f0-9]{40}$/);
    const build = workflow.slice(workflow.indexOf('\n  build:\n'), workflow.indexOf('\n  attest:\n'));
    const attest = workflow.slice(workflow.indexOf('\n  attest:\n'), workflow.indexOf('\n  publish:\n'));
    const publish = workflow.slice(workflow.indexOf('\n  publish:\n'));
    assert.doesNotMatch(build, /contents: write|id-token: write|attestations: write/);
    assert.match(build, /npm run audit:production/);
    assert.match(build, /npm run audit:all/);
    assert.match(build, /npm test/);
    assert.match(build, /npm run test:coverage/);
    assert.match(build, /npm pack --pack-destination/);
    assert.match(build, /Smoke-test packed bytes/);
    assert.match(attest, /attestations: write/);
    assert.match(attest, /id-token: write/);
    assert.doesNotMatch(attest, /contents: write|npm ci|npm test|npm pack/);
    assert.match(attest, /artifact-ids: \$\{\{ needs\.build\.outputs\.artifact_id \}\}/);
    assert.match(attest, /digest-mismatch: error/);
    assert.match(publish, /needs\.build\.outputs\.publish == 'true'/);
    assert.match(publish, /contents: write/);
    assert.doesNotMatch(publish, /npm ci|npm test|npm pack|id-token: write|attestations: write/);
    assert.match(publish, /needs\.attest\.outputs\.artifact_id/);
    assert.match(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'), /Test release boundaries/);
});
function completedPublicRun(f) {
    f.state.releaseRun = { id: 500, workflow_id: 30, path: WORKFLOW, head_sha: commit, head_branch: 'main', repository: { full_name: REPOSITORY }, head_repository: { full_name: REPOSITORY }, event: 'repository_dispatch', run_attempt: 1, status: 'completed', conclusion: 'success', html_url: `https://github.com/${REPOSITORY}/actions/runs/500` };
    const steps = { build: ['Build, audit and test the actual Action archive without write permissions', 'Smoke-test packed bytes and bind the public build record', 'Retain exact original build bytes'], attest: ['Recheck original build record before attestation', 'Attest the exact built tarball', 'Verify and retain the original signed SLSA bundle and DSSE envelope', 'Retain attested release or build-only validation evidence'], publish: ['Publish exact verified bytes and dispatch signatures after every asset is final'] };
    f.state.jobs[500] = Object.entries(steps).map(([name, values], index) => ({ id: 5000 + index, name, run_id: 500, run_attempt: 1, head_sha: commit, status: 'completed', conclusion: 'success', steps: values.map(name => ({ name, status: 'completed', conclusion: 'success' })) }));
}
test('read-only client prefers the dedicated read token, strips write credentials, and cannot mutate or change repositories', () => {
    const env = { GH_TOKEN: 'write-sentinel', GH_READ_TOKEN: 'read-sentinel', GITHUB_TOKEN: 'duplicate-sentinel', VSCE_PAT: 'marketplace-sentinel', MIRROR_SYNC_PAT: 'mirror-sentinel', SYNC_TOKEN: 'sync-sentinel', PATH: process.env.PATH };
    const api = createReadOnlyGithubApi({ env, spawn: (command, args, options) => {
            assert.equal(command, 'gh');
            assert.deepEqual(args.slice(0, 5), ['api', '--hostname', 'github.com', '--method', 'GET']);
            assert.equal(options.env.GH_TOKEN, 'read-sentinel');
            for (const name of ['GH_READ_TOKEN', 'GITHUB_TOKEN', 'VSCE_PAT', 'MIRROR_SYNC_PAT', 'SYNC_TOKEN'])
                assert.equal(options.env[name], undefined);
            return { status: 0, stdout: '{}' };
        } });
    api(`${prefix}/releases/latest`);
    assert.throws(() => api(`${prefix}/dispatches`, { method: 'POST' }));
    assert.throws(() => api('repos/other/repo/releases/latest'));
    assert.equal(env.GH_TOKEN, 'write-sentinel');
    assert.equal(readOnlyEnvironment(env, false).GH_TOKEN, undefined);
});
test('private-context read-only verification proves publication from the original public source/run/attempt', async (t) => {
    const f = fixture(t);
    await publishRelease(f.input);
    completedPublicRun(f);
    f.state.writes = [];
    const verifierEnv = { GITHUB_REPOSITORY: 'private/orchestrator', GH_TOKEN: 'write-sentinel', GH_READ_TOKEN: 'read-sentinel', VSCE_PAT: 'marketplace-sentinel' };
    const exec = (command, args, options) => { assert.equal(command, 'cosign'); assert.equal(options.env.GH_TOKEN, undefined); assert.equal(options.env.GH_READ_TOKEN, undefined); assert.equal(options.env.VSCE_PAT, undefined); return f.exec(command, args, options); };
    const result = await verifyPublished({ expectedCommit: commit, version, env: verifierEnv, github: f.github, exec });
    assert.equal(result.provenanceVerified, true);
    assert.equal(result.runAttempt, 1);
    assert.equal(result.artifact.digest, sha(f.bytes));
    assert.deepEqual(f.state.writes, []);
});
for (const [name, mutate] of [
    ['pending original run', f => { f.state.releaseRun.status = 'in_progress'; f.state.releaseRun.conclusion = null; }],
    ['changed original attempt', f => { f.state.releaseRun.run_attempt = 2; }],
    ['wrong original workflow', f => { f.state.releaseRun.workflow_id = 99; }],
    ['skipped publication job', f => { f.state.jobs[500][2].conclusion = 'skipped'; }],
    ['missing original build checks', f => { f.state.jobs[500][0].steps.pop(); }],
    ['wrong release notes', f => { f.state.release.body = notes + 'changed'; }],
    ['wrong stable Latest', f => { f.state.latest = { id: 91, tag_name: 'v0.4.0' }; }],
    ['wrong asset bytes', f => { f.state.release.assets[0].bytes = [0]; }],
])
    test(`read-only publication verification rejects ${name}`, async (t) => { const f = fixture(t); await publishRelease(f.input); completedPublicRun(f); f.state.writes = []; mutate(f); await assert.rejects(verifyPublished({ expectedCommit: commit, version, github: f.github, exec: f.exec })); assert.deepEqual(f.state.writes, []); });
test('tag identity racing before the first mutation blocks publication', async (t) => {
    const f = fixture(t);
    let reads = 0;
    f.state.hook = endpoint => { if (endpoint === `${prefix}/git/ref/tags/v${version}` && ++reads === 2)
        f.state.tag = { ref: `refs/tags/v${version}`, object: { type: 'commit', sha: 'b'.repeat(40) } }; };
    await assert.rejects(publishRelease(f.input), /changed before publication/);
    assert.deepEqual(f.state.writes, []);
});
test('a newly pending CI run in the final source check blocks publication', async (t) => {
    const f = fixture(t);
    let manifests = 0;
    f.state.hook = endpoint => { if (endpoint === `${prefix}/contents/package.json?ref=${commit}` && ++manifests === 2)
        f.state.runs.ci.status = 'queued'; };
    await assert.rejects(publishRelease(f.input), /has not completed/);
    assert.deepEqual(f.state.writes, []);
});
test('packed smoke requires the actual invalid diagnostic, not just a failure exit', () => {
    let calls = 0;
    assert.throws(() => smokeArchive({ archivePath: '/fixture/archive.tgz', exec: () => Buffer.from('fixture runtime'), spawn: (_command, _args, options) => {
            for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_READ_TOKEN', 'VSCE_PAT'])
                assert.equal(options.env[key], undefined);
            const report = path.join(options.cwd, 'zemdomu.sarif');
            fs.writeFileSync(report, JSON.stringify({ version: '2.1.0', runs: [{ results: [] }] }));
            fs.writeFileSync(options.env.GITHUB_OUTPUT, report);
            return { status: ++calls === 1 ? 0 : 1, signal: null };
        } }), /lost expected diagnostics/);
    assert.equal(calls, 2);
});
test('read-only verification catches mutable public asset identity drift after crypto', async (t) => {
    const f = fixture(t);
    await publishRelease(f.input);
    completedPublicRun(f);
    f.state.writes = [];
    let reads = 0;
    f.state.hook = endpoint => { if (endpoint === `${prefix}/actions/runs/500` && ++reads === 2)
        f.state.release.assets[0].digest = 'sha256:' + '0'.repeat(64); };
    await assert.rejects(verifyPublished({ expectedCommit: commit, version, github: f.github, exec: f.exec }), /identity changed/);
    assert.deepEqual(f.state.writes, []);
});
test('bounded reads keep the originally opened file when its pathname is replaced', t => {
    const f = fixture(t);
    const file = path.join(f.directory, 'original-data');
    fs.writeFileSync(file, 'original');
    const io = { ...fs, openSync: (name, flags) => { const fd = fs.openSync(name, flags); fs.renameSync(file, file + '.old'); fs.writeFileSync(file, 'replacement'); return fd; } };
    assert.equal(readRegular(file, 32, io).toString(), 'original');
    assert.equal(fs.readFileSync(file, 'utf8'), 'replacement');
    const symlink = path.join(f.directory, 'symlink');
    fs.symlinkSync(file, symlink);
    assert.throws(() => readRegular(symlink, 32));
});
test('same-descriptor reads reject file growth and never consume more than limit plus one bytes', t => {
    const f = fixture(t);
    const file = path.join(f.directory, 'growing-data');
    fs.writeFileSync(file, '1234');
    let consumed = 0;
    let closed = false;
    const io = { ...fs, fstatSync: fd => { const before = fs.fstatSync(fd); fs.appendFileSync(file, '567890'); return before; }, readSync: (...args) => { const n = fs.readSync(...args); consumed += n; return n; }, closeSync: fd => { closed = true; fs.closeSync(fd); } };
    assert.throws(() => readRegular(file, 4, io), /grew beyond/);
    assert.equal(consumed, 5);
    assert.equal(closed, true);
});
test('a coherent new build run cannot replace immutable provenance from the prior published run', async (t) => {
    const f = fixture(t);
    await publishRelease(f.input);
    const originalIds = f.state.release.assets.map(a => a.id);
    f.state.writes = [];
    f.state.uploads = [];
    f.candidate.build.runId = 501;
    f.input.env.GITHUB_RUN_ID = '501';
    fs.writeFileSync(path.join(f.directory, 'candidate.json'), JSON.stringify(f.candidate));
    const fresh = bundle(f.candidate);
    verifyStatement(fresh, f.candidate);
    fs.writeFileSync(path.join(f.directory, 'provenance.sigstore.json'), JSON.stringify(fresh) + '\n');
    fs.writeFileSync(path.join(f.directory, 'provenance.intoto.jsonl'), JSON.stringify(fresh.dsseEnvelope) + '\n');
    await assert.rejects(publishRelease(f.input), /Existing immutable release asset differs/);
    assert.deepEqual(f.state.writes, []);
    assert.deepEqual(f.state.uploads, []);
    assert.deepEqual(f.state.release.assets.map(a => a.id), originalIds);
});
