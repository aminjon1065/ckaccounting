# Development Build — локальный запуск и тест Phase 0

Этот гайд: как собрать **dev build** локально (с `expo-dev-client`, не Expo Go), запустить на симуляторе и физическом устройстве, и проверить улучшения Phase 0.

> **Важно:** Expo Go нам **не подходит** — у нас нативные модули (`expo-sqlite`, `expo-camera`, `expo-local-authentication`, `expo-background-fetch`). Только dev build.

---

## 0. Предусловия (уже выполнены, проверь сам)

- ✅ Node 22, Expo CLI 55.0.29
- ✅ Hermes включён (`ios/Podfile.properties.json`, `android/gradle.properties`)
- ✅ New Architecture включена
- ✅ `expo-dev-client` в зависимостях
- ✅ Папки `ios/` и `android/` сгенерированы (`prebuild` не нужен)
- ✅ Xcode 26.4 + iOS симуляторы
- ✅ Android SDK по пути `~/Library/Android/sdk`
- ✅ `EXPO_PUBLIC_API_URL=http://192.168.100.247:8000` в `.env` (твой локальный Laravel)
- ✅ TypeScript проходит (`npx tsc --noEmit`)

---

## 1. Сеть — самое частое место поломки

Бэкенд крутится у тебя на `192.168.100.247:8000`. Это **LAN IP**.

| Где запускаешь | Что подставить в `.env` |
|---|---|
| iOS Simulator на этой же машине | `http://localhost:8000` или `http://127.0.0.1:8000` |
| Android Simulator на этой же машине | `http://10.0.2.2:8000` (специальный alias эмулятора → host) |
| iPhone (физика) на той же WiFi | `http://192.168.100.247:8000` (как сейчас) |
| Android phone (физика) на той же WiFi | `http://192.168.100.247:8000` |

**Условие:** Laravel должен слушать **внешний интерфейс**, не только 127.0.0.1. Запускай так:
```bash
cd /Users/aminjon/Desktop/ckapp/acc-backend
php artisan serve --host=0.0.0.0 --port=8000
```

Проверь с телефона: открой в Safari/Chrome `http://192.168.100.247:8000` — должна отдаться страница Laravel или JSON.

---

## 2. Установка зависимостей (один раз, или после `git pull`)

```bash
cd /Users/aminjon/Desktop/ckapp/ckaccounting

# JS deps
yarn install

# iOS pods (после смены deps или RN-версии)
cd ios && LANG=en_US.UTF-8 pod install && cd ..
```

> ⚠️ **CocoaPods + Ruby 4.0 баг.** Без `LANG=en_US.UTF-8` `pod` падает с
> `Encoding::CompatibilityError` (`UnicodeNormalize.normalize`). Это известный
> конфликт Ruby 4.0 от Homebrew с CocoaPods 1.16.x. Workaround — всегда
> запускать `pod` с явной локалью. Чтобы не помнить, можно добавить в `~/.zshrc`:
> ```bash
> export LANG=en_US.UTF-8
> export LC_ALL=en_US.UTF-8
> ```
> Долгосрочно: `brew install cocoapods` обновит до версии без бага, либо
> поставить Ruby 3.3 через `rbenv` и использовать его.

Если `pod install` всё-таки ругается на репо — `LANG=en_US.UTF-8 pod repo update && LANG=en_US.UTF-8 pod install`.

---

## 3. Запуск dev build

### 3.1 iOS Simulator (самое быстрое для итерации)

```bash
yarn ios
```

Что делает:
- собирает нативное приложение (первый раз ~5–10 мин, потом 30–60 с)
- ставит на запущенный симулятор (или поднимает свежий iPhone)
- запускает Metro bundler
- открывает приложение с dev-client

После первого билда: достаточно `npx expo start --dev-client` — не пересобирать нативку, только JS reload.

### 3.2 iOS на физическом iPhone

1. Подключи iPhone по кабелю, доверь компьютеру
2. В Xcode: открой `ios/ckaccounting.xcworkspace` → выбери Team в Signing для таргета `ckaccounting`
3. Назад в терминал:
```bash
yarn ios --device
```
4. Если первый запуск — на iPhone в Settings → General → VPN & Device Management подтверди разработчика

### 3.3 Android Emulator

1. Запусти эмулятор (Android Studio → Device Manager → ▶)
2. ```bash
yarn android
```

### 3.4 Android phone (физика)

1. Включи **Developer options** + **USB debugging** на телефоне
2. Подключи по USB, разреши отладку
3. Проверь: `~/Library/Android/sdk/platform-tools/adb devices` — должен показать твой телефон
4. ```bash
yarn android --device
```

