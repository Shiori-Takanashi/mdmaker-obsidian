declare module 'obsidian' {
  class Component {
    load(): void;
    unload(): void;
  }
  export class App {
    vault: Vault;
  }
  export class Vault {
    adapter: any;
    getRoot(): TFolder;
    getAllLoadedFiles(): (TFile | TFolder)[];
    getAbstractFileByPath(path: string): TFile | TFolder | null;
    create(path: string, data: string): Promise<TFile>;
  }
  export class Plugin extends Component {
    app: App;
    addRibbonIcon(id: string, title: string, callback: (evt: MouseEvent) => void): HTMLElement;
    addCommand(options: any): void;
    addSettingTab(tab: PluginSettingTab): void;
    loadData(): Promise<any>;
    saveData(data: any): Promise<void>;
  }
  export class PluginSettingTab {
    app: App;
    containerEl: HTMLElement;
    constructor(app: App, plugin: Plugin);
  }
  export class Setting {
    constructor(containerEl: HTMLElement);
    setName(name: string): this;
    setDesc(desc: string): this;
    addDropdown(cb: (dropdown: DropdownComponent) => void): this;
    addText(cb: (text: TextComponent) => void): this;
  }
  export class DropdownComponent {
    addOption(value: string, display: string): this;
    setValue(value: string): this;
    onChange(callback: (value: string) => void): this;
  }
  export class TextComponent {
    setPlaceholder(placeholder: string): this;
    setValue(value: string): this;
    onChange(callback: (value: string) => void): this;
  }
  export class Modal {
    app: App;
    containerEl: HTMLElement;
    contentEl: HTMLElement;
    constructor(app: App);
    open(): void;
    close(): void;
  }
  export class Notice {
    constructor(message: string, timeout?: number);
  }
  export class TFile { path: string; }
  export class TFolder { path: string; }
}
interface HTMLElement {
  empty(): void;
  createEl(tag: string, options?: any): HTMLElement;
  createDiv(options?: any): HTMLDivElement;
}
