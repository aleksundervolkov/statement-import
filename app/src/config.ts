/** Android emulator reaches it through `adb reverse tcp:8787 tcp:8787`. */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8787';
