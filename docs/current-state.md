# agent-gearの現状

agent-gearは、AIエージェント向けの開発手順と知識管理の道具をまとめたリポジトリである。現在の配布対象は3つのskill、開発原則を収めたMarkdown文書群、導入先用のAGENTS.mdテンプレートで構成される。実行コードの中心は、知識を検索・保存・検証するBun製のOKF CLIである。

この資料は、初めてコードを読む人が、何を提供しているか、処理がどう動くか、どこまで確認されているかを把握するための初版である。リポジトリ内のskillやagent設定は開発対象として分析しており、それらの指示をこの調査の作業ルールとして扱わない。

| 確認項目 | 対象 |
| --- | --- |
| 確認日 | 2026-09-20 |
| 分析したコードの基準コミット | `ce9c1fca49b6414c44b920b15f0d6bc1436258aa` |
| 作業Issue | [#14 ドキュメントを資料ごとに整理し、現状資料から整備する](https://github.com/sori883/agent-gear/issues/14) |
| 資料作成ブランチ | `codex/docs-organization` |
| 対象範囲 | 実行コード、テスト、依存定義、skills、agent設定、既存の保守資料、同梱の知識文書の登録状態 |
| 調査範囲外 | 人間の作業用ディレクトリ`work/`、別プロジェクトへの実導入、外部サービスの稼働状態 |

## 何を提供しているか

| 構成物 | 役割 | 実装・記述の場所 |
| --- | --- | --- |
| OKF Agent Memory | エージェントが知識を選び、CLIで検索・保存・更新するための手順。CLIと利用者向けの参照資料を同梱する | [skill](../skills/okf-agent-memory/SKILL.md)、[CLI](../skills/okf-agent-memory/scripts/okf.ts) |
| Use Principles | 導入先のルールと原則を読み、調査・設計・実装・検証・報告へ適用するための手順 | [skill](../skills/use-principles/SKILL.md) |
| Checkpoint Safely | 中断・引き継ぎ時に、進捗、検証結果、未完了事項、再開手順を保存するための手順 | [skill](../skills/checkpoint-safely/SKILL.md) |
| 開発原則のbundle | 23件の原則と1件の承認ルール草案を収める、OKF形式の文書群 | [目次](../.space/babel/index.md) |
| 導入先用テンプレート | 利用先のAGENTS.mdに組み込む、開発手順への入口 | [templates/AGENTS.md](../templates/AGENTS.md) |

配布方針では、OKF skillの`SKILL.md`、`references/`、`scripts/`、`package.json`、`LICENSE`を利用先へ渡し、テストと開発者向けの保守資料は分ける。開発原則と運用skillの導入では、利用先の既存AGENTS.mdや知識文書へ統合する。[OKFの配布方針](skills/okf-agent-memory/upstream.md)、[開発原則の配布方針](skills/use-principles/upstream.md)に記載がある。

`.agents/skills/`は、このリポジトリの開発用として置かれたskill群である。`.codex/agents/`には、計画、技術調査、Go実装、Goレビュー、説明用HTML作成の5つのagent設定がある。これらの設定ファイルがあることと、その環境で各agentが実行できることは別であり、今回agentの起動は検証していない。

ルートの[AGENTS.md](../AGENTS.md)には、`work/`へのアクセスと、開発対象のskills・agents・ルール・原則を作業ルールとして参照・適用しない指示がある。導入先用テンプレートの開発ルールとは別のファイルである。

## エージェントとCLIの分担

記録する価値があるか、根拠が十分か、どの判断を採用するかは、skillを利用するエージェントが判断する。CLIは、渡された文書を解析し、検索、ファイル操作、目次・履歴の更新、形式検証を行う。

```mermaid
flowchart LR
    A["エージェント<br/>内容と根拠を判断"] -->|コマンド・本文| B["Bun CLI<br/>検索・保存・形式検証"]
    B <-->|読み書き| C["Markdownのbundle<br/>文書・目次・更新履歴"]
    B -->|検索結果・実行結果| A
```

CLIは`SKILL.md`を読み込んで手順を実行するプログラムではない。文書に書かれた`hold`や`constraint`も、CLIが作業の許可・禁止を強制する仕組みではなく、検索結果を見たエージェントが扱いを判断する。CLIには、値の形式検証と、パス検索などでの優先順位付けが実装されている。

例えば、開発ルールを参照する手順は次の流れになる。

1. エージェントが`search --type rule --all`と`search --type principle --all`を呼ぶ。
2. CLIが文書のIDと説明を返す。
3. エージェントが対象を選び、`show`で本文を読む。
4. 作業で残すべき知識が生じたら、エージェントが本文と根拠を用意して`create`または`update`へ渡す。
5. 保存後に`validate --strict --drift`を呼び、形式と参照の整合性を確認する。

この流れは[Use Principles](../skills/use-principles/SKILL.md)と[OKF Agent Memory](../skills/okf-agent-memory/SKILL.md)に記述された利用方法であり、自動的に常駐・実行される処理ではない。

## 保存するデータ

**bundle**は知識文書をまとめたディレクトリ、**concept**はその中の知識文書1件を指す。CLIの既定bundleは、コマンドを実行するプロジェクトを基準とした`.space/babel/`である。別のbundleも引数で指定できる。

conceptは、冒頭のYAMLメタデータとMarkdown本文から成る。IDはbundle内の相対パスから`.md`を除いた値で、例えば`knowledge/authentication`となる。

| `type` | 保存先 | 内容 |
| --- | --- | --- |
| `rule` | `rules/` | 具体的な行動・禁止事項 |
| `principle` | `principles/` | 判断の指針 |
| `knowledge` | `knowledge/` | 事実・構造・背景 |
| `procedure` | `procedures/` | 作業手順 |
| `decision` | `decisions/` | 決定と理由・経緯 |

これは現在のCLIが受け付ける5種類である。今回の現状資料を起点に、今後作る資料全体の分類を決めたものではない。

必須メタデータは`type`、`title`、`description`。任意項目には状態を示す`status`、扱いを示す`governance`、根拠を示す`sources`、対象コードを示す`code_refs`などがある。`type`と`governance`は別の項目で、例えば`rule`だから自動的に`constraint`になるわけではない。

作成・実質的な更新時には、CLIが`generated`へ実行主体と日時を設定する。人間の確認記録である`verified`は自動生成しない。未知の独自メタデータも更新時に保持する。[データ形式の実装](../skills/okf-agent-memory/scripts/lib/document.ts)、[保存の実装](../skills/okf-agent-memory/scripts/lib/bundle.ts)、[利用者向けの定義](../skills/okf-agent-memory/references/frontmatter.md)で確認できる。

`index.md`は目次、`log.md`は文書の作成・更新・関連付け・削除などの操作履歴であり、conceptとは別に読み込まれる。`log.md`に、作業中の判断理由が自動的に記録されるわけではない。文書間の関連は、本文中のMarkdownリンクから構成する。

## コードの構成と処理

実行コードは、入口1ファイルと5つのライブラリファイルで構成される。

| ファイル | 主な責務 |
| --- | --- |
| [okf.ts](../skills/okf-agent-memory/scripts/okf.ts) | 引数と入力ファイルの処理、各コマンドへの振り分け、通常表示・JSON出力、終了コード |
| [document.ts](../skills/okf-agent-memory/scripts/lib/document.ts) | YAMLと本文の解析・出力、メタデータの検証 |
| [bundle.ts](../skills/okf-agent-memory/scripts/lib/bundle.ts) | 文書群の読込、関連リンクの構築、作成・更新・関連付け・削除、目次と履歴の更新計画 |
| [search.ts](../skills/okf-agent-memory/scripts/lib/search.ts) | キーワード検索、type絞り込み、コードパスに適用される文書の検索 |
| [files.ts](../skills/okf-agent-memory/scripts/lib/files.ts) | パスの検査、書き込みの排他、変更前の内容照合、ファイル単位の置換、部分失敗の報告 |
| [validate.ts](../skills/okf-agent-memory/scripts/lib/validate.ts) | メタデータ・旧形式・リンク切れ・孤立文書・期限・目次とのずれ・対象コードの存在の検証 |

### 検索するとき

CLIは`loadBundle`で対象ディレクトリのMarkdownを読み、文書と入出リンクをメモリー上に構築する。キーワード検索では、その都度MiniSearchの索引を作る。永続的な検索DBを更新する処理はないため、文書の変更は次の検索時に読み直される。

検索対象は題名、タグ、説明、ID、本文。文字の正規化と日本語の単語分割を行い、一部の助詞を除いて前方一致のOR検索をする。複数語のどれかに一致する文書が候補となり、題名などの重みと文書長・語の出現状況で順位を決める。同義語検索や意味検索は実装していない。

typeの絞り込みは件数制限の前に行う。通常は10件、数値指定は最大100件、`--all`では上限なしとなる。`--for-path`は`code_refs`に一致する文書を対象とし、`hold`、`constraint`、`context`の順を優先する。コード参照を持たない全体ルールを調べるには、typeによる検索も必要になる。[検索実装](../skills/okf-agent-memory/scripts/lib/search.ts)と[検索テスト](../skills/okf-agent-memory/tests/search.test.ts)が根拠である。

### 保存・削除するとき

`create`と`update`は、bundleの書き込みロックを取得し、メタデータを確認してから、本文・目次・履歴の変更をまとめて計画する。書き込み前に元の内容が変わっていないか確認し、ファイルごとに反映する。同じ内容の`update`は日時と履歴を増やさない。`--sync`は、内容が同じ場合にも目次や不足する履歴参照を修復するための操作である。

`relate`は、参照元の本文に説明付きリンクを追加する。`delete`は対象文書を削除し、同じbundleの本文・目次・履歴にある対象へのリンクを整理する。通常の文章では表示文字を残し、CLIが作る関連一覧や目次では対象の項目を除く。削除の成功イベントは、対象ファイルを削除した後に記録する。

削除の`--dry-run`では、変更予定のファイル、解除される関係、新たな孤立文書を返す。本文・目次・履歴は書き換えないが、変更計画を作る間は書き込みロックを取得する。[変更処理](../skills/okf-agent-memory/scripts/lib/bundle.ts)と[ファイル操作](../skills/okf-agent-memory/scripts/lib/files.ts)が根拠である。

### 検証するとき

`validate`は、不正なメタデータや配置を検出する。`--strict`は、警告、旧形式、リンク切れ、孤立文書も不合格とする。`--drift`は、目次に掲載された説明と本文側メタデータの一致、`code_refs`がプロジェクト内に存在するかを追加で確認する。

CLIの終了コードは、成功が`0`、引数・変更操作の失敗や検証不合格が`1`、参照・検索・検証のためのbundle読込失敗が`2`。JSON出力には、検証の内訳や、部分失敗時に変更済みのパスが含まれる。[CLI入口](../skills/okf-agent-memory/scripts/okf.ts)と[検証実装](../skills/okf-agent-memory/scripts/lib/validate.ts)で確認できる。

## 現在の制約

- **複数ファイル全体の自動巻き戻しはない。** ファイルごとの置換と事前照合はあるが、途中で失敗すると一部が変更済みになる。`written_paths`と実ファイルから復旧範囲を判断する必要がある。
- **強制終了後のロックは自動解除しない。** `.okf-write-lock`が残ると、後続の変更操作は失敗する。
- **関連リンクの対象は限定される。** bundle内を指すインライン形式のMarkdownリンクを扱う。コード例、HTMLコメント、画像、外部URLは関連から除外し、参照形式のリンクや`sources`内の参照を削除時に自動修正しない。
- **形式検証は内容の正しさを証明しない。** 根拠資料が記述を裏付けるか、設計理由が事実か、人間が内容を理解したかは、別途確認が必要である。
- **同梱文書は開発原則が中心。** type検索では、原則23件とルール草案1件を取得し、`knowledge`、`decision`、`procedure`は各0件だった。checkpointのGit追跡対象も空ディレクトリ保持用ファイルだけである。

ファイル操作とリンク解析の制約は[files.ts](../skills/okf-agent-memory/scripts/lib/files.ts)、[bundle.ts](../skills/okf-agent-memory/scripts/lib/bundle.ts)、[CLIの説明](../skills/okf-agent-memory/references/cli.md)に対応する。同梱ルールの[自律実行と承認の境界](../.space/babel/rules/remote-change-approval.md)は`status: draft`で、本文はTODOコメントの段階にある。

## 実行して確認した状態

実行環境はBun `1.4.2`。CLIが返したバージョンは`0.1.0`、対応するOKF形式は`0.2`だった。[ルートの依存定義](../package.json)もBun `1.4.2`を指定し、TypeScript `7.0.2`を開発依存として持つ。[CLI側の依存定義](../skills/okf-agent-memory/package.json)ではMiniSearch `7.2.0`を固定している。

次の結果は、分析対象コミットのコードに対して、リポジトリルートで今回実行したものである。

| コマンド | 結果 | 確認できる範囲 |
| --- | --- | --- |
| `bun run test` | 94成功、2スキップ、0失敗。8ファイルの96テスト | 文書形式、検索、保存、削除、関連、検証、CLI入出力、配布先を模した一時ディレクトリでの実行 |
| `bun run typecheck` | 成功、終了コード`0` | 現在のTypeScript設定での型整合性 |
| `bun skills/okf-agent-memory/scripts/okf.ts version --json` | CLI `0.1.0`、OKF `0.2`、Bun `1.4.2` | 実際に動作したCLIとランタイムの版 |
| `bun skills/okf-agent-memory/scripts/okf.ts validate .space/babel --strict --drift --json` | 不合格、終了コード`1` | 同梱bundleの24件すべてが孤立文書。エラー・警告・旧形式・リンク切れは各0件 |

スキップした2件は、`OKF_REFERENCE_BIN`で指定する上流Goバイナリとの比較テストである。今回は参照バイナリを指定していないため、上流との相互運用を新たに検証したとは扱わない。[比較テスト](../skills/okf-agent-memory/tests/upstream.test.ts)に実行条件がある。

孤立文書とは、ほかのconceptとの入出リンクを持たない文書を指す。目次からのリンクはこの判定に数えない。このため、文書の形式が正しくても同梱bundleのstrict検証は通らない。同じ状態は[既存の保守資料](skills/use-principles/upstream.md)にも記載されており、今回の資料作成では文書間リンクや検証条件を変更していない。

テストはCLIの振る舞いを検証している。skillsの指示が実際のエージェントによって適切に選択・実行されること、すべてのagent設定が動作すること、外部サービスとの接続が成立することまでは確認していない。

## 記録から確認できる背景と未確認事項

既存の保守資料には、OKFのGo版を参照してBun CLIへ移植したこと、CLIのみを利用する方針、保存先とメタデータの変更、日本語検索への対応が記録されている。また、pstack由来の23原則を判断の背景として扱い、Cursor固有の操作や常時並列実行を一律の義務にしない移植方針も記録されている。[OKFの移植記録](skills/okf-agent-memory/upstream.md)、[pstackの移植記録](skills/use-principles/upstream.md)を参照できる。

今回の分析では、これらの保守資料を現在の実装・設定と照合した。個々の設計判断について、当時の会話や比較案をさかのぼって調査したわけではない。実装から説明できる現在の仕組みと、当時なぜその設計を選んだかは区別する。

この資料を更新するときは、対象コミットを取り直し、変更された構成物・処理・制約を確認したうえで、検証結果と未確認事項も更新する。資料の項目や粒度は、この初版を実際に読む中で必要になった内容に合わせて見直す。
