import { GlobalRegexes } from './../component/shared/global-constants';

// Validation methods
export function validateEmail(email: string): boolean {
  return GlobalRegexes.emailRegex.test(email);
}

export function validatePhone(phone: string): boolean {
  return GlobalRegexes.phoneRegex.test(phone);
}

export function validateName(name: string): boolean {
  return GlobalRegexes.nameRegex.test(name);
}

export function checkPasswordRequirements(password: string) {
    const hasMinLength = password.length >= 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    return {
      minLength: hasMinLength,
      hasUpperCase,
      hasLowerCase,
      hasNumber,
      hasSpecialChar,
      allValid: hasMinLength && hasUpperCase && hasLowerCase && hasNumber && hasSpecialChar
    };
  }