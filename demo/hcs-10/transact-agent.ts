import dotenv from 'dotenv';
import { HCS10Client, HCSMessage, Logger, ConnectionsManager } from '../../src';
import { extractAllText, getOrCreateBob, monitorTopics } from './utils.js';
import {
  getAllHederaCorePlugins,
  HederaConversationalAgent,
  ServerSigner,
} from 'hedera-agent-kit';
import { ScheduleCreateTransaction } from '@hashgraph/sdk';

const logger = new Logger({
  module: 'BobPollingAgent',
  level: 'debug',
  prettyPrint: true,
});

dotenv.config();

const isJson = (str: string): boolean => {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
};

function extractAccountId(operatorId: string): string | null {
  if (!operatorId) return null;
  const parts = operatorId.split('@');
  return parts.length === 2 ? parts[1] : null;
}

async function handleConnectionRequest(
  agent: {
    client: HCS10Client;
    accountId: string;
    operatorId: string;
    inboundTopicId: string;
    outboundTopicId: string;
  },
  message: HCSMessage,
  connectionManager: ConnectionsManager,
): Promise<string | null> {
  if (!message.operator_id) {
    logger.warn('Missing operator_id in connection request');
    return null;
  }
  if (!message.created) {
    logger.warn('Missing created timestamp in connection request');
    return null;
  }
  if (
    typeof message.sequence_number !== 'number' ||
    message.sequence_number <= 0
  ) {
    logger.warn(
      `Invalid sequence_number in connection request: ${message.sequence_number}`,
    );
    return null;
  }

  const requesterOperatorId = message.operator_id;
  const requesterAccountId = extractAccountId(requesterOperatorId);
  if (!requesterAccountId) {
    logger.warn(`Invalid operator_id format: ${requesterOperatorId}`);
    return null;
  }

  logger.info(
    `Processing connection request #${message.sequence_number} from ${requesterOperatorId}`,
  );

  // Look for any existing connection for this sequence number
  let existingConnection;
  for (const conn of connectionManager.getAllConnections()) {
    if (conn.inboundRequestId === message.sequence_number) {
      existingConnection = conn;
      break;
    }
  }

  if (existingConnection) {
    // Make sure we have a valid topic ID, not a reference key
    if (
      existingConnection.connectionTopicId.match(/^[0-9]+\.[0-9]+\.[0-9]+$/)
    ) {
      logger.warn(
        `Connection already exists for request #${message.sequence_number} from ${requesterOperatorId}. Topic: ${existingConnection.connectionTopicId}`,
      );
      return existingConnection.connectionTopicId;
    } else {
      logger.warn(
        `Connection exists for request #${message.sequence_number} but has invalid topic ID format: ${existingConnection.connectionTopicId}`,
      );
    }
  }

  try {
    const { connectionTopicId, confirmedConnectionSequenceNumber } =
      await agent.client.handleConnectionRequest(
        agent.inboundTopicId,
        requesterAccountId,
        message.sequence_number,
      );

    await connectionManager.fetchConnectionData(agent.accountId);

    await agent.client.sendMessage(
      connectionTopicId,
      `Hello! I'm the transact agent, your friendly Hedera agent! 🤖
      I can help you create transactions on Hedera.`,
    );

    logger.info(
      `Connection established with ${requesterOperatorId} on topic ${connectionTopicId}`,
    );
    return connectionTopicId;
  } catch (error) {
    logger.error(
      `Error handling connection request #${message.sequence_number} from ${requesterOperatorId}: ${error}`,
    );
    return null;
  }
}

