// lib/authPasswordPolicy.js
export const PASSWORD_MIN_LENGTH = 12;

export function getPasswordChecks(password = '') {
  const value = String(password || '');
  return {
    length: value.length >= PASSWORD_MIN_LENGTH,
    lowercase: /[a-z]/.test(value),
    uppercase: /[A-Z]/.test(value),
    number: /\d/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
  };
}

export function isStrongPassword(password = '') {
  return Object.values(getPasswordChecks(password)).every(Boolean);
}

export const PASSWORD_POLICY_DESCRIPTION =
  'At least 12 characters, including a lowercase letter, an uppercase letter, a number, and a symbol.';
