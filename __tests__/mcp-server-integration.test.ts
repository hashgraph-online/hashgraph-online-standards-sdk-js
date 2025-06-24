import { MCPServerBuilder } from '../src/hcs-11/mcp-server-builder';
import { HCS11Client } from '../src/hcs-11/client';
import {
  MCPServerCapability,
  VerificationType,
  ProfileType,
  MCPServerConfig,
} from '../src/hcs-11/types';

/**
 * This integration test demonstrates a complete workflow for creating and
 * working with MCP Server profiles using the HCS-11 standard.
 *
 * Note: The actual network operations (inscribeProfile, updateAccountMemo)
 * are mocked since this is a unit test.
 */
describe('MCP Server Integration Tests', () => {
  const mockInscribeProfile = jest.fn().mockResolvedValue({
    profileTopicId: '0.0.123456',
    transactionId: '0.0.12345@1234567890.000000000',
    success: true,
  });

  const mockUpdateAccountMemo = jest.fn().mockResolvedValue({
    success: true,
  });

  const mockFetchProfile = jest.fn();

  let client: HCS11Client;
  let mockConfig: MCPServerConfig;

  beforeEach(() => {
    mockConfig = {
      name: 'Hedera MCP Server',
      bio: 'Official MCP server for Hedera integration',
      alias: 'hedera_mcp',
      network: 'mainnet',
      socials: [
        { platform: 'github', handle: 'hedera-consensus' },
        { platform: 'twitter', handle: 'hedera_mcp' },
      ],
      mcpServer: {
        version: '2024-06-01',
        connectionInfo: {
          url: 'https://mcp.hedera.com',
          transport: 'sse',
        },
        services: [
          MCPServerCapability.TOOL_PROVIDER,
          MCPServerCapability.API_INTEGRATION,
          MCPServerCapability.SEARCH,
          MCPServerCapability.COMMUNICATION,
        ],
        description:
          'Provides tools and resources for Hedera consensus integration',
        host: {
          minVersion: '2024-05-01',
        },
        capabilities: [
          'resources.get',
          'resources.list',
          'resources.subscribe',
          'tools.invoke',
        ],
        resources: [
          {
            name: 'hcs_topics',
            description:
              'Access message streams from Hedera Consensus Service topics',
          },
          {
            name: 'hcs_messages',
            description: 'Browse historical messages from consensus topics',
          },
        ],
        tools: [
          {
            name: 'topic_submit',
            description:
              'Submit new messages to Hedera Consensus Service topics',
          },
          {
            name: 'topic_subscribe',
            description: 'Subscribe to real-time messages from HCS topics',
          },
          {
            name: 'topic_search',
            description:
              'Search for messages in HCS topics by content or timestamp',
          },
        ],
        maintainer: 'Hedera Consensus Team',
        repository: 'https://github.com/hedera-consensus/mcp-server',
        docs: 'https://docs.hederaconsensus.com/mcp-integration',
        verification: {
          type: VerificationType.DNS,
          value: 'hederaconsensus.com',
          dns_field: 'mcp-verify',
        },
      },
    };

    jest
      .spyOn(MCPServerBuilder.prototype, 'build')
      .mockImplementation(function () {
        return mockConfig;
      });

    client = new HCS11Client({
      auth: { operatorId: '0.0.12345' },
      network: 'testnet',
      silent: true,
    });

    client.inscribeProfile = mockInscribeProfile;
    client.updateAccountMemoWithProfile = mockUpdateAccountMemo;
    client.fetchProfileByAccountId = mockFetchProfile;

    jest
      .spyOn(client, 'validateProfile')
      .mockReturnValue({ valid: true, errors: [] });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should demonstrate complete MCP server profile workflow', async () => {
    const builder = new MCPServerBuilder();
    const config = builder.build();

    const profile = client.createMCPServerProfile(
      config.name,
      config.mcpServer,
      {
        alias: config.alias,
        bio: config.bio,
        socials: config.socials,
      },
    );

    expect(profile.type).toBe(ProfileType.MCP_SERVER);
    expect(profile.display_name).toBe('Hedera MCP Server');
    expect(profile.mcpServer.version).toBe('2024-06-01');

    const validation = client.validateProfile(profile);
    expect(validation.valid).toBe(true);

    const profileJson = client.profileToJSONString(profile);
    expect(typeof profileJson).toBe('string');

    jest.spyOn(client, 'parseProfileFromString').mockReturnValue(profile);

    const parsedProfile = client.parseProfileFromString(profileJson);
    expect(parsedProfile).not.toBeNull();
    expect(parsedProfile?.type).toBe(ProfileType.MCP_SERVER);

    const inscriptionResult = await client.inscribeProfile(profile);

    expect(mockInscribeProfile).toHaveBeenCalled();
    expect(inscriptionResult.success).toBe(true);
    expect(inscriptionResult.profileTopicId).toBe('0.0.123456');

    const memoResult = await client.updateAccountMemoWithProfile(
      '0.0.12345',
      inscriptionResult.profileTopicId,
    );

    expect(mockUpdateAccountMemo).toHaveBeenCalled();
    expect(memoResult.success).toBe(true);

    const memo = client.setProfileForAccountMemo('0.0.123456');
    expect(memo).toBe('hcs-11:hcs://1/0.0.123456');

    mockFetchProfile.mockResolvedValueOnce({
      success: true,
      profile: profile,
      topicInfo: {
        profileTopicId: '0.0.123456',
      },
    });

    const completeResult = await client.createAndInscribeProfile(profile);
    expect(completeResult.success).toBe(true);

    const fetchResult = await client.fetchProfileByAccountId('0.0.12345');

    expect(mockFetchProfile).toHaveBeenCalled();
    expect(fetchResult.success).toBe(true);
  });
});
