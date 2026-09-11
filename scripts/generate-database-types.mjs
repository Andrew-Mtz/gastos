import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputPath = path.join(
  projectRoot,
  'src/infrastructure/supabase/database.types.ts',
);
const cliPackagePath = require.resolve('supabase/package.json');
const cliPath = path.join(path.dirname(cliPackagePath), 'dist/supabase.js');

const result = spawnSync(
  process.execPath,
  [
    cliPath,
    'gen',
    'types',
    '--lang',
    'typescript',
    '--local',
    '--schema',
    'public',
  ],
  {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);

if (result.error || result.status !== 0 || !result.stdout.trim()) {
  console.error(
    'Database type generation failed; existing types were preserved.',
  );
  process.exit(1);
}

const formatted = await format(result.stdout, {
  ...(await resolveConfig(outputPath)),
  filepath: outputPath,
  endOfLine: 'lf',
});

await writeFile(outputPath, formatted, 'utf8');
console.log('Generated src/infrastructure/supabase/database.types.ts');
