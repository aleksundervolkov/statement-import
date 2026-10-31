# Evidence

Текущий интерфейс, 31.10.2026.

## iOS: Simulator «Review iPhone 17», iOS 26.0

Размер текста «large», если не указано иное.

- `ui-idle.png` стартовый экран, карточка «Import a statement».
- `ui-confirm.png` подтверждение statement.csv (112 B, CSV) перед Send.
- `ui-ready.png` отчёт job-demo-001: 151.99 AUD в месяц, StreamBeam и BrightGrid.
- `ui-details.png` детали StreamBeam.
- `ui-deleted.png` «Deleted on the server» после удаления.
- `ui-xxxl-idle.png`, `ui-xxxl-ready.png`, `ui-xxxl-details.png` те же экраны на самом крупном системном шрифте: строки переносятся, ничего не обрезано.

## Android: эмулятор Pixel 3a API 34, Android 14

Debug-сборка после prebuild с `android.blockedPermissions`.

- `android-ui-idle.png` стартовый экран.
- `android-ui-ready.png` statement.csv в сценарии happy: job-demo-002, ready, 151.99 AUD в месяц.

После этого импорта `cache/DocumentPicker` пуст. `dumpsys package` на debug-сборке не показывает READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE и VIBRATE. SYSTEM_ALERT_WINDOW запрошен, но не выдан: его объявляет debug-манифест для отладочного оверлея React Native. Release-сборка не собиралась, её манифест не проверен.
