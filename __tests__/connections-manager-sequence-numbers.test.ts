import { ConnectionsManager } from '../src/hcs-10/connections-manager';
import { HCSMessage, HCS10BaseClient } from '../src/hcs-10/base-client';
import { AIAgentCapability, AIAgentProfile } from '../src';
import { TopicInfo } from '../src/services/types';

class MockHCS10Client implements HCS10BaseClient {
  async submitPayload() {
    return { topicSequenceNumber: { toNumber: () => 123 } };
  }

  async getMessages(topicId: string): Promise<{ messages: HCSMessage[] }> {
    if (!this.isValidTopicId(topicId)) {
      throw new Error(`Invalid topic ID: ${topicId}`);
    }
    return { messages: this.mockMessages[topicId] || [] };
  }

  isValidTopicId(topicId: string): boolean {
    return !!topicId && !topicId.includes(':') && /^0\.0\.\d+$/.test(topicId);
  }

  mockMessages: Record<string, HCSMessage[]> = {};

  setMockMessages(topicId: string, messages: HCSMessage[]) {
    this.mockMessages[topicId] = messages;
  }

  getAccountAndSigner() {
    return { accountId: '0.0.123456', signer: null };
  }

  public extractTopicFromOperatorId(operatorId: string): string {
    if (!operatorId || !operatorId.includes('@')) {
      return '';
    }
    const parts = operatorId.split('@');
    return parts[0] || '';
  }

  public extractAccountFromOperatorId(operatorId: string): string {
    if (!operatorId || !operatorId.includes('@')) {
      return '';
    }
    const parts = operatorId.split('@');
    return parts[1] || '';
  }

  async retrieveCommunicationTopics(accountId: string): Promise<TopicInfo> {
    return {
      inboundTopic: '0.0.100002',
      outboundTopic: '0.0.100001',
      profileTopicId: '0.0.100003',
    };
  }

  async retrieveProfile(accountId: string) {
    return {
      success: true,
      profile: {
        display_name: `Agent ${accountId}`,
        inboundTopicId: `0.0.${accountId.split('.').pop()}IN`,
        outboundTopicId: `0.0.${accountId.split('.').pop()}OUT`,
        type: 1,
        version: '1.0',
      },
    };
  }

  async confirmConnection(): Promise<void> {
    return;
  }

  async fetchProfile(): Promise<AIAgentProfile> {
    return {
      alias: 'agent',
      display_name: 'Agent 123456',
      bio: 'Agent 123456',
      type: 1,
      version: '1.0',
      aiAgent: {
        model: 'gpt-4o',
        capabilities: [AIAgentCapability.API_INTEGRATION],
        type: 1,
      },
    };
  }
}

