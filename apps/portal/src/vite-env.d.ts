/// <reference types="vite/client" />

/**
 * The build-time settings this portal reads.
 *
 * `vite/client` types `import.meta.env` with an index signature, so every
 * `VITE_` name is `any` and a typo in one is a runtime surprise rather than a
 * compile error. Naming them here is what makes `agentAppUrl()` type-check as
 * `string | undefined` and what makes a misspelling fail the build.
 */
interface ImportMetaEnv {
  /**
   * Absolute URL of the agent PWA, for the deployments where this portal has
   * its own hostname and cannot infer it from the base path. Unset in the
   * combined image, where the base path answers the question.
   */
  readonly VITE_AGENT_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
