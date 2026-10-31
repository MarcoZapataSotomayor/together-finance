// API tests use a mock database provider and never read or connect to local Neon.
process.env.DATABASE_URL ??= 'postgresql://database.example.invalid/finance';