describe('ConnectionsManager - Sequence Number Uniqueness', () => {
  let manager: ConnectionsManager;
  let mockClient: MockHCS10Client;
  const mockAccountId = '0.0.123456';

  beforeEach(() => {
    mockClient = new MockHCS10Client();
    manager = new ConnectionsManager({
      baseClient: mockClient,
      logLevel: 'error',
    });
  });

  describe('outbound requests with same sequence numbers', () => {
    it('should correctly handle multiple outbound requests with the same sequence number but different topics', async () => {
      const outboundMessagesAgent1: HCSMessage[] = [
        {
          p: 'hcs-10',
          op: 'connection_request',
          connection_request_id: 1,
          operator_id: '0.0.111000@0.0.654321',
          outbound_topic_id: '0.0.222222',
          sequence_number: 1,
          created: new Date('2023-01-01'),
          payer: mockAccountId,
          data: '',
        },
      ];

      const outboundMessagesAgent2: HCSMessage[] = [
        {
          p: 'hcs-10',
          op: 'connection_request',
          connection_request_id: 1,
          operator_id: '0.0.222000@0.0.765432',
          outbound_topic_id: '0.0.222222',
          sequence_number: 1,
          created: new Date('2023-01-01'),
          payer: mockAccountId,
          data: '',
        },
      ];

      manager.processOutboundMessages(outboundMessagesAgent1, mockAccountId);
      manager.processOutboundMessages(outboundMessagesAgent2, mockAccountId);

      const pendingConnections = Array.from(
        manager['connections'].values(),
      ).filter(conn => conn.status === 'pending');

      expect(pendingConnections.length).toBe(2);

      const targetAccounts = pendingConnections.map(
        conn => conn.targetAccountId,
      );
      expect(targetAccounts).toContain('0.0.654321');
      expect(targetAccounts).toContain('0.0.765432');

      const keys = Array.from(manager['connections'].keys());
      expect(keys).toContain('req-1:0.0.111000@0.0.654321');
      expect(keys).toContain('req-1:0.0.222000@0.0.765432');
    });

    it('should not delete one pending connection when processing confirmation for another connection with same sequence number', () => {
      const request1: HCSMessage = {
        p: 'hcs-10',
        op: 'connection_request',
        connection_request_id: 1,
        operator_id: '0.0.111000@0.0.654321',
        outbound_topic_id: '0.0.222222',
        sequence_number: 1,
        created: new Date('2023-01-01'),
        payer: mockAccountId,
        data: '',
      };

      const request2: HCSMessage = {
        p: 'hcs-10',
        op: 'connection_request',
        connection_request_id: 1,
        operator_id: '0.0.222000@0.0.765432',
        outbound_topic_id: '0.0.222222',
        sequence_number: 1,
        created: new Date('2023-01-01'),
        payer: mockAccountId,
        data: '',
      };

      manager.processOutboundMessages([request1, request2], mockAccountId);

      const confirmation: HCSMessage = {
        p: 'hcs-10',
        op: 'connection_created',
        connection_request_id: 1,
        connection_topic_id: '0.0.333333',
        confirmed_request_id: 456,
        outbound_topic_id: '0.0.222222',
        operator_id: '0.0.111000@0.0.654321',
        sequence_number: 2,
        created: new Date('2023-01-02'),
        payer: mockAccountId,
        data: '',
      };

      manager.processOutboundMessages([confirmation], mockAccountId);

      const connections = Array.from(manager['connections'].values());

      const establishedConnection = connections.find(
        conn =>
          conn.status === 'established' &&
          conn.targetAccountId === '0.0.654321',
      );
      expect(establishedConnection).toBeDefined();
      expect(establishedConnection!.connectionTopicId).toBe('0.0.333333');

      const pendingConnection = connections.find(
        conn =>
          conn.status === 'pending' && conn.targetAccountId === '0.0.765432',
      );
      expect(pendingConnection).toBeDefined();

      expect(connections.length).toBe(2);
    });
  });

  describe('inbound requests with same sequence numbers', () => {
    it('should correctly handle multiple inbound requests with the same sequence number', () => {
      const inboundMessageAgent1: HCSMessage = {
        p: 'hcs-10',
        op: 'connection_request',
        operator_id: '0.0.111000@0.0.654321',
        sequence_number: 1,
        created: new Date('2023-01-01'),
        payer: '0.0.654321',
        data: '',
      };

      const inboundMessageAgent2: HCSMessage = {
        p: 'hcs-10',
        op: 'connection_request',
        operator_id: '0.0.222000@0.0.765432',
        sequence_number: 1,
        created: new Date('2023-01-01'),
        payer: '0.0.765432',
        data: '',
      };

      manager.processInboundMessages([
        inboundMessageAgent1,
        inboundMessageAgent2,
      ]);

      const needsConfirmationConnections = Array.from(
        manager['connections'].values(),
      ).filter(conn => conn.status === 'needs_confirmation');

      expect(needsConfirmationConnections.length).toBe(2);

      const targetAccounts = needsConfirmationConnections.map(
        conn => conn.targetAccountId,
      );
      expect(targetAccounts).toContain('0.0.654321');
      expect(targetAccounts).toContain('0.0.765432');

      const keys = Array.from(manager['connections'].keys());
      expect(keys).toContain('inb-1:0.0.111000@0.0.654321');
      expect(keys).toContain('inb-1:0.0.222000@0.0.765432');
    });

    it('should not delete one confirmation when processing another with same sequence number', () => {
      const request1: HCSMessage = {
        p: 'hcs-10',
        op: 'connection_request',
        operator_id: '0.0.111000@0.0.654321',
        sequence_number: 1,
        created: new Date('2023-01-01'),
        payer: '0.0.654321',
        data: '',
      };

      const request2: HCSMessage = {
        p: 'hcs-10',
        op: 'connection_request',
        operator_id: '0.0.222000@0.0.765432',
        sequence_number: 1,
        created: new Date('2023-01-01'),
        payer: '0.0.765432',
        data: '',
      };

      manager.processInboundMessages([request1, request2]);

      const confirmation: HCSMessage = {
        p: 'hcs-10',
        op: 'connection_created',
        connection_id: 1,
        connection_topic_id: '0.0.333333',
        connected_account_id: '0.0.654321',
        operator_id: '0.0.111000@0.0.654321',
        sequence_number: 2,
        created: new Date('2023-01-02'),
        payer: mockAccountId,
        data: '',
      };

      manager.processInboundMessages([confirmation]);

      const connections = Array.from(manager['connections'].values());

      const establishedConnection = connections.find(
        conn =>
          conn.status === 'established' &&
          conn.targetAccountId === '0.0.654321',
      );
      expect(establishedConnection).toBeDefined();
      expect(establishedConnection!.connectionTopicId).toBe('0.0.333333');

      const pendingConnection = connections.find(
        conn =>
          conn.status === 'needs_confirmation' &&
          conn.targetAccountId === '0.0.765432',
      );
      expect(pendingConnection).toBeDefined();

      expect(connections.length).toBe(2);
    });
  });

  describe('fetchConnectionData with outbound requests confirmations', () => {
    it('should properly check for confirmations on target inbound topics for different agents', async () => {
      const outboundMessage1: HCSMessage = {
        p: 'hcs-10',
        op: 'connection_request',
        connection_request_id: 1,
        operator_id: '0.0.100001@0.0.654321',
        outbound_topic_id: '0.0.100001',
        sequence_number: 1,
        created: new Date('2023-01-01'),
        payer: mockAccountId,
        data: '',
      };

      const outboundMessage2: HCSMessage = {
        p: 'hcs-10',
        op: 'connection_request',
        connection_request_id: 1,
        operator_id: '0.0.100001@0.0.765432',
        outbound_topic_id: '0.0.100001',
        sequence_number: 1,
        created: new Date('2023-01-01'),
        payer: mockAccountId,
        data: '',
      };

      mockClient.setMockMessages('0.0.100001', [
        outboundMessage1,
        outboundMessage2,
      ]);

      mockClient.setMockMessages('0.0.100002', [
        {
          p: 'hcs-10',
          op: 'connection_request',
          connection_request_id: 1,
          operator_id: '0.0.100001@0.0.654321',
          outbound_topic_id: '0.0.100001',
          sequence_number: 1,
          created: new Date('2023-01-01'),
          payer: mockAccountId,
          data: '',
        },
        {
          p: 'hcs-10',
          op: 'connection_created',
          connection_id: 1,
          connection_topic_id: '0.0.333333',
          operator_id: '0.0.100001@0.0.654321',
          sequence_number: 2,
          created: new Date('2023-01-02'),
          payer: mockAccountId,
          data: '',
          connection_request_id: 1,
          confirmed_request_id: 1,
          connected_account_id: '0.0.654321',
        },
      ]);

      await manager.fetchConnectionData(mockAccountId);

      const connections = Array.from(manager['connections'].values());

      const agent1Connection = connections.find(
        conn =>
          conn.targetAccountId === '0.0.654321' &&
          conn.status === 'established',
      );

      expect(agent1Connection).toBeDefined();
      expect(agent1Connection!.status).toBe('established');
      expect(agent1Connection!.connectionTopicId).toBe('0.0.333333');

      const agent2Connection = connections.find(
        conn =>
          conn.targetAccountId === '0.0.765432' && conn.status === 'pending',
      );

      if (agent2Connection) {
        expect(agent2Connection.status).toBe('pending');
      } else {
        const rawConnections = Array.from(manager['connections'].values());
        const rawAgent2Connection = rawConnections.find(
          conn => conn.targetAccountId === '0.0.765432',
        );
        expect(rawAgent2Connection).toBeDefined();
      }
    });
  });

  describe('connection confirmation cleanup', () => {
    it('should remove the original pending connection when a connection becomes established', async () => {
      const requestMessage: HCSMessage = {
        p: 'hcs-10',
        op: 'connection_request',
        connection_request_id: 100,
        operator_id: '0.0.999000@0.0.999999',
        outbound_topic_id: '0.0.222222',
        sequence_number: 1,
        created: new Date('2023-01-01'),
        payer: mockAccountId,
        data: '',
      };

      manager.processOutboundMessages([requestMessage], mockAccountId);

      const connectionsBefore = Array.from(manager['connections'].entries());
      const pendingKey = 'req-100:0.0.999000@0.0.999999';
      const hasPendingBefore = connectionsBefore.some(
        ([key]) => key === pendingKey,
      );
      expect(hasPendingBefore).toBe(true);

      const confirmationMessage: HCSMessage = {
        p: 'hcs-10',
        op: 'connection_created',
        connection_request_id: 100,
        connection_topic_id: '0.0.777777',
        confirmed_request_id: 200,
        outbound_topic_id: '0.0.222222',
        operator_id: '0.0.999000@0.0.999999',
        sequence_number: 2,
        created: new Date('2023-01-02'),
        payer: mockAccountId,
        data: '',
      };

      manager.processOutboundMessages([confirmationMessage], mockAccountId);

      const connectionsAfter = Array.from(manager['connections'].entries());
      const hasPendingAfter = connectionsAfter.some(
        ([key]) => key === pendingKey,
      );
      expect(hasPendingAfter).toBe(false);

      const hasConfirmed = connectionsAfter.some(
        ([key]) => key === '0.0.777777',
      );
      expect(hasConfirmed).toBe(true);

      const targetAccountConnections = connectionsAfter
        .map(([_, conn]) => conn)
        .filter(conn => conn.targetAccountId === '0.0.999999');

      expect(targetAccountConnections.length).toBe(1);
      expect(targetAccountConnections[0].status).toBe('established');
    });

    it('should remove the original needs_confirmation connection when a connection becomes established', async () => {
      const requestMessage: HCSMessage = {
        p: 'hcs-10',
        op: 'connection_request',
        operator_id: '0.0.888000@0.0.888888',
        sequence_number: 5,
        created: new Date('2023-01-01'),
        payer: '0.0.888888',
        data: '',
      };

      manager.processInboundMessages([requestMessage]);

      const connectionsBefore = Array.from(manager['connections'].entries());
      const pendingKey = 'inb-5:0.0.888000@0.0.888888';
      const hasPendingBefore = connectionsBefore.some(
        ([key]) => key === pendingKey,
      );
      expect(hasPendingBefore).toBe(true);

      const confirmationMessage: HCSMessage = {
        p: 'hcs-10',
        op: 'connection_created',
        connection_id: 5,
        connection_topic_id: '0.0.666666',
        connected_account_id: '0.0.888888',
        operator_id: '0.0.888000@0.0.888888',
        sequence_number: 10,
        created: new Date('2023-01-02'),
        payer: mockAccountId,
        data: '',
      };

      manager.processInboundMessages([confirmationMessage]);

      const connectionsAfter = Array.from(manager['connections'].entries());
      const hasPendingAfter = connectionsAfter.some(
        ([key]) => key === pendingKey,
      );
      expect(hasPendingAfter).toBe(false);

      const hasConfirmed = connectionsAfter.some(
        ([key]) => key === '0.0.666666',
      );
      expect(hasConfirmed).toBe(true);

      const targetAccountConnections = connectionsAfter
        .map(([_, conn]) => conn)
        .filter(conn => conn.targetAccountId === '0.0.888888');

      expect(targetAccountConnections.length).toBe(1);
      expect(targetAccountConnections[0].status).toBe('established');
    });
  });

  describe('error handling for invalid topic IDs', () => {
    it('should catch errors when trying to fetch messages from invalid topic IDs', async () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const compositeKey = 'inb-100:0.0.999000@0.0.999999';
      manager.updateOrAddConnection({
        connectionTopicId: compositeKey,
        targetAccountId: '0.0.999999',
        targetInboundTopicId: compositeKey,
        status: 'pending',
        isPending: true,
        needsConfirmation: false,
        created: new Date('2023-01-01'),
        connectionRequestId: 100,
        processed: false,
      });

      await expect(
        manager.fetchConnectionData(mockAccountId),
      ).resolves.not.toThrow();

      consoleErrorSpy.mockRestore();
    });

    it('should handle errors when given an invalid targetInboundTopicId', async () => {
      const invalidTopicId = 'invalid:topic:id';
      manager.updateOrAddConnection({
        connectionTopicId: 'req-200:0.0.888000@0.0.888888',
        targetAccountId: '0.0.888888',
        targetInboundTopicId: invalidTopicId,
        status: 'pending',
        isPending: true,
        needsConfirmation: false,
        created: new Date('2023-01-01'),
        connectionRequestId: 200,
        processed: false,
      });

      const validTopicId = '0.0.555555';
      manager.updateOrAddConnection({
        connectionTopicId: validTopicId,
        targetAccountId: '0.0.555555',
        targetInboundTopicId: '0.0.555556',
        status: 'established',
        isPending: false,
        needsConfirmation: false,
        created: new Date('2023-01-01'),
        processed: false,
      });

      const result = await manager.fetchConnectionData(mockAccountId);

      const validConnection = result.find(
        conn => conn.connectionTopicId === validTopicId,
      );
      expect(validConnection).toBeDefined();
    });
  });
});
