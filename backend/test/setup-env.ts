// API tests use a mock database provider and never read or connect to local Neon.
import { authTestEnvironment } from './auth-fixture.js';

process.env.DATABASE_URL ??= 'postgresql://database.example.invalid/finance';
process.env.SHARED_PASSWORD_HASH ??= authTestEnvironment.SHARED_PASSWORD_HASH;
process.env.SESSION_SECRET ??= authTestEnvironment.SESSION_SECRET;
