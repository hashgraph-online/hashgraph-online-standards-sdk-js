#!/usr/bin/env tsx

/**
 * HCS-12 Builder Pattern Demo
 *
 * Shows how to use the builder patterns to create blocks, actions, and assemblies
 * in a more intuitive way.
 */

import {
  HCS12SDK,
  Logger,
  BlockBuilder,
  AssemblyBuilder,
  ActionBuilder,
} from '../../src';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import path from 'path';

dotenv.config();

const logger = new Logger({ module: 'BuilderDemo', level: 'info' });

async function main() {
  try {
    const privateKey = process.env.OPERATOR_KEY;
    const accountId = process.env.OPERATOR_ID;

    if (!privateKey || !accountId) {
      throw new Error('Missing OPERATOR_KEY or OPERATOR_ID in .env file');
    }

    logger.info('Initializing HCS-12 SDK Client');
    const client = new HCS12SDK({
      network: 'testnet',
      privateKey,
      accountId,
      logger,
    });

    /**
     * Step 1: Create and register actions using ActionBuilder
     */
    logger.info('Building actions with ActionBuilder...');

    // First inscribe the WASM module
    const wasmPath = path.join(__dirname, 'wasm/pkg/hashlink_counter_bg.wasm');
    const wasmData = readFileSync(wasmPath);
    const wasmTopicId = await client.inscribeFile({
      file: wasmData,
      mimeType: 'application/wasm',
      metadata: {
        name: 'demo-actions.wasm',
        description: 'Demo actions module with counter and toggle actions',
      },
    });
    logger.info('WASM inscribed', { wasmTopicId });

    // Get module info from WASM
    const moduleInfo = await client.wasm.extractModuleInfo(wasmData);
    const infoHash = await new ActionBuilder(logger).generateInfoHash(
      moduleInfo,
    );

    // Register the action using ActionBuilder
    const actionRegistration = await new ActionBuilder(logger)
      .setTopicId(wasmTopicId)
      .setWasmHash(await new ActionBuilder(logger).generateWasmHash(wasmData))
      .setHash(infoHash)
      .build();

    const actionTopicId = await client.registerAction(actionRegistration);
    logger.info('Actions registered', { actionTopicId });

    /**
     * Step 2: Create block definitions using BlockBuilder
     */
    logger.info('Building blocks with BlockBuilder...');

    // Create counter block
    const counterBlock = new BlockBuilder()
      .setName('hashlink/counter')
      .setTitle('Counter Block')
      .setDescription('Interactive counter with increment/decrement/reset')
      .setCategory('interactive')
      .setIcon('calculator')
      .addAttribute('count', 'number', 0)
      .addAttribute('step', 'number', 1)
      .addAttribute('label', 'string', 'Counter')
      .addAction('increment', 'Increment the counter')
      .addAction('decrement', 'Decrement the counter')
      .addAction('reset', 'Reset to zero')
      .build();

    // Create stats block
    const statsBlock = BlockBuilder.createDisplayBlock(
      'hashlink/stats',
      'Statistics Display',
    )
      .setDescription('Display statistics and metrics')
      .addAttribute('title', 'string', 'Statistics')
      .addAttribute('values', 'array', [])
      .build();

    // Create container block
    const containerBlock = BlockBuilder.createContainerBlock(
      'hashlink/container',
      'Container Block',
    )
      .setDescription('Container for nested blocks with toggle controls')
      .addAttribute('title', 'string', 'Container')
      .addAttribute('description', 'string', '')
      .addAttribute('showCounter', 'boolean', true)
      .addAttribute('showStats', 'boolean', true)
      .addAttribute('counterBlockId', 'string', '')
      .addAttribute('statsBlockId', 'string', '')
      .addAttribute('counterActionId', 'string', '')
      .addAction('toggleCounter', 'Toggle counter visibility')
      .addAction('toggleStats', 'Toggle stats visibility')
      .build();

    // Register blocks (inscribe templates and definitions)
    const counterTemplate = readFileSync(
      path.join(__dirname, 'counter-block-template.html'),
      'utf8',
    );
    const statsTemplate = readFileSync(
      path.join(__dirname, 'stats-block-template.html'),
      'utf8',
    );
    const containerTemplate = readFileSync(
      path.join(__dirname, 'container-block-template.html'),
      'utf8',
    );

    const counterBlockId = await client.registerBlock(
      counterBlock,
      counterTemplate,
    );
    const statsBlockId = await client.registerBlock(statsBlock, statsTemplate);
    const containerBlockId = await client.registerBlock(
      containerBlock,
      containerTemplate,
    );

    logger.info('Blocks registered', {
      counter: counterBlockId,
      stats: statsBlockId,
      container: containerBlockId,
    });

    /**
     * Step 3: Create assembly using AssemblyBuilder
     */
    logger.info('Building assembly with AssemblyBuilder...');

    const assemblyBuilder = new AssemblyBuilder(logger)
      .setName('demo-app')
      .setVersion('1.0.0')
      .setDescription('Demo application showcasing builder patterns')
      .setTags(['demo', 'counter', 'nested-blocks'])
      .setAuthor(accountId)
      // Add counter block with all actions mapped
      .addBlock(
        counterBlockId,
        {
          increment: actionTopicId,
          decrement: actionTopicId,
          reset: actionTopicId,
        },
        {
          count: 0,
          step: 1,
          label: 'Demo Counter',
        },
      )
      // Add stats block (no actions)
      .addBlock(
        statsBlockId,
        {},
        {
          title: 'Demo Statistics',
          values: [
            { label: 'Total Blocks', value: 3 },
            { label: 'Actions Available', value: 5 },
          ],
        },
      )
      // Add container block with toggle actions and nested block references
      .addBlock(
        containerBlockId,
        {
          toggleCounter: actionTopicId,
          toggleStats: actionTopicId,
        },
        {
          title: 'Nested Blocks Demo',
          description: 'This demonstrates template-based composition',
          showCounter: true,
          showStats: true,
          counterBlockId: counterBlockId,
          statsBlockId: statsBlockId,
          counterActionId: actionTopicId,
        },
      );

    // Create the assembly
    const assemblyRegistration = assemblyBuilder.build();
    const assemblyTopicId = await client.createAssembly(assemblyRegistration);
    logger.info('Assembly created', { assemblyTopicId });

    // Add blocks to assembly
    for (const operation of assemblyBuilder.getOperations()) {
      if (operation.op === 'add-block') {
        await client.addBlockToAssembly(assemblyTopicId, operation);
        logger.info('Added block to assembly', {
          blockId: operation.block_t_id,
        });
      }
    }

    logger.info('Demo completed successfully!');

    // Log summary
    console.log('\n=== BUILDER DEMO SUMMARY ===');
    console.log(`Action Topic: ${actionTopicId}`);
    console.log(`Counter Block: ${counterBlockId}`);
    console.log(`Stats Block: ${statsBlockId}`);
    console.log(`Container Block: ${containerBlockId}`);
    console.log(`Assembly: ${assemblyTopicId}`);
    console.log('\nThe builder patterns make it much easier to:');
    console.log('- Define blocks with attributes and actions');
    console.log('- Register actions with proper validation');
    console.log('- Create assemblies with mapped actions');
    console.log('===========================\n');
  } catch (error) {
    logger.error('Demo failed', error);
    process.exit(1);
  }
}

main();
