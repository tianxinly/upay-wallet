declare const require: NodeRequire;
// IMPORTANT: TronWeb 在不同打包/运行环境下导出形式不一致
// 这里使用 require 兼容 CJS/ESM 形态，确保构造函数可用
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tronwebPkg = require("tronweb");
const TronWeb = tronwebPkg.TronWeb || tronwebPkg.default || tronwebPkg;

const PATH_PREFIX = "m/44'/195'/0'/0";

function getMnemonicPhrase(mnemonic: any) {
  return String(mnemonic?.phrase ?? mnemonic ?? "").trim();
}

export function generateHdWallet() {
  const account = TronWeb.createRandom("", `${PATH_PREFIX}/0`);
  const mnemonic = getMnemonicPhrase(account.mnemonic);
  if (!mnemonic) throw new Error("助记词生成失败");

  const account1 = TronWeb.fromMnemonic(mnemonic, `${PATH_PREFIX}/1`);

  const { ethersHDNodeWallet, Mnemonic } =
    tronwebPkg.utils?.ethersUtils || tronwebPkg.default?.utils?.ethersUtils || TronWeb.utils.ethersUtils;
  const root = ethersHDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(mnemonic), PATH_PREFIX);
  const xpub = root.neuter().extendedKey;

  return {
    mnemonic,
    xpub,
    address: account.address,
    addresses: [account.address, account1?.address].filter(Boolean),
    path_prefix: PATH_PREFIX
  };
}

export function importHdWalletFromMnemonic(mnemonic: string) {
  const account0 = TronWeb.fromMnemonic(mnemonic, `${PATH_PREFIX}/0`);
  const account1 = TronWeb.fromMnemonic(mnemonic, `${PATH_PREFIX}/1`);
  const { ethersHDNodeWallet, Mnemonic } =
    tronwebPkg.utils?.ethersUtils || tronwebPkg.default?.utils?.ethersUtils || TronWeb.utils.ethersUtils;
  const root = ethersHDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(mnemonic), PATH_PREFIX);
  const xpub = root.neuter().extendedKey;
  return {
    xpub,
    address: account0.address,
    addresses: [account0.address, account1?.address].filter(Boolean),
    path_prefix: PATH_PREFIX
  };
}

export function deriveHdWallet(mnemonic: string, startIndex: number, count: number) {
  const items: { index: number; address: string; privateKey: string; publicKey: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = startIndex + i;
    const path = `${PATH_PREFIX}/${index}`;
    const account = TronWeb.fromMnemonic(mnemonic, path);
    const privateKey = String(account.privateKey ?? "").replace(/^0x/, "");
    const publicKey = String(account.publicKey ?? "").replace(/^0x/, "");
    items.push({
      index,
      address: String(account.address ?? ""),
      privateKey,
      publicKey
    });
  }
  return { items };
}

export function deriveHdWalletByIndices(mnemonic: string, indices: number[]) {
  const items: { index: number; address: string; privateKey: string; publicKey: string }[] = [];
  for (const index of indices) {
    const path = `${PATH_PREFIX}/${index}`;
    const account = TronWeb.fromMnemonic(mnemonic, path);
    const privateKey = String(account.privateKey ?? "").replace(/^0x/, "");
    const publicKey = String(account.publicKey ?? "").replace(/^0x/, "");
    items.push({
      index,
      address: String(account.address ?? ""),
      privateKey,
      publicKey
    });
  }
  return { items };
}

function tronAddressFromEth(ethAddress: string) {
  const hex = ethAddress.replace(/^0x/, "");
  return TronWeb.address.fromHex(`41${hex}`);
}

export function deriveHdWalletFromXpub(xpub: string, indices: number[]) {
  const { ethersHDNodeWallet } =
    tronwebPkg.utils?.ethersUtils || tronwebPkg.default?.utils?.ethersUtils || TronWeb.utils.ethersUtils;
  const root = ethersHDNodeWallet.fromExtendedKey(xpub);
  const items = indices.map((index) => {
    const child = root.deriveChild(index);
    return {
      index,
      address: tronAddressFromEth(child.address),
      publicKey: String(child.publicKey ?? "")
    };
  });
  return { items };
}
