import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';
import { directDatabaseUrl } from './src/config/database-urls.js';

config({ quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Generating/validating the client needs no database credentials.
  datasource:
    process.env.DIRECT_URL || process.env.DATABASE_URL_POOLED
      ? { url: directDatabaseUrl(process.env) }
      : undefined,
});
