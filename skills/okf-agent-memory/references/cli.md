# CLIの詳細

CLIはTypeScriptで実装され、Bunで動作する。初回はスキルの配置先に依存パッケージをインストールする。インストール後の検索はオフラインで動作する。

利用先プロジェクトのルートから実行する。bundle引数の省略時は、その作業ディレクトリの `.space/babel/` を使う。`code_refs` の検証も作業ディレクトリを基準とする。

```sh
export OKF_SKILL='/absolute/path/to/skills/okf-agent-memory'
bun install --cwd "$OKF_SKILL" --ignore-scripts
export OKF_CLI="$OKF_SKILL/scripts/okf.ts"
export OKF_BUNDLE="$PWD/.space/babel"
bun "$OKF_CLI" init "$OKF_BUNDLE" --json
bun "$OKF_CLI" help
bun "$OKF_CLI" create --help
```

`init` は既存文書を保持し、5種類のディレクトリ、各目次、ルートの目次・履歴を作る。`create` は既存文書を上書きしない。更新には `update` を使う。

## 日本語の検索

```sh
bun "$OKF_CLI" search 'ルール' "$OKF_BUNDLE" --limit 10 --json
bun "$OKF_CLI" search '認証 APIキー' "$OKF_BUNDLE" --limit 10 --json
```

検索対象は `title`・`tags`・`description`・concept ID・Markdown本文。日本語を単語に分割するため、「認証変更の保留ルール」は「ルール」で見つかる。検索語と文書は検索時だけNFKC正規化・英字の小文字化を行い、全角・半角や結合文字の違いを吸収する。保存済み文書は変更しない。

単語の前方一致で検索し、複数語はいずれかに一致する文書を候補にする（OR）。共通する助詞 `の`・`は`・`が`・`を`・`に`・`へ`・`と`・`で`・`も`・`や` は検索語と文書の両方から除外する。除外後に語が残らない場合は `[]`。同義語や活用形の変換、単語の途中からの任意の部分一致は行わない。例えば「規則」と「ルール」は別の語として扱う。

順位はMiniSearchのBM25+で計算する。項目の重みは title 4 / tags 3.5 / description 2.5 / ID 2 / body 1。スコアは小数点以下2桁に丸め、同点はconcept ID順に並べる。`matched_on` は一致した項目名をこの順序で返す。検索語は先頭1,000文字、分割後の先頭50語まで。結果は既定10件、最大100件。

インデックスは実行ごとに文書からメモリー上に構築するため、直接編集した内容も次回検索に反映される。日本語の単語境界はBunが利用する国際化処理に依存し、実行環境の更新で変わる場合がある。同じ文書・入力・実行環境では同じ結果を返す。

## 本文とfrontmatterを渡す

`--body` はMarkdown本文全体の文字列、`--body-file` はUTF-8ファイルのパス。両方は指定できない。本文を省略した更新は既存本文を保持し、`--body ''` は本文を空にする。

`--metadata-file` はJSONまたはYAMLのマッピングを読む。Markdownファイルの場合はfrontmatter部分を読む。これはCLIへの入力ファイルであり、bundleに保存される文書は常にfrontmatter付きMarkdownである。

例えば `metadata.json` に次の内容を用意する。実際に確認した根拠があれば、このマッピングに `sources` を加える。

```json
{
  "type": "rule",
  "title": "認証変更時の確認",
  "description": "認証処理の変更では成功と失敗の両方を確認する。",
  "governance": "constraint",
  "code_refs": ["src/auth/"],
  "tags": ["認証", "テスト"],
  "status": "stable"
}
```

```sh
bun "$OKF_CLI" create rules/auth-tests "$OKF_BUNDLE" \
  --metadata-file metadata.json --body-file body.md --actor agent:codex --json
```

