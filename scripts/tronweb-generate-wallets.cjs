// 生成 TRON 钱包（默认 10000 个）；会写出明文私钥，请谨慎保管输出文件。
const fs = require("node:fs");
const { TronWeb } = require("tronweb");

(async () => {
  const count = Number(process.env.COUNT ?? "100");
  if (!Number.isInteger(count) || count <= 0) throw new Error("COUNT must be a positive integer");
  const addrs = [];
  const csv = ["address,private_key_hex"];
  for (let i = 0; i < count; i += 1) {
    const { privateKey, address } = await TronWeb.createAccount();
    addrs.push(address.base58);
    csv.push(`${address.base58},${privateKey}`);
  }
  fs.writeFileSync("tron_addresses.txt", `${addrs.join("\n")}\n`);
  fs.writeFileSync("tron_addresses_with_private_keys.csv", `${csv.join("\n")}\n`);
  console.log("OK");
})().catch((e) => {
  console.error(e?.message ?? String(e));
  process.exit(1);
});
