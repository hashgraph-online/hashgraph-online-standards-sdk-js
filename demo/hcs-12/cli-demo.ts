#!/usr/bin/env node
/**
 * HCS-12 HashLinks End-to-End CLI Demo
 *
 * This script demonstrates the complete HashLinks workflow:
 * 1. Build and compile Rust WASM module
 * 2. Inscribe the WASM module via HCS-1
 * 3. Register the action in HCS-12 registry using real Hedera SDK
 * 4. Create and register blocks
 * 5. Create and register an assembly
 * 6. Execute the complete HashLink
 */

import dotenv from 'dotenv';
import { Logger } from '../../src/utils/logger';
import type { NetworkType } from '../../src/utils/types';
import { inscribe } from '../../src/inscribe';
import { HCS12Client } from '../../src/hcs-12/sdk';
import {
  ActionRegistration,
  BlockRegistration,
  AssemblyRegistration,
} from '../../src/hcs-12/types';
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

  if (stderr) {
    logger.warn('Build warnings:', { stderr });
  }

  logger.info('WASM module built successfully', { output: stdout });
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

/**
 * Extract module INFO from the WASM module itself
 *
 * According to HCS-12 standard, the WASM module must export an INFO method
 * that returns the module metadata. This ensures the hash in the action
 * registration can be verified by loading and calling the WASM module.
 */
async function getModuleInfoFromWasm(
  wasmPath: string,
  logger: Logger,
): Promise<{ info: string; hash: string }> {
  logger.info('Loading WASM module to extract INFO...');

  try {
    const wasmModule = await import(
      path.join(WASM_DIR, 'pkg', 'hashlink_counter.js')
    );

    await wasmModule.default();

    const wasmInterface = new wasmModule.WasmInterface();

    const infoString = wasmInterface.INFO();

    const hash = createHash('sha256').update(infoString).digest('hex');

    logger.info('Module INFO extracted from WASM', {
      infoLength: infoString.length,
      hash,
    });

    return { info: infoString, hash };
  } catch (error) {
    logger.error('Failed to extract INFO from WASM module', { error });
    throw new Error(`Failed to load WASM module: ${error}`);
  }
}

async function registerAction(
  client: HCS12Client,
  wasmTopicId: string,
  wasmHash: string,
  infoHash: string,
  logger: Logger,
): Promise<string> {
  logger.info('Registering action in HCS-12 registry...');

  const registration: ActionRegistration = {
    p: 'hcs-12',
    op: 'register',
    t_id: wasmTopicId,
    hash: infoHash,
    wasm_hash: wasmHash,
    m: 'Counter Module v1.0.0',
  };

  const actionHash = await client.actionRegistry!.register(registration);

  logger.info('Action registered successfully', {
    actionHash,
    wasmTopicId,
    wasmHash,
    infoHash,
  });

  return actionHash;
}

async function createAndRegisterBlock(
  client: HCS12Client,
  logger: Logger,
): Promise<string> {
  logger.info('Creating and registering block...');

  const blockDefinition = {
    name: 'counter-display',
    title: 'Counter Display Block',
    description: 'Displays the current counter value with controls',
    icon: 'calculator',
    category: 'widgets',
    keywords: ['counter', 'display'],
    attributes: {
      count: {
        type: 'number',
        default: 0,
        description: 'Current counter value',
      },
    },
    supports: {
      html: false,
      multiple: true,
      reusable: true,
      lock: false,
    },
    template: `
      <div class="counter-block">
        <h2>Counter: {{attributes.count}}</h2>
        <div class="controls">
          <button class="increment-btn">Increment</button>
          <button class="decrement-btn">Decrement</button>
          <button class="reset-btn">Reset</button>
        </div>
      </div>
    `,
    styles: `
      .counter-block {
        padding: 20px;
        border: 1px solid #ccc;
        border-radius: 8px;
        text-align: center;
      }
      .controls {
        margin-top: 10px;
      }
      .controls button {
        margin: 0 5px;
        padding: 8px 16px;
        background: #007bff;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }
      .controls button:hover {
        background: #0056b3;
      }
    `,
  };

  const registration: BlockRegistration = {
    p: 'hcs-12',
    op: 'register',
    name: blockDefinition.name,
    title: blockDefinition.title,
    description: blockDefinition.description,
    icon: blockDefinition.icon,
    category: blockDefinition.category,
    keywords: blockDefinition.keywords,
    attributes: blockDefinition.attributes,
    supports: blockDefinition.supports,
    template: blockDefinition.template,
    styles: blockDefinition.styles,
    version: '1.0.0',
    m: 'Counter Display Block v1.0.0',
  };

  const blockHash = await client.blockRegistry!.register(registration);

  logger.info('Block registered successfully', {
    blockId: blockDefinition.name,
    blockHash,
  });

  return blockDefinition.name;
}

