import {CI_STATUS} from "../protocol.mjs";

export const RELEASE_MODE = Object.freeze({
  LOCAL: "local",
  PUBLISHED: "published",
});

export const RELEASE_CHECK = Object.freeze({
  STATIC: "static",
  RUNTIME: "runtime",
  DOCUMENTATION: "documentation",
  CI_POLICY: "ci-policy",
  PUBLISH_WORKFLOW: "publish-workflow",
  NEGATIVE_VERIFICATION: "negative-verification",
  DOCTOR: "doctor",
  TYPESCRIPT_SMOKE: "typescript-smoke",
  VUE_SMOKE: "vue-smoke",
  LIFECYCLE_SMOKE: "lifecycle-smoke",
  RELEASE_CONTRACT_SMOKE: "release-contract-smoke",
  AGENT_EVALUATION_SMOKE: "agent-evaluation-smoke",
  REPOSITORY_MATRIX_SMOKE: "repository-matrix-smoke",
  DISTRIBUTION_SMOKE: "distribution-smoke",
  BENCHMARK: "benchmark",
  REGISTRY: "registry",
  INSTALLATION: "installation",
  INSTALLED_VERSION: "installed-version",
  INSTALLED_DOCTOR: "installed-doctor",
  CODEX_MARKETPLACE: "codex-marketplace",
  CODEX_PLUGIN_INSTALLATION: "codex-plugin-installation",
  POSTPUBLICATION_ENVIRONMENT: "postpublication-environment",
});

export const RELEASE_REASON = Object.freeze({
  CHECK_COMPLETED: "check-completed",
  CHECK_FAILED: "check-failed",
  VERSION_REQUIRED: "version-required",
  REGISTRY_UNAVAILABLE: "registry-unavailable",
  VERSION_NOT_PUBLISHED: "version-not-published",
  INSTALLATION_FAILED: "installation-failed",
  INSTALLED_VERSION_DIFFERENT: "installed-version-different",
  DOCTOR_REJECTED_INSTALLATION: "doctor-rejected-installation",
  CODEX_CLI_UNAVAILABLE: "codex-cli-unavailable",
  CODEX_MARKETPLACE_UNAVAILABLE: "codex-marketplace-unavailable",
  CODEX_MARKETPLACE_FAILED: "codex-marketplace-installation-failed",
  CODEX_PLUGIN_SOURCE_UNAVAILABLE: "codex-plugin-source-unavailable",
  CODEX_PLUGIN_INSTALLATION_FAILED: "codex-plugin-installation-failed",
  CODEX_PLUGIN_VERSION_DIFFERENT: "codex-plugin-version-different",
  REGISTRY_RESPONSE_INVALID: "registry-response-invalid",
  VERIFICATION_ENVIRONMENT_UNAVAILABLE: "verification-environment-unavailable",
});

export const RELEASE_ARGUMENT = Object.freeze({
  PACKAGE_VERSION_OFFSET: 2,
});

export const RELEASE_LOCAL_CHECKS = Object.freeze([
  Object.freeze({name: RELEASE_CHECK.STATIC, npmScript: "check"}),
  Object.freeze({name: RELEASE_CHECK.RUNTIME, npmScript: "check:runtime"}),
  Object.freeze({name: RELEASE_CHECK.DOCUMENTATION, npmScript: "check:documentation"}),
  Object.freeze({name: RELEASE_CHECK.CI_POLICY, npmScript: "smoke:ci"}),
  Object.freeze({name: RELEASE_CHECK.PUBLISH_WORKFLOW, npmScript: "smoke:publish"}),
  Object.freeze({name: RELEASE_CHECK.NEGATIVE_VERIFICATION, npmScript: "smoke:negative"}),
  Object.freeze({name: RELEASE_CHECK.DOCTOR, npmScript: "smoke:doctor"}),
  Object.freeze({name: RELEASE_CHECK.TYPESCRIPT_SMOKE, npmScript: "smoke"}),
  Object.freeze({name: RELEASE_CHECK.VUE_SMOKE, npmScript: "smoke:vue"}),
  Object.freeze({name: RELEASE_CHECK.LIFECYCLE_SMOKE, npmScript: "smoke:lifecycle"}),
  Object.freeze({name: RELEASE_CHECK.RELEASE_CONTRACT_SMOKE, npmScript: "smoke:release"}),
  Object.freeze({name: RELEASE_CHECK.AGENT_EVALUATION_SMOKE, npmScript: "smoke:evaluation"}),
  Object.freeze({name: RELEASE_CHECK.REPOSITORY_MATRIX_SMOKE, npmScript: "smoke:matrix"}),
  Object.freeze({name: RELEASE_CHECK.DISTRIBUTION_SMOKE, npmScript: "smoke:distribution"}),
  Object.freeze({name: RELEASE_CHECK.BENCHMARK, npmScript: "benchmark"}),
]);

export function releaseStatus(checks) {
  if (checks.length === 0) return CI_STATUS.BLOCKED;
  if (checks.some((check) => check.status === CI_STATUS.BLOCKED)) return CI_STATUS.BLOCKED;
  if (checks.some((check) => check.status === CI_STATUS.FAIL)) return CI_STATUS.FAIL;
  if (checks.some((check) => check.status === CI_STATUS.UNTRUSTED)) return CI_STATUS.UNTRUSTED;
  return CI_STATUS.PASS;
}
