# VS Code / GitHub Copilot向け配布

2026-09-24。ユーザーの依頼に基づき、既存配布物を活用してGitHub Copilot in VS Codeを配布先へ追加する。

## 採用する構成

Copilot専用の第三の配布物・カタログを作る案と、VS Codeが対応するClaude形式を共用する案を比較し、後者を採用する。現在の配布物は共通の9スキルとCLIが中心で、製品専用agents・hooksはない。共用により同じスキル・版数・導入経路を維持できる。製品固有の機能を追加するときは互換性を個別に確認する。

- `.claude-plugin/marketplace.json`と`dist/claude-code/agent-gear/`をClaude Code・Copilotで共用する。Codexの配布経路は維持する。
- Copilot固有の指示テンプレートの正本は`packaging/copilot/templates/copilot-instructions.md`。共用配布物へ同梱する。
- 従来の`setup-manifest.json`は既定の製品のまま維持し、共用配布物へ`setup-manifest.copilot.json`を追加する。
- setupの`--product copilot`でCopilot用manifestを選択する。未同梱の製品は拒否し、別製品のmanifestへフォールバックしない。製品・プラグイン・版数の一致も確認する。
- Copilotの指示は`.github/copilot-instructions.md`の管理ブロック、状態は`.space/setup/agent-gear-copilot.json`。vendorと排他ロックは既存製品と共有する。
- 配布物の更新を検出できるよう、ルート版数を0.1.1へ上げて再生成する。

変更対象はbuild、setup、Copilot用テンプレート、関連テスト、導入資料・設計、生成物。実装はこのタスク内で行う。利用者の既存VS Code設定や実プロジェクトへ自動導入する処理は追加しない。

## 検証方針

Copilot選択・既定動作維持・未対応製品拒否・manifest不一致拒否・指示の既存内容保持・繰り返し適用・ローカル編集保護・製品間vendor更新を確認する。共用配布物をリポジトリ外へ配置し、Copilot指定のsetup、OKF、orchを実行する。型検査・既存テスト・生成物照合を実施し、VS Codeでのプラグインとスキルの認識を別途確認する。認証が必要なモデル応答と静的な認識確認は区別する。

## 根拠

2026-09-24に確認した公式資料：

- [VS Code Agent plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins)：Claude形式、Git marketplace、`chat.pluginLocations`によるローカル登録。
- [VS Code Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills)：SKILL.mdと同梱スクリプト・資料。
- [VS Code custom instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions)：Copilotの`.github/copilot-instructions.md`。

## 確認結果

環境はmacOS arm64、Bun 1.4.2、TypeScript 7.0.2、VS Code 1.139.0（2242ebbb54efeeb0129e08e919e7e8d43033cd83）、同梱GitHub Copilot 0.67.0。

| 確認 | 結果 |
| --- | --- |
| 新規挙動の回帰テスト | 変更前はCopilot用manifest生成・製品指定等で4失敗、実装後に成功 |
| `bun run test` | 160成功、2スキップ、0失敗。162件・15ファイル・899 assertions |
| `bun run typecheck` | 成功 |
| `bun run build` / `bun run build:check` | カタログを含む238ファイルを生成し、正本と一致 |
| リポジトリ外の配布物 | Codex・Claude Code・Copilotの各setup、OKF検索・独自知識作成、orch初期化を実CLIで確認 |
| Copilot用setup | 指示の既存内容保持、再実行、更新、製品別状態、共有vendor更新、管理ブロックの編集保護を確認 |
| 製品指定の不正入力 | 未同梱・未知の製品、manifestのプラグイン・製品・版数不一致、他製品への配置を拒否 |
| VS Codeでの認識 | 一時プロファイルの`chat.pluginLocations`にリポジトリ外のコピーを登録。カスタマイズ画面のInstalledに`agent-gear`、`9 skills`、有効と表示。スキル画面にもプラグイン由来の9件を確認 |

VS Codeの確認は空の一時プロファイルのローカルカスタマイズ画面で実施した。既存プロファイルへの永続的な導入は行っていない。Copilotにサインインしてモデルへ依頼する試験、Copilot Agent Hostセッションでの実行、Git marketplaceからの取得・更新、Windows・WSL・コンテナ・SSHでの実行は未確認。二つのスキップは既存の上流Go実装との比較で、参照バイナリ未指定によるもの。

最終確認でCopilotテンプレートにも既存のsymlink拒否を適用し、配布テスト6件・117 assertions、型検査、生成物照合、`git diff --check`を再実行して成功した。上記はローカル実装時の確認結果であり、公開後のリモートCIの結果はGitHub Actionsで確認する。
