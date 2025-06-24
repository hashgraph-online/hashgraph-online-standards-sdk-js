/**
 * HCS-12 HashLinks Constants
 *
 * Predefined topic IDs for testing and examples
 */

export const TESTNET_EXAMPLES = {
  ACTIONS: {
    CALCULATOR: '0.0.TBD1',

    NFT_MINT: '0.0.TBD2',

    TOKEN_TRANSFER: '0.0.TBD3',
  },

  BLOCKS: {
    BUTTON: '0.0.TBD4',

    NFT_GALLERY: '0.0.TBD5',

    FORM: '0.0.TBD6',
  },

  ASSEMBLIES: {
    NFT_MARKETPLACE: '0.0.TBD7',

    TOKEN_DASHBOARD: '0.0.TBD8',
  },
} as const;

export const MAINNET_EXAMPLES = {
  ACTIONS: {},
  BLOCKS: {},
  ASSEMBLIES: {},
} as const;

/**
 * Get example topic IDs for the current network
 */
export function getExampleTopics(network: 'mainnet' | 'testnet') {
  return network === 'mainnet' ? MAINNET_EXAMPLES : TESTNET_EXAMPLES;
}
