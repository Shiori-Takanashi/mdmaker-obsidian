import {
    App,
    Plugin,
    PluginSettingTab,
    Setting,
    Modal,
    TFolder,
    Notice,
    DropdownComponent,
} from 'obsidian';

// フォルダドロップダウンを生成するユーティリティ関数
async function populateFolderDropdown(
    app: App,
    dropdown: DropdownComponent,
    currentValue: string,
    onChange: (value: string) => void | Promise<void>
): Promise<void> {
    dropdown.addOption('/', 'ルート (/)');

    let folders = app.vault.getAllLoadedFiles()
        .filter(f => f instanceof TFolder)
        .map(f => f as TFolder)
        .sort((a, b) => a.path.localeCompare(b.path));

    // フォルダが読み込まれていない場合の対応
    if (!folders.length) {
        const recurse = async (path: string): Promise<TFolder[]> => {
            const result: TFolder[] = [];
            try {
                const { folders: subFolders } = await app.vault.adapter.list(path);
                for (const subPath of subFolders) {
                    const folder = app.vault.getAbstractFileByPath(subPath);
                    if (folder instanceof TFolder) {
                        result.push(folder);
                        result.push(...await recurse(subPath));
                    }
                }
            } catch (error) {
                // フォルダ読み込みエラーは無視
            }
            return result;
        };
        folders = await recurse('/');
    }

    folders.forEach(folder => {
        if (folder.path !== '/') {
            dropdown.addOption(folder.path, folder.path);
        }
    });

    dropdown.setValue(currentValue);
    dropdown.onChange(onChange);
}

interface MDMakerSettings {
    defaultFileCount: number;
    defaultBaseName: string;
    targetFolder: string;
    numberFormat: string;  // 生入力（n や -n: など）
    padWidth: number;      // 0=なし, 2=2桁, 3=3桁
}

const DEFAULT_SETTINGS: MDMakerSettings = {
    defaultFileCount: 5,
    defaultBaseName: 'ファイル',
    targetFolder: '/',
    numberFormat: '（n）',  // デフォルトは全角括弧＋n
    padWidth: 2
};

export default class MDMakerPlugin extends Plugin {
    settings: MDMakerSettings;

    async onload(): Promise<void> {
        await this.loadSettings();

        this.addRibbonIcon('file-plus', 'MD Maker', () => {
            new MDMakerModal(this.app, this).open();
        });

        this.addCommand({
            id: 'open-mdmaker-modal',
            name: 'MD Makerを開く',
            callback: () => new MDMakerModal(this.app, this).open()
        });

        this.addSettingTab(new MDMakerSettingTab(this.app, this));
    }

    onunload(): void { }

    private async loadSettings(): Promise<void> {
        const loaded = (await this.loadData()) as Partial<MDMakerSettings>;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    /**
     * 全角数字を半角数字に変換する
     */
    convertFullwidthToHalfwidth(text: string): string {
        const fullwidthDigits = '０１２３４５６７８９';
        const halfwidthDigits = '0123456789';
        return text.replace(/[０-９]/g, char => halfwidthDigits[fullwidthDigits.indexOf(char)]);
    }

    /**
     * 連番フォーマットの変換処理
     * rawFmt 中のすべての "n" を連番に置換し、
     * "\n"（バックスラッシュ＋n）だけはリテラル "n" として扱います。
     */
    public formatSegment(rawFormat: string, padWidth: number, index: number): string {
        const ESCAPE_MARKER = '__LITERAL_N__';
        // 1) \n をマーカーに置換
        let text = rawFormat.replace(/\\n/g, ESCAPE_MARKER);
        // 2) 残りの n を連番に置換
        const numberString = padWidth > 0
            ? index.toString().padStart(padWidth, '0')
            : index.toString();
        text = text.replace(/n/g, numberString);
        // 3) マーカーを "n" に戻す
        return text.replace(new RegExp(ESCAPE_MARKER, 'g'), 'n');
    }

    /**
     * 複数のMarkdownファイルを作成する
     */
    async createFiles(
        folder: TFolder,
        baseName: string,
        count: number
    ): Promise<{ created: string[]; failed: string[] }> {
        const { numberFormat: rawFormat, padWidth } = this.settings;
        const created: string[] = [];
        const failed: string[] = [];

        for (let i = 1; i <= count; i++) {
            const segment = this.formatSegment(rawFormat, padWidth, i);
            const fileName = `${baseName}${segment}.md`;
            const filePath = folder.path === '/' ? fileName : `${folder.path}/${fileName}`;

            try {
                if (this.app.vault.getAbstractFileByPath(filePath)) {
                    failed.push(`${fileName} (既に存在)`);
                    continue;
                }
                await this.app.vault.create(filePath, '');
                created.push(fileName);
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                failed.push(`${fileName} (エラー: ${errorMessage})`);
            }
        }

        return { created, failed };
    }
}

class MDMakerModal extends Modal {
    private plugin: MDMakerPlugin;
    private baseName: string;
    private fileCount: number;
    private numberFormat: string;
    private padWidth: number;
    private selectedFolder: TFolder;

