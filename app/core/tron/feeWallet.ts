declare const require: NodeRequire;
// IMPORTANT: TronWeb 在不同打包/运行环境下导出形式不一致
// 这里使用 require 兼容 CJS/ESM 形态，确保构造函数可用
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tronwebPkg = require("tronweb");
const TronWeb = tronwebPkg.TronWeb || tronwebPkg.default || tronwebPkg;

type WalletItem = {
  index: number;
  address: string;
  privateKey: string;
};

type InitStep = {
  fromIndex: number;
  from: string;
  toIndex: number;
  to: string;
  freeBandwidth: number;
  balanceSun: string;
  amountSun: string;
  status: "sent" | "skipped" | "failed";
  reason?: string;
  txid?: string;
};

type AddressState = {
  index: number;
  address: string;
  activated: boolean;
  balanceSun: string;
  freeBandwidth: number;
};

const MIN_FREE_BANDWIDTH = 300;
const MIN_ACTIVATE_SUN = 1_000_000n; // 1 TRX
const MIN_SENDER_BALANCE_SUN = 2_000_000n; // 2 TRX
const TARGET_ACTIVATE_SUN = 1n; // 激活业务地址默认仅转 1 SUN
const TX_SAFETY_SUN = 10_000n; // 0.01 TRX，避免边界误差导致的余额不足

function buildTronWeb(fullHost: string, tronApiKey?: string) {
  return new TronWeb({
    fullHost,
    headers: tronApiKey && tronApiKey.trim() ? { "TRON-PRO-API-KEY": tronApiKey.trim() } : undefined
  });
}

async function getFreeBandwidth(tronWeb: any, address: string) {
  try {
    const res = await tronWeb.trx.getAccountResources(address);
    const limit = Number(res?.freeNetLimit ?? 0);
    const used = Number(res?.freeNetUsed ?? 0);
    return Math.max(0, limit - used);
  } catch {
    return 0;
  }
}

async function getBalanceSun(tronWeb: any, address: string) {
  const v = await tronWeb.trx.getBalance(address);
  return BigInt(v ?? 0);
}

async function isActivated(tronWeb: any, address: string) {
  try {
    const account = await tronWeb.trx.getAccount(address);
    return Boolean(account && Object.keys(account).length > 0);
  } catch {
    return false;
  }
}

async function transferTrx(
  tronWeb: any,
  from: string,
  to: string,
  fromPrivateKey: string,
  amountSun: bigint
) {
  if (amountSun > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("转账金额超过安全整数范围");
  }
  const unsigned = await tronWeb.transactionBuilder.sendTrx(to, Number(amountSun), from);
  const signed = await tronWeb.trx.sign(unsigned, fromPrivateKey);
  const res = await tronWeb.trx.sendRawTransaction(signed);
  if (!res?.result) {
    const raw = String(res?.message ?? res?.code ?? "广播失败");
    const msg = /^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0
      ? Buffer.from(raw, "hex").toString("utf8")
      : raw;
    throw new Error(msg);
  }
  return String(res?.txid ?? "");
}

function isInsufficientBalanceError(e: unknown) {
  const msg = (e as any)?.message ? String((e as any).message) : String(e ?? "");
  return /balance is not sufficient|余额不足/i.test(msg);
}

async function buildAddressStates(tronWeb: any, wallets: WalletItem[]): Promise<AddressState[]> {
  const flags = await Promise.all(wallets.map((w) => isActivated(tronWeb, w.address)));
  return Promise.all(
    wallets.map(async (w, idx) => ({
      index: w.index,
      address: w.address,
      activated: flags[idx],
      balanceSun: (await getBalanceSun(tronWeb, w.address)).toString(),
      freeBandwidth: await getFreeBandwidth(tronWeb, w.address)
    }))
  );
}

