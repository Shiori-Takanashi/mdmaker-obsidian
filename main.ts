import { App, Plugin, PluginSettingTab, Setting, Modal, TFolder, TFile, Notice } from 'obsidian';

interface MDMakerSettings {
    defaultFileCount: number;
    defaultBaseName: string;
    targetFolder: string;
}

const DEFAULT_SETTINGS: MDMakerSettings = {
    defaultFileCount: 5,
    defaultBaseName: 'ファイル',
    targetFolder: '/'
}

export default class MDMakerPlugin extends Plugin {
    settings: MDMakerSettings;

    async onload() {
        await this.loadSettings();

        // リボンアイコンの追加
        const ribbonIconEl = this.addRibbonIcon('file-plus', 'MD Maker', (evt: MouseEvent) => {
            new MDMakerModal(this.app, this).open();
        });

        // コマンドの追加
        this.addCommand({
            id: 'open-mdmaker-modal',
            name: 'MD Makerを開く',
            callback: () => {
                new MDMakerModal(this.app, this).open();
            }
        });

        // 設定タブの追加
        this.addSettingTab(new MDMakerSettingTab(this.app, this));
    }

    onunload() {

    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /**
     * 全角数字を半角数字に変換
     */
    convertFullwidthToHalfwidth(text: string): string {
        const fullwidthDigits = "０１２３４５６７８９";
        const halfwidthDigits = "0123456789";

        let result = text;
        for (let i = 0; i < fullwidthDigits.length; i++) {
            result = result.replace(new RegExp(fullwidthDigits[i], 'g'), halfwidthDigits[i]);
        }
        return result;
    }

    /**
     * ファイルを作成する
     */
    async createFiles(folder: TFolder, baseName: string, count: number): Promise<{ created: string[], failed: string[] }> {
        const paddingWidth = count.toString().length;
        const created: string[] = [];
        const failed: string[] = [];

        for (let i = 1; i <= count; i++) {
            const fileName = `${baseName}(${i.toString().padStart(paddingWidth, '0')}).md`;
            const filePath = folder.path === '/' ? fileName : `${folder.path}/${fileName}`;

            try {
                // ファイルが既に存在するかチェック
                const existingFile = this.app.vault.getAbstractFileByPath(filePath);
                if (existingFile) {
                    failed.push(`${fileName} (既に存在)`);
                    continue;
                }

                // ファイルを作成
                await this.app.vault.create(filePath, '');
                created.push(fileName);
            } catch (error) {
                failed.push(`${fileName} (エラー: ${error.message})`);
            }
        }

        return { created, failed };
    }
}

class MDMakerModal extends Modal {
    plugin: MDMakerPlugin;
    baseName: string;
    fileCount: number;
    selectedFolder: TFolder;

    constructor(app: App, plugin: MDMakerPlugin) {
        super(app);
        this.plugin = plugin;
        this.baseName = plugin.settings.defaultBaseName;
        this.fileCount = plugin.settings.defaultFileCount;

        // selectedFolderの初期化を安全に行う
        try {
            const targetFolderPath = plugin.settings.targetFolder || '/';
            if (targetFolderPath === '/') {
                this.selectedFolder = this.app.vault.getRoot();
            } else {
                const folder = this.app.vault.getAbstractFileByPath(targetFolderPath) as TFolder;
                this.selectedFolder = folder instanceof TFolder ? folder : this.app.vault.getRoot();
            }
        } catch (error) {
            console.error('ターゲットフォルダの取得に失敗:', error);
            this.selectedFolder = this.app.vault.getRoot();
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'MD Maker - 複数ファイル作成' });

        // フォルダ選択
        new Setting(contentEl)
            .setName('作成先フォルダ')
            .setDesc('ファイルを作成するフォルダを選択してください')
            .addDropdown(dropdown => {
                // 非同期でフォルダを設定
                this.populateFolderDropdown(dropdown).catch(error => {
                    console.error('フォルダドロップダウンの設定に失敗:', error);
                    // フォールバック: ルートフォルダのみ
                    dropdown.addOption('/', 'ルート (/)');
                    dropdown.setValue('/');
                });
            });