    constructor(app: App, plugin: MDMakerPlugin) {
        super(app);
        this.plugin = plugin;
        this.baseName = plugin.settings.defaultBaseName;
        this.fileCount = plugin.settings.defaultFileCount;
        this.numberFormat = plugin.settings.numberFormat;
        this.padWidth = plugin.settings.padWidth;

        const path = plugin.settings.targetFolder || '/';
        const af = this.app.vault.getAbstractFileByPath(path);
        this.selectedFolder = af instanceof TFolder ? af : this.app.vault.getRoot();
    }

    protected onOpen(): void {
        this.contentEl.empty();
        this.contentEl.createEl('h2', { text: 'MD Maker - 複数ファイル作成' });

        // フォルダ選択
        new Setting(this.contentEl)
            .setName('作成先フォルダ')
            .setDesc('ファイルを作成するフォルダを選択してください')
            .addDropdown(dropdown => {
                populateFolderDropdown(
                    this.app,
                    dropdown,
                    this.selectedFolder.path,
                    (value: string) => {
                        const folder = this.app.vault.getAbstractFileByPath(value);
                        this.selectedFolder = folder instanceof TFolder ? folder : this.app.vault.getRoot();
                    }
                );
            });

        // ベース名
        new Setting(this.contentEl)
            .setName('ベース名')
            .setDesc('ファイル名のベースを入力')
            .addText(textInput => {
                textInput.setPlaceholder('例: メモ')
                    .setValue(this.baseName)
                    .onChange(value => {
                        this.baseName = value;
                    });
            });

        // ファイル数
        new Setting(this.contentEl)
            .setName('ファイル数')
            .setDesc('1〜100 の範囲で入力')
            .addText(textInput => {
                textInput.setPlaceholder('例: 5')
                    .setValue(this.fileCount.toString())
                    .onChange(value => {
                        const convertedValue = this.plugin.convertFullwidthToHalfwidth(value);
                        const numericValue = parseInt(convertedValue);
                        if (!isNaN(numericValue) && numericValue >= 1 && numericValue <= 100) {
                            this.fileCount = numericValue;
                        }
                    });
            });

        // 連番形式
        new Setting(this.contentEl)
            .setName('連番形式')
            .setDesc('`n` は必ず番号に。`\\n` でリテラル「n」を出力')
            .addText(textInput => {
                textInput.setPlaceholder(DEFAULT_SETTINGS.numberFormat)
                    .setValue(this.numberFormat)
                    .onChange(value => {
                        this.numberFormat = value;
                    });
            });

        // ゼロパディング桁数
        new Setting(this.contentEl)
            .setName('ゼロパディング桁数')
            .setDesc('連番を何桁でゼロパディングするか（0はなし）')
            .addDropdown(dropdown => {
                ['0', '2', '3'].forEach(value => {
                    dropdown.addOption(value, value === '0' ? 'なし' : `${value}桁`);
                });
                dropdown.setValue(String(this.padWidth));
                dropdown.onChange(value => {
                    this.padWidth = parseInt(value);
                });
            });

        // プレビュー
        const preview = this.contentEl.createDiv({ cls: 'mdmaker-preview' });
        this.updatePreview(preview);

        // 区切り線
        this.contentEl.createEl('hr');

        // ボタンコンテナ
        const buttonContainer = this.contentEl.createDiv({ cls: 'modal-button-container' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';
        buttonContainer.style.gap = '8px';

        const createButton = buttonContainer.createEl('button', {
            text: '一括作成',
            cls: 'mdmaker-create-button'
        });
        createButton.addEventListener('click', async () => {
            this.plugin.settings.numberFormat = this.numberFormat;
            this.plugin.settings.padWidth = this.padWidth;
            await this.plugin.saveSettings();
            await this.executeCreate();
        });

        const cancelButton = buttonContainer.createEl('button', {
            text: 'キャンセル',
            cls: 'mdmaker-cancel-button'
        });
        cancelButton.addEventListener('click', () => this.close());

        // プレビューの自動更新
        this.contentEl.addEventListener('input', () => this.updatePreview(preview));
    }

    private updatePreview(container: HTMLElement): void {
        container.empty();
        if (!this.baseName.trim() || this.fileCount < 1) return;

        const maxPreviewCount = Math.min(this.fileCount, 5);
        for (let i = 1; i <= maxPreviewCount; i++) {
            const segment = this.plugin.formatSegment(this.numberFormat, this.padWidth, i);
            const item = container.createDiv({ cls: 'mdmaker-preview-item' });
            item.textContent = `${this.baseName}${segment}.md`;
        }
        if (this.fileCount > 5) {
            const moreItem = container.createDiv({ cls: 'mdmaker-preview-item' });
            moreItem.style.fontStyle = 'italic';
            moreItem.textContent = `...あと${this.fileCount - 5}個`;
        }
    }

    private async executeCreate(): Promise<void> {
        if (!this.baseName.trim()) {
            new Notice('ベース名を入力してください');
            return;
        }
        if (this.fileCount < 1 || this.fileCount > 100) {
            new Notice('ファイル数を正しく入力してください');
            return;
        }

        try {
            const { created, failed } = await this.plugin.createFiles(
                this.selectedFolder,
                this.baseName.trim(),
                this.fileCount
            );

            if (created.length) {
                new Notice(`${created.length}個のファイルを作成しました`);
            }
            if (failed.length) {
                new Notice(`${failed.length}個のファイル作成に失敗しました`);
            }

            this.close();
        } catch (error) {
            new Notice('ファイル作成中にエラーが発生しました');
        }
    }

    protected onClose(): void {
        this.contentEl.empty();
    }
}

class MDMakerSettingTab extends PluginSettingTab {
    private plugin: MDMakerPlugin;

    constructor(app: App, plugin: MDMakerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        this.containerEl.empty();
        this.containerEl.createEl('h2', { text: 'MD Maker 設定' });

        // ファイル名
        new Setting(this.containerEl)
            .setName('デフォルトファイル名')
            .setDesc('新規ファイルのベースネーム')
            .addText(textInput => {
                textInput.setPlaceholder(DEFAULT_SETTINGS.defaultBaseName)
                    .setValue(this.plugin.settings.defaultBaseName)
                    .onChange(async value => {
                        this.plugin.settings.defaultBaseName = value;
                        await this.plugin.saveSettings();
                    });
            });

        // ファイル数
        new Setting(this.containerEl)
            .setName('デフォルトファイル数')
            .setDesc('1〜100の範囲')
            .addText(textInput => {
                textInput.setPlaceholder(String(DEFAULT_SETTINGS.defaultFileCount))
                    .setValue(String(this.plugin.settings.defaultFileCount))
                    .onChange(async value => {
                        const numericValue = parseInt(value);
                        if (!isNaN(numericValue) && numericValue >= 1 && numericValue <= 100) {
                            this.plugin.settings.defaultFileCount = numericValue;
                            await this.plugin.saveSettings();
                        }
                    });
            });

        // 連番形式
        new Setting(this.containerEl)
            .setName('デフォルト連番形式')
            .setDesc('`n` は連番に。`\\n` で文字nとして出力')
            .addText(textInput => {
                textInput.setPlaceholder(DEFAULT_SETTINGS.numberFormat)
                    .setValue(this.plugin.settings.numberFormat)
                    .onChange(async value => {
                        this.plugin.settings.numberFormat = value;
                        await this.plugin.saveSettings();
                    });
            });

        // ゼロパディング桁数
        new Setting(this.containerEl)
            .setName('デフォルトゼロパディング桁数')
            .setDesc('連番を何桁でゼロパディングするか（0はなし）')
            .addDropdown(dropdown => {
                ['0', '2', '3'].forEach(value => {
                    dropdown.addOption(value, value === '0' ? 'なし' : `${value}桁`);
                });
                dropdown.setValue(String(this.plugin.settings.padWidth));
                dropdown.onChange(async value => {
                    this.plugin.settings.padWidth = parseInt(value);
                    await this.plugin.saveSettings();
                });
            });

        // 作成先ディレクトリ
        new Setting(this.containerEl)
            .setName('デフォルト作成先ディレクトリ')
            .setDesc('対象ディレクトリにファイルが一括作成されます。')
            .addDropdown(dropdown => {
                populateFolderDropdown(
                    this.app,
                    dropdown,
                    this.plugin.settings.targetFolder,
                    async (value: string) => {
                        this.plugin.settings.targetFolder = value;
                        await this.plugin.saveSettings();
                    }
                );
            });

        // クイック作成ボタン
        const actionContainer = this.containerEl.createDiv();
        actionContainer.style.textAlign = 'right';
        actionContainer.style.marginTop = '40px';

        const quickCreateButton = actionContainer.createEl('button', {
            text: '設定値で一括作成',
            cls: 'mdmaker-create-button-settings'
        });
        quickCreateButton.addEventListener('click', async () => {
            const folderPath = this.plugin.settings.targetFolder || '/';
            const folder = this.app.vault.getAbstractFileByPath(folderPath);
            const targetFolder = folder instanceof TFolder ? folder : this.app.vault.getRoot();

            const { created, failed } = await this.plugin.createFiles(
                targetFolder,
                this.plugin.settings.defaultBaseName,
                this.plugin.settings.defaultFileCount
            );

            if (created.length) {
                new Notice(`${created.length}個のファイルを作成しました`);
            }
            if (failed.length) {
                new Notice(`${failed.length}個のファイル作成に失敗しました`);
            }
        });
    }
}