---

## 4. Hot reload, debug, перезагрузка

После запуска Metro:
- **r** — reload JS
- **m** — открыть dev menu
- **j** — открыть React DevTools / Hermes inspector в Chrome
- Shake (физика) или Ctrl+Cmd+Z (sim iOS) или Cmd+M (sim Android) — dev menu

Если что-то "залипло":
```bash
# Чистый старт Metro
npx expo start --dev-client --clear
```

Если совсем плохо — полная пересборка:
```bash
# iOS
rm -rf ios/build && yarn ios

# Android
cd android && ./gradlew clean && cd .. && yarn android
```

---

## 5. Чеклист тестирования Phase 0

Запусти приложение и проверь **в указанном порядке**:

### 5.1 Холодный старт (главная победа)

- [ ] Закрой приложение полностью (свайп из app switcher)
- [ ] Открой — сплеш должен показаться и спрятаться **примерно через 1.5 секунды** (а не 2.5)
- [ ] Если приложение готово быстрее 1.5 с — оно ждёт добор; если медленнее — прячется сразу
- [ ] **Сравни ощущения** с тем, что было до изменений (можно git stash изменения и пересобрать для эталона, но обычно "стало быстрее" видно сразу)

### 5.2 Поиск товаров (мгновенный)

- [ ] Войди → таб "Товары"
- [ ] Начни печатать в поиск — **первая буква** должна сразу отфильтровать локальный список (FTS5)
- [ ] Сетевой запрос приходит ~250 мс после остановки печати — список немного обновится
- [ ] Раньше: 600 мс ожидание + ничего не происходит. Сейчас: реакция мгновенная.

### 5.3 Скролл списков (плавнее)

- [ ] В товарах прокрути список 100+ позиций — должен идти 60fps без рывков
- [ ] В долгах (`/debts`) — то же самое
- [ ] Открой dev menu → Performance Monitor (Show Perf Monitor) — JS FPS должен быть 55–60

### 5.4 Dashboard (быстрее первый рендер)

- [ ] Зайди на главный таб
- [ ] Карточки появляются плавно, без задержки
- [ ] Открой "Создать продажу" — модалка появляется без лага (первый раз чуть дольше — это нормально, lazy-mount)
- [ ] Закрой и открой снова — мгновенно (уже смонтирована)

### 5.5 Pull-to-refresh (быстрее)

- [ ] На главной потяни вниз — должно обновиться быстрее (теперь dashboard и products параллельно)

### 5.6 Регрессии (не сломалось ли что)

- [ ] Создание продажи — работает
- [ ] Создание товара — работает
- [ ] Удаление товара — работает
- [ ] Долги: создание, просмотр транзакций — работает
- [ ] Расходы: создание — работает
- [ ] Выход / повторный вход — работает
- [ ] Биометрия / PIN — работает
- [ ] Pull-to-refresh — работает
- [ ] Скролл-пагинация (товары, продажи) — работает

---

## 6. Если что-то сломалось

| Симптом | Что проверить |
|---|---|
| `Unable to resolve module` после `git pull` | `yarn install`, `cd ios && pod install` |
| Белый экран после сплеша | Metro упал? Перезапусти `npx expo start --dev-client --clear` |
| "Network request failed" | Проверь п.1 (правильный IP в `.env`, Laravel слушает 0.0.0.0) |
| Логин висит | Открой dev menu → JS Debugger, смотри Network. Скорее всего `EXPO_PUBLIC_API_URL` неверный |
| iOS билд не собирается | `cd ios && pod deintegrate && pod install` |
| Android: `SDK location not found` | Создай `android/local.properties` с `sdk.dir=/Users/aminjon/Library/Android/sdk` |
| "Hermes engine not loaded" | Подмости pod заново |

---

## 7. После теста

Если Phase 0 ок — отметим в [AUDIT.md](AUDIT.md) и переходим к Phase 1 (online-first write-path).

Если что-то сломалось — открой issue или сообщи мне с **названием экрана + текстом ошибки + скриншотом dev menu/log**.

---

## Приложение — полезные команды

```bash
# Очистить весь кэш Metro
npx expo start --dev-client --clear

# Логи устройства (iOS)
npx react-native log-ios

# Логи устройства (Android)
~/Library/Android/sdk/platform-tools/adb logcat | grep ReactNativeJS

# Список iOS симуляторов
xcrun simctl list devices

# Запуск конкретного симулятора
xcrun simctl boot "iPhone 15 Pro"

# Список android устройств
~/Library/Android/sdk/platform-tools/adb devices
```
