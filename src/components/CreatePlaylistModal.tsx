import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { colors } from '../theme/colors';
import { createLocalPool, LocalPool } from '../api/localPools';

export default function CreatePlaylistModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (pool: LocalPool) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const reset = () => {
    setName('');
    setDescription('');
  };

  const doCreate = async () => {
    if (!name.trim()) return;
    const pool = await createLocalPool(name.trim(), description.trim());
    reset();
    onCreated(pool);
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
          <TouchableOpacity style={[styles.btn, !name.trim() && styles.btnDisabled]} disabled={!name.trim()} onPress={doCreate}>
            <Text style={styles.btnText}>Create</Text>
          </TouchableOpacity>
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
  btn: {
    backgroundColor: colors.amberDim,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: colors.amber, fontWeight: 'bold', fontSize: 12 },
  cancel: { alignItems: 'center', marginTop: 10 },
  cancelText: { color: colors.dim, fontSize: 12 },
});
