import { AssemblyRegistry } from '../../src/hcs-12/registries/assembly-registry';
import { Logger } from '../../src/utils/logger';
import { NetworkType } from '../../src/utils/types';

describe('AssemblyRegistry Base64 Decoding', () => {
  it('should correctly decode base64 messages from mirror node', async () => {
    const logger = new Logger({ level: 'debug', module: 'test' });

    const mockClient = {
      mirrorNode: {
        getTopicMessagesByFilter: jest.fn().mockResolvedValue([
          {
            sequence_number: 1,
            consensus_timestamp: '1750456452.416332000',
            payer_account_id: '0.0.5200939',
            message:
              'eyJwIjoiaGNzLTEyIiwib3AiOiJyZWdpc3RlciIsIm5hbWUiOiJjb3VudGVyLWFwcCIsInZlcnNpb24iOiIxLjAuMCIsImRlc2NyaXB0aW9uIjoiQ29tcGxldGUgY291bnRlciBhcHBsaWNhdGlvbiIsImF1dGhvciI6IjAuMC41MjAwOTM5IiwidGFncyI6WyJkZW1vIiwiY291bnRlciIsImhhc2hsaW5rcyJdfQ==',
          },
          {
            sequence_number: 2,
            consensus_timestamp: '1750456454.332786186',
            payer_account_id: '0.0.5200939',
            message:
              'eyJwIjoiaGNzLTEyIiwib3AiOiJhZGQtYmxvY2siLCJibG9ja190X2lkIjoiMC4wLjYyMDU4MTYiLCJhY3Rpb25zIjp7ImluY3JlbWVudCI6IjAuMC42MjA1NzcxIiwiZGVjcmVtZW50IjoiMC4wLjYyMDU3NzEiLCJyZXNldCI6IjAuMC42MjA1NzcxIn0sImF0dHJpYnV0ZXMiOnsiY291bnQiOjAsInN0ZXAiOjF9fQ==',
          },
        ]),
      },
    };

    const assemblyTopicId = '0.0.6205821';

    const registry = new AssemblyRegistry(
      'testnet' as NetworkType,
      logger,
      assemblyTopicId,
      mockClient as any,
    );

    const state = await registry.getAssemblyState();

    expect(state).toBeDefined();
    expect(state?.name).toBe('counter-app');
    expect(state?.version).toBe('1.0.0');
    expect(state?.description).toBe('Complete counter application');
    expect(state?.author).toBe('0.0.5200939');
    expect(state?.tags).toEqual(['demo', 'counter', 'hashlinks']);

    expect(state?.blocks).toHaveLength(1);
    expect(state?.blocks[0].block_t_id).toBe('0.0.6205816');
    expect(state?.blocks[0].actions).toEqual({
      increment: '0.0.6205771',
      decrement: '0.0.6205771',
      reset: '0.0.6205771',
    });
    expect(state?.blocks[0].attributes).toEqual({
      count: 0,
      step: 1,
    });

    expect(mockClient.mirrorNode.getTopicMessagesByFilter).toHaveBeenCalledWith(
      assemblyTopicId,
      {
        order: 'asc',
        limit: 1000,
      },
    );
  });
});
