import { parseYaml } from './yaml-lite.mjs';

// CLOSED TEST grammar, not a general YAML or shell parser. The accepted language
// is exactly this enumerated document after per-newline CRLF-to-LF normalization
// (LF, CRLF or mixed LF/CRLF accepted; bare CR refused), including every mapping,
// block-scalar line and command in order. No comments, alternate indentation,
// aliases, extra keys/steps/jobs, quoting variants or shell extensions accepted.
// Exact consumption prevents yaml-lite's silent omissions/duplicate overwrites
// from approving unknown structure. Only the already constrained event header
// goes through yaml-lite, following the shipped-boot header-only convention.
// /TEST commands and pins are symbolic obligations, NOT runnable worker APIs,
// private-path validation, approved authority, or a controller deployment.
const HEADER = `name: INACTIVE TEST protected evidence
on:
  workflow_run:
    workflows: [INACTIVE TEST campaign]
    types: [completed]
`;
const BODY = `permissions:
  contents: read
concurrency:
  group: TEST-independent-final-collector
  cancel-in-progress: false
jobs:
  test-shape:
    if: false
    runs-on: ubuntu-latest
    steps:
      - name: TEST binding and terminal validation
        shell: bash
        run: |
          /TEST/controller validate --repository TEST/repository --controller TEST/controller@TEST-pin --candidate TEST-candidate --run-id event.workflow_run.id --run-attempt event.workflow_run.run_attempt --terminal-jobs TEST-build,TEST-campaign,TEST-cleanup --refuse-forks --root /TEST/private/authority
      - name: TEST admitted start inventory
        shell: bash
        run: |
          /TEST/controller admit --complete-image-set --recheck-before-every-start
          /TEST/controller start --no-build --pull-never --paths start,restart,harness-start,harness-restart
      - name: TEST diagnostic capture and cleanup
        shell: bash
        run: |
          /TEST/controller capture --diagnostic-not-final --preserve-failure
          /TEST/controller scan --private-context --before-state-deletion --refuse-transfer-on-failure
          /TEST/controller teardown --record-exit --preserve-result-outside-state
          /TEST/controller observe --post-cleanup --missing-on-cancel-or-runner-loss
          /TEST/controller scan --post-cleanup --private-context --exclude-scanner-secrets --refuse-transfer-on-failure
          /TEST/controller transfer --verified-post-cleanup --separate-collector --preserve-diagnostics
      - name: TEST download and archive
        shell: bash
        run: |
          /TEST/controller download --validated-event-run-only --after-terminal-validation
          node /TEST/protected/m1a-archive.mjs --contract /TEST/private/contract.json --expected-contract-sha256 TEST-contract-hash --inventory /TEST/private/inventory.json --input-root /TEST/private/source --scratch-root /TEST/private/upload-scratch --output /TEST/private/new-upload.json --allow-upload
      - name: TEST independent verification and owner boundary
        shell: bash
        run: |
          node /TEST/protected/verify-m1a-archive.mjs --facts /TEST/private/upload-facts.json --expected /TEST/private/independent-expected.json --authority /TEST/private/read-only-authority.json --scratch-root /TEST/private/review-scratch --output /TEST/private/new-review.json
          /TEST/controller disposition --pending-independent-owner-review --no-pass
`;
const BINDING = Object.freeze({ classification: 'TEST_ONLY', repository: 'TEST/repository', controller: 'TEST/controller@TEST-pin', authorityRoot: '/TEST/private/authority' });
const PROFILE = Object.freeze({ classification: 'TEST_ONLY', candidate: 'TEST-candidate', terminalJobs: Object.freeze(['TEST-build', 'TEST-campaign', 'TEST-cleanup']) });

// Compare closed data without coercion, getters, inherited selectors or toJSON.
function exactData(actual, expected) {
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (actual === null || typeof actual !== 'object') return false;
  if (Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) return false;
  const keys = Reflect.ownKeys(expected);
  if (Reflect.ownKeys(actual).length !== keys.length) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(actual, key);
    return descriptor && 'value' in descriptor && exactData(descriptor.value, expected[key]);
  });
}

/** Pure, TEST-only source-shape evaluation. No execution, I/O or worker imports.
 * Production and all unresolved/unsupported representations always refuse.
 * A clean result says only that the inactive symbolic TEST document matches.
 * It does not authenticate policy or prove runtime cleanup/custody/privacy.
 */
export function evaluateM1aProtectedWorkflowShape(workflowText, options) {
  const violations = [];
  try {
    if (!exactData(options, { protectedBinding: BINDING, campaignProfile: PROFILE })) {
      violations.push('Closed TEST_ONLY binding/profile required; production authority and profiles unresolved');
    }
    if (typeof workflowText !== 'string' || workflowText.length > 16384) {
      violations.push('Unsupported workflow input');
      return { violations };
    }
    const source = workflowText.replaceAll('\r\n', '\n');
    if (!source.startsWith(HEADER)) {
      violations.push('Unsupported event header: only the exact inactive TEST completion event is accepted');
    } else {
      const parsed = parseYaml(source.slice(0, HEADER.length));
      if (!exactData(parsed, { name: 'INACTIVE TEST protected evidence', on: { workflow_run: { workflows: ['INACTIVE TEST campaign'], types: ['completed'] } } })) {
        violations.push('TEST completion event header refused');
      }
    }
    // Entire source is consumed: even shell text that looks like YAML is covered.
    if (source !== HEADER + BODY) {
      violations.push('Unsupported or mutated TEST structure/command inventory: every line must match the closed grammar');
    }
  } catch {
    violations.push('Unsupported binding/profile or workflow structure');
  }
  return { violations };
}
