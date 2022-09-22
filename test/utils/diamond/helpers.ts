// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const wrapSuccess = <T extends Array<any>, R extends Promise<void>, U extends {success: () => R}>(
  fn: (...args: T) => U
) => {
  return (...args: T): R => fn(...args).success();
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const wrapOnlyRole = <T extends Array<any>, R extends Promise<void>, U extends {reverted: {onlyRole: () => R}}>(
  fn: (...args: T) => U
) => {
  return (...args: T): R => fn(...args).reverted.onlyRole();
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const wrapOnlyMember = <
  T extends Array<any>,
  R extends Promise<void>,
  U extends {reverted: {onlyMember: () => R}}
>(
  fn: (...args: T) => U
) => {
  return (...args: T): R => fn(...args).reverted.onlyMember();
};
