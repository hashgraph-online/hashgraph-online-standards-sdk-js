/**
 * Tests for AssemblyBuilder utility
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AssemblyBuilder } from '../../../src/hcs-12/builders/assembly-builder';
import { ActionBuilder } from '../../../src/hcs-12/builders/action-builder';
import { BlockBuilder } from '../../../src/hcs-12/builders/block-builder';
import { Logger } from '../../../src/utils/logger';

describe('AssemblyBuilder', () => {
  let builder: AssemblyBuilder;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({ module: 'AssemblyBuilderTest' });
    jest.spyOn(logger, 'info').mockImplementation();

    builder = new AssemblyBuilder(logger);
  });

  describe('Basic Assembly Building', () => {
    it('should create a minimal assembly registration', () => {
      const registration = builder
        .setName('my-app')
        .setVersion('1.0.0')
        .build();

      expect(registration).toMatchObject({
        p: 'hcs-12',
        op: 'register',
        name: 'my-app',
        version: '1.0.0',
      });
      expect(registration.description).toBeUndefined();
      expect(registration.tags).toBeUndefined();
    });

    it('should add metadata fields', () => {
      const registration = builder
        .setName('defi-dashboard')
        .setVersion('2.1.0')
        .setDescription('Complete DeFi portfolio management')
        .setAuthor('0.0.123456')
        .addTag('defi')
        .addTag('portfolio')
        .build();

      expect(registration.description).toBe(
        'Complete DeFi portfolio management',
      );
      expect(registration.author).toBe('0.0.123456');
      expect(registration.tags).toEqual(['defi', 'portfolio']);
    });

    it('should create add-action operations', () => {
      const actionBuilder1 = new ActionBuilder(logger)
        .setTopicId('0.0.12345')
        .setAlias('transfer');
      
      const actionBuilder2 = new ActionBuilder(logger)
        .setTopicId('0.0.12346')
        .setAlias('approve');

      const operations = builder
        .addAction(actionBuilder1)
        .addAction(actionBuilder2)
        .buildOperations();

      expect(operations).toHaveLength(2);
      expect(operations[0]).toMatchObject({
        p: 'hcs-12',
        op: 'add-action',
        t_id: '0.0.12345',
        alias: 'transfer',
      });
      expect(operations[1]).toMatchObject({
        p: 'hcs-12',
        op: 'add-action',
        t_id: '0.0.12346',
        alias: 'approve',
      });
    });

    it('should create add-block operations', () => {
      const blockBuilder1 = new BlockBuilder()
        .setName('test/block1')
        .setTitle('Test Block 1')
        .setCategory('test')
        .setTemplateTopicId('0.0.33333')
        .addAttribute('defaultAmount', 'number', 100)
        .setTopicId('0.0.22345')
        .setActions({ transfer: '0.0.12345' });

      const blockBuilder2 = new BlockBuilder()
        .setName('test/block2')
        .setTitle('Test Block 2')
        .setCategory('test')
        .setTemplateTopicId('0.0.33334')
        .addAttribute('pageSize', 'number', 10)
        .setTopicId('0.0.22346');

      const operations = builder
        .addBlock(blockBuilder1)
        .addBlock(blockBuilder2)
        .buildOperations();

      expect(operations).toHaveLength(2);
      expect(operations[0]).toMatchObject({
        p: 'hcs-12',
        op: 'add-block',
        block_t_id: '0.0.22345',
        actions: { transfer: '0.0.12345' },
        attributes: { defaultAmount: 100 },
      });
      expect(operations[1]).toMatchObject({
        p: 'hcs-12',
        op: 'add-block',
        block_t_id: '0.0.22346',
        attributes: { pageSize: 10 },
      });
    });
  });

  describe('Fluent API', () => {
    it('should support method chaining', () => {
      const actionBuilder = new ActionBuilder(logger)
        .setTopicId('0.0.12345')
        .setAlias('test-action');
      
      const blockBuilder = new BlockBuilder()
        .setName('test/block')
        .setTitle('Test Block')
        .setCategory('test')
        .setTemplateTopicId('0.0.33333')
        .setTopicId('0.0.22345');

      const result = builder
        .setName('test-app')
        .setVersion('1.0.0')
        .setDescription('Testing')
        .addTag('test')
        .addAction(actionBuilder)
        .addBlock(blockBuilder);
      expect(result).toBe(builder);
    });

    it('should allow building multiple assemblies', () => {
      builder.setName('app1').setVersion('1.0.0').setDescription('First app');

      const reg1 = builder.build();

      const reg2 = builder
        .reset()
        .setName('app2')
        .setVersion('2.0.0')
        .setDescription('Second app')
        .build();

      expect(reg1.name).toBe('app1');
      expect(reg2.name).toBe('app2');
      expect(reg1.version).not.toBe(reg2.version);
    });
  });

  describe('Validation', () => {
    it('should validate required fields', () => {
      expect(() => builder.build()).toThrow('Assembly name is required');

      builder.setName('test-app');
      expect(() => builder.build()).toThrow('Assembly version is required');

      builder.setVersion('1.0.0');

      expect(() => builder.build()).not.toThrow();
    });

    it('should validate name format', () => {
      expect(() => builder.setName('Invalid Name')).toThrow(
        'Invalid assembly name format',
      );

      expect(() => builder.setName('test-app-123')).not.toThrow();
    });

    it('should validate semantic version', () => {
      builder.setName('test-app');

      expect(() => builder.setVersion('invalid')).toThrow(
        'Invalid semantic version',
      );

      expect(() => builder.setVersion('1.0.0')).not.toThrow();

      expect(() => builder.setVersion('2.1.0-beta.1')).not.toThrow();
    });

    it('should validate action topic IDs', () => {
      const invalidActionBuilder = new ActionBuilder(logger)
        .setAlias('test');
      
      expect(() => invalidActionBuilder.setTopicId('invalid-topic')).toThrow(
        'Invalid topic ID format',
      );

      const validActionBuilder = new ActionBuilder(logger)
        .setTopicId('0.0.12345')
        .setAlias('test');
      
      expect(() => builder.addAction(validActionBuilder)).not.toThrow();
    });

    it('should validate block topic IDs', () => {
      const invalidBlockBuilder = new BlockBuilder()
        .setName('test/block')
        .setTitle('Test Block')
        .setCategory('test')
        .setTemplateTopicId('0.0.33333')
        .setTopicId('invalid-topic');
      
      expect(() => builder.addBlock(invalidBlockBuilder)).toThrow(
        'Invalid block topic ID: invalid-topic',
      );

      const validBlockBuilder = new BlockBuilder()
        .setName('test/block')
        .setTitle('Test Block')
        .setCategory('test')
        .setTemplateTopicId('0.0.33333')
        .setTopicId('0.0.12345');
      
      expect(() => builder.addBlock(validBlockBuilder)).not.toThrow();
    });
  });

  describe('Helper Methods', () => {
    it('should build valid assembly registration', () => {
      const complete = builder
        .setName('test')
        .setVersion('1.0.0')
        .setDescription('Test Assembly')
        .build();

      expect(complete).toMatchObject({
        p: 'hcs-12',
        op: 'register',
        name: 'test',
        version: '1.0.0',
        description: 'Test Assembly',
      });
    });

    it('should support update operations', () => {
      const update = builder
        .setDescription('Updated description')
        .addTag('new-tag')
        .buildUpdate();

      expect(update).toMatchObject({
        p: 'hcs-12',
        op: 'update',
        description: 'Updated description',
        tags: ['new-tag'],
      });
    });
  });

  describe('Advanced Features', () => {
    it('should build complete operation sequence', () => {
      const transferAction = new ActionBuilder(logger)
        .setTopicId('0.0.12345')
        .setAlias('transfer');
      
      const approveAction = new ActionBuilder(logger)
        .setTopicId('0.0.12346')
        .setAlias('approve');

      const blockBuilder = new BlockBuilder()
        .setName('test/block')
        .setTitle('Test Block')
        .setCategory('test')
        .setTemplateTopicId('0.0.33333')
        .setTopicId('0.0.22345')
        .setActions({ transfer: '0.0.12345', approve: '0.0.12346' });

      const operations = builder
        .setName('complete-app')
        .setVersion('1.0.0')
        .setDescription('Complete application')
        .addAction(transferAction)
        .addAction(approveAction)
        .addBlock(blockBuilder)
        .buildOperations();

      expect(operations[0].op).toBe('add-action');
      expect(operations[1].op).toBe('add-action');
      expect(operations[2].op).toBe('add-block');
    });

    it('should handle data field for large configs', () => {
      const actionBuilder = new ActionBuilder(logger)
        .setTopicId('0.0.12345')
        .setAlias('complex-action');

      const operation = builder
        .addAction(actionBuilder)
        .buildOperations()[0];

      expect(operation).toMatchObject({
        p: 'hcs-12',
        op: 'add-action',
        t_id: '0.0.12345',
        alias: 'complex-action',
      });
    });
  });
});
