#!/usr/bin/env node
import { main } from './main.js';

process.exitCode = await main(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, cwd: process.cwd() });