        // ベース名入力
        new Setting(contentEl)
            .setName('ファイルのベース名')
            .setDesc('作成するファイルの基本名を入力してください')
            .addText(text => text
                .setPlaceholder('例: メモ')
                .setValue(this.baseName)
                .onChange(value => {
                    this.baseName = value;
                }));

        // ファイル数入力
        new Setting(contentEl)
            .setName('作成するファイル数')
            .setDesc('作成するファイルの数を入力してください（1-1000）')
            .addText(text => text
                .setPlaceholder('例: 5')
                .setValue(this.fileCount.toString())
                .onChange(value => {
                    const converted = this.plugin.convertFullwidthToHalfwidth(value);
                    const num = parseInt(converted);
                    if (!isNaN(num) && num > 0 && num <= 1000) {
                        this.fileCount = num;
                    }
                }));

        // プレビュー
        const previewDiv = contentEl.createDiv();
        this.updatePreview(previewDiv);

        // ボタン
        const buttonDiv = contentEl.createDiv({ cls: 'modal-button-container' });
        buttonDiv.style.marginTop = '20px';
        buttonDiv.style.display = 'flex';
        buttonDiv.style.gap = '10px';

        // 作成ボタン
        const createButton = buttonDiv.createEl('button', { text: '作成' });
        createButton.style.backgroundColor = 'var(--interactive-accent)';
        createButton.style.color = 'var(--text-on-accent)';
        createButton.addEventListener('click', async () => {
            await this.createFiles();
        });

        // キャンセルボタン
        const cancelButton = buttonDiv.createEl('button', { text: 'キャンセル' });
        cancelButton.addEventListener('click', () => {
            this.close();
        });

        // 入力値の変更を監視してプレビューを更新
        const updatePreview = () => this.updatePreview(previewDiv);
        contentEl.addEventListener('input', updatePreview);
    }

    updatePreview(container: HTMLElement) {
        container.empty();

        if (!this.baseName.trim() || this.fileCount <= 0) {
            return;
        }

        const previewTitle = container.createEl('h3', { text: 'プレビュー' });
        previewTitle.style.marginTop = '20px';

        const paddingWidth = this.fileCount.toString().length;
        const maxPreview = Math.min(this.fileCount, 5);

        for (let i = 1; i <= maxPreview; i++) {
            const fileName = `${this.baseName}(${i.toString().padStart(paddingWidth, '0')}).md`;
            const fileDiv = container.createDiv();
            fileDiv.style.fontFamily = 'monospace';
            fileDiv.style.fontSize = '0.9em';
            fileDiv.style.padding = '2px 0';
            fileDiv.textContent = fileName;
        }

        if (this.fileCount > 5) {
            const moreDiv = container.createDiv();
            moreDiv.style.fontStyle = 'italic';
            moreDiv.style.color = 'var(--text-muted)';
            moreDiv.textContent = `... あと${this.fileCount - 5}個のファイル`;
        }
    }

    async createFiles() {
        if (!this.baseName.trim()) {
            new Notice('ファイル名を入力してください');
            return;
        }

        if (this.fileCount <= 0 || this.fileCount > 1000) {
            new Notice('ファイル数は1から1000の間で入力してください');
            return;
        }

        try {
            const result = await this.plugin.createFiles(this.selectedFolder, this.baseName.trim(), this.fileCount);

            if (result.created.length > 0) {
                new Notice(`${result.created.length}個のファイルを作成しました`);
            }

            if (result.failed.length > 0) {
                new Notice(`${result.failed.length}個のファイルの作成に失敗しました`);
                console.warn('作成に失敗したファイル:', result.failed);
            }

            this.close();
        } catch (error) {
            new Notice('ファイル作成中にエラーが発生しました');
            console.error('File creation error:', error);
        }
    }

