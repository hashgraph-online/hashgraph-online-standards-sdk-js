import { PrivateKey } from '@hashgraph/sdk';

export type KeyType = 'ed25519' | 'ecdsa';

export interface KeyDetectionResult {
  detectedType: KeyType;
  privateKey: PrivateKey;
}

/**
 * Detects the key type from a private key string and returns the parsed PrivateKey
 * @param privateKeyString The private key string to detect type from
 * @returns The detected key type and parsed PrivateKey
 * @throws Error if the private key cannot be parsed
 */
export function detectKeyTypeFromString(
  privateKeyString: string,
): KeyDetectionResult {
  if (!privateKeyString || privateKeyString.trim() === '') {
    throw new Error('Failed to parse private key: empty input');
  }

  let normalizedKey = privateKeyString.trim();
  const has0xPrefix = normalizedKey.startsWith('0x');

  if (normalizedKey.startsWith('302a300506032b6570')) {
    throw new Error('Public keys are not supported, private key required');
  }

  if (has0xPrefix) {
    const hexWithoutPrefix = normalizedKey.substring(2);
    if (!/^[0-9a-fA-F]+$/.test(hexWithoutPrefix)) {
      throw new Error('Failed to parse private key: invalid hex characters');
    }
    if (hexWithoutPrefix.length % 2 !== 0) {
      throw new Error('Invalid hex string: odd number of characters');
    }
  }

  const hexWithoutPrefix = has0xPrefix ? normalizedKey.substring(2) : normalizedKey;
  const isHex = /^[0-9a-fA-F]+$/.test(hexWithoutPrefix);
  const isRawHex64 = isHex && hexWithoutPrefix.length === 64;
  const isRawHex128 = isHex && hexWithoutPrefix.length === 128;

  if (normalizedKey.includes('-----BEGIN')) {
    const base64Match = normalizedKey.match(/-----BEGIN[\s\S]+?-----\n([\s\S]+?)\n-----END/);
    if (!base64Match) {
      throw new Error('Invalid PEM format');
    }
    
    const base64Content = base64Match[1].replace(/\s/g, '');
    
    try {
      const derKey = Buffer.from(base64Content, 'base64').toString('hex');
      
      if (derKey.startsWith('302e020100300506032b657004220420')) {
        const privateKey = PrivateKey.fromStringED25519(derKey);
        return { detectedType: 'ed25519', privateKey };
      } else if (derKey.startsWith('3030020100300706052b8104000a')) {
        const privateKey = PrivateKey.fromStringECDSA(derKey);
        return { detectedType: 'ecdsa', privateKey };
      }
    } catch (e) {
      try {
        const privateKey = PrivateKey.fromStringED25519(normalizedKey);
        return { detectedType: 'ed25519', privateKey };
      } catch (ed25519Error) {
        try {
          const privateKey = PrivateKey.fromStringECDSA(normalizedKey);
          return { detectedType: 'ecdsa', privateKey };
        } catch (ecdsaError) {
          throw new Error(`Failed to parse PEM key: ${ed25519Error}`);
        }
      }
    }
  }
  
  if (!isHex && !has0xPrefix && isBase64(normalizedKey)) {
    try {
      const derHex = Buffer.from(normalizedKey, 'base64').toString('hex');
      
      if (derHex.startsWith('302e020100300506032b657004220420')) {
        const privateKey = PrivateKey.fromStringED25519(derHex);
        return { detectedType: 'ed25519', privateKey };
      } else if (derHex.startsWith('3030020100300706052b8104000a')) {
        const privateKey = PrivateKey.fromStringECDSA(derHex);
        return { detectedType: 'ecdsa', privateKey };
      } else {
        try {
          const privateKey = PrivateKey.fromStringED25519(normalizedKey);
          return { detectedType: 'ed25519', privateKey };
        } catch (e) {
          const privateKey = PrivateKey.fromStringECDSA(normalizedKey);
          return { detectedType: 'ecdsa', privateKey };
        }
      }
    } catch (e) {
      throw new Error(`Failed to parse base64 key: ${e}`);
    }
  }

  if ((has0xPrefix || isRawHex64 || isRawHex128) && isHex) {
    const firstType = has0xPrefix ? 'ecdsa' : 'ed25519';
    const secondType = has0xPrefix ? 'ed25519' : 'ecdsa';
    
    try {
      if (firstType === 'ecdsa') {
        const privateKey = PrivateKey.fromStringECDSA(normalizedKey);
        return { detectedType: 'ecdsa', privateKey };
      } else {
        const privateKey = PrivateKey.fromStringED25519(normalizedKey);
        return { detectedType: 'ed25519', privateKey };
      }
    } catch (firstError) {
      try {
        const privateKey = secondType === 'ecdsa' 
          ? PrivateKey.fromStringECDSA(normalizedKey)
          : PrivateKey.fromStringED25519(normalizedKey);
        return { detectedType: secondType, privateKey };
      } catch (secondError) {
        throw new Error(
          `Failed to parse private key as either ED25519 or ECDSA: ${firstError}`,
        );
      }
    }
  }

  let detectedType: KeyType = 'ed25519';

  if (normalizedKey.startsWith('302e020100300506032b657004220420')) {
    detectedType = 'ed25519';
  } else if (normalizedKey.startsWith('3030020100300706052b8104000a')) {
    detectedType = 'ecdsa';
  } else if (normalizedKey.length === 96) {
    detectedType = 'ed25519';
  } else if (normalizedKey.length === 88) {
    detectedType = 'ecdsa';
  }
  
  try {
    const privateKey =
      detectedType === 'ecdsa'
        ? PrivateKey.fromStringECDSA(normalizedKey)
        : PrivateKey.fromStringED25519(normalizedKey);
    return { detectedType, privateKey };
  } catch (parseError) {
    const alternateType = detectedType === 'ecdsa' ? 'ed25519' : 'ecdsa';
    try {
      const privateKey =
        alternateType === 'ecdsa'
          ? PrivateKey.fromStringECDSA(normalizedKey)
          : PrivateKey.fromStringED25519(normalizedKey);
      return { detectedType: alternateType, privateKey };
    } catch (secondError) {
      throw new Error(
        `Failed to parse private key as either ED25519 or ECDSA: ${parseError}`,
      );
    }
  }
}

function isBase64(str: string): boolean {
  if (str.includes('-') || str.includes('_')) {
    return false;
  }
  
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(str)) {
    return false;
  }
  
  if (str.length % 4 !== 0) {
    return false;
  }
  
  try {
    const decoded = Buffer.from(str, 'base64');
    const reencoded = decoded.toString('base64');
    return reencoded === str;
  } catch {
    return false;
  }
}
