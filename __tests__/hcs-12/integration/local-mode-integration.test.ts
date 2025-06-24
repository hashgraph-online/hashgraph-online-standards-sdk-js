/**
 * Local Mode Integration Tests for HCS-12
 *
 * Tests the local mode functionality including template rendering,
 * block state management, and local registry operations without
 * network connectivity.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { Logger } from '../../../src/utils/logger';
import type { NetworkType } from '../../../src/utils/types';
import {
  ActionRegistry,
  BlockLoader,
  AssemblyRegistry,
} from '../../../src/hcs-12/registries';
import {
  TemplateEngine,
  BlockStateManager,
} from '../../../src/hcs-12/rendering';
import { HCS12Client } from '../../../src/hcs-12/sdk';
import { BlockBuilder } from '../../../src/hcs-12/builders';
import * as dotenv from 'dotenv';

dotenv.config();

const hasCredentials =
  process.env.HEDERA_ACCOUNT_ID && process.env.HEDERA_PRIVATE_KEY;

describe('HCS-12 Working Integration Tests', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({ module: 'HCS12WorkingTest' });
  });

  describe('Registry System', () => {
    it('should successfully register and store actions', async () => {
      if (!hasCredentials) {
        console.log('Skipping test - no Hedera credentials provided');
        return;
      }

      const client = new HCS12Client({
        network: 'testnet' as NetworkType,
        operatorId: process.env.HEDERA_ACCOUNT_ID!,
        operatorPrivateKey: process.env.HEDERA_PRIVATE_KEY!,
        logger,
      });
      client.initializeRegistries();
      const actionRegistry = client.actionRegistry!;

      const actionDef = {
        p: 'hcs-12' as const,
        op: 'register' as const,
        t_id: '0.0.123456',
        hash: 'a'.repeat(64),
        wasm_hash: 'b'.repeat(64),
        info_t_id: '0.0.789012',
        m: 'Test action',
      };

      const registrationId = await actionRegistry.register(actionDef);
      expect(registrationId).toBeDefined();
      expect(registrationId).toBe('1');
    });

    it('should successfully register blocks', async () => {
      if (!hasCredentials) {
        console.log('Skipping test - no Hedera credentials provided');
        return;
      }

      const client = new HCS12Client({
        network: 'testnet' as NetworkType,
        operatorId: process.env.HEDERA_ACCOUNT_ID!,
        operatorPrivateKey: process.env.HEDERA_PRIVATE_KEY!,
        logger,
      });
      client.initializeRegistries();
      const blockLoader = client.blockLoader!;

      const template = '<div>Hello World</div>';

      const blockBuilder = BlockBuilder.createDisplayBlock(
        'test/hello-world',
        'Test Block'
      )
        .setDescription('A test block')
        .setTemplate(Buffer.from(template));

      const registeredBlock = await client.registerBlock(blockBuilder);
      const blockTopicId = registeredBlock.getTopicId();

      expect(blockTopicId).toBeDefined();
      expect(blockTopicId).toMatch(/^\d+\.\d+\.\d+$/);
    }, 30000);
  });

  describe('Template Engine', () => {
    let templateEngine: TemplateEngine;

    beforeEach(() => {
      templateEngine = new TemplateEngine(logger);
    });

    it('should render basic templates', async () => {
      const template = '<h1>{{title}}</h1>';
      const result = await templateEngine.render(template, { title: 'Hello' });
      expect(result).toBe('<h1>Hello</h1>');
    });

    it('should handle conditionals', async () => {
      const template = '{{#if show}}<p>Visible</p>{{/if}}';

      const result1 = await templateEngine.render(template, { show: true });
      expect(result1).toBe('<p>Visible</p>');

      const result2 = await templateEngine.render(template, { show: false });
      expect(result2).toBe('');
    });

    it('should handle loops with proper context', async () => {
      const template = '{{#each items}}<li>{{name}}</li>{{/each}}';
      const data = {
        items: [{ name: 'Item 1' }, { name: 'Item 2' }],
      };

      const result = await templateEngine.render(template, data);
      expect(result).toBe('<li>Item 1</li><li>Item 2</li>');
    });

    it('should escape HTML by default', async () => {
      const template = '<p>{{content}}</p>';
      const result = await templateEngine.render(template, {
        content: '<script>alert("xss")</script>',
      });
      expect(result).toBe(
        '<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>',
      );
    });
  });

  describe('Block State Management', () => {
    let stateManager: BlockStateManager;

    beforeEach(() => {
      stateManager = new BlockStateManager(logger);
    });

    it('should manage block states independently', () => {
      const block1 = 'block-1';
      const block2 = 'block-2';

      stateManager.createBlockState(block1, { value: 1 });
      stateManager.createBlockState(block2, { value: 2 });

      expect(stateManager.getBlockState(block1).value).toBe(1);
      expect(stateManager.getBlockState(block2).value).toBe(2);

      stateManager.updateBlockState(block1, { value: 10 });
      expect(stateManager.getBlockState(block1).value).toBe(10);
      expect(stateManager.getBlockState(block2).value).toBe(2);
    });

    it('should handle state change subscriptions', () => {
      const blockId = 'test-block';
      let changeCount = 0;
      let lastState: { counter: number; extra?: string } | null = null;

      stateManager.createBlockState(blockId, { counter: 0 });

      stateManager.onStateChange(blockId, newState => {
        changeCount++;
        lastState = newState;
      });

      stateManager.updateBlockState(blockId, { counter: 1 });
      expect(changeCount).toBe(1);
      expect(lastState.counter).toBe(1);

      stateManager.updateBlockState(blockId, { counter: 2, extra: 'data' });
      expect(changeCount).toBe(2);
      expect(lastState.counter).toBe(2);
      expect(lastState.extra).toBe('data');
    });

    it('should support block messaging', () => {
      const sender = 'sender-block';
      const receiver = 'receiver-block';
      let receivedMessages: Array<{ type: string; payload: { value: number }; fromBlock: string; toBlock: string }> = [];

      stateManager.createBlockState(sender, {});
      stateManager.createBlockState(receiver, {});

      stateManager.onBlockMessage(receiver, msg => {
        receivedMessages.push(msg);
      });

      stateManager.sendMessage(receiver, 'update', { value: 42 }, sender);

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].type).toBe('update');
      expect(receivedMessages[0].payload.value).toBe(42);
      expect(receivedMessages[0].fromBlock).toBe(sender);
      expect(receivedMessages[0].toBlock).toBe(receiver);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle a complete workflow', async () => {
      if (!hasCredentials) {
        console.log('Skipping test - no Hedera credentials provided');
        return;
      }

      const client = new HCS12Client({
        network: 'testnet' as NetworkType,
        operatorId: process.env.HEDERA_ACCOUNT_ID!,
        operatorPrivateKey: process.env.HEDERA_PRIVATE_KEY!,
        logger,
      });
      client.initializeRegistries();
      const actionRegistry = client.actionRegistry!;
      const blockLoader = client.blockLoader!;

      const actionId = await actionRegistry.register({
        p: 'hcs-12' as const,
        op: 'register' as const,
        t_id: '0.0.111111',
        hash: 'c'.repeat(64),
        wasm_hash: 'd'.repeat(64),
      });

      const template = '<div><h2>Count: {{count}}</h2></div>';
      
      const blockBuilder = BlockBuilder.createInteractiveBlock(
        'test/interactive',
        'Interactive Block'
      )
        .setDescription('Interactive test block')
        .addAttribute('count', 'number', 0)
        .setTemplate(Buffer.from(template));

      const registeredBlock = await client.registerBlock(blockBuilder);
      const blockId = registeredBlock.getTopicId();

      const stateManager = new BlockStateManager(logger);
      const templateEngine = new TemplateEngine(logger);

      const blockInstanceId = 'interactive-1';
      stateManager.createBlockState(blockInstanceId, { count: 0 });

      const state = stateManager.getBlockState(blockInstanceId);
      const rendered = await templateEngine.render(template, state);

      expect(rendered).toBe('<div><h2>Count: 0</h2></div>');

      stateManager.updateBlockState(blockInstanceId, { count: 5 });
      const newState = stateManager.getBlockState(blockInstanceId);
      const reRendered = await templateEngine.render(template, newState);

      expect(reRendered).toBe('<div><h2>Count: 5</h2></div>');
    }, 30000);
  });
});
