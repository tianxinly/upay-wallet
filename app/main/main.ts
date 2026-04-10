import path from "node:path";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import { webcrypto } from "node:crypto";
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
declare const require: NodeRequire;
// IMPORTANT: TronWeb 在不同打包/运行环境下导出形式不一致
// 这里使用 require 兼容 CJS/ESM 形态，确保构造函数可用
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tronwebPkg = require("tronweb");
const TronWeb = tronwebPkg.TronWeb || tronwebPkg.default || tronwebPkg;
import { collectSign } from "../core/tron/collectSign";
import { broadcast } from "../core/tron/broadcast";
import { scanAddresses } from "../core/tron/scan";
import { transferTrc20, transferTrx } from "../core/tron/transfer";
import {
  deriveHdWallet,
  deriveHdWalletByIndices,
  deriveHdWalletFromXpub,
  generateHdWallet,
  importHdWalletFromMnemonic
} from "../core/tron/hdWallet";

const ENC_PREFIX = "enc:v1:";
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

function fromBase64(text: string) {
  return new Uint8Array(Buffer.from(text, "base64"));
}

async function deriveKey(password: string, salt: Uint8Array) {
  const enc = new TextEncoder();
  const keyMaterial = await webcrypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveKey"
  ]);
  return webcrypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100_000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function decryptMnemonic(encValue: string, password: string) {
  if (!encValue.startsWith(ENC_PREFIX)) {
    throw new Error("加密内容格式不正确");
  }
  const parts = encValue.slice(ENC_PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("加密内容格式不正确");
  const [saltB64, ivB64, dataB64] = parts;
  const salt = fromBase64(saltB64);
  const iv = fromBase64(ivB64);
  const data = fromBase64(dataB64);
  const key = await deriveKey(password, salt);
  try {
    const plaintext = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(plaintext);
  } catch (e: any) {
    if (e?.name === "OperationError") {
      throw new Error("HD 钱包解密失败：密码错误或密文损坏");
    }
    throw e;
  }
}

const isDev = !app.isPackaged;
const devServerUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
const readFileTokenMap = new Map<string, string>();
const writeFileTokenMap = new Map<string, string>();

function createLogger() {
  const logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, "app.log");

  return {
    path: logPath,
    write(line: string) {
      fs.appendFile(logPath, `${new Date().toISOString()} ${line}\n`, "utf8", () => {});
    }
  };
}

const logger = createLogger();

function getSecureConfigPath() {
  return path.join(app.getPath("userData"), "secure-config.json");
}

async function saveSecureConfig(data: Record<string, any>) {
  const text = JSON.stringify(data ?? {});
  const securePath = getSecureConfigPath();
  await fsp.mkdir(path.dirname(securePath), { recursive: true });
  if (!safeStorage.isEncryptionAvailable()) {
    return { saved: false, reason: "安全存储不可用，已跳过敏感配置落盘" };
  }
  const encrypted = safeStorage.encryptString(text);
  const payload = `safe:v1:${encrypted.toString("base64")}`;
  await fsp.writeFile(securePath, payload, "utf8");
  return { saved: true };
}

async function loadSecureConfig() {
  try {
    const securePath = getSecureConfigPath();
    if (!fs.existsSync(securePath)) return { data: {} };
    const raw = await fsp.readFile(securePath, "utf8");
    if (!raw.trim()) return { data: {} };
    if (raw.startsWith("safe:v1:")) {
      if (!safeStorage.isEncryptionAvailable()) {
        return { data: {}, warning: "安全存储不可用，无法解密已加密配置" };
      }
      const b64 = raw.slice("safe:v1:".length);
      const decrypted = safeStorage.decryptString(Buffer.from(b64, "base64"));
      return { data: JSON.parse(decrypted) };
    }
    if (!safeStorage.isEncryptionAvailable()) {
      return { data: {}, warning: "发现历史明文配置，但安全存储不可用，已忽略" };
    }
    const parsed = JSON.parse(raw);
    const encrypted = safeStorage.encryptString(JSON.stringify(parsed ?? {}));
    const payload = `safe:v1:${encrypted.toString("base64")}`;
    await fsp.writeFile(securePath, payload, "utf8");
    return { data: parsed ?? {}, warning: "已检测到历史明文配置并完成加密迁移" };
  } catch {
    return { data: {}, warning: "安全配置读取失败，已忽略" };
  }
}

