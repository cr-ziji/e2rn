#!/usr/bin/env node
import { cac } from 'cac';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initCommand } from '../commands/init.js';
import { checkCommand } from '../commands/check.js';
import { convertCommand } from '../commands/convert.js';
import { configCommand } from '../commands/config.js';
import { pluginCommand } from '../commands/plugin.js';
import { doctorCommand } from '../commands/doctor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

const cli = cac('e2rn');

cli.version(pkg.version);
cli.help();

cli
  .command('init', 'Initialize e2rn config')
  .option('-i, --in <path>', 'Electron project path')
  .option('-o, --out <path>', 'Output RN project path')
  .option('-n, --name <name>', 'Project name')
  .option('-a, --appid <id>', 'App ID (Bundle ID)')
  .option('-t, --template <template>', 'RN template')
  .option('-r, --runtime <runtime>', 'Runtime engine (in-process)')
  .option('-d, --default', 'Use default config')
  .option('-f, --force', 'Force overwrite')
  .action(initCommand);

cli
  .command('check', 'Check conversion feasibility')
  .option('-c, --config <path>', 'Config file path')
  .option('-R, --report <name>', 'Report filename')
  .option('-j, --json', 'Output JSON only')
  .option('-v, --verbose', 'Verbose output')
  .action(checkCommand);

cli
  .command('convert', 'Convert Electron project to React Native')
  .option('-c, --config <path>', 'Config file path')
  .option('-f, --force', 'Force overwrite output')
  .option('-d, --dry-run', 'Dry run')
  .option('-s, --skip-check', 'Skip check')
  .option('-v, --verbose', 'Verbose output')
  .option('-g, --preserve-git', 'Preserve git')
  .action(convertCommand);

cli
  .command('config', 'Manage config')
  .option('--global', 'Global config')
  .action(configCommand);

cli
  .command('plugin', 'Manage plugins')
  .action(pluginCommand);

cli
  .command('doctor', 'Check environment')
  .action(doctorCommand);

cli.parse();
