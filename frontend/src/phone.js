// Celular boliviano: 8 dígitos que empiezan con 6 o 7.
export const bolivianPhonePattern = /^[67]\d{7}$/;

// Deja solo los 8 dígitos del celular. Acepta lo que la gente escribe o pega:
// "7123-4567", "7123 4567" o "+591 71234567". No se usa maxLength en el campo
// porque contaría los guiones y espacios y cortaría el último dígito.
export function cleanBolivianPhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length > 8 && digits.startsWith('591')) digits = digits.slice(3);
  return digits.slice(0, 8);
}
