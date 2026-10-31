// Мостик между интерфейсом и Rust-частью лаунчера.
//
// Внутри настоящего приложения работает window.__TAURI__.
// Если открыть index.html просто в браузере (для быстрой проверки дизайна),
// вместо Rust подставляется «заглушка», которая хранит данные в localStorage
// и понарошку изображает скачивание и запуск игры.

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
  openInstanceFolder: (id, sub) => call('open_instance_folder', { id, sub: sub || null }),
  duplicateInstance: (id, name) => call('duplicate_instance', { id, name: name || '' }),
  getLoaderVersions: (loader, gameVersion) => call('get_loader_versions', { loader, gameVersion }),

  installProject: (id, projectId) => call('install_project', { id, projectId }),
  installedProjects: (id) => call('installed_projects', { id }),
  checkModUpdates: (id) => call('check_mod_updates', { id }),
  applyModUpdates: (id, updates) => call('apply_mod_updates', { id, updates }),
  exportMrpack: (id) => call('export_mrpack', { id }),
  importMrpack: (path) => call('import_mrpack', { path: path || null }),
  installModpack: (projectId) => call('install_modpack', { projectId }),

  dataDir: () => call('data_dir'),
  listWorlds: (id) => call('list_worlds', { id }),
  copyWorld: (id, folder, suffix) => call('copy_world', { id, folder, suffix }),
  deleteWorld: (id, folder) => call('delete_world', { id, folder }),
  openWorldFolder: (id, folder) => call('open_world_folder', { id, folder }),
  listScreenshots: (id) => call('list_screenshots', { id }),
  openScreenshot: (id, file) => call('open_screenshot', { id, file }),
  deleteScreenshot: (id, file) => call('delete_screenshot', { id, file }),
  pickCover: (id) => call('pick_cover', { id }),
  coverFromScreenshot: (id, file) => call('cover_from_screenshot', { id, file }),
  clearCover: (id) => call('clear_cover', { id }),

  listMods: (id) => call('list_mods', { id }),
  toggleMod: (id, file) => call('toggle_mod', { id, file }),
  deleteMod: (id, file) => call('delete_mod', { id, file }),
  addMods: (id, paths) => call('add_mods', { id, paths }),

  listAccounts: () => call('list_accounts'),
  addElyAccount: (username, password, totp) => call('add_ely_account', { username, password, totp: totp || null }),
  setActiveAccount: (id) => call('set_active_account', { id }),
  removeAccount: (id) => call('remove_account', { id }),

  launch: (id) => call('launch_instance', { id }),
  stop: (id) => call('stop_instance', { id }),
  runningInstances: () => call('running_instances'),
  readLaunchLog: (id) => call('read_launch_log', { id }),

  checkUpdate: () => call('check_update'),
  installUpdate: () => call('install_update'),
};

/** Подписка на события от Rust (прогресс скачивания, игра запущена/закрыта…). */
export function on(event, handler) {
  if (inApp) return TAURI.event.listen(event, (e) => handler(e.payload));
  (mockListeners[event] ||= []).push(handler);
}

/** Файлы, перетащенные в окно лаунчера (только в настоящем приложении). */
export function onFileDrop(handler) {
  if (!inApp) return;
  TAURI.webview.getCurrentWebview().onDragDropEvent((e) => handler(e.payload));
}

export const win = {
  minimize: () => inApp && TAURI.window.getCurrentWindow().minimize(),
  toggleMaximize: () => inApp && TAURI.window.getCurrentWindow().toggleMaximize(),
  close: () => (inApp ? TAURI.window.getCurrentWindow().close() : null),
};

/** Превращает путь к файлу на диске в адрес, который можно показать в <img>. */
export function fileUrl(path) {
  if (!path) return '';
  return inApp ? TAURI.core.convertFileSrc(path) : '';
}

/** Открывает ссылку в браузере по умолчанию. */
export function openUrl(url) {
  if (inApp && TAURI.opener) return TAURI.opener.openUrl(url);
  window.open(url, '_blank', 'noopener');
}

// ---------- Заглушка для браузера ----------

const mockListeners = {};
const emit = (event, payload) => (mockListeners[event] || []).forEach((h) => h(payload));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const mockRunning = new Set();

function accountInfo() {
  const s = store.get('accounts', { active: '', accounts: [] });
  return s.accounts.map((a) => ({ ...a, active: a.id === s.active }));
}

