import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { BlockRenderer } from '../block-renderer';
import { Logger } from '../../../utils/logger';
import { GutenbergBridge } from '../gutenberg-bridge';
import { TemplateEngine } from '../template-engine';
import { BlockStateManager } from '../block-state-manager';
import { BlockLoader } from '../../registries/block-loader';
import { HRLResolver } from '../../../utils/hrl-resolver';
import { BlockDefinition } from '../../types';

function createMockBlockDefinition(overrides: Partial<BlockDefinition> = {}): BlockDefinition {
  return {
    apiVersion: 3,
    name: 'test/block',
    title: 'Test Block',
    category: 'test',
    template_t_id: '0.0.12345',
    attributes: {},
    supports: {},
    ...overrides,
  };
}

describe('BlockRenderer - HashLink Support', () => {
  let renderer: BlockRenderer;
  let logger: Logger;
  let gutenbergBridge: GutenbergBridge;
  let templateEngine: TemplateEngine;
  let stateManager: BlockStateManager;
  let blockLoader: jest.Mocked<BlockLoader>;
  let hrlResolver: jest.Mocked<HRLResolver>;

  beforeEach(() => {
    logger = new Logger({ module: 'test', level: 'error' });
    gutenbergBridge = new GutenbergBridge(logger);

    templateEngine = new TemplateEngine(logger);
    templateEngine.render = jest
      .fn()
      .mockImplementation((template: string, context?: { attributes?: Record<string, unknown>; actions?: Record<string, unknown> }) => {
        let result = template;

        if (context?.attributes) {
          Object.entries(context.attributes).forEach(([key, value]) => {
            const pattern = new RegExp(`\\{\\{attributes\\.${key}\\}\\}`, 'g');
            result = result.replace(pattern, String(value));
          });
        }

        if (context?.actions) {
          Object.entries(context.actions).forEach(([key, value]) => {
            const pattern = new RegExp(`\\{\\{actions\\.${key}\\}\\}`, 'g');
            result = result.replace(pattern, String(value));
          });
        }

        return Promise.resolve(result);
      }) as any;

    stateManager = new BlockStateManager(logger);

    blockLoader = {
      loadBlock: jest.fn(),
    } as any;

    hrlResolver = {
      resolve: jest.fn(),
    } as any;

    renderer = new BlockRenderer(
      logger,
      gutenbergBridge,
      templateEngine,
      stateManager,
    );
  });

  describe('HashLink processing', () => {
    it('should process simple HashLink references', async () => {
      const parentBlock = {
        id: 'parent-block',
        name: 'test/parent',
        version: '1.0.0',
        p: 'hcs-12' as const,
        op: 'register' as const,
        template: `
          <div class="parent">
            <h1>Parent Block</h1>
            <div data-hashlink="hcs://12/0.0.123456"></div>
          </div>
        `,
      };

      const childBlockData = {
        definition: createMockBlockDefinition({
          name: 'test/child',
          title: 'Child Block',
          attributes: {
            message: { type: 'string', default: 'Hello' },
          },
        }),
        template: '<div class="child">{{attributes.message}}</div>',
      };

      blockLoader.loadBlock.mockResolvedValue(childBlockData);

      const result = await renderer.render(parentBlock, {
        network: 'testnet',
        blockLoader,
        hrlResolver,
      });

      expect(result.html).toContain('Parent Block');
      expect(result.html).toContain('<div class="child">Hello</div>');
      expect(blockLoader.loadBlock).toHaveBeenCalledWith('0.0.123456');
    });

    it('should merge attributes from parent context', async () => {
      const parentBlock = {
        id: 'parent-block',
        name: 'test/parent',
        version: '1.0.0',
        p: 'hcs-12' as const,
        op: 'register' as const,
        template: `
          <div class="parent">
            <div data-hashlink="hcs://12/0.0.123456"
                 data-attributes='{"message": "Custom Message", "color": "blue"}'>
            </div>
          </div>
        `,
      };

      const childBlockData = {
        definition: createMockBlockDefinition({
          name: 'test/child',
          attributes: {
            message: { type: 'string', default: 'Default' },
            color: { type: 'string', default: 'red' },
          },
        }),
        template:
          '<div class="child" style="color: {{attributes.color}}">{{attributes.message}}</div>',
      };

      blockLoader.loadBlock.mockResolvedValue(childBlockData);

      const result = await renderer.render(parentBlock, {
        network: 'testnet',
        blockLoader,
        hrlResolver,
        initialState: {
          attributes: { theme: 'dark' },
          actionResults: {},
        },
      });

      expect(result.html).toContain('Custom Message');
      expect(result.html).toContain('color: blue');
    });

    it('should handle multiple nested blocks', async () => {
      const parentBlock = {
        id: 'parent-block',
        name: 'test/parent',
        version: '1.0.0',
        p: 'hcs-12' as const,
        op: 'register' as const,
        template: `
          <div class="dashboard">
            <div data-hashlink="hcs://12/0.0.111111"></div>
            <div data-hashlink="hcs://12/0.0.222222"></div>
          </div>
        `,
      };

      blockLoader.loadBlock
        .mockResolvedValueOnce({
          definition: createMockBlockDefinition({ name: 'test/block1' }),
          template: '<div>Block 1</div>',
        })
        .mockResolvedValueOnce({
          definition: createMockBlockDefinition({ name: 'test/block2' }),
          template: '<div>Block 2</div>',
        });

      const result = await renderer.render(parentBlock, {
        network: 'testnet',
        blockLoader,
        hrlResolver,
      });

      expect(result.html).toContain('Block 1');
      expect(result.html).toContain('Block 2');
      expect(blockLoader.loadBlock).toHaveBeenCalledTimes(2);
    });

    it('should handle circular references gracefully', async () => {
      const circularBlock = {
        id: '0.0.123456',
        name: 'test/circular',
        version: '1.0.0',
        p: 'hcs-12' as const,
        op: 'register' as const,
        template: `
          <div class="circular">
            <h2>Circular Block</h2>
            <div data-hashlink="hcs://12/0.0.123456"></div>
          </div>
        `,
      };

      blockLoader.loadBlock.mockResolvedValue({
        definition: createMockBlockDefinition({ name: 'test/circular' }),
        template: circularBlock.template,
      });

      const result = await renderer.render(circularBlock, {
        network: 'testnet',
        blockLoader,
        hrlResolver,
      });

      expect(result.html).toContain('Circular Block');
      expect(result.html).toContain('Circular reference detected');
      expect(blockLoader.loadBlock).not.toHaveBeenCalled();
    });

    it('should respect max depth limit', async () => {
      const deepBlock = {
        id: 'deep-block',
        name: 'test/deep',
        version: '1.0.0',
        p: 'hcs-12' as const,
        op: 'register' as const,
        template:
          '<div>Level {{depth}}<div data-hashlink="hcs://12/0.0.123456"></div></div>',
      };

      blockLoader.loadBlock.mockResolvedValue({
        definition: createMockBlockDefinition({ name: 'test/deep' }),
        template: deepBlock.template,
      });

      const result = await renderer.render(deepBlock, {
        network: 'testnet',
        blockLoader,
        hrlResolver,
        maxDepth: 3,
        depth: 2,
      });

      expect(result.html).toContain('data-hashlink="hcs://12/0.0.123456"');
    });

    it('should handle missing blocks with error comment', async () => {
      const parentBlock = {
        id: 'parent-block',
        name: 'test/parent',
        version: '1.0.0',
        p: 'hcs-12' as const,
        op: 'register' as const,
        template: `
          <div class="parent">
            <div data-hashlink="hcs://12/0.0.999999"></div>
          </div>
        `,
      };

      blockLoader.loadBlock.mockResolvedValue(null);

      const result = await renderer.render(parentBlock, {
        network: 'testnet',
        blockLoader,
        hrlResolver,
      });

      expect(result.html).toContain('<!-- HashLink Error:');
      expect(result.html).toContain('Block not found');
    });

    it('should support lazy loading wrapper', async () => {
      const parentBlock = {
        id: 'parent-block',
        name: 'test/parent',
        version: '1.0.0',
        p: 'hcs-12' as const,
        op: 'register' as const,
        template: `
          <div class="parent">
            <div data-hashlink="hcs://12/0.0.123456" data-loading="lazy"></div>
          </div>
        `,
      };

      blockLoader.loadBlock.mockResolvedValue({
        definition: createMockBlockDefinition({ name: 'test/lazy' }),
        template: '<div>Lazy Content</div>',
      });

      const result = await renderer.render(parentBlock, {
        network: 'testnet',
        blockLoader,
        hrlResolver,
      });

      expect(result.html).toContain('hashlink-lazy-container');
      expect(result.html).toContain('data-hashlink-lazy="hcs://12/0.0.123456"');
      expect(result.html).toContain('<template class="hashlink-lazy-content">');
      expect(result.html).toContain('Lazy Content');
    });

    it('should handle HCS-1 raw content', async () => {
      const parentBlock = {
        id: 'parent-block',
        name: 'test/parent',
        version: '1.0.0',
        p: 'hcs-12' as const,
        op: 'register' as const,
        template: `
          <div class="parent">
            <div data-hashlink="hcs://1/0.0.123456"></div>
          </div>
        `,
      };

      blockLoader.loadBlock.mockResolvedValue(null);
      hrlResolver.resolve.mockResolvedValue({
        content: '<div>Raw HCS-1 Content</div>',
        contentType: 'text/html',
        topicId: '0.0.123456',
        isBinary: false,
      });

      const result = await renderer.render(parentBlock, {
        network: 'testnet',
        blockLoader,
        hrlResolver,
      });

      expect(result.html).toContain('Raw HCS-1 Content');
    });

    it('should propagate actions to child blocks', async () => {
      const parentBlock = {
        id: 'parent-block',
        name: 'test/parent',
        version: '1.0.0',
        p: 'hcs-12' as const,
        op: 'register' as const,
        template: `
          <div class="parent">
            <div data-hashlink="hcs://12/0.0.123456"
                 data-actions='{"submit": "0.0.789012"}'>
            </div>
          </div>
        `,
      };

      const childBlockData = {
        definition: createMockBlockDefinition({ name: 'test/form' }),
        template:
          '<form><button data-action="{{actions.submit}}">Submit</button></form>',
      };

      blockLoader.loadBlock.mockResolvedValue(childBlockData);

      const result = await renderer.render(parentBlock, {
        network: 'testnet',
        blockLoader,
        hrlResolver,
      });

      expect(result.html).toContain('data-action="0.0.789012"');
    });
  });

  describe('error handling', () => {
    it('should skip HashLink processing without network config', async () => {
      const block = {
        id: 'test-block',
        name: 'test/block',
        version: '1.0.0',
        p: 'hcs-12' as const,
        op: 'register' as const,
        template: '<div data-hashlink="hcs://12/0.0.123456"></div>',
      };

      const result = await renderer.render(block, {});

      expect(result.html).toContain('data-hashlink="hcs://12/0.0.123456"');
      expect(blockLoader.loadBlock).not.toHaveBeenCalled();
    });
  });
});
