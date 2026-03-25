import path from "node:path";
import fs from "node:fs";
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
import { activateAddressesWithFeeWallets, getFeeWalletStates, initializeFeeWallets } from "../core/tron/feeWallet";
import {
  deriveHdWallet,
  deriveHdWalletByIndices,
  deriveHdWalletFromXpub,
  generateHdWallet,
  importHdWalletFromMnemonic
} from "../core/tron/hdWallet";

const ENC_PREFIX = "enc:v1:";

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
      fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`, "utf8");
    }
  };
}

const logger = createLogger();

function getSecureConfigPath() {
  return path.join(app.getPath("userData"), "secure-config.json");
}

function saveSecureConfig(data: Record<string, any>) {
  const text = JSON.stringify(data ?? {});
  const securePath = getSecureConfigPath();
  fs.mkdirSync(path.dirname(securePath), { recursive: true });
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(text);
    const payload = `safe:v1:${encrypted.toString("base64")}`;
    fs.writeFileSync(securePath, payload, "utf8");
    return;
  }
  fs.writeFileSync(securePath, text, "utf8");
}

function loadSecureConfig() {
  try {
    const securePath = getSecureConfigPath();
    if (!fs.existsSync(securePath)) return {};
    const raw = fs.readFileSync(securePath, "utf8");
    if (!raw.trim()) return {};
    if (raw.startsWith("safe:v1:")) {
      if (!safeStorage.isEncryptionAvailable()) return {};
      const b64 = raw.slice("safe:v1:".length);
      const decrypted = safeStorage.decryptString(Buffer.from(b64, "base64"));
      return JSON.parse(decrypted);
    }
    return JSON.parse(raw);
  } catch {
    return {};
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
  event.sender.send("app:log", message);
}

function resolveOutputPath(filePath: string | undefined, defaultName: string) {
  const base = path.join(app.getPath("documents"), "TronWalletSuite");
  if (!filePath || filePath.trim() === "") {
    return path.join(base, defaultName);
  }
  return path.isAbsolute(filePath) ? filePath : path.join(base, filePath);
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

  ipcMain.handle("secure:load", () => loadSecureConfig());
  ipcMain.handle("secure:save", async (_event, data) => {
    saveSecureConfig(data ?? {});
    return true;
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
    return fs.readFileSync(filePath, "utf8");
  });

  ipcMain.handle("file:readJson", async (_event, token: string) => {
    const filePath = resolveReadFileByToken(token);
    const text = fs.readFileSync(filePath, "utf8");
    return JSON.parse(text);
  });

  ipcMain.handle("file:writeText", async (_event, token: string, content: string) => {
    const filePath = resolveWriteFileByToken(token);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
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

  ipcMain.handle("broadcast:send", async (event, params) => {
    const { fullHost, signedTxs, outputPath, taskId, tron_api_key, expectedContract } = params;
    const resolvedOutput = resolveOutputPath(outputPath, "broadcast_results.json");
    sendLog(event, `广播开始: txs=${signedTxs.length}, host=${fullHost}`);
    const res = await broadcast(fullHost, signedTxs, tron_api_key, expectedContract, (p) =>
      sendProgress(event, taskId, { stage: "broadcast", ...p })
    );
    fs.writeFileSync(resolvedOutput, JSON.stringify({ results: res.results }, null, 2));
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

  ipcMain.handle("fee:initialize", async (event, params) => {
    const { fullHost, tron_api_key, enc_mnemonic, password, maxWallets, taskId } = params || {};
    if (!fullHost) throw new Error("full_host 不能为空");
    if (!enc_mnemonic || !password) throw new Error("HD 钱包解密参数缺失");
    const maxCountRaw = Number(maxWallets ?? 200);
    const maxCount = Number.isInteger(maxCountRaw) ? maxCountRaw : 200;
    if (maxCount < 2 || maxCount > 1000) throw new Error("maxWallets 必须在 2~1000 之间");

    const mnemonic = await decryptMnemonic(enc_mnemonic, password);
    const indices = Array.from({ length: maxCount }, (_, idx) => idx);
    const derived = deriveHdWalletByIndices(mnemonic, indices);
    sendLog(event, `手续费钱包初始化开始: wallets=${maxCount}`);
    const res = await initializeFeeWallets(
      fullHost,
      tron_api_key,
      derived.items.map((i) => ({
        index: i.index,
        address: i.address,
        privateKey: i.privateKey
      })),
      (p) => sendProgress(event, taskId, { stage: "fee", ...p })
    );
    sendLog(
      event,
      `手续费钱包初始化完成: before=${res.activatedCountBefore}, after=${res.activatedCountAfter}, initialized=${res.initialized}`
    );
    return res;
  });

  ipcMain.handle("fee:activateAddresses", async (event, params) => {
    const { fullHost, tron_api_key, enc_mnemonic, password, addresses, maxWallets, taskId } = params || {};
    if (!fullHost) throw new Error("full_host 不能为空");
    if (!enc_mnemonic || !password) throw new Error("HD 钱包解密参数缺失");
    if (!Array.isArray(addresses) || addresses.length === 0) throw new Error("addresses 不能为空");
    const maxCountRaw = Number(maxWallets ?? 200);
    const maxCount = Number.isInteger(maxCountRaw) ? maxCountRaw : 200;
    if (maxCount < 2 || maxCount > 1000) throw new Error("maxWallets 必须在 2~1000 之间");

    const mnemonic = await decryptMnemonic(enc_mnemonic, password);
    const indices = Array.from({ length: maxCount }, (_, idx) => idx);
    const derived = deriveHdWalletByIndices(mnemonic, indices);
    sendLog(event, `手续费地址激活开始: targets=${addresses.length}, wallets=${maxCount}`);
    const res = await activateAddressesWithFeeWallets(
      fullHost,
      tron_api_key,
      derived.items.map((i) => ({
        index: i.index,
        address: i.address,
        privateKey: i.privateKey
      })),
      addresses,
      (p) => sendProgress(event, taskId, { stage: "fee", ...p })
    );
    sendLog(
      event,
      `手续费地址激活完成: activated=${res.activated}, already=${res.alreadyActive}, waiting=${res.waiting}, failed=${res.failed}`
    );
    return res;
  });

  ipcMain.handle("fee:getStates", async (event, params) => {
    const { fullHost, tron_api_key, enc_mnemonic, password, maxWallets } = params || {};
    if (!fullHost) throw new Error("full_host 不能为空");
    if (!enc_mnemonic || !password) throw new Error("HD 钱包解密参数缺失");
    const maxCountRaw = Number(maxWallets ?? 200);
    const maxCount = Number.isInteger(maxCountRaw) ? maxCountRaw : 200;
    if (maxCount < 1 || maxCount > 1000) throw new Error("maxWallets 必须在 1~1000 之间");

    const mnemonic = await decryptMnemonic(enc_mnemonic, password);
    const indices = Array.from({ length: maxCount }, (_, idx) => idx);
    const derived = deriveHdWalletByIndices(mnemonic, indices);
    sendLog(event, `手续费地址状态查询: wallets=${maxCount}`);
    return getFeeWalletStates(
      fullHost,
      tron_api_key,
      derived.items.map((i) => ({
        index: i.index,
        address: i.address,
        privateKey: i.privateKey
      }))
    );
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
    if (protocol !== "https:" && protocol !== "http:") {
      throw new Error("仅允许打开 http/https 链接");
    }
    await shell.openExternal(url);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
