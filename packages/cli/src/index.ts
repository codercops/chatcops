export { defineConfig, loadConfig, ConfigError, CONFIG_FILES, type ChatCopsCliConfig, type LoadedConfig } from './config.js';
export { runFixtures, type RunOptions } from './test/run.js';
export { loadFixture, findFixtures } from './test/load.js';
export { ASSERTIONS } from './test/assertions.js';
export type { Assertion, AssertionCheck, AssertionResult, Fixture, TestCase, TestResult, TestRunResult, Turn, TurnResult } from './test/types.js';
export { main, toSource, EXIT, type Io } from './main.js';