async function scanActivatedPrefix(
  tronWeb: any,
  wallets: WalletItem[]
): Promise<{ activatedStates: AddressState[]; firstInactive: AddressState | null }> {
  const ordered = [...wallets].sort((a, b) => a.index - b.index);
  const activatedStates: AddressState[] = [];
  for (const w of ordered) {
    const activated = await isActivated(tronWeb, w.address);
    const [balanceSun, freeBandwidth] = await Promise.all([getBalanceSun(tronWeb, w.address), getFreeBandwidth(tronWeb, w.address)]);
    if (!activated) {
      return {
        activatedStates,
        firstInactive: {
          index: w.index,
          address: w.address,
          activated: false,
          balanceSun: balanceSun.toString(),
          freeBandwidth
        }
      };
    }
    activatedStates.push({
      index: w.index,
      address: w.address,
      activated: true,
      balanceSun: balanceSun.toString(),
      freeBandwidth
    });
  }
  return { activatedStates, firstInactive: null };
}

export async function initializeFeeWallets(
  fullHost: string,
  tronApiKey: string | undefined,
  wallets: WalletItem[],
  onProgress?: (p: { current: number; total: number; message?: string }) => void
) {
  if (!fullHost) throw new Error("fullHost 为必填");
  if (!Array.isArray(wallets) || wallets.length < 2) throw new Error("钱包数量不足，至少需要 2 个地址");
  const tronWeb = buildTronWeb(fullHost, tronApiKey);
  const beforeScan = await scanActivatedPrefix(tronWeb, wallets);
  const statesBefore = beforeScan.activatedStates;
  const first = statesBefore.find((s) => s.index === 0);
  if (!first || !first.activated) {
    throw new Error("初始化前请先向 index=0 地址打入 TRX 并确保其已激活");
  }
  const shareSun = MIN_ACTIVATE_SUN;
  const firstInactive = beforeScan.firstInactive;
  const steps: InitStep[] = [];

  if (!firstInactive) {
    return {
      initialized: true,
      activatedCountBefore: statesBefore.length,
      activatedCountAfter: statesBefore.length,
      shareSun: shareSun.toString(),
      steps,
      addressStates: statesBefore
    };
  }

  const senderCandidates = statesBefore
    .filter((s) => s.activated && BigInt(s.balanceSun || "0") >= MIN_SENDER_BALANCE_SUN)
    .sort((a, b) => {
      if (b.freeBandwidth !== a.freeBandwidth) return b.freeBandwidth - a.freeBandwidth;
      const aBal = BigInt(a.balanceSun || "0");
      const bBal = BigInt(b.balanceSun || "0");
      if (bBal !== aBal) return bBal > aBal ? 1 : -1;
      return a.index - b.index;
    });
  const picked = senderCandidates[0];
  if (!picked) {
    steps.push({
      fromIndex: -1,
      from: "",
      toIndex: firstInactive.index,
      to: firstInactive.address,
      freeBandwidth: 0,
      balanceSun: "0",
      amountSun: MIN_ACTIVATE_SUN.toString(),
      status: "skipped",
      reason: "没有可用激活地址：需存在已激活且余额 >= 2 TRX 的地址"
    });
    return {
      initialized: false,
      activatedCountBefore: statesBefore.length,
      activatedCountAfter: statesBefore.length,
      shareSun: shareSun.toString(),
      steps,
      addressStates: statesBefore
    };
  }

  const fromWallet = wallets.find((w) => w.index === picked.index);
  if (!fromWallet) {
    throw new Error(`未找到发送方钱包(index=${picked.index})`);
  }

  if (onProgress) {
    onProgress({
      current: 1,
      total: 1,
      message: `${fromWallet.address} -> ${firstInactive.address}`
    });
  }

  const latestBalanceSun = await getBalanceSun(tronWeb, fromWallet.address);
  if (latestBalanceSun < MIN_SENDER_BALANCE_SUN) {
    steps.push({
      fromIndex: fromWallet.index,
      from: fromWallet.address,
      toIndex: firstInactive.index,
      to: firstInactive.address,
      freeBandwidth: picked.freeBandwidth,
      balanceSun: latestBalanceSun.toString(),
      amountSun: MIN_ACTIVATE_SUN.toString(),
      status: "skipped",
      reason: `发送方余额不足 2 TRX（balance=${latestBalanceSun.toString()} sun）`
    });
  } else {
    try {
      const txid = await transferTrx(
        tronWeb,
        fromWallet.address,
        firstInactive.address,
        fromWallet.privateKey,
        MIN_ACTIVATE_SUN
      );
      steps.push({
        fromIndex: fromWallet.index,
        from: fromWallet.address,
        toIndex: firstInactive.index,
        to: firstInactive.address,
        freeBandwidth: picked.freeBandwidth,
        balanceSun: latestBalanceSun.toString(),
        amountSun: MIN_ACTIVATE_SUN.toString(),
        status: "sent",
        txid
      });
    } catch (e: any) {
      if (isInsufficientBalanceError(e)) {
        try {
          const retryBalanceSun = await getBalanceSun(tronWeb, fromWallet.address);
          const retryAmountSun = MIN_ACTIVATE_SUN - TX_SAFETY_SUN;
          if (retryAmountSun > 0n && retryBalanceSun >= MIN_SENDER_BALANCE_SUN) {
            const retryTxid = await transferTrx(
              tronWeb,
              fromWallet.address,
              firstInactive.address,
              fromWallet.privateKey,
              retryAmountSun
            );
            steps.push({
              fromIndex: fromWallet.index,
              from: fromWallet.address,
              toIndex: firstInactive.index,
              to: firstInactive.address,
              freeBandwidth: picked.freeBandwidth,
              balanceSun: retryBalanceSun.toString(),
              amountSun: retryAmountSun.toString(),
              status: "sent",
              txid: retryTxid
            });
          } else {
            steps.push({
              fromIndex: fromWallet.index,
              from: fromWallet.address,
              toIndex: firstInactive.index,
              to: firstInactive.address,
              freeBandwidth: picked.freeBandwidth,
              balanceSun: retryBalanceSun.toString(),
              amountSun: MIN_ACTIVATE_SUN.toString(),
              status: "failed",
              reason: e?.message ?? String(e)
            });
          }
        } catch (retryErr: any) {
          steps.push({
            fromIndex: fromWallet.index,
            from: fromWallet.address,
            toIndex: firstInactive.index,
            to: firstInactive.address,
            freeBandwidth: picked.freeBandwidth,
            balanceSun: latestBalanceSun.toString(),
            amountSun: MIN_ACTIVATE_SUN.toString(),
            status: "failed",
            reason: retryErr?.message ?? e?.message ?? String(e)
          });
        }
      } else {
        steps.push({
          fromIndex: fromWallet.index,
          from: fromWallet.address,
          toIndex: firstInactive.index,
          to: firstInactive.address,
          freeBandwidth: picked.freeBandwidth,
          balanceSun: latestBalanceSun.toString(),
          amountSun: MIN_ACTIVATE_SUN.toString(),
          status: "failed",
          reason: e?.message ?? String(e)
        });
      }
    }
  }

  const afterScan = await scanActivatedPrefix(tronWeb, wallets);
  const addressStates = afterScan.activatedStates;
  const activatedAfter = addressStates.length;

  return {
    initialized: afterScan.firstInactive === null,
    activatedCountBefore: statesBefore.length,
    activatedCountAfter: activatedAfter,
    shareSun: shareSun.toString(),
    steps,
    addressStates
  };
}

