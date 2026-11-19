## 变更说明 / Summary

简要说明本次 PR 解决的问题或新增的能力。

## 自检清单 / Checklist

- [ ] `npm run lint` 与 `npm run typecheck` 零报错通过
- [ ] `npm run build` 构建通过，且 `dist/client.js` 保持在冷启动首屏体积预算（`< 50 KiB`）内
- [ ] `npm test` 与 `npm run quality` 全部通过（含覆盖率、`CRAP <= 30` 与分包预算）
- [ ] `npm run licenses:check` 通过（调整运行时依赖后已执行 `npm run licenses` 并提交 `THIRD_PARTY_LICENSES.txt`）
- [ ] 遵循本地优先与隐私边界原则，仅使用 DeepSeek Harness 官方公开扩展接口
- [ ] 若涉及用户可见的主题、数据格式或命令变更，已同步更新 `README.md`、`README.en.md` 与 `CHANGELOG.md`
