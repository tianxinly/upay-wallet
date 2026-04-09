import { assertHex, buildTransferData, toSun } from "./common";

declare const require: NodeRequire;
// IMPORTANT: TronWeb 在不同打包/运行环境下导出形式不一致
// 这里使用 require 兼容 CJS/ESM 形态，确保构造函数可用
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tronwebPkg = require("tronweb");
const TronWeb = tronwebPkg.TronWeb || tronwebPkg.default || tronwebPkg;

type RefBlock = {
  ref_block_bytes: string;
  ref_block_hash: string;
  timestamp: number;
  expiration: number;
};

function decodeBroadcastError(res: any) {
  const raw = String(res?.message ?? res?.code ?? "广播失败");
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) {
    return Buffer.from(raw, "hex").toString("utf8");
  }
  return raw;
}

function toBigIntValue(value: any) {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (typeof value === "object") {
    if (typeof value.toString === "function") {
      return BigInt(value.toString());
    }
    if ("_hex" in value) {
      return BigInt(value._hex);
    }
  }
  throw new Error("无法解析余额数值");
}

export async function transferTrx(
  tronWeb: any,
  params: { from: string; to: string; privateKey: string; amount: string }
) {
  const amountSun = toSun(params.amount, 6);
  if (amountSun <= 0n) throw new Error("转账金额必须大于 0");
  if (amountSun > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("转账金额超过安全整数范围");
  }
  const unsigned = await tronWeb.transactionBuilder.sendTrx(params.to, Number(amountSun), params.from);
  const signed = await tronWeb.trx.sign(unsigned, params.privateKey);
  const res = await tronWeb.trx.sendRawTransaction(signed);
  if (!res?.result) {
    throw new Error(decodeBroadcastError(res));
  }
  return String(res?.txid ?? "");
}

export async function transferTrc20(
  tronWeb: any,
  params: {
    from: string;
    to: string;
    privateKey: string;
    amount: string;
    contract: string;
    decimals: number;
    fee_limit: number;
    refBlock: RefBlock;
  }
) {
  const amountSun = toSun(params.amount, params.decimals);
  if (amountSun <= 0n) throw new Error("转账金额必须大于 0");
  if (!Number.isInteger(params.decimals) || params.decimals < 0) {
    throw new Error("decimals 必须为非负整数");
  }
  if (!Number.isInteger(params.fee_limit) || params.fee_limit <= 0) {
    throw new Error("fee_limit 必须为正整数（SUN）");
  }
  assertHex("ref_block_bytes", params.refBlock.ref_block_bytes, 4);
  assertHex("ref_block_hash", params.refBlock.ref_block_hash, 16);
  if (!Number.isInteger(params.refBlock.timestamp) || !Number.isInteger(params.refBlock.expiration)) {
    throw new Error("区块引用时间戳无效");
  }

  tronWeb.setAddress(params.from);
  const instance = await tronWeb.contract().at(params.contract);
  const balanceRes = await instance.balanceOf(params.from).call();
  const balanceSun = toBigIntValue(balanceRes);
  if (balanceSun < amountSun) {
    throw new Error("USDT 余额不足");
  }

  const ownerHex = TronWeb.address.toHex(params.from);
  const contractHex = TronWeb.address.toHex(params.contract);
  const data = buildTransferData(tronWeb, params.to, amountSun);

  const unsigned: any = {
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
      ref_block_bytes: params.refBlock.ref_block_bytes,
      ref_block_hash: params.refBlock.ref_block_hash,
      expiration: params.refBlock.expiration,
      timestamp: params.refBlock.timestamp,
      fee_limit: params.fee_limit
    }
  };

  const txPb = tronWeb.utils.transaction.txJsonToPb(unsigned);
  unsigned.raw_data_hex = tronWeb.utils.transaction.txPbToRawDataHex(txPb).replace(/^0x/, "");
  unsigned.txID = tronWeb.utils.transaction.txPbToTxID(txPb).replace(/^0x/, "");

  const signed = await tronWeb.trx.sign(unsigned, params.privateKey);
  const res = await tronWeb.trx.sendRawTransaction(signed);
  if (!res?.result) {
    throw new Error(decodeBroadcastError(res));
  }
  return String(res?.txid ?? unsigned.txID ?? "");
}
