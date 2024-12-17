export function assert(x: unknown, message: string): asserts x {
  if (!x) {
    throw new Error(
      message.split(" ").length ? message : `Expected ${message} to be truthy`,
    );
  }
}
