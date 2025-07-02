<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

# MD Maker Obsidian Plugin

これはObsidianプラグインプロジェクトです。複数のMarkdownファイルを連番で作成する機能を提供します。

## プロジェクト構成

- TypeScriptで開発されたObsidianプラグイン
- メインファイル: `main.ts`
- ビルドツール: esbuild
- パッケージマネージャー: npm

## 開発ガイドライン

- Obsidian APIを使用してプラグインを開発
- TypeScriptの型安全性を重視
- ユーザーフレンドリーなUIを提供
- 日本語ユーザー向けの機能（全角数字対応など）

## 主な機能

1. 複数Markdownファイルの一括作成
2. フォルダ選択機能
3. ファイル名のプレビュー
4. 設定の保存・呼び出し
5. 全角数字の半角変換

## コーディング規約

- ES2018以降の機能を使用可能
- async/awaitを積極的に使用
- エラーハンドリングを適切に実装
- ユーザビリティを重視したUI設計
