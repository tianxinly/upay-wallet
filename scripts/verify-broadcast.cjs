const fs = require("node:fs");
const path = require("node:path");
const tronwebPkg = require("tronweb");
const TronWeb = tronwebPkg.TronWeb || tronwebPkg.default || tronwebPkg;

const CSV_PATH = process.env.CSV_PATH
  ? path.resolve(process.env.CSV_PATH)
  : path.join(__dirname, "tron_addresses_with_private_keys.csv");

const TO_ADDRESS = "TWvD2CLLttnVYgsNkAsRS2eVLSxEUHyXAJ";
const FROM_ADDRESS = "TLumxyjD7hKr7f8UbSE5hXyzX5Ki5odnxs";
const AMOUNT = "100";

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

function readPrivateKey(address) {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(
      `找不到私钥 CSV: ${CSV_PATH}\n` +
      "请先执行: node scripts/tronweb-generate-wallets.cjs\n" +
      "或通过环境变量 CSV_PATH 指定文件路径。"
    );
  }
  const text = fs.readFileSync(CSV_PATH, "utf8");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error("私钥 CSV 为空");
  const header = String(lines[0] || "");
  const dataLines = /address/i.test(header) ? lines.slice(1) : lines;
  for (const line of dataLines) {
    const [addr, pk] = line.split(",").map((s) => s.trim());
    if (addr === address) return pk;
  }
  return null;
}

function toSun(amount, decimals) {
  const s = String(amount);
  const [i, f = ""] = s.split(".");
  const frac = f.padEnd(decimals, "0");
  return BigInt(i + frac);
}

function buildTransferData(tronWeb, toBase58, amountSun) {
  const methodId = "a9059cbb";
  const tronHex = TronWeb.address.toHex(toBase58);
  const evmHex = tronHex.startsWith("41") ? "0x" + tronHex.slice(2) : "0x" + tronHex;
  const params = tronWeb.utils.abi
    .encodeParams(["address", "uint256"], [evmHex, amountSun.toString()])
    .replace(/^0x/, "");
  return methodId + params;
}

async function getRefBlock(tronWeb) {
  const block = await tronWeb.trx.getCurrentBlock();
  const blockId = block?.blockID;
  const blockTs = block?.block_header?.raw_data?.timestamp;
  if (!blockId || !blockTs) throw new Error("无法获取区块信息");
  return {
    ref_block_bytes: blockId.slice(12, 16),
    ref_block_hash: blockId.slice(16, 32),
    timestamp: Number(blockTs),
    expiration: Number(blockTs) + 5 * 60 * 1000
  };
}

async function main() {
  const cfg = readConfig();
  if (!cfg.full_host) throw new Error("配置缺少 full_host");
  if (!cfg.usdt_contract) throw new Error("配置缺少 usdt_contract");

  const privateKey = readPrivateKey(FROM_ADDRESS);
  if (!privateKey) throw new Error("CSV 中找不到对应私钥");

  const tronWeb = new TronWeb({ fullHost: cfg.full_host });
  const refBlock = await getRefBlock(tronWeb);
  const amountSun = toSun(AMOUNT, cfg.decimals);
  const data = buildTransferData(tronWeb, TO_ADDRESS, amountSun);

  const tx = {
    raw_data: {
      contract: [
        {
          parameter: {
            value: {
              data,
              owner_address: TronWeb.address.toHex(FROM_ADDRESS),
              contract_address: TronWeb.address.toHex(cfg.usdt_contract)
            },
            type_url: "type.googleapis.com/protocol.TriggerSmartContract"
          },
          type: "TriggerSmartContract"
        }
      ],
      ref_block_bytes: refBlock.ref_block_bytes,
      ref_block_hash: refBlock.ref_block_hash,
      expiration: refBlock.expiration,
      timestamp: refBlock.timestamp,
      fee_limit: cfg.fee_limit
    }
  };

  const txPb = tronWeb.utils.transaction.txJsonToPb(tx);
  tx.raw_data_hex = tronWeb.utils.transaction.txPbToRawDataHex(txPb).replace(/^0x/, "");
  tx.txID = tronWeb.utils.transaction.txPbToTxID(txPb).replace(/^0x/, "");

  const signed = await tronWeb.trx.sign(tx, privateKey);
  const res = await tronWeb.trx.sendRawTransaction(signed);

  const outPath = path.join(__dirname, "broadcast.verify.json");
  fs.writeFileSync(outPath, JSON.stringify({ signed_txs: [signed], result: res }, null, 2));
  console.log("OK: 广播已完成 ->", outPath);
  console.log(res);
}

main().catch((e) => {
  console.error(e?.stack ?? e?.message ?? String(e));
  process.exit(1);
});