async function handleStandardMessage(
  agent: {
    client: HCS10Client;
    accountId: string;
    operatorId: string;
  },
  message: HCSMessage,
  connectionTopicId: string,
): Promise<void> {
  if (message.data === undefined) {
    return;
  }

  if (
    !connectionTopicId ||
    !connectionTopicId.match(/^[0-9]+\.[0-9]+\.[0-9]+$/)
  ) {
    logger.error(`Invalid connection topic ID format: ${connectionTopicId}`);
    return;
  }

  let rawContent: string = message.data;

  if (rawContent.startsWith('hcs://')) {
    try {
      const content = await agent.client.getMessageContent(rawContent);
      rawContent = content as string;
    } catch (error) {
      logger.error(`Failed to resolve message content: ${error}`);
      return;
    }
  }
  const agentSigner = new ServerSigner(
    process.env.HEDERA_ACCOUNT_ID!,
    process.env.HEDERA_PRIVATE_KEY!,
    'testnet',
  );

  let messageContent = rawContent;

  if (isJson(rawContent)) {
    try {
      const parsed = JSON.parse(rawContent);
      const extracted = extractAllText(parsed);
      if (extracted.trim()) {
        messageContent = extracted;
        logger.debug(
          `Extracted from JSON: "${messageContent}" (original: "${rawContent.substring(
            0,
            50,
          )}${rawContent.length > 50 ? '...' : ''}")`,
        );
      }
    } catch {
      messageContent = rawContent;
    }
  }

  if (!message.operator_id) {
    logger.error(`Missing operator_id in message: ${message}`);
    return;
  }

  const userAccountId = extractAccountId(message.operator_id);

  if (!userAccountId) {
    logger.error(`Invalid operator_id format: ${message.operator_id}`);
    return;
  }

  const hederaAgent = new HederaConversationalAgent(agentSigner, {
    operationalMode: 'returnBytes',
    userAccountId,
    verbose: false,
    openAIApiKey: process.env.OPENAI_API_KEY!,
    scheduleUserTransactionsInBytesMode: false,
    pluginConfig: {
      plugins: getAllHederaCorePlugins()
    }
  });
  await hederaAgent.initialize();

  logger.info('sending message to agent to make bytes', messageContent);

  const response = await hederaAgent.processMessage(messageContent);

  try {
    logger.info(`Sending response to topic ${connectionTopicId}`);

    if (response.output && !response?.transactionBytes) {
      await agent.client.sendMessage(
        connectionTopicId,
        `[Reply to #${message.sequence_number}] ${response.output}`,
      );
    }

    if (response.notes && !response?.transactionBytes) {
      const formattedNotes = response.notes.map(note => `- ${note}`).join('\n');
      const inferenceMessage =
        "I've made some inferences based on your prompt. If this isn't what you expected, please try a more refined prompt.";
      await agent.client.sendMessage(
        connectionTopicId,
        `[Reply to #${message.sequence_number}]\n${inferenceMessage}\n${formattedNotes}`,
      );
    }

    if (response.transactionBytes) {
      const transaction = ScheduleCreateTransaction.fromBytes(
        Buffer.from(response.transactionBytes || '', 'base64'),
      );

      let reply = `[Reply to #${message.sequence_number}]`;
      if (response?.notes?.length && response?.notes?.length > 0) {
        const inferenceMessage =
          "I've made some inferences based on your prompt. If this isn't what you expected, please try a more refined prompt.";
        const formattedNotes = response.notes
          .map(note => `- ${note}`)
          .join('\n');
        reply += `\n${inferenceMessage}\n${formattedNotes}`;
      }

      const schedulePayerAccountId = extractAccountId(message.operator_id);

      await agent.client.sendTransaction(
        connectionTopicId,
        transaction,
        reply,
        { schedulePayerAccountId: schedulePayerAccountId || undefined },
      );
    }
  } catch (error) {
    console.error(error);
    logger.error(
      `Failed to send response to topic ${connectionTopicId}: ${error}`,
    );
  }
}

async function main() {
  try {
    const registryUrl = process.env.REGISTRY_URL;
    logger.info(`Using registry URL: ${registryUrl}`);

    if (!process.env.HEDERA_ACCOUNT_ID || !process.env.HEDERA_PRIVATE_KEY) {
      throw new Error(
        'HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY environment variables must be set',
      );
    }

    const baseClient = new HCS10Client({
      network: 'testnet',
      operatorId: process.env.HEDERA_ACCOUNT_ID,
      operatorPrivateKey: process.env.HEDERA_PRIVATE_KEY,
      guardedRegistryBaseUrl: registryUrl,
      prettyPrint: true,
      logLevel: 'debug',
    });

    const bob = await getOrCreateBob(logger, baseClient);

    if (!bob) {
      throw new Error('Failed to set up Bob agent with required topics');
    }

    const agentData = {
      client: bob.client,
      accountId: bob.accountId,
      operatorId: `${bob.inboundTopicId}@${bob.accountId}`,
      inboundTopicId: bob.inboundTopicId,
      outboundTopicId: bob.outboundTopicId,
    };

    logger.info('===== BOB POLLING AGENT DETAILS =====');
    logger.info(`Account ID: ${agentData.accountId}`);
    logger.info(`Operator ID: ${agentData.operatorId}`);
    logger.info(`Inbound Topic: ${agentData.inboundTopicId}`);
    logger.info(`Outbound Topic: ${agentData.outboundTopicId}`);
    logger.info('=====================================');

    await monitorTopics(
      logger,
      handleConnectionRequest,
      handleStandardMessage,
      message => Boolean(message?.data?.includes('transact:')),
      agentData,
    );
  } catch (error) {
    logger.error(`Error in main function: ${error}`);
  }
}

main();
