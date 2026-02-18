/** Luhn algorithm for credit card validation */
export function luhnCheck(number: string): boolean {
  const digits = number.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let alternate = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}

/** SSN format validation — checks structure beyond regex */
export function ssnCheck(ssn: string): boolean {
  const clean = ssn.replace(/\D/g, '');
  if (clean.length !== 9) return false;

  const area = parseInt(clean.substring(0, 3), 10);
  const group = parseInt(clean.substring(3, 5), 10);
  const serial = parseInt(clean.substring(5, 9), 10);

  // Invalid ranges
  if (area === 0 || area === 666 || area >= 900) return false;
  if (group === 0) return false;
  if (serial === 0) return false;

  return true;
}

export const validators: Record<string, (value: string) => boolean> = {
  luhn: luhnCheck,
  ssn: ssnCheck,
};
