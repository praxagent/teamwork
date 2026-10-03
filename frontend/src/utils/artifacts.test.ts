import { describe, expect, it } from 'vitest';
import { ARTIFACT_CSP, prepareArtifactDocument, splitArtifactMarkers } from './artifacts';

describe('prepareArtifactDocument', () => {
  it('puts the CSP first in an existing <head>', () => {
    const doc = prepareArtifactDocument('<!doctype html><html><head><title>x</title></head><body>hi</body></html>');
    const head = doc.indexOf('<head>');
    expect(doc.slice(head + '<head>'.length).startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(doc.indexOf('<meta')).toBeLessThan(doc.indexOf('<title>'));
  });

  it('adds a <head> when the page has only <html>', () => {
    const doc = prepareArtifactDocument('<html><body>hi</body></html>');
    expect(doc).toMatch(/<html><head><meta http-equiv="Content-Security-Policy"/);
  });

  it('wraps a fragment in a full document', () => {
    const doc = prepareArtifactDocument('<h1>hi</h1>');
    expect(doc.startsWith('<!doctype html><html><head><meta')).toBe(true);
    expect(doc).toContain('<body><h1>hi</h1></body>');
  });

  it('allows no network', () => {
    expect(ARTIFACT_CSP).toContain("default-src 'none'");
    expect(ARTIFACT_CSP).toContain("connect-src 'none'");
    expect(ARTIFACT_CSP).not.toMatch(/https?:/);
  });
});

describe('splitArtifactMarkers', () => {
  it('splits on lines that are exactly a marker', () => {
    expect(splitArtifactMarkers('Here it is:\n[artifact:plan-1a2b3c]\nTell me what to change.')).toEqual([
      { kind: 'markdown', text: 'Here it is:' },
      { kind: 'artifact', id: 'plan-1a2b3c' },
      { kind: 'markdown', text: 'Tell me what to change.' },
    ]);
  });

  it('leaves inline mentions and code blocks alone', () => {
    const text = 'see [artifact:a-1] inline\n```\n[artifact:b-2]\n```';
    expect(splitArtifactMarkers(text)).toEqual([{ kind: 'markdown', text }]);
  });

  it('rejects ids that are not artifact ids', () => {
    expect(splitArtifactMarkers('[artifact:../etc]')).toEqual([{ kind: 'markdown', text: '[artifact:../etc]' }]);
  });
});
