/**
 * Client-side password policy — keep in sync with backend/password_policy.py
 */
export function validatePassword(password) {
  if (!password || password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (!/[A-Za-z]/.test(password)) {
    return "Password must include at least one letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must include at least one number.";
  }
  return null;
}

export const PASSWORD_HINT =
  "At least 8 characters, including a letter and a number.";