function buildTronWebOptions(fullHost: string, tronApiKey?: string) {
  const options: { fullHost: string; headers?: Record<string, string> } = { fullHost };
  if (tronApiKey && tronApiKey.trim()) {
    options.headers = { "TRON-PRO-API-KEY": tronApiKey.trim() };
  }
  return options;
}

async function fetchRefBlock(fullHost: string, tronApiKey?: string) {
  const tronWeb = new TronWeb(buildTronWebOptions(fullHost, tronApiKey));
  const block = await tronWeb.trx.getCurrentBlock();
  const blockId = block?.blockID;
  const blockTs = block?.block_header?.raw_data?.timestamp;
  if (!blockId || !blockTs) {
    throw new Error("无法从节点获取区块信息");
  }
  // TRON 规则：ref_block_bytes = block number 低 2 字节
  // ref_block_hash = blockId 中间 8 字节（从第 8 个字节开始）
  const ref_block_bytes = blockId.slice(12, 16);
  const ref_block_hash = blockId.slice(16, 32);
  const timestamp = Number(blockTs);
  const expiration = timestamp + 10 * 60 * 1000;
  return { ref_block_bytes, ref_block_hash, timestamp, expiration };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#0f1115",
    webPreferences: {
      // 安全边界：渲染进程禁止直接访问 Node 能力
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  win.once("ready-to-show", () => win.show());

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(devServerUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // 兼容无需 Vite 开发服务器的启动方式（直接加载 dist）
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  // 安全：禁止打开新窗口和非预期导航
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());

  return win;
}

function sendProgress(event: Electron.IpcMainInvokeEvent, taskId: string, payload: any) {
  event.sender.send("task:progress", { taskId, ...payload });
}

function sendLog(event: Electron.IpcMainInvokeEvent, message: string) {
  logger.write(message);
  const ts = new Date().toISOString();
  event.sender.send("app:log", `${ts} ${message}`);
}

function resolveOutputPath(filePath: string | undefined, defaultName: string) {
  const base = path.join(app.getPath("documents"), "TronWalletSuite");
  if (!filePath || filePath.trim() === "") {
    return path.join(base, defaultName);
  }
  return path.isAbsolute(filePath) ? filePath : path.join(base, filePath);
}

async function readTextFileWithLimit(filePath: string) {
  const stat = await fsp.stat(filePath);
  if (stat.size > MAX_IMPORT_BYTES) {
    throw new Error(`文件过大，超过 ${Math.floor(MAX_IMPORT_BYTES / 1024 / 1024)}MB`);
  }
  return await fsp.readFile(filePath, "utf8");
}

function createFileToken() {
  return webcrypto.randomUUID();
}

function issueReadFileToken(filePath: string) {
  const token = createFileToken();
  readFileTokenMap.set(token, path.resolve(filePath));
  return token;
}

function issueWriteFileToken(filePath: string) {
  const token = createFileToken();
  writeFileTokenMap.set(token, path.resolve(filePath));
  return token;
}

function resolveReadFileByToken(token: string) {
  const key = String(token || "");
  const filePath = readFileTokenMap.get(key);
  if (!filePath) {
    throw new Error("无效或过期的文件读取令牌");
  }
  readFileTokenMap.delete(key);
  return filePath;
}

function resolveWriteFileByToken(token: string) {
  const key = String(token || "");
  const filePath = writeFileTokenMap.get(key);
  if (!filePath) {
    throw new Error("无效或过期的文件写入令牌");
  }
  // 写入令牌一次性消费，避免后续复用任意覆盖
  writeFileTokenMap.delete(key);
  return filePath;
}

function validateQuickCollectParams(params: any) {
  const items = Array.isArray(params?.items) ? params.items : [];
  if (!params?.fullHost) throw new Error("full_host 不能为空");
  if (!params?.usdt_contract) throw new Error("usdt_contract 不能为空");
  if (!params?.to) throw new Error("归集目标地址不能为空");
  if (!Number.isInteger(params?.decimals) || params.decimals < 0) {
    throw new Error("decimals 必须为非负整数");
  }
  if (!Number.isInteger(params?.fee_limit) || params.fee_limit <= 0) {
    throw new Error("fee_limit 必须为正整数（SUN）");
  }
  if (!params?.enc_mnemonic || !params?.password) {
    throw new Error("HD 钱包解密参数缺失");
  }
  if (!Array.isArray(params?.indices) || params.indices.length === 0) {
    throw new Error("indices 不能为空");
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("items 不能为空");
  }
  if (items.some((row: any) => !row?.from || !row?.amount)) {
    throw new Error("items 中存在地址或金额为空的数据");
  }
  if (params.indices.some((i: any) => !Number.isInteger(i) || i < 0)) {
    throw new Error("indices 必须为非负整数数组");
  }
}

function validateTransferParams(params: any) {
  if (!params?.fullHost) throw new Error("full_host 不能为空");
  if (!params?.asset) throw new Error("asset 不能为空");
  const asset = String(params.asset);
  if (asset !== "TRX" && asset !== "USDT") {
    throw new Error("asset 必须为 TRX 或 USDT");
  }
  if (!params?.to) throw new Error("目标地址不能为空");
  if (!params?.amount) throw new Error("转账金额不能为空");
  if (!params?.enc_mnemonic || !params?.password) {
    throw new Error("HD 钱包解密参数缺失");
  }
  if (!Number.isInteger(params?.index) || params.index < 0) {
    throw new Error("index 必须为非负整数");
  }
  if (params.asset === "USDT") {
    const contract = String(params?.usdt_contract ?? "");
    if (!contract || contract === "REPLACE_WITH_USDT_CONTRACT") {
      throw new Error("USDT 合约地址不能为空");
    }
    if (!Number.isInteger(params?.decimals) || params.decimals < 0) {
      throw new Error("decimals 必须为非负整数");
    }
    if (!Number.isInteger(params?.fee_limit) || params.fee_limit <= 0) {
      throw new Error("fee_limit 必须为正整数（SUN）");
    }
  }
}

function normalizeTronValue(value: any) {
  if (value === null || value === undefined) return "0";
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "object") {
    if (typeof value.toString === "function") return value.toString();
    if ("_hex" in value) {
      try {
        return BigInt(value._hex).toString();
      } catch {
        return String(value._hex);
      }
    }
  }
  return String(value);
}

