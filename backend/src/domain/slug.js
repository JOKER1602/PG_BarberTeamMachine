// Identificador interno a partir de un nombre: minúsculas, sin acentos ni
// signos, con guiones. Lo usan los filtros de servicios; el usuario no lo ve.
//   "Coloración y mechas" → "coloracion-y-mechas"
//   "Diseño de cejas"     → "diseno-de-cejas"
export function slugify(value, { fallback = 'categoria', maxLength = 70 } = {}) {
  const slug = String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
  return slug.length >= 2 ? slug : fallback;
}

// Primer identificador libre: base, base-2, base-3…
export function firstFreeSlug(base, taken) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}
