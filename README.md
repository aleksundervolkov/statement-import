# Statement import

Клиент тестового задания Mobile Engineer: импорт синтетической банковской выписки без потери состояния. Набор mock (`kit/`) не изменялся.

Стек: React Native 0.81 + TypeScript, Expo SDK 54, development build. Web и Expo Go не поддерживаются.

Спека с решениями и пунктами приёмки, каждый связан с тестом: `docs/SPEC.md`. Как шла работа с ИИ-агентами: `SELF-REVIEW.md`.

## Требования

- Node.js 20+
- Xcode 16.4+ (проверено: Xcode 26.0.1, iOS Simulator 26.0)
- Android SDK + эмулятор API 34. NDK стандартный для React Native 0.81, Gradle установит его сам при первой сборке.

## Clean checkout

```bash
git clone <url> statement-import
cd statement-import
```

### Mock

```bash
cd kit
npm start          # http://127.0.0.1:8787
# в другом терминале, один раз:
npm test
npm run fixtures:oversize   # fixtures/oversize.csv > 10 MiB
```

`kit/` не редактировать. Сценарии: `POST /__test/scenario` с `{"mode":"happy"|"lost_ack"|"stale_status"|"delete_failure"}`. Счётчики: `GET /__test/state`. В dev-сборке те же кнопки на экране «Mock diagnostics». Над ними карточка «What the app is doing»: запросы приложения к серверу с ответами, решения приложения (повтор не отправлен, старый статус проигнорирован, удаление не подтверждено), проверка файла на устройстве и счётчики mock, которые обновляются сами. Имён файлов и содержимого в журнале нет.

### Клиент

```bash
cd app
npm install
npx expo run:ios        # симулятор; localhost:8787 доступен как есть
npx expo run:android    # эмулятор: сначала `adb reverse tcp:8787 tcp:8787`
```

`ios/` и `android/` генерируются prebuild и не коммитятся. Физическое устройство: задать `EXPO_PUBLIC_API_URL=http://<LAN-IP>:8787` (mock не выставлять в интернет).

Фикстуры для системного picker: `kit/fixtures/statement.csv`, `statement.pdf`, `spoofed.pdf`, `oversize.csv`. На симуляторе — в Files / On My iPhone; на эмуляторе — `adb push kit/fixtures/* /sdcard/Download/`.

### Тесты клиента

```bash
cd app
npm test          # интеграция ядра против настоящего mock из kit/
npm run typecheck
```

Тесты поднимают `createMockServer` из набора, ходят по HTTP и сверяют `createRequests`, `newJobs`, `duplicateHits`, `deleteRequests`. Экран, системный picker и нативное чтение файлов автотесты не покрывают. Проверка логов покрывает логгер контроллера. Отладочную строку `prepare` в `ImportScreen` (формат и размер, без имени) тест не проверяет.

## Что делает приложение

1. Системный picker PDF/CSV. Размер и первые байты проверяются на устройстве (магия `%PDF-` / заголовок CSV). Расширение и MIME не используются. Отклонение — до POST.
2. Экран подтверждения: имя, размер, формат.
3. POST сырых байт (`application/octet-stream`, `Idempotency-Key` сохраняется до отправки, `X-File-Name`). 202 = queued, не отчёт.
4. GET по job. Если ответ на POST потерян, приложение спрашивает GET `/imports/by-key/{key}`. Повторный POST только по кнопке и тем же ключом.
5. Ревизии только вперёд: `processing/revision 2` после `ready/revision 3` игнорируется. Ответ, который пришёл после того, как пользователь ушёл с этой загрузки или удалил её, экран не меняет.
6. DELETE с отдельным ключом. «Удалено» показывается только после GET со статусом `deleted`, тела ответа DELETE для этого мало. 503 даёт «Not deleted». Если ответ на DELETE потерян, экран пишет «Deletion not confirmed» и предлагает повтор тем же ключом. 404 на DELETE даёт отдельный экран «Server has no record».
7. Перед уходом с загрузки, которая может остаться на сервере («Discard» без подтверждения загрузки, «Start over» после неудачного удаления), приложение спрашивает подтверждение.
8. Приватная копия в cache (`statement-staging/`) удаляется после подтверждения job, отмены или отклонения. Копия, которую сделал picker, удаляется сразу после проверки файла. Состояние операции лежит в `Documents/import-operation.json`, состав описан в `RELEASE.md`.
9. Запросы `fetch` прерываются через 15 секунд. Загрузка файла (`uploadAsync`) своего таймаута не имеет.

## Результаты проверки

| Платформа | Устройство | ОС | Что прогнано | Чем подтверждено |
|---|---|---|---|---|
| iOS | Simulator «Review iPhone 17» | iOS 26.0 | Матрица (happy, lost_ack и relaunch, delete_failure, spoofed, oversize) прогонялась на предыдущей версии интерфейса. Текущий интерфейс проверен на обычном и самом крупном системном шрифте. | Скриншоты в `evidence/`. |
| Android | Эмулятор Pixel 3a API 34 | Android 14 | Вручную: happy, lost_ack, stale_status, delete_failure с повтором, oversize. Debug-сборка с `blockedPermissions`: доступа к памяти и вибрации нет. Копия picker после импорта удалена. | Скриншоты в `evidence/`. |
| Обе | — | — | Маленький экран; крупный шрифт на Android. | Не проверялось. |

Непроверенное не считать работающим. Видео и скриншоты: `evidence/`.

## Команды mock для матрицы

```bash
curl -X POST http://127.0.0.1:8787/__test/reset
curl -X POST http://127.0.0.1:8787/__test/scenario -H 'Content-Type: application/json' -d '{"mode":"lost_ack"}'
curl http://127.0.0.1:8787/__test/state
```
