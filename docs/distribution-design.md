# 配布・導入とorch運用確認

この文書は初期実装の記録である。共通知識の配置先と共有目次の管理方式は、[Babel統合の記録](babel-distribution.md)で更新した。

2026-09-23。ユーザーの「AIで全部できるなら対応して良い」に基づき、orchの実運用確認、配布生成・setup・カタログ・CI・ローカル導入、OKF実行依存の移行を進める。公開・remoteへのpush・mainへのmergeは含めない。

## 構成と判断

プラグイン名は既存リポジトリと同じagent-gearとし、既存スキル名は変えない。CodexとClaude Codeの配布先は既存architecture.mdに従う。バージョンはルートpackage.jsonを正本にする。

生成方式は、リポジトリを丸ごとコピーして除外する案と、配布するディレクトリ・ファイルを明示する案を比較し、後者を採用する。skillsのSKILL.md・references・assets・scripts・LICENSE・任意のUIメタデータと、space/babel、製品別packagingを組み合わせる。開発記録、テスト、node_modules、利用先の.spaceを取り込まない。再生成後の全ファイル一覧と内容を比較し、追加・変更・削除を検出する。

setupは利用先のvendorディレクトリと、選択製品の指示ファイル内の管理ブロックだけを更新する。ディレクトリ全体の置換は既存の独自文書を失うため採用しない。旧版ハッシュと現在内容を照合し、ローカル変更があれば衝突として計画を返す。指示の管理ブロック外を保持し、明示的なapplyまで書き込まない。削除された配布ファイルを利用先から自動削除しない。

## 共有するsetup入力

配布ルートのsetup-manifest.jsonをbuildが生成する。schemaVersion=1、plugin、product（codexまたはclaude-code）、version、files配列を持つ。各files要素はsource（配布ルートからの相対パス）、destination（利用先からの相対パス）、mode（copyまたはmanaged-block）。copyは.space/babel/vendor/agent-gear配下と製品別agent配置先に限定する。managed-blockはAGENTS.mdまたはCLAUDE.mdに限定する。

テンプレートの{{SKILL_ROOT}}は配布ルートのskillsの絶対パス、{{VENDOR_BUNDLE}}は利用先のvendor bundleの絶対パスへ解決する。sourceもdestinationも絶対指定・親方向の参照・symlinkによる外部参照を拒否する。setupの記録は.space/setup/<plugin>-<product>.json。明示的な--projectを必須にし、plan・apply・statusを提供する。配布スキルの入口はskills/setup/scripts/setup.ts。

## 分担と検証

| 担当 | 所有範囲 | 終了条件 |
| --- | --- | --- |
| 統括 | packaging・build・CI・共通知識の配布用コピー・ルート依存・設計資料・導入 | 決定的生成、未追跡を含む差分検出、両製品の形式検証、コピー後の利用確認 |
| OKF担当 | skills/okf-agent-memoryと個別の移行記録 | scripts内の依存・lock・bootstrap、既存挙動維持、独立配置での起動 |
| setup担当 | skills/setupと個別の設計・実装記録 | 初回・再実行・更新・衝突・既存文書保持・パス境界を実CLIで確認 |
| orch運用評価担当 | 負荷試験スクリプトと評価記録 | 実CLIで規模を増やして測定、保持・アーカイブ方針を根拠付きで提案 |

この実装タスク自体をorchの実運用試験として登録し、実際の各担当が自分のunitを開始・更新・提出し、統括が成果物と証拠を確認して受け入れる。リポジトリ内のスキルを作業規則として採用するのではなく、CLIを開発対象として実際の分担へ使用する。製品横断の統合確認と必要な独立レビューは統括が取りまとめる。

## 未確認として残すもの

長期間の運用、別OS、ネットワーク共有、電源断は、短時間のローカル試験を根拠に確認済みとしない。履歴は初版では保持し、負荷測定から手動の保存・切り替え方法と見直す目安を決める。ユーザーの既存設定・作業内容を一括で置換しない。
