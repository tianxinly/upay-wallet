import { contextBridge, ipcRenderer } from "electron";

// 关键安全边界：仅暴露白名单 IPC，禁止直接暴露 Node API
contextBridge.exposeInMainWorld("api", {
  appInfo: () => ipcRenderer.invoke("app:info"),
  loadSecureConfig: () => ipcRenderer.invoke("secure:load"),
  saveSecureConfig: (data: any) => ipcRenderer.invoke("secure:save", data),

  selectOpenFile: (options?: { filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke("dialog:openFile", options),
  selectSaveFile: (options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke("dialog:saveFile", options),

  readTextFile: (token: string) => ipcRenderer.invoke("file:readText", token),
  readJsonFile: (token: string) => ipcRenderer.invoke("file:readJson", token),
  writeTextFile: (token: string, content: string) => ipcRenderer.invoke("file:writeText", token, content),

  fetchRefBlock: (params: { fullHost: string; tron_api_key?: string }) => ipcRenderer.invoke("refblock:fetch", params),

  collectSign: (params: { input: any; outputPath: string; taskId: string }) =>
    ipcRenderer.invoke("collect:sign", params),
  collectSignHd: (params: {
    input: any;
    outputPath: string;
    taskId: string;
    enc_mnemonic: string;
    password: string;
    indices: number[];
  }) => ipcRenderer.invoke("collect:signHd", params),
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
  }) => ipcRenderer.invoke("quick:collect", params),
  broadcast: (params: {
    fullHost: string;
    tron_api_key?: string;
    expectedContract?: string;
    signedTxs: any[];
    outputPath?: string;
    taskId: string;
  }) =>
    ipcRenderer.invoke("broadcast:send", params),
  scanAddresses: (params: {
    fullHost: string;
    tron_api_key?: string;
    usdtContract: string;
    decimals: number;
    addresses: string[];
    threshold: string;
    taskId: string;
  }) =>
    ipcRenderer.invoke("scan:addresses", params),
  walletGetBalances: (params: {
    fullHost: string;
    tron_api_key?: string;
    address: string;
    usdt_contract?: string;
  }) =>
    ipcRenderer.invoke("wallet:getBalances", params),
  transferSend: (params: {
    fullHost: string;
    tron_api_key?: string;
    asset: "TRX" | "USDT";
    to: string;
    amount: string;
    enc_mnemonic: string;
    password: string;
    index: number;
    from?: string;
    usdt_contract?: string;
    decimals?: number;
    fee_limit?: number;
  }) =>
    ipcRenderer.invoke("transfer:send", params),

  hdGenerate: () => ipcRenderer.invoke("hd:generate"),
  hdFromMnemonic: (params: { mnemonic: string }) => ipcRenderer.invoke("hd:fromMnemonic", params),
  hdDerive: (params: { mnemonic: string; startIndex: number; count: number }) =>
    ipcRenderer.invoke("hd:derive", params),
  hdDeriveIndices: (params: { mnemonic: string; indices: number[] }) =>
    ipcRenderer.invoke("hd:deriveIndices", params),
  hdDeriveXpub: (params: { xpub: string; indices: number[] }) =>
    ipcRenderer.invoke("hd:deriveXpub", params),

  onProgress: (callback: (payload: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on("task:progress", handler);
    return () => ipcRenderer.removeListener("task:progress", handler);
  },

  onLog: (callback: (message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on("app:log", handler);
    return () => ipcRenderer.removeListener("app:log", handler);
  },
  writeLog: (message: string) => ipcRenderer.invoke("log:write", message)
});
