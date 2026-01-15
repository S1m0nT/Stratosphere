import { Stack } from 'expo-router';
import React, { useState, useRef } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Alert,
  ScrollView,
} from 'react-native';
import { TrendingUp, AtSign, LogIn } from 'react-native-feather';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { colors } from '@/theme/colors';
import { typography, spacing, borderRadius, shadows } from '@/theme/designSystem';

export default function BlueskyLogin() {
  const colors = useColors();
  const { login, isLoading } = useAuth();
  const [handle, setHandle] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<TextInput>(null);
  const { width } = Dimensions.get('window');
  const maxWidth = Math.min(width * 0.9, 400);

  const handleSubmit = async () => {
    setError('');

    if (!handle.trim()) {
      setError('Please enter your Bluesky handle');
      return;
    }

    try {
      await login(handle);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to sign in';
      setError(errorMessage);
      Alert.alert('Login Error', errorMessage);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Sign in',
          headerShown: true,
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.formContainer, { maxWidth, alignSelf: 'center' }]}>
            <View style={styles.logoContainer}>
              <View style={styles.logoBackground}>
                <TrendingUp width={40} height={40} color="#fff" />
              </View>
              <Text style={styles.appName}>Stratosphere</Text>
              <Text style={styles.tagline}>Visualize trends on Bluesky</Text>
            </View>

            <View style={styles.inputContainer}>
              <AtSign
                width={20}
                height={20}
                color={colors.textSecondary}
                style={styles.inputIcon}
              />
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={handle}
                onChangeText={setHandle}
                placeholder="Your Bluesky handle"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
              />
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                styles.button,
                { opacity: pressed ? 0.9 : isLoading ? 0.7 : 1 },
              ]}
              onPress={handleSubmit}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <LogIn width={20} height={20} color="#fff" style={styles.buttonIcon} />
                  <Text style={styles.buttonText}>Sign in with Bluesky</Text>
                </>
              )}
            </Pressable>

            <Text style={styles.infoText}>
              Sign in with your Bluesky account to track trends and receive notifications.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing[4],
  },
  formContainer: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing[6],
    ...shadows.sm,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: spacing[6],
  },
  logoBackground: {
    width: 70,
    height: 70,
    borderRadius: borderRadius.full,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
    marginBottom: spacing[3],
  },
  appName: {
    fontSize: typography.size['2xl'],
    fontWeight: typography.weight.bold,
    color: colors.text,
    marginBottom: spacing[1],
  },
  tagline: {
    fontSize: typography.size.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    height: 50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    marginBottom: spacing[4],
  },
  inputIcon: {
    marginRight: spacing[2],
  },
  input: {
    flex: 1,
    height: 50,
    color: colors.text,
    fontSize: typography.size.md,
  },
  button: {
    flexDirection: 'row',
    width: '100%',
    height: 50,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
    ...shadows.sm,
  },
  buttonIcon: {
    marginRight: spacing[2],
  },
  buttonText: {
    color: colors.white,
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  errorText: {
    marginBottom: spacing[3],
    fontSize: typography.size.sm,
    color: colors.error,
    textAlign: 'center',
  },
  infoText: {
    textAlign: 'center',
    fontSize: typography.size.sm,
    color: colors.textSecondary,
    paddingHorizontal: spacing[3],
  },
});
