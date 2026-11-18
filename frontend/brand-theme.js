// Colores propios por barbería (plugin de PostCSS, se aplica al construir).
//
// styles.css se escribió con los colores de Empyrean (acento azul, fondos casi
// negros, textos blancos). Este plugin NO cambia esas reglas: genera una copia
// de cada declaración con color que solo se activa cuando la página tiene
// <html data-brand-theme>, es decir, cuando la barbería tiene colores propios.
// Así Empyrean (sin tema) queda idéntica.
//
// Cada color se clasifica por su tono y se reemplaza conservando su
// luminosidad y transparencia, usando las variables que fija tenant.js:
//   --theme-accent      acento (botones, enlaces, selección)   ← azules
//   --theme-background  fondos                                 ← grises oscuros
//   --theme-text        textos y fondos claros                 ← blancos y grises claros
// Los colores con significado propio (estrellas doradas, verde de confirmado,
// rojo de error), el blanco y el negro puros no se tocan.
//
// La copia va dentro de @supports: un navegador que no entienda los colores
// relativos simplemente muestra los colores por defecto.

const COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*(?:,\s*(?:\d*\.)?\d+%?\s*)?\)/g;
const THEMED_PROPERTIES = /^(?:color|background|background-color|background-image|border|border-(?:top|right|bottom|left)(?:-color)?|border-color|outline|outline-color|box-shadow|text-shadow|fill|stroke|caret-color|accent-color|text-decoration-color|column-rule-color|--[\w-]+)$/i;
export const THEME_ATTRIBUTE = 'data-brand-theme';
const SUPPORTS = 'color: hsl(from red h s l)';

function parseColor(text) {
  if (text.startsWith('#')) {
    let hex = text.slice(1);
    if (hex.length <= 4) hex = [...hex].map((char) => char + char).join('');
    const alpha = hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1;
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: alpha };
  }
  const parts = text.slice(text.indexOf('(') + 1, -1).split(',').map((part) => part.trim());
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  return { r: Number(parts[0]), g: Number(parts[1]), b: Number(parts[2]), a: alpha };
}

function toHsl({ r, g, b }) {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, chroma: 0, l: lightness };
  let hue;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  // chroma: cuánto color tiene realmente (0 = gris). Se usa en vez de la
  // saturación, que en blancos y negros casi puros da valores engañosos.
  return { h: (hue * 60 + 360) % 360, chroma: delta, l: lightness };
}

const round = (value) => Math.round(value * 10) / 10;

// Luminosidad de los colores base de Empyrean (en %): el azul de los botones
// principales (#2860e7), el fondo de página (#080807) y el texto (#f8f3ec).
// Cada color base pasa a ser exactamente el color de la barbería; los demás
// tonos conservan su relación con la base:
//   acento        → proporcional (tintes claros y oscuros del mismo color)
//   fondo y texto → desplazados (paneles unos puntos más claros que el fondo)
const BASE_LIGHTNESS = { accent: 53.1, background: 2.9, text: 94.9 };
const scaled = (role, lightness) => {
  if (role === 'accent') return `calc(l * ${Math.round((lightness / BASE_LIGHTNESS.accent) * 1000) / 1000})`;
  const offset = round(lightness - BASE_LIGHTNESS[role]);
  return offset === 0 ? 'l' : `calc(l ${offset > 0 ? '+' : '-'} ${Math.abs(offset)})`;
};

// Devuelve el color de reemplazo o null si el color no se tematiza.
export function themedColor(text) {
  const color = parseColor(text);
  const { h, chroma, l } = toHsl(color);
  const alpha = color.a < 1 ? ` / ${round(color.a * 100) / 100}` : '';
  const lightness = round(l * 100);
  const isBlue = h >= 195 && h <= 255;
  if (l >= 0.995 || l <= 0.005) return null; // blanco y negro puros
  // Solo los azules intensos son "acento". Los grises apenas azulados (textos
  // de ayuda como #9ca8bb, paneles marino apagados como #182238) son texto o
  // fondo: con un acento rojo, teñirlos de rojo los haría parecer errores.
  if (isBlue && chroma >= 0.2 && l > 0.12 && l < 0.86) return `hsl(from var(--theme-accent) h s ${scaled('accent', lightness)}${alpha})`;
  if (chroma < 0.12 || (isBlue && chroma < 0.25)) {
    if (l < 0.42) return `hsl(from var(--theme-background) h s ${scaled('background', lightness)}${alpha})`;
    return `hsl(from var(--theme-text) h calc(s * ${l >= 0.86 ? 1 : 0.5}) ${scaled('text', lightness)}${alpha})`;
  }
  return null; // dorados, verdes, rojos y otros colores con significado
}

