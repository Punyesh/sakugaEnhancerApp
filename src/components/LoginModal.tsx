import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { colors } from '../theme/colors';
import { hashPassword, saveCredentials, StoredCredentials } from '../api/auth';
import { verifyLogin } from '../api/sakugabooru';

export default function LoginModal({
  visible,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  onClose: () => void;
  onSuccess: (creds: StoredCredentials) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setError(null);
    setUsername('');
    setPassword('');
  };

  const doLogin = async () => {
    if (!username.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      const hash = await hashPassword(password);
      const ok = await verifyLogin(username.trim(), hash);
      if (!ok) {
        setError('username or password is incorrect');
        return;
      }
      const creds = await saveCredentials(username.trim(), password);
      setPassword('');
      onSuccess(creds);
    } catch (e: any) {
      setError(e.message || 'login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Log In</Text>
          <TextInput
            style={styles.input}
            placeholder="username"
            placeholderTextColor={colors.dim}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoFocus
          />
          <TextInput
            style={styles.input}
            placeholder="password"
            placeholderTextColor={colors.dim}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <TouchableOpacity
            style={[styles.btn, (!username.trim() || !password) && styles.btnDisabled]}
            disabled={!username.trim() || !password || loading}
            onPress={doLogin}
          >
            {loading ? (
              <ActivityIndicator color={colors.amber} size="small" />
            ) : (
              <Text style={styles.btnText}>Log In</Text>
            )}
          </TouchableOpacity>
          {error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity
            style={styles.cancel}
            onPress={() => {
              onClose();
              reset();
            }}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 18,
  },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: 'bold', marginBottom: 14 },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    color: colors.text,
    padding: 8,
    fontSize: 13,
    marginBottom: 8,
  },
  btn: {
    backgroundColor: colors.amberDim,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: colors.amber, fontWeight: 'bold', fontSize: 12 },
  error: { color: colors.red, fontSize: 12, textAlign: 'center', marginVertical: 8 },
  cancel: { alignItems: 'center', marginTop: 10 },
  cancelText: { color: colors.dim, fontSize: 12 },
});
