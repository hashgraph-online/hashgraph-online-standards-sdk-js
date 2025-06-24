#!/usr/bin/env node
/**
 * HCS-12 HashLinks Complete Demo
 *
 * This script demonstrates the complete HashLinks workflow:
 * 1. Build and compile Rust WASM module
 * 2. Extract INFO from the WASM module (per HCS-12 standard)
 * 3. Inscribe the WASM module via HCS-1
 * 4. Register the action with the INFO hash
 * 5. Register blocks
 * 6. Create assembly using incremental approach
 */

import dotenv from 'dotenv';
import { Logger } from '../../src/utils/logger';
import type { NetworkType } from '../../src/utils/types';
import { inscribe } from '../../src/inscribe';
import { HCS12Client } from '../../src/hcs-12/sdk';
import { RegistryType } from '../../src/hcs-12/types';
import {
  ActionBuilder,
  BlockBuilder,
  AssemblyBuilder,
} from '../../src/hcs-12/builders';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

dotenv.config();

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NETWORK: NetworkType = 'testnet';
const WASM_DIR = path.join(__dirname, 'rust-wasm');
const WASM_FILE = path.join(WASM_DIR, 'pkg', 'hashlink_counter_bg.wasm');
const JS_FILE = path.join(WASM_DIR, 'pkg', 'hashlink_counter.js');

async function buildWasmModule(logger: Logger): Promise<void> {
  logger.info('Building Rust WASM module...');

  try {
    await execAsync('rustc --version');
    await execAsync('wasm-pack --version');
  } catch (error) {
    logger.error('Rust or wasm-pack not installed. Please install them first:');
    logger.error('- Install Rust: https://rustup.rs/');
    logger.error('- Install wasm-pack: cargo install wasm-pack');
    throw error;
  }

  const { stdout, stderr } = await execAsync(
    'wasm-pack build --target web --out-dir pkg',
    {
      cwd: WASM_DIR,
    },
  );

  if (stderr && !stderr.includes('warning')) {
    logger.warn('Build warnings:', { stderr });
  }

  logger.info('WASM module built successfully');
}

async function inscribeWasmModule(
  wasmBuffer: Buffer,
  logger: Logger,
  operatorId: string,
  operatorKey: string,
): Promise<{ topicId: string; wasmHash: string }> {
  logger.info('Inscribing WASM module via HCS-1...');

  const wasmHash = createHash('sha256').update(wasmBuffer).digest('hex');

  const response = await inscribe(
    {
      type: 'buffer',
      buffer: wasmBuffer,
      fileName: 'counter-module.wasm',
      mimeType: 'application/wasm',
    },
    {
      accountId: operatorId,
      privateKey: operatorKey,
      network: 'testnet',
    },
    {
      mode: 'file',
      metadata: {
        name: 'counter-module.wasm',
        description: 'HCS-12 Counter Module',
        hash: wasmHash,
      },
      waitForConfirmation: true,
    },
  );

  if (!response.confirmed || !response.inscription.topic_id) {
    throw new Error('Failed to inscribe WASM module');
  }

  const topicId = response.inscription.topic_id;
  logger.info('WASM module inscribed', { topicId, wasmHash });

  return { topicId, wasmHash };
}

async function inscribeJsWrapper(
  jsBuffer: Buffer,
  logger: Logger,
  operatorId: string,
  operatorKey: string,
): Promise<{ topicId: string; jsHash: string }> {
  logger.info('Inscribing JavaScript wrapper via HCS-1...');

  const jsHash = createHash('sha256').update(jsBuffer).digest('hex');

  const response = await inscribe(
    {
      type: 'buffer',
      buffer: jsBuffer,
      fileName: 'counter-module.js',
      mimeType: 'application/javascript',
    },
    {
      accountId: operatorId,
      privateKey: operatorKey,
      network: 'testnet',
    },
    {
      mode: 'file',
      metadata: {
        name: 'counter-module.js',
        description: 'HCS-12 Counter Module JavaScript Wrapper',
        hash: jsHash,
      },
      waitForConfirmation: true,
    },
  );

  if (!response.confirmed || !response.inscription.topic_id) {
    throw new Error('Failed to inscribe JavaScript wrapper');
  }

  const topicId = response.inscription.topic_id;
  logger.info('JavaScript wrapper inscribed', { topicId, jsHash });

  return { topicId, jsHash };
}

