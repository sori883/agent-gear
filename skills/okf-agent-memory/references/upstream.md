# 参照元と適用範囲

確認日：2026-09-20

このスキルは [okf-memory/okf-agent-memoryのSKILL.md](https://github.com/okf-memory/okf-agent-memory/blob/main/.agents/skills/okf-memory/SKILL.md) と補助資料を基に、日本語で記述したもの。行動契約、専用ツールでの検索と保存、知識の見直し、検証を完了条件とする運用を引き継ぐ。

参照コミットは `9413d7780714165dcb8e82fff73b9f966feb653a`。確認時点の `main` と `develop` はこのコミットを指していた。保守時はブランチ名だけでなく、以下の固定リンクと比較する。

| 参照ファイル | 取り入れた内容 |
| --- | --- |
| [SKILL.md](https://github.com/okf-memory/okf-agent-memory/blob/9413d7780714165dcb8e82fff73b9f966feb653a/.agents/skills/okf-memory/SKILL.md) | 事実整合性・ドメイン中立性・決定性、Mermaid限定、検索してから行動する、governanceを確認する、人間の検証を捏造しない |
| [discovery.md](https://github.com/okf-memory/okf-agent-memory/blob/9413d7780714165dcb8e82fff73b9f966feb653a/.agents/skills/okf-memory/discovery.md) | 説明から候補を絞り、必要な本文・関連文書だけ読む |
| [remember.md](https://github.com/okf-memory/okf-agent-memory/blob/9413d7780714165dcb8e82fff73b9f966feb653a/.agents/skills/okf-memory/remember.md) | 将来の価値で記録を選び、根拠と不確実性を保持する |
| [update.md](https://github.com/okf-memory/okf-agent-memory/blob/9413d7780714165dcb8e82fff73b9f966feb653a/.agents/skills/okf-memory/update.md) | 重複作成より更新を優先し、訂正と有用な経緯を残す |
| [relationships.md](https://github.com/okf-memory/okf-agent-memory/blob/9413d7780714165dcb8e82fff73b9f966feb653a/.agents/skills/okf-memory/relationships.md) | 意味のある単位を保ち、説明付きのリンクで関連付ける |
| [examples.md](https://github.com/okf-memory/okf-agent-memory/blob/9413d7780714165dcb8e82fff73b9f966feb653a/.agents/skills/okf-memory/examples.md) | 検索から保存・関連付け・検証までの一連の操作 |
| [Convention v0.1](https://github.com/okf-memory/okf-agent-memory/blob/9413d7780714165dcb8e82fff73b9f966feb653a/docs/spec/CONVENTION.md) | 知識のライフサイクルと、判断を担うエージェント・形式処理を担うツールの責務 |
| [CLI実装](https://github.com/okf-memory/okf-agent-memory/blob/9413d7780714165dcb8e82fff73b9f966feb653a/cmd/okf/main.go) | `search` / `show` / `create` / `update` / `relate` / `validate` の呼び出し形式 |

## このプロジェクトに合わせた点

- Goの `okf` コマンドを、スキルに同梱する `scripts/okf.ts` のBun実行に置き換える。ユーザーの指定によりCLIのみを使用し、元スキルのMCP優先は採用しない。MCPサーバーは実装・提供の対象に含めない。
- 保存先を `knowledge/` から `.space/babel/` に変更し、合意済みの5種類のtypeとディレクトリを使う。
- frontmatterは、プロジェクトで決めた `type`・`title`・`description` 必須、3種類のstatus、タイムゾーン付き日時、マッピング配列のsourcesに揃える。元の補助資料にある `status: active` や文字列配列のsourcesなどをそのまま移さない。
- AAGの省略記法を日本語の文章に置き換える。事実整合性・ドメイン中立性・厳密な決定性の目標と、図をMermaidに限定する規則はスキル本体に保持する。
- 元スキルと同様に専用ツールで読み書きする。CLIが失敗した場合に、直接編集や手動確認を成功の代替にしない。
- `hold` は対象操作に適用する。ユーザーが当該保留を踏まえて既に承認した操作について、同じ確認を繰り返さない。
- frontmatterの詳細を参照資料へ分離し、作業別資料は元の検索・保存判断・更新・関連付け・操作例の役割に対応させる。
- `validate --strict --drift` のエラー・警告0件を完了条件として維持する。人間による内容確認とは区別し、通過のために `verified` を捏造しない。

このスキルはBun CLIの利用契約を記述する。CLI実装の互換性は、別途、引数・出力・検索・保存・検証の挙動を元実装のテストと照合して確認する。

原著の著作権・利用条件は同梱の [LICENSE](../LICENSE) に保持している。
