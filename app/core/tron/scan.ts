declare const require: NodeRequire;
// IMPORTANT: TronWeb 在不同打包/运行环境下导出形式不一致
// 这里使用 require 兼容 CJS/ESM 形态，确保构造函数可用
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tronwebPkg = require("tronweb");
const TronWeb = tronwebPkg.TronWeb || tronwebPkg.default || tronwebPkg;

type ScanResult = {
  total_addresses: number;
  threshold: string;
  total_amount: string;
  total_over_threshold: string;
  count_over_threshold: number;
  over_items: { address: string; amount: string }[];
  errors?: { address: string; message: string }[];
};

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

function toDecimalString(amountSun: bigint, decimals: number) {
  const s = amountSun.toString();
  if (decimals === 0) return s;
  const pad = s.padStart(decimals + 1, "0");
  const i = pad.slice(0, -decimals);
  const f = pad.slice(-decimals).replace(/0+$/, "");
  return f ? `${i}.${f}` : i;
}

function parseThresholdToSun(amount: string, decimals: number) {
  const s = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("阈值必须是数字字符串");
  const [i, f = ""] = s.split(".");
  if (f.length > decimals) {
    throw new Error(`阈值小数位过多，最多 ${decimals} 位`);
  }
  const frac = f.padEnd(decimals, "0");
  return BigInt(i + frac);
}

export async function scanAddresses(
  fullHost: string,
  tronApiKey: string | undefined,
  contractAddress: string,
  decimals: number,
  addresses: string[],
  threshold: string,
  onProgress?: (p: { current: number; total: number }) => void
): Promise<ScanResult> {
  if (!fullHost) throw new Error("fullHost 为必填");
  if (!contractAddress) throw new Error("usdt_contract 未配置");
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error("地址列表不能为空");
  }

  const invalidAddressErrors = addresses
    .filter((addr) => !TronWeb.isAddress(addr))
    .map((addr) => ({ address: addr, message: "地址格式无效" }));
  const validAddresses = addresses.filter((addr) => TronWeb.isAddress(addr));
  if (validAddresses.length === 0) {
    throw new Error("地址列表无有效地址");
  }

  const tronWeb = new TronWeb({
    fullHost,
    headers: tronApiKey && tronApiKey.trim() ? { "TRON-PRO-API-KEY": tronApiKey.trim() } : undefined
  });
  // 读取合约需要 owner_address，使用首个地址作为默认调用者
  tronWeb.setAddress(validAddresses[0]);
  const contract = await tronWeb.contract().at(contractAddress);
  const thresholdSun = parseThresholdToSun(threshold, decimals);

  let total = 0n;
  let totalOver = 0n;
  let countOver = 0;
  const over_items: { address: string; amount: string }[] = [];

  // 控制并发/节流，避免节点限流或请求过载
  const CONCURRENCY = 2;
  const MIN_INTERVAL_MS = 300;
  const MAX_RETRIES = 4;
  const throttle = createThrottle(MIN_INTERVAL_MS);
  let index = 0;
  let done = 0;
  const errors: { address: string; message: string }[] = [...invalidAddressErrors];

  async function worker() {
    while (true) {
      const i = index;
      index += 1;
      if (i >= validAddresses.length) break;
      const addr = validAddresses[i];
      // USDT 余额读取：balanceOf(address)
      let balance = 0n;
      try {
        await throttle();
        const res = await callWithRetry(() => contract.balanceOf(addr).call(), MAX_RETRIES);
        balance = BigInt(res?.toString?.() ?? String(res));
      } catch (err: any) {
        errors.push({ address: addr, message: err?.message ?? String(err) });
        done += 1;
        if (onProgress) onProgress({ current: done, total: validAddresses.length });
        continue;
      }

      total += balance;
      if (balance > thresholdSun) {
        countOver += 1;
        totalOver += balance;
        over_items.push({
          address: addr,
          amount: toDecimalString(balance, decimals)
        });
      }
      done += 1;
      if (onProgress) onProgress({ current: done, total: validAddresses.length });
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, validAddresses.length) }, () => worker());
  await Promise.all(workers);

  return {
    total_addresses: addresses.length,
    threshold,
    total_amount: toDecimalString(total, decimals),
    total_over_threshold: toDecimalString(totalOver, decimals),
    count_over_threshold: countOver,
    over_items,
    errors: errors.length > 0 ? errors : undefined
  };
}
