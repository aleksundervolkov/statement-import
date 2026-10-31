import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { controller } from './src/controller';
import { removeOrphanCopies } from './src/native/files';
import { ImportScreen } from './src/ui/ImportScreen';

export default function App() {
  useEffect(() => {
    controller.restore().finally(() => removeOrphanCopies(controller.getState().file?.uri));
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <ImportScreen />
    </SafeAreaProvider>
  );
}
