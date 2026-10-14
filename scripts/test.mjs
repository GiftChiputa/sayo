import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
await build({ entryPoints: ['tests/recovery.test.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'dist/recovery.test.cjs' });
execFileSync(process.execPath, ['--test', 'dist/recovery.test.cjs'], { stdio: 'inherit' });
execFileSync('native/VOOL.Input.exe', ['--test'], { stdio: 'inherit' });
