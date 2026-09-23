# OKF CLIの実行依存の移行

2026-09-23。ユーザーの残作業実施の承認に基づき、[配布設計](../../architecture.md)で定めたスキル単位の依存配置へ移行した。操作契約、検索方式、OKF文書の形式は変更していない。

## 完成した構成

`skills/okf-agent-memory/scripts/`にpackage.json・bun.lock・bootstrap.ts・okf.ts・libを置いた。MiniSearchは従来と同じ7.2.0で固定した。旧スキル直下のpackage.jsonを削除し、ルートworkspaceから独立させた。ルートpackage.jsonとbun.lockの整理は配布全体の担当が行った。

入口のokf.tsは外部依存のないbootstrapだけを読み、準備後にlib/cli.tsを動的に読み込む。exportしたmainとCLI引数・JSONエラー・終了コードは維持した。bootstrapはpackage.json、bun.lock、Bunの版のハッシュと、直接依存の存在を照合する。初回、依存定義・ロック・Bunの版の変更、直接依存が失われた場合はscriptsで固定導入し、成功後にマーカーを原子的に置いて再起動する。

導入コマンドは`bun install --frozen-lockfile --ignore-scripts`。本体のcwdは利用先に維持し、依存導入のcwdだけをscriptsへ固定する。標準出力を捕捉してCLIのJSONに混在させない。導入が失敗した場合にbundleを作成しない。起動競合は最大約5秒待ってから明示的な失敗とし、異常終了で残ったロックを自動で奪わない。

## 試験で分かった境界と修正

最初の5件のbootstrapテストは0成功・5失敗だった。配布コピーに必要な依存がなく、入口の静的importが起動前に失敗することを確認した。新しい起動構造へ移すと、同時初回起動だけで待機側のimportが失敗した。Bunがプロセス開始時点の依存解決状態を保持するため、他プロセスの導入完了を待った側も再起動する必要がある。待機後に準備済みを確認した二つの分岐も再起動へ変更し、5件すべて成功した。同じ構造を持つorchの担当へ再現内容を引き渡した。

利用先のworkspacesにscriptsが含まれる場合、Bun 1.4.2の固定installは利用先のnode_modules/.bunへ依存実体を作った。hoisted指定では利用先node_modulesへ配置され、scriptsのworkspacesを空にしても分離できなかった。設計方針を維持するため、祖先のworkspaceパターンに含まれる配置では、導入前に失敗してworkspace外へ配置するよう案内する。実行時に利用先の設定を自動変更する方式は採用しなかった。この条件のテストを先に失敗させ、利用先を変更せず拒否することを確認した。

## 検証結果

環境はmacOS arm64、Bun 1.4.2、TypeScript 7.0.2。2026-09-23に実施した。

| 確認 | 実施結果 |
| --- | --- |
| `bun test skills/okf-agent-memory/tests` | 102成功、2スキップ、0失敗。104件、575アサーション |
| `bun run typecheck` | 成功 |
| `git diff --check` | 成功 |
| SKILL.md・referencesの相対Markdownリンク | 切れたローカル参照0件 |
| 独立コピーの初回起動 | node_modulesを除いてscriptsを一時領域へコピー。自動導入後に実CLIのinit・create・日本語searchが成功 |
| 2回目の起動 | 同じ準備マーカーの更新時刻を保持。利用先package.jsonを保持し、利用先bun.lock・node_modulesを生成しない |
| lock変更 | コピーのbun.lockを変更し、依存を取り除いた後に実CLIを再起動。依存を再導入し、マーカー更新を確認 |
| 同時起動 | 二つの実CLIの初回起動がともに成功。ロックを残さない |
| 導入失敗 | lock欠損・破損・依存定義との不一致でJSONエラー。bundleと成功マーカーを作成しない |
| 再導入 | マーカーを残してMiniSearchを削除すると自動修復。packageのpreinstall/postinstallを実行しない |
| 異常ロック | 失敗を返し、元ロックを保持。bundleを作成しない |
| workspace境界 | パターンに含まれる配置では導入前に拒否。利用先package・lock・node_modulesを変更しない |
| 導入済みコピー | 配布元の外でinit・create・search・delete・validateが成功。無効なregistryと空のcacheを指定したversionも成功 |

スキップした2件は従来からの固定Go実行ファイルとの比較で、`OKF_REFERENCE_BIN`が未指定のため実施していない。Goとの互換性を今回再確認したとは扱わない。既存のCLI・検索・書き込み・検証の回帰テストは成功した。

CIや新しいチェックアウトでlibを直接importするテスト・型検査を実行するときは、先に`bun skills/okf-agent-memory/scripts/okf.ts version --json`で実行依存を用意する。ルートのinstallを実行時依存の導入手段へ戻さない。

## 残る制約

依存の取得にはネットワークかBunのキャッシュが必要で、scriptsは書き込み可能でなければならない。OS横断、電源断、長期間の運用は今回未確認である。workspaceに含まれる配置はサポートせず、利用先を変更しないために拒否する。祖先package.jsonの構文が不正な場合も導入前にエラーとする。

この作業はorchの実運用試験の子unit `okf-runtime`として開始・工程更新・検証記録・提出を実CLIで行い、親の受け入れ対象とした。進行状態の正本は親タスクのorch台帳にあり、この文書は移行結果と検証根拠を説明する。
