function validateDatabaseUrl(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must contain a PostgreSQL connection URL.`);
  }
  try {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length < 2
    )
      throw new Error();
    if (
      url.hostname.endsWith('.neon.tech') &&
      !['require', 'verify-ca', 'verify-full'].includes(
        url.searchParams.get('sslmode') ?? '',
      )
    )
      throw new Error();
  } catch {
    throw new Error(
      `${label} must be a valid PostgreSQL URL; Neon connections must enable TLS.`,
    );
  }
  return value;
}

export function runtimeDatabaseUrl(input: Record<string, unknown>): string {
  // Preserve the existing local naming without rewriting .env or process.env.
  const value = input.DIRECT_URL
    ? input.DATABASE_URL
    : (input.DATABASE_URL_POOLED ?? input.DATABASE_URL);
  const result = validateDatabaseUrl(value, 'DATABASE_URL');
  const url = new URL(result);
  if (
    url.hostname.endsWith('.neon.tech') &&
    !url.hostname.includes('-pooler.')
  ) {
    throw new Error(
      'DATABASE_URL must use the pooled Neon runtime connection.',
    );
  }
  return result;
}

export function directDatabaseUrl(input: Record<string, unknown>): string {
  const value =
    input.DIRECT_URL ??
    (input.DATABASE_URL_POOLED ? input.DATABASE_URL : undefined);
  const result = validateDatabaseUrl(value, 'DIRECT_URL');
  if (new URL(result).hostname.includes('-pooler.'))
    throw new Error('DIRECT_URL must use a direct migration connection.');
  return result;
}
