import { describe, it, expect } from 'vitest';
import { versionImpression } from './impression';

describe('préréglage impression / N&B', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10">'
    + '<text font-size="9.5" fill="#8592a8">5</text><text font-size="17" fill="#16233a">Titre</text>'
    + '<rect fill="#e8f6ee"/><path stroke="#E34948"/><path stroke="#eda100"/>'
    + '<circle fill="none" stroke="#c0392b" stroke-width="1.4"/></svg>';
  const out = versionImpression(svg);

  it('grossit et fonce les petits textes, sans toucher aux grands', () => {
    expect(out).toContain('<text font-size="11" fill="#1f2937">5</text>');
    expect(out).toContain('font-size="17"');
  });
  it('remplace la palette par Okabe-Ito (jaune pâle → noir)', () => {
    expect(out).toContain('stroke="#d55e00"');
    expect(out).toContain('stroke="#000000"');
    expect(out).not.toMatch(/#e34948|#eda100/i);
  });
  it('hachure les bandes de normale et épaissit l’anneau hors-norme', () => {
    expect(out).toContain('<defs><pattern id="fc-hachures"');
    expect(out).toContain('fill="url(#fc-hachures)"');
    expect(out).toContain('stroke="#000000" stroke-width="2.2"');
  });
});
