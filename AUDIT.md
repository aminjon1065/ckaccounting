# CK Accounting — Аудит и итог миграции

**Последнее обновление:** 2026-05-11
**Статус:** Phase 0–4 завершены (без i18n — выпилен по запросу клиента).
**TypeScript:** clean (с `--noUnusedLocals --noUnusedParameters`).
**Тесты:** 4 suites, 44 tests, всё проходит.
**Кодовая база:** Expo Router + RN 0.83 + SQLite, бэк Laravel `techdev.tj/api/v1`.

---

## 0. TL;DR

Приложение переведено с **частичного offline-first** на **строгий online-first + read-only SQLite-кэш**. Удалено ~3500 строк sync-кода (outbox, conflict resolver, background sync, coordinator). Добавлены haptics, smart-defaults, единые empty/skeleton-states, error boundary + global JS error handlers, scaffold cert pinning.

| Что | Было | Стало |
|---|---|---|
| Cold start | 3.5–4 с | ~1.5 с |
| Sync-слой | 15+ файлов, 3500+ строк | удалён, замена `CacheProvider` ~280 строк |
| Write-path | Outbox + conflict resolver | Прямые HTTP-вызовы, idempotency-key |
| БД-колонки sync state | sync_action, version, status, pending_stock_delta | Не пишутся (миграция v31 дропнула sync_queue/lock) |
| Зависимости | + expo-background-fetch, expo-task-manager, async-storage | Удалены |
| Crash visibility | console.error из catch-блоков | + ErrorBoundary + global JS handler |
| Cert pinning | Не было | Scaffold готов (ждёт prod cert hash) |

---

## 1. Что сделано по фазам

### Phase 0 — Quick perf wins
- Удалён `SPLASH_MIN_DURATION_MS = 2500` (потом по запросу клиента вернули 1500). Cold start −1.5 с.
- Параллельный `Promise.all(fetchDashboard, refreshProducts)` в pull-to-refresh.
- Debounce поиска товаров 600 → 250 мс; локальный FTS показывается сразу.
- `React.memo` для `ProductCard`, `SaleCard`, `DebtCard`. Стабильные `keyExtractor` / `renderItem`.
- Lazy-mount модалок на dashboard (4 модалки монтируются только при первом открытии).
- Проверено: P2 SQL-injection (старый аудит) — уже исправлено allowlist'ом колонок в conflict-resolver.

### Phase 1 — Online-first write-path
Все мутации переписаны с offline-fallback на прямые API-вызовы:
- **Sales** ([CreateSaleModal](components/sales/CreateSaleModal.tsx)) — было `try → catch(0) → insertOrUpdateSale + decrementStock + queue`, стало toast «нет соединения».
- **Products** ([ProductFormModal](components/products/ProductFormModal.tsx)), **Expenses**, **Purchases**, **Shops create** — тот же паттерн.
- **Debts транзакции** ([app/debts/[id].tsx](app/debts/[id].tsx)) — было optimistic+queue (всегда), стало `api.debts.addTransaction()` с idempotency-key; UI использует server-returned Debt как источник правды.
- **Shops edit/toggle**, **Users CRUD**, **Profile update**, **Shop settings** — тоже direct API.
- Удалён `bootstrapPending` gate + экран «Загрузка данных» на login.
- Login делает `triggerSync()` fire-and-forget для кэш-warmup.