async function mockInvoke(cmd, args = {}) {
  await sleep(120);
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
    case 'duplicate_instance': {
      const list = store.get('instances', []);
      const src = list.find((i) => i.id === args.id);
      const copy = { ...src, id: 'demo-' + Date.now(), name: args.name || src.name + ' (копия)', playTimeSecs: 0, lastPlayed: 0, createdAt: Date.now() };
      store.set('instances', [copy, ...list]);
      return copy;
    }
    case 'get_loader_versions':
      await sleep(300);
      if (args.loader === 'fabric') return [{ version: '0.19.5', stable: true, recommended: true }, { version: '0.19.4', stable: true, recommended: false }, { version: '0.20.0-beta.1', stable: false, recommended: false }];
      if (args.loader === 'neoforge') return [{ version: '26.3.0.45-beta', stable: false, recommended: true }, { version: '26.3.0.44-beta', stable: false, recommended: false }];
      if (args.loader === 'forge') return [{ version: args.gameVersion + '-66.0.9', stable: true, recommended: true }];
      if (args.loader === 'quilt') return [{ version: '0.29.1', stable: true, recommended: true }];
      return [];
    case 'list_mods': return store.get('mods-' + args.id, [
      { file: 'sodium-fabric-0.7.jar', name: 'Sodium', version: '0.7.0', description: 'Ускоряет отрисовку', authors: 'jellysquid3', enabled: true, size: 1200000 },
      { file: 'iris-1.9.jar.disabled', name: 'Iris', version: '1.9.0', description: 'Шейдеры', authors: 'coderbot', enabled: false, size: 2400000 },
      { file: 'farmersdelight.jar', name: "Farmer's Delight", version: '1.2.6', description: '', authors: 'vectorwing', enabled: true, size: 3100000 },
    ]);
    case 'toggle_mod': {
      const list = await mockInvoke('list_mods', { id: args.id });
      const m = list.find((x) => x.file === args.file);
      m.enabled = !m.enabled; m.file = m.enabled ? m.file.replace(/\.disabled$/, '') : m.file + '.disabled';
      store.set('mods-' + args.id, list);
      return m.file;
    }
    case 'delete_mod': {
      const list = (await mockInvoke('list_mods', { id: args.id })).filter((x) => x.file !== args.file);
      store.set('mods-' + args.id, list);
      return null;
    }
    case 'add_mods': return 0;
    case 'install_project': await sleep(700); return { installed: args.projectId === 'iris' ? ['Iris Shaders', 'Sodium'] : ['Мод'] };
    case 'installed_projects': return [];
    case 'check_mod_updates': await sleep(600); return [
      { file: 'sodium-fabric-0.7.jar', name: 'Sodium', current: '0.7.0', latest: '0.7.2', url: '', filename: 'sodium-0.7.2.jar', sha1: '', projectId: 'AANobbMI', versionId: 'x' },
      { file: 'farmersdelight.jar', name: "Farmer's Delight", current: '1.2.6', latest: '1.2.7', url: '', filename: 'fd-1.2.7.jar', sha1: '', projectId: 'R2OftAxM', versionId: 'y' },
    ];
    case 'apply_mod_updates': await sleep(500); return args.updates.length;
    case 'export_mrpack': return 'C:\\Users\\Мари\\Desktop\\сборка.mrpack';
    case 'import_mrpack': return null;
    case 'install_modpack': return mockInvoke('create_instance', { data: { name: 'Готовая сборка', gameVersion: '26.3', loader: 'fabric', tint: 3 } });
    case 'data_dir': return '';
    case 'list_worlds': return [
      { folder: 'Вечная зима', lastPlayed: Date.now() / 1000 - 3600, size: 48_000_000, icon: '' },
      { folder: 'Тест', lastPlayed: Date.now() / 1000 - 86400 * 3, size: 6_500_000, icon: '' },
    ];
    case 'copy_world': return args.folder + ' (' + args.suffix + ')';
    case 'delete_world': case 'open_world_folder': case 'open_screenshot': case 'delete_screenshot': return null;
    case 'list_screenshots': return [];
    case 'pick_cover': case 'cover_from_screenshot': case 'clear_cover': return store.get('instances', []).find((i) => i.id === args.id);

    case 'list_accounts': return accountInfo();
    case 'add_ely_account': {
      await sleep(500);
      if (args.password === 'wrong') throw 'ELY_BAD_CREDENTIALS';
      if (args.password === '2fa' && !args.totp) throw 'ELY_2FA';
      const s = store.get('accounts', { active: '', accounts: [] });
      const id = 'ely-' + args.username.toLowerCase();
      s.accounts = s.accounts.filter((a) => a.id !== id).concat({ id, name: args.username, kind: 'ely' });
      s.active = id;
      store.set('accounts', s);
      return accountInfo();
    }
    case 'set_active_account': {
      const s = store.get('accounts', { active: '', accounts: [] });
      s.active = args.id; store.set('accounts', s);
      return accountInfo();
    }
    case 'remove_account': {
      const s = store.get('accounts', { active: '', accounts: [] });
      s.accounts = s.accounts.filter((a) => a.id !== args.id);
      if (s.active === args.id) s.active = s.accounts[0]?.id || '';
      store.set('accounts', s);
      return accountInfo();
    }

    case 'launch_instance': {
      const inst = store.get('instances', []).find((i) => i.id === args.id);
      if (!accountInfo().some((a) => a.active)) throw 'NO_ACCOUNT';
      if (inst?.loader !== 'vanilla') throw 'LOADER_NOT_YET';
      for (const [stage, total] of [['account', 1], ['version', 1], ['java', 40], ['libraries', 60], ['assets', 120], ['starting', 1]]) {
        for (let n = 0; n <= total; n += Math.ceil(total / 6)) {
          emit('launch-progress', { instanceId: args.id, stage, done: Math.min(n, total), total });
          await sleep(90);
        }
      }
      mockRunning.add(args.id);
      emit('game-state', { instanceId: args.id, running: true });
      return null;
    }
    case 'stop_instance':
      mockRunning.delete(args.id);
      emit('game-state', { instanceId: args.id, running: false, exitCode: 1, log: '[Render thread/ERROR]: пример лога ошибки\njava.lang.RuntimeException: демо', seconds: 3 });
      return null;
    case 'running_instances': return [...mockRunning];
    case 'read_launch_log': return 'демо-лог';
    case 'check_update':
      return new URLSearchParams(location.search).has('update')
        ? { version: '0.3.0', currentVersion: '0.2.0', notes: '## Что нового\n\n- **Fabric, Forge и NeoForge**\n- Установка модов в один клик', date: null }
        : null;
    case 'install_update':
      for (let d = 0; d <= 100; d += 10) { emit('update-progress', { downloaded: d, total: 100 }); await sleep(120); }
      return null;
    default: throw new Error('unknown command ' + cmd);
  }
}
