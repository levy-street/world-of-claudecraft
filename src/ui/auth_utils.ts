import { t } from './i18n';

/**
 * Toggles the visibility of a password input and updates the toggle button accessibility attributes.
 * @param input The password HTML input element
 * @param button The toggle button element
 */
export function togglePasswordVisibility(input: HTMLInputElement, button: HTMLButtonElement): void {
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';

  // Update button accessibility states
  button.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
  button.setAttribute('aria-label', isPassword ? t('auth.hidePassword') : t('auth.showPassword'));
}

/**
 * Synchronizes the aria-invalid attribute of an input with its current validity state.
 * @param input The HTML input element to synchronize
 * @returns boolean indicating if the input is currently valid
 */
export function syncInputAriaState(input: HTMLInputElement): boolean {
  const isValid = input.checkValidity();
  if (!isValid) {
    input.setAttribute('aria-invalid', 'true');
  } else {
    input.removeAttribute('aria-invalid');
  }
  return isValid;
}

/**
 * Validates all fields in a form, updates their ARIA states, and returns whether the form is valid.
 * Also focuses on the first invalid field.
 * @param form The HTML form element
 * @returns boolean indicating if the entire form is valid
 */
export function validateForm(form: HTMLFormElement): boolean {
  const inputs = Array.from(form.querySelectorAll('input'));
  let firstInvalid: HTMLInputElement | null = null;
  let formValid = true;

  for (const input of inputs) {
    const fieldValid = syncInputAriaState(input);
    
    // Apply fallback dirty/invalid classes
    input.classList.toggle('user-invalid-fallback', !fieldValid);
    
    // For browsers/tests, toggle error display block
    const errorEl = form.querySelector(`#${input.id}-error`) as HTMLElement | null;
    if (errorEl) {
      errorEl.style.display = fieldValid ? 'none' : 'block';
    }

    if (!fieldValid) {
      formValid = false;
      if (!firstInvalid) {
        firstInvalid = input;
      }
    }
  }

  if (firstInvalid) {
    firstInvalid.focus();
  }

  return formValid;
}

/**
 * Triggers a callback if the user presses Enter or Space keys on a role="button" element.
 * Prevents default scroll behavior for Space key.
 * @param event The KeyboardEvent
 * @param callback The callback function to execute
 * @returns boolean indicating if the callback was triggered
 */
export function handleKeyboardActivation(event: KeyboardEvent, callback: () => void): boolean {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault(); // Prevent page scroll on space
    callback();
    return true;
  }
  return false;
}

/**
 * Validates a character name client-side using the server's validation rule:
 * Starts with a letter, 2-16 characters, only letters, spaces, hyphens or apostrophes.
 * @param name The character name string to validate
 * @returns boolean indicating if the name is valid
 */
export function validateCharacterName(name: string): boolean {
  const trimmed = name.trim();
  return /^[A-Za-z][A-Za-z' -]{1,15}$/.test(trimmed);
}

