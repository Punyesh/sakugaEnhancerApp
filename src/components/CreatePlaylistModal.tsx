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
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { createPool, Pool } from '../api/sakugabooru';
import { StoredCredentials } from '../api/auth';

export default function CreatePlaylistModal({
  visible,
  credentials,
  onClose,
  onCreated,
}: {
  visible: boolean;
  credentials: StoredCredentials;
  onClose: () => void;
  onCreated: (pool: Pool) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setDescription('');
    setIsPublic(false);
    setError(null);
  };

  const doCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const pool = await createPool(name.trim(), isPublic, description.trim(), credentials.username, credentials.passwordHash);
      reset();
      onCreated(pool);
    } catch (e: any) {
      setError(e.message || 'failed to create playlist');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>New Pool</Text>
          <TextInput
            style={styles.input}
            placeholder="pool name"
            placeholderTextColor={colors.dim}
            value={name}
            onChangeText={setName}
            autoFocus
          />
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="description (optional)"
            placeholderTextColor={colors.dim}
            value={description}
            onChangeText={setDescription}
            multiline
          />
          <TouchableOpacity style={styles.toggleRow} onPress={() => setIsPublic((p) => !p)}>
            <Ionicons
              name={isPublic ? 'checkbox' : 'square-outline'}
              size={18}
              color={isPublic ? colors.amber : colors.dim}
            />
            <Text style={styles.toggleLabel}> Public</Text>
          </TouchableOpacity>
          <Text style={styles.toggleHelp}>
            Anyone can find and view a public pool. Unchecked stays private to you.
          </Text>
          <TouchableOpacity
            style={[styles.btn, !name.trim() && styles.btnDisabled]}
            disabled={!name.trim() || loading}
            onPress={doCreate}
          >
            {loading ? (
              <ActivityIndicator color={colors.amber} size="small" />
            ) : (
              <Text style={styles.btnText}>Create</Text>
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
  textarea: { minHeight: 60, textAlignVertical: 'top' },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  toggleLabel: { color: colors.text, fontSize: 13 },
  toggleHelp: { color: colors.dim, fontSize: 11, lineHeight: 15, marginTop: 4, marginBottom: 12 },
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
