// Мостик между интерфейсом и Rust-частью лаунчера.
//
// Внутри настоящего приложения работает window.__TAURI__.
// Если открыть index.html просто в браузере (для быстрой проверки дизайна),
// вместо Rust подставляется «заглушка», которая хранит данные в localStorage.

const TAURI = window.__TAURI__;
export const inApp = !!TAURI;

export const call = inApp ? (cmd, args) => TAURI.core.invoke(cmd, args) : mockInvoke;

export const api = {
  getSettings: () => call('get_settings'),
  saveSettings: (settings) => call('save_settings', { settings }),
  getVersions: () => call('get_versions'),
  listInstances: () => call('list_instances'),
  createInstance: (data) => call('create_instance', { data }),
  updateInstance: (instance) => call('update_instance', { instance }),
  deleteInstance: (id) => call('delete_instance', { id }),
  openInstanceFolder: (id) => call('open_instance_folder', { id }),
};

export const win = {
  minimize: () => inApp && TAURI.window.getCurrentWindow().minimize(),
  toggleMaximize: () => inApp && TAURI.window.getCurrentWindow().toggleMaximize(),
  close: () => (inApp ? TAURI.window.getCurrentWindow().close() : null),
};

/** Открывает ссылку в браузере по умолчанию. */
export function openUrl(url) {
  if (inApp && TAURI.opener) return TAURI.opener.openUrl(url);
  window.open(url, '_blank', 'noopener');
}

// ---------- Заглушка для браузера ----------

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem('spectia:' + key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('spectia:' + key, JSON.stringify(value)); } catch { /* ничего страшного */ }
  },
};

const DEFAULT_SETTINGS = {
  theme: 'sakura', language: 'ru', reduceMotion: false, hideOnLaunch: true,
  checkUpdates: true, autoJava: true, curseforgeKey: '',
};

async function mockInvoke(cmd, args = {}) {
  await new Promise((r) => setTimeout(r, 120));
  switch (cmd) {
    case 'get_settings': return { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
    case 'save_settings': store.set('settings', args.settings); return null;
    case 'get_versions': return {
      latest: { release: '26.3', snapshot: '26.4-snapshot-2' },
      versions: [
        { id: '26.4-snapshot-2', kind: 'snapshot' }, { id: '26.3', kind: 'release' },
        { id: '26.2', kind: 'release' }, { id: '26.1', kind: 'release' },
        { id: '1.21.1', kind: 'release' }, { id: '1.20.1', kind: 'release' },
        { id: '1.16.5', kind: 'release' }, { id: '1.12.2', kind: 'release' },
      ],
    };
    case 'list_instances': return store.get('instances', []);
    case 'create_instance': {
      const list = store.get('instances', []);
      const inst = {
        id: 'demo-' + Date.now(), name: args.data.name || 'Новая сборка', gameVersion: args.data.gameVersion,
        loader: args.data.loader, tint: args.data.tint, memoryGb: 4, javaPath: '', windowWidth: 1280,
        windowHeight: 720, fullscreen: false, autoJoinServer: '', jvmArgs: '', preLaunchCommand: '',
        postExitCommand: '', wrapperCommand: '', envVars: '', showConsole: false, createdAt: Date.now(),
      };
      store.set('instances', [inst, ...list]);
      return inst;
    }
    case 'update_instance': {
      const list = store.get('instances', []).map((i) => (i.id === args.instance.id ? args.instance : i));
      store.set('instances', list);
      return args.instance;
    }
    case 'delete_instance':
      store.set('instances', store.get('instances', []).filter((i) => i.id !== args.id));
      return null;
    case 'open_instance_folder': return null;
    default: throw new Error('unknown command ' + cmd);
  }
}
