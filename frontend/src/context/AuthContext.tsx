import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import React, { createContext, ReactNode, useContext, useEffect, useState, useRef } from 'react';
import { Alert, Platform, Modal, View, ActivityIndicator, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

import { User } from '@/types/user';

const API_BASE_URL = 'https://i-love.terrorism.lol';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (handle: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  updateFollowedTopics: (topics: string[]) => Promise<void>;
  updatePreferredTags: (tags: string[]) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authState, setAuthState] = useState<string | null>(null);
  const [showWebView, setShowWebView] = useState(false);
  const [webViewUrl, setWebViewUrl] = useState('');
  const safetyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    console.log('authState changed:', authState);
  }, [authState]);

  // Check for existing session on app start
  useEffect(() => {
    const loadUser = async () => {
      try {
        const userJson = await AsyncStorage.getItem('@user');
        if (userJson) {
          setUser(JSON.parse(userJson));
        }
      } catch (error) {
        console.error('Failed to load user session:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadUser();
  }, []);

  const pollForAuthentication = async (state: string, maxAttempts = 60): Promise<User | null> => {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const checkAuth = async () => {
        try {
          console.log(`Polling auth status - attempt ${attempts + 1}`);
          const response = await fetch(`${API_BASE_URL}/api/auth/status?state=${state}`, {
            headers: {
              Accept: 'application/json',
            },
          });

          if (response.status === 404) {
            console.log('Auth status endpoint returned 404 - state may be invalid or expired');
            attempts += 3; // Increase attempts faster for 404 errors
            if (attempts >= maxAttempts) {
              setShowWebView(false);
              return reject(new Error('Authentication failed: Invalid state'));
            }
          } else if (response.ok) {
            const data = await response.json();
            if (data.authenticated && data.user) {
              console.log('Authentication successful, user data received');
              setShowWebView(false);
              return resolve(data.user);
            } else {
              console.log('Auth status check: Not authenticated yet');
            }
          } else {
            console.log(`Auth check failed with status: ${response.status}`);
          }

          attempts++;
          if (attempts >= maxAttempts) {
            setShowWebView(false);
            return reject(new Error('Authentication timed out'));
          }

          setTimeout(checkAuth, 1000);
        } catch (error) {
          console.error('Error polling auth status:', error);
          attempts++;
          if (attempts >= maxAttempts) {
            setShowWebView(false);
            return reject(new Error('Authentication polling failed'));
          }
          setTimeout(checkAuth, 1000);
        }
      };
      checkAuth();
    });
  };

  const handleSuccessfulAuth = async (userData: any) => {
    console.log('Processing successful authentication');

    // Clear the safety timeout if it exists
    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
    }

    const userInfo: User = {
      did: userData.did,
      handle: userData.handle,
      displayName: userData.display_name || userData.displayName,
      avatarUrl: userData.avatar_url || userData.avatarUrl,
      followedTopics: userData.followed_topics || userData.followedTopics || [],
      preferredTags: userData.preferred_tags || userData.preferredTags || [],
      accessToken: userData.access_token,
      refreshToken: userData.refresh_token,
    };

    try {
      await AsyncStorage.setItem('@user', JSON.stringify(userInfo));
      if (userData.access_token) {
        await AsyncStorage.setItem('@auth_token', userData.access_token);
      }

      // Close WebView and update state
      setShowWebView(false);
      setUser(userInfo);
      setAuthState(null);
      setIsLoading(false);

      // Navigate to home screen after a short delay
      setTimeout(() => {
        router.replace('/');
      }, 500);

      console.log('Authentication completed successfully');
    } catch (error) {
      console.error('Error saving auth data:', error);
      setIsLoading(false);
    }
  };

  const login = async (handle: string) => {
    setIsLoading(true);
    try {
      console.log(`Starting login for ${handle}`);
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: handle }),
        credentials: 'include',
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Login request failed:', errorText);
        setIsLoading(false);
        throw new Error(`Login request failed: ${errorText}`);
      }

      const data = await response.json();
      console.log('Login response:', data);

      if (data.auth_url && data.state) {
        console.log('Processing auth with state:', data.state);
        await AsyncStorage.setItem('@auth_state', data.state);
        setAuthState(data.state);

        if (Platform.OS === 'web') {
          // @ts-ignore
          window.open(data.auth_url, '_blank');
        } else {
          const separator = data.auth_url.includes('?') ? '&' : '?';
          const mobileUrl = `${data.auth_url}${separator}mobile=true`;
          setWebViewUrl(mobileUrl);
          setShowWebView(true);
        }

        try {
          const userData = await pollForAuthentication(data.state);
          if (userData) {
            handleSuccessfulAuth(userData);
          }
        } catch (error) {
          console.error('Authentication polling failed:', error);
          setShowWebView(false);
          setIsLoading(false);
          Alert.alert(
            'Login Error',
            error instanceof Error ? error.message : 'Authentication process failed'
          );
          throw error;
        }
      } else {
        setIsLoading(false);
        throw new Error('No authentication URL provided by server');
      }
    } catch (error) {
      console.error('Login error:', error);
      setShowWebView(false);
      setIsLoading(false);
      Alert.alert(
        'Login Error',
        error instanceof Error ? error.message : 'An unknown error occurred'
      );
      throw error;
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      const token = await AsyncStorage.getItem('@auth_token');
      if (token) {
        await fetch(`${API_BASE_URL}/api/auth/logout`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
      }
      await AsyncStorage.removeItem('@user');
      await AsyncStorage.removeItem('@auth_state');
      await AsyncStorage.removeItem('@auth_token');
      setUser(null);
      setAuthState(null);
      router.replace('/');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshSession = async () => {
    if (!user) return;
    try {
      if (!user.accessToken || !user.refreshToken) {
        console.error('No tokens available for refresh');
        await logout();
        return;
      }
      const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ refresh_token: user.refreshToken }),
      });
      if (!response.ok) {
        console.error('Token refresh failed');
        await logout();
        return;
      }
      const refreshData = await response.json();
      const profileResponse = await fetch(`${API_BASE_URL}/api/profile`, {
        headers: {
          Authorization: `Bearer ${refreshData.access_token || user.accessToken}`,
          Accept: 'application/json',
        },
      });
      if (profileResponse.ok) {
        const { user: updatedUser } = await profileResponse.json();
        const userInfo: User = {
          did: updatedUser.did,
          handle: updatedUser.handle,
          displayName: updatedUser.display_name || updatedUser.displayName,
          avatarUrl: updatedUser.avatar_url || updatedUser.avatarUrl,
          followedTopics: updatedUser.followed_topics || updatedUser.followedTopics || [],
          preferredTags: updatedUser.preferred_tags || updatedUser.preferredTags || [],
          accessToken: refreshData.access_token || user.accessToken,
          refreshToken: refreshData.refresh_token || user.refreshToken,
        };
        await AsyncStorage.setItem('@user', JSON.stringify(userInfo));
        if (refreshData.access_token) {
          await AsyncStorage.setItem('@auth_token', refreshData.access_token);
        }
        setUser(userInfo);
      }
    } catch (error) {
      console.error('Session refresh error:', error);
      await logout();
    }
  };

  const updateFollowedTopics = async (topics: string[]) => {
    if (!user) return;
    try {
      const token = (await AsyncStorage.getItem('@auth_token')) || user.accessToken;
      if (!token) {
        throw new Error('No authentication token available');
      }
      const response = await fetch(`${API_BASE_URL}/api/topics/follow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ topics }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 401) {
          await refreshSession();
          const newToken = (await AsyncStorage.getItem('@auth_token')) || user.accessToken;
          const retryResponse = await fetch(`${API_BASE_URL}/api/topics/follow`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${newToken}`,
            },
            body: JSON.stringify({ topics }),
          });
          if (!retryResponse.ok) {
            throw new Error('Failed to update topics after token refresh');
          }
        } else {
          throw new Error(errorData.error || 'Failed to update topics');
        }
      }
      const updatedUser = { ...user, followedTopics: topics };
      await AsyncStorage.setItem('@user', JSON.stringify(updatedUser));
      setUser(updatedUser);
    } catch (error) {
      console.error('Update topics error:', error);
      throw error;
    }
  };

  // Update preferred tags
  const updatePreferredTags = async (tags: string[]) => {
    if (!user) {
      throw new Error('User is not authenticated');
    }

    try {
      const token = (await AsyncStorage.getItem('@auth_token')) || user.accessToken;
      if (!token) {
        throw new Error('No authentication token available');
      }

      const response = await fetch(`${API_BASE_URL}/api/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ preferred_tags: tags }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 401) {
          await refreshSession();
          const newToken = (await AsyncStorage.getItem('@auth_token')) || user.accessToken;
          const retryResponse = await fetch(`${API_BASE_URL}/api/profile`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${newToken}`,
            },
            body: JSON.stringify({ preferred_tags: tags }),
          });

          if (!retryResponse.ok) {
            throw new Error('Failed to update preferred tags after token refresh');
          }
        } else {
          throw new Error(errorData.error || 'Failed to update preferred tags');
        }
      }

      const updatedUser = { ...user, preferredTags: tags };
      await AsyncStorage.setItem('@user', JSON.stringify(updatedUser));
      setUser(updatedUser);
    } catch (error) {
      console.error('Update preferred tags error:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        refreshSession,
        updateFollowedTopics,
        updatePreferredTags,
      }}
    >
      {children}
      {/* WebView for mobile authentication */}
      <Modal
        visible={showWebView}
        onRequestClose={() => {
          setShowWebView(false);
          setIsLoading(false);
        }}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View style={styles.webViewContainer}>
          {webViewUrl ? (
            <WebView
              source={{
                uri: webViewUrl,
                headers: {
                  Accept: 'application/json',
                },
              }}
              startInLoadingState={true}
              renderLoading={() => (
                <View style={styles.loaderContainer}>
                  <ActivityIndicator size="large" color="#0000ff" />
                </View>
              )}
              injectedJavaScript={`
                // Inject headers into all fetch and XHR requests
                (function() {
                  const originalFetch = window.fetch;
                  window.fetch = function() {
                    const args = Array.from(arguments);
                    if (args[1] && args[1].headers) {
                      args[1].headers = {
                        ...args[1].headers,
                        'Accept': 'application/json'
                      };
                    } else if (args[1]) {
                      args[1].headers = { 'Accept': 'application/json' };
                    } else {
                      args.push({
                        headers: { 'Accept': 'application/json' }
                      });
                    }
                    return originalFetch.apply(this, args);
                  };
                  const originalXhrOpen = XMLHttpRequest.prototype.open;
                  XMLHttpRequest.prototype.open = function() {
                    const args = Array.from(arguments);
                    const originalSend = this.send;
                    this.send = function() {
                      this.setRequestHeader('Accept', 'application/json');
                      return originalSend.apply(this, arguments);
                    };
                    return originalXhrOpen.apply(this, args);
                  };
                })();
                true;
              `}
              onNavigationStateChange={(navState) => {
                if (navState.url.includes('/api/auth/callback')) {
                  console.log('Detected callback URL in WebView navigation');

                  // Extract URL parameters to determine success/failure
                  try {
                    const urlObj = new URL(navState.url);
                    const urlState = urlObj.searchParams.get('state');
                    const errorParam = urlObj.searchParams.get('error');

                    if (errorParam) {
                      console.log(`Auth error detected in callback: ${errorParam}`);
                      // Close WebView immediately on error
                      setShowWebView(false);
                      setIsLoading(false);
                      Alert.alert('Authentication Error', `Failed to authenticate: ${errorParam}`, [
                        { text: 'OK' },
                      ]);
                      return;
                    }

                    if (urlState && authState === urlState) {
                      console.log('State parameter matches active auth request');

                      // Set a safety timeout - in case polling gets stuck
                      // This ensures we don't keep the WebView open indefinitely
                      const safetyTimeout = setTimeout(() => {
                        console.log('Safety timeout triggered - closing WebView');
                        setShowWebView(false);
                        setIsLoading(false);
                        // Clear any other state
                        setAuthState(null);
                        // Display a notification to the user
                        Alert.alert(
                          'Authentication Status Unknown',
                          'Please check if you are logged in, or try again.',
                          [{ text: 'OK' }]
                        );
                      }, 10000); // 10 seconds should be enough

                      // Store the timeout ID
                      safetyTimeoutRef.current = safetyTimeout;
                    } else {
                      console.log('State parameter missing or mismatch');
                      // If we can't verify the state, wait a moment then close
                      setTimeout(() => {
                        setShowWebView(false);
                        setIsLoading(false);
                      }, 2000);
                    }
                  } catch (error) {
                    console.error('Error parsing callback URL:', error);
                    // If there's an error parsing the URL, close the WebView
                    setTimeout(() => {
                      setShowWebView(false);
                      setIsLoading(false);
                    }, 2000);
                  }
                }
              }}
            />
          ) : (
            <View style={styles.loaderContainer}>
              <ActivityIndicator size="large" color="#0000ff" />
            </View>
          )}
        </View>
      </Modal>
    </AuthContext.Provider>
  );
};

const styles = StyleSheet.create({
  webViewContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loaderContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
