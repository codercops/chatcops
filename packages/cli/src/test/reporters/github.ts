import { appendFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { ConfigError } from '../../config.js';
import { sourceLines } from '../source-lines.js';
import type { TestResult } from '../types.js';
import type { ReporterFactory } from './index.js';

export const githubReporter: ReporterFactory = (output, { cwd = process.cwd(), env }) => ({
  async onEnd(results) {
    for (const result of results) {
      if (result.pass) continue;
      const fixture = env?.GITHUB_WORKSPACE
        ? relative(env.GITHUB_WORKSPACE, resolve(cwd, result.fixture)).split(sep).join('/')
        : result.fixture.split(sep).join('/');
      const file = escapeProperty(fixture);
      const title = escapeProperty(result.test);
      const line = sourceLines.get(result);
      const location = line === undefined ? '' : `,line=${line}`;
      output.write(`::error file=${file}${location},title=${title}::${escapeMessage(failureReasons(result))}\n`);
    }

    const path = env?.GITHUB_STEP_SUMMARY;
    if (path) {
      try {
        await appendFile(path, summaryTable(results), 'utf8');
      } catch (error) {
        throw new ConfigError(`Cannot append GitHub Actions summary to "${path}": ${(error as Error).message}`);
      }
    }
  },
});

function failureReasons(result: TestResult): string {
  const reasons: string[] = [];
  for (const run of result.runs) {
    if (run.error) reasons.push(`Run ${run.run}: ${run.error}`);
    for (const [index, { results }] of run.turns.entries()) {
      for (const check of results) {
        if (!check.pass) {
          reasons.push(`Run ${run.run}, turn ${index + 1}: ${check.reason ?? Object.keys(check.assertion)[0]}`);
        }
      }
    }
  }
  return reasons.join('\n') || 'The test did not meet its required pass rate.';
}

function escapeMessage(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeProperty(value: string): string {
  return escapeMessage(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

function summaryTable(results: TestResult[]): string {
  const percent = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 });
  const rows = [
    '',
    '',
    '### ChatCops evaluations',
    '',
    '| Eval file | Test | Result | Pass rate |',
    '| --- | --- | --- | --- |',
  ];
  for (const result of results) {
    rows.push(`| ${markdownCell(result.fixture)} | ${markdownCell(result.test)} | ${result.pass ? 'Passed' : 'Failed'} | ${percent.format(result.passRate)} |`);
  }
  return `${rows.join('\n')}\n`;
}

function markdownCell(value: string): string {
  return value.replace(/\r\n?|\n/g, ' ').replace(/[&<>|\\`*_~[\]]/g, (character) => `&#${character.charCodeAt(0)};`);
}
