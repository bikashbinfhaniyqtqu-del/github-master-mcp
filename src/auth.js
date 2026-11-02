import { timingSafeEqual } from 'node:crypto';

export function getBearerToken(authorizationHeader = '') {
  const match = /^Bearer\s+(.+)$/i.exec(String(authorizationHeader).trim());
  return match ? match[1].trim() : '';
}

export function bearerTokenMatches(authorizationHeader, expectedToken) {
  if (typeof expectedToken !== 'string' || expectedToken.length < 32) return false;
  const supplied = getBearerToken(authorizationHeader);
  if (!supplied) return false;
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  const expectedBytes = Buffer.from(expectedToken, 'utf8');
  if (suppliedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(suppliedBytes, expectedBytes);
}
