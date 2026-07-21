import {execFileSync} from 'node:child_process';
import {chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {expect} from 'chai';
import {describe, it} from 'mocha';
import {slitherBuildArgs, slitherCompileArgs} from '../../scripts/security/shared.js';

describe('Slither compiler configuration', function () {
  it('passes the absolute Mise-pinned solc executable to every Slither command', function () {
    const previousOverride = process.env.SLITHER_SOLC;
    delete process.env.SLITHER_SOLC;

    try {
      const miseSolc = realpathSync(execFileSync('mise', ['which', 'solc'], {encoding: 'utf8'}).trim());

      for (const args of [slitherBuildArgs(), slitherCompileArgs()]) {
        const solcArgument = args[args.indexOf('--solc') + 1];
        expect(path.isAbsolute(solcArgument)).to.equal(true);
        expect(realpathSync(solcArgument)).to.equal(miseSolc);
      }
    } finally {
      if (previousOverride === undefined) delete process.env.SLITHER_SOLC;
      else process.env.SLITHER_SOLC = previousOverride;
    }
  });

  it('rejects a compiler whose build does not match the project pin', function () {
    const directory = mkdtempSync(path.join(tmpdir(), 'slither-solc-'));
    const fakeSolc = path.join(directory, 'solc');
    const previousOverride = process.env.SLITHER_SOLC;
    writeFileSync(fakeSolc, '#!/bin/sh\nprintf "Version: 0.8.36+commit.8a079791.Linux.g++\\n"\n');
    chmodSync(fakeSolc, 0o755);
    process.env.SLITHER_SOLC = fakeSolc;

    try {
      expect(() => slitherBuildArgs()).to.throw('Expected SLITHER_SOLC to be solc 0.8.35+commit.47b9dedd');
    } finally {
      if (previousOverride === undefined) delete process.env.SLITHER_SOLC;
      else process.env.SLITHER_SOLC = previousOverride;
      rmSync(directory, {recursive: true, force: true});
    }
  });
});
