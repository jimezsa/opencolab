export function resolveSecretReference(reference: string): string | null {
  const value = reference.trim();
  if (!value) {
    return null;
  }

  const fromEnv = process.env[value];
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }

  if (looksLikeLiteralSecret(value)) {
    return value;
  }

  return null;
}

function looksLikeLiteralSecret(value: string): boolean {
  return value.includes(":") || value.startsWith("sk-");
}
