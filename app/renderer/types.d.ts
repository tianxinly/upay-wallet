export {};

declare global {
  type FileTokenHandle = { token: string; filePath: string; name: string };

  interface Window {
    api: {
      appInfo: () => Promise<{ version: string; userDataPath: string; platform: string }>;
      loadSecureConfig: () => Promise<any>;
      saveSecureConfig: (data: any) => Promise<boolean>;
      selectOpenFile: (options?: { filters?: { name: string; extensions: string[] }[] }) => Promise<FileTokenHandle | null>;
      selectSaveFile: (options?: {
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
      }) => Promise<FileTokenHandle | null>;
      readTextFile: (token: string) => Promise<string>;
      readJsonFile: (token: string) => Promise<any>;
      writeTextFile: (token: string, content: string) => Promise<boolean>;
      fetchRefBlock: (params: { fullHost: string; tron_api_key?: string }) => Promise<{
        ref_block_bytes: string;
        ref_block_hash: string;
        timestamp: number;
        expiration: number;
      }>;
      collectSign: (params: { input: any; outputPath: string; taskId: string }) => Promise<any>;
      collectSignHd: (params: {
        input: any;
        outputPath: string;
        taskId: string;
        enc_mnemonic: string;
        password: string;
        indices: number[];
      }) => Promise<any>;
      quickCollect: (params: {
        fullHost: string;
        tron_api_key?: string;
        usdt_contract: string;
        decimals: number;
        fee_limit: number;
        to: string;
        items: Array<{ from: string; amount: string }>;
        taskId: string;
        enc_mnemonic: string;
        password: string;
        indices: number[];
      }) => Promise<{
        signed: number;
        success: number;
        fail: number;
        results: any[];
      }>;
      broadcast: (params: {
        fullHost: string;
        tron_api_key?: string;
        expectedContract?: string;
        signedTxs: any[];
        outputPath?: string;
        taskId: string;
      }) => Promise<any>;
      scanAddresses: (params: {
        fullHost: string;
        tron_api_key?: string;
        usdtContract: string;
        decimals: number;
        addresses: string[];
        threshold: string;
        taskId: string;
      }) => Promise<any>;
      feeInitialize: (params: {
        fullHost: string;
        tron_api_key?: string;
        enc_mnemonic: string;
        password: string;
        maxWallets?: number;
        taskId: string;
      }) => Promise<{
        initialized: boolean;
        activatedCountBefore: number;
        activatedCountAfter: number;
        steps: {
          fromIndex: number;
          from: string;
          toIndex: number;
          to: string;
          freeBandwidth: number;
          balanceSun: string;
          amountSun: string;
          status: "sent" | "skipped" | "failed";
          reason?: string;
          txid?: string;
        }[];
        shareSun: string;
        addressStates: {
          index: number;
          address: string;
          activated: boolean;
          balanceSun: string;
          freeBandwidth: number;
        }[];
      }>;
      feeActivateAddresses: (params: {
        fullHost: string;
        tron_api_key?: string;
        enc_mnemonic: string;
        password: string;
        addresses: string[];
        maxWallets?: number;
        taskId: string;
      }) => Promise<{
        total: number;
        activated: number;
        alreadyActive: number;
        waiting: number;
        failed: number;
        steps: {
          address: string;
          fromIndex?: number;
          fromAddress?: string;
          status: "activated" | "already_active" | "waiting" | "failed";
          reason?: string;
          txid?: string;
        }[];
        feeWalletStates: {
          index: number;
          address: string;
          activated: boolean;
          balanceSun: string;
          freeBandwidth: number;
        }[];
      }>;
      feeGetStates: (params: {
        fullHost: string;
        tron_api_key?: string;
        enc_mnemonic: string;
        password: string;
        maxWallets?: number;
      }) => Promise<{
        total: number;
        activatedCount: number;
        inactiveCount: number;
        addressStates: {
          index: number;
          address: string;
          activated: boolean;
          balanceSun: string;
          freeBandwidth: number;
        }[];
      }>;
      hdGenerate: () => Promise<{
        mnemonic: string;
        xpub: string;
        address: string;
        addresses: string[];
        path_prefix: string;
      }>;
      hdFromMnemonic: (params: { mnemonic: string }) => Promise<{
        xpub: string;
        address: string;
        addresses: string[];
        path_prefix: string;
      }>;
      hdDerive: (params: { mnemonic: string; startIndex: number; count: number }) => Promise<{
        items: { index: number; address: string; privateKey: string; publicKey?: string }[];
      }>;
      hdDeriveIndices: (params: { mnemonic: string; indices: number[] }) => Promise<{
        items: { index: number; address: string; privateKey: string; publicKey?: string }[];
      }>;
      hdDeriveXpub: (params: { xpub: string; indices: number[] }) => Promise<{
        items: { index: number; address: string; publicKey?: string }[];
      }>;
      onProgress: (cb: (payload: any) => void) => () => void;
      onLog: (cb: (message: string) => void) => () => void;
    };
  }
}
