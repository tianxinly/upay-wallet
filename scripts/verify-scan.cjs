const fs = require("node:fs");
const path = require("node:path");
const tronwebPkg = require("tronweb");
const TronWeb = tronwebPkg.TronWeb || tronwebPkg.default || tronwebPkg;

const ADDR_TXT = path.join(__dirname, "tron_addresses.txt");
const ADDR_CSV = path.join(__dirname, "tron_addresses.csv");
const ADDR_FILE = process.env.ADDR_FILE ? path.resolve(process.env.ADDR_FILE) : "";

const THRESHOLD = "1";

const DEFAULT_CONFIG = {
  network: "nile",
  full_host: "https://nile.trongrid.io",
  usdt_contract: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
  decimals: 6,
  fee_limit: 30000000
};

function readConfig() {
  return {
    ...DEFAULT_CONFIG,
    full_host: process.env.FULL_HOST || DEFAULT_CONFIG.full_host,
    usdt_contract: process.env.USDT_CONTRACT || DEFAULT_CONFIG.usdt_contract,
    decimals: process.env.DECIMALS ? Number(process.env.DECIMALS) : DEFAULT_CONFIG.decimals,
    fee_limit: process.env.FEE_LIMIT ? Number(process.env.FEE_LIMIT) : DEFAULT_CONFIG.fee_limit
  };
}

function readAddresses() {
  if (ADDR_FILE) {
    if (!fs.existsSync(ADDR_FILE)) {
      throw new Error(`ADDR_FILE 不存在: ${ADDR_FILE}`);
    }
    return fs.readFileSync(ADDR_FILE, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }
  if (fs.existsSync(ADDR_TXT)) {
    return fs.readFileSync(ADDR_TXT, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }
  if (fs.existsSync(ADDR_CSV)) {
    const lines = fs.readFileSync(ADDR_CSV, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const header = String(lines[0] || "");
    const dataLines = /address/i.test(header) ? lines.slice(1) : lines;
    return dataLines.map((line) => line.split(",")[0].trim()).filter(Boolean);
  }
  throw new Error(
    "找不到地址文件：tron_addresses.txt 或 tron_addresses.csv。\n" +
    "可先执行: node scripts/tronweb-generate-wallets.cjs\n" +
    "或通过环境变量 ADDR_FILE 指定地址文件。"
  );
}

function toDecimalString(amountSun, decimals) {
  const s = amountSun.toString();
  if (decimals === 0) return s;
  const pad = s.padStart(decimals + 1, "0");
  const i = pad.slice(0, -decimals);
  const f = pad.slice(-decimals).replace(/0+$/, "");
  return f ? `${i}.${f}` : i;
}

function parseThresholdToSun(amount, decimals) {
  const s = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("阈值必须是数字字符串");
  const [i, f = ""] = s.split(".");
  if (f.length > decimals) {
    throw new Error(`阈值小数位过多，最多 ${decimals} 位`);
  }
  const frac = f.padEnd(decimals, "0");
  return BigInt(i + frac);
}

async function main() {
  const cfg = readConfig();
  if (!cfg.full_host) throw new Error("配置缺少 full_host");
  if (!cfg.usdt_contract) throw new Error("配置缺少 usdt_contract");

  const addresses = readAddresses();
  if (addresses.length === 0) throw new Error("地址列表为空");

  const tronWeb = new TronWeb({ fullHost: cfg.full_host });
  tronWeb.setAddress(addresses[0]);
  const contract = await tronWeb.contract().at(cfg.usdt_contract);
  const thresholdSun = parseThresholdToSun(THRESHOLD, cfg.decimals);

  let total = 0n;
  let totalOver = 0n;
  let countOver = 0;

  for (let i = 0; i < addresses.length; i += 1) {
    const res = await contract.balanceOf(addresses[i]).call();
    const balance = BigInt(res?.toString?.() ?? String(res));
    total += balance;
    if (balance > thresholdSun) {
      countOver += 1;
      totalOver += balance;
    }
  }

  const result = {
    total_addresses: addresses.length,
    threshold: THRESHOLD,
    total_amount: toDecimalString(total, cfg.decimals),
    total_over_threshold: toDecimalString(totalOver, cfg.decimals),
    count_over_threshold: countOver
  };

  const outPath = path.join(__dirname, "scan.verify.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log("OK: 扫描完成 ->", outPath);
  console.log(result);
}

main().catch((e) => {
  console.error(e?.stack ?? e?.message ?? String(e));
  process.exit(1);
});
