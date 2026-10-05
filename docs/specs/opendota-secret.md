# OpenDota Secret 配置

- 状态：已实现本地配置与读取；OpenDota API 接入待实现。
- 日期：2026-10-06

## 输入与读取

- 变量名为 `OPENDOTA_API_KEY`，可选，不影响现有 Catalog 功能启动。
- 本地输入位置为项目根目录的 `.env`；该文件由 `.gitignore` 排除，权限应为 `0600`。这是本地明文 Secret 文件，不是加密凭据库。
- `.env.example` 仅保留空值占位。首次复制模板后执行 `chmod 600 .env`，再使用编辑器填写。
- Node.js 服务端和 Worker 使用 `src/config/env.ts` 的 `getOpenDotaApiKey()`；沿用现有 `loadLocalEnv()`，不需要数据库或 provision receipt。
- 已设置的进程环境变量优先于 `.env`，包括显式空字符串；读取时去除首尾空白，空值和缺失值返回 `null`。
- 本地配置按进程加载一次；修改后重启相应进程。为保持 Web 与 Worker 一致，本功能的本地配置统一写入 `.env`。

## Secret 边界

- 仅允许 Node.js 端消费；不使用 `NEXT_PUBLIC_` 前缀，也不放入 Next.js 的 `env` 导出、客户端 props、HTTP 响应或日志。
- 不把 Key 保存到数据库、导入 provenance、测试产物或提交记录。
- 自动化验证仅使用合成值，不调用 OpenDota，也不验证真实 Key 的有效性。
- 保存配置不会产生网络请求、解析任务或费用；实际 API 消费需要后续实现。

## 验证

- `git check-ignore .env` 确认本地 Secret 文件被忽略。
- `stat -f '%Lp' .env`（macOS）应返回 `600`。
- `pnpm typecheck` 检查读取接口的类型兼容性。
