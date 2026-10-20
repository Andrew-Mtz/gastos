import { forwardRef, useState } from 'react';
import { Keyboard, Modal, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { colors, controlMinHeight, radius, spacing } from '../../theme/tokens';
import { profileCurrencyOptions } from './profile-currencies';

type CurrencySelectProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: string;
  disabled?: boolean;
};

export const CurrencySelect = forwardRef<View, CurrencySelectProps>(
  function CurrencySelect(
    { value, onChange, onBlur, error, disabled = false },
    ref,
  ) {
    const [open, setOpen] = useState(false);
    const selected = profileCurrencyOptions.find(
      (option) => option.code === value,
    );
    const close = () => {
      setOpen(false);
      onBlur();
    };
    return (
      <View style={styles.field}>
        <AppText>Moneda</AppText>
        <Pressable
          ref={ref}
          role="combobox"
          accessibilityLabel="Moneda"
          accessibilityValue={{
            text: selected?.label ?? 'Selecciona una moneda',
          }}
          accessibilityHint={error ?? 'Abre la lista de monedas disponibles.'}
          accessibilityState={{ expanded: open && !disabled, disabled }}
          disabled={disabled}
          onPress={() => {
            Keyboard.dismiss();
            setOpen(true);
          }}
          style={({ pressed }) => [
            styles.input,
            pressed && styles.pressed,
            !!error && styles.error,
            disabled && styles.disabled,
          ]}
        >
          <AppText
            tone={selected ? 'primary' : 'secondary'}
            style={[styles.value, disabled && styles.disabledText]}
          >
            {selected?.label ?? 'Selecciona una moneda'}
          </AppText>
          <AppText accessible={false}>⌄</AppText>
        </Pressable>
        {error && (
          <AppText variant="caption" tone="danger" role="alert">
            {error}
          </AppText>
        )}
        <Modal
          visible={open && !disabled}
          animationType="none"
          onRequestClose={close}
        >
          <View
            style={styles.modal}
            accessibilityLabel="Opciones de moneda"
            accessibilityViewIsModal
            onAccessibilityEscape={close}
          >
            <Screen scroll>
              <AppText variant="title">Seleccionar moneda</AppText>
              <View
                role="radiogroup"
                accessibilityLabel="Monedas disponibles"
                style={styles.field}
              >
                {profileCurrencyOptions.map((option) => (
                  <Button
                    key={option.code}
                    role="radio"
                    accessibilityState={{ checked: option.code === value }}
                    variant={option.code === value ? 'primary' : 'secondary'}
                    onPress={() => {
                      onChange(option.code);
                      close();
                    }}
                  >
                    {option.label}
                  </Button>
                ))}
              </View>
              <Button variant="text" onPress={close}>
                Cancelar
              </Button>
            </Screen>
          </View>
        </Modal>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  modal: { flex: 1 },
  field: { gap: spacing.sm },
  input: {
    minHeight: controlMinHeight,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  value: { flex: 1 },
  pressed: { borderColor: colors.action },
  error: { borderColor: colors.danger },
  disabled: { backgroundColor: colors.disabledBackground },
  disabledText: { color: colors.disabledText },
});
