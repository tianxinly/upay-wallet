import React from "react";
import { HdWallet } from "../../shared/types/app";

type FeeWalletTabProps = {
  wallets: HdWallet[];
  selectedWalletId: string;
  setSelectedWalletId: (id: string) => void;
  shortXpub: (value: string) => string;
  setActiveTabWallet: () => void;
  feePassword: string;
  setFeePassword: (value: string) => void;
  handleRefreshFeePreview: () => void;
  handleGetFeeWalletStates: () => void;
  feePreviewLoading: boolean;
  fullHost: string;
  feeAddressPreview: string[];
  showInitializeButton: boolean;
  handleInitializeFeeWallet: () => void;
  activateAddressInput: string;
  setActivateAddressInput: (value: string) => void;
  handleActivateAddresses: () => void;
  feeLoading: boolean;
  feeResult: string;
};

export default function FeeWalletTab(props: FeeWalletTabProps) {
  const {
    wallets,
    selectedWalletId,
    setSelectedWalletId,
    shortXpub,
    setActiveTabWallet,
    feePassword,
    setFeePassword,
    handleRefreshFeePreview,
    handleGetFeeWalletStates,
    feePreviewLoading,
    fullHost,
    feeAddressPreview,
    showInitializeButton,
    handleInitializeFeeWallet,
    activateAddressInput,
    setActivateAddressInput,
    handleActivateAddresses,
    feeLoading,
    feeResult
  } = props;

  return (
    <section className="panel">
      <h2>手续费钱包（TRX）</h2>
      <div className="hint">初始化会自动扫描地址并激活“首个未激活地址”（单次 1 TRX）。激活业务地址时仅使用免费带宽，带宽不足会自动提示等待。</div>
      <div className="grid">
        <label>
          选择 HD 钱包
          {wallets.length === 0 ? (
            <div className="empty-inline">
              <span>未创建 HD 钱包</span>
              <button onClick={setActiveTabWallet}>去钱包管理</button>
            </div>
          ) : (
            <div className="select-row">
              <select value={selectedWalletId} onChange={(e) => setSelectedWalletId(e.target.value)}>
                {wallets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {shortXpub(item.xpub)}
                  </option>
                ))}
              </select>
              <button onClick={setActiveTabWallet}>管理</button>
            </div>
          )}
        </label>
        <label>
          HD 钱包解密密码
          <input type="password" value={feePassword} onChange={(e) => setFeePassword(e.target.value)} />
        </label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={handleRefreshFeePreview} disabled={feePreviewLoading}>
          {feePreviewLoading ? "加载地址中..." : "刷新地址预览(0~19)"}
        </button>
        <button onClick={handleGetFeeWalletStates} disabled={feeLoading}>
          {feeLoading ? "查询中..." : "获取已激活地址状态"}
        </button>
      </div>
      <div className="hint">使用前请先向 index=0 地址打入 TRX。当前节点：{fullHost || "(未配置)"}</div>
      <div className="split" style={{ marginTop: 10 }}>
        <div>
          <h3>地址预览（0~19）</h3>
          <textarea
            value={feeAddressPreview.map((addr, idx) => `${idx},${addr}`).join("\n")}
            readOnly
            rows={10}
            placeholder="点击“刷新地址预览(0~19)”查看"
          />
          {showInitializeButton && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary" onClick={handleInitializeFeeWallet} disabled={feeLoading}>
                {feeLoading ? "初始化中..." : "初始化（激活下一个地址）"}
              </button>
            </div>
          )}
          {!showInitializeButton && <div className="hint">初始化已完成。</div>}
        </div>
        <div>
          <h3>输入待激活地址列表</h3>
          <textarea
            value={activateAddressInput}
            onChange={(e) => setActivateAddressInput(e.target.value)}
            rows={10}
            placeholder={"每行一个地址\nT...\nT..."}
          />
          <button className="primary" onClick={handleActivateAddresses} disabled={feeLoading}>
            {feeLoading ? "激活中..." : "激活输入地址"}
          </button>
        </div>
      </div>
      {feeResult && <pre className="result">{feeResult}</pre>}
    </section>
  );
}
