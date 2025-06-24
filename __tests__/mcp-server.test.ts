import { MCPServerBuilder } from '../src/hcs-11/mcp-server-builder';
import { HCS11Client } from '../src/hcs-11/client';
import {
  MCPServerCapability,
  VerificationType,
  MCPServerConfig,
  MCPServerProfile,
} from '../src/hcs-11/types';

describe('MCP Server Profile', () => {
  let mockBuilder: any;
  let mockConfig: MCPServerConfig;

  beforeEach(() => {
    mockConfig = {
      name: 'Test MCP Server',
      bio: 'A test MCP server for unit tests',
      alias: 'test_mcp',
      network: 'testnet',
      socials: [
        { platform: 'github', handle: 'test-org' },
        { platform: 'twitter', handle: 'test_mcp' },
      ],
      mcpServer: {
        version: '2024-06-01',
        connectionInfo: {
          url: 'https://mcp.example.com',
          transport: 'sse',
        },
        services: [
          MCPServerCapability.TOOL_PROVIDER,
          MCPServerCapability.API_INTEGRATION,
        ],
        description: 'This is a test MCP server for unit testing',
        host: {
          minVersion: '2024-05-01',
        },
        capabilities: ['resources.get', 'resources.list', 'tools.invoke'],
        resources: [{ name: 'test_resource', description: 'A test resource' }],
        tools: [{ name: 'test_tool', description: 'A test tool' }],
        maintainer: 'Test Team',
        repository: 'https://github.com/test/test-mcp',
        docs: 'https://docs.example.com/mcp',
        verification: {
          type: VerificationType.DNS,
          value: 'example.com',
          dns_field: 'hedera-verify',
        },
      },
    };

    mockBuilder = {
      setName: jest.fn().mockReturnThis(),
      setBio: jest.fn().mockReturnThis(),
      setAlias: jest.fn().mockReturnThis(),
      setNetworkType: jest.fn().mockReturnThis(),
      setVersion: jest.fn().mockReturnThis(),
      setConnectionInfo: jest.fn().mockReturnThis(),
      setServerDescription: jest.fn().mockReturnThis(),
      setServices: jest.fn().mockReturnThis(),
      setHostRequirements: jest.fn().mockReturnThis(),
      setCapabilities: jest.fn().mockReturnThis(),
      addResource: jest.fn().mockReturnThis(),
      addTool: jest.fn().mockReturnThis(),
      setMaintainer: jest.fn().mockReturnThis(),
      setRepository: jest.fn().mockReturnThis(),
      setDocs: jest.fn().mockReturnThis(),
      addVerificationDNS: jest.fn().mockReturnThis(),
      addVerificationSignature: jest.fn().mockReturnThis(),
      addVerificationChallenge: jest.fn().mockReturnThis(),
      addSocial: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue(mockConfig),
    };

    jest
      .spyOn(MCPServerBuilder.prototype, 'build')
      .mockImplementation(function () {
        return mockConfig;
      });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('MCPServerBuilder', () => {
    it('should create a valid MCP server configuration', () => {
      const builder = new MCPServerBuilder();
      const config = builder.build();

      expect(config).toBeDefined();
      expect(config.name).toBe('Test MCP Server');
      expect(config.bio).toBe('A test MCP server for unit tests');
      expect(config.alias).toBe('test_mcp');
      expect(config.network).toBe('testnet');
      expect(config.socials).toHaveLength(2);

      expect(config.mcpServer).toBeDefined();
      expect(config.mcpServer.version).toBe('2024-06-01');
      expect(config.mcpServer.connectionInfo.url).toBe(
        'https://mcp.example.com',
      );
      expect(config.mcpServer.connectionInfo.transport).toBe('sse');
      expect(config.mcpServer.services).toContain(
        MCPServerCapability.TOOL_PROVIDER,
      );
      expect(config.mcpServer.services).toContain(
        MCPServerCapability.API_INTEGRATION,
      );
      expect(config.mcpServer.description).toBe(
        'This is a test MCP server for unit testing',
      );
      expect(config.mcpServer.host?.minVersion).toBe('2024-05-01');
      expect(config.mcpServer.capabilities).toContain('tools.invoke');
      expect(config.mcpServer.resources).toHaveLength(1);
      expect(config.mcpServer.tools).toHaveLength(1);
      expect(config.mcpServer.maintainer).toBe('Test Team');
      expect(config.mcpServer.repository).toBe(
        'https://github.com/test/test-mcp',
      );
      expect(config.mcpServer.docs).toBe('https://docs.example.com/mcp');
      expect(config.mcpServer.verification?.type).toBe(VerificationType.DNS);
      expect(config.mcpServer.verification?.value).toBe('example.com');
      expect(config.mcpServer.verification?.dns_field).toBe('hedera-verify');
    });

    it('should support different verification methods', () => {
      const dnsMockConfig = { ...mockConfig };
      dnsMockConfig.mcpServer = { ...mockConfig.mcpServer };
      dnsMockConfig.mcpServer.verification = {
        type: VerificationType.DNS,
        value: 'example.com',
      };
      jest
        .spyOn(MCPServerBuilder.prototype, 'build')
        .mockReturnValueOnce(dnsMockConfig);

      const builder = new MCPServerBuilder();
      const dnsConfig = builder.build();
      expect(dnsConfig.mcpServer.verification?.type).toBe(VerificationType.DNS);
      expect(dnsConfig.mcpServer.verification?.value).toBe('example.com');

      const signatureMockConfig = { ...mockConfig };
      signatureMockConfig.mcpServer = { ...mockConfig.mcpServer };
      signatureMockConfig.mcpServer.verification = {
        type: VerificationType.SIGNATURE,
        value: 'a1b2c3d4e5f6',
      };
      jest
        .spyOn(MCPServerBuilder.prototype, 'build')
        .mockReturnValueOnce(signatureMockConfig);

      const signatureConfig = builder.build();
      expect(signatureConfig.mcpServer.verification?.type).toBe(
        VerificationType.SIGNATURE,
      );
      expect(signatureConfig.mcpServer.verification?.value).toBe(
        'a1b2c3d4e5f6',
      );

      const challengeMockConfig = { ...mockConfig };
      challengeMockConfig.mcpServer = { ...mockConfig.mcpServer };
      challengeMockConfig.mcpServer.verification = {
        type: VerificationType.CHALLENGE,
        value: '',
        challenge_path: 'verify-path',
      };
      jest
        .spyOn(MCPServerBuilder.prototype, 'build')
        .mockReturnValueOnce(challengeMockConfig);

      const challengeConfig = builder.build();
      expect(challengeConfig.mcpServer.verification?.type).toBe(
        VerificationType.CHALLENGE,
      );
      expect(challengeConfig.mcpServer.verification?.challenge_path).toBe(
        'verify-path',
      );
    });
  });

  describe('HCS11Client MCP Server Support', () => {
    let client: HCS11Client;

    beforeEach(() => {
      client = new HCS11Client({
        auth: { operatorId: '0.0.12345' },
        network: 'testnet',
        silent: true,
      });

      jest
        .spyOn(client, 'validateProfile')
        .mockReturnValue({ valid: true, errors: [] });
    });

    it('should create an MCP server profile', () => {
      const serverDetails = {
        version: '2024-06-01',
        connectionInfo: {
          url: 'https://mcp.example.com',
          transport: 'sse' as const,
        },
        services: [
          MCPServerCapability.TOOL_PROVIDER,
          MCPServerCapability.API_INTEGRATION,
        ],
        description: 'Test MCP server',
        verification: {
          type: VerificationType.DNS,
          value: 'example.com',
        },
        host: {
          minVersion: '2024-05-01',
        },
        capabilities: ['resources.get', 'tools.invoke'],
        resources: [{ name: 'test_resource', description: 'A test resource' }],
        tools: [{ name: 'test_tool', description: 'A test tool' }],
        maintainer: 'Test Team',
        repository: 'https://github.com/test/test-mcp',
        docs: 'https://docs.example.com/mcp',
      };

      const profile = client.createMCPServerProfile(
        'Test MCP Server',
        serverDetails,
        {
          alias: 'test_mcp',
          bio: 'A test MCP server for unit tests',
          socials: [
            { platform: 'github', handle: 'test-org' },
            { platform: 'twitter', handle: 'test_mcp' },
          ],
        },
      );

      expect(profile).toBeDefined();
      expect(profile.type).toBe(2);
      expect(profile.display_name).toBe('Test MCP Server');
      expect(profile.alias).toBe('test_mcp');
      expect(profile.bio).toBe('A test MCP server for unit tests');
      expect(profile.socials).toHaveLength(2);

      expect(profile.mcpServer).toBeDefined();
      expect(profile.mcpServer.version).toBe('2024-06-01');
      expect(profile.mcpServer.connectionInfo.url).toBe(
        'https://mcp.example.com',
      );
      expect(profile.mcpServer.connectionInfo.transport).toBe('sse');
      expect(profile.mcpServer.services).toContain(
        MCPServerCapability.TOOL_PROVIDER,
      );
      expect(profile.mcpServer.verification?.type).toBe(VerificationType.DNS);
    });

    it('should validate MCP server profiles', () => {
      const validateSpy = jest.spyOn(client, 'validateProfile');

      validateSpy.mockReturnValueOnce({ valid: true, errors: [] });

      const validProfile: MCPServerProfile = {
        version: '1.0',
        type: 2,
        display_name: 'Test MCP Server',
        mcpServer: {
          version: '2024-06-01',
          connectionInfo: {
            url: 'https://mcp.example.com',
            transport: 'sse' as const,
          },
          services: [MCPServerCapability.TOOL_PROVIDER],
          description: 'Test MCP server',
        },
      };

      const validationResult = client.validateProfile(validProfile);
      expect(validationResult.valid).toBe(true);

      validateSpy.mockReturnValueOnce({
        valid: false,
        errors: ['Missing required field'],
      });

      const invalidProfile = {
        version: '1.0',
        type: 2,
        display_name: 'Test MCP Server',
        mcpServer: {},
      };

      const invalidResult = client.validateProfile(invalidProfile);
      expect(invalidResult.valid).toBe(false);
    });
  });
});