### Phase 2 — Демонтаж sync-слоя
- **Удалено целиком:** `lib/sync/*` (20+ файлов), `lib/db/outbox.ts`, `components/sync/`, `components/sales/SaleRecoveryModal.tsx`, `components/MigrationBlockedScreen.tsx`, `app/sync-errors.tsx`.
- **Новые модули:**
  - [lib/network/NetworkProvider.tsx](lib/network/NetworkProvider.tsx) — минимальный provider (~55 строк), `isOnline` через Zustand store, один NetInfo листенер.
  - [lib/api/tokenRefresh.ts](lib/api/tokenRefresh.ts) + [lib/api/tokenExpiry.ts](lib/api/tokenExpiry.ts) — bridges переехали из sync.
  - [lib/cache/CacheProvider.tsx](lib/cache/CacheProvider.tsx) (~280 строк) — заменил `SyncProvider` (414 строк). Owns периодический pull + методы `triggerSync`, `refreshProducts`, `fetchOlderX`, `fetchAllHistory`.
  - [lib/cache/offlineReports.ts](lib/cache/offlineReports.ts) + aggregators — переехали из `lib/sync/usecases/`.
  - [lib/cache/fetchers/*.ts](lib/cache/fetchers/) (6 файлов) — `Remote*Fetcher` классы переехали, упрощены.
- **DB migration v31** — `DROP TABLE IF EXISTS sync_queue; DROP TABLE IF EXISTS sync_lock;`. Колонки sync_action/version/pending_stock_delta/status оставлены на месте (не читаются, не дропать ради простоты миграции).
- **Удалены пакеты:** `expo-background-fetch`, `expo-task-manager`, `@react-native-async-storage/async-storage`, `expo-modules-core` (dev). Плагины из app.json тоже.
- `bootstrapPending` + `completeBootstrap` поля удалены из auth.tsx.
- `OfflineBanner` упрощён до offline + syncing (убрано pending/failed).
- `(tabs)/_layout.tsx` — снят `ConflictResolutionModal` + pending badge на sales tab.

### Phase 3 — Перф полировка
- **NetInfo** консолидация: убран дубль листенер из `lib/api/client.ts`, единый источник через `useNetworkStore`.
- **expo-image** для аватарок ([Avatar](components/ui/avatar.tsx)), hero-фото товара ([products/[id].tsx](app/products/[id].tsx)), preview в ProductFormModal — везде с `cachePolicy="memory-disk"`.
- **React.memo** для `UserCard`, `ShopCard`, `PurchaseCard` (раньше не были).
- **Reports tab cache** — переключение табов не пере-скачивает данные. Кэш инвалидируется только при смене дат.
- Удалён `expo-modules-core` (dev-deps), плагин чистый.

### Phase 4 — UX polish
- **Haptics** ([lib/haptics.ts](lib/haptics.ts)) — семантичные функции `tap/press/strong/selection/success/warning/error`. Подключено в toast (автоматически на success/error/warning) + новый компонент [FAB](components/ui/fab.tsx) (заменил 8 копипастов inline FAB).
- **Smart defaults**: [CreateSaleModal](components/sales/CreateSaleModal.tsx) и [ExpenseFormModal](components/expenses/ExpenseFormModal.tsx) запоминают `payment_type` и `shop_id` в SecureStore — следующий create открывается с последним выбором.
- **Empty states** ([components/ui/empty-state.tsx](components/ui/empty-state.tsx)) — единый `<EmptyState icon title description action?>` во всех list-экранах (Sales, Products, Debts, Expenses, Purchases).
- **Crash reporter**: [installGlobalErrorHandlers()](lib/observability/reporter.ts) подключает RN-овые `ErrorUtils.setGlobalHandler` + `process.on('unhandledRejection')`. ErrorBoundary + ⌒ + global handlers = три слоя catch. Self-hosted endpoint остаётся одностраничным TODO (см. memory: no paid SaaS).
- **Certificate pinning** — scaffold:
  - iOS: `NSPinnedDomains` в [Info.plist](ios/ckaccounting/Info.plist), закомментирован, инструкция извлечения SPKI-SHA256 в комментарии.
  - Android: [network_security_config.xml](android/app/src/main/res/xml/network_security_config.xml), dev cleartext для LAN/emulator, prod pin-set закомментирован.
  - Подключено через `android:networkSecurityConfig` в манифесте.
- ~~i18n~~ — выпилено по запросу клиента, оставлен только русский.

---

## 2. Что ещё стоит сделать

### Когда поднимется prod cert
- Извлечь SPKI-SHA256 production cert'а (команда в комментариях обоих pin-файлов).
- Сгенерировать backup pin из staging cert.
- Раскомментировать pin-блоки в [Info.plist](ios/ckaccounting/Info.plist) и [network_security_config.xml](android/app/src/main/res/xml/network_security_config.xml).
- Тест на release build — pinned connection должен пройти. После ротации cert обновлять оба hash + увеличивать `expiration` в pin-set.

### Когда подключим self-hosted error endpoint
- Один файл `lib/observability/reporter.ts` — в функциях `reportError` / `reportMessage` после `console.error` добавить `fetch(ENDPOINT, { method: "POST", body: JSON.stringify(...) })`. Без библиотек.

### Опциональные перф-улучшения (низкий приоритет)
- Embedded шрифты через `expo-font` native assets — сейчас Inter + PlusJakarta грузятся при cold start ~150–250 мс.
- Code-splitting через expo-router lazy для редких экранов (users, suspended) — Metro статически бандлит, выигрыш только при manual `import()`.
- Bundle audit через `npx expo-doctor` — flagged: множественные lock-файлы (`yarn.lock`, `package-lock.json`, `bun.lock`). Нужно решить кого использовать как primary; остальные удалить чтобы CI не путался.

### Lock-file решение (требует выбора)
- `yarn.lock` (15:12) — обновляется текущей сессией через `yarn install`.
- `bun.lock` (15:41) — самый свежий, возможно от `npx expo install`.
- `package-lock.json` (13:31) — самый старый, npm.

**Рекомендация:** оставить `yarn.lock` (текущий tool of choice по DEV_BUILD.md), удалить два других:
```bash
rm package-lock.json bun.lock
```

### Не сделано из аудита (низкая ценность)
- **Y4** — index на `products.shop_id` — добавлен в миграции v17, уже в проде.
- **Y5** — `clearLocalData` чистит sync_metadata — после демонтажа sync эта таблица фактически не наполняется, проблема ушла сама.
- **Y11** — i18n — клиент явно отказался, только русский.

---

## 3. Архитектура — финальная карта

```
app/                           — Expo Router screens (тонкие, без бизнес-логики)
  (auth)/login.tsx             — login + PIN + биометрия
  (tabs)/                      — Dashboard, Products, Sales, Reports, Settings
  ...

components/
  ui/                          — primitives (Button, FAB, EmptyState, Card, ...)
  sales/, products/, ...       — domain widgets
  error-boundary.tsx           — React tree crash → reportError

hooks/
  useSales / useProducts / ... — local-first feed: SQLite read instantly + remote refresh

lib/
  api/                         — HTTP client, endpoint modules, token refresh
  cache/
    CacheProvider.tsx          — periodic remote pull + UI methods
    fetchers/                  — server → SQLite per-entity
    offlineReports.ts          — local aggregations for offline reports
  db/                          — SQLite repositories (read-mostly, kopecks money)
  network/
    NetworkProvider.tsx        — single isOnline source
  haptics.ts                   — semantic taptic helpers
  observability/reporter.ts    — error/event funnel + global handlers
  permissions.ts               — RBAC checks
  validation/                  — Zod schemas

store/
  auth.tsx                     — session, PIN, biometric
  toast.tsx                    — toast queue with haptic auto-trigger
  suspension.ts                — shop suspended flag
```

**Провайдеры дерево** (root layout):
```
<SafeAreaProvider>
  <ErrorBoundary>
    <AuthProvider>
      <ToastProvider>
        <ThemeProvider>
          <NetworkProvider>
            <CacheProvider>
              <BiometricGuard>
                <Stack>...</Stack>
```

---

## 4. Метрики и контрольные точки

| Что | Значение |
|---|---|
| TypeScript (`tsc --noEmit`) | ✅ clean |
| TypeScript (`--noUnusedLocals --noUnusedParameters`) | ✅ clean |
| Jest test suites | 4 suites, 44 tests, всё проходит |
| Файлов удалено (Phase 1–2) | 20+ |
| Строк sync-кода удалено | ~3500 |
| Build-deps удалено | expo-background-fetch, expo-task-manager, async-storage, expo-modules-core (dev) |
| Cold start (оценочно) | 3.5–4 с → ~1.5 с (с min splash 1500 мс на брендинг) |
| Reports tab switch | ~600 мс → instant (cache per tab) |
| Touch-feedback events | 0 → haptics на toast, FAB, EmptyState action |
| Crash reporting layers | 1 (catch-блоки) → 3 (catch + ErrorBoundary + globalHandlers) |

---

*В файле `audit_с.md` остался **старый** аудит от 2026-04-20 для исторической справки. Этот `AUDIT.md` — актуальное состояние.*
