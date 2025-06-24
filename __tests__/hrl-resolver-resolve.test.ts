import { HRLResolver } from '../src/index';
import axios from 'axios';
import { HederaMirrorNode } from '../src/services/mirror-node';
import type { Mock } from 'jest-mock';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('../src/services/mirror-node');
const MockedHederaMirrorNode = HederaMirrorNode as jest.MockedClass<
  typeof HederaMirrorNode
>;

jest.mock('../src/utils/logger', () => {
  const originalModule = jest.requireActual('../src/utils/logger');

  return {
    ...originalModule,
    Logger: {
      getInstance: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        getLevel: jest.fn().mockReturnValue('info'),
      })),
    },
  };
});

describe('HRLResolver.resolve', () => {
  let resolver: HRLResolver;
  let mockGetTopicInfo: jest.Mock;

  beforeEach(() => {
    resolver = new HRLResolver('info');
    jest.clearAllMocks();

    mockGetTopicInfo = jest.fn();
    MockedHederaMirrorNode.prototype.getTopicInfo = mockGetTopicInfo;
  });

  describe('HRL format input', () => {
    it('should resolve HRL directly without querying topic info', async () => {
      mockedAxios.head.mockResolvedValue({
        headers: { 'content-type': 'text/plain' },
      });

      mockedAxios.get.mockResolvedValue({
        data: 'Test content',
      });

      const result = await resolver.resolve('hcs://1/0.0.123456', {
        network: 'testnet',
      });

      expect(mockGetTopicInfo).not.toHaveBeenCalled();
      expect(result).toEqual({
        content: 'Test content',
        contentType: 'text/plain',
        topicId: '0.0.123456',
        isBinary: false,
      });
    });
  });

  describe('Topic ID format input', () => {
    it('should query topic info and use memo to determine standard', async () => {
      mockGetTopicInfo.mockResolvedValue({
        memo: 'hcs-20:points',
        topic_id: '0.0.123456',
      });

      mockedAxios.head.mockResolvedValue({
        headers: { 'content-type': 'application/json' },
      });

      mockedAxios.get.mockResolvedValue({
        data: { points: 100 },
      });

      const result = await resolver.resolve('0.0.123456', {
        network: 'testnet',
      });

      expect(mockGetTopicInfo).toHaveBeenCalledWith('0.0.123456');
      expect(mockedAxios.head).toHaveBeenCalledWith(
        expect.stringContaining('0.0.123456'),
      );
      expect(result.topicId).toBe('0.0.123456');
    });

    it('should default to HCS-1 when memo is empty', async () => {
      mockGetTopicInfo.mockResolvedValue({
        memo: '',
        topic_id: '0.0.123456',
      });

      mockedAxios.head.mockResolvedValue({
        headers: { 'content-type': 'text/plain' },
      });

      mockedAxios.get.mockResolvedValue({
        data: 'Default content',
      });

      const result = await resolver.resolve('0.0.123456', {
        network: 'testnet',
      });

      expect(mockGetTopicInfo).toHaveBeenCalledWith('0.0.123456');
      expect(result).toEqual({
        content: 'Default content',
        contentType: 'text/plain',
        topicId: '0.0.123456',
        isBinary: false,
      });
    });

    it('should default to HCS-1 when memo does not match pattern', async () => {
      mockGetTopicInfo.mockResolvedValue({
        memo: 'some other memo',
        topic_id: '0.0.123456',
      });

      mockedAxios.head.mockResolvedValue({
        headers: { 'content-type': 'text/plain' },
      });

      mockedAxios.get.mockResolvedValue({
        data: 'Default content',
      });

      await resolver.resolve('0.0.123456', {
        network: 'testnet',
      });

      expect(mockGetTopicInfo).toHaveBeenCalledWith('0.0.123456');
    });

    it('should fall back to HCS-1 when topic info query fails', async () => {
      mockGetTopicInfo.mockRejectedValue(new Error('Topic not found'));

      mockedAxios.head.mockResolvedValue({
        headers: { 'content-type': 'text/plain' },
      });

      mockedAxios.get.mockResolvedValue({
        data: 'Fallback content',
      });

      const result = await resolver.resolve('0.0.123456', {
        network: 'testnet',
      });

      expect(mockGetTopicInfo).toHaveBeenCalledWith('0.0.123456');
      expect(result).toEqual({
        content: 'Fallback content',
        contentType: 'text/plain',
        topicId: '0.0.123456',
        isBinary: false,
      });
    });
  });

  describe('Invalid input', () => {
    it('should throw error for invalid format', async () => {
      await expect(
        resolver.resolve('invalid-format', { network: 'testnet' }),
      ).rejects.toThrow('Invalid HRL or topic ID format: invalid-format');

      expect(mockGetTopicInfo).not.toHaveBeenCalled();
    });

    it('should throw error for malformed topic ID', async () => {
      await expect(
        resolver.resolve('0.0.invalid', { network: 'testnet' }),
      ).rejects.toThrow('Invalid HRL or topic ID format: 0.0.invalid');

      expect(mockGetTopicInfo).not.toHaveBeenCalled();
    });
  });

  describe('Memo parsing', () => {
    const memoTestCases = [
      { memo: 'hcs-1', expectedStandard: '1' },
      { memo: 'hcs-20:points', expectedStandard: '20' },
      { memo: 'hcs-12:blocks:extra', expectedStandard: '12' },
      { memo: 'HCS-20', expectedStandard: '1' },
      { memo: 'prefix-hcs-20', expectedStandard: '1' },
    ];

    memoTestCases.forEach(({ memo, expectedStandard }) => {
      it(`should extract standard "${expectedStandard}" from memo "${memo}"`, async () => {
        mockGetTopicInfo.mockResolvedValue({
          memo,
          topic_id: '0.0.123456',
        });

        mockedAxios.head.mockResolvedValue({
          headers: { 'content-type': 'text/plain' },
        });

        mockedAxios.get.mockResolvedValue({
          data: 'Test content',
        });

        await resolver.resolve('0.0.123456', {
          network: 'testnet',
        });

        expect(mockedAxios.head).toHaveBeenCalledWith(
          expect.stringContaining('0.0.123456'),
        );

        const callUrl = mockedAxios.head.mock.calls[0][0];
        expect(callUrl).toContain('0.0.123456');
      });
    });
  });
});
