import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import brandTheme, { themedColor } from './brand-theme.js';

const run = async (css) => (await postcss([brandTheme()]).process(css, { from: undefined })).css;

describe('capa de colores por barbería', () => {
  it('el acento azul pasa a ser el acento de la barbería', () => {
    expect(themedColor('#2860e7')).toBe('hsl(from var(--theme-accent) h s calc(l * 1))');
    expect(themedColor('#3569ee')).toBe('hsl(from var(--theme-accent) h s calc(l * 1.075))');
    expect(themedColor('rgba(53, 105, 238, .3)')).toContain('var(--theme-accent)');
    expect(themedColor('rgba(53, 105, 238, .3)')).toContain('/ 0.3');
  });

  it('los fondos oscuros y los textos claros siguen a la barbería', () => {
    expect(themedColor('#080807')).toBe('hsl(from var(--theme-background) h s l)');
    expect(themedColor('#171717')).toBe('hsl(from var(--theme-background) h s calc(l + 6.1))');
    expect(themedColor('#f8f3ec')).toContain('var(--theme-text)');
    expect(themedColor('#aeb4c0')).toContain('var(--theme-text)');
  });

  it('no toca colores con significado propio ni blanco y negro puros', () => {
    for (const color of ['#d9a441', '#e26770', '#59d994', '#fff', '#000', '#ffffff']) expect(themedColor(color)).toBeNull();
  });

  it('no modifica las reglas originales: agrega una copia solo para barberías con tema', async () => {
    const css = await run('.btn{color:#fff;background:#3569ee;padding:1rem}@media (max-width:700px){.card{border:1px solid #343946}}');
    expect(css.startsWith('.btn{color:#fff;background:#3569ee;padding:1rem}')).toBe(true);
    expect(css).toContain('@supports (color: hsl(from red h s l))');
    expect(css).toContain(':where(:root[data-brand-theme]) .btn{color:oklch(from hsl(from var(--theme-accent) h s calc(l * 1.075)) calc((0.62 - l) * infinity) 0 h);background:hsl(from var(--theme-accent)');
    // La copia va justo después de su regla original.
    expect(css.indexOf('@supports')).toBe(css.indexOf('}') + 1);
    expect(css).not.toMatch(/data-brand-theme\]\) \.btn\{[^}]*padding/);
    expect(css).toContain('@media (max-width:700px){.card{border:1px solid #343946}@supports (color: hsl(from red h s l)){:where(:root[data-brand-theme]) .card{border:1px solid hsl(from var(--theme-background)');
  });

  it('respeta :root, html e !important y omite las animaciones', async () => {
    const css = await run(':root{background:#171717}html,body{color:#f8f3ec}.x{color:#3569ee!important}@keyframes pulso{from{background:#3569ee}}');
    expect(css).toContain(':root:where([data-brand-theme]){background:');
    expect(css).toContain('html:where([data-brand-theme]), :where(:root[data-brand-theme]) body{color:');
    expect(css).toMatch(/:where\(:root\[data-brand-theme\]\) \.x\{color:hsl\([^}]*!important\}/);
    expect(css.match(/@keyframes/g)).toHaveLength(1);
  });
});

describe('texto sobre botones de acento', () => {
  it('elige texto negro o blanco según la luminosidad del fondo de acento de cada regla', async () => {
    const css = await run('.cta{background:#3569ee;color:#fff}.hero{background:var(--btm-blue);color:#070707}.card{background:#171717;color:#fff}');
    expect(css).toContain(':where(:root[data-brand-theme]) .cta{background:hsl(from var(--theme-accent) h s calc(l * 1.075));color:oklch(from hsl(from var(--theme-accent) h s calc(l * 1.075)) calc((0.62 - l) * infinity) 0 h)}');
    expect(css).toContain(':where(:root[data-brand-theme]) .hero{color:oklch(from var(--theme-accent) calc((0.62 - l) * infinity) 0 h)}');
    expect(css).not.toMatch(/\.card\{[^}]*infinity/);
  });
});

describe('texto sobre acento en reglas que solo cambian el fondo', () => {
  it('recalcula el texto aunque la regla no tenga color, y omite tintes translúcidos', async () => {
    const css = await run('.a{background:#315fd5}.tint{background:rgba(53,105,238,.15);color:#fff}');
    expect(css).toMatch(/:where\(:root\[data-brand-theme\]\) \.a\{background:hsl\([^}]*;color:oklch\(from hsl\(from var\(--theme-accent\)[^}]*infinity/);
    expect(css).not.toMatch(/\.tint\{[^}]*infinity/);
  });
});
