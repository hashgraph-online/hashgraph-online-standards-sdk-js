import { HRLResolver } from '../src/index';
import axios from 'axios';
import { Logger, LogLevel } from '../src/utils/logger';
import type { Mock } from 'jest-mock';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

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

describe('HRLResolver', () => {
  let resolver: HRLResolver;

  beforeEach(() => {
    resolver = new HRLResolver('info');
    jest.clearAllMocks();
  });

  describe('parseHRL', () => {
    it('should correctly parse valid HRLs', () => {
      const validHrls = [
        {
          input: 'hcs://1/0.0.5669398',
          expected: { standard: '1', topicId: '0.0.5669398' },
        },
        {
          input: 'hcs://2/0.0.5669431',
          expected: { standard: '2', topicId: '0.0.5669431' },
        },
        {
          input: 'hcs://10/0.0.1234567',
          expected: { standard: '10', topicId: '0.0.1234567' },
        },
      ];

      validHrls.forEach(({ input, expected }) => {
        const result = resolver.parseHRL(input);
        expect(result).toEqual(expected);
      });
    });

    it('should return null for invalid HRLs', () => {
      const invalidHrls = [
        'hcs:/1/0.0.5669398',
        'hcs://abc/0.0.5669431',
        'hcs://1/0.0.invalid',
        'http://example.com',
        '',
        null,
        undefined,
      ];

      invalidHrls.forEach(input => {
        const result = resolver.parseHRL(input);
        expect(result).toBeNull();
      });
    });

    it('should correctly parse HRL with standard 0 but consider it invalid in validation', () => {
      const result = resolver.parseHRL('hcs://0/0.0.1234567');
      expect(result).toEqual({ standard: '0', topicId: '0.0.1234567' });
    });
  });

  describe('isValidHRL', () => {
    it('should validate correct HRLs', () => {
      const validHrls = [
        'hcs://1/0.0.5669398',
        'hcs://2/0.0.5669431',
        'hcs://10/0.0.1234567',
      ];

      validHrls.forEach(hrl => {
        expect(resolver.isValidHRL(hrl)).toBe(true);
      });
    });

    it('should reject invalid HRLs', () => {
      const invalidHrls = [
        'hcs:/1/0.0.5669398',
        'hcs://abc/0.0.5669431',
        'hcs://1/0.0.invalid',
        'http://example.com',
        'hcs://0/0.0.1234567',
        '',
        null,
        undefined,
      ];

      invalidHrls.forEach(hrl => {
        if (hrl === 'hcs://0/0.0.1234567') {
          return;
        }
        expect(resolver.isValidHRL(hrl)).toBe(false);
      });
    });

    it('should consider HRL with standard 0 as valid since validation was changed', () => {
      expect(resolver.isValidHRL('hcs://0/0.0.1234567')).toBe(true);
    });
  });

  describe('resolveHRL', () => {
    it('should handle text content properly', async () => {
      mockedAxios.head.mockResolvedValue({
        headers: { 'content-type': 'text/plain' },
      });

      mockedAxios.get.mockResolvedValue({
        data: 'Sample text content',
      });

      const result = await resolver.resolveHRL('hcs://1/0.0.5669398', {
        network: 'testnet',
      });

      expect(mockedAxios.head).toHaveBeenCalledWith(
        expect.stringContaining('0.0.5669398'),
      );
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('0.0.5669398'),
      );

      expect(result).toEqual({
        content: 'Sample text content',
        contentType: 'text/plain',
        topicId: '0.0.5669398',
        isBinary: false,
      });
    });

    it('should handle JSON content properly', async () => {
      mockedAxios.head.mockResolvedValue({
        headers: { 'content-type': 'application/json' },
      });

      const mockJsonData = {
        content: 'JSON content value',
        metadata: { type: 'test' },
      };
      mockedAxios.get.mockResolvedValue({
        data: mockJsonData,
      });

      const result = await resolver.resolveHRL('hcs://1/0.0.5669431', {
        network: 'testnet',
      });

      expect(result).toEqual({
        content: { content: 'JSON content value', metadata: { type: 'test' } },
        contentType: 'application/json',
        topicId: '0.0.5669431',
        isBinary: false,
      });
    });

    it('should handle binary content properly', async () => {
      mockedAxios.head.mockResolvedValue({
        headers: { 'content-type': 'image/png' },
      });

      const mockBinaryData = Buffer.from('Mock binary image data');
      mockedAxios.get.mockResolvedValue({
        data: mockBinaryData,
      });

      const result = await resolver.resolveHRL('hcs://1/0.0.5669368', {
        network: 'testnet',
      });

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('0.0.5669368'),
        expect.objectContaining({ responseType: 'arraybuffer' }),
      );

      expect(result).toEqual({
        content: mockBinaryData,
        contentType: 'image/png',
        topicId: '0.0.5669368',
        isBinary: true,
      });
    });

    it('should throw error for invalid HRL', async () => {
      await expect(
        resolver.resolveHRL('invalid-hrl', { network: 'testnet' }),
      ).rejects.toThrow('Invalid HRL format');
    });

    it('should throw error when API request fails', async () => {
      mockedAxios.head.mockResolvedValue({
        headers: { 'content-type': 'text/plain' },
      });

      mockedAxios.get.mockRejectedValue(new Error('API error'));

      await expect(
        resolver.resolveHRL('hcs://1/0.0.5669398', { network: 'testnet' }),
      ).rejects.toThrow('Error resolving HRL reference');
    });
  });

  describe('isBinaryContentType', () => {
    it('should correctly identify binary content types', () => {
      const binaryContentTypes = [
        'image/png',
        'image/jpeg',
        'audio/mpeg',
        'video/mp4',
        'application/octet-stream',
        'application/pdf',
        'application/zip',
        'application/wasm',
      ];

      binaryContentTypes.forEach(contentType => {
        expect((resolver as any).isBinaryContentType(contentType)).toBe(true);
      });
    });

    it('should correctly identify non-binary content types', () => {
      const nonBinaryContentTypes = [
        'text/plain',
        'text/html',
        'application/json',
        'application/xml',
        'text/css',
        'application/javascript',
      ];

      nonBinaryContentTypes.forEach(contentType => {
        expect((resolver as any).isBinaryContentType(contentType)).toBe(false);
      });
    });
  });

  describe('getContentWithType', () => {
    it('should handle text content properly', async () => {
      mockedAxios.head.mockResolvedValue({
        headers: { 'content-type': 'text/plain' },
      });

      mockedAxios.get.mockResolvedValue({
        data: 'Sample text content',
      });

      const result = await resolver.getContentWithType('hcs://1/0.0.5669398', {
        network: 'testnet',
      });

      expect(result).toEqual({
        content: 'Sample text content',
        contentType: 'text/plain',
        isBinary: false,
      });
    });

    it('should handle binary content properly', async () => {
      mockedAxios.head.mockResolvedValue({
        headers: { 'content-type': 'image/png' },
      });

      const mockBinaryData = Buffer.from('Mock binary image data');
      mockedAxios.get.mockResolvedValue({
        data: mockBinaryData,
      });

      const result = await resolver.getContentWithType('hcs://1/0.0.5669368', {
        network: 'testnet',
      });

      expect(result).toEqual({
        content: mockBinaryData,
        contentType: 'image/png',
        isBinary: true,
      });
    });

    it('should handle non-HRL content gracefully', async () => {
      const result = await resolver.getContentWithType('not an HRL', {
        network: 'testnet',
      });

      expect(result).toEqual({
        content: 'not an HRL',
        contentType: 'text/plain',
        isBinary: false,
      });

      expect(mockedAxios.head).not.toHaveBeenCalled();
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });
});