/**
 * Extract module INFO from the WASM module itself
 *
 * According to HCS-12 standard, the WASM module must export an INFO method
 * that returns the module metadata. This ensures the hash in the action
 * registration can be verified by loading and calling the WASM module.
 */
async function getModuleInfoFromWasm(
  wasmPath: string,
  jsPath: string,
  logger: Logger,
): Promise<{ info: string; hash: string }> {
  logger.info('Loading WASM module with JavaScript wrapper...');

  try {
    // Read the WASM binary
    const wasmBuffer = await fs.readFile(wasmPath);

    // Dynamic import the JavaScript wrapper
    const jsModulePath = path.resolve(jsPath);
    const wasmModule = await import(jsModulePath);

    // Initialize the WASM module using initSync with the buffer
    wasmModule.initSync(wasmBuffer);

    // Create an instance of WasmInterface
    const wasmInterface = new wasmModule.WasmInterface();

    // Call the INFO method
    const infoString = wasmInterface.INFO();

    // Calculate hash
    const hash = createHash('sha256').update(infoString).digest('hex');

    logger.info('Module INFO extracted from WASM', {
      infoLength: infoString.length,
      hash,
    });

    // Clean up
    wasmInterface.free();

    return { info: infoString, hash };
  } catch (error) {
    logger.error('Failed to extract INFO from WASM module', { error });
    throw new Error(`Failed to load WASM module: ${error}`);
  }
}

