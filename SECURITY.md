# Security policy

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/Zemdomu/ZemDomu-action/security/advisories/new) for this repository. The form sends the report privately to repository maintainers.

Include:

- The affected repository, package version, and runtime or editor version.
- The security impact and the conditions needed to reproduce it.
- A minimal proof of concept with private source, credentials, and personal
  information removed.

Keep exploit details out of public issues and pull requests. If the private
reporting form is unavailable, open an issue asking for a private security
contact, without including vulnerability details.

## Versions and fixes

Identify the exact version or commit you tested. Check the latest published
version when practical, and note whether the problem still occurs. Maintainers
can use the private report to discuss affected versions, a fix, and disclosure.
Coordinate public disclosure so affected users have a chance to update.

## Ordinary product reports

False positives, missed accessibility findings, documentation errors, and
feature requests belong in the repository's issue forms unless they expose a
security vulnerability. A clean ZemDomu scan does not establish that an
application is secure or accessible.

## Verify release downloads

GitHub release downloads include a matching `.sigstore.json` verification bundle
when signed. Download both the artifact and its bundle from the same release,
then verify with [Cosign](https://docs.sigstore.dev/cosign/verifying/verify/):

```bash
cosign verify-blob \
  --bundle ARTIFACT.sigstore.json \
  --certificate-identity https://github.com/REPOSITORY/.github/workflows/sign-release-artifacts.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ARTIFACT
```

Replace `ARTIFACT` with the downloaded filename and `REPOSITORY` with
`Zemdomu/ZemDomu-action`. Verification checks the file bytes and the public signing
workflow's identity. Signatures added to earlier releases record a later signing
operation; they do not establish how the original artifact was built. npm
provenance, when available, is separate build evidence.

## Verify public build provenance

Releases built by `.github/workflows/release-action.yml` additionally provide
`provenance.sigstore.json` and `provenance.intoto.jsonl`. The former retains the
original signed SLSA build statement and certificate/transparency evidence; the
latter contains its unchanged signed DSSE envelope. These describe the public
build that produced the exact release tarball. Their presence does not imply
that older releases were built by that workflow.

Download the tarball and provenance bundle from the same release, resolve its
version tag to the reviewed commit, and verify using that exact commit:

```bash
cosign verify-blob-attestation \
  --bundle provenance.sigstore.json \
  --type slsaprovenance1 \
  --certificate-identity https://github.com/Zemdomu/ZemDomu-action/.github/workflows/release-action.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-github-workflow-sha REVIEWED_COMMIT \
  zemdomu-action-VERSION.tgz
```

Do not disable subject, certificate or transparency-log verification. Build-only
workflow runs retain validation artifacts and attestations without creating or
changing a product version, tag or GitHub release.
