declare const require: NodeRequire;

// IMPORTANT: TronWeb 在不同打包/运行环境下导出形式不一致
// 这里使用 require 兼容 CJS/ESM 形态，确保构造函数可用
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tronwebPkg = require("tronweb");
const TronWeb = tronwebPkg.TronWeb || tronwebPkg.default || tronwebPkg;

export function assertHex(name: string, value: string, len?: number) {
  if (typeof value !== "string") throw new Error(`${name} 必须是十六进制字符串`);
  if (!/^[0-9a-fA-F]+$/.test(value)) throw new Error(`${name} 必须是十六进制`);
  if (len && value.length !== len) throw new Error(`${name} 必须是 ${len} 位十六进制`);
}

export function toSun(amount: string | number, decimals: number) {
  const s = String(amount);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`amount 必须是数字字符串: ${s}`);
  const [i, f = ""] = s.split(".");
  if (f.length > decimals) {
    throw new Error(`amount 小数位过多，最多 ${decimals} 位`);
  }
  const frac = f.padEnd(decimals, "0");
  return BigInt(i + frac);
}

export function buildTransferData(tronWeb: any, toBase58: string, amountSun: bigint) {
  // transfer(address,uint256) 方法选择器固定为 a9059cbb
  const methodId = "a9059cbb";
  const tronHex = TronWeb.address.toHex(toBase58); // 41 + 20 bytes
  const evmHex = tronHex.startsWith("41") ? "0x" + tronHex.slice(2) : "0x" + tronHex;
  const abi = tronWeb?.utils?.abi || TronWeb?.utils?.abi;
  if (!abi) {
    throw new Error("TronWeb ABI 不可用，无法编码参数");
  }
  const params = abi.encodeParams(["address", "uint256"], [evmHex, amountSun.toString()]).replace(/^0x/, "");
  return methodId + params;
}