async function createAndRegisterAssembly(
  client: HCS12Client,
  actionHash: string,
  blockId: string,
  logger: Logger,
): Promise<string> {
  logger.info('Creating and registering assembly...');

  const assemblyDefinition = {
    name: 'counter-app',
    title: 'Counter Application',
    description: 'Complete counter application with UI and actions',
    version: '1.0.0',
    actions: [
      {
        id: 'counter-action',
        hash: actionHash,
        name: 'Counter Module',
      },
    ],
    blocks: [
      {
        id: 'counter-display',
        name: blockId,
        position: { x: 0, y: 0 },
        config: {
          initialCount: 0,
        },
      },
    ],
    bindings: [
      {
        sourceBlock: 'counter-display',
        sourceEvent: 'increment',
        targetAction: 'counter-action',
        targetMethod: 'increment',
        parameters: {
          amount: 1,
          count: '{{count}}',
        },
      },
      {
        sourceBlock: 'counter-display',
        sourceEvent: 'decrement',
        targetAction: 'counter-action',
        targetMethod: 'decrement',
        parameters: {
          amount: 1,
          count: '{{count}}',
        },
      },
      {
        sourceBlock: 'counter-display',
        sourceEvent: 'reset',
        targetAction: 'counter-action',
        targetMethod: 'reset',
        parameters: {},
      },
    ],
    layout: {
      type: 'single',
      orientation: 'vertical',
    },
  };

  const registration: AssemblyRegistration = {
    p: 'hcs-12',
    op: 'register',
    name: assemblyDefinition.name,
    title: assemblyDefinition.title,
    description: assemblyDefinition.description,
    version: assemblyDefinition.version,
    actions: assemblyDefinition.actions,
    blocks: assemblyDefinition.blocks,
    bindings: assemblyDefinition.bindings,
    layout: assemblyDefinition.layout,
    m: 'Counter Application v1.0.0',
  };

  const assemblyHash = await client.assemblyRegistry!.register(registration);

  logger.info('Assembly registered successfully', {
    assemblyId: assemblyDefinition.name,
    assemblyHash,
  });

  return assemblyDefinition.name;
}

async function main() {
  const logger = new Logger({
    module: 'HCS12-CLI-Demo',
    level: 'debug',
    prettyPrint: true,
  });

  try {
    logger.info('Starting HCS-12 HashLinks End-to-End Demo');

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

    client.initializeRegistries();

    await buildWasmModule(logger);

    const wasmBuffer = await fs.readFile(WASM_FILE);
    logger.info('WASM module loaded', { size: wasmBuffer.length });

    const { topicId: wasmTopicId, wasmHash } = await inscribeWasmModule(
      wasmBuffer,
      logger,
      operatorId,
      operatorKey,
    );

    const { info, hash: infoHash } = await getModuleInfoFromWasm(
      WASM_FILE,
      logger,
    );
    logger.info('Module info extracted from WASM', { infoHash });

    const actionHash = await registerAction(
      client,
      wasmTopicId,
      wasmHash,
      infoHash,
      logger,
    );

    const blockId = await createAndRegisterBlock(client, logger);

    const assemblyId = await createAndRegisterAssembly(
      client,
      actionHash,
      blockId,
      logger,
    );

    logger.info('Demo completed successfully!');
    logger.info('Summary:', {
      wasmTopicId,
      wasmHash,
      infoHash,
      actionHash,
      blockId,
      assemblyId,
      network: NETWORK,
    });

    logger.info('Next steps:');
    logger.info('1. Use the assemblyId to load and execute the HashLink');
    logger.info('2. Integrate with a browser client for UI rendering');
    logger.info('3. Deploy to mainnet for production use');
  } catch (error) {
    logger.error('Demo failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);
