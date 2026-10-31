<p align="center">
  <img src="src-tauri/icons/128x128.png" width="96" alt="">
</p>

<h1 align="center">Spectia</h1>

<p align="center">
  Красивый и лёгкий лаунчер для Minecraft: Java Edition.<br>
  Шесть тем оформления, сборки с модами, поиск по Modrinth и CurseForge.
</p>

<p align="center"><b>Русский</b> · <a href="#english">English</a></p>

---

## Что уже умеет

- [x] Тёмные и светлые темы: Ночь, Изумруд, Сакура, Рубин, Светлая, Полночь
- [x] Русский и английский язык интерфейса
- [x] Создание сборок: версия Minecraft прямо с серверов Mojang, загрузчик Fabric / Forge / NeoForge / Quilt
- [x] Настройки каждой сборки: память, Java, окно, автовход на сервер и раздел «Для продвинутых»
- [x] Поиск модов, шейдеров, текстурпаков, датапаков и сборок на Modrinth
- [ ] Запуск игры
- [ ] Вход через Microsoft и Ely.by
- [ ] Установка модов в один клик
- [ ] CurseForge (ждём ключ API) и понятное окно для модов, которые можно скачать только с сайта
- [ ] Импорт и экспорт сборок (.mrpack, CurseForge, Prism / MultiMC)
- [ ] Скины

## Как скачать

Готовый установщик для Windows появляется во вкладке **Releases** (или **Actions → последняя сборка → Artifacts**).

## Для разработчиков

Spectia написан на [Tauri 2](https://tauri.app): интерфейс — обычные HTML, CSS и JavaScript в папке `src/`, а вся работа с файлами и интернетом — на Rust в `src-tauri/`. Поэтому лаунчер занимает мало места и почти не ест оперативную память.

```
src/                 интерфейс
  js/app.js          экраны и кнопки
  js/themes.js       темы оформления
  i18n/ru.js, en.js  переводы
src-tauri/           Rust-часть
  src/instances.rs   сборки
  src/settings.rs    настройки
  src/versions.rs    список версий Minecraft
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

Spectia is a beautiful, lightweight launcher for Minecraft: Java Edition, built with Tauri 2. It features six themes, Russian and English UI, instance management with per-instance settings, and Modrinth search. Game launching, Microsoft / Ely.by sign-in, one-click mod installs and CurseForge support are in progress.

Build: install Rust and Node.js, then run `npm install` and `npm run build`.

Licensed under GPL-3.0. Not an official Minecraft product. Not affiliated with Mojang, Microsoft or Prism Launcher.