export function themeValue(value) {
  let changed = false;
  const result = value.replace(COLOR, (match) => {
    const replacement = themedColor(match);
    if (!replacement) return match;
    changed = true;
    return replacement;
  });
  return changed ? result : null;
}

// :where() no suma especificidad: la copia pesa lo mismo que la regla original
// y, como va justo después de ella, el resultado es el mismo que cambiar el
// color en su lugar (las reglas más específicas siguen ganando).
// Si el fondo es "de acento" (su primer color es un azul intenso, o usa la
// variable del azul de Empyrean), devuelve ese color ya tematizado; si no, null.
const COLOR_ONLY = new RegExp(`^(?:${COLOR.source})$|^(?:white|black)$`, 'i');
function accentBackgroundColor(value) {
  if (/var\(--btm-blue\)/.test(value)) return 'var(--theme-accent)';
  const first = value.match(COLOR)?.[0];
  if (!first || parseColor(first).a < 0.6) return null; // un tinte translúcido deja ver el fondo oscuro
  const themed = themedColor(first);
  return themed?.includes('--theme-accent') ? themed.replace(/ \/ [\d.]+\)$/, ')') : null;
}

// Declaración nueva con el mismo formato que las de la regla.
function postcssDecl(rule, value) {
  const sample = rule.nodes.find((node) => node.type === 'decl');
  return sample.clone({ prop: 'color', value, important: false });
}

function themedSelector(selector) {
  return selector.split(',').map((part) => {
    const trimmed = part.trim();
    if (/^(?::root|html)\b/.test(trimmed)) return trimmed.replace(/^(:root|html)/, `$1:where([${THEME_ATTRIBUTE}])`);
    return `:where(:root[${THEME_ATTRIBUTE}]) ${trimmed}`;
  }).join(', ');
}

const insideKeyframes = (node) => {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return true;
  }
  return false;
};

export default function brandTheme() {
  return {
    postcssPlugin: 'brand-theme',
    OnceExit(root, { AtRule }) {
      // Primero se recorren las reglas originales y después se insertan las
      // copias, para no volver a procesar lo que se agrega.
      const pending = [];
      root.walkRules((rule) => {
        if (insideKeyframes(rule)) return;
        const declarations = [];
        // Texto sobre fondo de acento (botones): negro o blanco según la
        // luminosidad del fondo real de ESA regla (un dorado claro lleva texto
        // oscuro; un dorado oscuro o un rojo, texto claro), para que se lea.
        const accentBackground = rule.nodes.filter((node) => node.type === 'decl' && /^background(?:-color)?$/i.test(node.prop))
          .map((node) => accentBackgroundColor(node.value)).find(Boolean);
        const textOnAccent = accentBackground && `oklch(from ${accentBackground} calc((0.62 - l) * infinity) 0 h)`;
        let hasColor = false;
        rule.each((node) => {
          if (node.type !== 'decl' || !THEMED_PROPERTIES.test(node.prop)) return;
          if (node.prop.toLowerCase() === 'color') hasColor = true;
          if (accentBackground && node.prop.toLowerCase() === 'color' && COLOR_ONLY.test(node.value.trim())) {
            declarations.push(node.clone({ value: textOnAccent }));
            return;
          }
          const value = themeValue(node.value);
          if (value) declarations.push(node.clone({ value }));
        });
        // Si la regla solo cambia el fondo de acento (p. ej. de marino oscuro a
        // azul vivo en otro estado), el texto también debe recalcularse.
        if (accentBackground && !hasColor) declarations.push(postcssDecl(rule, textOnAccent));
        if (declarations.length) pending.push({ rule, declarations });
      });
      for (const { rule, declarations } of pending) {
        const copy = rule.clone({ selector: themedSelector(rule.selector), nodes: [] });
        copy.append(declarations);
        // Justo después de la original, dentro de los mismos @media.
        const supports = new AtRule({ name: 'supports', params: `(${SUPPORTS})` });
        supports.append(copy);
        rule.after(supports);
      }
    }
  };
}
brandTheme.postcss = true;
