import { AppConfig, CollectionAddress, CONFIG_STORAGE_KEY, DEFAULT_CONFIG, HdWallet } from "../types/app";

export function loadConfigFromStorage(): AppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_CONFIG };

    const rawCollection = Array.isArray(parsed.collection_addresses) ? parsed.collection_addresses : [];
    const collection_addresses = rawCollection
      .map((item: any, idx: number) => {
        if (!item || typeof item !== "object") return null;
        const name = String(item.name ?? item.label ?? `归集地址 ${idx + 1}`).trim();
        const address = String(item.address ?? "").trim();
        if (!address) return null;
        return {
          id: String(item.id ?? crypto.randomUUID()),
          name: name || `归集地址 ${idx + 1}`,
          address
        } as CollectionAddress;
      })
      .filter(Boolean) as CollectionAddress[];

    const rawWallets = Array.isArray(parsed.hd_wallets) ? parsed.hd_wallets : [];
    const hd_wallets = rawWallets
      .map((item: any, idx: number) => {
        if (!item || typeof item !== "object") return null;
        const name = String(item.name ?? `HD 钱包 ${idx + 1}`).trim();
        const xpub = String(item.xpub ?? "").trim();
        const enc_mnemonic = String(item.enc_mnemonic ?? "").trim();
        if (!xpub) return null;
        return {
          id: String(item.id ?? crypto.randomUUID()),
          name: name || `HD 钱包 ${idx + 1}`,
          xpub,
          enc_mnemonic,
          path_prefix: String(item.path_prefix ?? "m/44'/195'/0'/0"),
          created_at: String(item.created_at ?? ""),
          preview_addresses: Array.isArray(item.preview_addresses) ? item.preview_addresses : []
        } as HdWallet;
      })
      .filter(Boolean) as HdWallet[];

    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      decimals: Number(parsed.decimals ?? DEFAULT_CONFIG.decimals),
      fee_limit: Number(parsed.fee_limit ?? DEFAULT_CONFIG.fee_limit),
      collection_addresses,
      hd_wallets,
      mfa_enabled: Boolean(parsed.mfa_enabled ?? DEFAULT_CONFIG.mfa_enabled),
      mfa_secret: String(parsed.mfa_secret ?? DEFAULT_CONFIG.mfa_secret),
      auth_password_initialized: Boolean(parsed.auth_password_initialized ?? DEFAULT_CONFIG.auth_password_initialized),
      auth_password_hash: String(parsed.auth_password_hash ?? DEFAULT_CONFIG.auth_password_hash),
      auth_password_salt: String(parsed.auth_password_salt ?? DEFAULT_CONFIG.auth_password_salt),
      auth_password_iters: Number(parsed.auth_password_iters ?? DEFAULT_CONFIG.auth_password_iters),
      auth_session_minutes: Number(parsed.auth_session_minutes ?? DEFAULT_CONFIG.auth_session_minutes)
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
