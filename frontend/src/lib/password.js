/**
 * Client-side password policy — keep in sync with backend/password_policy.py
 */
export function validatePassword(password) {
  if (!password || password.length < 10) {
    return "Password must be at least 10 characters.";
  }
  if (!/[A-Za-z]/.test(password)) {
    return "Password must include at least one letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must include at least one number.";
  }
  if (!/[A-Z]/.test(password) && !/[!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|`~]/.test(password)) {
    return "Password must include at least one uppercase letter or symbol.";
  }
  return null;
}

export const PASSWORD_HINT =
  "At least 10 characters, including a letter, a number, and an uppercase letter or symbol.";
