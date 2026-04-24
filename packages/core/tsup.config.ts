import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    db: 'src/db/index.ts',
    auth: 'src/auth/index.ts',
    repository: 'src/repository/index.ts',
  },
  format: ['esm'],
  dts: {
    resolve: true,
  },
  clean: true,
  sourcemap: true,
  splitting: false,
  external: ['glob', '@libsql/client', 'libsql', '@libsql/hrana-client', 'bcryptjs', 'jose'],
});
