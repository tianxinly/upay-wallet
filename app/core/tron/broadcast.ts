declare const require: NodeRequire;
// IMPORTANT: TronWeb 在不同打包/运行环境下导出形式不一致
// 这里使用 require 兼容 CJS/ESM 形态，确保构造函数可用
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tronwebPkg = require("tronweb");
const TronWeb = tronwebPkg.TronWeb || tronwebPkg.default || tronwebPkg;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTooManyRequestsError(err: any) {
  const status = err?.response?.status ?? err?.status;
  return status === 429;
}

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries: number) {
  let lastErr: any;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (!isTooManyRequestsError(err) || attempt === maxRetries) throw err;
      const backoff = 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

function createThrottle(minIntervalMs: number) {
  let nextAllowed = 0;
  let lock = Promise.resolve();
  return async () => {
    let unlock: () => void;
    const willLock = new Promise<void>((r) => {
      unlock = r;
    });
    const prev = lock;
    lock = willLock;
    await prev;
    const now = Date.now();
    const wait = Math.max(0, nextAllowed - now);
    nextAllowed = now + wait + minIntervalMs;
    unlock!();
    if (wait > 0) await sleep(wait);
  };
}

export async function broadcast(
  fullHost: string,
  signedTxs: any[],
  tronApiKey?: string,
  expectedContract?: string,
  onProgress?: (p: { current: number; total: number }) => void
) {
  if (!fullHost) throw new Error("fullHost 为必填");
  if (!Array.isArray(signedTxs) || signedTxs.length === 0) {
    throw new Error("signed_txs 必须为非空数组");
  }

  // 广播属于在线操作，明确在此处进行网络请求
  const tronWeb = new TronWeb({
    fullHost,
    headers: tronApiKey && tronApiKey.trim() ? { "TRON-PRO-API-KEY": tronApiKey.trim() } : undefined
  });

  if (expectedContract && expectedContract.trim()) {
    let expectedHex = "";
    try {
      expectedHex = TronWeb.address.toHex(expectedContract.trim()).replace(/^0x/, "").toLowerCase();
    } catch {
      // ignore parse error
    }
    if (expectedHex) {
      const mismatchTx = signedTxs.find((tx) => {
        const contractHex = String(
          tx?.raw_data?.contract?.[0]?.parameter?.value?.contract_address ?? ""
        )
          .replace(/^0x/, "")
          .toLowerCase();
        return contractHex && contractHex !== expectedHex;
      });
      if (mismatchTx) {
        const actualHex = String(
          mismatchTx?.raw_data?.contract?.[0]?.parameter?.value?.contract_address ?? ""
        )
          .replace(/^0x/, "")
          .toLowerCase();
        let actualBase58 = "";
        try {
          actualBase58 = TronWeb.address.fromHex(actualHex);
        } catch {
          // ignore
        }
        const actualLabel = actualBase58 || actualHex || "未知合约地址";
        throw new Error(
          `签名文件合约地址为 ${actualLabel}，与当前配置 ${expectedContract.trim()} 不一致，可能网络错误，请切换到正确网络后再广播。`
        );
      }
    }
  }
  const results: any[] = [];
  let success = 0;
  let fail = 0;
  const MIN_INTERVAL_MS = 300;
  const MAX_RETRIES = 3;
  const throttle = createThrottle(MIN_INTERVAL_MS);

  for (let i = 0; i < signedTxs.length; i += 1) {
    await throttle();
    let res: any;
    try {
      res = await callWithRetry(() => tronWeb.trx.sendRawTransaction(signedTxs[i]), MAX_RETRIES);
    } catch (err: any) {
      res = {
        result: false,
        error: err?.message ?? String(err),
        code: err?.response?.status ?? err?.status
      };
    }
    results.push(res);
    if (res && res.result === true) {
      success += 1;
    } else {
      fail += 1;
    }
    if (onProgress) onProgress({ current: i + 1, total: signedTxs.length });
  }

  return {
    results,
    success,
    fail
  };
}
