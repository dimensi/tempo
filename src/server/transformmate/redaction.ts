import 'server-only';

export function createSecretRedactor(initial: string[] = []) {
  const secrets = new Set<string>();
  const add = (secret: string) => {
    if (!secret) return;
    secrets.add(secret);
    secrets.add(encodeURIComponent(secret));
    secrets.add(new URLSearchParams({ value: secret }).toString().slice(6));
  };
  initial.forEach(add);
  const text = (value: string): string => {
    for (const secret of secrets)
      value = value.split(secret).join('[REDACTED]');
    return value;
  };
  const body = (value: unknown): unknown => {
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value)) return value.map(body);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          text(key),
          /^(?:idtoken|refreshtoken|accesstoken|oauthidtoken|oauthaccesstoken|authorization|apikey|firebaseapikey)$/.test(
            key.replace(/[_-]/g, '').toLowerCase(),
          )
            ? '[REDACTED]'
            : body(child),
        ]),
      );
    }
    return value;
  };
  return { add, text, body };
}
