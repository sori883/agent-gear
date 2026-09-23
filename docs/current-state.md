# agent-gearの現状

agent-gearは、開発作業のフロー、タスク台帳、知識管理、プロジェクトへの導入をCodexとClaude Codeへ配布するプラグインである。目的と配置方針の正本は[architecture.md](architecture.md)、導入・生成方法は[distribution.md](distribution.md)に置く。

2026-09-23時点の作業ツリーを対象とする。以下はローカル実装の状態であり、mainへの公開やリモートCIの成功を意味しない。詳細な検証結果は[配布の実装記録](distribution-implementation.md)を参照する。

## 提供するもの

| 構成物 | 役割・入口 |
| --- | --- |
| devlow | [全体フロー](../skills/devlow/references/workflow.md)。依頼整理・調査・設計・計画・実装・検証・レビュー・引き渡しを規模と依頼種別から選ぶ |
| orch | [スキル](../skills/orch/SKILL.md)と専用CLI。unitの進行、確認結果、親の受け入れを分離して管理する |
| okf-agent-memory | [スキル](../skills/okf-agent-memory/SKILL.md)と専用CLI。Markdownの知識を検索・保存・更新・関連付け・検証する |
| setup | [スキル](../skills/setup/SKILL.md)と専用CLI。同梱文書と指示を既存のプロジェクトへ導入・更新する |
| system-blueprint / how / why | システムの構成文書、動作の調査、設計理由の調査を担当する |
| use-principles / checkpoint-safely | 原則の選択・適用と、中断・引き継ぎの保存を担当する |
| 共通知識 | [space/babel](../space/babel/index.md)の23原則。実体は利用先のvendor bundleへ配置する |

計9スキルを両製品へ同梱する。リポジトリの`.agents/skills/`と`.codex/agents/`は開発環境用であり、製品のエージェント定義として配布しない。現在は製品専用エージェント定義やhooksを追加していない。

## 正本と実行場所

| 場所 | 内容 |
| --- | --- |
| `skills/` | 配布するスキル・参照資料・CLIの正本。testsは開発用 |
| `space/babel/` | 共通知識の配布用正本 |
| `packaging/codex/`・`packaging/claude-code/` | 製品別manifest・指示テンプレート |
| `dist/` | buildで生成しGit管理する配布物。テスト・docs・node_modulesを含めない |
| `.agents/plugins/marketplace.json`・`.claude-plugin/marketplace.json` | それぞれのdistを参照する生成済みカタログ |
| `docs/` | 開発者向けの設計・検証記録。配布しない |

三つのCLIはそれぞれの`skills/<skill>/scripts/`で起動する。OKFのMiniSearch 7.2.0は同じscripts内のpackage.json・bun.lockで固定し、bootstrapが必要時に導入する。orchとsetupの外部依存は空であり、定義の確認だけを行う。利用先のpackage.jsonやlockへ依存を混ぜない。

旧`templates/AGENTS.md`と開発リポジトリの`.space/babel/`は既存資料として残すが、buildの入力にはしない。指示テンプレートの配布用正本はpackaging配下、共通知識の正本はspace配下である。

## 作業記録と知識を分ける

標準・大規模の依頼にはtask.mdを作る。大規模な依頼は同じ作業単位をorchのunitとして登録し、各担当が自身の進捗・確認記録・提出を更新する。親は提出の証拠を照合して受け入れる。JSONが台帳の正本であり、TSVとMarkdownはexportした一覧である。小規模な会話中の依頼には新規task.mdを必須にしない。

作業中の依頼、計画、仮説、試行結果は`.space/tasks/`へ保存する。OKFの`.space/babel/`には、システムの構成、採用した設計と理由、重要な変遷を残す。原則として引き渡し工程が保存要否と重複を確認し、保存と検証を行う。配布元の共通知識は`.space/babel/vendor/agent-gear/`へ分け、プロジェクト固有の記録として検索・更新しない。

OKFのconceptはfrontmatter付きMarkdown一件、bundleはその集合を指す。typeはrule・principle・knowledge・procedure・decision。index.mdは目次、log.mdは文書操作の履歴であり、システムの歴史や作業ログの代わりにはならない。

## 動作と制約

- setupは前回配置した内容を照合し、既存の独自文書や指示の管理ブロック外を保持する。衝突時には適用前に停止し、途中終了はpending記録から再開する。
- orchはローカルJSONを排他・原子的置換で更新する。再送を操作IDで識別し、古い試行・置き換え済みの証拠・失効した提出を現在の合格として扱わない。
- OKFは内容と根拠の正しさを判定しない。エージェントが記録の価値と本文を判断し、CLIが検索・形式検証・ファイル操作を行う。複数ファイル全体の自動巻き戻しはない。
- 異常終了後のロックは自動で奪わない。各CLIの資料に従い、書き手の停止を確認して復旧する。
- 共通知識23件は形式・リンク・目次の整合性を満たすが、concept同士のリンクを持たないためstrict検証では孤立文書として不合格になる。配布できたこととstrict合格を混同しない。

日月単位の運用、他OS、ネットワーク共有、電源断はローカルの短時間試験で確認済みにしない。orchの保持・切り替えと測定範囲は[運用資料](skills/orch/operations.md)、OKFの依存配置は[移行記録](skills/okf-agent-memory/runtime-migration.md)、setupは[実装記録](skills/setup/implementation.md)に記録する。
