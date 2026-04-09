export type Progress = {
  taskId: string;
  stage: "sign" | "broadcast" | "scan" | "refblock";
  current: number;
  total: number;
};

export type CollectionAddress = {
  id: string;
  name: string;
  address: string;
};

export type HdWallet = {
  id: string;
  name: string;
  xpub: string;
  enc_mnemonic: string;
  path_prefix: string;
  created_at: string;
  preview_addresses: string[];
};

export type PendingWallet = {
  name: string;
  xpub: string;
  enc_mnemonic: string;
  path_prefix: string;
  preview_addresses: string[];
};

export type AppConfig = {
  network: string;
  full_host: string;
  tron_api_key: string;
  usdt_contract: string;
  decimals: number;
  fee_limit: number;
  collection_addresses: CollectionAddress[];
  hd_wallets: HdWallet[];
  auth_password_initialized: boolean;
  auth_password_hash: string;
  auth_password_salt: string;
  auth_password_iters: number;
  auth_session_minutes: number;
};

export const NETWORK_PRESETS = {
  mainnet: {
    label: "正式网",
    network: "mainnet",
    full_host: "https://api.trongrid.io",
    usdt_contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    decimals: 6
  },
  testnet: {
    label: "测试网",
    network: "nile",
    full_host: "https://nile.trongrid.io",
    usdt_contract: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
    decimals: 6
  }
} as const;

export const DEFAULT_CONFIG: AppConfig = {
  network: NETWORK_PRESETS.mainnet.network,
  full_host: NETWORK_PRESETS.mainnet.full_host,
  tron_api_key: "",
  usdt_contract: NETWORK_PRESETS.mainnet.usdt_contract,
  decimals: NETWORK_PRESETS.mainnet.decimals,
  fee_limit: 100000000,
  collection_addresses: [],
  hd_wallets: [],
  auth_password_initialized: false,
  auth_password_hash: "",
  auth_password_salt: "",
  auth_password_iters: 100_000,
  auth_session_minutes: 30
};

export const CONFIG_STORAGE_KEY = "tws:config";
