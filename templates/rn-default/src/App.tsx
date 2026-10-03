import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import WindowManager from './components/WindowManager/WindowManager';

const App = () => {
  return (
    <SafeAreaView style={styles.container}>
      <WindowManager />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
});

export default App;