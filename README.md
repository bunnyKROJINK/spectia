<p align="center">
  <img src="src-tauri/icons/128x128.png" width="96" alt="">
</p>

<h1 align="center">Spectia</h1>

<p align="center">
  Красивый и лёгкий лаунчер для Minecraft: Java Edition.<br>
  13 тем и свои темы, сборки с модами, поиск по Modrinth, скины, перенос из Prism и 11 языков.
</p>

<p align="center"><a href="https://bunnykrojink.github.io/spectia/"><b>bunnykrojink.github.io/spectia</b></a></p>

<p align="center"><b>Русский</b> · <a href="#english">English</a></p>

---

## Что уже умеет

- [x] 13 тем и редактор своих тем
- [x] 11 языков: русский, English, українська, español, Deutsch, қазақша, 中文, 日本語, português, lietuvių, latviešu
- [x] Создание сборок: версия Minecraft прямо с серверов Mojang, загрузчик Fabric / Forge / NeoForge / Quilt
- [x] Настройки каждой сборки: память, Java, окно, автовход на сервер и раздел «Для продвинутых»
- [x] Поиск модов, шейдеров, текстурпаков, датапаков и сборок на Modrinth
- [x] Запуск ванильного Minecraft: игра и нужная Java скачиваются сами
- [x] Вход через Ely.by (с двухфакторной защитой)
- [x] Автообновление лаунчера
- [x] Fabric, Quilt, Forge и NeoForge (включая старые версии вроде 1.12.2)
- [x] Список модов: включить, выключить, удалить, перетащить в окно
- [x] Редактирование и дублирование сборок, время в игре
- [x] Вход через Microsoft (заработает после одобрения Mojang)
- [x] Установка модов, текстурпаков, шейдеров и сборок с Modrinth в один клик (с зависимостями)
- [x] Обновление модов по кнопке
- [x] Экспорт и импорт сборок в .mrpack
- [x] Миры, скриншоты, своя обложка сборки
- [x] Тематические темы: Космос, Океан, Хэллоуин
- [ ] CurseForge (ждём ключ API) и понятное окно для модов, которые можно скачать только с сайта
- [x] Перенос сборок из Prism Launcher
- [x] Скины: предпросмотр, своя коллекция, плащи
- [x] Датапаки в выбранный мир
- [x] Резервные копии миров после игры
- [x] Избранное, папки, теги, архив и заметки для сборок
- [x] Фон-картинка, акцентный цвет, масштаб, размер текста, скругления, плотность
- [x] Колокольчик и уведомления Windows
- [x] Лицензия через вход Prism Launcher
- [x] Новости Minecraft и модов, музыка игры с плеером
- [x] Подробности о модах, категории, история и зависимости модов, массовые действия
- [x] Spectia Doctor и понятные логи
- [x] Импорт Prism / MultiMC .zip и CurseForge .zip
- [x] Ctrl + K, мини-режим, статус в Discord, график недели
- [x] Дизайн «Верстак», свои темы с градиентами и узорами
- [x] Большой музыкальный плеер, любимые треки, таймер сна, музыка в меню
- [x] Лицо скина, достижения, Spectia Wrapped
- [x] Откат модов, машина времени, профили модов, сравнение сборок, Doctor 2
- [x] Достижения 2.0 с книгой, энциклопедия, статистика, созвездие, аксолотль, живые обои
- [x] Загрузки как в Steam: график скорости, режимы скорости, повторное использование Java
- [x] Знакомство с лаунчером, умная память, сайт
- [ ] CurseForge в каталоге (ждём ключ API)

Что планируется дальше — в [ROADMAP.md](ROADMAP.md).

## Как скачать

