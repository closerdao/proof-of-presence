#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import process from 'node:process';

const OPENZEPPELIN_REMAPPING = '@openzeppelin/=node_modules/@openzeppelin/';
const args = process.argv.slice(2).map((argument) => {
  if (argument.startsWith('@openzeppelin=')) return OPENZEPPELIN_REMAPPING;
  return argument;
});

const result = spawnSync('solc', args, {stdio: 'inherit'});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
