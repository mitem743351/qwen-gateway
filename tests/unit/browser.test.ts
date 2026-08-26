import { describe, it, expect } from 'vitest';
import {
  validateProfileId,
  resolveProfileDir,
  acquireProfileLock,
} from '../../src/browser/profile.js';
import { BrowserLauncher } from '../../src/browser/launch.js';
import { sanitizeHeaders, SENSITIVE_HEADER_NAMES } from '../../src/browser/redaction.js';
import { resolve } from 'node:path';

describe('Browser Profile Management (Step 5)', () => {
  it('validates safe profile IDs', () => {
    expect(validateProfileId('account_1')).toBe('account_1');
    expect(validateProfileId('acc-dev-02')).toBe('acc-dev-02');
    expect(validateProfileId('_gate1')).toBe('_gate1');
  });

  it('rejects empty or whitespace profile IDs', () => {
    expect(() => validateProfileId('')).toThrow(/cannot be empty/);
    expect(() => validateProfileId('   ')).toThrow(/cannot be empty/);
  });

  it('rejects path traversal attempts in profile IDs', () => {
    expect(() => validateProfileId('../etc/passwd')).toThrow(/path traversal/);
    expect(() => validateProfileId('acc/../../sub')).toThrow(/path traversal/);
    expect(() => validateProfileId('..\\windows\\system32')).toThrow(/path traversal/);
  });

  it('rejects invalid characters in profile IDs', () => {
    expect(() => validateProfileId('account@name!')).toThrow(/only alphanumeric/);
    expect(() => validateProfileId('acc name')).toThrow(/only alphanumeric/);
  });

  it('resolves deterministic normalized profile directory', () => {
    const customBase = resolve(process.cwd(), 'data/custom_profiles');
    const path = resolveProfileDir('worker_1', customBase);
    expect(path).toBe(resolve(customBase, 'worker_1'));
  });

  it('enforces in-process lock preventing concurrent operations on same profile', () => {
    const releaseLock = acquireProfileLock('test_concurrent_acc');
    expect(() => acquireProfileLock('test_concurrent_acc')).toThrow(
      /already in use by another operation/,
    );
    releaseLock();

    // After release, should be acquirable again
    const releaseLock2 = acquireProfileLock('test_concurrent_acc');
    expect(typeof releaseLock2).toBe('function');
    releaseLock2();
  });
});

describe('Browser Configuration & Diagnostics (Step 4)', () => {
  it('returns structured diagnostic information without throwing', () => {
    const launcher = BrowserLauncher.getInstance();
    const diag = launcher.getDiagnosticInfo();

    expect(diag.packageVersion).toBe('0.5.9');
    expect(diag.expectedChromiumVersion).toBe('146.0.7680.177.5');
    expect(typeof diag.effectiveExecutablePath).toBe('string');
    expect(typeof diag.isExecutablePresent).toBe('boolean');
    expect(diag.cacheDir).toContain('.cloakbrowser');
    expect(diag.headless).toBe(true);
  });

  it('honors CLOAKBROWSER_BINARY_PATH override in executable path resolution', () => {
    const launcher = BrowserLauncher.getInstance();
    const customPath = '/opt/custom/chrome-bin';

    process.env['CLOAKBROWSER_BINARY_PATH'] = customPath;
    const resolved = launcher.resolveExecutablePath();
    expect(resolved).toBe(resolve(customPath));

    delete process.env['CLOAKBROWSER_BINARY_PATH'];
  });

  it('normalizes launch failure error when binary is missing', async () => {
    const launcher = BrowserLauncher.getInstance();
    // Intentionally pass a non-existent binary path to test error normalization
    const fakePath = '/non/existent/chromium/bin';

    await expect(
      launcher.getBrowser({ binaryPath: fakePath }),
    ).rejects.toThrow(/\[BrowserLauncher\] Failed to launch CloakBrowser/);
  });
});

describe('Sensitive Header Redaction (Step 8)', () => {
  it('redacts sensitive headers while preserving non-sensitive headers', () => {
    const inputHeaders = {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 Test',
      Authorization: 'Bearer super-secret-jwt-token',
      Cookie: 'token=xyz123; isg=baxia-cookie',
      'Set-Cookie': 'session=abc; Secure; HttpOnly',
      'Proxy-Authorization': 'Basic dXNlcjpwYXNz',
      'x-api-key': 'secret-api-key-99',
      'x-auth-token': 'auth-secret-101',
      'bx-ua': 'baxia-fingerprint-ua',
      'bx-umidtoken': 'baxia-umid-token',
      'bx-v': '2.5.0',
      'X-Request-Id': 'req-uuid-456',
    };

    const sanitized = sanitizeHeaders(inputHeaders);

    // Assert sensitive headers are redacted
    expect(sanitized['Authorization']).toBe('[REDACTED]');
    expect(sanitized['Cookie']).toBe('[REDACTED]');
    expect(sanitized['Set-Cookie']).toBe('[REDACTED]');
    expect(sanitized['Proxy-Authorization']).toBe('[REDACTED]');
    expect(sanitized['x-api-key']).toBe('[REDACTED]');
    expect(sanitized['x-auth-token']).toBe('[REDACTED]');
    expect(sanitized['bx-ua']).toBe('[REDACTED]');
    expect(sanitized['bx-umidtoken']).toBe('[REDACTED]');
    expect(sanitized['bx-v']).toBe('[REDACTED]');

    // Assert non-sensitive headers remain intact
    expect(sanitized['Content-Type']).toBe('application/json');
    expect(sanitized['User-Agent']).toBe('Mozilla/5.0 Test');
    expect(sanitized['X-Request-Id']).toBe('req-uuid-456');
  });

  it('contains all required redaction keys in SENSITIVE_HEADER_NAMES', () => {
    expect(SENSITIVE_HEADER_NAMES.has('cookie')).toBe(true);
    expect(SENSITIVE_HEADER_NAMES.has('set-cookie')).toBe(true);
    expect(SENSITIVE_HEADER_NAMES.has('authorization')).toBe(true);
    expect(SENSITIVE_HEADER_NAMES.has('proxy-authorization')).toBe(true);
    expect(SENSITIVE_HEADER_NAMES.has('x-api-key')).toBe(true);
    expect(SENSITIVE_HEADER_NAMES.has('x-auth-token')).toBe(true);
  });
});
