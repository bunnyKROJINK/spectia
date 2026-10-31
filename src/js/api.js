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

  installProject: (id, projectId, world) => call('install_project', { id, projectId, world: world || null }),
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
  listDatapacks: (id, world) => call('list_datapacks', { id, world }),
  deleteDatapack: (id, world, file) => call('delete_datapack', { id, world, file }),
  listBackups: (id) => call('list_backups', { id }),
  makeBackup: (id, world) => call('make_backup', { id, world }),
  deleteBackup: (id, file) => call('delete_backup', { id, file }),
  restoreBackup: (id, file) => call('restore_backup', { id, file }),
  pickBackground: () => call('pick_background'),
  exportTheme: (name, json) => call('export_theme', { name, json }),
  notify: (title, body) => call('notify', { title, body }),
  statsSummary: () => call('stats_summary'),
  statsSessions: () => call('stats_sessions'),
  findPrismAccounts: () => call('find_prism_accounts'),
  addPrismAccount: (id) => call('add_prism_account', { id }),
  modHistory: (id) => call('mod_history', { id }),
  removeProject: (id, projectId) => call('remove_project', { id, projectId }),
  checkDependencies: (id) => call('check_dependencies', { id }),
  listMusic: () => call('list_music'),
  minecraftNews: () => call('minecraft_news'),
  patchNoteBody: (contentPath) => call('patch_note_body', { contentPath }),
  gameLogs: (id) => call('game_logs', { id }),
  setMini: (on) => call('set_mini', { on }),
  importPack: (path) => call('import_pack', { path: path || null }),
  undoEvent: (id, time, restore) => call('undo_event', { id, time, restore }),
  listSnapshots: (id) => call('list_snapshots', { id }),
  makeSnapshot: (id, label, auto) => call('make_snapshot', { id, label, auto: !!auto }),
  deleteSnapshot: (id, file) => call('delete_snapshot', { id, file }),
  restoreSnapshot: (id, file, beforeLabel) => call('restore_snapshot', { id, file, beforeLabel }),
  listProfiles: (id) => call('list_profiles', { id }),
  saveProfile: (id, name) => call('save_profile', { id, name }),
  deleteProfile: (id, name) => call('delete_profile', { id, name }),
  applyProfile: (id, name) => call('apply_profile', { id, name }),
  precheck: (id) => call('precheck', { id }),

  findPrism: () => call('find_prism_instances'),
  importPrism: (paths) => call('import_prism', { paths }),

  accountSkin: (id) => call('account_skin', { id }),
  listSkins: () => call('list_skins'),
  importSkin: () => call('import_skin'),
  saveSkinData: (dataUrlStr, name, slim) => call('save_skin_data', { dataUrlStr, name, slim }),
  updateSkin: (file, name, slim) => call('update_skin', { file, name, slim }),
  deleteSkin: (file) => call('delete_skin', { file }),
  applySkin: (account, file) => call('apply_skin', { account, file }),
  setCape: (account, cape) => call('set_cape', { account, cape: cape || null }),

  listMods: (id) => call('list_mods', { id }),
  toggleMod: (id, file) => call('toggle_mod', { id, file }),
  deleteMod: (id, file) => call('delete_mod', { id, file }),
  addMods: (id, paths) => call('add_mods', { id, paths }),

  listAccounts: () => call('list_accounts'),
  addElyAccount: (username, password, totp) => call('add_ely_account', { username, password, totp: totp || null }),
  setActiveAccount: (id) => call('set_active_account', { id }),
  removeAccount: (id) => call('remove_account', { id }),
  microsoftReady: () => call('microsoft_ready'),
  addMicrosoftAccount: () => call('add_microsoft_account'),

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
let mockNetBytes = 0;
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
  checkUpdates: true, autoJava: true, curseforgeKey: '', afterGameClose: 'restore',
  defaultMemoryGb: 4, defaultJvmArgs: '', defaultWindowWidth: 1280, defaultWindowHeight: 720,
  defaultFullscreen: false, defaultBackupWorlds: false, backupKeep: 5,
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
        favorite: false, archived: false, folder: '', tags: [], notes: '', backupWorlds: false,
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

    case 'list_datapacks': return store.get(`dp-${args.id}-${args.world}`, [{ file: 'terralith.zip', size: 2_400_000 }]);
    case 'delete_datapack': store.set(`dp-${args.id}-${args.world}`, (await mockInvoke('list_datapacks', args)).filter((d) => d.file !== args.file)); return null;
    case 'list_backups': return store.get('bk-' + args.id, []);
    case 'make_backup': {
      await sleep(400);
      const file = `${args.world}__${Math.floor(Date.now() / 1000)}.zip`;
      store.set('bk-' + args.id, [{ file, world: args.world, time: Date.now() / 1000, size: 12_000_000 }, ...store.get('bk-' + args.id, [])]);
      return file;
    }
    case 'delete_backup': store.set('bk-' + args.id, store.get('bk-' + args.id, []).filter((b) => b.file !== args.file)); return null;
    case 'restore_backup': await sleep(400); return args.file.split('__')[0];
    case 'pick_background': return null;
    case 'export_theme': return 'C:\\Users\\Мари\\Desktop\\' + args.name + '.spectia-theme.json';
    case 'notify': return null;
    case 'stats_summary': return { sessions: 0, totalSeconds: 0 };
    case 'undo_event': await sleep(200); return 'iris-1.9.jar';
    case 'list_snapshots': return store.get('snap-' + args.id, []);
    case 'make_snapshot': {
      await sleep(500);
      const snap = { file: 'snap-' + Date.now() + '.zip', label: args.label, time: Date.now() / 1000, size: 48_000_000, auto: args.auto };
      store.set('snap-' + args.id, [snap, ...store.get('snap-' + args.id, [])]);
      return snap;
    }
    case 'delete_snapshot': store.set('snap-' + args.id, store.get('snap-' + args.id, []).filter((x) => x.file !== args.file)); return null;
    case 'restore_snapshot': await sleep(600); return null;
    case 'list_profiles': return store.get('prof-' + args.id, []);
    case 'save_profile': {
      const list = store.get('prof-' + args.id, []).filter((x) => x.name !== args.name).concat({ name: args.name, enabled: [], disabled: [] });
      store.set('prof-' + args.id, list); return list;
    }
    case 'delete_profile': { const list = store.get('prof-' + args.id, []).filter((x) => x.name !== args.name); store.set('prof-' + args.id, list); return list; }
    case 'apply_profile': await sleep(200); return 2;
    case 'precheck': return new URLSearchParams(location.search).has('precheck') ? [{ kind: 'wrongLoader', name: 'Create', detail: 'forge' }, { kind: 'memory', name: '140', detail: '6' }] : [];
    case 'stats_sessions': {
      const now = Date.now() / 1000; const day = 86400;
      return [
        { instance: 'a1', name: 'Уютная ферма', gameVersion: '1.20.1', loader: 'forge', start: now - day * 6, seconds: 5400 },
        { instance: 'a1', name: 'Уютная ферма', gameVersion: '1.20.1', loader: 'forge', start: now - day * 4, seconds: 2700 },
        { instance: 'a2', name: 'Страшилки', gameVersion: '1.20.1', loader: 'forge', start: now - day * 2, seconds: 3600 },
        { instance: 'a1', name: 'Уютная ферма', gameVersion: '1.20.1', loader: 'forge', start: now - day * 1, seconds: 7200 },
        { instance: 'a4', name: 'Ванилла', gameVersion: '26.3', loader: 'vanilla', start: now - 3600, seconds: 1800 },
      ];
    }
    case 'find_prism_accounts': await sleep(200); return [
      { id: 'prism-mari', name: 'MariPlays', fresh: true, expiresAt: Date.now() / 1000 + 50000 },
      { id: 'prism-old', name: 'OldNick', fresh: false, expiresAt: Date.now() / 1000 - 5000 },
    ];
    case 'add_prism_account': {
      const s = store.get('accounts', { active: '', accounts: [] });
      const name = args.id === 'prism-mari' ? 'MariPlays' : 'OldNick';
      s.accounts = s.accounts.filter((a) => a.id !== args.id).concat({ id: args.id, name, kind: 'prism' });
      s.active = args.id; store.set('accounts', s);
      return accountInfo();
    }
    case 'mod_history': return [
      { time: Date.now() / 1000 - 600, action: 'installed', name: 'Iris Shaders', detail: 'mods/iris-1.9.jar' },
      { time: Date.now() / 1000 - 3600 * 5, action: 'updated', name: 'Sodium', detail: '0.6.9 → 0.7.0' },
      { time: Date.now() / 1000 - 86400 * 2, action: 'disabled', name: 'Iris', detail: 'iris-1.9.jar.disabled' },
      { time: Date.now() / 1000 - 86400 * 3, action: 'appeared', name: 'farmersdelight', detail: 'farmersdelight.jar' },
    ];
    case 'remove_project': await sleep(200); return ['Мод'];
    case 'check_dependencies': await sleep(400); return [
      { kind: 'missing', projectId: 'P7dR8mSH', title: 'Fabric API', neededBy: ['Sodium', 'Iris'] },
    ];
    case 'list_music': return [
      { key: 'minecraft/sounds/music/menu/menu2.ogg', title: 'Moog City 2', group: 'menu', path: '' },
      { key: 'minecraft/sounds/music/game/calm1.ogg', title: 'Minecraft', group: 'game', path: '' },
      { key: 'minecraft/sounds/music/game/calm3.ogg', title: 'Sweden', group: 'game', path: '' },
      { key: 'minecraft/sounds/music/game/piano2.ogg', title: 'Wet Hands', group: 'game', path: '' },
      { key: 'minecraft/sounds/music/creative/creative4.ogg', title: 'Aria Math', group: 'creative', path: '' },
      { key: 'minecraft/sounds/music/game/nether/nether4.ogg', title: 'Ballad of the Cats', group: 'nether', path: '' },
      { key: 'minecraft/sounds/records/pigstep.ogg', title: 'Pigstep', group: 'records', path: '' },
    ];
    case 'minecraft_news': await sleep(300); return [
      { id: 'n1', kind: 'news', title: 'Осеннее обновление уже здесь', text: 'Новые мобы, блоки и уютные леса.', date: '2026-10-28', image: '', url: 'https://www.minecraft.net', contentPath: '', version: '' },
      { id: 'p1', kind: 'release', title: 'Minecraft Java Edition 26.3', text: 'Исправления и улучшения.', date: '2026-10-20', image: '', url: '', contentPath: 'javaPatchNotes/26.3.json', version: '26.3' },
      { id: 'p2', kind: 'snapshot', title: 'Снапшот 26.4-snapshot-2', text: 'Пробуем новые штуки.', date: '2026-10-29', image: '', url: '', contentPath: 'javaPatchNotes/s2.json', version: '26.4-snapshot-2' },
    ];
    case 'patch_note_body': return '<p>Демо-текст обновления.</p><ul><li>Исправлены ошибки</li></ul>';
    case 'game_logs': return {
      launcher: '[12:00:01] [main/INFO]: Loading Minecraft 1.20.1\n[12:00:03] [main/WARN]: Something odd\n[12:00:05] [main/ERROR]: Mod \'Sodium\' (sodium) 0.5.8 requires version 0.15 or later of fabricloader\njava.lang.RuntimeException: demo\n\tat net.minecraft.Main.main(Main.java:1)',
      latest: '', crash: '', crashName: '', crashTime: 0,
    };
    case 'set_mini': return null;
    case 'import_pack': return null;
    case 'find_prism_instances': await sleep(300); return [
      { path: 'C:/Prism/instances/Cozy', name: 'Уютная ферма', gameVersion: '1.20.1', loader: 'forge', loaderVersion: '1.20.1-47.4.28', size: 820_000_000, source: 'Prism Launcher' },
      { path: 'C:/Prism/instances/Horror', name: 'Страшилки', gameVersion: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.200', size: 410_000_000, source: 'Prism Launcher' },
      { path: 'C:/Prism/instances/Vanilla', name: 'Просто ванилла', gameVersion: '26.3', loader: 'vanilla', loaderVersion: '', size: 90_000_000, source: 'Prism Launcher' },
    ];
    case 'import_prism': {
      for (let n = 0; n < args.paths.length; n++) {
        emit('prism-progress', { done: n, total: args.paths.length, name: args.paths[n] });
        await sleep(500);
        await mockInvoke('create_instance', { data: { name: args.paths[n].split('/').pop(), gameVersion: '1.20.1', loader: 'forge', tint: n % 6 } });
      }
      emit('prism-progress', { done: args.paths.length, total: args.paths.length });
      return args.paths.length;
    }
    case 'microsoft_ready': return new URLSearchParams(location.search).has('ms');
    case 'add_microsoft_account': {
      await sleep(1200);
      const s = store.get('accounts', { active: '', accounts: [] });
      s.accounts = s.accounts.filter((a) => a.id !== 'ms-demo').concat({ id: 'ms-demo', name: 'MariPlays', kind: 'microsoft' });
      s.active = 'ms-demo';
      store.set('accounts', s);
      return accountInfo();
    }
    case 'account_skin': return { image: '', slim: false, editable: args.id.startsWith('ms'), capes: args.id.startsWith('ms') ? [{ id: 'c1', alias: 'Migrator', image: '', active: false }] : [] };
    case 'list_skins': return store.get('skins', []);
    case 'import_skin': return null;
    case 'save_skin_data': {
      const list = [{ file: 'skin-' + Date.now() + '.png', name: args.name, slim: args.slim, image: args.dataUrlStr }, ...store.get('skins', [])];
      store.set('skins', list); return list;
    }
    case 'update_skin': {
      const list = store.get('skins', []).map((k) => (k.file === args.file ? { ...k, name: args.name, slim: args.slim } : k));
      store.set('skins', list); return list;
    }
    case 'delete_skin': { const list = store.get('skins', []).filter((k) => k.file !== args.file); store.set('skins', list); return list; }
    case 'apply_skin': case 'set_cape': await sleep(500); return null;

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
      // Изображаем скачивание: скорость «гуляет», как в жизни
      let bytes = mockNetBytes; let active = 8;
      const tick = setInterval(() => {
        const sp = active ? Math.round((6 + Math.random() * 9) * 1024 * 1024) : 0;
        bytes += sp / 2; mockNetBytes = bytes;
        emit('net-stats', { bytes, speed: sp, active });
      }, 500);
      for (const [stage, total] of [['account', 1], ['version', 1], ['java', 40], ['libraries', 60], ['assets', 120], ['starting', 1]]) {
        for (let n = 0; n <= total; n += Math.ceil(total / 12)) {
          emit('launch-progress', { instanceId: args.id, stage, done: Math.min(n, total), total });
          await sleep(stage === 'account' || stage === 'version' ? 60 : 260);
        }
      }
      active = 0;
      setTimeout(() => clearInterval(tick), 1600);
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