app.whenReady().then(() => {
  const win = createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    userDataPath: app.getPath("userData"),
    platform: process.platform
  }));

  ipcMain.handle("secure:load", async (event) => {
    const res = await loadSecureConfig();
    if (res.warning) sendLog(event, res.warning);
    return res.data;
  });
  ipcMain.handle("log:write", async (event, message: string) => {
    if (typeof message === "string" && message.trim()) {
      sendLog(event, message.trim());
    }
    return true;
  });
  ipcMain.handle("secure:save", async (event, data) => {
    try {
      const res = await saveSecureConfig(data ?? {});
      if (!res.saved) sendLog(event, res.reason ?? "安全配置未落盘");
      return Boolean(res.saved);
    } catch (e: any) {
      sendLog(event, e?.message ?? "安全配置保存失败");
      return false;
    }
  });

  ipcMain.handle("refblock:fetch", async (_event, params) => {
    const fullHost = params?.fullHost;
    const tronApiKey = params?.tron_api_key;
    if (!fullHost) throw new Error("full_host 不能为空");
    return fetchRefBlock(fullHost, tronApiKey);
  });

  ipcMain.handle("dialog:openFile", async (_event, options) => {
    const res = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      ...options
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const filePath = path.resolve(res.filePaths[0]);
    const token = issueReadFileToken(filePath);
    return { token, filePath, name: path.basename(filePath) };
  });

  ipcMain.handle("dialog:saveFile", async (_event, options) => {
    const res = await dialog.showSaveDialog(win, options);
    if (res.canceled || !res.filePath) return null;
    const filePath = path.resolve(res.filePath);
    const token = issueWriteFileToken(filePath);
    return { token, filePath, name: path.basename(filePath) };
  });

  ipcMain.handle("file:readText", async (_event, token: string) => {
    const filePath = resolveReadFileByToken(token);
    return readTextFileWithLimit(filePath);
  });

  ipcMain.handle("file:readJson", async (_event, token: string) => {
    const filePath = resolveReadFileByToken(token);
    const text = await readTextFileWithLimit(filePath);
    return JSON.parse(text);
  });

  ipcMain.handle("file:writeText", async (_event, token: string, content: string) => {
    const filePath = resolveWriteFileByToken(token);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, content, "utf8");
    return true;
  });

  ipcMain.handle("collect:sign", async (event, params) => {
    const { input, outputPath, taskId } = params;
    const resolvedOutput = resolveOutputPath(outputPath, "signed_txs.json");
    sendLog(event, `离线签名开始: items=${input.items?.length ?? 0}`);
    const res = await collectSign(input, resolvedOutput, (p) =>
      sendProgress(event, taskId, { stage: "sign", ...p })
    );
    sendLog(event, `离线签名完成: ${res.count}`);
    return res;
  });

  ipcMain.handle("collect:signHd", async (event, params) => {
    const { input, outputPath, taskId, enc_mnemonic, password, indices } = params;
    if (!enc_mnemonic || !password) throw new Error("HD 钱包解密参数缺失");
    if (!Array.isArray(indices) || indices.length === 0) throw new Error("indices 不能为空");
    const resolvedOutput = resolveOutputPath(outputPath, "signed_txs.json");
    const mnemonic = await decryptMnemonic(enc_mnemonic, password);
    const derived = deriveHdWalletByIndices(mnemonic, indices);
    if (derived.items.length !== (input.items?.length ?? 0)) {
      throw new Error("派生数量与签名条数不一致");
    }
    const items = input.items.map((row: any, idx: number) => {
      const d = derived.items[idx];
      if (!d || d.address !== row.from) {
        throw new Error(`第 ${idx + 1} 行地址不匹配`);
      }
      return {
        ...row,
        private_key: d.privateKey
      };
    });
    sendLog(event, `离线签名开始(HD): items=${items.length}`);
    const res = await collectSign({ ...input, items }, resolvedOutput, (p) =>
      sendProgress(event, taskId, { stage: "sign", ...p })
    );
    sendLog(event, `离线签名完成(HD): ${res.count}`);
    return res;
  });

  ipcMain.handle("quick:collect", async (event, params) => {
    validateQuickCollectParams(params);
    const {
      fullHost,
      tron_api_key,
      usdt_contract,
      decimals,
      fee_limit,
      to,
      items,
      taskId,
      enc_mnemonic,
      password,
      indices
    } = params;

    const ref = await fetchRefBlock(fullHost, tron_api_key);
    const mnemonic = await decryptMnemonic(enc_mnemonic, password);
    const derived = deriveHdWalletByIndices(mnemonic, indices);
    if (derived.items.length !== items.length) {
      throw new Error("派生数量与签名条数不一致");
    }
    const signItems = items.map((row: any, idx: number) => {
      const d = derived.items[idx];
      if (!d || d.address !== row.from) {
        throw new Error(`第 ${idx + 1} 行地址不匹配`);
      }
      return {
        ...row,
        private_key: d.privateKey
      };
    });
    const signInput = {
      contract_address: usdt_contract,
      to,
      decimals,
      fee_limit,
      timestamp: Number(ref.timestamp || 0),
      expiration: Number(ref.expiration || 0),
      ref_block_bytes: String(ref.ref_block_bytes || ""),
      ref_block_hash: String(ref.ref_block_hash || ""),
      items: signItems
    };

    const tempOutput = path.join(app.getPath("temp"), `quick-collect-${webcrypto.randomUUID()}.json`);
    sendLog(event, `快捷归集开始: items=${signItems.length}, host=${fullHost}`);
    try {
      await collectSign(signInput as any, tempOutput, (p) => sendProgress(event, taskId, { stage: "sign", ...p }));
      const signedText = await fsp.readFile(tempOutput, "utf8");
      const parsed = JSON.parse(signedText);
      const signedTxs = Array.isArray(parsed?.signed_txs) ? parsed.signed_txs : [];
      const broadcastRes = await broadcast(
        fullHost,
        signedTxs,
        tron_api_key,
        usdt_contract,
        (p) => sendProgress(event, taskId, { stage: "broadcast", ...p })
      );
      sendLog(event, `快捷归集完成: success=${broadcastRes.success}, fail=${broadcastRes.fail}`);
      return {
        signed: signedTxs.length,
        success: broadcastRes.success,
        fail: broadcastRes.fail,
        results: broadcastRes.results
      };
    } finally {
      try {
        if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
      } catch {
        // ignore cleanup errors
      }
    }
  });

  ipcMain.handle("broadcast:send", async (event, params) => {
    const { fullHost, signedTxs, outputPath, taskId, tron_api_key, expectedContract } = params;
    const resolvedOutput = resolveOutputPath(outputPath, "broadcast_results.json");
    sendLog(event, `广播开始: txs=${signedTxs.length}, host=${fullHost}`);
    const res = await broadcast(fullHost, signedTxs, tron_api_key, expectedContract, (p) =>
      sendProgress(event, taskId, { stage: "broadcast", ...p })
    );
    await fsp.writeFile(resolvedOutput, JSON.stringify({ results: res.results }, null, 2), "utf8");
    sendLog(event, `广播完成: success=${res.success}, fail=${res.fail}`);
    return { ...res, outputPath: resolvedOutput };
  });

  ipcMain.handle("scan:addresses", async (event, params) => {
    const { addresses, threshold, taskId, fullHost, usdtContract, decimals, tron_api_key } = params;
    sendLog(event, `扫描开始: addresses=${addresses.length}, threshold=${threshold}`);
    const res = await scanAddresses(
      fullHost,
      tron_api_key,
      usdtContract,
      decimals,
      addresses,
      threshold,
      (p) => sendProgress(event, taskId, { stage: "scan", ...p })
    );
    sendLog(event, `扫描完成: count_over=${res.count_over_threshold}`);
    return res;
  });

  ipcMain.handle("wallet:getBalances", async (event, params) => {
    const { fullHost, tron_api_key, address, usdt_contract } = params || {};
    if (!fullHost) throw new Error("full_host 不能为空");
    if (!address) throw new Error("address 不能为空");
    if (!TronWeb.isAddress(address)) throw new Error("地址格式不正确");

    const tronWeb = new TronWeb(buildTronWebOptions(fullHost, tron_api_key));
    tronWeb.setAddress(address);
    const trxSun = normalizeTronValue(await tronWeb.trx.getBalance(address));
    let usdtSun: string | null = null;
    const contract = String(usdt_contract ?? "").trim();
    if (contract && contract !== "REPLACE_WITH_USDT_CONTRACT") {
      if (!TronWeb.isAddress(contract)) {
        throw new Error("USDT 合约地址格式不正确");
      }
      const instance = await tronWeb.contract().at(contract);
      const res = await instance.balanceOf(address).call();
      usdtSun = normalizeTronValue(res);
    }
    return { address, trxSun, usdtSun };
  });

  ipcMain.handle("transfer:send", async (event, params) => {
    validateTransferParams(params);
    const {
      fullHost,
      tron_api_key,
      asset,
      to,
      amount,
      enc_mnemonic,
      password,
      index,
      from,
      usdt_contract,
      decimals,
      fee_limit
    } = params;

    if (!TronWeb.isAddress(to)) {
      throw new Error("目标地址格式不正确");
    }
    if (asset === "USDT" && usdt_contract && !TronWeb.isAddress(usdt_contract)) {
      throw new Error("USDT 合约地址格式不正确");
    }

    const mnemonic = await decryptMnemonic(enc_mnemonic, password);
    const derived = deriveHdWalletByIndices(mnemonic, [index]);
    const item = derived.items[0];
    if (!item?.address || !item?.privateKey) {
      throw new Error("派生地址失败");
    }
    if (from && from !== item.address) {
      throw new Error("选择地址与派生地址不一致");
    }

    const tronWeb = new TronWeb(buildTronWebOptions(fullHost, tron_api_key));
    sendLog(event, `转账开始: asset=${asset}, from=${item.address}, to=${to}`);
    let txid = "";
    if (asset === "TRX") {
      txid = await transferTrx(tronWeb, {
        from: item.address,
        to,
        privateKey: item.privateKey,
        amount
      });
    } else if (asset === "USDT") {
      const ref = await fetchRefBlock(fullHost, tron_api_key);
      txid = await transferTrc20(tronWeb, {
        from: item.address,
        to,
        privateKey: item.privateKey,
        amount,
        contract: usdt_contract,
        decimals,
        fee_limit,
        refBlock: ref
      });
    } else {
      throw new Error(`不支持的资产类型: ${String(asset)}`);
    }

    sendLog(event, `转账完成: asset=${asset}, from=${item.address}, to=${to}, txid=${txid}`);
    return {
      txid,
      from: item.address,
      to,
      asset,
      amount
    };
  });

  ipcMain.handle("hd:generate", async (event) => {
    sendLog(event, "HD 钱包创建: 生成助记词");
    return generateHdWallet();
  });

  ipcMain.handle("hd:fromMnemonic", async (event, params) => {
    const { mnemonic } = params || {};
    if (!mnemonic) throw new Error("助记词不能为空");
    sendLog(event, "HD 钱包导入: 使用助记词生成");
    return importHdWalletFromMnemonic(String(mnemonic));
  });

  ipcMain.handle("hd:derive", async (event, params) => {
    const { mnemonic, startIndex, count } = params;
    if (!mnemonic) throw new Error("mnemonic 不能为空");
    if (!Number.isInteger(startIndex) || startIndex < 0) throw new Error("startIndex 必须为非负整数");
    if (!Number.isInteger(count) || count <= 0) throw new Error("count 必须为正整数");
    sendLog(event, `HD 钱包派生: start=${startIndex}, count=${count}`);
    return deriveHdWallet(mnemonic, startIndex, count);
  });

  ipcMain.handle("hd:deriveIndices", async (event, params) => {
    const { mnemonic, indices } = params;
    if (!mnemonic) throw new Error("mnemonic 不能为空");
    if (!Array.isArray(indices) || indices.length === 0) throw new Error("indices 不能为空");
    if (indices.some((i) => !Number.isInteger(i) || i < 0)) {
      throw new Error("indices 必须为非负整数数组");
    }
    sendLog(event, `HD 钱包派生: indices=${indices.length}`);
    return deriveHdWalletByIndices(mnemonic, indices);
  });

  ipcMain.handle("hd:deriveXpub", async (event, params) => {
    const { xpub, indices } = params;
    if (!xpub) throw new Error("xpub 不能为空");
    if (!Array.isArray(indices) || indices.length === 0) throw new Error("indices 不能为空");
    if (indices.some((i) => !Number.isInteger(i) || i < 0)) {
      throw new Error("indices 必须为非负整数数组");
    }
    sendLog(event, `HD 派生(xpub): indices=${indices.length}`);
    return deriveHdWalletFromXpub(xpub, indices);
  });

  ipcMain.handle("shell:openExternal", async (_event, url: string) => {
    if (typeof url !== "string" || !url.trim()) {
      throw new Error("url 不能为空");
    }
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
    if (protocol !== "https:" && !(protocol === "http:" && isLocal)) {
      throw new Error("仅允许打开 https 或本地调试链接");
    }
    await shell.openExternal(url);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
