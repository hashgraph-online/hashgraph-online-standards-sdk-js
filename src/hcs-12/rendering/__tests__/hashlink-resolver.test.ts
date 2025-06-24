import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HashLinkResolver, RenderContext } from '../hashlink-resolver';
import { ScannedHashLink } from '../hashlink-scanner';
import { Logger } from '../../../utils/logger';
import { BlockLoader } from '../../registries/block-loader';
import { HRLResolver } from '../../../utils/hrl-resolver';
import { NetworkType } from '../../../utils/types';

describe('HashLinkResolver', () => {
  let resolver: HashLinkResolver;
  let logger: Logger;
  let blockLoader: jest.Mocked<BlockLoader>;
  let hrlResolver: jest.Mocked<HRLResolver>;

  const mockContext: RenderContext = {
    blockId: 'parent-block',
    depth: 0,
    attributes: { theme: 'light' },
    actions: { submit: '0.0.111111' },
  };

  beforeEach(() => {
    logger = new Logger({ module: 'test', level: 'error' });

    blockLoader = {
      loadBlock: jest.fn(),
    } as any;

    hrlResolver = {
      resolve: jest.fn(),
    } as any;

    resolver = new HashLinkResolver(
      logger,
      blockLoader,
      hrlResolver,
      'testnet',
    );
  });

  describe('resolveReference - HCS-12 blocks', () => {
    it('should resolve HCS-12 block reference', async () => {
      const ref: ScannedHashLink = {
        element: 'div',
        uri: 'hcs://12/0.0.123456',
        protocol: '12',
        reference: '0.0.123456',
        placeholder: '',
        loading: 'eager',
      };

      const mockBlockData = {
        definition: {
          apiVersion: 3,
          name: 'test/block',
          title: 'Test Block',
          category: 'test',
          template_t_id: '0.0.12345',
          supports: {},
          attributes: {
            color: { type: 'string' as const, default: 'blue' },
          },
        },
        template: '<div>Test Block</div>',
      };

      blockLoader.loadBlock.mockResolvedValue(mockBlockData);

      const result = await resolver.resolveReference(ref, mockContext);

      expect(result).toEqual({
        blockId: '0.0.123456',
        definition: mockBlockData.definition,
        template: mockBlockData.template,
        attributes: {
          theme: 'light',
          color: 'blue',
        },
        actions: {
          submit: '0.0.111111',
        },
      });

      expect(blockLoader.loadBlock).toHaveBeenCalledWith('0.0.123456');
    });

    it('should merge attribute overrides', async () => {
      const ref: ScannedHashLink = {
        element: 'div',
        uri: 'hcs://12/0.0.123456',
        protocol: '12',
        reference: '0.0.123456',
        placeholder: '',
        loading: 'eager',
        attributes: { color: 'red', size: 'large' },
        actions: { cancel: '0.0.222222' },
      };

      const mockBlockData = {
        definition: {
          apiVersion: 3,
          name: 'test/block',
          title: 'Test Block',
          category: 'test',
          template_t_id: '0.0.12345',
          supports: {},
          attributes: {
            color: { type: 'string' as const, default: 'blue' },
          },
        },
        template: '<div>Test</div>',
      };

      blockLoader.loadBlock.mockResolvedValue(mockBlockData);

      const result = await resolver.resolveReference(ref, mockContext);

      expect(result.attributes).toEqual({
        theme: 'light',
        color: 'red',
        size: 'large',
      });

      expect(result.actions).toEqual({
        submit: '0.0.111111',
        cancel: '0.0.222222',
      });
    });

    it('should detect circular references', async () => {
      const ref: ScannedHashLink = {
        element: 'div',
        uri: 'hcs://12/0.0.123456',
        protocol: '12',
        reference: '0.0.123456',
        placeholder: '',
        loading: 'eager',
      };

      resolver.pushRenderStack('0.0.123456');

      const result = await resolver.resolveReference(ref, mockContext);

      expect(result.error).toBe('Circular reference detected');
      expect(result.definition).toBeNull();
      expect(blockLoader.loadBlock).not.toHaveBeenCalled();

      resolver.popRenderStack('0.0.123456');
    });

    it('should cache resolved blocks', async () => {
      const ref: ScannedHashLink = {
        element: 'div',
        uri: 'hcs://12/0.0.123456',
        protocol: '12',
        reference: '0.0.123456',
        placeholder: '',
        loading: 'eager',
      };

      const mockBlockData = {
        definition: {
          apiVersion: 3,
          name: 'test/block',
          title: 'Test Block',
          category: 'test',
          template_t_id: '0.0.12345',
          supports: {},
          attributes: {},
        },
        template: '<div>Test</div>',
      };

      blockLoader.loadBlock.mockResolvedValue(mockBlockData);

      await resolver.resolveReference(ref, mockContext);
      expect(blockLoader.loadBlock).toHaveBeenCalledTimes(1);

      await resolver.resolveReference(ref, mockContext);
      expect(blockLoader.loadBlock).toHaveBeenCalledTimes(1);
    });

    it('should handle missing blocks gracefully', async () => {
      const ref: ScannedHashLink = {
        element: 'div',
        uri: 'hcs://12/0.0.999999',
        protocol: '12',
        reference: '0.0.999999',
        placeholder: '',
        loading: 'eager',
      };

      blockLoader.loadBlock.mockResolvedValue(null);

      const result = await resolver.resolveReference(ref, mockContext);

      expect(result.error).toContain('Block not found');
      expect(result.definition).toBeNull();
    });
  });

  describe('resolveReference - HCS-1 content', () => {
    it('should resolve HCS-1 block definition', async () => {
      const ref: ScannedHashLink = {
        element: 'div',
        uri: 'hcs://1/0.0.123456',
        protocol: '1',
        reference: '0.0.123456',
        placeholder: '',
        loading: 'eager',
      };

      const mockBlockData = {
        definition: {
          apiVersion: 3,
          name: 'hcs1/block',
          title: 'HCS-1 Block',
          category: 'test',
          template_t_id: '0.0.12345',
          supports: {},
          attributes: {},
        },
        template: '<div>HCS-1 Block</div>',
      };

      blockLoader.loadBlock.mockResolvedValue(mockBlockData);

      const result = await resolver.resolveReference(ref, mockContext);

      expect(result.definition).toEqual(mockBlockData.definition);
      expect(result.template).toBe(mockBlockData.template);
    });

    it('should handle raw HCS-1 content', async () => {
      const ref: ScannedHashLink = {
        element: 'div',
        uri: 'hcs://1/0.0.123456',
        protocol: '1',
        reference: '0.0.123456',
        placeholder: '',
        loading: 'eager',
      };

      blockLoader.loadBlock.mockResolvedValue(null);
      hrlResolver.resolve.mockResolvedValue({
        content: '<div>Raw HTML content</div>',
        contentType: 'text/html',
        topicId: '0.0.123456',
        isBinary: false,
      });

      const result = await resolver.resolveReference(ref, mockContext);

      expect(result.definition).toBeNull();
      expect(result.template).toBe('<div>Raw HTML content</div>');
    });
  });

  describe('resolveReference - HCS-2 registry', () => {
    it('should attempt HCS-2 registry lookup', async () => {
      const ref: ScannedHashLink = {
        element: 'div',
        uri: 'hcs://2/0.0.555666/widget',
        protocol: '2',
        reference: '0.0.555666/widget',
        registryId: '0.0.555666',
        entryName: 'widget',
        placeholder: '',
        loading: 'eager',
      };

      hrlResolver.resolve.mockResolvedValue({
        content: '{}',
        contentType: 'application/json',
        topicId: '0.0.555666',
        isBinary: false,
      });

      const result = await resolver.resolveReference(ref, mockContext);

      expect(result.template).toContain('HCS-2 lookup not implemented');
      expect(result.blockId).toBe('0.0.555666/widget');
    });
  });

  describe('error handling', () => {
    it('should return error for unsupported protocol', async () => {
      const ref: ScannedHashLink = {
        element: 'div',
        uri: 'hcs://99/something',
        protocol: '99',
        reference: 'something',
        placeholder: '',
        loading: 'eager',
      };

      const result = await resolver.resolveReference(ref, mockContext);

      expect(result.error).toContain('Unsupported HashLink protocol: 99');
      expect(result.definition).toBeNull();
    });

    it('should handle network errors gracefully', async () => {
      const ref: ScannedHashLink = {
        element: 'div',
        uri: 'hcs://12/0.0.123456',
        protocol: '12',
        reference: '0.0.123456',
        placeholder: '',
        loading: 'eager',
      };

      blockLoader.loadBlock.mockRejectedValue(new Error('Network timeout'));

      const result = await resolver.resolveReference(ref, mockContext);

      expect(result.error).toContain('Network timeout');
      expect(result.definition).toBeNull();
    });
  });

  describe('utility methods', () => {
    it('should manage render stack correctly', () => {
      resolver.pushRenderStack('block-1');
      resolver.pushRenderStack('block-2');

      const ref: ScannedHashLink = {
        element: 'div',
        uri: 'hcs://12/block-1',
        protocol: '12',
        reference: 'block-1',
        placeholder: '',
        loading: 'eager',
      };

      resolver.resolveReference(ref, mockContext).then(result => {
        expect(result.error).toBe('Circular reference detected');
      });

      resolver.popRenderStack('block-2');
      resolver.popRenderStack('block-1');
    });

    it('should clear cache', async () => {
      const ref: ScannedHashLink = {
        element: 'div',
        uri: 'hcs://12/0.0.123456',
        protocol: '12',
        reference: '0.0.123456',
        placeholder: '',
        loading: 'eager',
      };

      const mockBlockData = {
        definition: {
          apiVersion: 3,
          name: 'test/block',
          title: 'Test Block',
          category: 'test',
          template_t_id: '0.0.12345',
          supports: {},
          attributes: {},
        },
        template: '<div>Test</div>',
      };

      blockLoader.loadBlock.mockResolvedValue(mockBlockData);

      await resolver.resolveReference(ref, mockContext);
      expect(blockLoader.loadBlock).toHaveBeenCalledTimes(1);

      resolver.clearCache();

      await resolver.resolveReference(ref, mockContext);
      expect(blockLoader.loadBlock).toHaveBeenCalledTimes(2);
    });
  });
});