Установщик для Windows — на [сайте Spectia](https://bunnykrojink.github.io/spectia/) или во вкладке **Releases**. Дальше Spectia обновляется сама.

## Для разработчиков

Spectia написан на [Tauri 2](https://tauri.app): интерфейс — обычные HTML, CSS и JavaScript в папке `src/`, а вся работа с файлами и интернетом — на Rust в `src-tauri/`. Поэтому лаунчер занимает мало места и почти не ест оперативную память.

```
src/                 интерфейс
  js/app.js          экраны и кнопки
  js/themes.js       темы оформления
  js/appearance.js   свои темы, фон, масштаб
  js/skinview.js     плоский предпросмотр скина
  js/sound.js        колокольчик
  js/doctor.js       Spectia Doctor: разбор логов
  js/achievements.js достижения и Spectia Wrapped
  js/pet.js          аксолотль и аквариум
  js/downloads.js    окно загрузок
  js/tour.js         знакомство с лаунчером
  i18n/*.js          переводы (11 языков)
docs/                сайт на GitHub Pages
src-tauri/           Rust-часть
  src/instances.rs   сборки
  src/settings.rs    настройки
  src/versions.rs    список версий Minecraft
  src/accounts.rs    аккаунты Ely.by и Microsoft
  src/microsoft.rs   вход через Microsoft (окно браузера)
  src/skins.rs       скины и плащи
  src/prism.rs       перенос из Prism Launcher
  src/stats.rs       статистика игровых сессий (только на компьютере)
  src/history.rs     история изменений модов
  src/music.rs       музыка из файлов игры
  src/news.rs        новости Minecraft
  src/discord.rs     статус в Discord
  src/curseforge.rs  импорт сборок CurseForge
  src/window.rs      мини-режим
  src/toolbox.rs     машина времени, профили модов, проверка перед запуском
  src/game.rs        файлы игры: библиотеки, ассеты, аргументы
  src/java.rs        Java от Mojang
  src/launch.rs      запуск игры
  src/loaders.rs     Fabric, Quilt, Forge, NeoForge
  src/mods.rs        список модов сборки
  src/modrinth.rs    установка с Modrinth и обновления
  src/mrpack.rs      экспорт и импорт .mrpack
  src/content.rs     миры, датапаки, копии миров, скриншоты, обложки
  src/updater.rs     автообновление
```

Понадобятся [Rust](https://rustup.rs) и [Node.js](https://nodejs.org). Затем:

```bash
npm install
npm run dev     # запустить лаунчер в режиме разработки
npm run build   # собрать установщик
```

Посмотреть только дизайн можно и без Rust: откройте папку `src` любым простым веб-сервером (`npm run preview`).

### Как добавить язык

Скопируйте `src/i18n/ru.js`, переведите строки и добавьте язык одной строчкой в `src/js/i18n.js`.

### Как добавить тему

Скопируйте любую тему в `src/js/themes.js`, поменяйте цвета и добавьте её в `THEME_ORDER` и в переводы (`theme.<id>`).

## Лицензия

Spectia распространяется под лицензией **GNU GPL v3.0**: код открыт, его можно изучать, менять и распространять на тех же условиях.

Spectia не является официальным продуктом Minecraft и не связан с Mojang, Microsoft или Prism Launcher. «Minecraft» — товарный знак Mojang AB.

---

<a id="english"></a>

## English

Spectia is a beautiful, lightweight launcher for Minecraft: Java Edition, built with Tauri 2. Website: https://bunnykrojink.github.io/spectia/. 13 themes plus a custom theme editor, background pictures and accent colors; the UI in 11 languages; instances with favorites, folders, tags, archive and notes; Modrinth search and one-click installs (mods, shaders, resource packs, datapacks into a chosen world, modpacks); Ely.by sign-in or a licensed account through Prism Launcher; Spectia Doctor, a time machine and mod history with undo; a Steam-like downloads panel; skin preview, collection and capes; moving instances from Prism Launcher; world backups; vanilla, Fabric, Quilt, Forge and NeoForge with automatic Java; .mrpack export/import and self-updates. See ROADMAP.md for what's next.

Build: install Rust and Node.js, then run `npm install` and `npm run build`. For Microsoft sign-in, set the `SPECTIA_MS_CLIENT_ID` environment variable to your Azure app's client ID at build time.

Licensed under GPL-3.0. Not an official Minecraft product. Not affiliated with Mojang, Microsoft or Prism Launcher.
