import { brandWords, tenantBrand } from '../tenant.js';

// Logotipo de texto de la barbería actual: primera palabra en blanco y el resto
// en el color de acento, igual que el diseño original de Empyrean Studio.
export default function BrandMark({ name = tenantBrand().name, stacked = false }) {
  const { first, rest } = brandWords(name);
  if (!rest) return <>{first}</>;
  return stacked ? <>{first}<br/>{rest}</> : <>{first}<span> {rest}</span></>;
}
