import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const root = resolve(import.meta.dirname, '..');
const paths = process.argv.slice(2);
const result = spawnSync(process.execPath, ['--test', ...(paths.length ? paths : ['test/native-plugin/*.test.mjs'])], {cwd:root, stdio:'inherit'});
process.exitCode = result.status ?? 1;
