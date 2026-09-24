# setupの設計と実装記録

この文書は初期実装の記録である。共通知識の配置先と共有目次の管理方式は、[Babel統合の記録](../../babel-distribution.md)で更新した。

2026-09-23。親の[配布設計](../../distribution-design.md)に従い、`skills/setup/`を実装する。開発対象としてorchのproject-setup unitを実際に開始し、担当自身が節目・検証・提出を記録する。

## 採用した構造

配布ルートのsetup-manifest.jsonを入力とし、BunのTypeScript CLIでplan・apply・statusを提供する。外部依存なし。manifestのsourceは配布ルート、destinationは明示した利用先を基準にする。利用先の依存定義を変更しない。

全ファイル置換と管理対象単位の更新を比較し、後者を採用した。共通知識・Codex agentは内容ハッシュを保存し、指示ファイルは管理ブロックだけのハッシュを保存する。これにより利用先の独自文書と指示ブロック外の編集を保持する。

複数ファイルの完全な原子的置換は提供しない。全件の事前衝突検査とplugin単位の排他を行い、pending journalに適用前の全体ハッシュと予定内容を残してから各ファイルを置換する。中断時に各対象が適用前または適用後に一致することを確認して続行する。ファイル群を書き換えるだけで復旧情報を持たない案は、途中失敗を次回のローカル衝突と区別できないため採用しなかった。

状態・pendingは製品別、lockはplugin単位。Codex・Claude Codeが同じvendorへ同時に書き込むことを排他する。管理方式が同じで現在の管理部分が今回同梱する内容と完全一致する場合は、前回のハッシュと異なっていてもその内容を新版として採用する。これにより同じ新版を順番に導入する両製品が収束する。いずれとも異なるローカル編集は衝突として保護する。

## 実装範囲

- `SKILL.md`・`references/setup.md`: 利用者向けの導入、更新、結果、復旧手順。
- `scripts/setup.ts`・`bootstrap.ts`・`package.json`: 専用起動、zero-dependency確認、scripts内の状態保存。
- `scripts/cli.ts`: 必須project・コマンド・JSON・終了コード。
- `scripts/lib/`: manifest/state/journal検証、symlink・パス境界、比較・排他・適用。
- `tests/setup.test.ts`: コピーしたCLIを含む挙動の確認。

## 検証記録

初期の5ケースは未実装のrunSetupに対し0成功・5失敗を確認し、実装後に5成功となった。追加で境界、既存ファイル保護、両製品、実CLI、実プロセス中断と再開を確認した。

実行環境はmacOS、Bun 1.4.2。以下を実行した。

| 確認 | 結果 |
| --- | --- |
| `bun test skills/setup/tests` | 初回提出14成功、0失敗、59 assertions。再提出結果は下記 |
| `bun run typecheck` | 成功 |
| system skill-creatorの`quick_validate.py skills/setup` | Skill is valid |

CLIを配布ルート相当の一時ディレクトリへコピーし、別のcwdから起動して、manifestの自己位置解決・必須project・bootstrap・利用先package.jsonの不変を確認した。

中断試験では実CLIの最初の配置完了を監視してSIGKILLし、pendingと旧stateが残ることを確認した。停止したプロセスのlockだけを除き、適用済みファイルに追加編集がある間は全体が停止すること、元へ戻した後は残りの39ファイルまでapplyで完了することを確認した。正常系を模擬しただけではない。

実行出力はタスク領域の`.space/tasks/project-setup/tests.txt`と`typecheck.txt`に保存した。配布物にはこの実装記録・テスト・実行出力を含めない。

統合レビューで、両製品の管理記録が同じ新版へ収束できない点を修正した。orchの初回提出を親がreturnし、担当がreopenして試行2を開始した。両製品を同じprojectへ導入→Codex側でvendor更新→Claude側を同じ新版へ更新するテストを追加し、変更前にCONFLICTで失敗することを確認した。判定を最小限変更し、異なるローカル編集が両製品から保護されることも同じケースで確認する。旧確認記録は再利用しない。

試行2の`bun test skills/setup/tests`は15成功・0失敗・68 assertions、`bun run typecheck`も成功した。RED出力は`convergence-red.txt`、最終出力は`tests-attempt-2.txt`と`typecheck-attempt-2.txt`を同じタスク領域へ保存した。

## 制約

ローカルホストの通常ファイルを対象とする。ネットワーク共有・電源断・悪意ある並行symlink変更・長期間の更新運用は検証していない。プロジェクトの全変更をロールバックする機能や、配置元から消えたファイルの自動削除は提供しない。衝突時の意味上の統合と、異常終了時の書き手停止確認は呼び出し担当が行う。
