export function requiredValue(argv: readonly string[], index: number, argument: string): string {
  const value = argv[index];
  if (!value || value.startsWith('-')) throw new Error(`${argument} requires a value`);
  return value;
}
