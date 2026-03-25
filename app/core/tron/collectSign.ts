import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { assertHex, toSun, buildTransferData } from "./common";

declare const require: NodeRequire;
// IMPORTANT: TronWeb 在不同打包/运行环境下导出形式不一致
// 这里使用 require 兼容 CJS/ESM 形态，确保构造函数可用
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tronwebPkg = require("tronweb");
const TronWeb = tronwebPkg.TronWeb || tronwebPkg.default || tronwebPkg;

type SignItem = {
  from: string;
  private_key: string;
  amount: string;
};

type SignInput = {
  contract_address: string;
  to: string;
  decimals: number;
  fee_limit: number;
  timestamp: number;
  expiration: number;
  ref_block_bytes: string;
  ref_block_hash: string;
  items: SignItem[];
};

function validateInput(input: SignInput) {
  if (!input.contract_address || !input.to) {
    throw new Error("contract_address 和 to 为必填");
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("items 必须为非空数组");
  }
  if (!Number.isInteger(input.decimals) || input.decimals < 0) {
    throw new Error("decimals 必须为非负整数");
  }
  if (!Number.isInteger(input.fee_limit) || input.fee_limit <= 0) {
    throw new Error("fee_limit 必须为正整数（SUN）");
  }
  if (!Number.isInteger(input.timestamp) || !Number.isInteger(input.expiration)) {
    throw new Error("timestamp 与 expiration 必须为整数（毫秒）");
  }
  assertHex("ref_block_bytes", input.ref_block_bytes, 4);
  assertHex("ref_block_hash", input.ref_block_hash, 16);
}

function buildUnsignedTx(tronWeb: any, input: SignInput, item: SignItem) {
  const ownerHex = TronWeb.address.toHex(item.from);
  const contractHex = TronWeb.address.toHex(input.contract_address);
  const amountSun = toSun(item.amount, input.decimals);
  const data = buildTransferData(tronWeb, input.to, amountSun);

  return {
    raw_data: {
      contract: [
        {
          parameter: {
            value: {
              data,
              owner_address: ownerHex,
              contract_address: contractHex
            },
            type_url: "type.googleapis.com/protocol.TriggerSmartContract"
          },
          type: "TriggerSmartContract"
        }
      ],
      ref_block_bytes: input.ref_block_bytes,
      ref_block_hash: input.ref_block_hash,
      expiration: input.expiration,
      timestamp: input.timestamp,
      fee_limit: input.fee_limit
    }
  };
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

export async function collectSign(
  input: SignInput,
  outputPath: string,
  onProgress?: (p: { current: number; total: number }) => void
) {
  validateInput(input);

  // 关键说明：离线签名绝不联网，只做本地组包与签名
  const tronWeb = new TronWeb({ fullHost: "http://127.0.0.1" });

  ensureDir(outputPath);
  const tempPath = `${outputPath}.tmp`;
  const stream = fs.createWriteStream(tempPath, { encoding: "utf8" });
  try {
    stream.write("{\"signed_txs\":[");
    let first = true;
    let i = 0;

    for (const item of input.items) {
      if (!item.from || !item.private_key || !item.amount) {
        throw new Error("每个 item 必须包含 from, private_key, amount");
      }
      const unsignedTx = buildUnsignedTx(tronWeb, input, item);

      // 生成 raw_data_hex 与 txID，满足 TronWeb 6+ 的签名校验
      const txPb = tronWeb.utils.transaction.txJsonToPb(unsignedTx);
      unsignedTx.raw_data_hex = tronWeb.utils.transaction.txPbToRawDataHex(txPb).replace(/^0x/, "");
      unsignedTx.txID = tronWeb.utils.transaction.txPbToTxID(txPb).replace(/^0x/, "");

      const signed = await tronWeb.trx.sign(unsignedTx, item.private_key);

      if (!first) stream.write(",");
      stream.write(JSON.stringify(signed));
      first = false;

      i += 1;
      if (onProgress) onProgress({ current: i, total: input.items.length });
    }

    stream.write("]}");
    stream.end();
    await once(stream, "finish");
    fs.renameSync(tempPath, outputPath);
  } catch (e) {
    stream.destroy();
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // ignore cleanup errors
    }
    throw e;
  }

  return {
    count: input.items.length,
    outputPath
  };
}
