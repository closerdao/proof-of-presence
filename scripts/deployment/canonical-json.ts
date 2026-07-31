/**
 * Serializes JSON-compatible values with recursively sorted object keys.
 * Undefined object properties are omitted and undefined array entries become null, matching JSON.stringify.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJsonStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
