import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadConfigFromStorage } from "../../shared/config/storage";
import { decryptSecret, derivePasswordHash, encryptSecret, fromBase64, toBase64 } from "../../shared/crypto/security";
import { decodeMaybeBase64, decodeMaybeHex, formatBroadcastErrors } from "../../shared/parsers/broadcast";
import { parseAddressAmountCsv, parseAddressCsv } from "../../shared/parsers/csv";
import AuthScreen from "../auth/AuthScreen";
import {
  AppConfig,
  CollectionAddress,
  CONFIG_STORAGE_KEY,
  HdWallet,
  NETWORK_PRESETS,
  PendingWallet,
  Progress
} from "../../shared/types/app";

function randomId() {
  return crypto.randomUUID();
}

function safeJsonParse(text: string) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

function isStrongPassword(value: string) {
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

function maskKey(value: string) {
  if (!value) return "";
  return value.length <= 6 ? "***" : `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function toLocalConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    tron_api_key: "",
    auth_password_hash: "",
    auth_password_salt: "",
    hd_wallets: config.hd_wallets.map((wallet) => ({
      ...wallet,
      enc_mnemonic: ""
    }))
  };
}

function toSecurePayload(config: AppConfig) {
  return {
    tron_api_key: config.tron_api_key,
    auth_password_hash: config.auth_password_hash,
    auth_password_salt: config.auth_password_salt,
    auth_password_iters: config.auth_password_iters,
    auth_session_minutes: config.auth_session_minutes,
    wallet_secrets: config.hd_wallets.map((wallet) => ({
      id: wallet.id,
      enc_mnemonic: wallet.enc_mnemonic || ""
    }))
  };
}

function mergeSecureIntoConfig(base: AppConfig, secure: any): AppConfig {
  const secretMap = new Map<string, string>();
  if (Array.isArray(secure?.wallet_secrets)) {
    for (const item of secure.wallet_secrets) {
      const id = String(item?.id ?? "");
      if (!id) continue;
      secretMap.set(id, String(item?.enc_mnemonic ?? ""));
    }
  }
  return {
    ...base,
    tron_api_key: String(secure?.tron_api_key ?? base.tron_api_key ?? ""),
    auth_password_hash: String(secure?.auth_password_hash ?? base.auth_password_hash ?? ""),
    auth_password_salt: String(secure?.auth_password_salt ?? base.auth_password_salt ?? ""),
    auth_password_iters: Number(secure?.auth_password_iters ?? base.auth_password_iters ?? 100_000),
    auth_session_minutes: Number(secure?.auth_session_minutes ?? base.auth_session_minutes ?? 30),
    hd_wallets: base.hd_wallets.map((wallet) => ({
      ...wallet,
      enc_mnemonic: secretMap.get(wallet.id) ?? ""
    }))
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<
    "overview" | "sign" | "quick" | "transfer" | "refblock" | "broadcast" | "scan" | "wallet"
  >("overview");
  const [appInfo, setAppInfo] = useState<{ version: string; platform: string; userDataPath: string } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [config, setConfig] = useState<AppConfig>(() => loadConfigFromStorage());
  const [loginLocked, setLoginLocked] = useState(false);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLockUntil, setLoginLockUntil] = useState<number | null>(null);
  const [loginFailCount, setLoginFailCount] = useState(0);
  const [unlockAt, setUnlockAt] = useState<number | null>(null);
  const [secureReady, setSecureReady] = useState(false);
  const sessionTimerRef = useRef<number | null>(null);
  const previewRequestedRef = useRef<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"config" | "collection" | "security">("config");
  const [collectionName, setCollectionName] = useState("");
  const [collectionAddress, setCollectionAddress] = useState("");
  const [collectionError, setCollectionError] = useState("");
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [selectedWalletId, setSelectedWalletId] = useState("");

  // 离线签名表单
  const [addressAmountCsv, setAddressAmountCsv] = useState("index,address,amount\n");
  const [walletSignPassword, setWalletSignPassword] = useState("");
  const [refBlockJsonInput, setRefBlockJsonInput] = useState("");
  const [signOutputPath, setSignOutputPath] = useState("signed_txs.json");
  const [signResult, setSignResult] = useState<string>("");
  const [signJsonPreview, setSignJsonPreview] = useState("{}");
  const [signLoading, setSignLoading] = useState(false);
  const [quickAddressAmountCsv, setQuickAddressAmountCsv] = useState("index,address,amount\n");
  const [quickPassword, setQuickPassword] = useState("");
  const [quickResult, setQuickResult] = useState("");
  const [quickLoading, setQuickLoading] = useState(false);

  // 广播
  const [signedJsonText, setSignedJsonText] = useState("{\"signed_txs\":[]}");
  const [broadcastOutputPath, setBroadcastOutputPath] = useState("broadcast_results.json");
  const [broadcastResult, setBroadcastResult] = useState<string>("");
  const [broadcastLoading, setBroadcastLoading] = useState(false);

  // 扫描
  const [scanAddressCsv, setScanAddressCsv] = useState("index,address\n");
  const [scanThreshold, setScanThreshold] = useState("1");
  const [scanResult, setScanResult] = useState<string>("");
  const [scanSummary, setScanSummary] = useState<string>("");
  const [scanOverCsv, setScanOverCsv] = useState<string>("");
  const [scanLoading, setScanLoading] = useState(false);

  // 转账
  const [transferAsset, setTransferAsset] = useState<"TRX" | "USDT">("USDT");
  const [transferToAddress, setTransferToAddress] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferPassword, setTransferPassword] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferResult, setTransferResult] = useState("");
  const [transferPreviewLoading, setTransferPreviewLoading] = useState(false);
  const [transferAddressPreview, setTransferAddressPreview] = useState<Array<{ index: number; address: string }>>([]);
  const [transferIndex, setTransferIndex] = useState(0);
  const [transferBalanceLoading, setTransferBalanceLoading] = useState(false);
  const [transferBalances, setTransferBalances] = useState<{ trx: string; usdt: string | null } | null>(null);
  const [transferBalanceError, setTransferBalanceError] = useState("");

  // 钱包管理
  const [walletName, setWalletName] = useState("");
  const [walletPassword, setWalletPassword] = useState("");
  const [walletPasswordConfirm, setWalletPasswordConfirm] = useState("");
  const [walletCreateMnemonic, setWalletCreateMnemonic] = useState("");
  const [walletCreateXpub, setWalletCreateXpub] = useState("");
  const [walletCreateAddress, setWalletCreateAddress] = useState("");
  const [walletCreateAddresses, setWalletCreateAddresses] = useState<string[]>([]);
  const [walletCreateResult, setWalletCreateResult] = useState("");
  const [walletCreateLoading, setWalletCreateLoading] = useState(false);
  const [walletCreateStage, setWalletCreateStage] = useState<"form" | "verify">("form");
  const [walletPasswordAcknowledge, setWalletPasswordAcknowledge] = useState(false);
  const [walletBackupConfirmed, setWalletBackupConfirmed] = useState(false);
  const [walletMnemonicConfirm, setWalletMnemonicConfirm] = useState("");
  const [walletBackupError, setWalletBackupError] = useState("");
  const [pendingWallet, setPendingWallet] = useState<PendingWallet | null>(null);
  const [walletFormTab, setWalletFormTab] = useState<"create" | "import">("create");
  const [walletImportName, setWalletImportName] = useState("");
  const [walletImportMnemonic, setWalletImportMnemonic] = useState("");
  const [walletImportPassword, setWalletImportPassword] = useState("");
  const [walletImportPasswordConfirm, setWalletImportPasswordConfirm] = useState("");
  const [walletImportPasswordAcknowledge, setWalletImportPasswordAcknowledge] = useState(false);
  const [walletImportResult, setWalletImportResult] = useState("");
  const [walletImportLoading, setWalletImportLoading] = useState(false);
  const [walletDeleteTarget, setWalletDeleteTarget] = useState<HdWallet | null>(null);
  const [walletDeletePassword, setWalletDeletePassword] = useState("");
  const [walletDeleteError, setWalletDeleteError] = useState("");
  const [walletDeleteLoading, setWalletDeleteLoading] = useState(false);

  // 区块引用
  const [refblockLoading, setRefblockLoading] = useState(false);
  const [refblockExportResult, setRefblockExportResult] = useState("");
  const [securityCurrentPassword, setSecurityCurrentPassword] = useState("");
  const [securityNewPassword, setSecurityNewPassword] = useState("");
  const [securityNewPasswordConfirm, setSecurityNewPasswordConfirm] = useState("");
  const [securityResult, setSecurityResult] = useState("");

  const selectedCollection = useMemo(
    () => config.collection_addresses.find((item) => item.id === selectedCollectionId),
    [config.collection_addresses, selectedCollectionId]
  );
  const selectedWallet = useMemo(
    () => config.hd_wallets.find((item) => item.id === selectedWalletId),
    [config.hd_wallets, selectedWalletId]
  );
  const maskedConfig = useMemo(() => {
    return {
      ...config,
      tron_api_key: maskKey(config.tron_api_key),
      auth_password_hash: config.auth_password_hash ? "[REDACTED]" : "",
      auth_password_salt: config.auth_password_salt ? "[REDACTED]" : "",
      hd_wallets: config.hd_wallets.map((wallet) => ({
        ...wallet,
        enc_mnemonic: wallet.enc_mnemonic ? "[REDACTED]" : ""
      }))
    };
  }, [config]);
  const toAddress = selectedCollection?.address ?? "";

  useEffect(() => {
    window.api.appInfo().then(setAppInfo);
    const offLog = window.api.onLog((message) => setLogs((prev) => [message, ...prev].slice(0, 500)));
    const offProgress = window.api.onProgress((payload) => setProgress(payload));
    return () => {
      offLog();
      offProgress();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.api
      .loadSecureConfig()
      .then((secure) => {
        if (cancelled) return;
        setConfig((prev) => {
          const merged = mergeSecureIntoConfig(prev, secure);
          setLoginLocked(Boolean(merged.auth_password_hash));
          return merged;
        });
        setSecureReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setLoginLocked(Boolean(config.auth_password_hash));
          setSecureReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(toLocalConfig(config)));
    } catch {
      // ignore storage errors
    }
  }, [config]);

  useEffect(() => {
    if (!secureReady) return;
    window.api.saveSecureConfig(toSecurePayload(config)).catch(() => {
      // ignore persistence errors
    });
  }, [config, secureReady]);

  useEffect(() => {
    if (!config.auth_password_hash) {
      if (loginLocked) setLoginLocked(false);
      return;
    }
  }, [config.auth_password_hash, loginLocked]);

  useEffect(() => {
    if (sessionTimerRef.current) {
      window.clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    if (loginLocked || !config.auth_password_hash) return;
    const minutesRaw = Number(config.auth_session_minutes || 30);
    const minutes = Number.isFinite(minutesRaw) && minutesRaw > 0 ? minutesRaw : 30;
    const base = unlockAt ?? Date.now();
    const expiresAt = base + minutes * 60 * 1000;
    const remaining = Math.max(0, expiresAt - Date.now());
    sessionTimerRef.current = window.setTimeout(() => {
      setLoginLocked(true);
      setLoginError("登录已过期，请重新输入密码");
      setLoginPassword("");
      setUnlockAt(null);
    }, remaining);
    return () => {
      if (sessionTimerRef.current) {
        window.clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = null;
      }
    };
  }, [loginLocked, config.auth_password_hash, config.auth_session_minutes, unlockAt]);

  useEffect(() => {
    // 实时预览 JSON，便于导出与校验
    let addressAmount: Array<{ address: string; amount: string }> = [];
    try {
      addressAmount = parseAddressAmountCsv(addressAmountCsv);
    } catch {
      // 预览阶段忽略 CSV 解析异常，提交时再给出明确错误
      addressAmount = [];
    }
    const items = addressAmount.map((row) => ({
      from: row.address,
      amount: row.amount
    }));

    let refBlock = {
      ref_block_bytes: "",
      ref_block_hash: "",
      timestamp: 0,
      expiration: 0
    };
    try {
      if (refBlockJsonInput.trim()) {
        refBlock = JSON.parse(refBlockJsonInput);
      }
    } catch {
      // 预览阶段不抛错，最终签名会校验
    }

    const input = {
      contract_address: config.usdt_contract,
      to: toAddress,
      decimals: config.decimals,
      fee_limit: config.fee_limit,
      timestamp: Number(refBlock.timestamp || 0),
      expiration: Number(refBlock.expiration || 0),
      ref_block_bytes: String(refBlock.ref_block_bytes || ""),
      ref_block_hash: String(refBlock.ref_block_hash || ""),
      items
    };
    setSignJsonPreview(JSON.stringify(input, null, 2));
  }, [config, toAddress, addressAmountCsv, refBlockJsonInput]);

  const progressText = useMemo(() => {
    if (!progress) return "";
    return `${progress.stage}: ${progress.current}/${progress.total}`;
  }, [progress]);
  const currentNetworkKey =
    config.network === NETWORK_PRESETS.testnet.network ? "testnet" : "mainnet";
  const networkLabel = NETWORK_PRESETS[currentNetworkKey].label;

  useEffect(() => {
    if (config.collection_addresses.length === 0) {
      if (selectedCollectionId) setSelectedCollectionId("");
      return;
    }
    const exists = config.collection_addresses.some((item) => item.id === selectedCollectionId);
    if (!exists) setSelectedCollectionId(config.collection_addresses[0].id);
  }, [config.collection_addresses, selectedCollectionId]);

  useEffect(() => {
    if (config.hd_wallets.length === 0) {
      if (selectedWalletId) setSelectedWalletId("");
      return;
    }
    const exists = config.hd_wallets.some((item) => item.id === selectedWalletId);
    if (!exists) setSelectedWalletId(config.hd_wallets[0].id);
  }, [config.hd_wallets, selectedWalletId]);

  useEffect(() => {
    if (config.hd_wallets.length === 0) return;
    const targets = config.hd_wallets.filter(
      (item) =>
        (!item.preview_addresses || item.preview_addresses.length < 2) &&
        !previewRequestedRef.current.has(item.id)
    );
    if (targets.length === 0) return;
    targets.forEach(async (wallet) => {
      previewRequestedRef.current.add(wallet.id);
      try {
        const res = await window.api.hdDeriveXpub({ xpub: wallet.xpub, indices: [0, 1] });
        const addresses = Array.isArray(res?.items)
          ? res.items.map((i: any) => i.address).filter(Boolean).slice(0, 2)
          : [];
        if (addresses.length > 0) {
          setConfig((prev) => ({
            ...prev,
            hd_wallets: prev.hd_wallets.map((item) =>
              item.id === wallet.id ? { ...item, preview_addresses: addresses } : item
            )
          }));
        }
      } catch {
        // ignore preview errors
      }
    });
  }, [config.hd_wallets]);

  useEffect(() => {
    if (activeTab !== "transfer") return;
    if (!selectedWallet?.xpub) {
      setTransferAddressPreview([]);
      setTransferBalances(null);
      setTransferBalanceError("");
      return;
    }
    let cancelled = false;
    async function loadPreview() {
      setTransferPreviewLoading(true);
      try {
        const indices = Array.from({ length: 20 }, (_, idx) => idx);
        const res = await window.api.hdDeriveXpub({ xpub: selectedWallet.xpub, indices });
        if (cancelled) return;
        const items = Array.isArray(res?.items)
          ? res.items
              .map((i: any) => ({
                index: Number(i.index),
                address: String(i.address || "")
              }))
              .filter((i: any) => Number.isInteger(i.index) && i.address)
          : [];
        setTransferAddressPreview(items);
        if (items.length > 0 && !items.some((i: any) => i.index === transferIndex)) {
          setTransferIndex(items[0].index);
        }
      } catch {
        if (!cancelled) setTransferAddressPreview([]);
      } finally {
        if (!cancelled) setTransferPreviewLoading(false);
      }
    }
    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedWallet?.xpub]);

  useEffect(() => {
    if (activeTab !== "transfer") return;
    const item = transferAddressPreview.find((i) => i.index === transferIndex);
    if (!item?.address) {
      setTransferBalances(null);
      return;
    }
    fetchTransferBalances(item.address);
  }, [
    activeTab,
    transferIndex,
    transferAddressPreview,
    config.full_host,
    config.tron_api_key,
    config.usdt_contract,
    config.decimals
  ]);

  function updateConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function reportError(message: string) {
    setErrorMessage(message);
  }

  function shortAddress(address: string) {
    if (!address) return "";
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  function formatUnits(value: string, decimals: number) {
    try {
      const v = BigInt(value || "0");
      const sign = v < 0n ? "-" : "";
      const abs = v < 0n ? -v : v;
      if (decimals <= 0) return `${sign}${abs.toString()}`;
      const base = 10n ** BigInt(decimals);
      const intPart = abs / base;
      const fracPart = abs % base;
      const fracRaw = fracPart.toString().padStart(decimals, "0");
      const frac = fracRaw.replace(/0+$/, "");
      return frac ? `${sign}${intPart.toString()}.${frac}` : `${sign}${intPart.toString()}`;
    } catch {
      return value || "0";
    }
  }

  function parseUnits(value: string, decimals: number) {
    const s = String(value || "").trim();
    if (!/^\d+(\.\d+)?$/.test(s)) {
      throw new Error("金额格式不正确");
    }
    const [i, f = ""] = s.split(".");
    if (f.length > decimals) {
      throw new Error(`金额小数位过多，最多 ${decimals} 位`);
    }
    const frac = f.padEnd(decimals, "0");
    return BigInt(i + frac);
  }

  async function fetchTransferBalances(address: string) {
    if (!config.full_host) {
      setTransferBalances(null);
      setTransferBalanceError("full_host 未设置");
      return;
    }
    setTransferBalanceLoading(true);
    setTransferBalanceError("");
    try {
      const contract =
        config.usdt_contract && config.usdt_contract !== "REPLACE_WITH_USDT_CONTRACT"
          ? config.usdt_contract
          : undefined;
      const res = await window.api.walletGetBalances({
        fullHost: config.full_host,
        tron_api_key: config.tron_api_key,
        address,
        usdt_contract: contract
      });
      setTransferBalances({
        trx: res.trxSun ?? "0",
        usdt: res.usdtSun ?? null
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setTransferBalances(null);
      setTransferBalanceError(msg);
    } finally {
      setTransferBalanceLoading(false);
    }
  }

  function openCollectionSettings() {
    setSettingsTab("collection");
    setSettingsOpen(true);
  }

  function resetCollectionForm() {
    setCollectionName("");
    setCollectionAddress("");
    setCollectionError("");
    setEditingCollectionId(null);
  }

  function handleSaveCollection() {
    const name = collectionName.trim();
    const address = collectionAddress.trim();
    if (!name || !address) {
      setCollectionError("请填写归集地址名称与地址");
      return;
    }
    const duplicate = config.collection_addresses.find(
      (item) => item.address === address && item.id !== editingCollectionId
    );
    if (duplicate) {
      setCollectionError("该归集地址已存在，请勿重复添加");
      return;
    }
    setConfig((prev) => {
      const list = [...prev.collection_addresses];
      if (editingCollectionId) {
        const idx = list.findIndex((item) => item.id === editingCollectionId);
        if (idx >= 0) {
          list[idx] = { ...list[idx], name, address };
        }
      } else {
        list.unshift({ id: randomId(), name, address });
      }
      return { ...prev, collection_addresses: list };
    });
    resetCollectionForm();
  }

  function handleEditCollection(item: CollectionAddress) {
    setEditingCollectionId(item.id);
    setCollectionName(item.name);
    setCollectionAddress(item.address);
    setCollectionError("");
    setSettingsTab("collection");
    setSettingsOpen(true);
  }

  function handleDeleteCollection(id: string) {
    setConfig((prev) => ({
      ...prev,
      collection_addresses: prev.collection_addresses.filter((item) => item.id !== id)
    }));
    if (selectedCollectionId === id) {
      setSelectedCollectionId("");
    }
  }

  function shortXpub(value: string) {
    if (!value) return "";
    if (value.length <= 18) return value;
    return `${value.slice(0, 8)}...${value.slice(-6)}`;
  }

  function resetWalletCreateForm() {
    setWalletName("");
    setWalletPassword("");
    setWalletPasswordConfirm("");
    setWalletCreateMnemonic("");
    setWalletCreateXpub("");
    setWalletCreateAddress("");
    setWalletCreateAddresses([]);
    setWalletCreateResult("");
    setWalletCreateLoading(false);
    setWalletCreateStage("form");
    setWalletPasswordAcknowledge(false);
    setWalletBackupConfirmed(false);
    setWalletMnemonicConfirm("");
    setWalletBackupError("");
    setPendingWallet(null);
  }

  function resetWalletImportForm() {
    setWalletImportName("");
    setWalletImportMnemonic("");
    setWalletImportPassword("");
    setWalletImportPasswordConfirm("");
    setWalletImportPasswordAcknowledge(false);
    setWalletImportResult("");
    setWalletImportLoading(false);
  }

  async function verifyAuthPassword(password: string) {
    if (!config.auth_password_hash || !config.auth_password_salt) return false;
    const salt = fromBase64(config.auth_password_salt);
    const iters = Number(config.auth_password_iters || 100_000);
    const hash = await derivePasswordHash(password, salt, iters);
    return hash === config.auth_password_hash;
  }

  async function handleLogin() {
    setLoginError("");
    const now = Date.now();
    if (loginLockUntil && loginLockUntil > now) {
      const seconds = Math.ceil((loginLockUntil - now) / 1000);
      setLoginError(`尝试过于频繁，请 ${seconds} 秒后重试`);
      return;
    }
    if (!loginPassword.trim()) {
      setLoginError("请输入登录密码");
      return;
    }
    try {
      const ok = await verifyAuthPassword(loginPassword.trim());
      if (!ok) {
        const nextFailCount = loginFailCount + 1;
        const delayMs = Math.min(30_000, 1_000 * Math.pow(2, Math.max(0, nextFailCount - 1)));
        setLoginFailCount(nextFailCount);
        setLoginLockUntil(Date.now() + delayMs);
        setLoginError(`密码错误，请 ${Math.ceil(delayMs / 1000)} 秒后重试`);
        return;
      }
      setLoginLocked(false);
      setLoginPassword("");
      setUnlockAt(Date.now());
      setLoginLockUntil(null);
      setLoginFailCount(0);
    } catch (e: any) {
      setLoginError(e?.message ?? String(e));
    }
  }

  function handleLogout() {
    setLoginLocked(true);
    setLoginPassword("");
    setLoginError("");
    setUnlockAt(null);
  }

  async function handleSetLoginPassword() {
    setSecurityResult("");
    if (!securityNewPassword || !securityNewPasswordConfirm) {
      setSecurityResult("请填写新密码与确认密码");
      return;
    }
    if (securityNewPassword !== securityNewPasswordConfirm) {
      setSecurityResult("两次输入的密码不一致");
      return;
    }
    if (!isStrongPassword(securityNewPassword)) {
      setSecurityResult("密码至少 8 位，需包含字母和数字");
      return;
    }
    try {
      if (config.auth_password_hash) {
        const ok = await verifyAuthPassword(securityCurrentPassword);
        if (!ok) {
          setSecurityResult("当前密码不正确");
          return;
        }
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iters = 200_000;
      const hash = await derivePasswordHash(securityNewPassword, salt, iters);
      setConfig((prev) => ({
        ...prev,
        auth_password_hash: hash,
        auth_password_salt: toBase64(salt),
        auth_password_iters: iters
      }));
      setSecurityResult("登录密码已设置");
      setSecurityCurrentPassword("");
      setSecurityNewPassword("");
      setSecurityNewPasswordConfirm("");
    } catch (e: any) {
      setSecurityResult(e?.message ?? String(e));
    }
  }

  async function handleClearLoginPassword() {
    setSecurityResult("");
    if (!config.auth_password_hash) {
      setSecurityResult("当前未设置登录密码");
      return;
    }
    try {
      const ok = await verifyAuthPassword(securityCurrentPassword);
      if (!ok) {
        setSecurityResult("当前密码不正确");
        return;
      }
      setConfig((prev) => ({
        ...prev,
        auth_password_hash: "",
        auth_password_salt: "",
        auth_password_iters: 100_000
      }));
      setSecurityResult("登录密码已清除");
      setSecurityCurrentPassword("");
      setSecurityNewPassword("");
      setSecurityNewPasswordConfirm("");
      setLoginLocked(false);
    } catch (e: any) {
      setSecurityResult(e?.message ?? String(e));
    }
  }

  async function handleCreateHdWallet() {
    if (walletCreateLoading) return;
    if (walletCreateStage !== "form") return;
    setWalletCreateResult("");
    setWalletBackupError("");
    const name = walletName.trim() || `HD 钱包 ${config.hd_wallets.length + 1}`;
    if (!walletPassword || !walletPasswordConfirm) {
      setWalletCreateResult("请填写加密密码与确认密码");
      return;
    }
    if (walletPassword !== walletPasswordConfirm) {
      setWalletCreateResult("两次输入的密码不一致");
      return;
    }
    if (!walletPasswordAcknowledge) {
      setWalletCreateResult("请先确认密码不可找回并继续");
      return;
    }
    if (!isStrongPassword(walletPassword)) {
      setWalletCreateResult("密码至少 8 位，需包含字母和数字");
      return;
    }
    setWalletCreateLoading(true);
    try {
      const res = await window.api.hdGenerate();
      const mnemonic = String(res?.mnemonic ?? "").trim();
      if (!mnemonic) {
        throw new Error("助记词生成失败");
      }
      const enc_mnemonic = await encryptSecret(mnemonic, walletPassword);
      const preview_addresses = Array.isArray(res.addresses)
        ? res.addresses.filter((v: any) => typeof v === "string" && v.trim())
        : [];
      setWalletCreateMnemonic(mnemonic);
      setWalletCreateXpub(String(res.xpub ?? ""));
      setWalletCreateAddress(String(res.address ?? ""));
      setWalletCreateAddresses(preview_addresses);
      setWalletCreateResult("请先完成助记词备份验证后再保存钱包。");
      setWalletCreateStage("verify");
      setPendingWallet({
        name,
        xpub: String(res.xpub ?? ""),
        enc_mnemonic,
        path_prefix: String(res.path_prefix ?? "m/44'/195'/0'/0"),
        preview_addresses
      });
    } catch (e: any) {
      setWalletCreateResult(e?.message ?? String(e));
    } finally {
      setWalletCreateLoading(false);
    }
  }

  function normalizeMnemonic(text: string) {
    return text
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .join(" ");
  }

  function handleConfirmWalletBackup() {
    setWalletBackupError("");
    if (!walletBackupConfirmed) {
      setWalletBackupError("请先确认已完成助记词备份");
      return;
    }
    const target = normalizeMnemonic(walletCreateMnemonic);
    const input = normalizeMnemonic(walletMnemonicConfirm);
    if (!input) {
      setWalletBackupError("请回填助记词以完成验证");
      return;
    }
    if (target !== input) {
      setWalletBackupError("助记词验证不一致，请重新输入");
      return;
    }
    if (!pendingWallet?.enc_mnemonic || !pendingWallet?.xpub) {
      setWalletBackupError("待保存钱包信息缺失，请重新创建");
      return;
    }
    const wallet: HdWallet = {
      id: randomId(),
      name: pendingWallet.name,
      xpub: pendingWallet.xpub,
      enc_mnemonic: pendingWallet.enc_mnemonic,
      path_prefix: pendingWallet.path_prefix,
      created_at: new Date().toISOString(),
      preview_addresses: pendingWallet.preview_addresses || []
    };
    setConfig((prev) => ({ ...prev, hd_wallets: [wallet, ...prev.hd_wallets] }));
    setWalletCreateResult("创建成功：钱包已保存。");
    setWalletCreateStage("form");
    setWalletCreateMnemonic("");
    setWalletCreateXpub("");
    setWalletCreateAddress("");
    setWalletCreateAddresses([]);
    setWalletBackupConfirmed(false);
    setWalletMnemonicConfirm("");
    setWalletBackupError("");
    setPendingWallet(null);
    setWalletPassword("");
    setWalletPasswordConfirm("");
    setWalletPasswordAcknowledge(false);
    setWalletName("");
  }

  async function handleImportHdWallet() {
    if (walletImportLoading) return;
    setWalletImportResult("");
    const name = walletImportName.trim() || `HD 钱包 ${config.hd_wallets.length + 1}`;
    const mnemonic = walletImportMnemonic.trim();
    if (!mnemonic) {
      setWalletImportResult("请先输入助记词");
      return;
    }
    if (!walletImportPassword || !walletImportPasswordConfirm) {
      setWalletImportResult("请填写加密密码与确认密码");
      return;
    }
    if (walletImportPassword !== walletImportPasswordConfirm) {
      setWalletImportResult("两次输入的密码不一致");
      return;
    }
    if (!walletImportPasswordAcknowledge) {
      setWalletImportResult("请先确认密码不可找回并继续");
      return;
    }
    if (!isStrongPassword(walletImportPassword)) {
      setWalletImportResult("密码至少 8 位，需包含字母和数字");
      return;
    }
    setWalletImportLoading(true);
    try {
      const res = await window.api.hdFromMnemonic({ mnemonic });
      const enc_mnemonic = await encryptSecret(mnemonic, walletImportPassword);
      const preview_addresses = Array.isArray(res.addresses)
        ? res.addresses.filter((v: any) => typeof v === "string" && v.trim())
        : [];
      const wallet: HdWallet = {
        id: randomId(),
        name,
        xpub: String(res.xpub ?? ""),
        enc_mnemonic,
        path_prefix: String(res.path_prefix ?? "m/44'/195'/0'/0"),
        created_at: new Date().toISOString(),
        preview_addresses
      };
      setConfig((prev) => ({ ...prev, hd_wallets: [wallet, ...prev.hd_wallets] }));
      setWalletImportResult("导入成功：助记词已加密保存。");
      setWalletImportMnemonic("");
      setWalletImportPassword("");
      setWalletImportPasswordConfirm("");
      setWalletImportPasswordAcknowledge(false);
      setWalletImportName("");
    } catch (e: any) {
      setWalletImportResult(e?.message ?? String(e));
    } finally {
      setWalletImportLoading(false);
    }
  }

  function handleDeleteHdWallet(wallet: HdWallet) {
    setWalletDeleteTarget(wallet);
    setWalletDeletePassword("");
    setWalletDeleteError("");
    setWalletDeleteLoading(false);
  }

  function closeWalletDeleteModal() {
    if (walletDeleteLoading) return;
    setWalletDeleteTarget(null);
    setWalletDeletePassword("");
    setWalletDeleteError("");
  }

  async function handleConfirmDeleteHdWallet() {
    if (!walletDeleteTarget || walletDeleteLoading) return;
    const password = walletDeletePassword.trim();
    if (!password) {
      setWalletDeleteError("请输入钱包加密密码");
      return;
    }
    setWalletDeleteLoading(true);
    setWalletDeleteError("");
    try {
      await decryptSecret(walletDeleteTarget.enc_mnemonic, password);
      const targetId = walletDeleteTarget.id;
      setConfig((prev) => ({ ...prev, hd_wallets: prev.hd_wallets.filter((item) => item.id !== targetId) }));
      setFeeInitMap((prev) => {
        if (!prev[targetId]) return prev;
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
      if (selectedWalletId === targetId) setSelectedWalletId("");
      closeWalletDeleteModal();
    } catch (e: any) {
      setWalletDeleteError(e?.message ?? "钱包加密密码错误");
    } finally {
      setWalletDeleteLoading(false);
    }
  }

  function handleSwitchNetwork(next: keyof typeof NETWORK_PRESETS) {
    const preset = NETWORK_PRESETS[next];
    setConfig((prev) => ({
      ...prev,
      network: preset.network,
      full_host: preset.full_host,
      usdt_contract: preset.usdt_contract,
      decimals: preset.decimals
    }));
  }

  async function handleLoadAddressAmountCsv() {
    const file = await window.api.selectOpenFile({ filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!file) return;
    const text = await window.api.readTextFile(file.token);
    setAddressAmountCsv(text);
  }


  async function handlePickSignOutput() {
    const file = await window.api.selectSaveFile({
      defaultPath: "signed_txs.json",
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (file) setSignOutputPath(file.filePath);
  }

  async function handleSign() {
    if (signLoading) return;
    setSignLoading(true);
    setSignResult("");
    setErrorMessage("");
    if (!toAddress) {
      setSignResult("请先在设置中添加归集地址并选择目标地址");
      reportError("请先在设置中添加归集地址并选择目标地址");
      setSignLoading(false);
      return;
    }
    if (!selectedWallet) {
      setSignResult("请先在钱包管理中创建并选择 HD 钱包");
      reportError("请先在钱包管理中创建并选择 HD 钱包");
      setSignLoading(false);
      return;
    }
    if (!walletSignPassword.trim()) {
      setSignResult("请填写 HD 钱包加密密码");
      reportError("请填写 HD 钱包加密密码");
      setSignLoading(false);
      return;
    }
    if (!config.usdt_contract || config.usdt_contract === "REPLACE_WITH_USDT_CONTRACT") {
      setSignResult("USDT 合约地址未设置，请在设置中填写");
      reportError("USDT 合约地址未设置，请在设置中填写");
      setSignLoading(false);
      return;
    }
    try {
      const obj = JSON.parse(refBlockJsonInput || "{}");
      if (!obj.ref_block_bytes || !obj.ref_block_hash || !obj.timestamp || !obj.expiration) {
        setSignResult("区块引用 JSON 不完整，请在“区块引用”页获取后粘贴");
        reportError("区块引用 JSON 不完整，请在“区块引用”页获取后粘贴");
        setSignLoading(false);
        return;
      }
    } catch (e: any) {
      setSignResult(`区块引用 JSON 无法解析: ${e?.message ?? String(e)}`);
      reportError(`区块引用 JSON 无法解析: ${e?.message ?? String(e)}`);
      setSignLoading(false);
      return;
    }

    const addressAmount = parseAddressAmountCsv(addressAmountCsv);
    if (addressAmount.length === 0) {
      setSignResult("地址 + 金额 CSV 为空或格式不正确");
      reportError("地址 + 金额 CSV 为空或格式不正确");
      setSignLoading(false);
      return;
    }
    const invalidRow = addressAmount.findIndex((row: any) => !row.address || !row.amount);
    if (invalidRow >= 0) {
      const msg = `第 ${invalidRow + 1} 行地址或金额为空`;
      setSignResult(msg);
      reportError(msg);
      setSignLoading(false);
      return;
    }
    const hasIndex = addressAmount.some((row: any) => Number.isInteger(row.index));
    if (!hasIndex) {
      setSignResult("CSV 必须包含 index 列，用于非连续地址派生");
      reportError("CSV 必须包含 index 列，用于非连续地址派生");
      setSignLoading(false);
      return;
    }
    let refBlock = {
      ref_block_bytes: "",
      ref_block_hash: "",
      timestamp: 0,
      expiration: 0
    };
    try {
      if (refBlockJsonInput.trim()) {
        refBlock = JSON.parse(refBlockJsonInput);
      }
    } catch {
      // 这里保持与预览一致，由后续校验处理
    }

    let indices: number[] = [];
    try {
      indices = addressAmount.map((row: any, idx: number) => {
        const index = Number(row.index);
        if (!Number.isInteger(index) || index < 0) {
          throw new Error(`第 ${idx + 1} 行 index 无效`);
        }
        return index;
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setSignResult(msg);
      reportError(msg);
      setSignLoading(false);
      return;
    }

    const input = {
      contract_address: config.usdt_contract,
      to: toAddress,
      decimals: config.decimals,
      fee_limit: config.fee_limit,
      timestamp: Number(refBlock.timestamp || 0),
      expiration: Number(refBlock.expiration || 0),
      ref_block_bytes: String(refBlock.ref_block_bytes || ""),
      ref_block_hash: String(refBlock.ref_block_hash || ""),
      items: addressAmount.map((row: any) => ({
        from: row.address,
        amount: row.amount
      }))
    };

    const missingKeys = input.items.filter((i: any) => !i.amount || !i.from);
    if (missingKeys.length > 0) {
      const msg = `存在 ${missingKeys.length} 条地址缺少金额或地址`;
      setSignResult(msg);
      reportError(msg);
      setSignLoading(false);
      return;
    }

    const taskId = randomId();
    try {
      const res = await window.api.collectSignHd({
        input,
        outputPath: signOutputPath,
        taskId,
        enc_mnemonic: selectedWallet.enc_mnemonic,
        password: walletSignPassword.trim(),
        indices
      });
      setSignResult(`完成: ${res.count} 笔签名\n输出: ${res.outputPath}`);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setSignResult(msg);
      reportError(msg);
    } finally {
      setSignLoading(false);
    }
  }

  async function handleQuickCollect() {
    if (quickLoading) return;
    setQuickLoading(true);
    setQuickResult("");
    setErrorMessage("");
    if (!toAddress) {
      const msg = "请先在设置中添加归集地址并选择目标地址";
      setQuickResult(msg);
      reportError(msg);
      setQuickLoading(false);
      return;
    }
    if (!selectedWallet) {
      const msg = "请先在钱包管理中创建并选择 HD 钱包";
      setQuickResult(msg);
      reportError(msg);
      setQuickLoading(false);
      return;
    }
    if (!quickPassword.trim()) {
      const msg = "请填写 HD 钱包解密密码";
      setQuickResult(msg);
      reportError(msg);
      setQuickLoading(false);
      return;
    }
    if (!config.full_host) {
      const msg = "full_host 未设置，请在设置中填写";
      setQuickResult(msg);
      reportError(msg);
      setQuickLoading(false);
      return;
    }
    if (!config.usdt_contract || config.usdt_contract === "REPLACE_WITH_USDT_CONTRACT") {
      const msg = "USDT 合约地址未设置，请在设置中填写";
      setQuickResult(msg);
      reportError(msg);
      setQuickLoading(false);
      return;
    }

    let addressAmount: Array<{ index?: number; address: string; amount: string }> = [];
    try {
      addressAmount = parseAddressAmountCsv(quickAddressAmountCsv);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setQuickResult(msg);
      reportError(msg);
      setQuickLoading(false);
      return;
    }
    if (addressAmount.length === 0) {
      const msg = "地址 + 金额 CSV 为空或格式不正确";
      setQuickResult(msg);
      reportError(msg);
      setQuickLoading(false);
      return;
    }

    const invalidRow = addressAmount.findIndex((row: any) => !row.address || !row.amount);
    if (invalidRow >= 0) {
      const msg = `第 ${invalidRow + 1} 行地址或金额为空`;
      setQuickResult(msg);
      reportError(msg);
      setQuickLoading(false);
      return;
    }

    const hasIndex = addressAmount.some((row: any) => Number.isInteger(row.index));
    if (!hasIndex) {
      const msg = "CSV 必须包含 index 列，用于非连续地址派生";
      setQuickResult(msg);
      reportError(msg);
      setQuickLoading(false);
      return;
    }

    let indices: number[] = [];
    try {
      indices = addressAmount.map((row: any, idx: number) => {
        const index = Number(row.index);
        if (!Number.isInteger(index) || index < 0) {
          throw new Error(`第 ${idx + 1} 行 index 无效`);
        }
        return index;
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setQuickResult(msg);
      reportError(msg);
      setQuickLoading(false);
      return;
    }

    const taskId = randomId();
    try {
      const res = await window.api.quickCollect({
        fullHost: config.full_host,
        tron_api_key: config.tron_api_key,
        usdt_contract: config.usdt_contract,
        decimals: config.decimals,
        fee_limit: config.fee_limit,
        to: toAddress,
        items: addressAmount.map((row: any) => ({
          from: row.address,
          amount: row.amount
        })),
        taskId,
        enc_mnemonic: selectedWallet.enc_mnemonic,
        password: quickPassword.trim(),
        indices
      });
      const summary = `快捷归集完成: 签名=${res.signed}, 成功=${res.success}, 失败=${res.fail}`;
      const errorDetails = res.fail > 0 ? formatBroadcastErrors(res.results) : "";
      const combined = errorDetails ? `${summary}\n\n失败详情:\n${errorDetails}` : summary;
      setQuickResult(combined);
      if (errorDetails) reportError(errorDetails);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setQuickResult(msg);
      reportError(msg);
    } finally {
      setQuickLoading(false);
    }
  }

  async function handleFetchRefBlock() {
    if (refblockLoading) return;
    setRefblockLoading(true);
    setRefblockExportResult("");
    setErrorMessage("");
    try {
      if (!config.full_host) {
        setSignResult("full_host 未设置，请在设置中填写");
        reportError("full_host 未设置，请在设置中填写");
        return;
      }
      const data = await window.api.fetchRefBlock({
        fullHost: config.full_host,
        tron_api_key: config.tron_api_key
      });
      setRefBlockJsonInput(JSON.stringify(data, null, 2));
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setSignResult(msg);
      reportError(msg);
    } finally {
      setRefblockLoading(false);
    }
  }

  async function handleExportRefBlock() {
    if (!refBlockJsonInput.trim()) {
      setRefblockExportResult("请先获取或粘贴区块引用 JSON");
      return;
    }
    const parsed = safeJsonParse(refBlockJsonInput);
    if (!parsed.ok) {
      setRefblockExportResult(`JSON 无法解析: ${parsed.error}`);
      return;
    }
    const file = await window.api.selectSaveFile({
      defaultPath: "refblock.json",
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (!file) return;
    await window.api.writeTextFile(file.token, JSON.stringify(parsed.value, null, 2));
    setRefblockExportResult(`已导出：${file.filePath}`);
  }

  async function handleLoadSignedJson() {
    const file = await window.api.selectOpenFile({ filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!file) return;
    const text = await window.api.readTextFile(file.token);
    setSignedJsonText(text);
  }

  async function handleLoadRefBlockJson() {
    const file = await window.api.selectOpenFile({ filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!file) return;
    const text = await window.api.readTextFile(file.token);
    setRefBlockJsonInput(text);
  }

  async function handlePickBroadcastOutput() {
    const file = await window.api.selectSaveFile({
      defaultPath: "broadcast_results.json",
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (file) setBroadcastOutputPath(file.filePath);
  }

  async function handleBroadcast() {
    if (broadcastLoading) return;
    setBroadcastLoading(true);
    setBroadcastResult("");
    setErrorMessage("");
    if (!config.full_host) {
      setBroadcastResult("full_host 未设置，请在设置中填写");
      reportError("full_host 未设置，请在设置中填写");
      setBroadcastLoading(false);
      return;
    }
    const parsed = safeJsonParse(signedJsonText);
    if (!parsed.ok) {
      const msg = `JSON 无法解析: ${parsed.error}`;
      setBroadcastResult(msg);
      reportError(msg);
      setBroadcastLoading(false);
      return;
    }
    const signedTxs = Array.isArray(parsed.value.signed_txs) ? parsed.value.signed_txs : parsed.value;
    const taskId = randomId();
    try {
      const res = await window.api.broadcast({
        fullHost: config.full_host,
        tron_api_key: config.tron_api_key,
        expectedContract: config.usdt_contract,
        signedTxs,
        outputPath: broadcastOutputPath || undefined,
        taskId
      });
      const summary = `完成: 成功=${res.success}, 失败=${res.fail}\n输出: ${res.outputPath ?? ""}`;
      const errorDetails = res.fail > 0 ? formatBroadcastErrors(res.results) : "";
      const hasMissingAccount = Array.isArray(res.results)
        ? res.results.some((r: any) => {
            const msgRaw = r?.message ?? r?.error ?? "";
            const msg = msgRaw
              ? String(decodeMaybeHex(decodeMaybeBase64(String(msgRaw)))).toLowerCase()
              : "";
            return msg.includes("account") && msg.includes("does not exist");
          })
        : false;
      const hint = hasMissingAccount
        ? "\n提示：发送地址在当前网络未激活或网络不匹配。请确保该地址在当前网络有 TRX 入账激活后再广播。"
        : "";
      const combined = errorDetails ? `${summary}\n\n失败详情:\n${errorDetails}${hint}` : `${summary}${hint}`;
      setBroadcastResult(combined);
      if (errorDetails) reportError(errorDetails);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setBroadcastResult(msg);
      reportError(msg);
    } finally {
      setBroadcastLoading(false);
    }
  }

  async function handleLoadScanCsv() {
    const file = await window.api.selectOpenFile({ filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!file) return;
    const text = await window.api.readTextFile(file.token);
    setScanAddressCsv(text);
  }

  async function handleScan() {
    if (scanLoading) return;
    setScanLoading(true);
    setScanResult("");
    setScanSummary("");
    setScanOverCsv("");
    setErrorMessage("");
    if (!config.full_host || !config.usdt_contract) {
      setScanResult("配置未完整，请在设置中填写");
      reportError("配置未完整，请在设置中填写");
      setScanLoading(false);
      return;
    }
    const rows = parseAddressCsv(scanAddressCsv);
    if (rows.length === 0) {
      setScanResult("地址列表为空");
      reportError("地址列表为空");
      setScanLoading(false);
      return;
    }
    const missingIndex = rows.findIndex((row: any) => !Number.isInteger(row.index));
    if (missingIndex >= 0) {
      const msg = `第 ${missingIndex + 1} 行缺少 index，扫描 CSV 必须包含 index,address`;
      setScanResult(msg);
      reportError(msg);
      setScanLoading(false);
      return;
    }
    const addresses = rows.map((row: any) => row.address);
    const indexMap = new Map<string, number>();
    rows.forEach((row: any) => {
      if (row.address && Number.isInteger(row.index)) indexMap.set(row.address, row.index);
    });
    const taskId = randomId();
    try {
      const res = await window.api.scanAddresses({
        fullHost: config.full_host,
        tron_api_key: config.tron_api_key,
        usdtContract: config.usdt_contract,
        decimals: config.decimals,
        addresses,
        threshold: scanThreshold,
        taskId
      });
      const summary =
        `本次共扫描 ${res.total_addresses} 个地址，` +
        `总金额 ${res.total_amount} USDT。` +
        `超过阈值 ${res.threshold} USDT 的地址有 ${res.count_over_threshold} 个，` +
        `其总金额为 ${res.total_over_threshold} USDT。`;
      setScanSummary(summary);
      if (Array.isArray(res.over_items) && res.over_items.length > 0) {
        const header = "index,address,amount";
        const out = res.over_items.map((i: any) => {
          const idx = indexMap.get(i.address);
          return `${idx ?? ""},${i.address},${i.amount}`;
        });
        setScanOverCsv([header, ...out].join("\n"));
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setScanResult(msg);
      reportError(msg);
    } finally {
      setScanLoading(false);
    }
  }

  async function handleExportScanCsv() {
    if (!scanOverCsv) return;
    const file = await window.api.selectSaveFile({
      defaultPath: "scan_addresses_amount.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }]
    });
    if (!file) return;
    await window.api.writeTextFile(file.token, scanOverCsv);
    setScanResult(`已导出：${file.filePath}`);
  }

  async function handleRefreshTransferPreview() {
    if (!selectedWallet?.xpub) {
      setTransferAddressPreview([]);
      return;
    }
    setTransferPreviewLoading(true);
    try {
      const indices = Array.from({ length: 20 }, (_, idx) => idx);
      const res = await window.api.hdDeriveXpub({ xpub: selectedWallet.xpub, indices });
      const items = Array.isArray(res?.items)
        ? res.items
            .map((i: any) => ({
              index: Number(i.index),
              address: String(i.address || "")
            }))
            .filter((i: any) => Number.isInteger(i.index) && i.address)
        : [];
      setTransferAddressPreview(items);
      if (items.length > 0 && !items.some((i: any) => i.index === transferIndex)) {
        setTransferIndex(items[0].index);
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setTransferResult(msg);
      reportError(msg);
    } finally {
      setTransferPreviewLoading(false);
    }
  }

  async function handleSendTransfer() {
    if (transferLoading) return;
    setTransferLoading(true);
    setTransferResult("");
    setErrorMessage("");
    if (!selectedWallet) {
      const msg = "请先在钱包管理中创建并选择 HD 钱包";
      setTransferResult(msg);
      reportError(msg);
      setTransferLoading(false);
      return;
    }
    if (!transferPassword.trim()) {
      const msg = "请填写 HD 钱包解密密码";
      setTransferResult(msg);
      reportError(msg);
      setTransferLoading(false);
      return;
    }
    if (!config.full_host) {
      const msg = "full_host 未设置，请在设置中填写";
      setTransferResult(msg);
      reportError(msg);
      setTransferLoading(false);
      return;
    }
    const to = transferToAddress.trim();
    if (!to) {
      const msg = "请填写目标地址";
      setTransferResult(msg);
      reportError(msg);
      setTransferLoading(false);
      return;
    }
    const amount = transferAmount.trim();
    if (!amount) {
      const msg = "请填写转账金额";
      setTransferResult(msg);
      reportError(msg);
      setTransferLoading(false);
      return;
    }
    try {
      const decimals = transferAsset === "USDT" ? config.decimals : 6;
      const amountSun = parseUnits(amount, decimals);
      if (transferAsset === "USDT") {
        if (transferBalances?.usdt != null) {
          const balanceSun = BigInt(transferBalances.usdt || "0");
          if (amountSun > balanceSun) {
            const msg = "USDT 余额不足";
            setTransferResult(msg);
            reportError(msg);
            setTransferLoading(false);
            return;
          }
        }
      } else {
        if (transferBalances?.trx != null) {
          const balanceSun = BigInt(transferBalances.trx || "0");
          if (amountSun > balanceSun) {
            const msg = "TRX 余额不足";
            setTransferResult(msg);
            reportError(msg);
            setTransferLoading(false);
            return;
          }
        }
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setTransferResult(msg);
      reportError(msg);
      setTransferLoading(false);
      return;
    }
    const fromItem = transferAddressPreview.find((i) => i.index === transferIndex);
    if (!fromItem) {
      const msg = "请选择发送地址";
      setTransferResult(msg);
      reportError(msg);
      setTransferLoading(false);
      return;
    }
    if (transferAsset === "USDT") {
      if (!config.usdt_contract || config.usdt_contract === "REPLACE_WITH_USDT_CONTRACT") {
        const msg = "USDT 合约地址未设置，请在设置中填写";
        setTransferResult(msg);
        reportError(msg);
        setTransferLoading(false);
        return;
      }
    }
    try {
      const res = await window.api.transferSend({
        fullHost: config.full_host,
        tron_api_key: config.tron_api_key,
        asset: transferAsset,
        to,
        amount,
        enc_mnemonic: selectedWallet.enc_mnemonic,
        password: transferPassword.trim(),
        index: transferIndex,
        from: fromItem.address,
        usdt_contract: transferAsset === "USDT" ? config.usdt_contract : undefined,
        decimals: transferAsset === "USDT" ? config.decimals : undefined,
        fee_limit: transferAsset === "USDT" ? config.fee_limit : undefined
      });
      const summary =
        `转账成功: ${res.asset} ${res.amount}\n` +
        `from=${res.from}\n` +
        `to=${res.to}\n` +
        `txid=${res.txid}`;
      setTransferResult(summary);
      await fetchTransferBalances(fromItem.address);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setTransferResult(msg);
      reportError(msg);
    } finally {
      setTransferLoading(false);
    }
  }

  if (!secureReady) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="hint">正在加载安全配置...</div>
        </div>
      </div>
    );
  }

  if (loginLocked) {
    return (
      <AuthScreen
        loginPassword={loginPassword}
        loginError={loginError}
        onLogin={handleLogin}
        onPasswordChange={setLoginPassword}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-title">
            <span className="brand-kicker">TRON</span>
            <h1>upay-wallet</h1>
          </div>
          <p>企业级离线签名与广播工具（TRC20 USDT）</p>
        </div>
        <div className="header-right">
          <div className="status-row">
            <span className={`status-pill ${currentNetworkKey}`}>{networkLabel}</span>
          </div>
          <div className="action-row">
            <button className="ghost-button" onClick={() => setLogsOpen(true)}>
              <span className="icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 5h10a3 3 0 0 1 3 3v11H7a3 3 0 0 1-3-3V5Z"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <path d="M7 9h7M7 13h7M7 17h4" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </span>
              日志
            </button>
            {config.auth_password_hash && (
              <button className="ghost-button" onClick={handleLogout}>
                登出
              </button>
            )}
            <button
              className="primary-button"
              onClick={() => {
                setSettingsTab("config");
                setSettingsOpen(true);
              }}
            >
              <span className="icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <path
                    d="M4 12c0-.5.3-1 .7-1.2l1.7-.9a6.7 6.7 0 0 1 .7-1.6l-.3-1.8c-.1-.5.2-1 .7-1.2l1.6-.9c.4-.2 1-.1 1.3.3l1.3 1a7 7 0 0 1 1.8 0l1.3-1c.4-.3.9-.4 1.3-.2l1.6.9c.4.2.7.7.6 1.2l-.3 1.8c.3.5.5 1.1.7 1.6l1.7.9c.4.2.7.7.7 1.2s-.3 1-.7 1.2l-1.7.9a6.7 6.7 0 0 1-.7 1.6l.3 1.8c.1.5-.2 1-.7 1.2l-1.6.9c-.4.2-1 .1-1.3-.3l-1.3-1a7 7 0 0 1-1.8 0l-1.3 1c-.4.3-.9.4-1.3.2l-1.6-.9c-.4-.2-.7-.7-.6-1.2l.3-1.8c-.3-.5-.5-1.1-.7-1.6l-1.7-.9C4.3 13 4 12.5 4 12Z"
                    stroke="currentColor"
                    strokeWidth="1.1"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              设置
            </button>
          </div>
          <div className="meta-line">{appInfo ? `v${appInfo.version} · ${appInfo.platform}` : "..."}</div>
          <div className="progress">{progressText}</div>
        </div>
      </header>

      <nav className="tabs">
        <div className="tabs-group">
          <span className="tabs-label">首页</span>
          <button className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>
            运行概览
          </button>
        </div>
        <div className="tabs-group">
          <span className="tabs-label offline">离线</span>
          <button className={activeTab === "sign" ? "active offline" : "offline"} onClick={() => setActiveTab("sign")}>
            离线签名
          </button>
          <button className={activeTab === "wallet" ? "active offline" : "offline"} onClick={() => setActiveTab("wallet")}>
            钱包管理
          </button>
        </div>
        <div className="tabs-group">
          <span className="tabs-label online">联网</span>
          <button className={activeTab === "quick" ? "active online" : "online"} onClick={() => setActiveTab("quick")}>
            快捷归集
          </button>
          <button className={activeTab === "transfer" ? "active online" : "online"} onClick={() => setActiveTab("transfer")}>
            转账
          </button>
          <button className={activeTab === "refblock" ? "active online" : "online"} onClick={() => setActiveTab("refblock")}>
            区块引用
          </button>
          <button className={activeTab === "broadcast" ? "active online" : "online"} onClick={() => setActiveTab("broadcast")}>
            广播上链
          </button>
          <button className={activeTab === "scan" ? "active online" : "online"} onClick={() => setActiveTab("scan")}>
            扫描统计
          </button>
        </div>
      </nav>

      <main className="content">
        {activeTab === "overview" && (
          <section className="panel hero-panel overview-hero">
            <div className="hero-header">
              <div>
                <h2>运行控制台</h2>
                <p className="muted">先看状态，再决定下一步操作。常用入口已集中在右侧。</p>
              </div>
              <div className="hero-actions">
                <button className="primary-button" onClick={() => setActiveTab("sign")}>
                  立即离线签名
                </button>
                <button className="ghost-button" onClick={() => setActiveTab("refblock")}>
                  获取区块引用
                </button>
                <button className="ghost-button" onClick={() => setActiveTab("broadcast")}>
                  广播上链
                </button>
              </div>
            </div>
            <div className="overview-grid dashboard-grid">
              <div className="overview-card status-card">
                <h3>系统状态</h3>
                <div className="stat-list">
                  <div className="stat-item">
                    <span>登录状态</span>
                    <strong>{loginLocked ? "已锁定" : "已解锁"}</strong>
                  </div>
                  <div className="stat-item">
                    <span>当前网络</span>
                    <strong>{networkLabel}</strong>
                  </div>
                  <div className="stat-item">
                    <span>会话时长</span>
                    <strong>{config.auth_session_minutes || 30} 分钟</strong>
                  </div>
                  <div className="stat-item">
                    <span>运行进度</span>
                    <strong>{progressText || "暂无任务"}</strong>
                  </div>
                </div>
              </div>
              <div className="overview-card status-card">
                <h3>关键配置</h3>
                <div className="stat-list">
                  <div className="stat-item">
                    <span>归集地址</span>
                    <strong>{config.collection_addresses.length} 个</strong>
                  </div>
                  <div className="stat-item">
                    <span>钱包数量</span>
                    <strong>{config.hd_wallets.length} 个</strong>
                  </div>
                  <div className="stat-item">
                    <span>USDT 合约</span>
                    <strong>{config.usdt_contract ? "已配置" : "未配置"}</strong>
                  </div>
                  <div className="stat-item">
                    <span>TRON API Key</span>
                    <strong>{config.tron_api_key ? "已配置" : "未配置"}</strong>
                  </div>
                </div>
              </div>
              <div className="overview-card status-card">
                <h3>最近输出</h3>
                <ul className="compact-list">
                  <li>离线签名：{signResult ? `已生成 ${signOutputPath}` : "暂无输出"}</li>
                  <li>广播上链：{broadcastResult ? `已生成 ${broadcastOutputPath}` : "暂无输出"}</li>
                  <li>扫描统计：{scanSummary ? "已生成统计" : "暂无输出"}</li>
                  <li>快捷归集：{quickResult ? "已完成处理" : "暂无输出"}</li>
                </ul>
                <div className="hint">输出文件可用于审计与复核。</div>
              </div>
              <div className="overview-card status-card">
                <h3>风险提示</h3>
                {errorMessage ? (
                  <div className="error-banner">{errorMessage}</div>
                ) : (
                  <ul className="compact-list">
                    <li>离线机不联网，私钥不出本机。</li>
                    <li>在线广播请选择可信节点。</li>
                    <li>操作前请核验归集目标地址。</li>
                  </ul>
                )}
              </div>
            </div>
            <div className="flow-section">
              <div className="flow-header">
                <h3>流程说明</h3>
                <span className="muted">保留完整流程，方便新成员上手。</span>
              </div>
              <div className="overview-grid flow-grid">
                <div className="overview-card">
                  <h3>离线签名流程</h3>
                  <ol>
                    <li>准备「index,address,amount」CSV（非连续地址需带 index）。</li>
                    <li>在钱包管理创建 HD 钱包，离线签名时选择。</li>
                    <li>选择归集目标地址，粘贴区块引用 JSON。</li>
                    <li>执行离线签名，得到 signed_txs.json。</li>
                  </ol>
                  <div className="hint">区块引用来自在线节点，离线机仅粘贴。</div>
                </div>
                <div className="overview-card">
                  <h3>在线流程</h3>
                  <ol>
                    <li>区块引用页获取最新 ref_block JSON。</li>
                    <li>广播页导入 signed_txs.json。</li>
                    <li>扫描页用于统计与阈值筛选。</li>
                  </ol>
                  <div className="hint">广播会输出结果文件，方便审计。</div>
                </div>
                <div className="overview-card">
                  <h3>安全提示</h3>
                  <ul>
                    <li>离线签名不联网，私钥不离开本机。</li>
                    <li>生产环境建议使用专用离线机。</li>
                    <li>在线广播请选择可信节点。</li>
                  </ul>
                  <div className="hint">日志在右上角可随时查看。</div>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "sign" && (
          <section className="panel">
            <h2>离线 TRC20 签名（USDT）</h2>
            <div className="row space" style={{ marginBottom: 8 }}>
              <h3>初始化输入</h3>
              <button
                onClick={() => {
                  setAddressAmountCsv("index,address,amount\n");
                  setWalletSignPassword("");
                  setRefBlockJsonInput("");
                  setSignOutputPath("signed_txs.json");
                  setSignResult("");
                }}
              >
                重置本页输入
              </button>
            </div>
            <div className="grid">
              <label>
                归集目标地址
                {config.collection_addresses.length === 0 ? (
                  <div className="empty-inline">
                    <span>未配置归集地址</span>
                    <button onClick={openCollectionSettings}>去设置</button>
                  </div>
                ) : (
                  <>
                    <div className="select-row">
                      <select
                        value={selectedCollectionId}
                        onChange={(e) => setSelectedCollectionId(e.target.value)}
                      >
                        {config.collection_addresses.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {shortAddress(item.address)}
                          </option>
                        ))}
                      </select>
                      <button onClick={openCollectionSettings}>管理</button>
                    </div>
                    <div className="hint">地址：{toAddress}</div>
                  </>
                )}
              </label>
              <label>
                选择 HD 钱包
                {config.hd_wallets.length === 0 ? (
                  <div className="empty-inline">
                    <span>未创建 HD 钱包</span>
                    <button onClick={() => setActiveTab("wallet")}>去钱包管理</button>
                  </div>
                ) : (
                  <div className="select-row">
                    <select value={selectedWalletId} onChange={(e) => setSelectedWalletId(e.target.value)}>
                      {config.hd_wallets.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {shortXpub(item.xpub)}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => setActiveTab("wallet")}>管理</button>
                  </div>
                )}
                {selectedWallet && (
                  <div className="hint">派生路径：{selectedWallet.path_prefix}/index</div>
                )}
              </label>
            </div>

            <div className="grid">
              <label>
                HD 钱包解密密码
                <input
                  type="password"
                  value={walletSignPassword}
                  onChange={(e) => setWalletSignPassword(e.target.value)}
                />
              </label>
            </div>

            <div className="split">
              <div>
                <div className="row space">
                  <h3>地址 + 金额 CSV</h3>
                  <button onClick={handleLoadAddressAmountCsv}>导入 CSV</button>
                </div>
                <textarea value={addressAmountCsv} onChange={(e) => setAddressAmountCsv(e.target.value)} rows={10} />
                <div className="hint">CSV 列为: index,address,amount（必须提供 index）</div>
              </div>
              <div>
                <div className="row space">
                  <h3>区块引用 JSON</h3>
                  <button onClick={handleLoadRefBlockJson}>导入 JSON</button>
                </div>
                <textarea
                  value={refBlockJsonInput}
                  onChange={(e) => setRefBlockJsonInput(e.target.value)}
                  rows={10}
                  placeholder='{"ref_block_bytes":"3e7a","ref_block_hash":"8f...","timestamp":0,"expiration":0}'
                />
                <div className="hint">离线签名页不联网，区块引用请在“区块引用”页获取后粘贴。</div>
              </div>
            </div>

            <div className="split">
              <div>
                <h3>签名请求预览（只读）</h3>
                <textarea value={signJsonPreview} readOnly rows={10} />
              </div>
            </div>

            <div className="row">
              <input value={signOutputPath} onChange={(e) => setSignOutputPath(e.target.value)} />
              <button onClick={handlePickSignOutput}>选择保存位置</button>
            </div>
            <button className="primary" onClick={handleSign} disabled={signLoading}>
              {signLoading ? "签名中..." : "离线签名"}
            </button>
            {signResult && <pre className="result">{signResult}</pre>}
          </section>
        )}

        {activeTab === "quick" && (
          <section className="panel">
            <h2>快捷归集（自动取区块引用并广播）</h2>
            <div className="hint">
              输入 `index,address,amount` CSV，选择 HD 钱包与归集地址后，一键完成签名与广播。
            </div>
            <div className="row space" style={{ marginBottom: 8 }}>
              <h3>初始化输入</h3>
              <button
                onClick={() => {
                  setQuickAddressAmountCsv("index,address,amount\n");
                  setQuickPassword("");
                  setQuickResult("");
                }}
              >
                重置本页输入
              </button>
            </div>
            <div className="grid">
              <label>
                归集目标地址
                {config.collection_addresses.length === 0 ? (
                  <div className="empty-inline">
                    <span>未配置归集地址</span>
                    <button onClick={openCollectionSettings}>去设置</button>
                  </div>
                ) : (
                  <>
                    <div className="select-row">
                      <select
                        value={selectedCollectionId}
                        onChange={(e) => setSelectedCollectionId(e.target.value)}
                      >
                        {config.collection_addresses.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {shortAddress(item.address)}
                          </option>
                        ))}
                      </select>
                      <button onClick={openCollectionSettings}>管理</button>
                    </div>
                    <div className="hint">地址：{toAddress}</div>
                  </>
                )}
              </label>
              <label>
                选择 HD 钱包
                {config.hd_wallets.length === 0 ? (
                  <div className="empty-inline">
                    <span>未创建 HD 钱包</span>
                    <button onClick={() => setActiveTab("wallet")}>去钱包管理</button>
                  </div>
                ) : (
                  <div className="select-row">
                    <select value={selectedWalletId} onChange={(e) => setSelectedWalletId(e.target.value)}>
                      {config.hd_wallets.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {shortXpub(item.xpub)}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => setActiveTab("wallet")}>管理</button>
                  </div>
                )}
              </label>
            </div>
            <div className="grid">
              <label>
                HD 钱包解密密码
                <input
                  type="password"
                  value={quickPassword}
                  onChange={(e) => setQuickPassword(e.target.value)}
                />
              </label>
            </div>
            <div className="row space">
              <h3>地址 + 金额 CSV</h3>
              <button onClick={async () => {
                const file = await window.api.selectOpenFile({ filters: [{ name: "CSV", extensions: ["csv"] }] });
                if (!file) return;
                const text = await window.api.readTextFile(file.token);
                setQuickAddressAmountCsv(text);
              }}>导入 CSV</button>
            </div>
            <textarea
              value={quickAddressAmountCsv}
              onChange={(e) => setQuickAddressAmountCsv(e.target.value)}
              rows={10}
            />
            <div className="hint">CSV 列为: index,address,amount（必须提供 index）</div>
            <button className="primary" onClick={handleQuickCollect} disabled={quickLoading}>
              {quickLoading ? "归集中..." : "一键快捷归集"}
            </button>
            {quickResult && <pre className="result">{quickResult}</pre>}
          </section>
        )}

        {activeTab === "refblock" && (
          <section className="panel">
            <h2>区块引用获取（在线）</h2>
            <div className="row space" style={{ marginBottom: 8 }}>
              <h3>初始化输入</h3>
              <button onClick={() => setRefBlockJsonInput("")}>清空区块引用</button>
            </div>
            <div className="hint">
              该页面会访问节点获取最新区块引用字段。区块引用用于把交易锚定在最新区块上，
              防止重放与过期。当前工具默认有效期为 10 分钟（expiration = timestamp + 10 分钟）。
              超过有效期的交易会被链拒绝。
            </div>
            <button className="primary" onClick={handleFetchRefBlock} disabled={refblockLoading}>
              {refblockLoading ? "获取中..." : "获取最新区块引用"}
            </button>
            <button onClick={handleExportRefBlock} style={{ marginLeft: 8 }}>
              导出区块引用
            </button>
            <div className="row space" style={{ marginTop: 10 }}>
              <h3>区块引用 JSON（直接复制到离线签名）</h3>
            </div>
            <textarea value={refBlockJsonInput} readOnly rows={6} />
            <div className="hint">复制 JSON 到“离线签名”页即可。</div>
            {refblockExportResult && <div className="result">{refblockExportResult}</div>}
          </section>
        )}

        {activeTab === "broadcast" && (
          <section className="panel">
            <h2>广播已签名交易</h2>
            <div className="row space" style={{ marginBottom: 8 }}>
              <h3>初始化输入</h3>
              <button
                onClick={() => {
                  setSignedJsonText("{\"signed_txs\":[]}");
                  setBroadcastOutputPath("broadcast_results.json");
                  setBroadcastResult("");
                }}
              >
                重置本页输入
              </button>
            </div>
            <div className="hint">广播节点地址来自“设置”。</div>
            <div className="row space">
              <h3>签名 JSON</h3>
              <button onClick={handleLoadSignedJson}>导入 JSON</button>
            </div>
            <textarea value={signedJsonText} onChange={(e) => setSignedJsonText(e.target.value)} rows={12} />
            <div className="row">
              <input value={broadcastOutputPath} onChange={(e) => setBroadcastOutputPath(e.target.value)} />
              <button onClick={handlePickBroadcastOutput}>选择保存位置</button>
            </div>
            <button className="primary" onClick={handleBroadcast} disabled={broadcastLoading}>
              {broadcastLoading ? "广播中..." : "广播上链"}
            </button>
            {broadcastResult && <pre className="result">{broadcastResult}</pre>}
          </section>
        )}

        {activeTab === "scan" && (
          <section className="panel">
            <h2>地址扫描统计（USDT）</h2>
            <div className="row space" style={{ marginBottom: 8 }}>
              <h3>初始化输入</h3>
              <button
                onClick={() => {
                  setScanAddressCsv("index,address\n");
                  setScanThreshold("1");
                  setScanResult("");
                  setScanSummary("");
                  setScanOverCsv("");
                }}
              >
                重置本页输入
              </button>
            </div>
            <div className="grid">
              <label>
                阈值（USDT）
                <input value={scanThreshold} onChange={(e) => setScanThreshold(e.target.value)} />
              </label>
            </div>
            <div className="row space">
              <h3>地址 CSV</h3>
              <button onClick={handleLoadScanCsv}>导入 CSV</button>
            </div>
            <textarea value={scanAddressCsv} onChange={(e) => setScanAddressCsv(e.target.value)} rows={10} />
            <div className="hint">CSV 列为: index,address（必须包含 index）</div>
            <button className="primary" onClick={handleScan} disabled={scanLoading}>
              {scanLoading ? "扫描中..." : "扫描统计"}
            </button>
            {scanSummary && <div className="result">{scanSummary}</div>}
            {scanOverCsv && (
              <>
                <div className="row space" style={{ marginTop: 8 }}>
                  <h3>满足条件的地址 CSV（用于离线签名）</h3>
                  <button onClick={handleExportScanCsv}>导出 CSV</button>
                </div>
                <textarea value={scanOverCsv} readOnly rows={8} />
              </>
            )}
            {scanResult && <pre className="result">{scanResult}</pre>}
          </section>
        )}

        {activeTab === "transfer" && (
          <section className="panel">
            <h2>转账</h2>
            <div className="hint">选择钱包地址，转账 TRX 或 USDT 到目标地址。</div>
            <div className="grid">
              <label>
                选择 HD 钱包
                {config.hd_wallets.length === 0 ? (
                  <div className="empty-inline">
                    <span>未创建 HD 钱包</span>
                    <button onClick={() => setActiveTab("wallet")}>去钱包管理</button>
                  </div>
                ) : (
                  <div className="select-row">
                    <select value={selectedWalletId} onChange={(e) => setSelectedWalletId(e.target.value)}>
                      {config.hd_wallets.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {shortXpub(item.xpub)}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => setActiveTab("wallet")}>管理</button>
                  </div>
                )}
              </label>
              <label>
                发送地址（0~19）
                {transferAddressPreview.length === 0 ? (
                  <div className="empty-inline">
                    <span>暂无地址预览</span>
                    <button onClick={handleRefreshTransferPreview} disabled={transferPreviewLoading}>
                      {transferPreviewLoading ? "刷新中..." : "刷新地址"}
                    </button>
                  </div>
                ) : (
                  <div className="select-row">
                    <select value={String(transferIndex)} onChange={(e) => setTransferIndex(Number(e.target.value))}>
                      {transferAddressPreview.map((item) => (
                        <option key={item.index} value={item.index}>
                          {item.index} · {shortAddress(item.address)}
                        </option>
                      ))}
                    </select>
                    <button onClick={handleRefreshTransferPreview} disabled={transferPreviewLoading}>
                      {transferPreviewLoading ? "刷新中..." : "刷新地址"}
                    </button>
                  </div>
                )}
                {transferAddressPreview.length > 0 && (
                  <div className="hint">
                    发送地址：
                    {transferAddressPreview.find((i) => i.index === transferIndex)?.address || ""}
                  </div>
                )}
                {transferAddressPreview.length > 0 && (
                  <div className="hint">
                    {transferBalanceLoading
                      ? "余额查询中..."
                      : transferBalanceError
                      ? `余额获取失败：${transferBalanceError}`
                      : `余额：TRX ${formatUnits(transferBalances?.trx ?? "0", 6)} / USDT ${
                          transferBalances?.usdt == null
                            ? "-"
                            : formatUnits(transferBalances.usdt, config.decimals)
                        }`}
                  </div>
                )}
              </label>
              <label>
                HD 钱包解密密码
                <input
                  type="password"
                  value={transferPassword}
                  onChange={(e) => setTransferPassword(e.target.value)}
                />
              </label>
            </div>
            <div className="transfer-row">
              <label>
                目标地址
                <input value={transferToAddress} onChange={(e) => setTransferToAddress(e.target.value)} />
              </label>
              <label>
                选择资产
                <div className="toggle-group">
                  <button
                    type="button"
                    className={transferAsset === "TRX" ? "toggle-button active" : "toggle-button"}
                    onClick={() => setTransferAsset("TRX")}
                  >
                    TRX
                  </button>
                  <button
                    type="button"
                    className={transferAsset === "USDT" ? "toggle-button active" : "toggle-button"}
                    onClick={() => setTransferAsset("USDT")}
                  >
                    USDT
                  </button>
                </div>
              </label>
              <label>
                转账金额
                <input value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} />
              </label>
            </div>
            <div className="row">
              <button className="primary" onClick={handleSendTransfer} disabled={transferLoading}>
                {transferLoading ? "转账中..." : "发起转账"}
              </button>
            </div>
            <div className="hint">当前节点：{config.full_host || "(未配置)"}</div>
            {transferResult && <pre className="result">{transferResult}</pre>}
          </section>
        )}

        {activeTab === "wallet" && (
          <section className="panel">
            <h2>钱包管理（HD）</h2>
            <div className="hint">创建 HD 钱包并管理扩展公钥（xpub），用于离线派生地址。</div>
            <div className="wallet-layout">
              <div className="wallet-list">
                {config.hd_wallets.length === 0 && (
                  <div className="empty-card">暂无 HD 钱包，请在右侧创建。</div>
                )}
                {config.hd_wallets.map((item) => (
                  <div key={item.id} className="wallet-item">
                    <div className="wallet-info">
                      <div className="collection-name">
                        {item.name}
                        {selectedWalletId === item.id && <span className="badge">当前选择</span>}
                      </div>
                      <div className="collection-address">xpub: {item.xpub}</div>
                      <div className="muted">路径：{item.path_prefix}/index</div>
                      {item.created_at && (
                        <div className="muted">创建时间：{new Date(item.created_at).toLocaleString()}</div>
                      )}
                      {item.preview_addresses?.length >= 1 ? (
                        <div className="muted">地址1：{item.preview_addresses[0]}</div>
                      ) : (
                        <div className="muted">地址1：未生成</div>
                      )}
                      {item.preview_addresses?.length >= 2 ? (
                        <div className="muted">地址2：{item.preview_addresses[1]}</div>
                      ) : (
                        <div className="muted">地址2：未生成</div>
                      )}
                      <div className="muted">支持删除，需输入该钱包的加密密码验证。</div>
                    </div>
                    <div className="collection-actions">
                      <button onClick={() => setSelectedWalletId(item.id)}>设为当前</button>
                      <button onClick={() => handleDeleteHdWallet(item)}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="form-card">
                <div className="wallet-tabs">
                  <button
                    className={walletFormTab === "create" ? "active" : ""}
                    onClick={() => setWalletFormTab("create")}
                  >
                    创建
                  </button>
                  <button
                    className={walletFormTab === "import" ? "active" : ""}
                    onClick={() => setWalletFormTab("import")}
                  >
                    导入
                  </button>
                </div>

                {walletFormTab === "create" && (
                  <div className="wallet-form">
                    <h4>创建 HD 钱包</h4>
                    {walletCreateStage === "form" && (
                      <>
                        <div className="grid">
                          <label>
                            钱包名称
                            <input value={walletName} onChange={(e) => setWalletName(e.target.value)} />
                          </label>
                          <label>
                            加密密码
                            <input
                              type="password"
                              value={walletPassword}
                              onChange={(e) => setWalletPassword(e.target.value)}
                            />
                          </label>
                      <label>
                        确认密码
                        <input
                          type="password"
                          value={walletPasswordConfirm}
                          onChange={(e) => setWalletPasswordConfirm(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="warning-text">
                      密码必须至少 8 位且包含字母与数字。忘记密码将无法解密助记词。
                    </div>
                    <label className="ack-check">
                      <input
                        type="checkbox"
                        checked={walletPasswordAcknowledge}
                        onChange={(e) => setWalletPasswordAcknowledge(e.target.checked)}
                      />
                      我已知晓密码不可找回，将妥善保管
                    </label>
                    <div className="row">
                      <button className="primary-button" onClick={handleCreateHdWallet} disabled={walletCreateLoading}>
                        {walletCreateLoading ? "创建中..." : "创建 HD 钱包"}
                      </button>
                      <button onClick={resetWalletCreateForm}>清空</button>
                        </div>
                        {walletCreateResult && <div className="result">{walletCreateResult}</div>}
                      </>
                    )}

                    {walletCreateStage === "verify" && (
                      <>
                        {walletCreateMnemonic && (
                          <div className="mnemonic-card">
                            <h4>助记词（仅本次显示）</h4>
                            <textarea value={walletCreateMnemonic} readOnly rows={3} />
                            <div className="warning-text">
                              请立即离线备份并妥善保管助记词，任何人获取助记词即可完全控制资金，且之后不会再显示。
                            </div>
                          </div>
                        )}
                        {walletCreateXpub && (
                          <div className="mnemonic-card">
                            <h4>扩展公钥（xpub）</h4>
                            <textarea value={walletCreateXpub} readOnly rows={3} />
                            {walletCreateAddress && <div className="hint">首地址：{walletCreateAddress}</div>}
                            {walletCreateAddresses.length >= 2 && (
                              <div className="hint">
                                预览地址：{walletCreateAddresses[0]} / {walletCreateAddresses[1]}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="backup-box">
                          <div className="hint">安全提示：是否已备份助记词</div>
                          <label className="backup-check">
                            <input
                              type="checkbox"
                              checked={walletBackupConfirmed}
                              onChange={(e) => setWalletBackupConfirmed(e.target.checked)}
                            />
                            我已安全备份助记词
                          </label>
                          <label>
                            请输入助记词完成验证
                            <textarea
                              value={walletMnemonicConfirm}
                              onChange={(e) => setWalletMnemonicConfirm(e.target.value)}
                              rows={3}
                              placeholder="请完整输入助记词（空格分隔）"
                            />
                          </label>
                          {walletBackupError && <div className="inline-error">{walletBackupError}</div>}
                        </div>
                        <div className="row">
                          <button className="primary-button" onClick={handleConfirmWalletBackup}>
                            完成保存
                          </button>
                          <button onClick={resetWalletCreateForm}>重新创建</button>
                        </div>
                        {walletCreateResult && <div className="result">{walletCreateResult}</div>}
                      </>
                    )}
                  </div>
                )}

                {walletFormTab === "import" && (
                  <div className="wallet-form">
                    <h4>导入助记词钱包</h4>
                    <div className="grid">
                      <label>
                        钱包名称
                        <input value={walletImportName} onChange={(e) => setWalletImportName(e.target.value)} />
                      </label>
                      <label>
                        助记词
                        <textarea
                          value={walletImportMnemonic}
                          onChange={(e) => setWalletImportMnemonic(e.target.value)}
                          rows={3}
                          placeholder="请输入助记词（空格分隔）"
                        />
                      </label>
                      <label>
                        加密密码
                        <input
                          type="password"
                          value={walletImportPassword}
                          onChange={(e) => setWalletImportPassword(e.target.value)}
                        />
                      </label>
                      <label>
                        确认密码
                        <input
                          type="password"
                          value={walletImportPasswordConfirm}
                          onChange={(e) => setWalletImportPasswordConfirm(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="warning-text">请务必牢记密码，忘记后无法解密助记词。</div>
                    <label className="ack-check">
                      <input
                        type="checkbox"
                        checked={walletImportPasswordAcknowledge}
                        onChange={(e) => setWalletImportPasswordAcknowledge(e.target.checked)}
                      />
                      我已知晓密码不可找回，将妥善保管
                    </label>
                    <div className="row">
                      <button className="primary-button" onClick={handleImportHdWallet} disabled={walletImportLoading}>
                        {walletImportLoading ? "导入中..." : "导入助记词"}
                      </button>
                      <button onClick={resetWalletImportForm}>清空</button>
                    </div>
                    {walletImportResult && <div className="result">{walletImportResult}</div>}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {errorMessage && <div className="error-banner">{errorMessage}</div>}
      </main>

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>设置中心</h2>
                <div className="muted">配置网络、归集地址与常用参数</div>
              </div>
              <button className="ghost-button" onClick={() => setSettingsOpen(false)}>
                关闭
              </button>
            </div>
            <div className="modal-body">
              <aside className="modal-menu">
                <button
                  className={settingsTab === "config" ? "active" : ""}
                  onClick={() => setSettingsTab("config")}
                >
                  基础配置
                </button>
                <button
                  className={settingsTab === "collection" ? "active" : ""}
                  onClick={() => setSettingsTab("collection")}
                >
                  归集地址
                </button>
                <button
                  className={settingsTab === "security" ? "active" : ""}
                  onClick={() => setSettingsTab("security")}
                >
                  安全
                </button>
              </aside>
              <div className="modal-content">
                {settingsTab === "config" && (
                  <div className="modal-section">
                    <div className="row space" style={{ marginBottom: 8 }}>
                      <h3>网络配置</h3>
                      <div className="toggle-group">
                        <button
                          className={`toggle-button ${currentNetworkKey === "mainnet" ? "active" : ""}`}
                          onClick={() => handleSwitchNetwork("mainnet")}
                        >
                          {NETWORK_PRESETS.mainnet.label}
                        </button>
                        <button
                          className={`toggle-button ${currentNetworkKey === "testnet" ? "active" : ""}`}
                          onClick={() => handleSwitchNetwork("testnet")}
                        >
                          {NETWORK_PRESETS.testnet.label}
                        </button>
                      </div>
                    </div>
                    <div className="grid">
                      <label>
                        full_host
                        <input
                          value={config.full_host}
                          onChange={(e) => updateConfig("full_host", e.target.value)}
                        />
                      </label>
                      <label>
                        tron_api_key
                        <input
                          value={config.tron_api_key}
                          onChange={(e) => updateConfig("tron_api_key", e.target.value)}
                        />
                      </label>
                      <label>
                        usdt_contract
                        <input
                          value={config.usdt_contract}
                          onChange={(e) => updateConfig("usdt_contract", e.target.value)}
                        />
                      </label>
                      <label>
                        fee_limit
                        <input
                          type="number"
                          value={Number.isFinite(config.fee_limit) ? String(config.fee_limit) : ""}
                          onChange={(e) => updateConfig("fee_limit", Number(e.target.value || 0))}
                        />
                      </label>
                    </div>
                    <div className="hint">设置会自动保存在本机。</div>
                    <div className="split">
                      <div>
                        <h3>当前配置（只读）</h3>
                        <textarea value={JSON.stringify(maskedConfig, null, 2)} readOnly rows={10} />
                      </div>
                    </div>
                  </div>
                )}
                {settingsTab === "collection" && (
                  <div className="modal-section">
                    <div className="row space" style={{ marginBottom: 8 }}>
                      <div>
                        <h3>归集地址</h3>
                        <div className="hint">离线签名时从此列表中选择目标地址。</div>
                      </div>
                      <button onClick={resetCollectionForm}>清空表单</button>
                    </div>
                    <div className="collection-layout">
                      <div className="collection-list">
                        {config.collection_addresses.length === 0 && (
                          <div className="empty-card">暂无归集地址，请先添加。</div>
                        )}
                        {config.collection_addresses.map((item) => (
                          <div key={item.id} className="collection-item">
                            <div>
                              <div className="collection-name">
                                {item.name}
                                {selectedCollectionId === item.id && <span className="badge">使用中</span>}
                              </div>
                              <div className="collection-address">{item.address}</div>
                            </div>
                            <div className="collection-actions">
                              <button onClick={() => handleEditCollection(item)}>编辑</button>
                              <button className="danger-button" onClick={() => handleDeleteCollection(item.id)}>
                                删除
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="form-card">
                        <h4>{editingCollectionId ? "编辑归集地址" : "新增归集地址"}</h4>
                        <div className="grid">
                          <label>
                            名称
                            <input value={collectionName} onChange={(e) => setCollectionName(e.target.value)} />
                          </label>
                          <label>
                            地址
                            <input
                              value={collectionAddress}
                              onChange={(e) => setCollectionAddress(e.target.value)}
                            />
                          </label>
                        </div>
                        {collectionError && <div className="inline-error">{collectionError}</div>}
                        <div className="row">
                          <button className="primary-button" onClick={handleSaveCollection}>
                            {editingCollectionId ? "保存修改" : "新增归集地址"}
                          </button>
                          {editingCollectionId && <button onClick={resetCollectionForm}>取消</button>}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {settingsTab === "security" && (
                  <div className="modal-section">
                    <div className="row space" style={{ marginBottom: 8 }}>
                      <div>
                        <h3>登录密码</h3>
                        <div className="hint">设置后每次启动需要登录才能进入。</div>
                      </div>
                    </div>
                    <div className="grid">
                      {config.auth_password_hash && (
                        <label>
                          当前密码
                          <input
                            type="password"
                            value={securityCurrentPassword}
                            onChange={(e) => setSecurityCurrentPassword(e.target.value)}
                          />
                        </label>
                      )}
                      <label>
                        登录保持时间（分钟）
                        <input
                          type="number"
                          min={1}
                          value={String(config.auth_session_minutes || 30)}
                          onChange={(e) => {
                            const v = Number(e.target.value || 0);
                            if (!Number.isFinite(v) || v <= 0) return;
                            updateConfig("auth_session_minutes", Math.floor(v));
                          }}
                        />
                      </label>
                      <label>
                        新密码
                        <input
                          type="password"
                          value={securityNewPassword}
                          onChange={(e) => setSecurityNewPassword(e.target.value)}
                        />
                      </label>
                      <label>
                        确认新密码
                        <input
                          type="password"
                          value={securityNewPasswordConfirm}
                          onChange={(e) => setSecurityNewPasswordConfirm(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="row">
                      <button className="primary-button" onClick={handleSetLoginPassword}>
                        {config.auth_password_hash ? "更新登录密码" : "设置登录密码"}
                      </button>
                      {config.auth_password_hash && (
                        <button className="danger-button" onClick={handleClearLoginPassword}>
                          清除登录密码
                        </button>
                      )}
                    </div>
                    {securityResult && <div className="result">{securityResult}</div>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {logsOpen && (
        <div className="modal-backdrop" onClick={() => setLogsOpen(false)}>
          <div className="modal-card modal-logs" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>操作日志</h2>
                <div className="muted">记录关键操作，便于审计与定位问题。</div>
              </div>
              <div className="row">
                <button onClick={() => setLogs([])}>清空日志</button>
                <button className="ghost-button" onClick={() => setLogsOpen(false)}>
                  关闭
                </button>
              </div>
            </div>
            <div className="log-box">
              {logs.length === 0 && <div className="muted">暂无日志</div>}
              {logs.map((line, idx) => (
                <div key={idx} className="log-line">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {walletDeleteTarget && (
        <div className="modal-backdrop" onClick={closeWalletDeleteModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>删除钱包确认</h2>
                <div className="muted">请输入钱包加密密码，验证通过后才会删除。</div>
              </div>
              <button className="ghost-button" onClick={closeWalletDeleteModal} disabled={walletDeleteLoading}>
                关闭
              </button>
            </div>
            <div className="modal-content" style={{ padding: "8px 0 0 0" }}>
              <div className="hint">钱包：{walletDeleteTarget.name}</div>
              <label>
                钱包加密密码
                <input
                  type="password"
                  value={walletDeletePassword}
                  onChange={(e) => setWalletDeletePassword(e.target.value)}
                  disabled={walletDeleteLoading}
                />
              </label>
              {walletDeleteError && <div className="inline-error">{walletDeleteError}</div>}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="danger-button" onClick={handleConfirmDeleteHdWallet} disabled={walletDeleteLoading}>
                  {walletDeleteLoading ? "校验中..." : "确认删除钱包"}
                </button>
                <button onClick={closeWalletDeleteModal} disabled={walletDeleteLoading}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
