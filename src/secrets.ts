export function resolveSecretReference(reference: string): string | null {
  const value = reference.trim();
  if (!value) {
    return null;
  }

  const fromEnv = process.env[value];
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }

  if (isLiteralSecretReference(value)) {
    return value;
  }

  return null;
}

export function isLiteralSecretReference(value: string): boolean {
  return value.includes(":") || value.startsWith("sk-");
}
