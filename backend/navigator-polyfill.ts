// Mock browser global 'navigator' required by some versions of the Actual API.
// This must be imported at the very top of the entrypoint file to run before other imports.
try {
  Object.defineProperty(global, 'navigator', {
    value: { platform: 'node', userAgent: 'node' },
    writable: true,
    configurable: true
  });
} catch (e) {
  // @ts-ignore
  global.navigator = { platform: 'node', userAgent: 'node' };
}
