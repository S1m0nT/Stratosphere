import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, View, StyleSheet, Pressable } from 'react-native';
import { Bell, User, LogIn } from 'react-native-feather';

import NotificationBanner from '@/components/NotificationBanner';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { NotificationProvider } from '@/context/NotificationContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { TagFilterProvider } from '@/contexts/TagFilterContext';
import { useColors } from '@/hooks/useColors';
import notificationService from '@/services/notificationService';
import { spacing } from '@/theme/designSystem';

// Create a client
const queryClient = new QueryClient();

// Root layout wrapper with auth check
function RootLayoutNav() {
  const colors = useColors();
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  // Show loading indicator while checking auth
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: colors.white,
          },
          headerTintColor: colors.text,
          headerTitleStyle: {
            fontWeight: '600',
          },
          contentStyle: {
            backgroundColor: colors.backgroundSecondary,
          },
          headerShadowVisible: false,
          animation: 'slide_from_right',
          headerBackTitle: 'Back',
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: 'Stratosphere',
            headerRight: () => (
              <View style={styles.headerButtons}>
                {isAuthenticated ? (
                  <>
                    <Pressable
                      onPress={() => {
                        // Test notification when clicking the notification icon
                        notificationService.scheduleLocalNotification({
                          title: 'Hello from Stratosphere',
                          body: 'This is a test notification',
                          data: {
                            type: 'system',
                            message: 'This is a test notification sent from the app',
                          },
                        });
                      }}
                      style={styles.headerButton}
                    >
                      <Bell width={24} height={24} color={colors.text} />
                    </Pressable>
                    <Pressable onPress={() => router.push('/profile')} style={styles.headerButton}>
                      <User width={24} height={24} color={colors.text} />
                    </Pressable>
                  </>
                ) : (
                  <Pressable onPress={() => router.push('/login')} style={styles.headerButton}>
                    <LogIn width={24} height={24} color={colors.text} />
                  </Pressable>
                )}
              </View>
            ),
          }}
        />
        <Stack.Screen
          name="trend/[keyword]"
          options={{
            title: 'Trend Details',
          }}
        />
        <Stack.Screen
          name="login"
          options={{
            title: 'Sign In',
            presentation: 'card',
          }}
        />
        <Stack.Screen
          name="profile"
          options={{
            title: 'My Profile',
          }}
        />
        <Stack.Screen
          name="topics"
          options={{
            title: 'Manage Topics',
          }}
        />
        <Stack.Screen
          name="topic/[id]"
          options={{
            title: 'Topic Details',
          }}
        />
      </Stack>

      {/* Notification Banner */}
      <NotificationBanner />
    </View>
  );
}

function AppWithProviders() {
  const { isAuthenticated, user } = useAuth();

  // Register for push notifications when authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      notificationService.registerForPushNotifications().catch((error) => {
        console.error('Failed to register for push notifications:', error);
      });
    }
  }, [isAuthenticated, user]);

  return <RootLayoutNav />;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <NotificationProvider>
            <TagFilterProvider>
              <StatusBar style="dark" />
              <AppWithProviders />
            </TagFilterProvider>
          </NotificationProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'white',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    padding: spacing[2],
    marginLeft: spacing[2],
    borderRadius: 20,
  },
});
