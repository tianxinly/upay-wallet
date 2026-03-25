# Tron Wallet Suite（桌面端）

企业级 TRC20 USDT 离线签名与广播工具，面向 Windows 与 macOS。

## 功能概览

1. 离线签名（面向普通用户）  
用户仅需提供：  
- 地址+金额 CSV  
- 地址+私钥 CSV  
- 归集目标地址  
 
系统自动使用配置文件中的默认网络与 USDT 合约地址，输出 `signed_txs.json`。  
离线签名不联网，私钥不离开本机。  

2. 广播上链  
直接使用 `signed_txs.json` 作为输入，广播并输出结果文件。  

3. 扫描统计（USDT 默认合约）  
输入地址列表 CSV 与阈值，输出：  
- 总金额  
- 超过阈值的地址数量  
- 超过阈值的金额总和  
## 快速开始

1. 安装依赖  
```bash
npm install
```

2. 本地开发  
```bash
npm run dev
```

3. 构建前端与主进程  
```bash
npm run build
```

4. 打包  
```bash
npm run dist:win
npm run dist:mac
```

## 重要说明

1. macOS 安装包建议在 macOS 上构建。Windows 上打包 macOS 通常会失败或产物不可用。  
2. 离线签名必须提供 `ref_block_bytes`、`ref_block_hash`、`timestamp`、`expiration`、`fee_limit`、`decimals`。  
3. 广播属于在线操作，请确保节点可信。  
4. Windows 打包若提示无法创建符号链接，请开启“开发者模式”或以管理员权限执行打包。  

## 设置（已迁移到界面）

配置已迁移到应用内“设置”页面，默认值与之前文件配置一致，并会保存在本机。
需要维护的字段：
- `full_host`：广播节点地址  
- `usdt_contract`：USDT 合约地址  
- `tron_api_key`：TronGrid API Key（使用公共节点时建议填写，私有节点可留空）

注意：
区块引用字段不再写入配置，改为在离线签名界面点击“获取最新区块引用”。

## TRON 节点配置（测试网/主网）

测试网（Nile）：
- `full_host`: `https://nile.trongrid.io`
- `usdt_contract`: `TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf`
- `tron_api_key`: 可选（使用 TronGrid 公共节点建议填写）

主网（Mainnet）：
- `full_host`: `https://api.trongrid.io`
- `usdt_contract`: `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`
- `tron_api_key`: 可选（使用 TronGrid 公共节点建议填写）

## 区块引用更新（在线）

请在“区块引用”页点击“获取最新区块引用”，该页面允许联网。  
“离线签名”页不联网，仅用于粘贴与签名。

## 目录结构

1. `app/main/`  
Electron 主进程与安全 IPC。  
2. `app/core/`  
离线签名与广播的核心逻辑。  
3. `app/renderer/`  
前端界面（Vite + React）。  
4. `electron-dist/`  
主进程编译产物。  
