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

    convertFullwidthToHalfwidth(text: string): string {
        const full = '０１２３４５６７８９';
        const half = '0123456789';
        return text.replace(/[０-９]/g, ch => half[full.indexOf(ch)]);
    }

    /**
     * rawFmt 中のすべての "n" を連番に置換し、
     * "\n"（バックスラッシュ＋n）だけはリテラル "n" として扱います。
     */
    public formatSegment(rawFmt: string, pad: number, index: number): string {
        const ESC = '__LITERAL_N__';
        // 1) \n をマーカーに
        let t = rawFmt.replace(/\\n/g, ESC);
        // 2) 残りの n を連番に
        const num = pad > 0
            ? index.toString().padStart(pad, '0')
            : index.toString();
        t = t.replace(/n/g, num);
        // 3) マーカーを "n" に戻す
        return t.replace(new RegExp(ESC, 'g'), 'n');
    }

    async createFiles(
        folder: TFolder,
        baseName: string,
        count: number
    ): Promise<{ created: string[]; failed: string[] }> {
        const { numberFormat: rawFmt, padWidth: pad } = this.settings;
        const created: string[] = [];
        const failed: string[] = [];

        for (let i = 1; i <= count; i++) {
            const seg = this.formatSegment(rawFmt, pad, i);
            const fileName = `${baseName}${seg}.md`;
            const filePath = folder.path === '/' ? fileName : `${folder.path}/${fileName}`;

            try {
                if (this.app.vault.getAbstractFileByPath(filePath)) {
                    failed.push(`${fileName} (既に存在)`);
                    continue;
                }
                await this.app.vault.create(filePath, '');
                created.push(fileName);
            } catch (e: any) {
                failed.push(`${fileName} (エラー: ${e.message})`);
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
            .addDropdown(dd => this.populateFolderDropdown(dd));

        // ベース名
        new Setting(this.contentEl)
            .setName('ベース名')
            .setDesc('ファイル名のベースを入力')
            .addText(txt => {
                txt.setPlaceholder('例: メモ')
                    .setValue(this.baseName)
                    .onChange(v => { this.baseName = v; });
            });

        // ファイル数
        new Setting(this.contentEl)
            .setName('ファイル数')
            .setDesc('1〜100 の範囲で入力')
            .addText(txt => {
                txt.setPlaceholder('例: 5')
                    .setValue(this.fileCount.toString())
                    .onChange(v => {
                        const n = parseInt(this.plugin.convertFullwidthToHalfwidth(v));
                        if (!isNaN(n) && n >= 1 && n <= 100) {
                            this.fileCount = n;
                        }
                    });
            });

        // 連番形式
        new Setting(this.contentEl)
            .setName('連番形式')
            .setDesc('`n` は必ず番号に。`\\n` でリテラル「n」を出力')
            .addText(txt => {
                txt.setPlaceholder(DEFAULT_SETTINGS.numberFormat)
                    .setValue(this.numberFormat)
                    .onChange(v => { this.numberFormat = v; });
            });

        // ゼロパディング桁数
        new Setting(this.contentEl)
            .setName('ゼロパディング桁数')
            .setDesc('連番を何桁でゼロパディングするか（0はなし）')
            .addDropdown(dd => {
                ['0', '2', '3'].forEach(val => {
                    dd.addOption(val, val === '0' ? 'なし' : `${val}桁`);
                });
                dd.setValue(String(this.padWidth));
                dd.onChange(v => { this.padWidth = parseInt(v); });
            });

        // プレビュー
        const preview = this.contentEl.createDiv({ cls: 'mdmaker-preview' });
        this.updatePreview(preview);

        // 区切り線
        this.contentEl.createEl('hr');

        // 一括作成／キャンセル
        const btnWrp = this.contentEl.createDiv({ cls: 'mdmaker-button-container' });
        btnWrp.style.justifyContent = 'flex-end';

        const createBtn = btnWrp.createEl('button', {
            text: '一括作成',
            cls: 'mdmaker-create-button'
        });
        createBtn.addEventListener('click', async () => {
            this.plugin.settings.numberFormat = this.numberFormat;
            this.plugin.settings.padWidth = this.padWidth;
            await this.plugin.saveSettings();
            await this.executeCreate();
        });

        const cancelBtn = btnWrp.createEl('button', {
            text: 'キャンセル',
            cls: 'mdmaker-cancel-button'
        });
        cancelBtn.addEventListener('click', () => this.close());

        this.contentEl.addEventListener('input', () => this.updatePreview(preview));
    }

    private updatePreview(container: HTMLElement): void {
        container.empty();
        if (!this.baseName.trim() || this.fileCount < 1) return;

        const max = Math.min(this.fileCount, 5);
        for (let i = 1; i <= max; i++) {
            const seg = this.plugin.formatSegment(this.numberFormat, this.padWidth, i);
            const item = container.createDiv({ cls: 'mdmaker-preview-item' });
            item.textContent = `${this.baseName}${seg}.md`;
        }
        if (this.fileCount > 5) {
            const more = container.createDiv({ cls: 'mdmaker-preview-item' });
            more.style.fontStyle = 'italic';
            more.textContent = `...あと${this.fileCount - 5}個`;
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
            if (created.length) new Notice(`${created.length}個 作成完了`);
            if (failed.length) {
                new Notice(`${failed.length}個 作成失敗`);
                console.warn('失敗:', failed);
            }
            this.close();
        } catch {
            new Notice('作成中にエラーが発生しました');
        }
    }

    private async populateFolderDropdown(dd: DropdownComponent): Promise<void> {
        dd.addOption('/', 'ルート (/)');
        let folders = this.app.vault.getAllLoadedFiles()
            .filter(f => f instanceof TFolder)
            .map(f => f as TFolder)
            .sort((a, b) => a.path.localeCompare(b.path));
        if (!folders.length) {
            const recurse = async (p: string): Promise<TFolder[]> => {
                const out: TFolder[] = [];
                const { folders: subs } = await this.app.vault.adapter.list(p);
                for (const sub of subs) {
                    const f = this.app.vault.getAbstractFileByPath(sub);
                    if (f instanceof TFolder) {
                        out.push(f);
                        out.push(...await recurse(sub));
                    }
                }
                return out;
            };
            folders = await recurse('/');
        }
        folders.forEach(f => {
            if (f.path !== '/') dd.addOption(f.path, f.path);
        });
        dd.setValue(this.selectedFolder.path);
        dd.onChange(v => {
            const f = this.app.vault.getAbstractFileByPath(v);
            this.selectedFolder = f instanceof TFolder ? f : this.app.vault.getRoot();
        });
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
            .setName('ファイル名')
            .setDesc('新規ファイルのベースネーム')
            .addText(txt => {
                txt.setPlaceholder(DEFAULT_SETTINGS.defaultBaseName)
                    .setValue(this.plugin.settings.defaultBaseName)
                    .onChange(async v => {
                        this.plugin.settings.defaultBaseName = v;
                        await this.plugin.saveSettings();
                    });
            });

        // ファイル数
        new Setting(this.containerEl)
            .setName('ファイル数')
            .setDesc('1〜100の範囲')
            .addText(txt => {
                txt.setPlaceholder(String(DEFAULT_SETTINGS.defaultFileCount))
                    .setValue(String(this.plugin.settings.defaultFileCount))
                    .onChange(async v => {
                        const n = parseInt(v);
                        if (!isNaN(n) && n >= 1 && n <= 100) {
                            this.plugin.settings.defaultFileCount = n;
                            await this.plugin.saveSettings();
                        }
                    });
            });

        // 連番形式
        new Setting(this.containerEl)
            .setName('連番形式')
            .setDesc('`n` は連番に。`\\n` で文字nとして出力')
            .addText(txt => {
                txt.setPlaceholder(DEFAULT_SETTINGS.numberFormat)
                    .setValue(this.plugin.settings.numberFormat)
                    .onChange(async v => {
                        this.plugin.settings.numberFormat = v;
                        await this.plugin.saveSettings();
                    });
            });

        // ゼロパディング桁数
        new Setting(this.containerEl)
            .setName('ゼロパディング桁数')
            .setDesc('連番を何桁でゼロパディングするか（0はなし）')
            .addDropdown(dd => {
                ['0', '2', '3'].forEach(val => {
                    dd.addOption(val, val === '0' ? 'なし' : `${val}桁`);
                });
                dd.setValue(String(this.plugin.settings.padWidth));
                dd.onChange(async v => {
                    this.plugin.settings.padWidth = parseInt(v);
                    await this.plugin.saveSettings();
                });
            });

        // 作成先ディレクトリ
        new Setting(this.containerEl)
            .setName('作成先ディレクトリ')
            .setDesc('対象ディレクトリにファイルが一括作成されます。')
            .addDropdown(dd => this.populateFolderDropdown(dd));

        // クイック作成ボタン（右寄せ）
        const action = this.containerEl.createDiv();
        action.style.textAlign = 'right';
        action.style.marginTop = '40px';

        const quickBtn = action.createEl('button', { text: '一括作成' });
        quickBtn.addEventListener('click', async () => {
            const f = this.app.vault.getAbstractFileByPath(this.plugin.settings.targetFolder) as TFolder;
            const tgt = f instanceof TFolder ? f : this.app.vault.getRoot();
            const { created, failed } = await this.plugin.createFiles(
                tgt,
                this.plugin.settings.defaultBaseName,
                this.plugin.settings.defaultFileCount
            );
            if (created.length) new Notice(`${created.length}個 作成完了`);
            if (failed.length) {
                new Notice(`${failed.length}個 作成失敗`);
                console.warn('失敗:', failed);
            }
        });
    }

    private async populateFolderDropdown(dd: DropdownComponent): Promise<void> {
        dd.addOption('/', 'ルート (/)');
        const folders = this.app.vault.getAllLoadedFiles()
            .filter(f => f instanceof TFolder)
            .map(f => f as TFolder)
            .sort((a, b) => a.path.localeCompare(b.path));
        folders.forEach(f => {
            if (f.path !== '/') dd.addOption(f.path, f.path);
        });
        dd.setValue(this.plugin.settings.targetFolder);
        dd.onChange(async v => {
            this.plugin.settings.targetFolder = v;
            await this.plugin.saveSettings();
        });
    }
}
