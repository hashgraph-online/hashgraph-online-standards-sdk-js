/**
 * End-to-End Integration Test for Nested Blocks
 *
 * Tests the complete template-based composition system
 */

import { Logger } from '../../../utils/logger';
import { BlockRenderer } from '../block-renderer';
import { GutenbergBridge } from '../gutenberg-bridge';
import { TemplateEngine } from '../template-engine';
import { BlockStateManager } from '../block-state-manager';
import { BlockLoader } from '../../registries/block-loader';
import { HRLResolver } from '../../../utils/hrl-resolver';
import { ResourceManager } from '../resource-manager';
import type { BlockDefinitionWithUI } from '../block-renderer';
import type { NetworkType } from '../../../utils/types';

describe('Nested Blocks E2E', () => {
  let renderer: BlockRenderer;
  let stateManager: BlockStateManager;
  let mockBlockLoader: jest.Mocked<BlockLoader>;
  let mockHrlResolver: jest.Mocked<HRLResolver>;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({ module: 'test', level: 'error' });
    const gutenbergBridge = new GutenbergBridge(logger);
    const resourceManager = new ResourceManager('testnet', logger, {} as any);
    const templateEngine = new TemplateEngine(logger);
    stateManager = new BlockStateManager(logger);
    renderer = new BlockRenderer(
      logger,
      gutenbergBridge,
      templateEngine,
      stateManager,
    );

    mockBlockLoader = {
      logger,
      loadBlock: jest.fn(),
      loadMultipleBlocks: jest.fn(),
      getBlockFromHRL: jest.fn(),
    } as any;

    mockHrlResolver = {
      resolve: jest.fn(),
    } as any;
  });

  it('should render a complete nested block hierarchy', async () => {
    const counterBlockId = '0.0.12345';
    const statsBlockId = '0.0.12346';
    const containerBlockId = '0.0.12347';
    const counterActionId = '0.0.12348';

    const counterBlock: BlockDefinitionWithUI = {
      id: counterBlockId,
      p: 'hcs-12',
      op: 'register',
      name: 'hashlink/counter',
      version: '1.0.0',
      template: `
        <div class="counter-block" data-block-id="{{blockId}}">
          <h3>Counter: {{attributes.count}}</h3>
          <button data-action="{{actions.increment}}">+{{attributes.step}}</button>
          <button data-action="{{actions.decrement}}">-{{attributes.step}}</button>
        </div>
      `,
      attributes: {
        count: { type: 'number', default: 0 },
        step: { type: 'number', default: 1 },
      },
    };

    const statsBlock: BlockDefinitionWithUI = {
      id: statsBlockId,
      p: 'hcs-12',
      op: 'register',
      name: 'hashlink/stats',
      version: '1.0.0',
      template: `
        <div class="stats-block" data-block-id="{{blockId}}">
          <h3>{{attributes.title}}</h3>
          <div class="stats-grid">
            {{#each attributes.values}}
              <div class="stat">
                <span class="label">{{this.label}}</span>
                <span class="value">{{this.value}}</span>
              </div>
            {{/each}}
          </div>
        </div>
      `,
      attributes: {
        title: { type: 'string', default: 'Statistics' },
        values: { type: 'array', default: [] },
      },
    };

    const containerBlock: BlockDefinitionWithUI = {
      id: containerBlockId,
      p: 'hcs-12',
      op: 'register',
      name: 'hashlink/container',
      version: '1.0.0',
      template: `
        <div class="container-block" data-block-id="{{blockId}}">
          <h2>{{attributes.title}}</h2>
          <p>{{attributes.description}}</p>
          
          <!-- Nested Counter Block -->
          <div class="nested-counter">
            <h4>Nested Counter</h4>
            <div data-hashlink="hcs://12/${counterBlockId}"
                 data-attributes='{"count": 10, "step": 5}'
                 data-actions='{"increment": "${counterActionId}", "decrement": "${counterActionId}"}'>
              Loading counter...
            </div>
          </div>
          
          <!-- Nested Stats Block -->
          <div class="nested-stats">
            <h4>Nested Statistics</h4>
            <div data-hashlink="hcs://12/${statsBlockId}"
                 data-attributes='{"title": "Container Stats", "values": [{"label": "Blocks", "value": 3}, {"label": "Actions", "value": 2}]}'>
              Loading stats...
            </div>
          </div>
        </div>
      `,
      attributes: {
        title: { type: 'string', default: 'Container' },
        description: { type: 'string', default: '' },
      },
    };

    mockBlockLoader.loadBlock
      .mockResolvedValueOnce({
        definition: {
          apiVersion: 3,
          name: counterBlock.name,
          title: 'Counter Block',
          category: 'widgets',
          template_t_id: '0.0.12345',
          supports: {},
          attributes: counterBlock.attributes || {},
        },
        template: counterBlock.template!,
      })
      .mockResolvedValueOnce({
        definition: {
          apiVersion: 3,
          name: statsBlock.name,
          title: 'Stats Block',
          category: 'widgets',
          template_t_id: '0.0.12346',
          supports: {},
          attributes: statsBlock.attributes || {},
        },
        template: statsBlock.template!,
      });

    mockHrlResolver.resolve
      .mockResolvedValueOnce({
        topicId: counterBlockId,
        content: '',
        contentType: 'application/json',
        isBinary: false,
      })
      .mockResolvedValueOnce({
        topicId: statsBlockId,
        content: '',
        contentType: 'application/json',
        isBinary: false,
      });

    const result = await renderer.render(containerBlock, {
      network: 'testnet' as NetworkType,
      blockLoader: mockBlockLoader,
      hrlResolver: mockHrlResolver,
      maxDepth: 5,
    });

    expect(result.html).toBeDefined();
    const html = result.html!;

    expect(html).toContain('Container');
    expect(html).toContain('Nested Counter');
    expect(html).toContain('Counter: 10');
    expect(html).toContain('+5');
    expect(html).toContain('-5');

    expect(html).toContain('Container Stats');

    expect(html).toContain('stats-grid');
    expect(html).toContain('stat');


    expect(mockBlockLoader.loadBlock).toHaveBeenCalledTimes(2);
    expect(mockBlockLoader.loadBlock).toHaveBeenCalledWith(counterBlockId);
    expect(mockBlockLoader.loadBlock).toHaveBeenCalledWith(statsBlockId);
  });

  it('should handle deeply nested blocks with proper depth limiting', async () => {
    const blockIds = ['0.0.1001', '0.0.1002', '0.0.1003', '0.0.1004'];

    const createNestedBlock = (
      id: string,
      index: number,
      childId?: string,
    ): BlockDefinitionWithUI => ({
      id,
      p: 'hcs-12',
      op: 'register',
      name: `hashlink/level-${index}`,
      version: '1.0.0',
      template: childId
        ? `
          <div class="level-${index}" data-block-id="{{blockId}}">
            <h3>Level ${index}</h3>
            <div data-hashlink="hcs://12/${childId}">
              Loading child...
            </div>
          </div>
        `
        : `
          <div class="level-${index}" data-block-id="{{blockId}}">
            <h3>Leaf Level ${index}</h3>
          </div>
        `,
      attributes: {},
    });

    const blocks = [
      createNestedBlock(blockIds[0], 0, blockIds[1]),
      createNestedBlock(blockIds[1], 1, blockIds[2]),
      createNestedBlock(blockIds[2], 2, blockIds[3]),
      createNestedBlock(blockIds[3], 3),
    ];

    mockBlockLoader.loadBlock
      .mockResolvedValueOnce({
        definition: {
          apiVersion: 3,
          name: blocks[1].name,
          title: `Level ${1}`,
          category: 'test',
          template_t_id: '0.0.12345',
          supports: {},
          attributes: blocks[1].attributes || {},
        },
        template: blocks[1].template!,
      })
      .mockResolvedValueOnce({
        definition: {
          apiVersion: 3,
          name: blocks[2].name,
          title: `Level ${2}`,
          category: 'test',
          template_t_id: '0.0.12346',
          supports: {},
          attributes: blocks[2].attributes || {},
        },
        template: blocks[2].template!,
      })
      .mockResolvedValueOnce({
        definition: {
          apiVersion: 3,
          name: blocks[3].name,
          title: `Level ${3}`,
          category: 'test',
          template_t_id: '0.0.12347',
          supports: {},
          attributes: blocks[3].attributes || {},
        },
        template: blocks[3].template!,
      });

    mockHrlResolver.resolve
      .mockResolvedValueOnce({
        topicId: blockIds[1],
        content: '',
        contentType: 'application/json',
        isBinary: false,
      })
      .mockResolvedValueOnce({
        topicId: blockIds[2],
        content: '',
        contentType: 'application/json',
        isBinary: false,
      })
      .mockResolvedValueOnce({
        topicId: blockIds[3],
        content: '',
        contentType: 'application/json',
        isBinary: false,
      });

    const result = await renderer.render(blocks[0], {
      network: 'testnet' as NetworkType,
      blockLoader: mockBlockLoader,
      hrlResolver: mockHrlResolver,
      maxDepth: 3,
    });

    const html = result.html!;
    expect(html).toContain('Level 0');
    expect(html).toContain('Level 1');
    expect(html).toContain('Level 2');
    expect(html).toContain('Level 3');
    expect(mockBlockLoader.loadBlock).toHaveBeenCalledTimes(3);
  });

  it('should propagate actions and attributes through nested blocks', async () => {
    const childBlockId = '0.0.2001';
    const parentBlockId = '0.0.2002';
    const actionTopicId = '0.0.2003';

    const childBlock: BlockDefinitionWithUI = {
      id: childBlockId,
      p: 'hcs-12',
      op: 'register',
      name: 'hashlink/action-child',
      version: '1.0.0',
      template: `
        <div class="child-block" data-block-id="{{blockId}}">
          <p>Value: {{attributes.value}}</p>
          <button data-action="{{actions.update}}">Update</button>
        </div>
      `,
      attributes: {
        value: { type: 'string', default: 'default' },
      },
    };

    const parentBlock: BlockDefinitionWithUI = {
      id: parentBlockId,
      p: 'hcs-12',
      op: 'register',
      name: 'hashlink/action-parent',
      version: '1.0.0',
      template: `
        <div class="parent-block" data-block-id="{{blockId}}">
          <h2>Parent Block</h2>
          <div data-hashlink="hcs://12/${childBlockId}"
               data-attributes='{"value": "inherited-value"}'
               data-actions='{"update": "${actionTopicId}"}'>
            Loading child...
          </div>
        </div>
      `,
      attributes: {},
    };

    mockBlockLoader.loadBlock.mockResolvedValueOnce({
      definition: {
        apiVersion: 3,
        name: childBlock.name,
        title: 'Action Child Block',
        category: 'test',
        template_t_id: '0.0.12345',
        supports: {},
        attributes: childBlock.attributes || {},
      },
      template: childBlock.template!,
    });

    mockHrlResolver.resolve.mockResolvedValueOnce({
      topicId: childBlockId,
      content: '',
      contentType: 'application/json',
      isBinary: false,
    });

    const result = await renderer.render(parentBlock, {
      network: 'testnet' as NetworkType,
      blockLoader: mockBlockLoader,
      hrlResolver: mockHrlResolver,
    });

    const html = result.html!;
    expect(html).toContain('Parent Block');
    expect(html).toContain('Value: inherited-value');
    expect(html).toContain(`data-action="${actionTopicId}"`);
    expect(html).toContain('Update');
  });

  it('should handle errors gracefully in nested blocks', async () => {
    const validBlockId = '0.0.3001';
    const missingBlockId = '0.0.3002';
    const errorBlockId = '0.0.3003';

    const parentBlock: BlockDefinitionWithUI = {
      id: '0.0.3000',
      p: 'hcs-12',
      op: 'register',
      name: 'hashlink/error-parent',
      version: '1.0.0',
      template: `
        <div class="parent-block">
          <h2>Error Test Parent</h2>
          
          <!-- Valid child -->
          <div data-hashlink="hcs://12/${validBlockId}">
            Loading valid block...
          </div>
          
          <!-- Missing child -->
          <div data-hashlink="hcs://12/${missingBlockId}">
            Loading missing block...
          </div>
          
          <!-- Error child -->
          <div data-hashlink="hcs://12/${errorBlockId}">
            Loading error block...
          </div>
        </div>
      `,
      attributes: {},
    };

    const validBlock: BlockDefinitionWithUI = {
      id: validBlockId,
      p: 'hcs-12',
      op: 'register',
      name: 'hashlink/valid-child',
      version: '1.0.0',
      template: '<div>Valid Child Content</div>',
      attributes: {},
    };

    mockBlockLoader.loadBlock
      .mockResolvedValueOnce({
        definition: {
          apiVersion: 3,
          name: validBlock.name,
          title: 'Valid Child Block',
          category: 'test',
          template_t_id: '0.0.12345',
          supports: {},
          attributes: validBlock.attributes || {},
        },
        template: validBlock.template!,
      })
      .mockRejectedValueOnce(new Error('Block not found'))
      .mockRejectedValueOnce(new Error('Network error'));

    mockHrlResolver.resolve
      .mockResolvedValueOnce({ topicId: validBlockId, content: '', contentType: 'application/json', isBinary: false })
      .mockResolvedValueOnce({ topicId: missingBlockId, content: '', contentType: 'application/json', isBinary: false })
      .mockResolvedValueOnce({ topicId: errorBlockId, content: '', contentType: 'application/json', isBinary: false });

    const result = await renderer.render(parentBlock, {
      network: 'testnet' as NetworkType,
      blockLoader: mockBlockLoader,
      hrlResolver: mockHrlResolver,
    });

    const html = result.html!;
    expect(html).toContain('Error Test Parent');
    expect(html).toContain('Valid Child Content');
    expect(html).toContain(
      '<!-- HashLink Error: Failed to load HCS-12 block 0.0.3002: Block not found -->',
    );
    expect(html).toContain(
      '<!-- HashLink Error: Failed to load HCS-12 block 0.0.3003: Network error -->',
    );
  });

  it('should support lazy loading of nested blocks', async () => {
    const lazyBlockId = '0.0.4001';
    const eagerBlockId = '0.0.4002';

    const lazyBlock: BlockDefinitionWithUI = {
      id: lazyBlockId,
      p: 'hcs-12',
      op: 'register',
      name: 'hashlink/lazy-child',
      version: '1.0.0',
      template: '<div class="lazy-content">Lazy loaded content</div>',
      attributes: {},
    };

    const eagerBlock: BlockDefinitionWithUI = {
      id: eagerBlockId,
      p: 'hcs-12',
      op: 'register',
      name: 'hashlink/eager-child',
      version: '1.0.0',
      template: '<div class="eager-content">Eager loaded content</div>',
      attributes: {},
    };

    const parentBlock: BlockDefinitionWithUI = {
      id: '0.0.4000',
      p: 'hcs-12',
      op: 'register',
      name: 'hashlink/lazy-parent',
      version: '1.0.0',
      template: `
        <div class="parent-block">
          <h2>Lazy Loading Test</h2>
          
          <!-- Lazy loaded child -->
          <div data-hashlink="hcs://12/${lazyBlockId}" data-loading="lazy">
            Loading lazy block...
          </div>
          
          <!-- Eager loaded child -->
          <div data-hashlink="hcs://12/${eagerBlockId}">
            Loading eager block...
          </div>
        </div>
      `,
      attributes: {},
    };

    mockBlockLoader.loadBlock
      .mockResolvedValueOnce({
        definition: {
          apiVersion: 3,
          name: lazyBlock.name,
          title: 'Lazy Child Block',
          category: 'test',
          template_t_id: '0.0.12345',
          supports: {},
          attributes: lazyBlock.attributes || {},
        },
        template: lazyBlock.template!,
      })
      .mockResolvedValueOnce({
        definition: {
          apiVersion: 3,
          name: eagerBlock.name,
          title: 'Eager Child Block',
          category: 'test',
          template_t_id: '0.0.12346',
          supports: {},
          attributes: eagerBlock.attributes || {},
        },
        template: eagerBlock.template!,
      });

    mockHrlResolver.resolve
      .mockResolvedValueOnce({ topicId: lazyBlockId, content: '', contentType: 'application/json', isBinary: false })
      .mockResolvedValueOnce({ topicId: eagerBlockId, content: '', contentType: 'application/json', isBinary: false });

    const result = await renderer.render(parentBlock, {
      network: 'testnet' as NetworkType,
      blockLoader: mockBlockLoader,
      hrlResolver: mockHrlResolver,
    });

    const html = result.html!;
    expect(html).toContain('Lazy Loading Test');
    expect(html).toContain('Eager loaded content');
    expect(html).toContain('Lazy Loading Test');
    expect(html).toContain('Eager loaded content');
    expect(html).toContain('Lazy loaded content');
  });
});
