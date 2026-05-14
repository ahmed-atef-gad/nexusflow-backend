import {
  createCsrfToken,
  isCsrfRequestValid,
  isValidCsrfToken,
} from './csrf.util';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from './csrf.constants';

describe('CSRF utilities', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret';
  });

  it('creates signed tokens that validate', () => {
    const token = createCsrfToken();

    expect(isValidCsrfToken(token)).toBe(true);
  });

  it('rejects tampered tokens', () => {
    const token = createCsrfToken();
    const [nonce] = token.split('.');

    expect(isValidCsrfToken(`${nonce}.tampered-signature`)).toBe(false);
  });

  it('requires matching valid cookie and header tokens', () => {
    const token = createCsrfToken();

    expect(
      isCsrfRequestValid({
        cookies: { [CSRF_COOKIE_NAME]: token },
        headers: { [CSRF_HEADER_NAME]: token },
      } as never)
    ).toBe(true);
  });

  it('rejects requests with missing or mismatched tokens', () => {
    const token = createCsrfToken();
    const otherToken = createCsrfToken();

    expect(
      isCsrfRequestValid({
        cookies: { [CSRF_COOKIE_NAME]: token },
        headers: { [CSRF_HEADER_NAME]: otherToken },
      } as never)
    ).toBe(false);
  });
});
