# 導入・更新と配布物の生成

agent-gearはCodex・Claude Code用のプラグインとして導入する。CLIの実行にはBun 1.4.2以上が必要。プラグインのインストールと、プロジェクトへの共通知識・指示の配置は別の操作である。

## ローカルのプラグインを導入する

先にこのリポジトリで`bun run build`を実行し、カタログと配布物を揃える。以下の`/path/to/agent-gear`はチェックアウトしたリポジトリの絶対パスへ置き換える。

```sh
codex plugin marketplace add /path/to/agent-gear
codex plugin add agent-gear@agent-gear
```

```sh
claude plugin marketplace add /path/to/agent-gear --scope user
claude plugin install agent-gear@agent-gear --scope user
```

新しいタスク・セッションで導入したスキルを利用する。既に開いている会話のスキル一覧が自動で更新されたとは扱わない。共有・公開するときは、ソース・dist・カタログを同じ変更でmainへ反映してから、利用者にリポジトリを登録してもらう。ローカルで生成しただけでは公開されない。

## プロジェクトへ配置する

導入済みの`setup`スキルに対象プロジェクトを指定する。実際のプラグインの位置を基準に、次のCLIを実行する。

```sh
bun /path/to/installed/plugin/skills/setup/scripts/setup.ts plan --project /path/to/project --json
bun /path/to/installed/plugin/skills/setup/scripts/setup.ts apply --project /path/to/project --json
```

共通知識は`.space/babel/vendor/agent-gear/`へ、指示はCodexならAGENTS.md、Claude CodeならCLAUDE.mdの管理ブロックへ入る。既存の指示や独自知識は保持する。プラグインを更新した後もplan・applyで利用先への変更を反映する。衝突・中断時の扱いは[setupの資料](../skills/setup/references/setup.md)を参照する。

OKF・orchはそれぞれ`skills/okf-agent-memory/scripts/okf.ts`、`skills/orch/scripts/task.ts`をBunで実行する。初回の依存準備はスキル自身のscripts内で行うため、書き込み権限が必要。OKFの初回はネットワークまたはBunキャッシュも必要になる。利用先のworkspaceに含まれる場所ではOKFの依存準備を拒否するため、通常のプラグインキャッシュ等、workspace外の配置を使う。

## 開発時の生成と検証

```sh
bun install --frozen-lockfile --ignore-scripts
bun skills/okf-agent-memory/scripts/okf.ts version --json
bun run typecheck
bun run test
bun run build
bun run build:check
```

root package.jsonのversionが両製品の配布版数を決める。正本はskills・space・packaging。distとカタログは生成結果としてGit管理し、手編集しない。buildは配布対象だけを選び、docs・テスト・利用先の.space・node_modulesを含めない。Markdownの参照先を確認してから出力する。

build:checkはソースから期待する全ファイルを組み立て、内容の変更だけでなく、未追跡の追加ファイル・不足ファイルも検出する。CIでも同じ検査を行う。生成途中に異常終了した場合は、書き手の停止を確認してから`.build.lock`と一時領域を調べ、正本から再生成する。

以前のtemplates/AGENTS.mdは配布元として使わない。製品別の指示テンプレートはpackaging配下で更新する。リポジトリの.codex/agentsは開発用であり、そのまま配布物へコピーしない。