- `--type`、`--title`、`--desc`、`--tags`、`--status` は入力ファイルの同じ項目を上書きする。`--tags` はカンマ区切り。
- 更新は指定したトップレベル項目だけを置き換える。`sources` などの配列は全体を渡す。未知の独自項目は保持する。
- `generated` はCLIが実際の日時と `--actor` から設定する。入力ファイルでは指定できない。actor省略時は `agent/cli`。
- `verified` を自動生成することはない。入力する場合は、実際に内容確認した人間の記録だけを指定する。
- 任意項目の明示的な削除には `update ... --unset resource` を使う。複数項目なら `--unset` を繰り返す。必須項目と `generated` は削除できない。検証を通すために過去の `verified` を消す操作はしない。
- `update` の内容が同一なら、日時と履歴も変更しない。YAMLの再出力が必要な変更ではfrontmatterのコメント・整形は正規化される。本文を変更しない更新では本文の改行・空白を保持する。

## 結果と検証

| 操作・形式 | 結果 |
| --- | --- |
| `search --json` | ID・説明・スコア・governance・関連リンクの配列。該当なしは `[]` |
| `show --json` | frontmatterと本文、元のMarkdown、`inbound`・`outbound`。独自項目は `extra` |
| `show --raw` | 元のMarkdownをそのまま出力。`--json` と併用不可 |
| 変更操作の `--json` | `status: "success"` と対象IDなど |
| `validate --json` | `errors`・`warnings`・`gate_findings`・`broken_links`・`orphans`・`stale_count` と `gate_passed` |
| 操作エラーの `--json` | stdoutに `status: "error"` と `error`。書き込み処理の失敗では `written_paths` も返す |

終了コードは成功 `0`、引数・変更操作の失敗または検証不合格 `1`、検索・表示・検証でのbundle読み込み失敗 `2`。JSON形式ではstderrの有無だけで成功を判断せず、終了コードと結果を確認する。

`validate --strict --drift` は、プロファイル違反、警告、旧形式の残存、リンク切れ、孤立文書をすべて不合格にする。孤立文書は、2件以上のconceptがあるbundleで、他のconceptとの入出リンクがどちらもない文書。目次からのリンクはconcept同士の関連には数えない。

`--drift` は親の目次への掲載・説明の一致と `code_refs` の実在を確認する。globも一致するパスがあるか調べる。期限切れと古い `verified` は通常の検証でも警告する。`--stale` はstrictでなくても期限切れを不合格にする。これらは形式と参照の検証であり、記述の事実性や人間の確認を証明しない。Mermaid限定など本文作成の契約はエージェントが守る。

## 保存失敗からの復旧

書き込みはbundle内の `.okf-write-lock` で同時変更を排他し、各ファイルを一時ファイルから置換する。複数ファイル全体のトランザクションではないため、途中で失敗したら `written_paths` と `show` で現状を確認する。内容が正しければ次で目次と不足する履歴参照を補う。

```sh
bun "$OKF_CLI" update "concept-id" "$OKF_BUNDLE" --sync --json
bun "$OKF_CLI" validate "$OKF_BUNDLE" --strict --drift --json
```

`--sync` は内容が不変なら `generated` を保持し、必要な修復を `Synchronization` として履歴に記す。失われた過去の変更時刻や出来事を再構成する機能ではない。既に同期済みなら重複記録しない。`--no-index`・`--no-log` は意図的に同期を省く場合だけ使う。

プロセスが強制終了するとロックが残る場合がある。CLIは稼働中の書き込みと区別できないため、自動解除しない。実行中のプロセスがないことを確認した管理者がロックを除去して再開する。bundle内のシンボリックリンクは読み書きとも拒否する。

YAMLの解釈は `Bun.YAML` に従う。重複したマッピングキーはBunが後の値を採用し、このCLIでは検出できないため、入力ではキーを重複させない。本文の関連リンクはインライン形式の `.md` リンクを対象とし、コードフェンス・HTMLコメント・画像・外部URLを除く。Markdownの参照形式リンクはグラフ化しない。
