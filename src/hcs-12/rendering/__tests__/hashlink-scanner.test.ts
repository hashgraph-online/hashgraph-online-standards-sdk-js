import { describe, it, expect, beforeEach } from '@jest/globals';
import { HashLinkScanner } from '../hashlink-scanner';
import { Logger } from '../../../utils/logger';

describe('HashLinkScanner', () => {
  let scanner: HashLinkScanner;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({ module: 'test', level: 'error' });
    scanner = new HashLinkScanner(logger);
  });

  describe('parseHashLinkURI', () => {
    it('should parse HCS-1 direct topic reference', () => {
      const result = scanner.parseHashLinkURI('hcs://1/0.0.123456');
      expect(result).toEqual({
        protocol: '1',
        reference: '0.0.123456',
      });
    });

    it('should parse HCS-12 block reference', () => {
      const result = scanner.parseHashLinkURI('hcs://12/0.0.789012');
      expect(result).toEqual({
        protocol: '12',
        reference: '0.0.789012',
      });
    });

    it('should parse HCS-2 registry entry reference', () => {
      const result = scanner.parseHashLinkURI(
        'hcs://2/0.0.555666/transfer-form',
      );
      expect(result).toEqual({
        protocol: '2',
        reference: '0.0.555666/transfer-form',
        registryId: '0.0.555666',
        entryName: 'transfer-form',
      });
    });

    it('should throw on invalid URI format', () => {
      expect(() => scanner.parseHashLinkURI('invalid://uri')).toThrow(
        'Invalid HashLink URI format',
      );
      expect(() => scanner.parseHashLinkURI('hcs://abc/123')).toThrow(
        'Invalid HashLink URI format',
      );
      expect(() => scanner.parseHashLinkURI('hcs://2/invalid')).toThrow(
        'Invalid HCS-2 reference format',
      );
    });
  });

  describe('scanTemplate', () => {
    it('should find simple data-hashlink attributes', async () => {
      const html = `
        <div class="container">
          <div data-hashlink="hcs://12/0.0.123456"></div>
        </div>
      `;

      const refs = await scanner.scanTemplate(html);
      expect(refs).toHaveLength(1);
      expect(refs[0]).toMatchObject({
        element: 'div',
        uri: 'hcs://12/0.0.123456',
        protocol: '12',
        reference: '0.0.123456',
        loading: 'eager',
      });
    });

    it('should extract data-attributes', async () => {
      const html = `
        <div data-hashlink="hcs://12/0.0.123456"
             data-attributes='{"theme": "dark", "size": "large"}'>
        </div>
      `;

      const refs = await scanner.scanTemplate(html);
      expect(refs).toHaveLength(1);
      expect(refs[0].attributes).toEqual({
        theme: 'dark',
        size: 'large',
      });
    });

    it('should extract data-actions', async () => {
      const html = `
        <div data-hashlink="hcs://12/0.0.123456"
             data-actions='{"submit": "0.0.789012", "cancel": "0.0.789013"}'>
        </div>
      `;

      const refs = await scanner.scanTemplate(html);
      expect(refs).toHaveLength(1);
      expect(refs[0].actions).toEqual({
        submit: '0.0.789012',
        cancel: '0.0.789013',
      });
    });

    it('should handle lazy loading', async () => {
      const html = `
        <div data-hashlink="hcs://12/0.0.123456" data-loading="lazy"></div>
      `;

      const refs = await scanner.scanTemplate(html);
      expect(refs[0].loading).toBe('lazy');
    });

    it('should find multiple references', async () => {
      const html = `
        <div>
          <div data-hashlink="hcs://12/0.0.111111"></div>
          <span data-hashlink="hcs://1/0.0.222222"></span>
          <section data-hashlink="hcs://2/0.0.333333/widget"></section>
        </div>
      `;

      const refs = await scanner.scanTemplate(html);
      expect(refs).toHaveLength(3);
      expect(refs.map(r => r.uri)).toEqual([
        'hcs://12/0.0.111111',
        'hcs://1/0.0.222222',
        'hcs://2/0.0.333333/widget',
      ]);
    });

    it('should handle complex attributes with nested JSON', async () => {
      const html = `
        <div data-hashlink="hcs://12/0.0.123456"
             data-attributes='{"config": {"nested": true, "level": 2}}'>
        </div>
      `;

      const refs = await scanner.scanTemplate(html);
      expect(refs[0].attributes).toEqual({
        config: {
          nested: true,
          level: 2,
        },
      });
    });

    it('should handle malformed attributes gracefully', async () => {
      const html = `
        <div data-hashlink="hcs://12/0.0.123456"
             data-attributes='invalid json'>
        </div>
      `;

      const refs = await scanner.scanTemplate(html);
      expect(refs).toHaveLength(1);
      expect(refs[0].attributes).toBeUndefined();
    });

    it('should capture full element as placeholder', async () => {
      const element = '<div data-hashlink="hcs://12/0.0.123456" class="test">';
      const html = `<div>${element}</div>`;

      const refs = await scanner.scanTemplate(html);
      expect(refs[0].placeholder).toBe(element);
    });
  });

  describe('createPlaceholder', () => {
    it('should create unique placeholders', () => {
      const ref1 = {
        element: 'div',
        uri: 'hcs://12/0.0.123456',
        protocol: '12',
        reference: '0.0.123456',
        placeholder: '',
      };

      const ref2 = {
        element: 'div',
        uri: 'hcs://12/0.0.789012',
        protocol: '12',
        reference: '0.0.789012',
        placeholder: '',
      };

      const p1 = scanner.createPlaceholder(ref1, 0);
      const p2 = scanner.createPlaceholder(ref2, 1);

      expect(p1).toContain('HASHLINK_PLACEHOLDER_0');
      expect(p2).toContain('HASHLINK_PLACEHOLDER_1');
      expect(p1).not.toBe(p2);
    });
  });
});
