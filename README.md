# agent-gear

AIエージェント向けのスキルを共通ソースから管理し、CodexとClaude Code向けに配布するためのリポジトリです。

## 開発環境

- Bun: `1.4.2`（`.bun-version`と`package.json`の`packageManager`に記録）
- TypeScript: ルートの開発用依存関係として管理

```sh
bun --version
bun install --frozen-lockfile
```

依存関係を変更するときは`bun add --dev --exact <package>`などを使い、`package.json`と`bun.lock`を一緒にコミットします。Bunの採用版を更新するときは`.bun-version`、`packageManager`、`engines.bun`、`@types/bun`も確認します。

現段階では開発環境のみを初期化しています。TypeScriptの実装ファイル、ビルド、テスト、CIはまだありません。最初の実装を追加するときに、`tsc --noEmit`による型チェックと`bun test`などの開発コマンドを`package.json`へ追加します。

`tsconfig.json`は`scripts/`、`skills/`、`tests/`を対象にしています。対象ファイルがまだないため、現段階で`tsc --noEmit`を実行すると入力ファイルがない旨のエラーになります。

## 目標とする構成

以下は今後の実装先です。配布物の名前はリポジトリ名に合わせて`agent-gear`とします。

```text
agent-gear/
├── README.md
├── package.json                  # 開発用依存関係・コマンド・配布版数
├── bun.lock
├── .bun-version
├── tsconfig.json
├── skills/                       # 配布するスキルの共通ソース
│   ├── okf/
│   │   ├── SKILL.md
│   │   ├── references/
│   │   ├── scripts/
│   │   │   ├── okf.ts
│   │   │   ├── bootstrap.ts
│   │   │   ├── package.json       # 必要になった実行時依存関係
│   │   │   ├── bun.lock
│   │   │   └── lib/
│   │   └── tests/
│   └── tasks/                    # 同様の構成。CLI入口はtask.ts
├── packaging/
│   ├── codex/                    # plugin.json、必要なagents/hooks/templates
│   └── claude-code/              # plugin.json、必要なagents/hooks/templates
├── scripts/
│   └── build.ts                  # 配布物とカタログを生成
├── tests/
│   └── integration/              # 生成した配布物の動作確認
├── docs/
│   └── architecture.md
├── .agents/
│   ├── skills/                   # このリポジトリの開発支援用（既存）
│   └── plugins/marketplace.json
├── .codex/                       # このリポジトリの開発用設定（既存）
├── .claude-plugin/marketplace.json
├── .github/workflows/ci.yml
└── dist/
    ├── codex/agent-gear/
    └── claude-code/agent-gear/
```

## 管理方針

- ルートの`package.json`は開発用です。スキルの実行時依存関係は、必要になったスキルの`scripts/`に分けて管理します。初期化時点ではBun workspacesを設定していません。
- `.agents/skills/`にある既存の開発支援用スキルと、今後`skills/`に実装する配布用スキルは、それぞれの用途で管理します。
- `packaging/`には配布先ごとの定義を置きます。`dist/`とカタログはビルドで生成し、ソースの変更と一緒にmainへコミットする方針です。
- `dist/`は手編集せず、CIでは再生成して差分が出ないことを確認する予定です。
- `work/`は人間の作業用です。

実装は、共通スキルの追加、配布定義とビルドの追加、配布物の結合テストとCIの追加の順に進めます。任意のディレクトリは、実際に内容が必要になった段階で追加します。