    async populateFolderDropdown(dropdown: any) {
        try {
            // ルートフォルダを追加
            dropdown.addOption('/', 'ルート (/)');

            // 方法1: getAllLoadedFiles()を使用
            const allFiles = this.app.vault.getAllLoadedFiles();
            console.log('全ファイル数:', allFiles.length);

            let folders = allFiles
                .filter(file => file instanceof TFolder)
                .map(folder => folder as TFolder)
                .sort((a, b) => a.path.localeCompare(b.path));

            console.log('getAllLoadedFiles フォルダ数:', folders.length);

            // 方法2: フォルダが見つからない場合はadapter.listを試す
            if (folders.length === 0) {
                try {
                    const rootContents = await this.app.vault.adapter.list('/');
                    console.log('adapter.list結果:', rootContents);

                    // 再帰的にフォルダを探す
                    const findFoldersRecursively = async (path: string): Promise<TFolder[]> => {
                        const foundFolders: TFolder[] = [];
                        try {
                            const contents = await this.app.vault.adapter.list(path);
                            for (const folderPath of contents.folders) {
                                const folder = this.app.vault.getAbstractFileByPath(folderPath) as TFolder;
                                if (folder instanceof TFolder) {
                                    foundFolders.push(folder);
                                    // 子フォルダも探す
                                    const subFolders = await findFoldersRecursively(folderPath);
                                    foundFolders.push(...subFolders);
                                }
                            }
                        } catch (e) {
                            console.warn(`フォルダ ${path} の読み取りに失敗:`, e);
                        }
                        return foundFolders;
                    };

                    folders = await findFoldersRecursively('/');
                } catch (adapterError) {
                    console.warn('adapter.listでエラー:', adapterError);
                }
            }

            console.log('最終フォルダ数:', folders.length);
            console.log('フォルダリスト:', folders.map(f => f.path));

            folders.forEach(folder => {
                if (folder.path !== '/' && folder.path !== '') {
                    dropdown.addOption(folder.path, folder.path);
                }
            });

            // 現在選択されているフォルダを設定
            const currentPath = this.selectedFolder?.path || '/';
            dropdown.setValue(currentPath);

            dropdown.onChange((value: string) => {
                try {
                    this.selectedFolder = value === '/'
                        ? this.app.vault.getRoot()
                        : this.app.vault.getAbstractFileByPath(value) as TFolder;
                    console.log('フォルダ選択変更:', value, this.selectedFolder);
                } catch (error) {
                    console.error('フォルダ選択エラー:', error);
                    this.selectedFolder = this.app.vault.getRoot();
                }
            });
        } catch (error) {
            console.error('フォルダドロップダウン作成エラー:', error);
            // エラー時はルートフォルダのみを表示
            dropdown.addOption('/', 'ルート (/)');
            dropdown.setValue('/');
            this.selectedFolder = this.app.vault.getRoot();
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class MDMakerSettingTab extends PluginSettingTab {
    plugin: MDMakerPlugin;

    constructor(app: App, plugin: MDMakerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'MD Maker 設定' });

        // デフォルトのベース名設定
        new Setting(containerEl)
            .setName('デフォルトのベース名')
            .setDesc('ファイル作成時のデフォルトのベース名')
            .addText(text => text
                .setPlaceholder('ファイル')
                .setValue(this.plugin.settings.defaultBaseName)
                .onChange(async (value) => {
                    this.plugin.settings.defaultBaseName = value;
                    await this.plugin.saveSettings();
                }));

        // デフォルトのファイル数設定
        new Setting(containerEl)
            .setName('デフォルトのファイル数')
            .setDesc('ファイル作成時のデフォルトのファイル数')
            .addText(text => text
                .setPlaceholder('5')
                .setValue(this.plugin.settings.defaultFileCount.toString())
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0 && num <= 1000) {
                        this.plugin.settings.defaultFileCount = num;
                        await this.plugin.saveSettings();
                    }
                }));

        // ターゲットフォルダ設定
        new Setting(containerEl)
            .setName('デフォルトの作成先フォルダ')
            .setDesc('ファイルを作成するデフォルトフォルダを選択します')
            .addDropdown(async (dropdown) => {
                // フォルダ一覧を取得して追加
                await this.populateFolderDropdown(dropdown);
            });

        // 区切り線
        containerEl.createEl('hr', { cls: 'setting-separator' });

        // クイック作成セクション
        const quickCreateSection = containerEl.createDiv({ cls: 'mdmaker-quick-create' });
        quickCreateSection.createEl('h3', { text: 'クイック作成' });
        quickCreateSection.createEl('p', {
            text: '設定された値で即座にファイルを作成できます。詳細な設定が必要な場合は、リボンアイコンまたはコマンドパレットから「MD Makerを開く」を選択してください。'
        });

        // 作成ボタンの設定
        const buttonDescription = quickCreateSection.createDiv({ cls: 'mdmaker-button-description' });
        buttonDescription.textContent = `「${this.plugin.settings.defaultBaseName}」を${this.plugin.settings.defaultFileCount}個作成します`;

        const buttonContainer = quickCreateSection.createDiv();
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'center';
        buttonContainer.style.marginTop = '10px';

        const createButton = buttonContainer.createEl('button', {
            text: '今すぐ作成',
            cls: 'mdmaker-create-button-settings'
        });
        createButton.addEventListener('click', async () => {
            await this.quickCreateFiles();
        });
    }

    async populateFolderDropdown(dropdown: any) {
        try {
            // ルートフォルダを追加
            dropdown.addOption('/', 'ルート (/)');

            // 既存のフォルダを取得
            const allFiles = this.app.vault.getAllLoadedFiles();
            const folders = allFiles
                .filter(file => file instanceof TFolder)
                .map(folder => folder as TFolder)
                .sort((a, b) => a.path.localeCompare(b.path));

            // フォルダオプションを追加
            folders.forEach(folder => {
                if (folder.path !== '/' && folder.path !== '') {
                    dropdown.addOption(folder.path, folder.path);
                }
            });

            // 現在の設定値を選択
            dropdown.setValue(this.plugin.settings.targetFolder);

            // 変更時の処理
            dropdown.onChange(async (value: string) => {
                this.plugin.settings.targetFolder = value;
                await this.plugin.saveSettings();
                // ボタンの説明を更新
                this.display();
            });

        } catch (error) {
            console.error('フォルダドロップダウンの作成エラー:', error);
            dropdown.addOption('/', 'ルート (/)');
            dropdown.setValue('/');
        }
    }

    async quickCreateFiles() {
        try {
            // ターゲットフォルダを取得
            let targetFolder: TFolder;
            const targetPath = this.plugin.settings.targetFolder;

            if (targetPath === '/') {
                targetFolder = this.app.vault.getRoot();
            } else {
                const folder = this.app.vault.getAbstractFileByPath(targetPath) as TFolder;
                if (folder instanceof TFolder) {
                    targetFolder = folder;
                } else {
                    new Notice('指定されたフォルダが見つかりません。ルートフォルダに作成します。');
                    targetFolder = this.app.vault.getRoot();
                }
            }

            // ファイル作成を実行
            const result = await this.plugin.createFiles(
                targetFolder,
                this.plugin.settings.defaultBaseName,
                this.plugin.settings.defaultFileCount
            );

            // 結果を通知
            if (result.created.length > 0) {
                new Notice(`${result.created.length}個のファイルを作成しました`);
            }

            if (result.failed.length > 0) {
                new Notice(`${result.failed.length}個のファイルの作成に失敗しました`);
                console.warn('作成に失敗したファイル:', result.failed);
            }

        } catch (error) {
            new Notice('ファイル作成中にエラーが発生しました');
            console.error('Quick file creation error:', error);
        }
    }
}