export async function getFeeWalletStates(
  fullHost: string,
  tronApiKey: string | undefined,
  wallets: WalletItem[]
) {
  if (!fullHost) throw new Error("fullHost 为必填");
  if (!Array.isArray(wallets) || wallets.length === 0) throw new Error("钱包不能为空");
  const tronWeb = buildTronWeb(fullHost, tronApiKey);
  const { activatedStates, firstInactive } = await scanActivatedPrefix(tronWeb, wallets);
  const addressStates = activatedStates;
  const activatedCount = activatedStates.length;
  return {
    total: activatedStates.length + (firstInactive ? 1 : 0),
    activatedCount,
    inactiveCount: firstInactive ? 1 : 0,
    addressStates
  };
}

export async function activateAddressesWithFeeWallets(
  fullHost: string,
  tronApiKey: string | undefined,
  feeWallets: WalletItem[],
  targetAddresses: string[],
  onProgress?: (p: { current: number; total: number; message?: string }) => void
) {
  if (!fullHost) throw new Error("fullHost 为必填");
  if (!Array.isArray(feeWallets) || feeWallets.length === 0) throw new Error("手续费钱包不能为空");
  if (!Array.isArray(targetAddresses) || targetAddresses.length === 0) throw new Error("目标地址不能为空");
  const tronWeb = buildTronWeb(fullHost, tronApiKey);

  const normalizedTargets = Array.from(
    new Set(
      targetAddresses
        .map((v) => String(v || "").trim())
        .filter(Boolean)
    )
  );

  const steps: Array<{
    address: string;
    fromIndex?: number;
    fromAddress?: string;
    status: "activated" | "already_active" | "waiting" | "failed";
    reason?: string;
    txid?: string;
  }> = [];
  const prefixScan = await scanActivatedPrefix(tronWeb, feeWallets);
  const senderWallets = prefixScan.activatedStates
    .map((s) => ({
      state: s,
      wallet: feeWallets.find((w) => w.index === s.index)
    }))
    .filter((v): v is { state: AddressState; wallet: WalletItem } => Boolean(v.wallet))
    .sort((a, b) => a.state.index - b.state.index);
  let senderCursor = 0;

  for (let i = 0; i < normalizedTargets.length; i += 1) {
    const address = normalizedTargets[i];
    if (onProgress) onProgress({ current: i + 1, total: normalizedTargets.length, message: address });

    const alreadyActive = await isActivated(tronWeb, address);
    if (alreadyActive) {
      steps.push({ address, status: "already_active" });
      continue;
    }
    if (senderWallets.length === 0) {
      steps.push({
        address,
        status: "waiting",
        reason: "没有已激活且可用的手续费钱包，请先完成手续费钱包初始化"
      });
      continue;
    }

    let activated = false;
    let waitingReason = "所有手续费钱包免费带宽或余额不足，请等待带宽恢复后重试";
    let lastFailed: { fromIndex: number; fromAddress: string; reason: string } | null = null;
    for (let tryCount = 0; tryCount < senderWallets.length; tryCount += 1) {
      const pos = (senderCursor + tryCount) % senderWallets.length;
      const candidate = senderWallets[pos];
      const [balanceSun, freeBandwidth] = await Promise.all([
        getBalanceSun(tronWeb, candidate.wallet.address),
        getFreeBandwidth(tronWeb, candidate.wallet.address)
      ]);
      if (freeBandwidth < MIN_FREE_BANDWIDTH) {
        waitingReason = `手续费钱包 index=${candidate.wallet.index} 免费带宽不足`;
        continue;
      }
      if (balanceSun < TARGET_ACTIVATE_SUN) {
        waitingReason = `手续费钱包 index=${candidate.wallet.index} 余额不足`;
        continue;
      }

      try {
        const txid = await transferTrx(
          tronWeb,
          candidate.wallet.address,
          address,
          candidate.wallet.privateKey,
          TARGET_ACTIVATE_SUN
        );
        steps.push({
          address,
          fromIndex: candidate.wallet.index,
          fromAddress: candidate.wallet.address,
          status: "activated",
          txid
        });
        senderCursor = (pos + 1) % senderWallets.length;
        activated = true;
        break;
      } catch (e: any) {
        const reason = e?.message ?? String(e);
        lastFailed = {
          fromIndex: candidate.wallet.index,
          fromAddress: candidate.wallet.address,
          reason
        };
        waitingReason = reason;
      }
    }
    if (!activated) {
      if (lastFailed) {
        steps.push({
          address,
          fromIndex: lastFailed.fromIndex,
          fromAddress: lastFailed.fromAddress,
          status: "failed",
          reason: lastFailed.reason
        });
      } else {
        steps.push({
          address,
          status: "waiting",
          reason: waitingReason
        });
      }
    }
  }

  const finalStates = (await scanActivatedPrefix(tronWeb, feeWallets)).activatedStates;
  return {
    total: normalizedTargets.length,
    activated: steps.filter((s) => s.status === "activated").length,
    alreadyActive: steps.filter((s) => s.status === "already_active").length,
    waiting: steps.filter((s) => s.status === "waiting").length,
    failed: steps.filter((s) => s.status === "failed").length,
    steps,
    feeWalletStates: finalStates
  };
}