async function main() {
  const logger = new Logger({
    module: 'HCS12-Demo',
    level: 'debug',
    prettyPrint: true,
  });

  try {
    logger.info('Starting HCS-12 HashLinks Demo');

    if (!process.env.HEDERA_ACCOUNT_ID || !process.env.HEDERA_PRIVATE_KEY) {
      throw new Error(
        'HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY environment variables must be set',
      );
    }

    const operatorId = process.env.HEDERA_ACCOUNT_ID;
    const operatorKey = process.env.HEDERA_PRIVATE_KEY;

    const client = new HCS12Client({
      network: NETWORK,
      operatorId,
      operatorPrivateKey: operatorKey,
      logger,
    });

    /**
     * Step 1: Create registry topics
     */
    logger.info('Creating registry topics...');

    const actionTopicId = await client.createRegistryTopic(RegistryType.ACTION);
    logger.info('Action registry topic created', { actionTopicId });

    const assemblyTopicId = await client.createRegistryTopic(
      RegistryType.ASSEMBLY,
    );
    logger.info('Assembly registry topic created', { assemblyTopicId });

    client.initializeRegistries({
      action: actionTopicId,
      assembly: assemblyTopicId,
    });

    /**
     * Step 2: Build and inscribe WASM module
     */
    await buildWasmModule(logger);

    const wasmBuffer = await fs.readFile(WASM_FILE);
    logger.info('WASM module loaded', { size: wasmBuffer.length });

    const jsBuffer = await fs.readFile(JS_FILE);
    logger.info('JavaScript wrapper loaded', { size: jsBuffer.length });

    const [{ topicId: wasmTopicId, wasmHash }, { topicId: jsTopicId, jsHash }] =
      await Promise.all([
        inscribeWasmModule(wasmBuffer, logger, operatorId, operatorKey),
        inscribeJsWrapper(jsBuffer, logger, operatorId, operatorKey),
      ]);

    /**
     * Step 3: Extract INFO from WASM and register action using ActionBuilder
     */
    const { info, hash: infoHash } = await getModuleInfoFromWasm(
      WASM_FILE,
      JS_FILE,
      logger,
    );

    const actionBuilder = new ActionBuilder(logger)
      .setTopicId(wasmTopicId)
      .setHash(infoHash)
      .setWasmHash(wasmHash)
      .setJsTopicId(jsTopicId)
      .setJsHash(jsHash)
      .setInterfaceVersion('0.2.0')
      .setAlias('counter-module');

    await client.registerAction(actionBuilder);
    logger.info('Action registered using builder', {
      actionTopicId: wasmTopicId,
      infoHash,
    });

    /**
     * Step 4: Create blocks using BlockBuilder
     */
    logger.info('Creating blocks using BlockBuilder...');

    // Load templates
    const counterTemplatePath = path.join(
      __dirname,
      'counter-block-template.html',
    );
    const counterTemplateContent = await fs.readFile(
      counterTemplatePath,
      'utf-8',
    );

    // Create Counter Block using builder
    const counterBlockBuilder = BlockBuilder.createInteractiveBlock(
      'hashlink/counter-display',
      'Counter Display',
    )
      .setDescription('Displays counter with increment/decrement controls')
      .setIcon('calculator')
      .setKeywords(['counter', 'increment', 'decrement'])
      .addAttribute('count', 'number', 0)
      .addAttribute('step', 'number', 1);

    counterBlockBuilder
      .setTemplate(Buffer.from(counterTemplateContent))
      .addAction('increment', wasmTopicId)
      .addAction('decrement', wasmTopicId)
      .addAction('reset', wasmTopicId);

    await client.registerBlock(counterBlockBuilder);

    logger.info('Counter block created', {
      blockTopicId: counterBlockBuilder.getTopicId(),
    });

    // Create Stats Block using builder
    const statsTemplatePath = path.join(__dirname, 'stats-block-template.html');
    const statsTemplateContent = await fs.readFile(statsTemplatePath, 'utf-8');

    const statsBlockBuilder = BlockBuilder.createDisplayBlock(
      'hashlink/stats-display',
      'Statistics Display',
    )
      .setDescription('Displays statistics in a grid layout')
      .setIcon('chart-bar')
      .setKeywords(['stats', 'statistics', 'metrics'])
      .addAttribute('title', 'string', 'Statistics')
      .addAttribute('values', 'array', []);

    statsBlockBuilder.setTemplate(Buffer.from(statsTemplateContent));

    await client.registerBlock(statsBlockBuilder);

    logger.info('Stats block created', {
      blockTopicId: statsBlockBuilder.getTopicId(),
    });

    // Create Container Block using builder
    const containerTemplatePath = path.join(
      __dirname,
      'container-block-template.html',
    );
    const containerTemplateContent = await fs.readFile(
      containerTemplatePath,
      'utf-8',
    );

    const containerBlockBuilder = BlockBuilder.createContainerBlock(
      'hashlink/container-block',
      'Container Block',
    )
      .setDescription(
        'Container that can include other blocks using data-hashlink',
      )
      .setIcon('layout')
      .setKeywords(['container', 'layout', 'nested', 'composite'])
      .addAttribute('title', 'string', 'Container Block')
      .addAttribute('description', 'string', '')
      .addAttribute('showCounter', 'boolean', true)
      .addAttribute('showStats', 'boolean', true)
      .addAttribute('counterBlockId', 'string', '')
      .addAttribute('statsBlockId', 'string', '')
      .addAttribute('counterActionId', 'string', '')
      .addAttribute('initialCount', 'number', 10)
      .addAttribute('counterStep', 'number', 5)
      .addAttribute(
        'statsValues',
        'string',
        '[{"label": "Total Clicks", "value": 0}, {"label": "Active Blocks", "value": 2}]',
      );

    containerBlockBuilder
      .addAttribute(
        'counterBlockId',
        'string',
        counterBlockBuilder.getTopicId(),
      )
      .addAttribute('statsBlockId', 'string', statsBlockBuilder.getTopicId())
      .setTemplate(Buffer.from(containerTemplateContent))
      .addAction('toggleCounter', wasmTopicId)
      .addAction('toggleStats', wasmTopicId);

    await client.registerBlock(containerBlockBuilder);

    logger.info('Container block created', {
      blockTopicId: containerBlockBuilder.getTopicId(),
    });

    /**
     * Step 5: Create assemblies using AssemblyBuilder
     */
    logger.info('Creating assemblies...');

    // Create Simple Assembly (just counter)
    logger.info('Creating simple counter assembly...');
    const simpleAssemblyBuilder = new AssemblyBuilder(logger)
      .setName('simple-counter-app')
      .setVersion('1.0.0')
      .setDescription('Simple counter demo with a single block')
      .setAuthor(operatorId)
      .setTags(['demo', 'counter', 'simple'])
      .addAction(actionBuilder)
      .addBlock(counterBlockBuilder);

    // Validate before creating
    let validation = simpleAssemblyBuilder.validate();
    if (!validation.valid) {
      throw new Error(
        `Simple assembly validation failed: ${validation.errors.join(', ')}`,
      );
    }

    const simpleAssemblyTopicId = await client.createAssembly(simpleAssemblyBuilder);
    logger.info('Simple assembly created', { simpleAssemblyTopicId });

    // Create Nested Blocks Assembly
    logger.info('Creating nested blocks assembly...');
    const nestedAssemblyBuilder = new AssemblyBuilder(logger)
      .setName('nested-blocks-app')
      .setVersion('1.0.0')
      .setDescription('Nested blocks demo showing container with child blocks')
      .setAuthor(operatorId)
      .setTags(['demo', 'nested', 'container', 'hashlinks'])
      .addAction(actionBuilder)
      .addBlock(counterBlockBuilder)
      .addBlock(statsBlockBuilder)
      .addBlock(containerBlockBuilder);

    // Validate before creating
    validation = nestedAssemblyBuilder.validate();
    if (!validation.valid) {
      throw new Error(
        `Nested assembly validation failed: ${validation.errors.join(', ')}`,
      );
    }

    const nestedAssemblyTopicId = await client.createAssembly(nestedAssemblyBuilder);
    logger.info('Nested blocks assembly created', { nestedAssemblyTopicId });

    /**
     * Step 6: Load and validate both assemblies
     */
    logger.info('Waiting 5 seconds for mirror node to sync...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Load simple assembly
    const simpleAssembly = await client.loadAssembly(simpleAssemblyTopicId);

    logger.info('Simple assembly object:', {
      hasAssembly: !!simpleAssembly,
      hasState: !!(simpleAssembly && simpleAssembly.state),
      assemblyKeys: simpleAssembly ? Object.keys(simpleAssembly) : [],
    });

    if (!simpleAssembly || !simpleAssembly.state) {
      throw new Error('Failed to load simple assembly or assembly state is missing');
    }

    logger.info('Loaded simple assembly', {
      topicId: simpleAssembly.topicId,
      name: simpleAssembly.state.name,
      blocks: simpleAssembly.state.blocks.length,
    });

    // Load nested assembly
    const nestedAssembly = await client.loadAssembly(nestedAssemblyTopicId);

    logger.info('Nested assembly object:', {
      hasAssembly: !!nestedAssembly,
      hasState: !!(nestedAssembly && nestedAssembly.state),
      assemblyKeys: nestedAssembly ? Object.keys(nestedAssembly) : [],
    });

    if (!nestedAssembly || !nestedAssembly.state) {
      throw new Error('Failed to load nested assembly or assembly state is missing');
    }

    logger.info('Loaded nested assembly', {
      topicId: nestedAssembly.topicId,
      name: nestedAssembly.state.name,
      blocks: nestedAssembly.state.blocks.length,
    });

    logger.info('Demo completed successfully!');

    // Log topic IDs clearly for HTML demo
    console.log('\n=== TOPIC IDS FOR HTML DEMO ===');
    console.log(`Action Registry: ${actionTopicId}`);
    console.log(`Assembly Registry: ${assemblyTopicId}`);
    console.log('\n--- Assembly Topic IDs ---');
    console.log(`Simple Counter Assembly: ${simpleAssemblyTopicId}`);
    console.log(`Nested Blocks Assembly: ${nestedAssemblyTopicId}`);
    console.log('\n--- Block Topic IDs ---');
    console.log(`Counter Block: ${counterBlockBuilder.getTopicId()}`);
    console.log(`Stats Block: ${statsBlockBuilder.getTopicId()}`);
    console.log(`Container Block: ${containerBlockBuilder.getTopicId()}`);
    console.log('\n--- Action Topic IDs ---');
    console.log(`WASM Module: ${wasmTopicId}`);
    console.log(`JS Wrapper: ${jsTopicId}`);
    console.log('===============================\n');

    logger.info('Summary:', {
      wasmTopicId,
      wasmHash,
      infoHash,
      actionRegistryTopic: actionTopicId,
      counterBlockTopic: counterBlockBuilder.getTopicId(),
      statsBlockTopic: statsBlockBuilder.getTopicId(),
      containerBlockTopic: containerBlockBuilder.getTopicId(),
      simpleAssemblyTopic: simpleAssemblyTopicId,
      nestedAssemblyTopic: nestedAssemblyTopicId,
      network: NETWORK,
    });

    logger.info('Next steps:');
    logger.info('1. Use either assembly topic ID to load in the browser demo');
    logger.info('   - Simple assembly for basic counter functionality');
    logger.info('   - Nested assembly for container with multiple blocks');
    logger.info('2. Execute actions through the WASM interface');
    logger.info('3. Deploy to mainnet when ready');
  } catch (error) {
    logger.error('Demo failed:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      error: error,
    });
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

main().catch(console.error);
