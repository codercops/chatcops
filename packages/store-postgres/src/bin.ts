#!/usr/bin/env node
import { main } from './cli.js';

process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  log: (message) => console.log(message),
  error: (message) => console.error(message),
});
